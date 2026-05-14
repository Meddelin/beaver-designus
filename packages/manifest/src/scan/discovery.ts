// Stage 1 — Discovery + symbol surfacing.
// Adapted from dscan's prescanBeaver: walks `<componentRoot>/<pkg>/package.json`
// under each configured DS, then parses each package's entry file with the TS
// compiler to enumerate exported symbols.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

export interface PackageInfo {
  /** Package name from package.json — e.g. "@beaver-ui/side-navigation". */
  name: string;
  /** Absolute path to the package root. */
  root: string;
  /** Absolute path to the entry source (resolved from main/types/exports). */
  entryFile: string;
}

export interface DiscoveredSymbol {
  /** Re-exported binding as seen from the entry file — e.g. "SideNavigation". */
  exportName: string;
  /** Absolute path to the file that DECLARES the symbol (after walking re-exports). */
  declarationFile: string;
}

export interface DiscoveredPackage extends PackageInfo {
  symbols: DiscoveredSymbol[];
}

export interface DiscoverOptions {
  /** Package basename globs to skip. Supports leading/trailing/midline `*`
   *  via a literal-glob translation (no full minimatch). E.g.
   *  `["analytics", "hooks", "internal-*", "*-deprecated"]`. */
  excludePackages?: string[];
}

export function discoverPackages(
  dsRoot: string,
  componentRoot: string,
  opts: DiscoverOptions = {}
): PackageInfo[] {
  const pkgRoot = resolve(dsRoot, componentRoot);
  if (!existsSync(pkgRoot)) return [];
  const excludeREs = (opts.excludePackages ?? []).map(globToRegExp);
  const out: PackageInfo[] = [];
  for (const dir of readdirSync(pkgRoot)) {
    const root = join(pkgRoot, dir);
    if (!statSync(root).isDirectory()) continue;
    // Auto-skip the design-tokens package — handled by Stage 4b regardless.
    if (dir === "design-tokens") continue;
    if (excludeREs.some((re) => re.test(dir))) continue;
    const pjPath = join(root, "package.json");
    if (!existsSync(pjPath)) continue;
    const pj = JSON.parse(readFileSync(pjPath, "utf8"));
    if (!pj.name) continue;
    const entry = resolveEntryFile(root, pj);
    if (!entry) continue;
    out.push({ name: pj.name, root, entryFile: entry });
  }
  return out;
}

/* Translate a basename glob (`*` wildcard only) into a regex anchored on both
 * ends. Strings without `*` match exactly. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const pattern = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(pattern);
}

function resolveEntryFile(pkgRoot: string, pkgJson: any): string | null {
  // Try types first (closest to authoritative for our needs), then main, then conventional fallbacks.
  const candidates = [
    pkgJson.types,
    pkgJson.typings,
    pkgJson.main,
    "src/index.ts",
    "src/index.tsx",
    "index.ts",
    "index.tsx",
    "index.d.ts",
    "index.js",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    const p = join(pkgRoot, c);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Walk a package's entry file, recursively follow `export ... from "./..."`
 * re-exports, and emit one DiscoveredSymbol per exported declaration.
 *
 * Mirrors dscan's prescanBeaver re-export-chain flattening, but scoped to the
 * one package we're inspecting. Filters non-component exports (hooks /
 * factories / constants / type-only) so the manifest enum stays clean.
 */
export function discoverSymbols(pkg: PackageInfo): DiscoveredSymbol[] {
  const seenFiles = new Set<string>();
  const collected: DiscoveredSymbol[] = [];
  walkFile(pkg.entryFile, seenFiles, collected);
  // Dedupe by exportName — re-exports + the target file's direct declaration
  // yield the same symbol twice.
  const byName = new Map<string, DiscoveredSymbol>();
  for (const sym of collected) {
    if (!byName.has(sym.exportName)) byName.set(sym.exportName, sym);
  }
  // Filter to component-looking exports only.
  const out: DiscoveredSymbol[] = [];
  for (const sym of byName.values()) {
    if (!isLikelyComponentName(sym.exportName)) continue;
    if (declarationIsTypeOnly(sym.declarationFile, sym.exportName)) continue;
    out.push(sym);
  }
  return out;
}

/** Heuristic: components are PascalCase identifiers. Reject:
 *  - lowercase-starting names (`useFoo`, `createBar`, `withBaz`) → hooks / factories
 *  - SCREAMING_SNAKE_CASE → constants
 *  - names containing `Context` suffix → context objects
 *  - well-known utility suffixes (`Map`, `Helper`, `Utils`)
 *  These are conservative — false positives (rejecting a legitimate component
 *  with an unusual name) are recovered via override files; false negatives
 *  (letting a non-component through) cause runtime crashes in the preview. */
export function isLikelyComponentName(name: string): boolean {
  if (!name) return false;
  const first = name[0];
  if (!first || first !== first.toUpperCase()) return false;
  if (first === first.toLowerCase()) return false; // not a letter (e.g. "$x")
  if (/^[A-Z0-9_]+$/.test(name)) return false; // SCREAMING_SNAKE
  if (/(Context|ContextValue|ContextType)$/.test(name)) return false;
  if (/(Map|Utils|Helpers?)$/.test(name)) return false;
  return true;
}

/** Open the declaration file and check whether the export is a type-only
 *  declaration (`type X = ...` / `interface X {}`). Plain re-exports of
 *  types from `import type` won't reach here (already filtered upstream),
 *  but `export type X = ...` inside the destination file does. */
function declarationIsTypeOnly(file: string, exportName: string): boolean {
  if (!existsSync(file)) return false;
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let typeOnly = false;
  ts.forEachChild(sf, (n) => {
    if (typeOnly) return;
    if (ts.isTypeAliasDeclaration(n) && n.name.text === exportName) typeOnly = true;
    if (ts.isInterfaceDeclaration(n) && n.name.text === exportName) typeOnly = true;
  });
  return typeOnly;
}

function walkFile(file: string, seen: Set<string>, out: DiscoveredSymbol[]): void {
  if (seen.has(file)) return;
  seen.add(file);
  if (!existsSync(file)) return;
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  ts.forEachChild(sf, (node) => {
    // export { Foo } from "./Foo";  / export { Foo, Bar } from "./Foo";
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      const moduleSpec = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
      if (moduleSpec) {
        const resolved = resolveRelative(file, moduleSpec);
        if (resolved) {
          for (const spec of node.exportClause.elements) {
            // type-only re-exports are skipped (they don't appear at runtime)
            if (spec.isTypeOnly || node.isTypeOnly) continue;
            const exportName = spec.name.text;
            const localName = spec.propertyName?.text ?? exportName;
            const declared = findDeclarationInFile(resolved, localName);
            out.push({ exportName, declarationFile: declared ?? resolved });
          }
          // Also walk that re-export source for transitive chains.
          walkFile(resolved, seen, out);
          return;
        }
      }
      // export { Foo };  (re-export of a local binding declared in this file)
      for (const spec of node.exportClause.elements) {
        if (spec.isTypeOnly || node.isTypeOnly) continue;
        out.push({ exportName: spec.name.text, declarationFile: file });
      }
      return;
    }

    // export function Foo / export class Foo / export const Foo  — direct declarations
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableStatement(node)) &&
      hasExportModifier(node)
    ) {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            out.push({ exportName: decl.name.text, declarationFile: file });
          }
        }
      } else if (node.name) {
        out.push({ exportName: node.name.text, declarationFile: file });
      }
    }
  });
}

function findDeclarationInFile(file: string, exportName: string): string | null {
  if (!existsSync(file)) return null;
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: string | null = null;
  ts.forEachChild(sf, (n) => {
    if (found) return;
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name?.text === exportName) found = file;
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === exportName) found = file;
      }
    }
    // export { Foo } from "./somewhere" — chase it
    if (ts.isExportDeclaration(n) && n.exportClause && ts.isNamedExports(n.exportClause) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      for (const spec of n.exportClause.elements) {
        const name = spec.name.text;
        if (name === exportName) {
          const resolved = resolveRelative(file, n.moduleSpecifier.text);
          if (resolved) {
            const local = spec.propertyName?.text ?? name;
            const inner = findDeclarationInFile(resolved, local);
            if (inner) found = inner;
          }
        }
      }
    }
  });
  return found;
}

function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const fromDir = join(fromFile, "..");
  const candidates = [
    spec,
    `${spec}.ts`,
    `${spec}.tsx`,
    `${spec}.d.ts`,
    `${spec}/index.ts`,
    `${spec}/index.tsx`,
    `${spec}/index.d.ts`,
  ];
  for (const c of candidates) {
    const p = resolve(fromDir, c);
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = (node as any).modifiers as ts.NodeArray<ts.ModifierLike> | undefined;
  return !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}
