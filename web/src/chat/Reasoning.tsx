import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronRight, Brain } from "lucide-react";
import { cn } from "../lib/cn.ts";

/* Claude/ChatGPT-style reasoning disclosure: streams live while the model
 * thinks (auto-expanded, ticking timer, shimmer), then collapses to
 * "Thought for Ns" once the answer/tool starts — click to re-expand. */
export function ReasoningDisclosure({
  text,
  active,
  startedAt,
  endedAt,
}: {
  text: string;
  active: boolean;
  startedAt?: number;
  endedAt?: number;
}): React.ReactElement {
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(active);
  const [userToggled, setUserToggled] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  // Auto: follow `active` until the user takes manual control.
  React.useEffect(() => {
    if (!userToggled) setOpen(active);
  }, [active, userToggled]);

  // Live elapsed tick while thinking.
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(force, 500);
    return () => clearInterval(t);
  }, [active]);

  // Keep the streaming reasoning scrolled to the latest line.
  React.useEffect(() => {
    if (open && active && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, open, active]);

  const seconds = elapsedSeconds(startedAt, endedAt, active);
  const label = active ? "Reasoning" : seconds != null ? `Thought for ${seconds}s` : "Reasoning";

  return (
    <div className="rounded-md border border-line bg-paper-2/40">
      <button
        type="button"
        onClick={() => {
          setUserToggled(true);
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1.5 w-full text-left px-2.5 py-1.5 text-[11.5px] font-mono text-ink-3 hover:text-ink-2 transition-colors"
      >
        <Brain size={12} className={cn(active && !reduced && "animate-pulse text-accent")} />
        <span className={cn(active && "text-ink-2")}>{label}</span>
        {active ? (
          <span className="inline-flex gap-[3px] ml-0.5" aria-hidden>
            <Dot reduced={reduced} d={0} />
            <Dot reduced={reduced} d={0.15} />
            <Dot reduced={reduced} d={0.3} />
          </span>
        ) : null}
        <ChevronRight
          size={12}
          className={cn("ml-auto transition-transform duration-200", open && "rotate-90")}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div
              ref={bodyRef}
              className="mx-2.5 mb-2 max-h-[260px] overflow-y-auto border-l-2 border-accent/40 pl-3 py-1 text-[12px] leading-relaxed text-ink-2 font-mono whitespace-pre-wrap"
            >
              {text}
              {active ? <span className="caret-bar align-text-bottom ml-[1px]" aria-hidden /> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Dot({ reduced, d }: { reduced: boolean | null; d: number }): React.ReactElement {
  return (
    <span
      className={cn("w-1 h-1 rounded-full bg-accent", !reduced && "animate-pulse")}
      style={reduced ? { opacity: 0.6 } : { animationDelay: `${d}s` }}
    />
  );
}

function elapsedSeconds(startedAt?: number, endedAt?: number, active?: boolean): number | null {
  if (!startedAt) return null;
  const end = active ? Date.now() : endedAt ?? Date.now();
  return Math.max(0, Math.round((end - startedAt) / 1000));
}
