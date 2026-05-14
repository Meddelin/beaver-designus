import * as React from "react";
import { motion } from "framer-motion";
import { ZoomIn, ZoomOut, Maximize2, Grid as GridIcon, Sparkles } from "lucide-react";
import { PrototypeRender } from "@preview/render.tsx";
import { IconButton, Pill } from "../ui/primitives.tsx";
import { cn } from "../lib/cn.ts";
import { shortRev } from "../lib/format.ts";
import { NodeFocusOverlay } from "./NodeFocusOverlay.tsx";
import type { Prototype, PrototypeNode } from "@shared/types.ts";

const ZOOM_LEVELS = [0.5, 0.66, 0.75, 0.85, 1.0, 1.15, 1.3, 1.5, 1.75];

export function PreviewPane({
  prototype,
  onNodeClick,
  focusedNodeId,
  manifestRev,
}: {
  prototype: Prototype;
  onNodeClick: (nodeId: string, component: string) => void;
  focusedNodeId: string | null;
  manifestRev?: string | null;
}): React.ReactElement {
  const [zoomIdx, setZoomIdx] = React.useState(4);
  const zoom = ZOOM_LEVELS[zoomIdx];
  const [grid, setGrid] = React.useState(true);
  const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null);
  const surfaceRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "=" || e.key === "+") { e.preventDefault(); setZoomIdx((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1)); }
      else if (e.key === "-") { e.preventDefault(); setZoomIdx((i) => Math.max(0, i - 1)); }
      else if (e.key === "0") { e.preventDefault(); setZoomIdx(4); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Build a flat node-id → component id map for the overlay labels.
  const labelMap = React.useMemo(() => {
    const m = new Map<string, string>();
    const walk = (n: PrototypeNode | null) => {
      if (!n) return;
      m.set(n.nodeId, n.component);
      n.children?.forEach(walk);
      if (n.slots) for (const arr of Object.values(n.slots) as PrototypeNode[][]) arr.forEach(walk);
    };
    walk(prototype.root);
    return m;
  }, [prototype]);

  const labelFor = React.useCallback((nodeId: string) => {
    const id = labelMap.get(nodeId);
    if (!id) return undefined;
    const parts = id.split("/");
    return parts[parts.length - 1];
  }, [labelMap]);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    let el = e.target as HTMLElement | null;
    while (el && !el.hasAttribute("data-node-id")) {
      if (el === e.currentTarget) { el = null; break; }
      el = el.parentElement;
    }
    const next = el?.getAttribute("data-node-id") ?? null;
    setHoveredNodeId(next);
  };

  return (
    <div className={cn(
      "relative flex flex-col h-full min-h-0 bg-paper-1",
      grid && "dotted-grid"
    )}>
      <div className="absolute top-3 left-3 z-30 flex items-center gap-1.5">
        <Pill tone="accent" className="bg-paper-1/85 backdrop-blur border-accent/40">
          <Sparkles size={9} /> Generated · rev {shortRev(manifestRev, 6)}
        </Pill>
      </div>
      <div className="absolute top-3 right-3 z-30 flex items-center gap-1 rounded-md bg-paper-1/85 border border-line backdrop-blur p-1">
        <IconButton variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}>
          <ZoomOut size={13} />
        </IconButton>
        <button
          className="px-2 h-7 text-[11px] font-mono tabular text-ink-1 hover:text-ink-0"
          onClick={() => setZoomIdx(4)}
          aria-label="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => setZoomIdx((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))}>
          <ZoomIn size={13} />
        </IconButton>
        <div className="w-px h-4 bg-line mx-0.5" />
        <IconButton variant="ghost" size="icon-sm" aria-label="Toggle grid" onClick={() => setGrid((v) => !v)}>
          <GridIcon size={13} className={grid ? "text-accent" : "text-ink-3"} />
        </IconButton>
      </div>

      <div
        ref={surfaceRef}
        className="relative flex-1 min-h-0 overflow-auto"
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoveredNodeId(null)}
      >
        {!prototype.root ? (
          <PreviewEmpty />
        ) : (
          <>
            <div className="min-h-full flex justify-center items-stretch pt-12 pb-10 px-6">
              {/* No motion wrapper here — silent re-renders on revision bumps so
                  prop edits don't trigger a fade-in/fade-out cycle across the
                  whole prototype. The overlay handles focus/hover transitions. */}
              <div
                className="w-full max-w-[1280px] flex flex-col"
                style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
              >
                <div className="flex-1 flex flex-col rounded-xl border border-line bg-paper-1 shadow-elev-2 overflow-hidden">
                  {/* Browser-frame chrome */}
                  <div className="h-7 shrink-0 flex items-center gap-1.5 px-3 border-b border-line bg-paper-2">
                    <span className="w-2 h-2 rounded-full bg-ink-5" />
                    <span className="w-2 h-2 rounded-full bg-ink-5" />
                    <span className="w-2 h-2 rounded-full bg-ink-5" />
                    <span className="ml-3 text-[10.5px] font-mono uppercase tracking-widest text-ink-3">prototype · 1280×auto</span>
                  </div>
                  {/* Page surface — fills remaining frame height so a real-page feel */}
                  <div className="flex-1 bg-[var(--paper-1)] min-h-[640px]">
                    <PrototypeRender
                      node={prototype.root}
                      onNodeClick={onNodeClick}
                      focusedNodeId={null}
                    />
                  </div>
                </div>
              </div>
            </div>
            <NodeFocusOverlay
              containerRef={surfaceRef}
              focusedNodeId={focusedNodeId}
              hoveredNodeId={hoveredNodeId}
              labelFor={labelFor}
              revision={prototype.revision}
              zoom={zoom}
            />
          </>
        )}
      </div>
    </div>
  );
}

function PreviewEmpty(): React.ReactElement {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      <div className="w-14 h-14 rounded-md border border-line bg-paper-1 flex items-center justify-center mb-4">
        <Maximize2 size={20} className="text-ink-3" />
      </div>
      <p className="text-[14px] text-ink-1 font-medium">Preview is empty</p>
      <p className="mt-1 text-[12.5px] text-ink-3 max-w-[340px]">
        Send a message to the agent — the rendered prototype will appear here in
        real-time as components are placed.
      </p>
    </div>
  );
}
