import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Sparkles, AlertTriangle } from "lucide-react";
import { Markdown } from "./Markdown.tsx";
import { ToolCallCard, type ToolCallEntry } from "./ToolCallCard.tsx";
import { StreamingCaret } from "./StreamingText.tsx";
import { Composer } from "./Composer.tsx";
import { Pill } from "../ui/primitives.tsx";
import { cn } from "../lib/cn.ts";

export interface ChatMessage {
  id: string;
  kind: "user" | "assistant" | "system" | "tool" | "error";
  content: string;
  tool?: ToolCallEntry;
}

export function ChatPane({
  messages,
  onSend,
  onCancel,
  status,
  composerRef,
}: {
  messages: ChatMessage[];
  onSend: (content: string) => void;
  onCancel: () => void;
  status: { phase: string; runtime?: string; version?: string | null } | null;
  composerRef?: React.RefObject<HTMLTextAreaElement>;
}): React.ReactElement {
  const transcriptRef = React.useRef<HTMLDivElement>(null);
  const busy = status?.phase === "starting" || status?.phase === "running";

  React.useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-paper-0">
      <div
        ref={transcriptRef}
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3.5"
      >
        {messages.length === 0 ? <EmptyHint /> : null}
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <MessageRow
              key={m.id}
              message={m}
              streaming={busy && i === messages.length - 1 && m.kind === "assistant"}
            />
          ))}
        </AnimatePresence>
      </div>

      <StatusBar status={status} onCancel={onCancel} />
      <Composer busy={busy} onSend={onSend} onCancel={onCancel} focusRef={composerRef} />
    </div>
  );
}

function EmptyHint(): React.ReactElement {
  return (
    <div className="my-auto py-10 px-4 text-center">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-md border border-line bg-paper-2 mb-3">
        <Sparkles size={16} className="text-accent" />
      </div>
      <p className="text-[13.5px] text-ink-1 max-w-[360px] mx-auto leading-relaxed">
        Describe a screen, section, or component to compose.
      </p>
      <p className="mt-2 text-[12px] text-ink-3 max-w-[400px] mx-auto italic">
        e.g. "a customer profile screen with top nav, four metric cards, and a New customer CTA"
      </p>
    </div>
  );
}

function MessageRow({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming: boolean;
}): React.ReactElement {
  if (message.kind === "tool" && message.tool) {
    return (
      <div className="pl-1">
        <ToolCallCard entry={message.tool} />
      </div>
    );
  }
  if (message.kind === "system") {
    return (
      <div className="text-[11.5px] text-ink-3 text-center font-mono uppercase tracking-widest py-1">
        {message.content}
      </div>
    );
  }
  if (message.kind === "error") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-2 rounded-md border border-state-danger/30 bg-state-danger/10 px-3 py-2 text-[13px] text-state-danger"
      >
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span className="whitespace-pre-wrap leading-relaxed">{message.content}</span>
      </motion.div>
    );
  }
  const isUser = message.kind === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
      className={cn(
        "flex gap-2.5 items-start",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <Avatar kind={isUser ? "user" : "assistant"} />
      <div
        className={cn(
          "max-w-[88%] rounded-lg border px-3 py-2 leading-relaxed",
          isUser
            ? "bg-accent/12 border-accent/30 text-ink-0 rounded-tr-sm"
            : "bg-paper-1 border-line text-ink-0 rounded-tl-sm"
        )}
      >
        {isUser ? (
          <p className="text-[13.5px] whitespace-pre-wrap m-0">{message.content}</p>
        ) : (
          <>
            <Markdown>{message.content}</Markdown>
            {streaming ? <StreamingCaret visible /> : null}
          </>
        )}
      </div>
    </motion.div>
  );
}

function Avatar({ kind }: { kind: "user" | "assistant" }): React.ReactElement {
  return (
    <div
      className={cn(
        "w-7 h-7 shrink-0 rounded-md border flex items-center justify-center mt-px",
        kind === "user"
          ? "bg-paper-2 border-line text-ink-1"
          : "bg-accent/12 border-accent/30 text-accent"
      )}
      aria-hidden
    >
      {kind === "user" ? <User size={13} /> : <Sparkles size={13} />}
    </div>
  );
}

function StatusBar({
  status,
  onCancel,
}: {
  status: { phase: string; runtime?: string; version?: string | null } | null;
  onCancel: () => void;
}): React.ReactElement {
  const phase = status?.phase ?? "idle";
  const busy = phase === "starting" || phase === "running";
  const tone: "neutral" | "accent" | "success" | "danger" =
    phase === "error" ? "danger" : phase === "idle" ? "neutral" : phase === "end" ? "success" : "accent";
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-t border-line bg-paper-1/60 backdrop-blur"
      aria-live="polite"
    >
      <Pill tone={tone}>
        {busy ? <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" /> : null}
        {phase}
      </Pill>
      {status?.runtime ? <Pill tone="neutral">runtime · {status.runtime}</Pill> : null}
      {status?.version ? (
        <span className="text-[10.5px] font-mono text-ink-3 tabular truncate max-w-[150px]" title={status.version ?? ""}>
          {status.version}
        </span>
      ) : null}
      <div className="flex-1" />
      {busy ? (
        <button
          onClick={onCancel}
          className="text-[11.5px] font-mono uppercase tracking-wider text-state-danger hover:underline underline-offset-4"
        >
          cancel
        </button>
      ) : null}
    </div>
  );
}
