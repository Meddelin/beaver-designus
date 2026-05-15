import { describe, it, expect } from "vitest";
import { applySse, rehydrateMessages } from "../../../web/src/workspace/turn-model.ts";
import type { ChatMessage } from "../../../web/src/workspace/turn-model.ts";
import type { SseEvent } from "../../../shared/types.ts";

function fold(events: SseEvent[]): ChatMessage[] {
  return events.reduce<ChatMessage[]>((acc, e) => applySse(acc, e), []);
}

describe("turn-model — applySse (live agentic stream)", () => {
  it("folds reasoning → tools → answer into ONE assistant turn block", () => {
    const msgs = fold([
      { type: "status", phase: "start", data: { runtime: "qwen" } },
      { type: "status", phase: "agent-thinking", data: { text: "Let me " } },
      { type: "status", phase: "agent-thinking", data: { text: "plan." } },
      { type: "status", phase: "tool-call", data: { id: "c1", name: "placeComponent", input: { component: "x:y/PageShell" }, state: "running" } },
      { type: "status", phase: "tool-call", data: { id: "c1", state: "done", result: { nodeId: "n1" } } },
      { type: "status", phase: "agent-text", data: { text: "Готово" } },
      { type: "chat:message", role: "assistant", content: "Готово.", reasoning: "Let me plan." },
      { type: "status", phase: "end", data: { code: 0 } },
    ]);
    expect(msgs).toHaveLength(1);
    const a = msgs[0];
    expect(a.kind).toBe("assistant");
    expect(a.reasoning).toBe("Let me plan.");
    expect(a.reasoningActive).toBe(false);
    expect(a.content).toBe("Готово."); // final replaces streamed
    expect(a.live).toBe(false);
    expect(a.steps).toHaveLength(1);
    expect(a.steps![0]).toMatchObject({ id: "c1", name: "placeComponent", state: "done" });
    expect(a.steps![0].result).toEqual({ nodeId: "n1" });
  });

  it("updates a tool step in place by id (running → done)", () => {
    const msgs = fold([
      { type: "status", phase: "tool-call", data: { id: "c9", name: "setProp", input: { propName: "title" }, state: "running" } },
      { type: "status", phase: "tool-call", data: { id: "c9", state: "done", result: { ok: true } } },
    ]);
    expect(msgs[0].steps).toHaveLength(1);
    expect(msgs[0].steps![0].state).toBe("done");
    expect(msgs[0].steps![0].name).toBe("setProp"); // preserved from running event
  });

  it("marks reasoning done when the answer starts", () => {
    const msgs = fold([
      { type: "status", phase: "agent-thinking", data: { text: "hmm" } },
      { type: "status", phase: "agent-text", data: { text: "answer" } },
    ]);
    expect(msgs[0].reasoningActive).toBe(false);
    expect(msgs[0].reasoningEndedAt).toBeTypeOf("number");
  });

  it("tool error sets the step to error state", () => {
    const msgs = fold([
      { type: "status", phase: "tool-call", data: { id: "e1", name: "placeComponent", state: "running" } },
      { type: "status", phase: "tool-call", data: { id: "e1", state: "error", error: "unknown component" } },
    ]);
    expect(msgs[0].steps![0].state).toBe("error");
    expect(msgs[0].steps![0].error).toMatch(/unknown component/);
  });

  it("error event ends the live turn and appends an error row", () => {
    const msgs = fold([
      { type: "status", phase: "agent-text", data: { text: "partial" } },
      { type: "error", phase: "transport", message: "boom" },
    ]);
    expect(msgs[0].live).toBe(false);
    expect(msgs[1]).toMatchObject({ kind: "error", content: "boom" });
  });

  it("a fresh turn after finalize starts a NEW block", () => {
    let msgs = fold([
      { type: "status", phase: "agent-text", data: { text: "one" } },
      { type: "chat:message", role: "assistant", content: "one" },
    ]);
    msgs = applySse(msgs, { type: "status", phase: "agent-text", data: { text: "two" } });
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toBe("two");
    expect(msgs[1].live).toBe(true);
  });

  it("system chat:message becomes a system row", () => {
    const msgs = fold([{ type: "chat:message", role: "system", content: "note" }]);
    expect(msgs[0]).toMatchObject({ kind: "system", content: "note" });
  });
});

describe("turn-model — rehydrateMessages (reload grouping)", () => {
  it("groups tool calls into their owning assistant turn", () => {
    const msgs = rehydrateMessages(
      [
        { id: "m1", role: "user", content: "build", created_at: 1 },
        { id: "m2", role: "assistant", content: "done", reasoning: "thought", created_at: 5 },
      ],
      [
        { id: "t1", tool_name: "placeComponent", input: { component: "x:y/Z" }, output: { nodeId: "n" }, created_at: 3 },
        { id: "t2", tool_name: "finishPrototype", input: { summary: "s" }, output: { ok: true }, created_at: 4 },
      ]
    );
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ kind: "user", content: "build" });
    expect(msgs[1].kind).toBe("assistant");
    expect(msgs[1].reasoning).toBe("thought");
    expect(msgs[1].steps).toHaveLength(2);
    expect(msgs[1].steps!.every((s) => s.state === "done")).toBe(true);
  });

  it("flushes trailing tool calls with no following assistant message", () => {
    const msgs = rehydrateMessages(
      [{ id: "m1", role: "user", content: "x", created_at: 1 }],
      [{ id: "t1", tool_name: "placeComponent", input: {}, output: {}, created_at: 2 }]
    );
    expect(msgs).toHaveLength(2);
    expect(msgs[1].kind).toBe("assistant");
    expect(msgs[1].steps).toHaveLength(1);
  });
});
