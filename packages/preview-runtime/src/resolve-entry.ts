// Resolve a *runtime-loadable* entry for a DS package, as needed by Vite /
// the preview iframe. This is deliberately DIFFERENT from the manifest
// builder's entry resolution (scan/discovery.ts `resolveEntryFile`), which
// prefers `types`/`.d.ts` because it only needs the *type declarations*.
//
// At runtime a `.d.ts` is not loadable, and a `main`/`exports` that points
// into an unbuilt `dist/` (the common case for a source-only monorepo DS
// installed with `--ignore-scripts`) does not exist on disk. So here we
// prefer real source, never accept `.d.ts`, and verify every candidate
// exists before returning it.
//
// Resolution order (first existing wins):
//   1. package.json `source`          — Tinkoff/T-Bank react-ui-kit convention
//   2. src/index.{ts,tsx,js,jsx}
//   3. package.json `exports["."]`    — import/development/default condition
//   4. package.json `module`
//   5. package.json `main`
//   6. index.{ts,tsx,js,jsx}
// If none resolve, return { entry: null, tried } so the caller can drop the
// package with a precise, actionable reason.

import { existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";

export interface PreviewEntryResult {
  /** Absolute path to a loadable source/JS entry, or null if none found. */
  entry: string | null;
  /** Every candidate path we probed, in order — surfaced in the report. */
  tried: string[];
}

const LOADABLE = /\.(tsx?|jsx?|mjs|cjs)$/i;
const isDeclaration = (p: string) => /\.d\.[cm]?ts$/i.test(p);

/** A candidate is usable only if it exists, is a loadable extension, and is
 *  NOT a `.d.ts` declaration file. */
function accept(pkgDir: string, rel: string | undefined, tried: string[]): string | null {
  if (!rel || typeof rel !== "string") return null;
  const abs = isAbsolute(rel) ? rel : join(pkgDir, rel.replace(/^\.\//, ""));
  tried.push(abs);
  if (isDeclaration(abs)) return null;
  if (!LOADABLE.test(abs)) return null;
  return existsSync(abs) ? abs : null;
}

/* From a package.json `exports` value, pull the best candidate for the `.`
 * entry. Handles: string, { ".": <string|conditions> }, or a bare conditions
 * object. We never follow the `types` condition (declaration-only). */
function candidateFromExports(exp: unknown): string | undefined {
  if (typeof exp === "string") return exp;
  if (!exp || typeof exp !== "object") return undefined;
  const root = (exp as Record<string, unknown>)["."] ?? exp;
  if (typeof root === "string") return root;
  if (!root || typeof root !== "object") return undefined;
  const conds = root as Record<string, unknown>;
  // Source-first ordering. `types` deliberately excluded.
  for (const k of ["source", "development", "import", "module", "browser", "default", "require"]) {
    const v = conds[k];
    if (typeof v === "string") return v;
    // Nested conditions (e.g. { import: { default: "..." } }).
    if (v && typeof v === "object") {
      const nested = candidateFromExports(v);
      if (nested) return nested;
    }
  }
  return undefined;
}

export function resolvePreviewEntry(
  pkgDir: string,
  pkgJson: Record<string, unknown>
): PreviewEntryResult {
  const tried: string[] = [];

  const ordered: Array<string | undefined> = [
    typeof pkgJson.source === "string" ? pkgJson.source : undefined,
    "src/index.ts",
    "src/index.tsx",
    "src/index.js",
    "src/index.jsx",
    candidateFromExports(pkgJson.exports),
    typeof pkgJson.module === "string" ? pkgJson.module : undefined,
    typeof pkgJson.main === "string" ? pkgJson.main : undefined,
    "index.ts",
    "index.tsx",
    "index.js",
    "index.jsx",
  ];

  for (const cand of ordered) {
    const hit = accept(pkgDir, cand, tried);
    if (hit) return { entry: hit, tried };
  }
  return { entry: null, tried };
}
