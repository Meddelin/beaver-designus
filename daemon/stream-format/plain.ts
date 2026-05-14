// `plain` stream format — used by Qwen Code's --yolo mode.
// Every stdout chunk is a text delta; there are no structured tool-use events
// on stdout (tool calls go over MCP). We just relay text to the chat.

import type { Session } from "../sessions.ts";
import { broadcast } from "../sessions.ts";

export interface PlainStreamHandler {
  onChunk(chunk: string): void;
  finalize(): string;
}

export function createPlainStreamHandler(session: Session, addText: (t: string) => void): PlainStreamHandler {
  return {
    onChunk(chunk: string) {
      if (!chunk) return;
      addText(chunk);
      broadcast(session.id, { type: "status", phase: "agent-text", data: { text: chunk } });
    },
    finalize() {
      return "";
    },
  };
}
