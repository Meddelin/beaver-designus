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

const AXIS_KEY_RE = /^(?<surface>desktop|mobile)(?<theme>dark)?value$/;

export function extractTokens(tokenRoot: string, upstreamVersion = "fixture-0.1.0"): ExtractTokensResult {
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
            cssVar: `--${namespaceName}-${constName}-${variantName}`,
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

  const { axes, combos, defaultComboId } = deriveAxes(groups);
  const cssByCombo = emitCssForCombos(groups, combos);

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

function deriveAxes(groups: Record<string, TokenGroup>): { axes: TokenAxis[]; combos: TokenAxisCombo[]; defaultComboId: string } {
  // Collect every axis-leaf key seen across every variant value. Parse
  // each with the configured grammar (hard-coded for v1 — §3.2 stage 4b
  // makes this overridable, but the upstream's vocabulary is fixed).
  const surfaceVals = new Set<string>();
  const themeVals = new Set<string>();
  let sawAxisKey = false;
  let sawAxisless = false;

  for (const group of Object.values(groups)) {
    for (const v of group.variants) {
      for (const leafKey of Object.keys(v.values)) {
        const m = AXIS_KEY_RE.exec(leafKey);
        if (!m) { sawAxisless = true; continue; }
        sawAxisKey = true;
        const surface = m.groups!.surface;
        const theme = m.groups!.theme ? "dark" : "light";
        surfaceVals.add(surface);
        themeVals.add(theme);
      }
    }
  }

  if (!sawAxisKey) {
    // No axes — single default combo, axisless keys map to a single "" key.
    return {
      axes: [],
      combos: [{ id: "default", selections: {} }],
      defaultComboId: "default",
    };
  }

  const axes: TokenAxis[] = [
    { id: "surface", values: [...surfaceVals] },
    { id: "theme", values: themeVals.size ? [...themeVals] : ["light"] },
  ];
  const combos: TokenAxisCombo[] = [];
  for (const surface of axes[0].values) {
    for (const theme of axes[1].values) {
      combos.push({
        id: `surface=${surface}.theme=${theme}`,
        selections: { surface, theme },
      });
    }
  }
  const defaultComboId = combos.find((c) => c.selections.surface === "desktop" && c.selections.theme === "light")?.id ?? combos[0].id;
  // Note: axisless tokens (spacing groups in our fixture) still emit per-combo
  // CSS files with the same values everywhere — see emitCssForCombos.
  return { axes, combos, defaultComboId };
}

function resolveValueForCombo(variant: TokenVariant, combo: TokenAxisCombo): string | null {
  // If the variant has axis-leaf keys, use the combo's selection.
  const leafKey = combo.selections.surface
    ? `${combo.selections.surface}${combo.selections.theme === "dark" ? "dark" : ""}value`
    : "";
  if (variant.values[leafKey]) return variant.values[leafKey];
  // Axisless variant (spacing.scale.md = { desktopvalue, mobilevalue }) — still keyed by surface, fall back to desktopvalue.
  if (variant.values["desktopvalue"]) return variant.values["desktopvalue"];
  // Pure axisless (no axis keys at all) — single "" key.
  if (variant.values[""]) return variant.values[""];
  // Fall back: first value seen.
  const first = Object.values(variant.values)[0];
  return first ?? null;
}

function emitCssForCombos(groups: Record<string, TokenGroup>, combos: TokenAxisCombo[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const combo of combos) {
    const lines: string[] = [":root {"];
    for (const group of Object.values(groups)) {
      for (const v of group.variants) {
        const resolved = resolveValueForCombo(v, combo);
        if (resolved != null) lines.push(`  ${v.cssVar}: ${resolved};`);
      }
    }
    lines.push("}");
    out[combo.id] = lines.join("\n") + "\n";
  }
  return out;
}
