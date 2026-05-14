import * as React from "react";
import { useReducedMotion } from "framer-motion";

/* Lightweight streaming visualization: when `streaming` is true, append a
 * blinking yellow caret to the rendered content. We don't re-render per
 * character — react-markdown already updates as content grows; the caret
 * gives the visual heartbeat. */
export function StreamingCaret({ visible }: { visible: boolean }): React.ReactElement | null {
  const reduced = useReducedMotion();
  if (!visible) return null;
  return (
    <span
      aria-hidden
      className="caret-bar align-text-bottom ml-[1px]"
      style={reduced ? { animation: "none", opacity: 0.7 } : undefined}
    />
  );
}
