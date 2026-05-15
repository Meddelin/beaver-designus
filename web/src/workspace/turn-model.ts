// Pure turn model for the agentic activity stream. SSE events + persisted
// history fold into a flat ChatMessage[] where each assistant turn is ONE
// coherent block: streaming reasoning → interleaved tool steps → answer
// (Claude/Cursor-style inline). Kept pure + framework-free so it's
// unit-testable without React (the established "logic in its own module"
// discipline).

import type { SseEvent } from "@shared/types.ts";

export interface ToolStep {
  id: string;
  name: string;
  input?: unknown;
  state: "running" | "done" | "error";
  result?: unknown;
  error?: string;
}

export interface ChatMessage {
  id: string;
  kind: "user" | "assistant" | "system" | "error";
  content: string;
  /** assistant only — model extended-thinking text. */
  reasoning?: string;
  /** assistant only — true while reasoning is still streaming. */
  reasoningActive?: boolean;
  /** assistant only — epoch ms the turn block was created (for "Thought for Ns"). */
  startedAt?: number;
  /** assistant only — epoch ms reasoning finished (answer/tool started or turn ended). */
  reasoningEndedAt?: number;
  /** assistant only — interleaved tool-call steps for this turn. */
  steps?: ToolStep[];
  /** assistant only — true while this turn is still streaming (not finalized). */
  live?: boolean;
}

let _seq = 0;
function genId(prefix: string): string {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq}`;
}

function lastLiveIndex(msgs: ChatMessage[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].kind === "assistant" && msgs[i].live) return i;
  }
  return -1;
}

/* Ensure a live assistant turn block exists; returns [next array, index]. */
function ensureLive(msgs: ChatMessage[]): [ChatMessage[], number] {
  const idx = lastLiveIndex(msgs);
  if (idx >= 0) return [msgs, idx];
  const block: ChatMessage = {
    id: genId("a"),
    kind: "assistant",
    content: "",
    reasoning: "",
    reasoningActive: false,
    startedAt: Date.now(),
    steps: [],
    live: true,
  };
  return [[...msgs, block], msgs.length];
}

function patch(msgs: ChatMessage[], idx: number, p: Partial<ChatMessage>): ChatMessage[] {
  const next = msgs.slice();
  next[idx] = { ...next[idx], ...p };
  return next;
}

/* Fold one SSE event into the message list. Pure. */
export function applySse(msgs: ChatMessage[], e: SseEvent): ChatMessage[] {
  if (e.type === "chat:message") {
    if (e.role === "system") {
      return [...msgs, { id: genId("s"), kind: "system", content: e.content }];
    }
    // Final assistant text is authoritative — replace any streamed partial
    // so partial-vs-final drift self-corrects; keep streamed reasoning
    // unless the event carries its own.
    const [m, idx] = ensureLive(msgs);
    return patch(m, idx, {
      content: e.content,
      reasoning: e.reasoning ?? m[idx].reasoning,
      reasoningActive: false,
      reasoningEndedAt: m[idx].reasoningEndedAt ?? Date.now(),
      live: false,
    });
  }

  if (e.type === "error") {
    const cleared = msgs.map((x) => (x.live ? { ...x, live: false, reasoningActive: false } : x));
    return [...cleared, { id: genId("e"), kind: "error", content: e.message }];
  }

  if (e.type !== "status") return msgs;

  if (e.phase === "agent-thinking" && typeof e.data?.text === "string") {
    const [m, idx] = ensureLive(msgs);
    return patch(m, idx, {
      reasoning: (m[idx].reasoning ?? "") + e.data.text,
      reasoningActive: true,
    });
  }

  if (e.phase === "agent-text" && typeof e.data?.text === "string") {
    const [m, idx] = ensureLive(msgs);
    const wasReasoning = m[idx].reasoningActive;
    return patch(m, idx, {
      content: (m[idx].content ?? "") + e.data.text,
      reasoningActive: false,
      reasoningEndedAt: wasReasoning ? Date.now() : m[idx].reasoningEndedAt,
    });
  }

  if (e.phase === "tool-call" && e.data?.id && e.data?.state) {
    const [m, idx] = ensureLive(msgs);
    const steps = (m[idx].steps ?? []).slice();
    const sIdx = steps.findIndex((s) => s.id === e.data.id);
    const incoming: ToolStep = {
      id: e.data.id,
      name: e.data.name ?? (sIdx >= 0 ? steps[sIdx].name : "tool"),
      input: e.data.input ?? (sIdx >= 0 ? steps[sIdx].input : undefined),
      state: e.data.state,
      result: e.data.result,
      error: e.data.error,
    };
    if (sIdx >= 0) steps[sIdx] = { ...steps[sIdx], ...incoming };
    else steps.push(incoming);
    // First tool implies reasoning (if any) is done.
    const wasReasoning = m[idx].reasoningActive;
    return patch(m, idx, {
      steps,
      reasoningActive: false,
      reasoningEndedAt: wasReasoning ? Date.now() : m[idx].reasoningEndedAt,
    });
  }

  if (e.phase === "end") {
    const i = lastLiveIndex(msgs);
    if (i < 0) return msgs;
    return patch(msgs, i, {
      live: false,
      reasoningActive: false,
      reasoningEndedAt: msgs[i].reasoningEndedAt ?? Date.now(),
    });
  }

  return msgs;
}

interface HistMsg {
  id: string;
  role: string;
  content: string;
  reasoning?: string | null;
  created_at: number;
}
interface HistTool {
  id: string;
  tool_name: string;
  input: unknown;
  output: unknown;
  created_at: number;
}

/* Rebuild the transcript from persisted history: tool calls between the
 * previous assistant message and the next one belong to that turn block
 * (so reload mirrors the live inline layout). */
export function rehydrateMessages(history: HistMsg[], toolCalls: HistTool[]): ChatMessage[] {
  type Item =
    | { t: "msg"; at: number; m: HistMsg }
    | { t: "tool"; at: number; c: HistTool };
  const items: Item[] = [
    ...history.map((m) => ({ t: "msg" as const, at: m.created_at, m })),
    ...toolCalls.map((c) => ({ t: "tool" as const, at: c.created_at, c })),
  ].sort((a, b) => a.at - b.at);

  const out: ChatMessage[] = [];
  let pending: ToolStep[] = [];
  const flushOrphans = () => {
    if (pending.length) {
      out.push({ id: genId("a"), kind: "assistant", content: "", steps: pending, live: false });
      pending = [];
    }
  };

  for (const it of items) {
    if (it.t === "tool") {
      pending.push({
        id: it.c.id,
        name: it.c.tool_name,
        input: it.c.input,
        state: "done",
        result: it.c.output,
      });
      continue;
    }
    const m = it.m;
    if (m.role === "assistant") {
      out.push({
        id: m.id,
        kind: "assistant",
        content: m.content,
        reasoning: m.reasoning ?? undefined,
        reasoningActive: false,
        steps: pending,
        live: false,
      });
      pending = [];
    } else if (m.role === "user") {
      flushOrphans();
      out.push({ id: m.id, kind: "user", content: m.content });
    } else {
      flushOrphans();
      out.push({ id: m.id, kind: "system", content: m.content });
    }
  }
  flushOrphans();
  return out;
}
