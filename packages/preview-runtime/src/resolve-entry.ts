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

/* Resolve a single exports VALUE (string | conditions object) to a path
 * string, source-first, never `types`. */
function pickConditionString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const conds = value as Record<string, unknown>;
  for (const k of ["source", "development", "import", "module", "browser", "default", "require"]) {
    const v = conds[k];
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const nested = pickConditionString(v);
      if (nested) return nested;
    }
  }
  return undefined;
}

/* From a package.json `exports` value, pull the best candidate for the `.`
 * entry. Handles: string, { ".": <string|conditions> }, or a bare conditions
 * object. We never follow the `types` condition (declaration-only). */
function candidateFromExports(exp: unknown): string | undefined {
  if (typeof exp === "string") return exp;
  if (!exp || typeof exp !== "object") return undefined;
  const root = (exp as Record<string, unknown>)["."] ?? exp;
  return pickConditionString(root);
}

export interface SubpathExports {
  /** "<subpath>" (no leading "./") → absolute on-disk loadable file. */
  subpaths: Record<string, string>;
  /** Absolute dir backing a `"./*"` wildcard export, if declared. */
  wildcardBase: string | null;
}

/* Resolve every concrete subpath export ("./legacy", "./testing", …) to a
 * real on-disk source file, plus a `"./*"` wildcard base dir. This is what
 * lets the preview resolve internal DS imports like
 * `export * from "@beaver-ui/date-range-picker/legacy"` — the root alias
 * alone never covers subpaths. Declared dist/ targets that don't exist
 * (source-only DS) fall back to the obvious source layouts. */
export function resolveSubpathExports(
  pkgDir: string,
  pkgJson: Record<string, unknown>
): SubpathExports {
  const out: SubpathExports = { subpaths: {}, wildcardBase: null };
  const exp = pkgJson.exports;
  if (!exp || typeof exp !== "object" || Array.isArray(exp)) return out;

  for (const [key, value] of Object.entries(exp as Record<string, unknown>)) {
    if (key === "." || !key.startsWith("./")) continue;
    const sub = key.slice(2); // "legacy", "*", "forms/*"

    if (sub === "*" || sub.endsWith("/*")) {
      const target = pickConditionString(value); // e.g. "./src/*"
      if (target) {
        const baseRel = target.replace(/^\.\//, "").replace(/\*.*$/, "").replace(/\/$/, "");
        const baseAbs = join(pkgDir, baseRel);
        if (existsSync(baseAbs)) out.wildcardBase = baseAbs;
      }
      continue;
    }

    const declared = pickConditionString(value);
    const tried: string[] = [];
    const hit =
      accept(pkgDir, declared, tried) ??
      accept(pkgDir, `src/${sub}/index.ts`, tried) ??
      accept(pkgDir, `src/${sub}/index.tsx`, tried) ??
      accept(pkgDir, `${sub}/index.ts`, tried) ??
      accept(pkgDir, `${sub}/index.tsx`, tried) ??
      accept(pkgDir, `src/${sub}.ts`, tried) ??
      accept(pkgDir, `src/${sub}.tsx`, tried);
    if (hit) out.subpaths[sub] = hit;
  }
  return out;
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
