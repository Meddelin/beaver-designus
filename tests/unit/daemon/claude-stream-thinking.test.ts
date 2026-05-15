import { describe, it, expect } from "vitest";
import { createSession } from "../../../daemon/sessions.ts";
import { createClaudeStreamHandler } from "../../../daemon/stream-format/claude-stream-json.ts";
import type { SseEvent } from "../../../shared/types.ts";

function harness() {
  const s = createSession("p-" + Math.random());
  const events: SseEvent[] = [];
  s.subscribers.add((e) => events.push(e));
  let text = "";
  let reasoning = "";
  const h = createClaudeStreamHandler(
    s,
    (t) => (text += t),
    (t) => (reasoning += t)
  );
  return { h, events, getText: () => text, getReasoning: () => reasoning };
}
const line = (o: unknown) => JSON.stringify(o) + "\n";

describe("claude-stream-json — reasoning + dedupe + no tool broadcast", () => {
  it("emits agent-thinking for a thinking content block", () => {
    const { h, events, getReasoning } = harness();
    h.onChunk(line({ type: "assistant", message: { content: [{ type: "thinking", thinking: "I will plan." }] } }));
    expect(events.some((e) => e.type === "status" && e.phase === "agent-thinking")).toBe(true);
    expect(getReasoning()).toBe("I will plan.");
  });

  it("streams thinking_delta then DEDUPES the final thinking block", () => {
    const { h, events, getReasoning } = harness();
    h.onChunk(line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "ab" } } }));
    h.onChunk(line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "cd" } } }));
    h.onChunk(line({ type: "assistant", message: { content: [{ type: "thinking", thinking: "abcd" }] } }));
    const thinkings = events.filter((e) => e.type === "status" && e.phase === "agent-thinking");
    expect(thinkings).toHaveLength(2); // only the two deltas, not the final block
    expect(getReasoning()).toBe("abcd"); // accumulated once
  });

  it("streams text_delta then dedupes the final text block (no double persist)", () => {
    const { h, events, getText } = harness();
    h.onChunk(line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } }));
    h.onChunk(line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } }));
    h.onChunk(line({ type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } }));
    expect(getText()).toBe("Hello");
    const texts = events.filter((e) => e.type === "status" && e.phase === "agent-text");
    expect(texts).toHaveLength(2);
  });

  it("does NOT broadcast tool-call from stdout (timeline owned by /internal/tool-call)", () => {
    const { h, events } = harness();
    h.onChunk(
      line({ type: "assistant", message: { content: [{ type: "tool_use", name: "placeComponent", input: {}, id: "x" }] } })
    );
    expect(events.some((e) => e.type === "status" && e.phase === "tool-call")).toBe(false);
  });

  it("redacted_thinking surfaces a placeholder", () => {
    const { h, events } = harness();
    h.onChunk(line({ type: "assistant", message: { content: [{ type: "redacted_thinking", data: "xx" }] } }));
    const t = events.find((e) => e.type === "status" && e.phase === "agent-thinking") as any;
    expect(t?.data?.text).toMatch(/redacted/i);
  });
});
