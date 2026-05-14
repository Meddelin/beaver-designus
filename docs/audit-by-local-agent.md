# Audit instruction — for a local AI agent inside the DS perimeter

> **You are a read-only audit agent.** Your only job is to compare two real design system repos against the assumptions baked into this project's manifest pipeline, and write **one** markdown report with your findings. You do not modify any source file, you do not run `npm run manifest:build`, you do not push code. If you discover a mismatch, you describe it; you do not fix it.

This document is the entire brief. It is self-contained — there is no other place to look for what "the assumptions" are. Every assumption that matters is enumerated below in `§ Checklist`.

---

## 0. Inputs you have

1. **This repository** — the beaver-designus source tree. You can read any file here. Authoritative starting points:
   - `ARCHITECTURE.md` — the long-form spec, especially §3 (manifest schema) and §3.2 (the five-stage extraction pipeline).
   - `manifest.config.json` — the contract the pipeline reads.
   - `packages/manifest/src/` — the actual scanner code. Walk it; the comments name every assumption it bakes in.
   - `shared/types.ts` — `PropEntry` / `SlotPolicy` / `ManifestEntry` shapes.
2. **Two DS repos** the operator hands you (the actual Beaver + react-ui-kit, or whatever the company calls them). You read these, you don't write to them either.

## 1. Output you produce

**Exactly one file:** `docs/audit-report.md`, in this repository. Nothing else. No code edits, no commits, no new scripts, no manifest builds, no library installs.

Structure (you can extend, but these sections are required):

```markdown
# DS audit report — <date>

## Verdict
One of:
- ✅ Clean — pipeline will scan both DSes without manual fixes.
- ⚠️ Workarounds needed — pipeline will scan but some entries will land with placeholder data; one paragraph why and which.
- ❌ Blocking gaps — pipeline cannot extract a coherent manifest until one or more code changes ship.

## DSes scanned
| id | path | commit/version | top-level layout |
| --- | --- | --- | --- |
| beaver | <abs path> | <git describe / package.json version> | <`packages/*` ? something else?> |
| react-ui-kit | <abs path> | <…> | <…> |

## Checklist findings
One bullet per check from §3 below. Format:
- **<check-id>** — `[ok]` / `[partial]` / `[gap]` — one-line evidence (path + line number where possible).

## Required code changes
Only items that block extraction. Each:
- Where (file path)
- What the current code expects
- What the DS actually looks like
- Smallest viable fix (one-line description, not a patch)

## Nice-to-have
Items that won't block but would improve coverage (richer docs, more examples, etc.).

## Raw notes
Anything else worth noting — unusual TS patterns, internal-only packages to skip, license oddities.
```

Stop after writing this file. **Do not invoke the manifest build.** Do not run tests. Do not edit any code.

## 2. Working procedure

1. **Read `ARCHITECTURE.md` §3 and §3.2 end to end.** This is the contract — your audit is per-assumption against this contract.
2. **Read the source of every file under `packages/manifest/src/`.** The comments at the top of each file describe what's assumed. Cross-reference with §3.2 stages 1–5 + 4b.
3. **Walk both DS repos top-down.** Use the checklist below as your traversal plan.
4. **Write `docs/audit-report.md` and exit.**

You may run any read-only command: `ls`, `cat`, `grep`, `git log`, `git status`, package-manager show commands. You may **not** run anything that installs packages, builds the manifest, opens the daemon, modifies a file, or pushes anywhere.

## 3. Checklist

Each item names a specific pipeline assumption. For each, find evidence (a file path, a regex hit, a missing thing) and mark `[ok]` / `[partial]` / `[gap]`. The check id is what you write in the report bullet.

### A. Repository layout (Stage 1 — discovery)

- **A1** — DS root is a monorepo with components under `<componentRoot>/<package>/package.json`. `manifest.config.json` defaults `componentRoot` to `packages` for both DSes. Verify: does the DS use `packages/<name>/package.json`? `pnpm-workspace.yaml`? `lerna.json`? Reference: `packages/manifest/src/scan/discovery.ts`.
- **A2** — Each component package has an entry point (`package.json` `main`/`module`/`exports`). The scanner uses this to find the canonical declaration file. Verify: open 3–5 packages and confirm `main` or `exports` resolves to a TS file under `src/`.
- **A3** — Re-export chains. The scanner follows `export { X } from "./..."` and `export * from "./..."` recursively. Verify: pick a package that re-exports across files; confirm the chain terminates at the actual definition.
- **A4** — Single canonical declaration per symbol. The scanner dedupes by `exportName`. Verify: are there packages that export the same name twice (e.g. via two different paths)? If yes, the manifest will collapse them to one — note which one wins.
- **A5** — Are there packages you should explicitly **exclude** from scanning? Internal-only utility packages, test helpers, deprecated. List them. The pipeline currently scans everything except packages whose name contains `design-tokens` (handled by Stage 4b). If the DS has other internal packages, the agent's selector context will be polluted unless they're filtered.

### B. Prop extraction (Stage 2)

- **B1** — Prop types are extractable via TypeScript compiler API walking the component file. The scanner is in `packages/manifest/src/props/extract.ts`. It looks for either:
  - a typed first parameter (`(props: Props) => ...` or `(props: { variant: 'a' | 'b' }) => ...`), OR
  - a typed `React.FC<Props>` / `React.FunctionComponent<Props>`,
  - or a hooked-up `forwardRef<Ref, Props>`.
  
  Verify: pick 3 components of each shape and confirm the type is *statically* reachable. Note: if your DS uses HOCs (`withSomething(Component)`) or generic factories, the type chain breaks — `kind: "unsupported"` lands on every prop.
- **B2** — Supported kind expressions:
  - keyword types `string`, `number`, `boolean` → primitive kinds.
  - literal types `"primary" | "secondary"` → `literal-union`.
  - `React.ReactNode` (or `ReactNode` imported) → `react-node` (drives slot inference).
  - `keyof typeof <ns>['<key>']` where `<ns>` is a re-exported namespace from `design-tokens` → `token-reference`. **The reconciler is in `tokens/extract.ts`**; the prop extractor flags candidates and the build orchestrator confirms group existence.
  - Function types → `callback`.
  - Anything else → `unsupported` (omitted from tool-use validation, kept visible in explainer).
  
  Verify: scan 10 random components, classify what *fraction* of their props fall into "unsupported". A high rate (>30 %) means a lot of agent-invisible surface — note in the report.
- **B3** — JSDoc on the type / member is used as fallback `description` when MDX/Storybook is missing. Verify: do components ship with JSDoc? If yes, descriptions will at least be non-empty even without MDX.
- **B4** — Required vs optional is read from TS `?:` marker. Verify a couple. (Almost always works; mention only if something weird like `Partial<…>` wrappers exist.)
- **B5** — Default values. The extractor reads default values from `function Foo({ tone = "neutral" })` destructure patterns and from JSDoc `@default`. Verify: pick 2 components with defaults and confirm the extracted `defaultValue` would match.

### C. Slot policy (Stage 4)

- **C1** — `children: ReactNode` → `{kind: "components"}`. Verify a couple.
- **C2** — `children: string` → `{kind: "text-only"}`. Verify; this is unusual but real (e.g. `<Heading>` typically wants string children only). Confirm whether the DS has this pattern.
- **C3** — Absent `children` → `{kind: "none"}`. Verify with an atom that doesn't allow children (e.g. `<Input>`).
- **C4** — Named-slot detection. The inferencer flags props whose **type** is `ReactNode` (and whose **name** is not `children`) as named slots (`navigation`, `subheader`, `actions`, etc.). Verify: does your DS use this pattern? Or does it expect children-as-functions, render-props, JSX-children-with-displayName matching, or something else? If "something else", the manifest will record those slots as plain `react-node` props and the agent won't know they're addressable as slots.

### D. Docs source (Stage 3)

- **D1** — MDX docs. The pipeline expects Docusaurus-shape MDX at `<pkg>/docs/*.mdx` (the `docsRoot` config field is a glob). Frontmatter `title` (or first H1) matches the component `exportName`. Code fences with `tsx`/`jsx`/`ts`/`js` lang become `examples`.
  
  Verify: where does your DS actually keep docs? Is it Docusaurus, Storybook, Markdown-only, MDX with custom plugins, no docs? Per how many components have MDX vs not.
- **D2** — Storybook fallback. The pipeline parses `<pkg>/src/**/*.stories.{ts,tsx}` via TS compiler API if MDX missed. Reads default-export `meta.title` / `meta.argTypes[*].description`. Reads named-export bodies as code examples.
  
  Verify: does your DS ship `*.stories.tsx`? CSF v3 (`Meta<typeof X>` + `StoryObj<typeof X>`) is what's parseable; older CSF v1/v2 will fall through.
- **D3** — JSDoc on the component declaration is the cheapest fallback. Note coverage.
- **D4** — Override path. `manifest-overrides/<ds-id>/<package>.overrides.json` files merge into the extracted entries. Top-level fields replace; `props` array is name-merged (so an override can patch a single prop's `kind` or `description`). Verify: does any non-trivial subset of the DS need overrides to look right? This is acceptable; just list them so the operator can author the overrides.

### E. Tokens (Stage 4b, runs once per DS that sets `tokenRoot`)

This is the most schema-specific stage. The pipeline assumes:

- **E1** — A single package (configured as `tokenRoot`, e.g. `packages/design-tokens`) is the canonical token source.
- **E2** — Each token namespace ships as **paired files**: `<namespace>.d.ts` + `<namespace>.js`. The `.d.ts` declares a TS `namespace` re-exporting one or more bindings (e.g. `export namespace animation { export { curve }; }`). The `.js` exposes the same objects at runtime.
  
  Verify: does your real `design-tokens` package follow this layout? Or does it ship single-file ESM, CSS variables, JSON-only, or something else? If "something else", **the entire Stage 4b pipeline does not run** and the operator must either restructure the package or write a custom extractor variant.
- **E3** — Variant axis vocabulary. Leaf values in `.js` are objects keyed by axis-leaf names — the architecture pinned the grammar at `(desktop|mobile)(dark)?value`. The grammar is configurable via `manifest.config.json` but defaults to that exact regex.
  
  Verify: what axis-leaf vocabulary does your real DS use? Same `desktopvalue` / `desktopdarkvalue` / `mobilevalue` / `mobiledarkvalue`? Or `light` / `dark` only? Or device-shaped? Mismatch → grammar must be customized.
- **E4** — Cross-DS token reconciliation. Beaver components reference `react-ui-kit`'s tokens via `keyof typeof animation['curve']`-style expressions. The extractor handles this via TS type inspection (priority 1) → manual override (priority 2) → convention map (priority 3, opt-in). 
  
  Verify: how do Beaver props actually reference react-ui-kit tokens? Direct TS imports of the namespace? Local aliases? String-typed props with runtime validation? Type-erased to `string`? If type-erased, the reconciler gets nothing useful and overrides become mandatory.
- **E5** — CSS variable naming convention. The synthesizer writes `--<namespace>-<binding>-<variant>` per token (e.g. `--animation-curve-expressive-standard`). Beaver's runtime is assumed to read those names. Verify the convention matches — or that Beaver's own runtime CSS variables are named the same way. If different, the preview will render with default-browser values for affected props.

### F. Component map regeneration (post-manifest, ahead of preview)

- **F1** — Each package in the DS exports its public components from `package.json`'s `main`/`module`/`exports`. The hand-authored `component-map.ts` does `import { X } from "<package>";` after Vite resolves it. Verify that every DS package's public surface is importable from its package name (not a deep import that requires a specific build step). If a component lives at a deep path the manifest builder happily records the id, but `component-map.ts` may not be able to import it cleanly.

### G. Browser run-readiness

- **G1** — Does the DS ship CSS the consumer needs to import? (e.g. `import "@react-ui-kit/styles/index.css"`). If yes, list which packages — `web/src/main.tsx` will need an `import` for each.
- **G2** — Any peer-dependency assumptions? React 18 specifically? styled-components? emotion? If the DS uses CSS-in-JS that requires a provider at the root, the preview must mount that provider. Note it.

### H. Performance / scale sanity

- **H1** — Estimate: total number of exported components across both DSes. If it's >200, the MCP `inputSchema.enum` for `component` will be large; agent CLI tool-use validators handle large enums but the selector context will need tag-based filtering to stay readable.
- **H2** — Largest single package by component count. If >50 in one package, the per-package JSON file can get big — fine, but noteworthy.

## 4. What "good" looks like

A clean audit produces `docs/audit-report.md` with:

- Verdict `✅` and most checklist items `[ok]`.
- A short paragraph naming which 3–5 components were spot-checked at each stage so the operator can reproduce.
- Optional `[partial]` flags for things that work but with caveats (e.g. JSDoc coverage low → descriptions sparse).
- An empty "Required code changes" section.

## 5. What "bad" looks like

A blocking audit produces the same file but with:

- Verdict `❌`.
- 1–3 entries under "Required code changes", each ≤10 lines, naming the exact file in `packages/manifest/src/` to extend and the smallest-viable change. (You don't write the patch; you describe it.)

Common blocking shapes (so you know what to look for):

- DS uses `lerna.json` + non-`packages/` layout → `discovery.ts` needs a new resolver.
- Tokens ship as CSS-only with no TS types → Stage 4b needs an alternative extractor (read CSS variables directly).
- Beaver tokens come from a third package, not the upstream `react-ui-kit` design-tokens → the `tokenRoot` config supports one DS owning tokens; if two DSes both ship tokens, the config schema needs a `tokenRoot[]` list.
- Components are authored as `forwardRef<HTMLElement, Props>` chains the prop extractor can't follow → `props/extract.ts` needs to special-case the pattern.

## 6. Rules of engagement (terse, for fast reference)

1. **Read-only.** No edits to repo files except the one report you create.
2. **No installs.** Don't `npm install`, don't `pnpm i`, don't add deps.
3. **No builds.** Don't run `npm run manifest:build`. The whole point is to predict what would happen if you did.
4. **No network.** You don't need GitHub, the agent's API providers, or anything external. Local file reads only.
5. **One file out.** `docs/audit-report.md`. No supplementary files, no patches.
6. **Be specific.** Every check ends with a file path, a regex hit, or a "not found" with a specific path you looked at.
7. **Stop when done.** Don't propose to "go ahead and fix" anything. The operator decides what to fix, in a separate pass, with a separate agent (or by hand).
