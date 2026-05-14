// `claude-stream-json` — Claude Code's --output-format stream-json line-based
// JSON. One JSON object per line; we split on newlines and dispatch by type.
//
// Shape per https://docs.claude.com/en/docs/agents-and-tools/agent-sdk/streaming-input :
//   {type: "system", subtype: "init", ...}
//   {type: "assistant", message: { content: [{type:"text",text}|{type:"tool_use",name,input}] }}
//   {type: "user",      message: { content: [{type:"tool_result", content}] }}
//   {type: "result",    subtype: "success", usage, ...}

import type { Session } from "../sessions.ts";
import { broadcast } from "../sessions.ts";

export interface JsonStreamHandler {
  /** Feed a raw stdout chunk; emits broadcasts as JSON-line events parse. */
  onChunk(chunk: string): void;
  /** Flush any remaining buffered line at process close. */
  finalize(): void;
}

export function createClaudeStreamHandler(session: Session, addText: (t: string) => void): JsonStreamHandler {
  let buf = "";
  return {
    onChunk(chunk: string) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        dispatchLine(line, session, addText);
      }
    },
    finalize() {
      if (buf.trim()) dispatchLine(buf.trim(), session, addText);
      buf = "";
    },
  };
}

function dispatchLine(line: string, session: Session, addText: (t: string) => void): void {
  let evt: any;
  try {
    evt = JSON.parse(line);
  } catch {
    broadcast(session.id, { type: "status", phase: "agent-text", data: { stderr: line } });
    return;
  }

  if (evt.type === "assistant" && evt.message?.content) {
    for (const part of evt.message.content) {
      if (part.type === "text" && typeof part.text === "string") {
        addText(part.text);
        broadcast(session.id, { type: "status", phase: "agent-text", data: { text: part.text } });
      } else if (part.type === "tool_use") {
        broadcast(session.id, {
          type: "status",
          phase: "tool-call",
          data: { name: part.name, input: part.input, id: part.id },
        });
      }
    }
    return;
  }

  if (evt.type === "user" && evt.message?.content) {
    for (const part of evt.message.content) {
      if (part.type === "tool_result") {
        broadcast(session.id, {
          type: "status",
          phase: "tool-call",
          data: { result: part.content, tool_use_id: part.tool_use_id, is_error: part.is_error ?? false },
        });
      }
    }
    return;
  }

  if (evt.type === "system" || evt.type === "result") {
    broadcast(session.id, { type: "status", phase: "agent-text", data: { meta: evt } });
    return;
  }

  // Unknown event type — pass through as diagnostic.
  broadcast(session.id, { type: "status", phase: "agent-text", data: { unknown: evt } });
}
