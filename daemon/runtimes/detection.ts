// Resolve which adapter to use this session.
// Probe each AGENT_DEFS entry's `--version` and accept the first that exits 0.

import { spawnSync } from "node:child_process";
import { AGENT_DEFS } from "./registry.ts";
import type { DetectedAgent, RuntimeAgentDef } from "./types.ts";

function resolveBinPath(name: string): string | null {
  // On Windows, spawn without shell:true can't search PATH for .exe. Resolve
  // the absolute path once at detection time so the agent-loop can spawn
  // directly without cmd.exe (which imposes a ~32KB command-line limit).
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const r = spawnSync(cmd, [name], { stdio: ["ignore", "pipe", "pipe"], shell: false });
    if (r.status !== 0) return null;
    const out = r.stdout?.toString().trim().split(/\r?\n/)[0] ?? "";
    return out || null;
  } catch {
    return null;
  }
}

export function detectAvailableAgents(): DetectedAgent[] {
  const out: DetectedAgent[] = [];
  for (const def of AGENT_DEFS) {
    const detected = probe(def);
    if (detected) out.push(detected);
  }
  return out;
}

export function pickDefault(): DetectedAgent | null {
  const available = detectAvailableAgents();
  return available[0] ?? null;
}

function probe(def: RuntimeAgentDef): DetectedAgent | null {
  const envOverride = process.env[def.binEnvVar];
  const resolved = envOverride ?? resolveBinPath(def.bin);
  if (!resolved) return null;
  try {
    const r = spawnSync(resolved, def.versionArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      timeout: 5000,
    });
    if (r.status !== 0) return null;
    const version = (r.stdout?.toString() ?? "").trim().split("\n")[0] || null;
    return { def, binPath: resolved, version };
  } catch {
    return null;
  }
}
