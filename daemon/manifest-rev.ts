// Compute a stable revision of the loaded manifest. Used on:
//  - new project create (stamped on `projects.manifest_rev`)
//  - existing project load (drift detection per §6.4)
//
// We hash the canonical-JSON form of the index.entries array. Re-running the
// builder against the same source yields a stable hash; changing the source
// (or overrides) bumps it.

import { createHash } from "node:crypto";
import { loadManifest } from "./manifest-server.ts";

let cached: string | null = null;

export function currentManifestRev(): string {
  if (cached) return cached;
  const { entries } = loadManifest();
  const canonical = JSON.stringify(entries.map((e) => ({
    id: e.id,
    sourceSystem: e.sourceSystem,
    category: e.category,
    name: e.name,
    packageName: e.packageName,
    exportName: e.exportName,
    props: e.props.map((p) => ({ name: p.name, kind: p.kind, required: p.required })),
    slots: e.slots,
  })));
  const hash = createHash("sha1").update(canonical).digest("hex");
  cached = hash;
  return hash;
}
