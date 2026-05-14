import * as React from "react";
import { cn } from "../lib/cn.ts";

const STORAGE_KEY = "bd.split.chat-pct";

/** Custom split pane: horizontal flex with a draggable divider.
 *  Persists chat percentage to localStorage. */
export function SplitPane({
  left,
  right,
  leftMinPct = 26,
  leftMaxPct = 64,
  leftDefaultPct = 42,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  leftMinPct?: number;
  leftMaxPct?: number;
  leftDefaultPct?: number;
}): React.ReactElement {
  const [leftPct, setLeftPct] = React.useState<number>(() => {
    if (typeof window === "undefined") return leftDefaultPct;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= leftMinPct && n <= leftMaxPct ? n : leftDefaultPct;
  });
  const containerRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);

  React.useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(leftPct));
  }, [leftPct]);

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(leftMinPct, Math.min(leftMaxPct, pct));
      setLeftPct(clamped);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [leftMinPct, leftMaxPct]);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div ref={containerRef} className="flex h-full min-h-0 relative">
      <div style={{ width: `${leftPct}%` }} className="h-full min-w-[320px]">
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onDividerMouseDown}
        className={cn(
          "relative w-px shrink-0 bg-line hover:bg-accent/60 active:bg-accent transition-colors cursor-col-resize",
          "after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5 after:content-['']"
        )}
        aria-label="Resize chat / preview"
      />
      <div className="flex-1 h-full min-w-0">{right}</div>
    </div>
  );
}
