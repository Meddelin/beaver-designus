import type { RuntimeAgentDef } from "../types.ts";

export const claudeAgentDef: RuntimeAgentDef = {
  id: "claude",
  displayName: "Claude Code",
  bin: process.platform === "win32" ? "claude.exe" : "claude",
  binEnvVar: "CLAUDE_BIN",
  versionArgs: ["--version"],
  streamFormat: "claude-stream-json",
  // Pass the user message via stdin. `--allowedTools <tools...>` is variadic
  // in commander.js — putting a positional prompt after it gets eaten as
  // another tool name (Claude Code 2.1.140). Stdin avoids that, and also
  // avoids any future argv-length issues with long messages.
  promptViaStdin: true,
  buildArgs: ({ mcpConfigPath, systemPromptFile, allowedTools }) => [
    "--print",
    "--output-format",
    "stream-json",
    "--input-format",
    "text",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
    "--mcp-config",
    mcpConfigPath,
    "--append-system-prompt-file",
    systemPromptFile,
    "--allowedTools",
    allowedTools.join(","),
  ],
};
