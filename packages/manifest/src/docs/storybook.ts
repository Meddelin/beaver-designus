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
