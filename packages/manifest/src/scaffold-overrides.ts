// `manifest:scaffold-overrides` — walks manifest-data/index.json and emits
// per-package override JSON skeletons for entries that look like they need
// hand-tuning (sparse description, props with kind="unsupported", or
// componentry the auditor flagged as HOC-wrapped).
//
// Existing overrides files are LEFT ALONE. Only new skeletons are written.
// The operator fills them in, manifest:build picks them up via overrides.ts.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ManifestEntry, PropEntry } from "./types.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");

interface IndexShape {
  entries: ManifestEntry[];
}

interface ScaffoldOptions {
  minDescriptionLength?: number;
  includeUnsupportedProps?: boolean;
  dryRun?: boolean;
}

export function scaffoldOverrides(opts: ScaffoldOptions = {}): {
  written: string[];
  skipped: string[];
  candidates: number;
} {
  const minDescriptionLength = opts.minDescriptionLength ?? 12;
  const indexPath = join(PROJECT_ROOT, "manifest-data", "index.json");
  if (!existsSync(indexPath)) {
    throw new Error(`manifest-data/index.json not found. Run \`npm run manifest:build\` first.`);
  }
  const idx: IndexShape = JSON.parse(readFileSync(indexPath, "utf8"));
  const overridesRoot = join(PROJECT_ROOT, "manifest-overrides");
  mkdirSync(overridesRoot, { recursive: true });

  // Bucket candidates by DS + package so each file holds one package's
  // overrides (matches loadOverrides() conventions in overrides.ts).
  const byFile = new Map<string, Array<Partial<ManifestEntry>>>();
  let candidateCount = 0;

  for (const entry of idx.entries) {
    const reasons = needsOverride(entry, minDescriptionLength, opts.includeUnsupportedProps ?? true);
    if (reasons.length === 0) continue;
    candidateCount++;

    const pkgSlug = entry.packageName.replace("/", "-").replace("@", "");
    const fname = join(overridesRoot, entry.sourceSystem, `${pkgSlug}.overrides.json`);
    if (!byFile.has(fname)) byFile.set(fname, []);

    const skeleton: Partial<ManifestEntry> = {
      id: entry.id,
      // Pre-fill blank description + tags as TODO markers.
      ...(reasons.includes("sparse-description") ? { description: "TODO: describe this component for the selector skill." } : {}),
      ...(reasons.includes("unsupported-props")
        ? {
            props: entry.props
              .filter((p) => p.kind.type === "unsupported")
              .map((p) => ({
                name: p.name,
                kind: { type: "string" as const },
                required: p.required,
                description: `TODO: was 'unsupported'. If it's a literal-union, set kind: { type: "literal-union", options: [...] }; if a token-reference, set kind: { type: "token-reference", group: "<group.path>" }.`,
              })),
          }
        : {}),
    };
    byFile.get(fname)!.push(skeleton);
  }

  const written: string[] = [];
  const skipped: string[] = [];
  for (const [fname, items] of byFile) {
    if (existsSync(fname)) {
      skipped.push(fname);
      continue;
    }
    if (opts.dryRun) {
      written.push(`${fname} (dry-run, would write ${items.length} skeletons)`);
      continue;
    }
    mkdirSync(join(fname, ".."), { recursive: true });
    writeFileSync(fname, JSON.stringify(items, null, 2) + "\n");
    written.push(fname);
  }

  return { written, skipped, candidates: candidateCount };
}

function needsOverride(entry: ManifestEntry, minDescriptionLength: number, includeUnsupported: boolean): string[] {
  const reasons: string[] = [];
  if (!entry.description || entry.description.trim().length < minDescriptionLength) {
    reasons.push("sparse-description");
  }
  if (includeUnsupported && entry.props.some((p: PropEntry) => p.kind.type === "unsupported")) {
    reasons.push("unsupported-props");
  }
  return reasons;
}

// CLI entry: `npm run manifest:scaffold-overrides [--dry-run]`
if (
  import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` ||
  process.argv[1].endsWith("scaffold-overrides.ts")
) {
  const dryRun = process.argv.includes("--dry-run");
  try {
    const r = scaffoldOverrides({ dryRun });
    console.log(`[scaffold] candidates: ${r.candidates}`);
    if (r.written.length) {
      console.log(`[scaffold] wrote ${r.written.length} new skeleton file(s):`);
      for (const f of r.written) console.log(`  + ${f}`);
    }
    if (r.skipped.length) {
      console.log(`[scaffold] skipped ${r.skipped.length} existing file(s) (left untouched):`);
      for (const f of r.skipped) console.log(`  · ${f}`);
    }
  } catch (err) {
    console.error("[scaffold] failed:", (err as Error).message);
    process.exit(1);
  }
}
