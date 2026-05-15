// F6 — DS transform-error resilience. Extracted from vite.config.ts so the
// pure logic is unit-testable without evaluating the Vite config (which
// runs at import).
//
// A parse/transform failure in ONE design-system source file (legacy
// decorators we can't cover, an exotic TS feature, a corrupt file…) would
// otherwise white-screen the whole preview iframe via Vite's error overlay
// — taking down every component, not just the bad one. The React plugin
// owns the failing transform, so we wrap its `transform` hook: if it
// throws AND the file is DS source, substitute a stub module instead of
// propagating. App/own-code errors are never masked (rethrown). Named
// imports from the stub resolve to undefined → contained at render time by
// the per-node RenderErrorBoundary (P4). Same "degrade visibly, never
// crash everything" contract as UnknownComponentFallback.

export function isDsSource(id: string, dsRoots: string[]): boolean {
  const norm = id.split("?")[0].replace(/\\/g, "/").replace(/^\/@fs\//, "/");
  return dsRoots.some((r) => r && norm.includes(r.replace(/\\/g, "/")));
}

export function dsStubModule(id: string): string {
  const file = id.split("?")[0].replace(/\\/g, "/").split("/").pop() ?? "module";
  const label = JSON.stringify(file);
  const msg = JSON.stringify(`⚠ DS module failed to transform: ${file}`);
  // Inline React marker — no project imports (this is generated source).
  return `import * as React from "react";
const msg = ${msg};
if (typeof console !== "undefined") console.warn("[beaver-designus] stubbed un-transformable DS module:", ${label});
function BvrTransformStub(props) {
  return React.createElement(
    "span",
    {
      "data-bvr-fallback": "transform-error",
      title: msg,
      style: {
        display: "inline-block", padding: "4px 8px", margin: "2px",
        background: "#ffe1e1", border: "1px dashed #c92f2f", borderRadius: "4px",
        color: "#5b0000", fontFamily: "ui-monospace, monospace", fontSize: "11px",
        maxWidth: "320px", whiteSpace: "normal", verticalAlign: "top",
      },
    },
    msg
  );
}
export const __bvrTransformStub = true;
export default BvrTransformStub;
`;
}

/* Wrap every `transform` hook on the given (React) plugin(s) so a throw on
 * a DS-source id yields a stub instead of crashing the whole graph. App
 * and third-party errors are rethrown untouched. Mutates + returns the
 * flattened plugin list. */
export function withDsTransformResilience(plugin: unknown, dsRoots: string[]): any[] {
  const list = (Array.isArray(plugin) ? plugin : [plugin]).flat().filter(Boolean) as any[];
  for (const p of list) {
    if (!p || typeof p !== "object" || !("transform" in p) || !p.transform) continue;
    const isObj = typeof p.transform === "object";
    const orig = (isObj ? p.transform.handler : p.transform) as (...a: any[]) => any;
    if (typeof orig !== "function") continue;
    const wrapped = async function (this: any, code: string, id: string, opts: any) {
      try {
        return await orig.call(this, code, id, opts);
      } catch (err) {
        if (!isDsSource(id, dsRoots)) throw err;
        const reason = (err as Error)?.message ?? String(err);
        console.warn(
          `[vite] transform failed for DS source — serving a stub so the rest of the ` +
            `preview survives. file=${id}\n        reason: ${reason}`
        );
        return { code: dsStubModule(id), map: null };
      }
    };
    p.transform = isObj ? { ...p.transform, handler: wrapped } : wrapped;
  }
  return list;
}
