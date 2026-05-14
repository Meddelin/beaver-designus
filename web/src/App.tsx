import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Home } from "./home/Home.tsx";
import { WorkspaceView } from "./workspace/WorkspaceView.tsx";

type Route =
  | { kind: "home" }
  | { kind: "project"; projectId: string };

function parseRoute(): Route {
  const hash = window.location.hash;
  const m = hash.match(/^#\/p\/([\w\d-]+)$/);
  if (m) return { kind: "project", projectId: m[1] };
  return { kind: "home" };
}

export function App(): React.ReactElement {
  const [route, setRoute] = React.useState<Route>(() => parseRoute());

  React.useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = React.useCallback((next: Route) => {
    if (next.kind === "home") window.location.hash = "";
    else window.location.hash = `/p/${next.projectId}`;
  }, []);

  const key = route.kind === "home" ? "home" : `p:${route.projectId}`;

  return (
    <div className="h-full">
      <AnimatePresence mode="wait">
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
          className="h-full"
        >
          {route.kind === "home" ? (
            <Home onOpen={(p) => navigate({ kind: "project", projectId: p.id })} />
          ) : (
            <WorkspaceView projectId={route.projectId} onBackHome={() => navigate({ kind: "home" })} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
