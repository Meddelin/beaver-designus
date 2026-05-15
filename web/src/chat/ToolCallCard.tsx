import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Check, X, Loader2 } from "lucide-react";
import { cn } from "../lib/cn.ts";
import type { ToolStep } from "../workspace/turn-model.ts";

/* Vertical agent build-timeline (v0/Bolt-style), inline in the chat turn.
 * One row per tool call: status icon, humanized title + one-line summary,
 * collapsible args/result, connected by a rail. */
export function ToolTimeline({ steps }: { steps: ToolStep[] }): React.ReactElement {
  return (
    <div className="flex flex-col">
      {steps.map((s, i) => (
        <StepRow key={s.id} step={s} first={i === 0} last={i === steps.length - 1} />
      ))}
    </div>
  );
}

function StepRow({
  step,
  first,
  last,
}: {
  step: ToolStep;
  first: boolean;
  last: boolean;
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const hasDetails = step.input !== undefined || step.result !== undefined || Boolean(step.error);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
      className="flex gap-2"
    >
      {/* rail + node */}
      <div className="flex flex-col items-center w-4 shrink-0">
        <span className={cn("w-px flex-1", first ? "bg-transparent" : "bg-line")} />
        <StatusDot state={step.state} />
        <span className={cn("w-px flex-1", last ? "bg-transparent" : "bg-line")} />
      </div>

      <div className="flex-1 min-w-0 py-0.5">
        <button
          type="button"
          onClick={() => hasDetails && setExpanded((v) => !v)}
          disabled={!hasDetails}
          className={cn("flex items-start gap-1.5 w-full text-left", hasDetails && "cursor-pointer")}
        >
          <span className="flex-1 min-w-0 leading-snug">
            <span
              className={cn(
                "text-[12px] font-medium",
                step.state === "error" ? "text-state-danger" : "text-ink-1"
              )}
            >
              {humanize(step.name)}
            </span>
            <span className="text-[12px] text-ink-3 font-mono">{" "}{summarize(step)}</span>
          </span>
          {hasDetails ? (
            <ChevronRight
              size={12}
              className={cn(
                "mt-[3px] shrink-0 text-ink-3 transition-transform duration-200",
                expanded && "rotate-90"
              )}
            />
          ) : null}
        </button>
        <AnimatePresence initial={false}>
          {expanded && hasDetails ? (
            <motion.pre
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.16 }}
              className="mt-1.5 mb-1 text-[11px] font-mono leading-relaxed text-ink-2 bg-paper-0 border border-line rounded-sm p-2 overflow-x-auto"
            >
{step.error
  ? step.error
  : JSON.stringify(step.result !== undefined ? step.result : step.input, null, 2)}
            </motion.pre>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function StatusDot({ state }: { state: ToolStep["state"] }): React.ReactElement {
  if (state === "running") {
    return (
      <span className="w-[18px] h-[18px] rounded-full border border-accent/40 bg-paper-1 flex items-center justify-center text-accent">
        <Loader2 size={11} className="animate-spin" />
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="w-[18px] h-[18px] rounded-full border border-state-danger/50 bg-state-danger/10 flex items-center justify-center text-state-danger">
        <X size={11} />
      </span>
    );
  }
  return (
    <span className="w-[18px] h-[18px] rounded-full border border-accent/40 bg-accent/15 flex items-center justify-center text-accent">
      <Check size={11} />
    </span>
  );
}

const TITLES: Record<string, string> = {
  placeComponent: "Place",
  insertSubtree: "Insert subtree",
  setProp: "Set prop",
  removeNode: "Remove",
  finishPrototype: "Finish",
  getComponent: "Inspect",
  getComponentUsage: "Fetch example",
};
function humanize(name: string): string {
  return TITLES[name] ?? name;
}

function summarize(step: ToolStep): string {
  const v = step.input;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.component === "string") return shortId(o.component);
    if (typeof o.id === "string") return shortId(o.id);
    if (typeof o.propName === "string") return `${o.propName} = ${short(o.propValue)}`;
    if (o.tree && typeof o.tree === "object") {
      const c = (o.tree as Record<string, unknown>).component;
      if (typeof c === "string") return shortId(c);
    }
    if (typeof o.nodeId === "string") return `node ${String(o.nodeId).slice(0, 8)}`;
    if (typeof o.summary === "string") return `"${truncate(o.summary, 56)}"`;
  }
  if (step.state === "running") return "…";
  return "";
}

function shortId(id: string): string {
  // beaver:@beaver-ui/page-shell/PageShell → PageShell
  const tail = id.split("/").pop() ?? id;
  return tail;
}
function short(v: unknown): string {
  if (typeof v === "string") return `"${truncate(v, 32)}"`;
  try {
    return truncate(JSON.stringify(v) ?? "?", 32);
  } catch {
    return String(v);
  }
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
