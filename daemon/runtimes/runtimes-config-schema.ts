// Schema for runtimes.config.json — the file the bring-up agent edits to
// adapt a corporate Qwen/Claude/whatever fork. Lives separately from
// manifest.config.json because (a) it's CLI/environment-specific, not
// DS-specific; (b) the agent edits ONLY this file when customizing
// CLI behavior, never the daemon TS source.
//
// Validated by `daemon/runtimes/load-overrides.ts` at daemon startup;
// invalid shapes fail loudly instead of silently producing a broken
// adapter that hangs on first invocation.

import { z } from "zod";

/* Per-runtime adapter override. Mirrors `daemon/runtimes/types.ts`'s
 * RuntimeAgentDef shape, but `buildArgs` is declarative: an array of
 * strings with `${placeholder}` substitutions resolved at spawn time.
 *
 * Supported placeholders (case-sensitive):
 *   ${mcpConfigPath}      absolute path to .beaver-designus/mcp.json
 *   ${systemPromptFile}   absolute path to .beaver-designus/system-prompt.md
 *   ${userMessageFile}    absolute path to .beaver-designus/user-message.txt
 *   ${allowedTools}       CSV of MCP tool names (e.g. "mcp__a,mcp__b")
 *   ${allowedToolsSpaced} space-separated variant
 *
 * Unknown placeholders pass through unchanged so typos surface visibly
 * (a misspelt placeholder produces the literal "${...}" arg, not silent
 * empty-string substitution). */
export const RuntimeOverride = z
  .object({
    displayName: z.string().optional(),
    bin: z.string().optional(),
    binEnvVar: z.string().optional(),
    versionArgs: z.array(z.string()).optional(),
    streamFormat: z.enum(["plain", "claude-stream-json"]).optional(),
    promptViaStdin: z.boolean().optional(),
    buildArgs: z.array(z.string()).optional(),
  })
  .strict();

export const RuntimesConfig = z
  .object({
    $comment: z.string().optional(),
    /** Keys are built-in runtime ids: "qwen" or "claude". Adding a new
     *  id here is a no-op for v1; new runtimes require shipping a new
     *  built-in def upstream. */
    runtimes: z.record(z.string(), RuntimeOverride),
  })
  .strict();

export type RuntimesConfigT = z.infer<typeof RuntimesConfig>;
export type RuntimeOverrideT = z.infer<typeof RuntimeOverride>;

/** Parse with structured error reporting. */
export function parseRuntimesConfig(raw: unknown): RuntimesConfigT {
  const r = RuntimesConfig.safeParse(raw);
  if (r.success) return r.data;
  const issues = r.error.issues
    .map((i) => `  · ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`runtimes.config.json is invalid:\n${issues}`);
}
