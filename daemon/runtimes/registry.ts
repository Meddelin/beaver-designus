import { claudeAgentDef } from "./defs/claude.ts";
import { qwenAgentDef } from "./defs/qwen.ts";
import type { RuntimeAgentDef } from "./types.ts";

// v1 ships two adapters. Order = preference when multiple are available.
// Claude wins ties because the user is most likely to have Claude Code
// installed (the project itself ships via the Claude Code CLI ecosystem).
export const AGENT_DEFS: RuntimeAgentDef[] = [claudeAgentDef, qwenAgentDef];

export function findAgentDef(id: string): RuntimeAgentDef | undefined {
  return AGENT_DEFS.find((d) => d.id === id);
}
