// Apply runtime adapter overrides from runtimes.config.json on top of the
// built-in defs (claude.ts, qwen.ts). Lets the operator adapt e.g. the
// corporate Qwen fork via JSON configuration instead of editing TS source.
//
// Schema lives in `daemon/runtimes/runtimes-config-schema.ts`. Placeholder
// substitution for `buildArgs` happens at spawn time; unknown
// `${placeholder}` tokens are left verbatim so typos surface visibly.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeAgentDef, BuildArgsInput } from "./types.ts";
import { parseRuntimesConfig, type RuntimeOverrideT } from "./runtimes-config-schema.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const CONFIG_FILE = "runtimes.config.json";

/** Pure: apply override map directly. Tests use this. Production uses
 *  `applyRuntimeOverrides()` which reads the override map from disk. */
export function applyRuntimeOverridesWithMap(
  defs: RuntimeAgentDef[],
  overrides: Record<string, RuntimeOverrideT> | null | undefined
): RuntimeAgentDef[] {
  if (!overrides) return defs;
  return defs.map((def) => {
    const o = overrides[def.id];
    if (!o) return def;
    const merged: RuntimeAgentDef = {
      ...def,
      displayName: o.displayName ?? def.displayName,
      bin: o.bin ?? def.bin,
      binEnvVar: o.binEnvVar ?? def.binEnvVar,
      versionArgs: o.versionArgs ?? def.versionArgs,
      streamFormat: o.streamFormat ?? def.streamFormat,
      promptViaStdin: o.promptViaStdin ?? def.promptViaStdin,
      buildArgs: o.buildArgs ? (input: BuildArgsInput) => substituteArgs(o.buildArgs!, input) : def.buildArgs,
    };
    return merged;
  });
}

/** Production entry point: read runtimes.config.json from disk, validate,
 *  apply. Safe to call when the file doesn't exist (returns defs unchanged).
 *  Invalid JSON throws at daemon startup (load-time), which surfaces in
 *  the daemon log rather than silently producing a broken adapter. */
export function applyRuntimeOverrides(defs: RuntimeAgentDef[]): RuntimeAgentDef[] {
  const overrides = loadOverridesFromDisk();
  return applyRuntimeOverridesWithMap(defs, overrides);
}

function loadOverridesFromDisk(): Record<string, RuntimeOverrideT> | null {
  const cfgPath = join(PROJECT_ROOT, CONFIG_FILE);
  if (!existsSync(cfgPath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch (err) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = parseRuntimesConfig(raw);
  return parsed.runtimes;
}

/* Substitute `${placeholder}` tokens in each arg string with values from the
 * BuildArgsInput. Unknown placeholders pass through unchanged so the operator
 * notices typos (vs silent empty-string substitution). */
function substituteArgs(args: string[], input: BuildArgsInput): string[] {
  return args.map((arg) =>
    arg.replace(/\$\{(\w+)\}/g, (whole, name) => {
      switch (name) {
        case "mcpConfigPath": return input.mcpConfigPath;
        case "systemPrompt": return input.systemPrompt;
        case "systemPromptFile": return input.systemPromptFile;
        case "userMessage": return input.userMessage;
        case "userMessageFile": return input.userMessageFile;
        case "allowedTools": return input.allowedTools.join(",");
        case "allowedToolsSpaced": return input.allowedTools.join(" ");
        default: return whole;
      }
    })
  );
}
