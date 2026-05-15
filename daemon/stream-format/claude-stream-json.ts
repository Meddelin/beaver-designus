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

export function createClaudeStreamHandler(
  session: Session,
  addText: (t: string) => void,
  addReasoning: (t: string) => void
): JsonStreamHandler {
  let buf = "";
  // Partial deltas (content_block_delta) re-arrive as a final `assistant`
  // block. Track what we streamed so the final block is still persisted
  // (addText/addReasoning) without re-broadcasting a duplicate to the UI.
  const seen = { textDelta: false, thinkingDelta: false };
  return {
    onChunk(chunk: string) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        dispatchLine(line, session, addText, addReasoning, seen);
      }
    },
    finalize() {
      if (buf.trim()) dispatchLine(buf.trim(), session, addText, addReasoning, seen);
      buf = "";
    },
  };
}

function dispatchLine(
  line: string,
  session: Session,
  addText: (t: string) => void,
  addReasoning: (t: string) => void,
  seen: { textDelta: boolean; thinkingDelta: boolean }
): void {
  let evt: any;
  try {
    evt = JSON.parse(line);
  } catch {
    broadcast(session.id, { type: "status", phase: "agent-text", data: { stderr: line } });
    return;
  }

  // Live partial streaming (`--include-partial-messages`):
  //   {type:"stream_event", event:{type:"content_block_delta",
  //     delta:{type:"text_delta",text} | {type:"thinking_delta",thinking}}}
  if (evt.type === "stream_event" && evt.event?.type === "content_block_delta") {
    const d = evt.event.delta ?? {};
    if (d.type === "text_delta" && typeof d.text === "string" && d.text) {
      seen.textDelta = true;
      addText(d.text);
      broadcast(session.id, { type: "status", phase: "agent-text", data: { text: d.text } });
    } else if (d.type === "thinking_delta" && typeof d.thinking === "string" && d.thinking) {
      seen.thinkingDelta = true;
      addReasoning(d.thinking);
      broadcast(session.id, { type: "status", phase: "agent-thinking", data: { text: d.thinking } });
    }
    return;
  }

  if (evt.type === "assistant" && evt.message?.content) {
    for (const part of evt.message.content) {
      if (part.type === "text" && typeof part.text === "string") {
        if (!seen.textDelta) {
          addText(part.text);
          broadcast(session.id, { type: "status", phase: "agent-text", data: { text: part.text } });
        }
      } else if (part.type === "thinking" && typeof part.thinking === "string") {
        if (!seen.thinkingDelta) {
          addReasoning(part.thinking);
          broadcast(session.id, { type: "status", phase: "agent-thinking", data: { text: part.thinking } });
        }
      } else if (part.type === "redacted_thinking") {
        broadcast(session.id, { type: "status", phase: "agent-thinking", data: { text: "[reasoning redacted]" } });
      }
      // tool_use is intentionally NOT broadcast here — the tool-call
      // timeline is driven uniformly by /internal/tool-call (fires for
      // every stream format incl. plain, and carries the real result).
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
