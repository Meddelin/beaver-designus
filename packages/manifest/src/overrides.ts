// Stage 3 / 5 — overrides merge.
//
// Per §3.3: hand-authored override files live next to the generated artifact.
// We park them in `manifest-overrides/<ds>/<package>.overrides.json` so they
// survive a clean rebuild of `manifest-data/`.
//
// An overrides file is an array of partial ManifestEntry objects keyed by
// `id`. Anything set in the override wins over the extracted value (including
// `category` — useful for "this item is an atom even though its DS hint is
// organism", §3.1 categoryHint override).

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ManifestEntry } from "./types.ts";

export type OverrideMap = Record<string, Partial<ManifestEntry>>;

export function loadOverrides(dir: string): OverrideMap {
  if (!existsSync(dir)) return {};
  const out: OverrideMap = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".overrides.json")) continue;
    const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const items = Array.isArray(raw) ? raw : [raw];
    for (const item of items) {
      if (item && typeof item.id === "string") out[item.id] = item;
    }
  }
  return out;
}

/**
 * Merge override into base entry.
 *
 * - Top-level fields replace (shallow merge), as §3.3 commits to.
 * - When the override declares `props`, each entry is matched against the base
 *   by `name` and merged field-by-field (kind, description, required,
 *   defaultValue). This lets an override patch a single prop — e.g. point a
 *   `tone` prop at a token group via `kind: { type: "token-reference", group:
 *   "color.brand" }` — without re-stating every other prop. Unmatched override
 *   props are appended (so an override can also ADD a prop the extractor
 *   missed).
 */
export function applyOverride(base: ManifestEntry, overrides: OverrideMap): ManifestEntry {
  const ov = overrides[base.id];
  if (!ov) return base;
  const merged: ManifestEntry = { ...base, ...ov };
  if (ov.props && Array.isArray(ov.props)) {
    const byName = new Map(base.props.map((p) => [p.name, p] as const));
    for (const opv of ov.props) {
      const existing = byName.get(opv.name);
      if (existing) {
        byName.set(opv.name, { ...existing, ...opv });
      } else {
        byName.set(opv.name, opv as ManifestEntry["props"][number]);
      }
    }
    merged.props = [...byName.values()];
  }
  return merged;
}
