# Audit playbook — read this end-to-end before touching anything

> You are the audit agent for **beaver-designus** inside a corporate DS perimeter. Your job is to read this repository's manifest-pipeline assumptions, read the operator's two real DS repos, and produce one markdown report that says **whether the pipeline will scan them cleanly** or **which configuration knobs need adjusting**. **You write exactly one file: `docs/audit-report.md`. You touch nothing else.**

---

## TL;DR — the five absolute rules

1. **READ-ONLY.** Every file in this repository AND in the DS repos is read-only to you. You do not edit, append, rename, delete, chmod, or git-add anything except the one report.

2. **NO code.** You don't open a `.ts`, `.tsx`, `.js`, `.mjs`, or `.cjs` file in a write-mode editor. You read them to understand the pipeline; that is the whole purpose. You do not edit them, even if you find a bug. Bugs go in the report — see "Found a real bug?" below.

3. **NO scripts.** You don't `npm install`, don't `npm run manifest:build`, don't `npm run preview:wire`, don't start the dev server. The whole point of this pass is to **predict** what would happen, not to make it happen. The setup-by-local-agent.md playbook is for the bring-up pass; this is the recon pass that comes before.

4. **NO git mutations.** No `git add`, no `git commit`, no `git checkout`, no `git stash`, no branch creation. The worktree must be byte-identical to what you received except for the new `docs/audit-report.md`.

5. **One output file.** `docs/audit-report.md`. Nothing else. No `tests/`, no `scripts/`, no supplementary docs, no patches. If you find yourself creating a second file, stop and re-read this rule.

---

## §0 — what the operator gives you

1. **This repository** at HEAD — read freely.
2. **Two DS repos** the operator hands you (absolute paths). Read freely.

That's it. No CLI binaries needed, no LLM auth, no network — just file reads.

---

## §1 — what "good" output looks like

A clean audit produces `docs/audit-report.md` with **§Verdict = ✅** and most checklist items `[ok]`. The maintainer reads it once and confirms the bring-up pass will succeed without code changes.

A blocking audit produces the same file with **§Verdict = ❌** and 1–3 entries under "Required code changes" — each entry names a specific file under `packages/manifest/src/` and describes (in prose, not patch) the smallest viable fix. **You don't write the patch.** The maintainer ships the fix upstream; the next pass re-runs from a fresh `git pull`.

A partial audit produces **§Verdict = ⚠️** and uses the configuration knobs in §3 below to declare "no code change needed; operator passes this config block".

---

## §2 — output template

Copy this into `docs/audit-report.md` and fill in. Don't add headings, don't remove sections — the maintainer parses by structure.

```markdown
# DS audit report — <YYYY-MM-DD>

## Verdict
One of:
- ✅ Clean — pipeline will scan both DSes without manual fixes.
- ⚠️ Workarounds via config — pipeline will scan, but operator passes a specific manifest.config.json block. Block included below.
- ❌ Blocking gaps — pipeline cannot extract a coherent manifest until one or more code changes ship.

## DSes scanned
| id | path | commit / version | top-level layout |
| --- | --- | --- | --- |
| beaver | <abs path> | <git describe / package.json version> | <`packages/*` ? something else?> |
| react-ui-kit | <abs path> | <…> | <…> |

## Checklist findings
One bullet per check in §3 below. Format:
- **<check-id>** — `[ok]` / `[ok via config]` / `[partial]` / `[gap]` — one-line evidence with file path and line where possible.

## Configuration block to apply
If verdict is ⚠️, paste here the EXACT `manifest.config.json` content the operator should use. No prose around it — just the JSON. Maintainer copy-pastes verbatim.
```json
{ ... }
```

## Required code changes
Only if verdict is ❌. Each entry:
- Where (file path)
- What the current code expects (cite the relevant function / line)
- What the DS actually looks like (cite the DS file / line)
- Smallest viable fix (one paragraph, prose, NOT a patch)

Empty if verdict is ✅ or ⚠️.

## Nice-to-have
Items that don't block but would improve coverage. One bullet each.

## Raw notes
Anything else worth recording — unusual patterns, deprecated packages to skip, license oddities, internal scopes.

## Spot-check summary
- Components inspected: <names + paths>
- Stories inspected: <paths>
- Docs inspected: <paths>
- Tokens inspected: <namespace files>
```

---

## §3 — the checklist (read every check; emit a bullet for each)

### A. Repository layout (Stage 1 — discovery, `packages/manifest/src/scan/discovery.ts`)

- **A1** — DS root is a monorepo with components under `<componentRoot>/<package>/package.json`. Common values: `packages` (Beaver-style), `packages/components` (react-ui-kit-style). What does THIS DS use?
- **A2** — Each component package has an entry point (`package.json` `main`/`module`/`exports`). Spot-check 3–5 packages — does each resolve to a TS file under `src/`?
- **A3** — Re-export chains terminate. Pick a package that re-exports across files (`index.ts → ./button → ./button-desktop.tsx`); confirm the chain ends at the actual definition. `export * from "./..."` is supported by the pipeline as of 2026-05-14 fix.
- **A4** — Aggregator packages. Some DSes re-export from `@scope/components/<x>` AND from `@scope/<x>`. The pipeline dedupes by exportName; the first hit wins. Note if any DS has this pattern.
- **A5** — Internal-only packages to exclude. List every directory under `<componentRoot>/` that is **not** a UI component (analytics, hooks, core, deprecated, internal-*, etc.). These become `excludePackages` in `manifest.config.json`.

### B. Prop extraction (Stage 2, `packages/manifest/src/props/extract.ts`)

Note: as of 2026-05-14 the extractor recognises `forwardComponent<E, Props>(cb)`, `createX<Props>(hook)`, `forwardRef<R, P>(cb)`, `React.FC<Props>` variable-annotation, and dereferences local `interface XProps` / `type XProps`. If your DS uses one of these, expect `[ok]`. If something else, expect `[gap]`.

- **B1** — Component shape. forwardRef chain? createButton factory? Plain function? Document one example each.
- **B2** — Supported kind expressions:
  - `string` / `number` / `boolean` keywords
  - `"a" | "b" | "c"` literal unions
  - `React.ReactNode`
  - `keyof typeof <ns>.<member>` → token-reference (requires the dot)
  - `keyof typeof BareIdent` → `unsupported` (operator overrides)
  - function types → `callback`
  - everything else → `unsupported`
  
  Spot-check 10 random components, classify what fraction of their props fall into "unsupported". A high rate (>30%) is informational — note in the report.
- **B3** — JSDoc on prop members. Coverage is fallback for descriptions when MDX is absent.
- **B4** — Required vs optional via `?` marker.
- **B5** — Default values from `function Foo({ x = "a" })` destructure patterns and `@default` JSDoc.

### C. Slot policy (Stage 4)

- **C1** — `children: ReactNode` → `{kind: "components"}`.
- **C2** — `children: string` → `{kind: "text-only"}` (rare; note if present).
- **C3** — No children prop → `{kind: "none"}`.
- **C4** — Named slots: any prop typed `ReactNode` whose name isn't `children` becomes a named slot. Does the DS use this pattern? If it uses render props (`renderHeader={(args) => <X/>}`) or `children-as-function`, those won't be inferred and need override files.

### D. Docs source (Stage 3)

- **D1** — MDX. Where does the DS keep MDX? Per-package `<pkg>/docs/`? DS-level `auto-doc/docs/patterns/<Category>/<Component>/.../*.mdx`? Both? Multiple roots are supported via `docsRoot: string[]`. Ancestor-directory name matching is supported (a file at `auto-doc/docs/patterns/Navigation/SideNavigation/01/01.mdx` matches `exportName=SideNavigation`).
- **D2** — Storybook CSF. Parsed as fallback when MDX is absent. Looks for `*.stories.{ts,tsx}`, reads default-export `meta.argTypes[*].description`, captures named-export bodies as code examples.
- **D3** — JSDoc on the component declaration. Cheapest fallback.
- **D4** — Override files. None ship by default; `npm run manifest:scaffold-overrides` will emit blank skeletons for components with sparse descriptions or unsupported props. **Don't author overrides yourself in this audit pass** — note in the report which components would need them, that's it.

### E. Tokens (Stage 4b, `packages/manifest/src/tokens/extract.ts`)

- **E1** — Single design-tokens package per DS, configured via `tokenRoot`.
- **E2** — Paired `<namespace>.d.ts` + `<namespace>.js` files with `export namespace <ns> { export { <binding> }; }` shape.
- **E3** — Leaf-key vocabulary. Default grammar matches `^(?<surface>desktop|mobile)(?<theme>dark)?value$` (lowercase). Real DSes often use PascalCase 3-surface (`desktopValue`/`iosDarkValue`/`androidValue`). Configure via `tokenAxisGrammar.pattern` in `manifest.config.json` — quote the exact pattern the operator should paste.
- **E4** — Cross-DS token reference. How do Beaver components reference react-ui-kit tokens? Direct TS imports of the namespace? Local aliases? String-typed and reconciled at runtime? Type-erased cases need overrides — name them.
- **E5** — CSS variable naming. Default emitter writes `--<namespace>-<binding>-<variant>`. If DS runtime expects a different convention, configure `tokenCssVarPattern`.

### F. Component map (post-`manifest:build`)

- **F1** — Every package's public surface is importable from its package name (not a deep build-only path). If a component lives at a path like `@beaver-ui/button/dist/Button` and that's the ONLY way to import it, note it in the report — the auto-generated `component-map.ts` will need to skip that package.

### G. Browser run-readiness

- **G1** — DS-shipped CSS (**styles config — drives `manifest.config.json` `designSystems[].styles`, NOT a code edit**). Determine, per DS:
  - **`globalStylesheets`**: the CSS the DS expects a consumer to import ONCE — a reset/base/layout sheet or an aggregated bundle (look for the DS's own docs "import `@x/styles.css`", a top-level `styles.css`/`dist/index.css`, or a `./styles` export). Give the exact paths **relative to the DS root**. If components fully self-import their own `.module.css` and need no global sheet, say so and leave it `[]`.
  - **`cssStrategy`**: detect how component CSS is authored — `*.css.ts`/`@vanilla-extract/css` dep → `vanilla-extract`; `@linaria/*`/`@wyw-in-js` → `linaria`; `styled-components`/`@emotion` dep → `runtime-css-in-js`; `.module.css` → `modules`. `auto` self-detects but quote the value you'd hard-set if detection looks wrong. **vanilla-extract/linaria need a maintainer-installed Vite plugin — flag that explicitly in the report.**
  - **`postcssConfig`**: if the DS compiles CSS with nesting/custom-media/mixins via its own `postcss.config.*`, give that path (relative to DS root) so the preview reuses it.
- **G2** — React provider requirements. If the DS needs a root `<ThemeProvider>` / `<DesignSystemProvider>`, note it. The bring-up agent will need to add it (and the maintainer has to expand the playbook to cover it — flag in the report).

### H. Scale

- **H1** — Total components across both DSes. >200 entries means the MCP enum is large but still well within tool-use limits.
- **H2** — Largest package by component count.

---

## §4 — configuration knobs (prefer over code changes)

The pipeline already exposes config for most "real DS doesn't match assumptions" cases. **If your finding maps to one of these, mark `[ok via config]` and quote the JSON block.** Reserve `[gap]` / `❌ Blocking` for shapes that truly need a code change.

| If you find… | Mark `[ok via config]`, quote: | In `manifest.config.json` `designSystems[*]` |
|---|---|---|
| Non-component infra packages | `"excludePackages": ["analytics", "hooks", "core", "internal-*"]` | filter |
| Docs at non-default path / multiple paths | `"docsRoot": ["auto-doc/docs/patterns", "docs"]` | extend |
| PascalCase / 3-surface token leaf keys | `"tokenAxisGrammar": { "pattern": "^(?<surface>desktop\|ios\|android)(?<theme>Dark)?Value$", "defaultSurface": "desktop", "defaultTheme": "light" }` | extend |
| Different CSS var naming on DS runtime | `"tokenCssVarPattern": "--tui-{namespace}-{binding}-{variant}"` | extend |
| DS needs a global stylesheet / has a CSS strategy (components render unstyled without it) | `"styles": { "globalStylesheets": ["dist/index.css"], "cssStrategy": "modules", "postcssConfig": "postcss.config.cjs" }` | extend |
| Corporate Qwen fork (this is for setup, not audit, but if you spot constraints note them) | edits go into `runtimes.config.json` (NOT `manifest.config.json`). Format: `{ "runtimes": { "qwen": { "bin": "qwen-corp.exe", "buildArgs": [...] } } }`. See `runtimes.config.example.json` for the full shape. | dedicated file |
| Per-prop kind override (loose typing, type-erased) | per-package `manifest-overrides/<ds>/<package>.overrides.json` | n/a (handled at build time) |

---

## §5 — found a real bug? do this

If during reading you find a real bug in the pipeline source (e.g. `discoverSymbols` doesn't handle some legitimate re-export pattern that exists in the DS), **do NOT edit the file**. Write into `docs/audit-report.md`'s `## Required code changes`:

```
- File: packages/manifest/src/scan/discovery.ts
- Function: walkFile (around line N)
- Expected: handles `export * from "./foo"` re-exports
- Observed: `.cache/beaver-ui/packages/header/src/index.ts` uses `export *` and the resulting manifest contains zero entries for that package
- Repro: open packages/header/src/index.ts, see line 1; then check manifest-data/beaver/header.json (would be empty)
- Smallest viable fix (prose): walkFile should recursively follow ExportDeclaration nodes that have no exportClause (i.e. `export * from "X"`), pulling target file exports into the same collected list.
```

The maintainer ships the fix upstream. The next audit/bring-up pass works from a fresh `git pull`.

**You do not write a patch. You do not edit the file. The point of this pass is to surface, not to fix.**

---

## §6 — final reminders

1. **You're the recon team, not the bring-up team.** Predict, don't act.
2. **Read freely, write nothing.** Except `docs/audit-report.md`.
3. **No `npm install`, no `npm run *`, no scripts.** All inferences are static from reading source.
4. **No git mutations.** Worktree byte-identical except for the one report.
5. **Single output file.** Stop after writing it.
6. **A bug found is reported, not fixed.** That's the whole game. The patches you write locally get clobbered on the next `git pull` — surface the issue with enough detail that the maintainer fixes it once, upstream, with tests.
