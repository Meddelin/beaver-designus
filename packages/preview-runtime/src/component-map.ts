// Component map — keys are ManifestEntry.id (sourceSystem-prefixed) and
// values are the imported React components.
//
// ──────────────────────────────────────────────────────────────────────────
//   THIS FILE IS A PLACEHOLDER.
//
//   It is intentionally empty in the public repo because the actual design
//   systems (T-Bank Beaver + react-ui-kit) ship inside a corporate perimeter
//   and were not included in the open-source push.
//
//   To get a working preview you must, in this order:
//     1. Clone the two real design system repos somewhere reachable, then
//        update `manifest.config.json` so each DS's `source.localPath`
//        points at the clone (or set BEAVER_LOCAL_PATH / REACT_UI_KIT_LOCAL_PATH).
//     2. Run `npm run manifest:build` — produces `manifest-data/index.json`
//        and `manifest-data/tokens.css`.
//     3. Regenerate THIS file from `manifest-data/index.json` — one `import`
//        per package, one entry per exported component. The shape below
//        shows what the generated file should look like.
//
//   The architecture (§7, §11) describes `component-map.ts` as a generated
//   artifact written at web-app build time. v1 keeps it hand-written until
//   M5 ships an actual generator script.
// ──────────────────────────────────────────────────────────────────────────

import * as React from "react";
import { UnknownComponentFallback } from "./fallbacks.tsx";

/**
 * Wire your design system's real React components in here, keyed by
 * `<sourceSystem>:<packageName>/<exportName>` exactly as `ManifestEntry.id`
 * is produced by `packages/manifest/src/build.ts`.
 *
 * Example shape:
 *
 *   import { Button } from "<your-react-ui-kit>/packages/button";
 *   import { Card }   from "<your-beaver-ui>/packages/card";
 *
 *   export const COMPONENT_MAP = {
 *     "react-ui-kit:@react-ui-kit/button/Button": Button,
 *     "beaver:@beaver-ui/card/Card":              Card,
 *   } satisfies Record<string, React.ComponentType<any>>;
 */
export const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {};

/** When COMPONENT_MAP is empty (placeholder state) we route every node to
 *  the `UnknownComponentFallback` so the preview surface still renders a
 *  readable error chip instead of crashing. */
export function resolveComponent(id: string): React.ComponentType<any> {
  return COMPONENT_MAP[id] ?? ((props: any) => React.createElement(UnknownComponentFallback, { id }));
}
