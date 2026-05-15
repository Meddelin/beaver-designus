// Stage 3 (P2) — derive a canonical `usage` for a component: a nodeId-free
// prototype seed the agent starts from. Three tiers, best-first:
//   1. Storybook story `args`  (storybook.ts → extractStoryArgs)
//   2. MDX first-JSX-usage     (mdx.ts → findJsxUsage)
//   3. synthesized from PropShape  (this file)
//
// Everything here is STATIC — no eval, no DS code executed. Story/MDX
// values that aren't statically representable as JSON (arrow fns, JSX,
// helper calls like columnHelper.accessor(...)) are simply dropped from
// the seed, and the tier degrades gracefully.

import ts from "typescript";
import type { ComponentUsage, JsonValue, PropEntry, PropShape } from "../types.ts";

/* Static AST → JSON. Returns undefined for anything not representable
 * (caller treats undefined as "omit this key/element"). Never throws. */
export function astToJson(node: ts.Expression): JsonValue | undefined {
  switch (node.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return (node as ts.StringLiteralLike).text;
    case ts.SyntaxKind.NumericLiteral:
      return Number((node as ts.NumericLiteral).text);
    case ts.SyntaxKind.TrueKeyword:
      return true;
    case ts.SyntaxKind.FalseKeyword:
      return false;
    case ts.SyntaxKind.NullKeyword:
      return null;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return -Number(node.operand.text);
  }
  if (ts.isParenthesizedExpression(node)) return astToJson(node.expression);
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return astToJson(node.expression);
  if (ts.isIdentifier(node)) {
    if (node.text === "undefined" || node.text === "NaN" || node.text === "Infinity") return undefined;
    return undefined; // a referenced binding — not statically known
  }
  if (ts.isArrayLiteralExpression(node)) {
    const out: JsonValue[] = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el) || ts.isOmittedExpression(el)) continue;
      const v = astToJson(el);
      if (v !== undefined) out.push(v);
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: { [k: string]: JsonValue } = {};
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) continue; // skip shorthand/spread/methods
      const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)
        ? p.name.text
        : null;
      if (key === null) continue;
      const v = astToJson(p.initializer);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return undefined;
}

/* Parse a standalone JS expression string (an MDX attribute expression like
 * `[{ id: 1 }]`) into JSON, statically. */
export function parseExprToJson(text: string): JsonValue | undefined {
  const sf = ts.createSourceFile("__expr.tsx", `const __x = (${text});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const stmt = sf.statements[0];
  if (stmt && ts.isVariableStatement(stmt)) {
    const init = stmt.declarationList.declarations[0]?.initializer;
    if (init) return astToJson(init);
  }
  return undefined;
}

/* Minimal valid value for a prop shape. undefined = "can't / needn't seed
 * this one" (functions, react-node, opaque refs). Arrays seed empty — the
 * prototype renders an empty list rather than fabricating fake rows. */
export function synthesizeFromShape(shape: PropShape | undefined, depth = 0): JsonValue | undefined {
  if (!shape || depth > 5) return undefined;
  switch (shape.t) {
    case "string": return "";
    case "number": return 0;
    case "boolean": return false;
    case "literal": return shape.value;
    case "enum": return shape.options[0];
    case "array": return [];
    case "tuple": return shape.items.map((s) => synthesizeFromShape(s, depth + 1) ?? null);
    case "record": return {};
    case "union": return synthesizeFromShape(shape.variants[0], depth + 1);
    case "object": {
      const out: { [k: string]: JsonValue } = {};
      for (const f of shape.fields) {
        if (f.optional) continue;
        const v = synthesizeFromShape(f.shape, depth + 1);
        if (v !== undefined) out[f.name] = v;
      }
      return out;
    }
    default:
      return undefined; // function | react-node | ref | unknown
  }
}

/* Orchestrate the three tiers into a ComponentUsage (or undefined when
 * nothing — including synthesis — yields a useful seed). */
export function buildUsage(
  id: string,
  props: PropEntry[],
  story: { storyId: string; args: Record<string, JsonValue> } | null,
  mdxAttrs: Record<string, JsonValue> | null
): ComponentUsage | undefined {
  if (story && Object.keys(story.args).length > 0) {
    return { tree: { component: id, props: story.args }, source: "storybook", storyId: story.storyId };
  }
  if (mdxAttrs && Object.keys(mdxAttrs).length > 0) {
    return { tree: { component: id, props: mdxAttrs }, source: "mdx" };
  }
  const synth: Record<string, JsonValue> = {};
  for (const p of props) {
    if (!p.required) continue;
    const v = synthesizeFromShape(p.shape);
    if (v !== undefined) synth[p.name] = v;
  }
  if (Object.keys(synth).length > 0) {
    return { tree: { component: id, props: synth }, source: "synthesized" };
  }
  return undefined;
}
