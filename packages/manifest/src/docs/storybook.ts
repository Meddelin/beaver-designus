// Stage 3 priority 2 — Storybook CSF fallback.
//
// Fires only when no MDX match was found for an exportName. We walk the
// package's src tree for `*.stories.{ts,tsx}` files, parse with the TS
// compiler API (we already depend on it from props/extract.ts), and emit:
//
//   - description hint: from default-export argTypes' per-prop description
//     fields. Only used by the description-merge if MDX gave us nothing.
//   - examples: each named export's body, serialized as a code snippet.
//
// Output shape mirrors `ParsedMdx` so build.ts can treat both sources
// interchangeably.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { astToJson } from "./usage.ts";
import type { JsonValue } from "../types.ts";

/* Preferred story names — a "Default"/"Basic" story is the canonical
 * minimal usage; fall through in this order, else first story with args. */
const STORY_PRIORITY = ["default", "basic", "primary", "playground", "example", "overview"];

export interface ParsedStorybook {
  title: string | null;
  tags: string[];
  description: string | null;
  examples: Array<{ source: "storybook"; code: string }>;
}

export function findAllStories(rootDir: string): string[] {
  const out: string[] = [];
  if (!existsSync(rootDir)) return out;
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      const s = statSync(full);
      if (s.isDirectory()) {
        if (f === "node_modules" || f === ".git") continue;
        walk(full);
      } else if (/\.stories\.(ts|tsx|js|jsx)$/.test(f)) {
        out.push(full);
      }
    }
  };
  walk(rootDir);
  return out;
}

/* Parse a single stories file. Returns null if it doesn't match the
 * convention or the file is unreadable. */
export function parseStorybook(file: string, exportName: string): ParsedStorybook | null {
  let raw: string;
  try { raw = readFileSync(file, "utf8"); } catch { return null; }

  const sf = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // The default export's `meta` object — Storybook v7 convention:
  //   const meta: Meta<typeof Button> = { title: "...", component: Button, argTypes: {...} };
  //   export default meta;
  let metaObject: ts.ObjectLiteralExpression | null = null;
  let title: string | null = null;
  const tags: string[] = [];
  let descriptionFromArgTypes: string | null = null;

  // First pass: find the meta object and named exports.
  const namedStories: Array<{ name: string; node: ts.Node }> = [];

  const visit = (node: ts.Node): void => {
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const expr = node.expression;
      if (ts.isObjectLiteralExpression(expr)) metaObject = expr;
      else if (ts.isIdentifier(expr)) {
        // resolve through const declaration
        const decl = findConstDecl(sf, expr.text);
        if (decl && ts.isObjectLiteralExpression(decl)) metaObject = decl;
      }
    }
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const d of node.declarationList.declarations) {
        if (d.name && ts.isIdentifier(d.name) && d.initializer) {
          if (d.name.text !== "default") namedStories.push({ name: d.name.text, node: d.initializer });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (metaObject) {
    for (const p of (metaObject as ts.ObjectLiteralExpression).properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const key = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : null;
      if (!key) continue;
      if (key === "title" && ts.isStringLiteral(p.initializer)) title = p.initializer.text;
      if (key === "tags" && ts.isArrayLiteralExpression(p.initializer)) {
        for (const el of p.initializer.elements) {
          if (ts.isStringLiteral(el)) tags.push(el.text);
        }
      }
      if (key === "argTypes" && ts.isObjectLiteralExpression(p.initializer)) {
        const descs: string[] = [];
        for (const at of p.initializer.properties) {
          if (!ts.isPropertyAssignment(at) || !ts.isObjectLiteralExpression(at.initializer)) continue;
          for (const inner of at.initializer.properties) {
            if (ts.isPropertyAssignment(inner) && ts.isIdentifier(inner.name) && inner.name.text === "description") {
              if (ts.isStringLiteral(inner.initializer)) descs.push(inner.initializer.text);
            }
          }
        }
        if (descs.length) descriptionFromArgTypes = descs[0];
      }
    }
  }

  // Each named story's source text becomes an example. We keep them small —
  // first 12 lines per story, deduped.
  const examples: ParsedStorybook["examples"] = [];
  const seen = new Set<string>();
  for (const story of namedStories) {
    const text = story.node.getText(sf).split("\n").slice(0, 12).join("\n");
    if (!seen.has(text)) {
      seen.add(text);
      examples.push({ source: "storybook", code: text });
    }
  }

  // If the file's title doesn't match the component, ignore it for THIS export.
  // We accept a permissive match: title may be "Forms/Button" — last segment
  // wins.
  const titleTail = title?.split("/").pop() ?? "";
  if (titleTail && titleTail !== exportName && !file.toLowerCase().includes(exportName.toLowerCase())) {
    return null;
  }

  return { title, tags, description: descriptionFromArgTypes, examples };
}

function findConstDecl(sf: ts.SourceFile, name: string): ts.Expression | null {
  let found: ts.Expression | null = null;
  const v = (n: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
      found = n.initializer;
    }
    ts.forEachChild(n, v);
  };
  v(sf);
  return found;
}

function hasExportModifier(node: ts.VariableStatement): boolean {
  return Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

/* P2 — pull the best story's `args` for `exportName`, statically. Handles
 * CSF3 (`export const Default = { args: {…} }`) and CSF2
 * (`export const Default = Template.bind({}); Default.args = {…}`).
 * Returns the args as JSON (non-representable values dropped) or null. */
export function extractStoryArgs(
  pkgRoot: string,
  exportName: string
): { storyId: string; args: Record<string, JsonValue> } | null {
  for (const file of findAllStories(pkgRoot)) {
    const hit = storyArgsInFile(file, exportName);
    if (hit) return hit;
  }
  return null;
}

function storyArgsInFile(
  file: string,
  exportName: string
): { storyId: string; args: Record<string, JsonValue> } | null {
  let raw: string;
  try { raw = readFileSync(file, "utf8"); } catch { return null; }
  const sf = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // Relevance: same permissive rule parseStorybook uses (title tail or
  // filename mentions the export) so we don't borrow another component's args.
  let title: string | null = null;
  const argsAssignments = new Map<string, ts.ObjectLiteralExpression>();
  const storyObjects = new Map<string, ts.ObjectLiteralExpression>();

  const visit = (node: ts.Node): void => {
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const expr = ts.isIdentifier(node.expression) ? findConstDecl(sf, node.expression.text) : node.expression;
      if (expr && ts.isObjectLiteralExpression(expr)) {
        for (const p of expr.properties) {
          if (ts.isPropertyAssignment(p) && keyName(p.name) === "title" && ts.isStringLiteral(p.initializer)) {
            title = p.initializer.text;
          }
        }
      }
    }
    // CSF3: export const Default = { args: {...} }  (optionally `: Story`)
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const d of node.declarationList.declarations) {
        if (d.name && ts.isIdentifier(d.name) && d.initializer && d.name.text !== "default") {
          if (ts.isObjectLiteralExpression(d.initializer)) storyObjects.set(d.name.text, d.initializer);
        }
      }
    }
    // CSF2: Default.args = { ... }
    if (
      ts.isExpressionStatement(node) &&
      ts.isBinaryExpression(node.expression) &&
      node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.expression.left) &&
      node.expression.left.name.text === "args" &&
      ts.isIdentifier(node.expression.left.expression) &&
      ts.isObjectLiteralExpression(node.expression.right)
    ) {
      argsAssignments.set(node.expression.left.expression.text, node.expression.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const titleTail = (title as string | null)?.split("/").pop() ?? "";
  if (titleTail && titleTail !== exportName && !file.toLowerCase().includes(exportName.toLowerCase())) {
    return null;
  }

  // Candidate story names = union of CSF3 objects + CSF2 args assignments.
  const names = new Set<string>([...storyObjects.keys(), ...argsAssignments.keys()]);
  if (names.size === 0) return null;

  const ordered = [...names].sort((a, b) => rank(a) - rank(b));
  for (const name of ordered) {
    let argsObj: ts.ObjectLiteralExpression | undefined = argsAssignments.get(name);
    if (!argsObj) {
      const obj = storyObjects.get(name);
      const argsProp = obj?.properties.find(
        (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && keyName(p.name) === "args"
      );
      if (argsProp && ts.isObjectLiteralExpression(argsProp.initializer)) argsObj = argsProp.initializer;
    }
    if (!argsObj) continue;
    const json = astToJson(argsObj);
    if (json && typeof json === "object" && !Array.isArray(json) && Object.keys(json).length > 0) {
      return { storyId: name, args: json as Record<string, JsonValue> };
    }
  }
  return null;
}

function rank(name: string): number {
  const i = STORY_PRIORITY.indexOf(name.toLowerCase());
  return i === -1 ? STORY_PRIORITY.length : i;
}

function keyName(n: ts.PropertyName): string | null {
  return ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) ? n.text : null;
}
