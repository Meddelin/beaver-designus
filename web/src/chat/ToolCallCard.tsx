import * as React from "react";
import { motion } from "framer-motion";
import { ChevronRight, Wrench, CheckCircle2 } from "lucide-react";
import { cn } from "../lib/cn.ts";

export interface ToolCallEntry {
  id: string;
  name: string;
  /** placeComponent / setProp / removeNode / finishPrototype / getComponent */
  input?: Record<string, unknown> | unknown;
  output?: unknown;
}

/* Renders a Claude-style tool-use card. Collapsible, monospace input, soft border. */
export function ToolCallCard({ entry }: { entry: ToolCallEntry }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const summary = oneLineSummary(entry);
  const hasDetails = entry.input !== undefined || entry.output !== undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
      className={cn(
        "rounded-md border border-line bg-paper-2/70 px-3 py-2 max-w-full",
        "hover:border-line-strong transition-colors"
      )}
    >
      <button
        type="button"
        className={cn(
          "flex items-start gap-2 w-full text-left",
          hasDetails && "cursor-pointer"
        )}
        onClick={() => hasDetails && setExpanded((v) => !v)}
        disabled={!hasDetails}
      >
        <span className="mt-[2px] text-accent">
          {entry.output !== undefined ? <CheckCircle2 size={13} /> : <Wrench size={13} />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="font-mono text-[12px] text-ink-0">{entry.name}</span>
          <span className="font-mono text-[12px] text-ink-2">{" "}{summary}</span>
        </span>
        {hasDetails ? (
          <ChevronRight
            size={13}
            className={cn(
              "mt-[3px] text-ink-3 transition-transform duration-200",
              expanded && "rotate-90"
            )}
          />
        ) : null}
      </button>
      {expanded && hasDetails ? (
        <motion.pre
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18 }}
          className="mt-2 text-[11.5px] font-mono leading-relaxed text-ink-1 bg-paper-0 border border-line rounded-sm p-2 overflow-x-auto"
        >
{JSON.stringify(entry.output !== undefined ? entry.output : entry.input, null, 2)}
        </motion.pre>
      ) : null}
    </motion.div>
  );
}

function oneLineSummary(entry: ToolCallEntry): string {
  const v = entry.input;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.component === "string") return `→ ${o.component}`;
    if (typeof o.propName === "string") return `${o.propName}=${shortish(o.propValue)}`;
    if (typeof o.id === "string") return `${o.id}`;
    if (typeof o.nodeId === "string") return `node ${o.nodeId.slice(0, 8)}`;
    if (typeof o.summary === "string") return `"${truncate(o.summary, 60)}"`;
  }
  if (entry.output !== undefined) return "ok";
  return "";
}

function shortish(v: unknown): string {
  if (typeof v === "string") return `"${truncate(v, 40)}"`;
  try { return truncate(JSON.stringify(v) ?? "?", 40); } catch { return String(v); }
}
function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n) + "…" : s; }
