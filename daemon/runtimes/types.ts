// Adopted from open-design's runtimes/types.ts pattern. Only the type +
// registry shape is lifted; we ship two adapters (Qwen + Claude) and a
// minimal detection probe. §9, §10.

export type StreamFormat = "plain" | "claude-stream-json";

export interface RuntimeAgentDef {
  /** Stable adapter id used for selection + telemetry. */
  id: string;
  /** Display name shown in status events. */
  displayName: string;
  /** Executable name resolved on PATH (or absolute path via env override). */
  bin: string;
  /** Env-var override to find the binary (e.g. CLAUDE_BIN, QWEN_BIN). */
  binEnvVar: string;
  /** Args used to probe `--version`. Failure → adapter is not available. */
  versionArgs: string[];
  /** Build the argv for a single turn. */
  buildArgs: (input: BuildArgsInput) => string[];
  /** How to parse stdout chunks. */
  streamFormat: StreamFormat;
  /** True → prompt is written to stdin; false → passed as a positional arg. */
  promptViaStdin: boolean;
}

export interface BuildArgsInput {
  mcpConfigPath: string;
  systemPrompt: string;
  /** Path to a file the daemon wrote the system prompt to. Some adapters
   *  (Claude Code) prefer a file path to avoid argv-length limits on
   *  Windows shells. */
  systemPromptFile: string;
  /** User message — passed positionally unless promptViaStdin is true. */
  userMessage: string;
  /** Path to a file the daemon wrote the user message to. */
  userMessageFile: string;
  /** MCP tool name allowlist that the CLI will forward to the model. */
  allowedTools: string[];
}

export interface DetectedAgent {
  def: RuntimeAgentDef;
  binPath: string;
  version: string | null;
}
