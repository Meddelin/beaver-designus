import { claudeAgentDef } from "./defs/claude.ts";
import { qwenAgentDef } from "./defs/qwen.ts";
import { applyRuntimeOverrides } from "./load-overrides.ts";
import type { RuntimeAgentDef } from "./types.ts";

// v1 ships two adapters. Order = preference when multiple are available.
// Claude wins ties because the project itself ships via the Claude Code
// CLI ecosystem.
//
// Operators adapting a corporate fork DO NOT edit defs/qwen.ts or
// defs/claude.ts. They patch the runtime via manifest.config.json's
// `runtimes.<id>` block, which `applyRuntimeOverrides` merges on top of
// the built-in defs at module load. See `RuntimeOverride` in
// `packages/manifest/src/config-schema.ts` for the schema.
const BUILTIN_DEFS: RuntimeAgentDef[] = [claudeAgentDef, qwenAgentDef];
export const AGENT_DEFS: RuntimeAgentDef[] = applyRuntimeOverrides(BUILTIN_DEFS);

export function findAgentDef(id: string): RuntimeAgentDef | undefined {
  return AGENT_DEFS.find((d) => d.id === id);
}
