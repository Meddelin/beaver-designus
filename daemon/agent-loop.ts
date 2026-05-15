// Per-turn agent loop. Picks a RuntimeAgentDef, writes a per-session MCP
// config the CLI auto-connects to, spawns the CLI, pipes the prompt, parses
// the chosen streamFormat and re-emits structured events as SSE.

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { broadcast, type Session } from "./sessions.ts";
import { log } from "./log.ts";
import { loadPrototype, appendMessage } from "./projects-store.ts";
import { composeSystemPrompt } from "./prompt-composer.ts";
import { pickDefault, detectAvailableAgents } from "./runtimes/detection.ts";
import { findAgentDef } from "./runtimes/registry.ts";
import type { DetectedAgent, RuntimeAgentDef } from "./runtimes/types.ts";
import { createClaudeStreamHandler } from "./stream-format/claude-stream-json.ts";
import { createPlainStreamHandler } from "./stream-format/plain.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const DAEMON_PORT = Number(process.env.PORT ?? 7457);

const ALLOWED_TOOLS = [
  "mcp__beaver_designus__placeComponent",
  "mcp__beaver_designus__setProp",
  "mcp__beaver_designus__removeNode",
  "mcp__beaver_designus__finishPrototype",
  "mcp__beaver_designus__getComponent",
  "mcp__beaver_designus__getComponentUsage",
  "mcp__beaver_designus__insertSubtree",
];

export interface RunTurnArgs {
  session: Session;
  userMessage: string;
  /** Force a specific runtime id (e.g. "claude" / "qwen"). Default = first
   *  available. */
  runtimeId?: string;
}

export async function runTurn({ session, userMessage, runtimeId }: RunTurnArgs): Promise<void> {
  const detected = runtimeId ? findDetected(runtimeId) : pickDefault();
  if (!detected) {
    broadcast(session.id, {
      type: "error",
      phase: "transport",
      message: `No code-agent CLI detected on PATH. Install Claude Code (claude) or Qwen Code (qwen) and try again.`,
    });
    return;
  }

  const proto = loadPrototype(session.projectId);
  const systemPrompt = composeSystemPrompt(proto);

  const cwd = join(PROJECT_ROOT, ".beaver-designus", session.id);
  mkdirSync(cwd, { recursive: true });
  const mcpConfigPath = join(cwd, "mcp.json");
  const systemPromptFile = join(cwd, "system-prompt.md");
  const userMessageFile = join(cwd, "user-message.txt");
  writeFileSync(systemPromptFile, systemPrompt);
  writeFileSync(userMessageFile, userMessage);
  writeFileSync(
    mcpConfigPath,
    JSON.stringify(
      {
        mcpServers: {
          beaver_designus: {
            command: process.execPath,
            args: ["--import", "tsx", join(PROJECT_ROOT, "daemon", "mcp-tools-server.ts")],
            env: {
              BEAVER_DESIGNUS_DAEMON_URL: `http://127.0.0.1:${DAEMON_PORT}`,
              BEAVER_DESIGNUS_SESSION_ID: session.id,
              BEAVER_DESIGNUS_PROJECT_ID: session.projectId,
            },
          },
        },
      },
      null,
      2
    )
  );

  appendMessage(session.projectId, "user", userMessage);
  broadcast(session.id, {
    type: "status",
    phase: "start",
    data: { runtime: detected.def.id, version: detected.version },
  });

  const args = detected.def.buildArgs({
    mcpConfigPath,
    systemPrompt,
    systemPromptFile,
    userMessage,
    userMessageFile,
    allowedTools: ALLOWED_TOOLS,
  });

  const ac = new AbortController();
  session.abort = ac;

  // Build env for the spawned CLI. We strip Claude-Code-global toggles from
  // the host process env so the daemon-spawned claude.exe behaves
  // deterministically regardless of the host user's preferences (e.g.
  // CLAUDE_CODE_USE_POWERSHELL_TOOL=1 set globally for the user's interactive
  // Claude Code session must not leak into our headless run — even though
  // --print mode + restricted --allowedTools makes it functionally inert,
  // explicit > implicit).
  const childEnv: Record<string, string | undefined> = { ...process.env };
  delete childEnv.CLAUDE_CODE_USE_POWERSHELL_TOOL;
  childEnv.FORCE_COLOR = "0";
  childEnv.NO_COLOR = "1";

  const child = spawn(detected.binPath, args, {
    cwd,
    stdio: [detected.def.promptViaStdin ? "pipe" : "ignore", "pipe", "pipe"],
    // shell:false — we resolved the absolute binPath in detection.ts so we
    // can bypass cmd.exe and its argv-length limit.
    shell: false,
    signal: ac.signal,
    env: childEnv,
    // Detach into its own process group on POSIX so we can SIGKILL the whole
    // tree via -pid. Windows uses taskkill /T from sessions.ts.
    detached: process.platform !== "win32",
  });
  session.childPid = child.pid ?? null;
  log.info({ sessionId: session.id, pid: child.pid, runtime: detected.def.id }, "agent-loop: spawned");

  if (detected.def.promptViaStdin && child.stdin) {
    if (detected.def.id === "claude") {
      // Claude Code: system prompt is already piped via --append-system-prompt-file;
      // stdin carries the user message only (with --input-format text).
      child.stdin.write(userMessage);
    } else {
      // Qwen and other plain adapters: concatenate system + user since they
      // don't have a system-prompt separator.
      child.stdin.write(`${systemPrompt}\n\n---\n\n${userMessage}\n`);
    }
    child.stdin.end();
  }

  let assistantText = "";
  const addText = (t: string) => { assistantText += t; };

  const handler =
    detected.def.streamFormat === "claude-stream-json"
      ? createClaudeStreamHandler(session, addText)
      : createPlainStreamHandler(session, addText);

  child.stdout?.on("data", (chunk: Buffer) => {
    handler.onChunk(chunk.toString("utf8"));
  });

  let stderrBuf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
  });

  await new Promise<void>((resolve) => {
    child.on("close", (code) => {
      if ("finalize" in handler) handler.finalize();
      session.childPid = null;
      session.abort = null;
      if (stderrBuf.trim()) {
        broadcast(session.id, { type: "status", phase: "agent-text", data: { stderr: stderrBuf.trim() } });
      }
      if (assistantText.trim()) {
        appendMessage(session.projectId, "assistant", assistantText.trim());
        broadcast(session.id, { type: "chat:message", role: "assistant", content: assistantText.trim() });
      }
      broadcast(session.id, { type: "status", phase: "end", data: { code } });
      log.info({ sessionId: session.id, code }, "agent-loop: closed");
      resolve();
    });
    child.on("error", (err) => {
      log.error({ sessionId: session.id, err }, "agent-loop: child error");
      broadcast(session.id, { type: "error", phase: "transport", message: String(err.message ?? err) });
      resolve();
    });
  });
}

function findDetected(id: string): DetectedAgent | null {
  const def = findAgentDef(id);
  if (!def) return null;
  return detectAvailableAgents().find((d) => d.def.id === id) ?? null;
}

export function listAvailableRuntimes(): DetectedAgent[] {
  return detectAvailableAgents();
}
