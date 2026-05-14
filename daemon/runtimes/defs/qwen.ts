import type { RuntimeAgentDef } from "../types.ts";

// Per [open-design/apps/daemon/src/runtimes/defs/qwen.ts:4-27] — Qwen Code
// fork uses `qwen --yolo -` and reads the prompt from stdin. v1 wires the
// adapter but Claude wins ties when both are available.

export const qwenAgentDef: RuntimeAgentDef = {
  id: "qwen",
  displayName: "Qwen Code",
  bin: process.platform === "win32" ? "qwen.exe" : "qwen",
  binEnvVar: "QWEN_BIN",
  versionArgs: ["--version"],
  streamFormat: "plain",
  promptViaStdin: true,
  buildArgs: ({ mcpConfigPath }) => [
    "--yolo",
    "--mcp-config",
    mcpConfigPath,
    "-",
  ],
};
