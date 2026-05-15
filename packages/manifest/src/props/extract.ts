// Stage 2 — Prop-signature extraction via TS compiler API.
//
// For each (component file, export name) we:
//  1. Locate the component declaration.
//  2. Find its props type — either the type of the props parameter, or an
//     adjacent `interface <Name>Props` / `type <Name>Props`.
//  3. For each property, classify into PropEntry.kind:
//       - literal-union  (string/number/boolean literal type union)
//       - string / number / boolean
//       - react-node     (ReactNode / ReactElement)
//       - token-reference (resolved later in §3.2 stage 4b reconcile)
//       - unsupported
//  4. Capture JSDoc per property + the leading JSDoc on the component
//     declaration (used as description fallback in stage 3).

import { readFileSync } from "node:fs";
import ts from "typescript";
import type { PropEntry, SlotPolicy } from "../types.ts";

export interface ExtractedComponent {
  /** Export name we matched on. */
  exportName: string;
  /** JSDoc on the component declaration (description fallback). */
  description: string;
  /** Properties from the props type. */
  props: PropEntry[];
  /** Whether the component accepts children, and how — drives stage 4. */
  childrenShape: "none" | "react-node" | "string";
}

const REACT_NODE_NAMES = new Set([
  "ReactNode",
  "ReactElement",
  "React.ReactNode",
  "React.ReactElement",
  "JSX.Element",
]);

export function extractComponent(declarationFile: string, exportName: string): ExtractedComponent | null {
  const src = readFileSync(declarationFile, "utf8");
  const sf = ts.createSourceFile(declarationFile, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  let propsTypeNode = locatePropsTypeNode(sf, exportName);
  const componentDecl = locateComponentDeclaration(sf, exportName);

  const description = componentDecl ? readJsDoc(componentDecl, src) : "";

  // If propsTypeNode is a TypeReference (e.g. `ButtonProps`), try to
  // dereference it to the matching interface/type-alias in the same file.
  // Without this, `interface XProps { ... }` declared next to the component
  // produces zero extracted props because collectMembers can't unwrap
  // TypeReferenceNode.
  if (propsTypeNode && ts.isTypeReferenceNode(propsTypeNode)) {
    const dereffed = dereferenceLocalType(sf, propsTypeNode);
    if (dereffed) propsTypeNode = dereffed;
  }

  if (!propsTypeNode) {
    return { exportName, description, props: [], childrenShape: "none" };
  }

  const members = collectMembers(propsTypeNode);
  const props: PropEntry[] = [];
  let childrenShape: ExtractedComponent["childrenShape"] = "none";

  for (const m of members) {
    if (!ts.isPropertySignature(m) || !ts.isIdentifier(m.name)) continue;
    const name = m.name.text;
    const required = !m.questionToken;
    const kind = classifyType(m.type);
    const jsdoc = readJsDoc(m, src);

    if (name === "children") {
      childrenShape = kind.type === "react-node" ? "react-node" : kind.type === "string" ? "string" : "none";
      continue;
    }
    // Treat slot-named props (React.ReactNode-typed) as named slots — captured separately in stage 4.
    if (kind.type === "react-node") continue;

    props.push({
      name,
      kind,
      required,
      description: jsdoc,
    });
  }

  return { exportName, description, props, childrenShape };
}

function locateComponentDeclaration(sf: ts.SourceFile, exportName: string): ts.Node | null {
  let found: ts.Node | null = null;
  ts.forEachChild(sf, (n) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === exportName) found = n;
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === exportName) found = d;
      }
    }
  });
  return found;
}

function locatePropsTypeNode(sf: ts.SourceFile, exportName: string): ts.TypeNode | null {
  const ifaceName = `${exportName}Props`;
  let found: ts.TypeNode | null = null;

  // Prefer the interface/alias by name.
  ts.forEachChild(sf, (n) => {
    if (found) return;
    if (ts.isInterfaceDeclaration(n) && n.name.text === ifaceName) {
      // Synthesize a TypeLiteralNode-like wrapper so callers get a Node with `members`.
      found = ts.factory.createTypeLiteralNode(n.members);
    }
    if (ts.isTypeAliasDeclaration(n) && n.name.text === ifaceName) {
      found = n.type;
    }
  });
  if (found) return found;

  // Fallback: walk to the component declaration and pull props from various
  // call/variable/forwardRef shapes used by real DSes.
  const decl = locateComponentDeclaration(sf, exportName);
  if (decl && ts.isFunctionDeclaration(decl) && decl.parameters[0]?.type) {
    return decl.parameters[0].type;
  }
  if (decl && ts.isVariableDeclaration(decl)) {
    // 1. `const X: React.FC<Props> = (...)` / `const X: FunctionComponent<Props> = (...)`
    //    The type annotation carries the props as its last type argument.
    if (decl.type && ts.isTypeReferenceNode(decl.type) && decl.type.typeArguments?.length) {
      const last = lastTypeReference(decl.type.typeArguments);
      if (last) return last;
    }

    const init = decl.initializer;

    // 2. `const X = forwardComponent<'button', Props>((props, ref) => ...)`
    //    `const X = createButton<Props>(useButton)`
    //    `const X = forwardRef<Ref, Props>((props, ref) => ...)`
    //    `const X = styled(Base)<Props>` — and other HOC-call patterns.
    //    Pull the LAST TypeReferenceNode out of the call's type arguments;
    //    this skips HTML-element string literals like `'button'` while
    //    landing on the actual props type.
    if (init && ts.isCallExpression(init) && init.typeArguments?.length) {
      const last = lastTypeReference(init.typeArguments);
      if (last) return last;
    }

    // 3. Direct callback initializer (no HOC): `const X = (props: Props) => ...`
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
      const param = init.parameters[0];
      if (param?.type) return param.type;
    }

    // 4. HOC-call whose first argument IS the arrow component
    //    (`const X = styled.div(...)((props: Props) => ...)`).
    if (init && ts.isCallExpression(init) && init.arguments.length) {
      for (const arg of init.arguments) {
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
          const p0 = arg.parameters[0];
          if (p0?.type) return p0.type;
        }
      }
    }
  }
  return null;
}

/* Walk type arguments right-to-left and return the first TypeReferenceNode or
 * TypeLiteralNode. Skips literal-type args used for HTML-element discriminators
 * (`forwardComponent<'button', Props>`). */
function lastTypeReference(args: readonly ts.TypeNode[]): ts.TypeNode | null {
  for (let i = args.length - 1; i >= 0; i--) {
    const a = args[i];
    if (ts.isTypeReferenceNode(a) || ts.isTypeLiteralNode(a) || ts.isIntersectionTypeNode(a)) return a;
  }
  return null;
}

/* Resolve a TypeReferenceNode (e.g. `ButtonProps`, `Props`) to the matching
 * `interface X {}` or `type X = {...}` declared earlier in the same source
 * file. Returns the unwrapped TypeNode (a TypeLiteralNode for interfaces, the
 * aliased type for type-aliases). One-level resolution only; if the alias
 * points at another TypeReference, the caller may recurse manually.
 *
 * Tracks bindings declared by NamedImports separately — for `import { Props
 * } from "./types"` we don't follow cross-file (yet); operators handle that
 * via overrides. */
function dereferenceLocalType(sf: ts.SourceFile, ref: ts.TypeReferenceNode): ts.TypeNode | null {
  const name = ref.typeName.getText();
  let found: ts.TypeNode | null = null;
  ts.forEachChild(sf, (n) => {
    if (found) return;
    if (ts.isInterfaceDeclaration(n) && n.name.text === name) {
      // Include heritage clauses' members would be nice, but TS gives us only
      // the interface's own member list here. Cross-interface inheritance
      // (`extends OtherProps`) drops props — operator overrides cover it.
      found = ts.factory.createTypeLiteralNode(n.members);
    }
    if (ts.isTypeAliasDeclaration(n) && n.name.text === name) {
      found = n.type;
    }
  });
  return found;
}

function collectMembers(typeNode: ts.TypeNode): readonly ts.TypeElement[] {
  if (ts.isTypeLiteralNode(typeNode)) return typeNode.members;
  // Intersection — flatten one level.
  if (ts.isIntersectionTypeNode(typeNode)) {
    const acc: ts.TypeElement[] = [];
    for (const t of typeNode.types) acc.push(...collectMembers(t));
    return acc;
  }
  return [];
}

function classifyType(typeNode: ts.TypeNode | undefined): PropEntry["kind"] {
  if (!typeNode) return { type: "unsupported", raw: "any" };

  // Strip ReadonlyArray / Array wrappers? Not needed for v1 — we accept the inner type as-is.

  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return { type: "string" };
  if (typeNode.kind === ts.SyntaxKind.NumberKeyword) return { type: "number" };
  if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) return { type: "boolean" };

  if (ts.isLiteralTypeNode(typeNode)) {
    const lit = typeNode.literal;
    if (ts.isStringLiteral(lit)) return { type: "literal-union", options: [lit.text] };
    if (ts.isNumericLiteral(lit)) return { type: "literal-union", options: [Number(lit.text)] };
    if (lit.kind === ts.SyntaxKind.TrueKeyword)  return { type: "literal-union", options: [true] };
    if (lit.kind === ts.SyntaxKind.FalseKeyword) return { type: "literal-union", options: [false] };
  }

  if (ts.isUnionTypeNode(typeNode)) {
    const opts: Array<string | number | boolean> = [];
    let allLiterals = true;
    for (const t of typeNode.types) {
      if (ts.isLiteralTypeNode(t)) {
        const lit = t.literal;
        if (ts.isStringLiteral(lit)) opts.push(lit.text);
        else if (ts.isNumericLiteral(lit)) opts.push(Number(lit.text));
        else if (lit.kind === ts.SyntaxKind.TrueKeyword) opts.push(true);
        else if (lit.kind === ts.SyntaxKind.FalseKeyword) opts.push(false);
        else allLiterals = false;
      } else if (
        t.kind === ts.SyntaxKind.UndefinedKeyword ||
        t.kind === ts.SyntaxKind.NullKeyword
      ) {
        // skip — already encoded by `?` optionality.
      } else {
        allLiterals = false;
      }
    }
    if (allLiterals && opts.length) return { type: "literal-union", options: opts };
    // Mixed string-keyword + literal? Treat as bare string.
    if (typeNode.types.some((t) => t.kind === ts.SyntaxKind.StringKeyword)) return { type: "string" };
    return { type: "unsupported", raw: typeNode.getText() };
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName.getText();
    if (REACT_NODE_NAMES.has(name) || name.endsWith(".ReactNode") || name.endsWith(".ReactElement")) {
      return { type: "react-node" };
    }
    // keyof typeof <ns>['<key>']  — caught as token-reference in §3.2 stage 4b reconcile. Mark for now.
    if (name === "keyof") return { type: "unsupported", raw: typeNode.getText() };
    // The token-reference pattern in source is actually `keyof typeof spacing.scale` (TypeOperator).
    return { type: "unsupported", raw: typeNode.getText() };
  }

  if (ts.isTypeOperatorNode(typeNode) && typeNode.operator === ts.SyntaxKind.KeyOfKeyword) {
    // `keyof typeof <expr>` — operand is a TypeQueryNode.
    //
    // We only auto-classify as token-reference when the expression is a
    // member access (`<namespace>.<key>`). Bare identifiers
    // (`keyof typeof SPACING_ALIAS`) fall through to `unsupported`, since
    // we can't tell from one file whether the const is a token-namespace
    // member or just a local literal-key map (`createTextSizes`, etc.).
    //
    // The operator turns these into the right kind via a per-prop entry
    // in `manifest-overrides/<ds>/<package>.overrides.json`:
    //   { kind: { type: "literal-union", options: [...] } }   // local map
    //   { kind: { type: "token-reference", group: "color.brand" } }   // token
    const operand = typeNode.type;
    if (ts.isTypeQueryNode(operand)) {
      const exprName = operand.exprName.getText();
      if (exprName.includes(".")) {
        return { type: "token-reference", group: exprName };
      }
      return { type: "unsupported", raw: `keyof typeof ${exprName}` };
    }
    return { type: "unsupported", raw: typeNode.getText() };
  }

  return { type: "unsupported", raw: typeNode.getText() };
}

function readJsDoc(node: ts.Node, source: string): string {
  // Manual JSDoc read — ts.getJSDocCommentsAndTags is reliable but pulls more
  // than we want; for our short single-paragraph descriptions a simple
  // scan is enough.
  const start = node.getFullStart();
  const stop = node.getStart();
  const lead = source.slice(start, stop);
  const match = lead.match(/\/\*\*([\s\S]*?)\*\//);
  if (!match) return "";
  return match[1]
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim();
}

/**
 * Stage 4 — infer the SlotPolicy from the extracted shape.
 *
 * Rule: any prop whose type is `ReactNode` becomes a named slot. If the
 * component accepts `children: ReactNode`, that's a `components` slot policy
 * (the default unnamed slot). If neither exists, `{kind: "none"}`.
 */
export function inferSlotPolicy(
  componentFile: string,
  exportName: string,
  childrenShape: ExtractedComponent["childrenShape"]
): SlotPolicy {
  const src = readFileSync(componentFile, "utf8");
  const sf = ts.createSourceFile(componentFile, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const propsTypeNode = locatePropsTypeNode(sf, exportName);
  const slotNames: string[] = [];
  if (propsTypeNode) {
    for (const m of collectMembers(propsTypeNode)) {
      if (!ts.isPropertySignature(m) || !ts.isIdentifier(m.name)) continue;
      const name = m.name.text;
      if (name === "children") continue;
      const kind = classifyType(m.type);
      if (kind.type === "react-node") slotNames.push(name);
    }
  }

  if (slotNames.length > 0) {
    const slots: Record<string, SlotPolicy> = {};
    for (const n of slotNames) slots[n] = { kind: "components" };
    return { kind: "named-slots", slots };
  }
  if (childrenShape === "react-node") return { kind: "components" };
  if (childrenShape === "string") return { kind: "text-only" };
  return { kind: "none" };
}
