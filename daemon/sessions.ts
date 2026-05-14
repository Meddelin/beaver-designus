import { ulid } from "ulid";
import { spawnSync } from "node:child_process";
import type { SseEvent } from "../shared/types.ts";

export interface Session {
  id: string;
  projectId: string;
  subscribers: Set<(e: SseEvent) => void>;
  abort: AbortController | null;
  /** PID of the active spawned CLI, set by agent-loop. Used for tree-kill on
   *  Windows where AbortController's TerminateProcess only kills the direct
   *  child — Claude Code spawns its own MCP server subprocess that survives. */
  childPid: number | null;
  createdAt: number;
}

/** Force-kill a process tree by PID. Windows: `taskkill /T /F`. POSIX: send
 *  SIGKILL to the process group (negative pid). Non-fatal: failures are logged
 *  by the caller, not thrown — we already lost the channel. */
export function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
  }
}

const sessions = new Map<string, Session>();

export function createSession(projectId: string): Session {
  const session: Session = {
    id: ulid(),
    projectId,
    subscribers: new Set(),
    abort: null,
    childPid: null,
    createdAt: Date.now(),
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function broadcast(sessionId: string, event: SseEvent): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  for (const sub of s.subscribers) {
    try {
      sub(event);
    } catch {
      // subscriber probably disconnected; let the close handler clean up
    }
  }
}
