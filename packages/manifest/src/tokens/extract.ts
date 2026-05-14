// Stage 4b — Token extraction.
//
// Per §3.2 stage 4b:
//   1. Walk <tokenRoot>, pair every <name>.d.ts with <name>.js.
//   2. Parse the .d.ts with the TS compiler — find each `export namespace <ns>`
//      and the consts inside it; the const's object-type members are token
//      VARIANTS; the variant value's members are AXIS-LEAF keys.
//   3. require() the sibling .js to fill values.
//   4. Detect axes from the leaf-key vocabulary (e.g. desktopvalue /
//      desktopdarkvalue / mobilevalue / mobiledarkvalue → surface × theme).
//   5. Emit one TokenAxisCombo per cross-product; synthesize tokens.<combo>.css.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

export interface TokenManifest {
  upstreamVersion: string;
  groups: Record<string, TokenGroup>;
  axes: TokenAxis[];
  combos: TokenAxisCombo[];
  defaultComboId: string;
}

export interface TokenGroup {
  path: string;
  description: string;
  variants: TokenVariant[];
}

export interface TokenVariant {
  name: string;
  values: Record<string, string>;
  cssVar: string;
  description?: string;
}

export interface TokenAxis { id: string; values: string[]; }
export interface TokenAxisCombo { id: string; selections: Record<string, string>; }

export interface ExtractTokensResult {
  manifest: TokenManifest;
  cssByCombo: Record<string, string>;
}

const DEFAULT_AXIS_KEY_RE = /^(?<surface>desktop|mobile)(?<theme>dark)?value$/;

export interface AxisGrammar {
  /** Regex with named groups `surface` (required) and `theme` (optional). */
  pattern: RegExp;
  /** Preferred default for picking the default combo. If absent, first
   *  observed value wins. */
  defaultSurface?: string;
  defaultTheme?: string;
}

const DEFAULT_CSS_VAR_PATTERN = "--{namespace}-{binding}-{variant}";

export interface ExtractTokensOptions {
  upstreamVersion?: string;
  axisGrammar?: AxisGrammar;
  /** Template for the emitted CSS custom property name per variant.
   *  Placeholders: {namespace}, {binding}, {variant}. */
  cssVarPattern?: string;
}

export function extractTokens(tokenRoot: string, opts: ExtractTokensOptions = {}): ExtractTokensResult {
  const upstreamVersion = opts.upstreamVersion ?? "fixture-0.1.0";
  const grammar: AxisGrammar = opts.axisGrammar ?? { pattern: DEFAULT_AXIS_KEY_RE };
  const cssVarPattern = opts.cssVarPattern ?? DEFAULT_CSS_VAR_PATTERN;
  const namespaceFiles = discoverNamespaces(tokenRoot);
  const groups: Record<string, TokenGroup> = {};

  // Step 2/3 — parse .d.ts, then load sibling .js for runtime values.
  for (const ns of namespaceFiles) {
    const tsShape = parseNamespaceDts(ns.dts);
    const jsValues = loadNamespaceJs(ns.js);
    for (const [namespaceName, constNames] of Object.entries(tsShape)) {
      for (const constName of constNames) {
        const groupPath = `${namespaceName}.${constName}`;
        const jsConst = jsValues?.[namespaceName]?.[constName];
        if (!jsConst || typeof jsConst !== "object") continue;
        const variants: TokenVariant[] = [];
        for (const [variantName, variantBody] of Object.entries(jsConst)) {
          if (!variantBody || typeof variantBody !== "object") continue;
          variants.push({
            name: variantName,
            values: Object.fromEntries(Object.entries(variantBody as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
            cssVar: cssVarPattern
              .replace("{namespace}", namespaceName)
              .replace("{binding}", constName)
              .replace("{variant}", variantName),
          });
        }
        groups[groupPath] = {
          path: groupPath,
          description: `${groupPath} tokens.`,
          variants,
        };
      }
    }
  }

  const { axes, combos, defaultComboId } = deriveAxes(groups, grammar);
  const cssByCombo = emitCssForCombos(groups, combos, grammar);

  return {
    manifest: {
      upstreamVersion,
      groups,
      axes,
      combos,
      defaultComboId,
    },
    cssByCombo,
  };
}

function discoverNamespaces(tokenRoot: string): Array<{ dts: string; js: string; baseName: string }> {
  if (!existsSync(tokenRoot)) return [];
  const out: Array<{ dts: string; js: string; baseName: string }> = [];
  for (const f of readdirSync(tokenRoot)) {
    if (!f.endsWith(".d.ts")) continue;
    if (f === "index.d.ts") continue;
    const base = f.slice(0, -".d.ts".length);
    const jsPath = join(tokenRoot, `${base}.js`);
    if (!existsSync(jsPath)) continue;
    out.push({ dts: join(tokenRoot, f), js: jsPath, baseName: base });
  }
  return out;
}

/**
 * Returns a map of namespaceName → list of exported const bindings inside it.
 *
 * For our shape:
 *   export namespace animation { export { curve }; }
 *   declare const curve: { ... };
 *
 * We collect "animation" → ["curve"]. The variant + axis-key shape inside the
 * const is read from the .js (TS compiler API alone can't infer literal
 * values from a `declare const`).
 */
function parseNamespaceDts(file: string): Record<string, string[]> {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Record<string, string[]> = {};
  ts.forEachChild(sf, (n) => {
    if (ts.isModuleDeclaration(n) && n.body && ts.isIdentifier(n.name)) {
      const namespaceName = n.name.text;
      const bindings: string[] = [];
      if (n.body && ts.isModuleBlock(n.body)) {
        for (const stmt of n.body.statements) {
          if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
            for (const spec of stmt.exportClause.elements) {
              bindings.push(spec.name.text);
            }
          }
        }
      }
      if (bindings.length) out[namespaceName] = bindings;
    }
  });
  return out;
}

function loadNamespaceJs(jsFile: string): any {
  // CommonJS load; design-tokens files use module.exports.
  const req = createRequire(import.meta.url);
  try {
    delete req.cache?.[req.resolve(jsFile)];
  } catch {}
  return req(jsFile);
}

function deriveAxes(
  groups: Record<string, TokenGroup>,
  grammar: AxisGrammar
): { axes: TokenAxis[]; combos: TokenAxisCombo[]; defaultComboId: string } {
  // Collect every axis-leaf key seen across every variant value, parsed with
  // the configured grammar. `surface` is required; `theme` is optional —
  // grammars without a theme group (e.g. surface-only) produce a single-axis
  // combo set.
  const surfaceVals = new Set<string>();
  const themeVals = new Set<string>();
  let sawAxisKey = false;
  let grammarUsesTheme = false;

  for (const group of Object.values(groups)) {
    for (const v of group.variants) {
      for (const leafKey of Object.keys(v.values)) {
        const m = grammar.pattern.exec(leafKey);
        if (!m) continue;
        sawAxisKey = true;
        const surface = m.groups?.surface;
        if (!surface) continue;
        surfaceVals.add(surface);
        const theme = m.groups?.theme;
        if (theme !== undefined) {
          grammarUsesTheme = true;
          // Normalize: any truthy capture in the `theme` group means "dark".
          // The user's grammar can capture e.g. "Dark" or "dark"; we collapse.
          themeVals.add(theme ? "dark" : "light");
        }
      }
    }
  }

  if (!sawAxisKey) {
    return {
      axes: [],
      combos: [{ id: "default", selections: {} }],
      defaultComboId: "default",
    };
  }

  // Theme axis: when grammar supports a theme group, every leaf either
  // captures it (= "dark") or doesn't (= "light"). We always emit both if any
  // dark key was seen.
  const themesIfPresent = themeVals.size ? ["light", "dark"] : ["light"];

  const axes: TokenAxis[] = [{ id: "surface", values: [...surfaceVals] }];
  if (grammarUsesTheme) axes.push({ id: "theme", values: themesIfPresent });

  const combos: TokenAxisCombo[] = [];
  if (grammarUsesTheme) {
    for (const surface of axes[0].values) {
      for (const theme of themesIfPresent) {
        combos.push({ id: `surface=${surface}.theme=${theme}`, selections: { surface, theme } });
      }
    }
  } else {
    for (const surface of axes[0].values) {
      combos.push({ id: `surface=${surface}`, selections: { surface } });
    }
  }

  const defaultSurface = grammar.defaultSurface ?? [...surfaceVals][0];
  const defaultTheme = grammar.defaultTheme ?? "light";
  const defaultComboId =
    combos.find(
      (c) =>
        c.selections.surface === defaultSurface &&
        (!grammarUsesTheme || c.selections.theme === defaultTheme)
    )?.id ?? combos[0].id;

  return { axes, combos, defaultComboId };
}

/* Match a variant's leaf-key entry against a combo by re-running the grammar
 * against each leaf key. This is grammar-agnostic — we don't try to
 * reconstruct the leaf key from the combo selection (which would couple us
 * to the casing/format of the user's pattern). */
function resolveValueForCombo(
  variant: TokenVariant,
  combo: TokenAxisCombo,
  grammar: AxisGrammar
): string | null {
  // Axisless combo: pick the first value of the variant.
  if (Object.keys(combo.selections).length === 0) {
    return variant.values[""] ?? Object.values(variant.values)[0] ?? null;
  }
  for (const [leafKey, value] of Object.entries(variant.values)) {
    const m = grammar.pattern.exec(leafKey);
    if (!m) continue;
    const surface = m.groups?.surface;
    if (surface !== combo.selections.surface) continue;
    if (combo.selections.theme !== undefined) {
      const theme = m.groups?.theme ? "dark" : "light";
      if (theme !== combo.selections.theme) continue;
    }
    return value;
  }
  // Fallback: variant didn't ship this combo's axis-leaf; pick any value.
  return Object.values(variant.values)[0] ?? null;
}

function emitCssForCombos(
  groups: Record<string, TokenGroup>,
  combos: TokenAxisCombo[],
  grammar: AxisGrammar
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const combo of combos) {
    const lines: string[] = [":root {"];
    for (const group of Object.values(groups)) {
      for (const v of group.variants) {
        const resolved = resolveValueForCombo(v, combo, grammar);
        if (resolved != null) lines.push(`  ${v.cssVar}: ${resolved};`);
      }
    }
    lines.push("}");
    out[combo.id] = lines.join("\n") + "\n";
  }
  return out;
}
