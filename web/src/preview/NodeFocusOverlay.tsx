import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* Resolves the rendered DOM rectangle of a node id within a container.
 * Walks descendants of [data-node-id="<id>"] to find the deepest non-zero box. */
function getNodeRect(container: HTMLElement, nodeId: string): Rect | null {
  const wrapper = container.querySelector<HTMLElement>(`[data-node-id="${cssEscape(nodeId)}"]`);
  if (!wrapper) return null;
  // The wrapper itself has display:contents (0×0 bounds); pull bounds from
  // the union of its rendered children.
  let best: DOMRect | null = null;
  const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_ELEMENT);
  let n: Node | null = walker.currentNode;
  while (n) {
    const el = n as HTMLElement;
    if (el !== wrapper) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        if (!best) best = DOMRect.fromRect(r);
        else {
          const x1 = Math.min(best.left, r.left);
          const y1 = Math.min(best.top, r.top);
          const x2 = Math.max(best.right, r.right);
          const y2 = Math.max(best.bottom, r.bottom);
          best = DOMRect.fromRect({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
        }
      }
    }
    n = walker.nextNode();
  }
  if (!best) return null;
  const cr = container.getBoundingClientRect();
  return {
    x: best.left - cr.left + container.scrollLeft,
    y: best.top - cr.top + container.scrollTop,
    w: best.width,
    h: best.height,
  };
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return s.replace(/(["\\])/g, "\\$1");
}

export interface NodeFocusOverlayProps {
  containerRef: React.RefObject<HTMLElement>;
  /** Currently focused/selected node — drawn as a solid ring. */
  focusedNodeId: string | null;
  /** Hovered node — drawn as a dashed ring. */
  hoveredNodeId: string | null;
  /** Resolve component label for a node id (drawn as a chip above the box). */
  labelFor?: (nodeId: string) => string | undefined;
  /** Bumps any time the underlying tree changes so we recompute. */
  revision?: number;
  /** Bumps when zoom level changes so we recompute. */
  zoom?: number;
}

export function NodeFocusOverlay({
  containerRef,
  focusedNodeId,
  hoveredNodeId,
  labelFor,
  revision = 0,
  zoom = 1,
}: NodeFocusOverlayProps): React.ReactElement {
  const [focused, setFocused] = React.useState<Rect | null>(null);
  const [hovered, setHovered] = React.useState<Rect | null>(null);

  const recompute = React.useCallback(() => {
    const c = containerRef.current;
    if (!c) { setFocused(null); setHovered(null); return; }
    setFocused(focusedNodeId ? getNodeRect(c, focusedNodeId) : null);
    setHovered(hoveredNodeId && hoveredNodeId !== focusedNodeId ? getNodeRect(c, hoveredNodeId) : null);
  }, [containerRef, focusedNodeId, hoveredNodeId]);

  React.useLayoutEffect(() => {
    recompute();
  }, [recompute, revision, zoom]);

  React.useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(c);
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [containerRef, recompute]);

  const focusedLabel = focusedNodeId && labelFor ? labelFor(focusedNodeId) : undefined;
  const hoveredLabel = hoveredNodeId && labelFor ? labelFor(hoveredNodeId) : undefined;

  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
      <AnimatePresence>
        {hovered ? (
          <motion.div
            key={`h-${hoveredNodeId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.08 }}
            className="absolute rounded-[3px] border-[1.5px] border-dashed border-accent shadow-[0_0_0_4px_var(--accent-glow)]"
            style={{ left: hovered.x - 2, top: hovered.y - 2, width: hovered.w + 4, height: hovered.h + 4 }}
          >
            {hoveredLabel ? (
              <span className="absolute -top-[18px] left-0 px-1.5 h-[16px] flex items-center text-[10px] font-mono uppercase tracking-wider bg-accent text-[var(--accent-contrast)] rounded-[3px] whitespace-nowrap font-medium">
                {hoveredLabel}
              </span>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {focused ? (
          <motion.div
            key={`f-${focusedNodeId}`}
            initial={{ opacity: 0, scale: 1.03 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="absolute rounded-[3px] border-[1.5px] border-accent shadow-[0_0_0_6px_var(--accent-glow)]"
            style={{ left: focused.x - 2, top: focused.y - 2, width: focused.w + 4, height: focused.h + 4 }}
          >
            {focusedLabel ? (
              <span className="absolute -top-[20px] left-0 px-1.5 h-[18px] flex items-center gap-1 text-[10.5px] font-mono uppercase tracking-wider bg-accent text-[var(--accent-contrast)] rounded-[3px] whitespace-nowrap font-medium">
                {focusedLabel}
              </span>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
