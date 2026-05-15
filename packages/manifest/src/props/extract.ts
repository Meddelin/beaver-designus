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

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import ts from "typescript";
import type { PropEntry, SlotPolicy } from "../types.ts";

/** Library/DOM base types we deliberately do NOT expand when a props
 *  interface `extends` them — they'd flood the manifest with hundreds of
 *  irrelevant HTML/ARIA attributes and never carry app-meaningful required
 *  props. Local/DS-defined bases ARE expanded. */
const HERITAGE_SKIP = new Set([
  "HTMLAttributes",
  "AllHTMLAttributes",
  "DetailedHTMLProps",
  "AriaAttributes",
  "DOMAttributes",
  "SVGAttributes",
  "SVGProps",
  "HTMLProps",
  "CSSProperties",
  "ComponentProps",
  "ComponentPropsWithRef",
  "ComponentPropsWithoutRef",
  "RefAttributes",
  "ClassAttributes",
  "Attributes",
]);

/** Generic wrappers that are transparent — the real props are the first
 *  type argument (e.g. `PropsWithChildren<SimpleTableProps<T>>`). */
const TRANSPARENT_WRAPPERS = new Set(["PropsWithChildren", "PropsWithRef"]);

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

  const propsTypeNode = locatePropsTypeNode(sf, exportName);
  const componentDecl = locateComponentDeclaration(sf, exportName);

  const description = componentDecl ? readJsDoc(componentDecl, src) : "";

  if (!propsTypeNode) {
    return { exportName, description, props: [], childrenShape: "none" };
  }

  // Resolve the props type to a flat member list. Unlike the old
  // local-only deref, this follows cross-file imports (`interface
  // SimpleTableProps` living in ./types.ts), merges `extends` heritage
  // from DS-local bases, and unwraps transparent wrappers like
  // PropsWithChildren<…>. This is what makes generic / split-out props
  // types (the SimpleTable case) yield real required props instead of
  // `props: []` — so the agent never has to hand-author them.
  const members = resolvePropsMembers(declarationFile, sf, propsTypeNode, new Set(), 0);
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

/* Resolve a props TypeNode to a flat list of member signatures.
 *
 * Recursively (depth + seen-set guarded against cycles) handles:
 *  - inline `{ ... }` type literals
 *  - intersections `A & B & { ... }` and parenthesized types
 *  - TypeReference → local `interface X` / `type X` in the same file
 *  - TypeReference → a type imported or re-exported from a RELATIVE module
 *    (`import { SimpleTableProps } from "./types"`, `export * from "./x"`),
 *    resolved on disk and parsed
 *  - interface `extends` heritage — DS-local bases expanded, DOM/React
 *    library bases (HERITAGE_SKIP) skipped
 *  - transparent generic wrappers (`PropsWithChildren<RealProps>`)
 *
 * Generic type arguments are intentionally ignored: we read the declared
 * members of `SimpleTableProps<T>`, so a `data: T[]` member still produces
 * { name:"data", required:true }. That required flag is the whole point —
 * it's what lets the agent (and prop-validator) know the prop exists,
 * instead of the manifest emitting `props: []` and the component crashing
 * at render. No per-component hand-authoring required. */
function resolvePropsMembers(
  filePath: string,
  sf: ts.SourceFile,
  node: ts.TypeNode,
  seen: Set<string>,
  depth: number
): ts.TypeElement[] {
  if (depth > 8) return [];

  if (ts.isParenthesizedTypeNode(node)) {
    return resolvePropsMembers(filePath, sf, node.type, seen, depth + 1);
  }
  if (ts.isTypeLiteralNode(node)) {
    return [...node.members];
  }
  if (ts.isIntersectionTypeNode(node)) {
    const acc: ts.TypeElement[] = [];
    for (const t of node.types) acc.push(...resolvePropsMembers(filePath, sf, t, seen, depth + 1));
    return acc;
  }
  if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) return [];

  const name = node.typeName.text;
  if (HERITAGE_SKIP.has(name)) return [];
  if (TRANSPARENT_WRAPPERS.has(name)) {
    const inner = node.typeArguments?.[0];
    return inner ? resolvePropsMembers(filePath, sf, inner, seen, depth + 1) : [];
  }

  const key = `${filePath}#${name}`;
  if (seen.has(key)) return [];
  seen.add(key);

  const local = findTypeDeclaration(sf, name);
  if (local) return membersOfDeclaration(filePath, sf, local, seen, depth);

  return resolveImportedName(filePath, sf, name, seen, depth) ?? [];
}

function findTypeDeclaration(
  sf: ts.SourceFile,
  name: string
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | null {
  let found: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | null = null;
  ts.forEachChild(sf, (n) => {
    if (found) return;
    if (ts.isInterfaceDeclaration(n) && n.name.text === name) found = n;
    else if (ts.isTypeAliasDeclaration(n) && n.name.text === name) found = n;
  });
  return found;
}

function membersOfDeclaration(
  filePath: string,
  sf: ts.SourceFile,
  decl: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  seen: Set<string>,
  depth: number
): ts.TypeElement[] {
  if (ts.isTypeAliasDeclaration(decl)) {
    return resolvePropsMembers(filePath, sf, decl.type, seen, depth + 1);
  }
  const acc: ts.TypeElement[] = [...decl.members];
  for (const h of decl.heritageClauses ?? []) {
    if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const t of h.types) {
      if (!ts.isIdentifier(t.expression)) continue;
      const baseName = t.expression.text;
      if (HERITAGE_SKIP.has(baseName)) continue;
      const ref = ts.factory.createTypeReferenceNode(baseName, t.typeArguments);
      acc.push(...resolvePropsMembers(filePath, sf, ref, seen, depth + 1));
    }
  }
  return acc;
}

/* `name` not declared locally — see if it's brought in by a relative
 * `import { name }` / `import { orig as name }`, re-exported via
 * `export { name } from "./x"`, or covered by an `export * from "./barrel"`,
 * and recurse into that file. Package (non-relative) specifiers are out of
 * scope — those are third-party and not part of the DS prop surface. */
function resolveImportedName(
  filePath: string,
  sf: ts.SourceFile,
  name: string,
  seen: Set<string>,
  depth: number
): ts.TypeElement[] | null {
  const fromDir = dirname(filePath);
  const barrels: string[] = [];

  for (const st of sf.statements) {
    if (
      ts.isImportDeclaration(st) &&
      st.importClause?.namedBindings &&
      ts.isNamedImports(st.importClause.namedBindings) &&
      ts.isStringLiteral(st.moduleSpecifier)
    ) {
      for (const el of st.importClause.namedBindings.elements) {
        if (el.name.text !== name) continue;
        const orig = el.propertyName?.text ?? el.name.text;
        const hit = recurseIntoModule(fromDir, st.moduleSpecifier.text, orig, seen, depth);
        if (hit) return hit;
      }
    }
    if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          if (el.name.text !== name) continue;
          const orig = el.propertyName?.text ?? el.name.text;
          const hit = recurseIntoModule(fromDir, st.moduleSpecifier.text, orig, seen, depth);
          if (hit) return hit;
        }
      } else {
        barrels.push(st.moduleSpecifier.text);
      }
    }
  }
  for (const spec of barrels) {
    const hit = recurseIntoModule(fromDir, spec, name, seen, depth);
    if (hit) return hit;
  }
  return null;
}

function recurseIntoModule(
  fromDir: string,
  spec: string,
  name: string,
  seen: Set<string>,
  depth: number
): ts.TypeElement[] | null {
  if (!spec.startsWith(".")) return null;
  const file = resolveRelativeModule(fromDir, spec);
  if (!file) return null;
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const tsf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const decl = findTypeDeclaration(tsf, name);
  if (decl) return membersOfDeclaration(file, tsf, decl, seen, depth + 1);
  return resolveImportedName(file, tsf, name, seen, depth + 1);
}

function resolveRelativeModule(fromDir: string, spec: string): string | null {
  const base = resolvePath(fromDir, spec);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    resolvePath(base, "index.ts"),
    resolvePath(base, "index.tsx"),
    resolvePath(base, "index.d.ts"),
    base, // spec already carried an extension
  ];
  for (const c of candidates) {
    if ((c.endsWith(".ts") || c.endsWith(".tsx")) && existsSync(c)) return c;
  }
  return null;
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
    for (const m of resolvePropsMembers(componentFile, sf, propsTypeNode, new Set(), 0)) {
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
