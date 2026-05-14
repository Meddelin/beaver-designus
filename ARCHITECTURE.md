# beaver-designus — architecture (v1)

> Final architecture for a local-first, LLM-orchestrated UI prototyping tool that emits prototypes built exclusively from the target design systems' components. v1 targets the **paired T-Bank DSes**: Beaver (organisms — tables, navigation, subheaders, complex objects) layered on top of an upstream `react-ui-kit` (atoms + design tokens). The doc is committed before any code; M0 in §14 is the next session's first job.

---

## 1. Product summary

beaver-designus is a desktop-class tool for designers and PMs to produce **UI prototypes** built only from components of the configured design systems. The user talks to it in a browser; a local CLI daemon runs the agent and serves the preview. The agent does not write JSX — it calls a constrained tool surface (`placeComponent`, `setProp`, `finishPrototype`) whose `component` argument is enumerated from a precomputed manifest spanning every configured DS, so the output tree is structurally incapable of containing off-palette components. The preview is rendered from the live DS code, not a screenshot.

**Two design systems are first-class in v1**, with distinct contributions:

- **Beaver** (`@beaver-ui/*`) — organisms: tables, navigation, subheaders, page-level "objects". Higher-level composites the user typically thinks at.
- **`react-ui-kit`** — the upstream atomic system: Buttons, Inputs, Checkboxes, plus all design tokens (animation, color, spacing — §3.1.1). Beaver is layered on top; both ship to consumers and both are valid composition targets for our prototypes.

The composer picks the right level per intent: when a Beaver organism fits ("a transactions table"), it uses Beaver; when only an atom suffices ("a confirm button in the empty state"), it uses `react-ui-kit` directly. The selector skill (§5) carries the heuristic; the manifest tags each entry with its `sourceSystem` and a category hint so the LLM can reason about level.

v1 success looks like: a user describes "a customer profile screen with a top nav, a card grid, and a CTA"; the agent asks one or two clarifying questions; the preview shows a composition that uses Beaver's nav + card organisms over `react-ui-kit`'s button atom, renders correctly with real components, applies the upstream's tokens; the user clicks any component and gets a grounded "what / why this one" answer tied to the manifest entry, including which DS it came from.

v1 ships against **these two DSes only**. Adding a third (or detaching to a single one) is the seam at the `manifest.config.ts` `designSystems[]` array (§11) — no code change beyond a new config block and a manifest rebuild.

## 2. System topology

```
+--------------------------- local machine ---------------------------------+
|                                                                           |
|   [ web UI ]                                  [ daemon ]                  |
|   Vite + React 18                  TS, Node 20+, Express, better-sqlite3  |
|   ├─ home / project list   ┌── HTTP+SSE (localhost only) ───────┐         |
|   ├─ chat surface  <──────►│   POST /api/sessions                │         |
|   ├─ preview surface       │   GET  /api/sessions/:id/events SSE │         |
|   │   (renders real Beaver)│   POST /api/sessions/:id/message    │         |
|   └─ manifest browser      │   POST /api/sessions/:id/cancel     │         |
|                            │   GET/POST/PATCH/DELETE /api/projects        |
|                            │   GET  /api/manifest, /api/manifest/:id      |
|                            └────────────┬─────────────────────────┘       |
|                                         │                                  |
|              ┌──────────────────────────┴──────────────────────────┐      |
|              │  daemon internals                                   │      |
|              │   - projects-store (better-sqlite3, §6.4 schema)    │      |
|              │   - sessions (active CLI subprocess, SSE subs)      │      |
|              │   - agent-loop (per turn: pick RuntimeAgentDef,     │      |
|              │       spawn CLI, pipe stdin, parse streamFormat)    │      |
|              │   - mcp-tools-server  (stdio JSON-RPC; placeComp/   │      |
|              │       setProp/removeNode/finish/getComponent)       │      |
|              │   - manifest-server  (loads ./manifest-data/*.json) │      |
|              │   - skills-loader  (./skills/*/SKILL.md)            │      |
|              └────────────────────────┬───────────────────────────┘      |
|                                       │ spawn (per turn)                  |
|                                       ▼                                   |
|       ┌─────────────────────────────────────────────────────────┐        |
|       │  user's local code-agent CLI subprocess                 │        |
|       │  default: Qwen Code fork  (qwen --yolo -)               │        |
|       │  secondary: Claude Code   (claude -p --stream-json)     │        |
|       │  reads prompt on stdin, runs its own tool-use loop,     │        |
|       │  calls our MCP server (via .beaver-designus/mcp.json)   │        |
|       │  for placeComponent/setProp/... — that's where the      │        |
|       │  DS-only enum constraint lives.                         │        |
|       │  Owns its own API credentials; daemon never sees them.  │        |
|       └─────────────────────────────────────────────────────────┘        |
|                                                                           |
|   [ manifest builder ]  (offline CLI; same daemon binary, `manifest build`)|
|   ├─ uses @beaver-designus/manifest (extracted from dscan)                |
|   ├─ loops over manifest.config.ts `designSystems[]`                      |
|   ├─ for each DS: reads source + Docusaurus MDX + Storybook (if present)  |
|   ├─ runs token extraction against DSes with `tokenRoot` set              |
|   └─ writes ./manifest-data/<system>/<package>.json + index.json + tokens.*|
|                                                                           |
+---------------------------------------------------------------------------+

         │
         ▼  (DS sources, fetched once each)
┌─────────────────────────────────────────────────────────────────────────┐
│  Beaver repo            ── organisms                                    │
│  react-ui-kit repo      ── atoms + design tokens (the upstream Beaver   │
│                            is built on top of)                          │
│  Both cloned via lifted dscan/src/ops/git.ts                            │
│  Local-path overrides via BEAVER_LOCAL_PATH / REACT_UI_KIT_LOCAL_PATH   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Process boundaries.** Four processes when a turn is running: (1) the daemon, always-on; (2) the web UI in any browser; (3) the manifest builder, invoked offline as the same daemon binary's `manifest build` subcommand; (4) the agent CLI subprocess, spawned per turn by the daemon. The agent loop runs **inside the user's local CLI**, not in-process — rationale and the consequences for tool delivery in §10. The browser never touches the LLM directly.

Process responsibilities:
- **Daemon** owns persistent project state (SQLite), serves SSE events, serves manifest JSON, hosts the in-daemon MCP tools server the spawned CLI connects to, and spawns the agent CLI per turn.
- **Web UI** is a home screen (project list) + conversational pane + live preview. Renders the prototype tree using imported Beaver components.
- **Agent CLI subprocess** is the LLM workhorse. Owns its credentials. Issues `placeComponent`/`setProp`/`finishPrototype` calls via MCP back to the daemon.
- **Manifest builder** is an offline pipeline. Outputs JSON to a versioned `manifest-data/` directory in the repo. Re-run when Beaver upgrades.

## 3. Component manifest — the heart of the system

The manifest is the only contract between the DS and the agent. Every constraint that makes a prototype "DS-only" derives from it. Everything in §4 leans on §3 being correct.

### 3.1 Schema

```ts
// packages/manifest/src/types.ts
export interface ManifestEntry {
  /** Stable id used by tool-use: `<sourceSystem>:<package>/<exportName>`, e.g.
   *  "beaver:@beaver-ui/side-navigation/SideNavigation" or
   *  "react-ui-kit:@react-ui-kit/button/Button". The `sourceSystem` prefix
   *  matters because nothing forbids the two DSes from sharing a package or
   *  symbol name (Beaver could re-export a wrapped `Button`); the prefix
   *  disambiguates and keeps the MCP enum unique. */
  id: string;
  /** Which configured DS this entry came from. Matches a `designSystems[].id`
   *  in `manifest.config.ts`. v1 vocabulary: "beaver" | "react-ui-kit". */
  sourceSystem: string;
  /** Coarse level hint surfaced to the selector skill. "organism" for Beaver
   *  components, "atom" for react-ui-kit components, "molecule" reserved for
   *  the rare cross-cutting case. The default per-system comes from the
   *  `categoryHint` in the DS config; per-entry overrides land here. */
  category: 'atom' | 'molecule' | 'organism';
  /** Display name as written in JSX, e.g. "Button", "Form.Item". */
  name: string;
  /** Import package, e.g. "@beaver-ui/side-navigation". Always the canonical
   *  package, never an aggregator — canonicalized via dscan's reExports. */
  packageName: string;
  /** Symbol on the canonical package: "Button", "default", "IconButton". */
  exportName: string;
  /** Human one-liner. Pulled from Docusaurus MDX > Storybook description >
   *  JSDoc on the component declaration. Used by selector + UI tooltips. */
  description: string;
  /** Prop signature, extracted from TS source. See §3.1.1. */
  props: PropEntry[];
  /** Children policy. Drives validation of `children:` in a tool call. */
  slots: SlotPolicy;
  /** Worked usage snippets the LLM sees when this entry is in selector context.
   *  Sourced from MDX code-fences (priority 1) > Storybook stories > hand
   *  overrides; otherwise []. */
  examples: ExampleSnippet[];
  /** Free-form tags ("form", "navigation", "feedback") for selector filtering.
   *  The DS-level categoryHint ("organism" for Beaver) gets duplicated here as
   *  a tag so a single filter pass picks up both per-entry and per-DS signals. */
  tags: string[];
  /** Source pointer for the explainer; never shown raw to the user. */
  source: { file: string; line: number };
}

export interface PropEntry {
  name: string;
  /** Discriminated union of supported prop kinds. Anything that doesn't
   *  fit goes into `kind: "unsupported"` and is omitted from tool-use
   *  validation but still shown in the explainer. */
  kind:
    | { type: "literal-union"; options: Array<string | number | boolean> }   // "primary" | "secondary"
    | { type: "string" }
    | { type: "number" }
    | { type: "boolean" }
    | { type: "react-node" }                                                  // children-like
    | { type: "callback"; signature: string }                                 // onClick, onChange
    | { type: "unsupported"; raw: string };                                   // complex/generic; agent can't set
  required: boolean;
  description: string;
  defaultValue?: string;
}

export type SlotPolicy =
  | { kind: "none" }                                       // no children allowed
  | { kind: "text-only" }                                  // string children only
  | { kind: "components"; allowedComponents?: string[] }   // arbitrary child components
  | { kind: "named-slots"; slots: Record<string, SlotPolicy> };
```

Field-by-field justification (every field is here because the LLM needs it; nothing speculative):

- **`id`** — the only string the LLM ever names. Stable across Beaver minor versions because it's keyed to the canonical package, not the aggregator.
- **`name`** — what the preview renders as JSX. Distinct from `id` so `<Form.Item>` is one entry while preserving JSX shape.
- **`packageName` + `exportName`** — let preview-runtime construct a static import map at build time.
- **`description`** — shown to the **selector** agent in context. Single most important field for component picking.
- **`props`** — the constraint surface. Tool-use validates incoming props against this.
- **`slots`** — children/slot policy. Without this the LLM hallucinates `children` for `<Input>` (invalid).
- **`examples`** — gives the composer few-shot anchors. Cuts manifest token cost vs. forcing prose descriptions.
- **`tags`** — selector-side filtering before context inclusion. Keeps context budget bounded for large DSes.
- **`source`** — needed by the **explainer** to quote real prop/JSDoc text. Never streamed to the user verbatim; the explainer paraphrases.

### 3.1.1 Design tokens — a sibling shared by both DSes

`react-ui-kit` is shipped as `react-ui-kit/packages/{components,core,design-tokens,styles,utils}` and is both an atom-component source (§1) **and** the home of all design tokens. Beaver components consume those same tokens by name. Tokens are therefore a single shared resource at extraction time — one `TokenManifest`, applied to both DSes' components when the preview renders.

The `design-tokens` package ships tokens as **paired JS + TS-declaration files** — one pair per token namespace:

```
react-ui-kit/packages/design-tokens/
├── animation.js        // values
├── animation.d.ts      // types — declares `export namespace animation { export { curve }; }`
├── color.js
├── color.d.ts
├── spacing.js
├── spacing.d.ts
└── ...
```

The `.d.ts` files use the TS `namespace` pattern. A token (e.g. `animation.curve.expressive-standard`) is **two-axis**:

- **Variant** — the named key inside the namespace's leaf group (`expressive-standard`, `expressive-snappy`, …).
- **Platform/theme** — leaf-level keys (`desktopvalue`, `desktopdarkvalue`, `mobilevalue`, `mobiledarkvalue`, …) glued into the variant value, encoding two real axes (surface × theme).

```ts
// animation.d.ts
export namespace animation {
  export { curve };
}
declare const curve: {
  "expressive-standard": {
    desktopvalue: string;
    desktopdarkvalue: string;
    mobilevalue: string;
    mobiledarkvalue: string;
  };
  "expressive-snappy": { /* same shape */ };
}
```

```js
// animation.js  (matching runtime values)
const curve = {
  "expressive-standard": {
    desktopvalue: "cubic-bezier(0.2, 0, 0, 1)",
    desktopdarkvalue: "cubic-bezier(0.2, 0, 0, 1)",
    mobilevalue: "cubic-bezier(0.4, 0, 0.2, 1)",
    mobiledarkvalue: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
  /* ... */
};
module.exports = { animation: { curve } };
```

Two model-level consequences for our manifest:

1. **The LLM picks a variant, not a leaf value.** Beaver prop types reference `keyof animation['curve']`, not the full leaf object. So the constraint enum is the *variant names*, not the platform/theme keys.
2. **The preview resolves the platform/theme axes once at boot**, not per node. The agent is unaware of which surface/theme combo the preview is rendering against — that's a preview-time choice, not a prototype-time choice.

Tokens live in a **separate sibling** to the component manifest, not inside `ManifestEntry`. Two reasons: (a) different lifecycle (a Beaver upgrade can leave tokens untouched; a token upgrade can ripple through every entry), and (b) one token table applies to *every* component, so embedding the same table in each entry is duplicative.

```ts
// packages/manifest/src/types.ts (continued)

/** One file: manifest-data/tokens.json. */
export interface TokenManifest {
  /** Version string of the upstream DS at extraction time (git-describe-style). */
  upstreamVersion: string;

  /** Every token group, keyed by its TS path. A "group" is the address the
   *  LLM picks variants from. Examples: "animation.curve", "color.brand",
   *  "spacing.scale". The path matches a `keyof typeof <namespace>['<key>']`
   *  expression in Beaver's prop types — this is exactly how the reconciler
   *  (stage 4b) matches a prop to a group. */
  groups: Record<string, TokenGroup>;

  /** Axes the upstream encodes (parsed out of the leaf-key vocabulary). For
   *  this upstream: [{id: 'surface', values: ['desktop','mobile']},
   *  {id: 'theme', values: ['light','dark']}]. */
  axes: TokenAxis[];

  /** Cross-product of axis values. One TokenAxisCombo is exactly one CSS
   *  bundle the preview can apply. */
  combos: TokenAxisCombo[];

  /** Default combo id; v1 preview always uses this one. */
  defaultComboId: string;             // e.g. "surface=desktop.theme=light"
}

export interface TokenGroup {
  /** Dot-path: "animation.curve", "color.brand", … */
  path: string;
  /** Human description for the explainer. Pulled from JSDoc on the namespace
   *  if present; falls back to the path. */
  description: string;
  /** The names the LLM picks. */
  variants: TokenVariant[];
}

export interface TokenVariant {
  /** Variant name as written in the upstream — quoted strings preserved.
   *  E.g. "expressive-standard", "primary", "4". */
  name: string;
  /** Resolved value per axis-combo id. Axis-less tokens (e.g. a flat
   *  `space.4 = "8px"`) have one entry keyed by ''. */
  values: Record<string, string>;     // {"surface=desktop.theme=light": "cubic-bezier(...)", …}
  /** CSS custom property name the preview writes for this variant.
   *  For "animation.curve.expressive-standard":
   *    "--animation-curve-expressive-standard". */
  cssVar: string;
  /** Short description if the upstream ships per-variant docs. */
  description?: string;
}

export interface TokenAxis { id: string; values: string[]; }
export interface TokenAxisCombo {
  id: string;                          // canonical: "axis1=value1.axis2=value2"
  selections: Record<string, string>;  // {surface: "desktop", theme: "light"}
}
```

And a new `PropEntry.kind` variant for token-typed props:

```ts
// inside PropEntry.kind union (§3.1):
| { type: "token-reference"; group: string }      // group matches a TokenGroup.path
```

When the MCP tool builds its `inputSchema` (§4.2, §10), token-reference props get `enum: [...groups[group].variants.map(v => v.name)]`. A Beaver prop typed `curve?: keyof typeof animation['curve']` becomes structurally restricted to the upstream's actual variant names; the LLM cannot emit a raw cubic-bezier string into it. Same enforcement mechanism that pins `component` to manifest ids, just applied to a different generated enum per session.

### 3.1.2 What is *not* in the manifest

Deliberate omissions:
- Token *theming* (light/dark/brand variants applied at runtime by the preview). v1 renders against the default token set only; multi-theme is a flip condition, see §13.
- Accessibility metadata. The DS owns this; we don't re-audit.
- Visual snapshots. The preview is the visual; we don't ship PNGs.
- "Composition recipes" (e.g. "card with header + footer"). The composer learns these from examples + skill body; codifying them as a separate manifest field would harden patterns prematurely.

### 3.2 Extraction pipeline

```
[ Two DS repos on disk: Beaver + react-ui-kit (cloned per manifest.config.ts) ]
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────┐
│ STAGE 1 — Discovery + symbol surfacing  (LIFTED from dscan)        │
│                                                                    │
│   For EACH entry in designSystems[]:                               │
│     dscan/src/prescan/beaver.ts ── prescanBeaver()                 │
│     dscan/src/resolve/ts-resolver.ts ── createTsResolver()         │
│     dscan/src/ops/git.ts ── gitClone(), gitDescribe()              │
│                                                                    │
│   prescanBeaver() is named for the original product but its        │
│   contract is generic — discover packages, parse their entry       │
│   files, build the re-export map. We run it twice, once per DS,    │
│   keyed by sourceSystem id. The function does not require Beaver-  │
│   specific assumptions (confirmed by reading                       │
│   dscan/src/prescan/beaver.ts:108-129 — it just walks packages/    │
│   for any monorepo using `packages/<pkg>/package.json`).           │
│                                                                    │
│   Output: Map<sourceSystem, BeaverRegistry>                        │
│   Each BeaverRegistry: { packages, exports, reExports }            │
│   (dscan/src/types/prescan.ts:5-34)                                │
│                                                                    │
│   Cross-system collision check (NEW): if the same (packageName,    │
│   exportName) pair surfaces in both registries, that's expected —  │
│   Beaver legitimately re-exports some react-ui-kit symbols. Both   │
│   entries land in the manifest under their sourceSystem-prefixed   │
│   ids; the selector skill (§5) carries the heuristic for which     │
│   wrapper to prefer.                                               │
└────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────────────┐
│ STAGE 2 — Prop-signature extraction  (NEW code — gap dscan doesn't │
│ fill; the fixture `Button.ts` at tests/fixtures/beaver-ui/packages/│
│ button/src/Button.ts:1 stores props as a bare type literal, and    │
│ dscan never reads it)                                              │
│                                                                    │
│   For each (package, exportName) in BeaverRegistry:                │
│     resolve canonical source file using the reExports map +        │
│     ts-resolver, then run react-docgen-typescript against it.      │
│   Falls back to a hand-authored prop override if the component     │
│   uses a generic / HOC pattern react-docgen-typescript can't       │
│   walk through.                                                    │
│                                                                    │
│   Output: Map<id, RawPropSignature>                                │
└────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────────────┐
│ STAGE 3 — Examples + descriptions                                  │
│                                                                    │
│   Beaver ships Docusaurus documentation INSIDE the DS repo (typical│
│   layout: <repo>/docs/, <repo>/website/, or <repo>/<pkg>/docs/     │
│   containing MDX files with prop tables and live code blocks).     │
│   That's a richer description+example source than JSDoc or         │
│   Storybook stories: real prose, real prop tables, real curated    │
│   snippets that the DS team already maintains for human readers.   │
│                                                                    │
│   Source priority (first hit wins per entry):                      │
│                                                                    │
│     1. Docusaurus MDX. Walk the docs root, find files whose        │
│        frontmatter or first H1 names a manifest entry. Extract:    │
│         - description: the first prose paragraph before the first  │
│           prop table / code block.                                 │
│         - examples: every fenced ```tsx / ```jsx code block whose  │
│           code contains the entry's JSX name; lightly normalize    │
│           imports.                                                 │
│         - tags: from MDX frontmatter (`tags:`, `sidebar_category`),│
│           or inferred from the docs folder path                    │
│           (`docs/forms/Input.mdx` → tag `forms`).                  │
│        Implementation: parse MDX with `@mdx-js/mdx`'s AST mode;    │
│        we only read frontmatter + code-fence nodes — no JSX        │
│        evaluation, so we don't drag in the Docusaurus runtime.     │
│                                                                    │
│     2. Storybook CSF. If <pkg>/src/**/*.stories.tsx exists, parse  │
│        default-export ArgTypes + named-export Stories. Same        │
│        treatment as before — still a useful fallback when a        │
│        Beaver component has stories but no MDX doc page.           │
│                                                                    │
│     3. JSDoc on the component declaration. Cheapest, weakest.      │
│                                                                    │
│   Then merge with manifest-data/<package>.overrides.json, which    │
│   always wins. Overrides are how we handle:                        │
│     - components with no docs page yet,                            │
│     - examples that need hand-pruning of unwanted props,           │
│     - description language tweaks for the LLM selector context.    │
│                                                                    │
│   This is the ONLY stage that gracefully degrades. The other       │
│   stages must succeed; an entry with no docs/no stories/no JSDoc   │
│   still ends up in the manifest — just with description="" and     │
│   examples=[] until an override is authored.                       │
└────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────────────┐
│ STAGE 4 — Slot policy inference                                    │
│                                                                    │
│   From the prop signature: if `children` is `ReactNode` or         │
│   variations → `{kind: "components"}`. If `children` is `string`   │
│   → `{kind: "text-only"}`. If absent → `{kind: "none"}`. Named-slot│
│   patterns ("renderHeader", "leftIcon"-style props) become         │
│   `{kind: "named-slots"}` — heuristic, override-able via the same  │
│   overrides file as stage 3.                                       │
└────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────────────┐
│ STAGE 4b — Token extraction (parallel sub-pipeline)                │
│                                                                    │
│   Reads the upstream DS source (configured via `manifest.config.ts`│
│   `upstream.path` or `upstream.gitUrl`, separate from Beaver). The │
│   upstream shape is fixed: a `design-tokens/` package with paired  │
│   `<namespace>.js` + `<namespace>.d.ts` files (e.g. animation.js + │
│   animation.d.ts).                                                 │
│                                                                    │
│   STEP 1 — Discover token namespaces.                              │
│     readdir(upstreamPath/packages/design-tokens), pair every       │
│     `<name>.d.ts` with its sibling `<name>.js`. Skip orphans.      │
│                                                                    │
│   STEP 2 — Parse each .d.ts with the TS compiler API (already      │
│   available — dscan's ts-resolver gives us a configured            │
│   ts.CompilerHost). Walk each namespace declaration:               │
│     - record the namespace name (`animation`).                     │
│     - for every re-exported binding (`export { curve }`), resolve  │
│       the const's type — usually an object type literal.           │
│     - walk that object type. The IMMEDIATE children become token   │
│       **variants** (e.g. "expressive-standard", "expressive-       │
│       snappy"). Their values are themselves object types whose     │
│       property names are the **axis-leaf keys** (desktopvalue,     │
│       desktopdarkvalue, mobilevalue, mobiledarkvalue).             │
│                                                                    │
│     The group path is `<namespace>.<binding>` — e.g.               │
│     "animation.curve". This is what the reconciler matches a       │
│     Beaver prop type against in step 4.                            │
│                                                                    │
│   STEP 3 — Load each .js to fill values. We do NOT vm-sandbox the  │
│   JS — these files are part of the user's own design-tokens        │
│   package, trusted source. We `import` (or `require` via tsx for   │
│   CJS) through the same resolved path, walk the resulting object   │
│   per the .d.ts shape we already parsed, and pair each variant     │
│   leaf value with the axis-leaf key it lived under.                │
│                                                                    │
│   STEP 4 — Axis detection. Collect every axis-leaf key name across │
│   every variant in the upstream (`desktopvalue`, `desktopdarkvalue`│
│   `mobilevalue`, `mobiledarkvalue`, plus any sibling vocabulary).  │
│   Parse each key against the configured axis-key grammar:          │
│                                                                    │
│     manifest.config.ts:                                            │
│       upstream.axisKeyGrammar:                                     │
│         pattern: /^(?<surface>desktop|mobile)(?<theme>dark)?value$/│
│         axes:                                                      │
│           surface: { default: 'desktop' }                          │
│           theme:   { default: 'light', whenMissingGroup: 'light',  │
│                                         whenPresent: 'dark' }      │
│                                                                    │
│   That grammar emits two axes (`surface`, `theme`) with values     │
│   `['desktop','mobile']` and `['light','dark']`. Cross-product →   │
│   four `TokenAxisCombo`s. Default combo id = `surface=desktop.     │
│   theme=light`. The grammar is config-overridable so a future      │
│   upstream that splits axes differently doesn't need code changes. │
│                                                                    │
│   STEP 5 — CSS emission. For each combo, emit                      │
│     manifest-data/tokens.<combo-id>.css                            │
│   containing `:root { --<namespace>-<binding>-<variant>: <value>;` │
│   for every variant resolved against that combo. v1 also writes    │
│   manifest-data/tokens.css as a copy of the default combo so the   │
│   preview's static import resolves without combo-aware bundling.   │
│                                                                    │
│   STEP 6 — Reconciliation: match Beaver props (from Stage 2) to    │
│   token groups. Priority:                                          │
│                                                                    │
│     1. TS type inspection (authoritative). A prop typed            │
│        `curve?: keyof typeof animation['curve']` resolves through  │
│        ts-morph to the symbol `animation.curve`; its containing    │
│        file is in @upstream/design-tokens; we look up              │
│        groups['animation.curve'] and assign kind = {type:          │
│        "token-reference", group: "animation.curve"}.               │
│     2. Hand-authored override (`tokenGroup: "animation.curve"`)    │
│        on the PropEntry in `manifest-data/<package>.overrides.     │
│        json`.                                                      │
│     3. Prop-name convention map as last resort (e.g. `color`→      │
│        any group under `color.*`). Disabled by default; opt-in     │
│        via config when the upstream's TS types are loose.          │
│                                                                    │
│   Output: TokenManifest written to manifest-data/tokens.json;      │
│   `kind: {type: "token-reference", group}` populated on the        │
│   matching PropEntry rows.                                         │
└────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────────────┐
│ STAGE 5 — Write manifest-data/                                     │
│                                                                    │
│   manifest-data/beaver/                  (one subtree per DS)      │
│     @beaver-ui-side-navigation.json                                │
│     @beaver-ui-subheader.json                                      │
│     @beaver-ui-…/overrides.json                                    │
│   manifest-data/react-ui-kit/                                      │
│     @react-ui-kit-button.json                                      │
│     @react-ui-kit-input.json                                       │
│     @react-ui-kit-…/overrides.json                                 │
│   manifest-data/index.json               (all entries from every   │
│                                           DS, flat list, used by   │
│                                           the selector for initial │
│                                           discovery; each row      │
│                                           tagged with              │
│                                           sourceSystem+category)   │
│   manifest-data/tokens.json              (TokenManifest — single,  │
│                                           tokens belong to         │
│                                           react-ui-kit but apply   │
│                                           to both DSes' components │
│                                           at render time)          │
│   manifest-data/tokens.css               (synthesized for the      │
│                                           default combo; the       │
│                                           preview's static-import  │
│                                           target — §7)             │
│   manifest-data/tokens.<combo-id>.css    (one per non-default      │
│                                           combo; v1 doesn't        │
│                                           import them but they're  │
│                                           on disk for the future   │
│                                           combo-picker — §13)      │
└────────────────────────────────────────────────────────────────────┘
```

dscan as it stands collects symbol names and re-export chains for adoption-metric scanning ([beaver.ts:23-80](C:\Users\crash\AppData\Local\Temp\research\dscan\src\prescan\beaver.ts)); it does not look at *prop types* or *tokens*. Stages 2 and 4b are the gaps. We add them as new code in `packages/manifest/`, not a fork of dscan — see §8.

### 3.3 Storage

**Decision: directory of JSON files, one per DS package, organized in per-DS subtrees, plus a flat `index.json` spanning all DSes.**

Considered:
1. Single `manifest.json` — simplest, but every code-review diff churns the whole file; selector context loading is all-or-nothing.
2. SQLite — overbuilt for a corpus that's ~hundreds of entries, hostile to git review, no readable diffs.
3. Flat directory across all DSes — workable but a Beaver upgrade and a react-ui-kit upgrade would show up in mixed diffs.
4. **Per-DS subtree (chosen)** — `manifest-data/beaver/*.json` + `manifest-data/react-ui-kit/*.json`. Each DS upgrade scopes its diff to one subtree; the selector agent can lazy-load only the subtree it needs (e.g. organisms-only for a "give me a table" turn).

Hand-authored override files live as `manifest-data/<system>/<package>.overrides.json` next to the generated file. The build merges generated + overrides at write time. Overrides are committed; generated artifacts are committed too (no `.gitignore`), so a Beaver-less reviewer can sanity-check the agent's component vocabulary.

`manifest-data/index.json` is the single span-all-DSes catalogue the daemon loads at startup. Each row carries `sourceSystem` and `category` so the selector can filter by level (organisms first when the user asks for a "section"; atoms when they ask for a "field") and by DS (e.g. "force this turn to atoms-only" via a session config — out of scope in v1).

### 3.4 Freshness

- **`beaver-designus manifest build`** — full rebuild against `./.cache/beaver-ui` (or `BEAVER_LOCAL_PATH`, same env var dscan honours at [beaver.ts:87](C:\Users\crash\AppData\Local\Temp\research\dscan\src\prescan\beaver.ts)).
- No watch mode in v1. The DS doesn't change while the user is prototyping; coupling the daemon to a Beaver file-watcher introduces a moving target that hurts more than it helps.
- The daemon reads `manifest-data/` once at startup. A future `/api/manifest/reload` is the natural extension point; left out of v1.

## 4. Prototype representation and constraint — second pillar

### 4.1 Representation

A prototype is a tree of immutable nodes:

```ts
// packages/contracts/src/prototype.ts
export interface PrototypeNode {
  /** Stable per-session id, server-allocated. Used by setProp / replyToExplainer. */
  nodeId: string;
  /** ManifestEntry.id — constrained at production time, never free-form. */
  component: string;
  /** Validated against the entry's PropEntry[] before insertion. */
  props: Record<string, JsonValue>;
  /** Only present when SlotPolicy allows it. Order matters. */
  children?: PrototypeNode[];
  /** Optional named slots for `kind: "named-slots"` entries. */
  slots?: Record<string, PrototypeNode[]>;
}

export interface Prototype {
  /** Monotonic; bumped on every tool call so the web UI knows when to re-render. */
  revision: number;
  root: PrototypeNode | null;
}
```

JSON, not JSX, not a serialized React element. Reasons it wins:
- **Validatable.** Every node has a known type and a known prop schema. A bad tree is rejected before it reaches the preview (§7).
- **Inspectable.** The explainer can address any node by `nodeId` without parsing.
- **Transport-free.** Survives the SSE boundary intact and is trivially diff-able for revision-based rendering.
- **Replaces open-design's `<artifact>` text format.** open-design's parser at [apps/web/src/artifacts/parser.ts:1-120](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\web\src\artifacts\parser.ts) reconstructs HTML from streamed text inside `<artifact ...>` tags. That format is fundamentally a text-stream optimised for HTML and markdown, not a structured tree. We drop it.

Alternatives rejected:
- **JSX string** — same complaint as raw HTML: the constraint becomes a regex problem instead of a type problem. Parser ambiguity. The whole point of the project is that we never look at the agent's "markup" intent.
- **React element tree (`React.createElement` calls)** — couples the wire format to React internals and the daemon's runtime. JSON travels.

### 4.2 Constraint mechanism — tool use

**Decision: tool use is the only path that produces a node.** The LLM never emits the tree as text. It can only call:

```ts
// packages/contracts/src/tools.ts
type ManifestComponentId = string;     // enum at runtime: keys of the loaded manifest

interface PlaceComponentInput {
  /** Where to insert. null = create the root (only valid if root is null). */
  parentNodeId: string | null;
  /** If parent has named slots, which one; otherwise omitted. */
  slot?: string;
  /** Append to end of parent's children unless beforeNodeId is set. */
  beforeNodeId?: string;
  /** Constrained at the schema level to keys of the manifest. */
  component: ManifestComponentId;
  /** Validated server-side against the entry's PropEntry[]. */
  props?: Record<string, JsonValue>;
}
interface PlaceComponentOutput { nodeId: string; revision: number }

interface SetPropInput {
  nodeId: string;
  propName: string;
  propValue: JsonValue;
}
interface RemoveNodeInput { nodeId: string }

interface FinishPrototypeInput {
  /** Free-text rationale shown to the user as the assistant's wrap-up turn. */
  summary: string;
}
```

Plus a read-only tool the **explainer** uses (does not mutate state):

```ts
interface GetComponentInput  { id: ManifestComponentId }
interface GetComponentOutput { entry: ManifestEntry }
```

The MCP tools server (§10) advertises `placeComponent` with `inputSchema.properties.component.enum: [...manifest ids]` — built fresh per session from the loaded manifest. This is the constraint by construction. There is no "DS-only" instruction in the prompt; there is no off-grid token the model could emit. Two layers of rejection:
- The agent CLI's own tool-use validator (Qwen Code, Claude Code, and other modern code agents all enforce `inputSchema` before dispatching a tool call) rejects hallucinated enum values inside the CLI subprocess; the call never reaches MCP.
- The daemon's MCP server re-validates the input against the schema and against the per-entry `PropEntry[]` before mutating state. This catches a CLI that incorrectly relaxes schema enforcement, plus prop-shape errors that the schema enum alone wouldn't catch (e.g. a wrong-type literal for a `literal-union` prop).

Why this is stronger than the alternatives:

| Mechanism | Where the constraint lives | Failure mode |
|---|---|---|
| **In-prompt enumeration** ("only use these components: …") | Prompt context | LLM forgets / improvises under long contexts |
| **Post-hoc validation** of LLM-emitted JSX/JSON | After generation | Rejected outputs waste full generations; corrections require re-prompting |
| **Tool use with enum schema** (chosen) | At the tool-call schema layer | Invalid call is structurally impossible; SDK rejects pre-dispatch |

The defense-in-depth validator at the preview boundary (§7) is still there — the daemon's handler still re-validates props against the manifest entry — but it's now backstop, not primary.

### 4.3 Serialization for preview

The tree lives in the daemon (one `Prototype` per session). On every tool call that mutates it, the daemon sends one SSE event:

```ts
type PrototypeSseEvent =
  | { type: "prototype:set-root"; revision: number; root: PrototypeNode }
  | { type: "prototype:patch";    revision: number; patch: TreePatch[] };
```

The web UI subscribes via the same `/api/sessions/:id/events` stream it already uses for chat. It holds the tree client-side and renders it via the **preview-runtime** package (§11). All tree-to-DOM work runs in the **browser** — the daemon doesn't render React. This is the right boundary: it means Beaver itself (a TS/React library) never has to load in Node, and the user can hot-swap a Beaver version in the web UI's package.json without restarting the daemon.

## 5. Agent decomposition

**Decision: one agent loop, one context window, multiple skills loaded conditionally per turn.**

Roles, mapped to skills (skill body is the role's system-prompt fragment, loaded via the open-design SKILL.md convention — [skills.ts:122-274](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\skills.ts)):

| Role | Skill | When loaded | Read-only or mutates state | Justification for being a separate skill (not just a prompt section) |
|---|---|---|---|---|
| **intake** | `skills/intake/SKILL.md` | First turn of a session | Mutates: emits clarifying questions; sets session "intent" | Conversational style + question shapes differ enough from the rest to deserve its own file; can be improved without touching the composer prompt. |
| **selector** | `skills/selector/SKILL.md` | Composer turn, before any `placeComponent` | Read-only: agent uses `getComponent` + filters by `category` and tags | Component-picking heuristics live here — both "which Button variant" (within a DS) and **"organism vs atom"** (across DSes): prefer a Beaver organism when one fits the user's intent ("give me a transactions table" → `@beaver-ui/table/Table`), fall back to a `react-ui-kit` atom only when no organism covers the case ("a confirm button in the empty state" → `@react-ui-kit/button/Button`). The skill body explicitly enumerates this preference order so the LLM doesn't default to atom-shopping when an organism would carry more design intent. |
| **composer** | `skills/composer/SKILL.md` | Composer turn | Mutates: `placeComponent`/`setProp`/`finishPrototype` | The constraint contract belongs in its own skill; couples to tool surface. |
| **explainer** | `skills/explainer/SKILL.md` | User asks "what is this / why this one" | Read-only: `getComponent` | Distinct tone — paraphrasing JSDoc, justifying choice — that should never bleed into the composer's terseness. |

Reasons this is one agent and not four:
- Sharing context is cheap; spinning up four agents means re-serializing the same prototype state four ways, four sets of tool definitions, four prompt-cache warmups.
- A single loop lets the model interleave: ask a clarification (intake), then place a component (composer), then answer "why this" (explainer) — without an orchestrator deciding whose turn it is.
- Every additional agent had to earn its place; none did.

Skill-loading mechanism is the open-design pattern verbatim: when the conditions for a skill are met, the daemon appends its body to the composed system prompt. SKILL.md frontmatter (`name`, `description`, `triggers`, `od.mode: prototype`, `od.platform`, `od.design_system.requires: true`) follows the existing `prototype` mode in their schema — [skills.ts:28](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\skills.ts) lists `prototype` as a first-class mode, validated by the existing `login-flow` skill which uses `od: mode: prototype`.

## 6. CLI ↔ Web UI contract

### 6.1 Operations

```ts
// packages/contracts/src/api.ts

// --- Session lifecycle (ephemeral; backed by SQLite chat-history rows) ---
POST   /api/sessions
       Body: { designSystem: "beaver", projectId?: string }   // projectId = continue an existing project
       → { sessionId: string, projectId: string }

GET    /api/sessions/:id/events            // SSE; event union below.
       Events: ChatMessageEvent | PrototypeSseEvent | StatusEvent | ErrorEvent | EndEvent

POST   /api/sessions/:id/message
       Body: { content: string }
       → 202 { messageId: string }          // streamed via SSE

POST   /api/sessions/:id/cancel
       → { ok: true }

// --- Projects: durable container for a prototype tree + its chat history. ---
GET    /api/projects                       → { projects: ProjectSummary[] }   // for the home screen
POST   /api/projects                       → { project: ProjectSummary }      // create blank
GET    /api/projects/:id                   → { project: Project }             // tree + metadata + recent messages
PATCH  /api/projects/:id                   Body: { title?: string }
       → { project: ProjectSummary }
DELETE /api/projects/:id                   → 204
GET    /api/projects/:id/export.json       → Project (full snapshot)          // user-facing "Export"

// --- Manifest (read-only) ---
GET    /api/manifest                       → { entries: ManifestEntry[] }     // index
GET    /api/manifest/:id                   → ManifestEntry | 404
```

That's everything. Listed for closure, not extension.

### 6.2 Transport

**HTTP + SSE on localhost, adopted from open-design.** [server.ts:2391-2398](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\server.ts) and [contracts/src/sse/chat.ts:63-69](C:\Users\crash\AppData\Local\Temp\research\open-design\packages\contracts\src\sse\chat.ts) show the working pattern: `POST /api/runs` creates a run; `GET /api/runs/:id/events` streams typed SSE frames (`start`, `agent`, `stdout`, `stderr`, `end`). Adopt the shape; substitute our event union. WebSockets would buy us nothing — the stream is one-way agent→UI, the user's input is a discrete POST.

### 6.3 Auth

**None. Localhost-only.** The daemon binds to `127.0.0.1` by default, same convention as open-design's cli.ts:121. No tokens, no CORS hair, no user accounts. v1 is single-user, single-machine. The cost of adding auth later if multi-user is needed is a per-route middleware; the cost of removing it if we ship it now is more.

### 6.4 Persistence model

Prototypes and their chat history are **durable**. Closing the browser or restarting the daemon must not lose work. Storage is SQLite at `~/.beaver-designus/app.sqlite` (Linux/macOS) or `%LOCALAPPDATA%\beaver-designus\app.sqlite` (Windows), via `better-sqlite3`, same shape as open-design's [`apps/daemon/src/db.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\db.ts) at a much smaller scale.

**Schema (v1, four tables):**

```sql
-- One row per saved prototype workspace.
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,           -- ULID
  title         TEXT NOT NULL,              -- user-editable; defaults to "Untitled <n>"
  design_system TEXT NOT NULL DEFAULT 'beaver',
  manifest_rev  TEXT,                       -- which manifest build authored this tree; surfaces drift warnings on load
  created_at    INTEGER NOT NULL,           -- epoch ms
  updated_at    INTEGER NOT NULL
);

-- The current prototype tree, as a serialized JSON Prototype (§4.1). One row per project.
-- We do NOT keep history of the tree across turns in v1 — only the current state.
-- The chat history (next table) records the agent's intent for each revision.
CREATE TABLE prototype_snapshots (
  project_id    TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  revision      INTEGER NOT NULL,           -- monotonic; matches Prototype.revision
  tree_json     TEXT NOT NULL,              -- JSON-stringified Prototype
  updated_at    INTEGER NOT NULL
);

-- Chat turns. Stored append-only so reopening a project replays the conversation.
CREATE TABLE messages (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system-status')),
  content       TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Tool-call audit trail — every placeComponent / setProp / removeNode / finishPrototype.
-- Lets the explainer answer "why this node?" with the actual sequence the composer ran,
-- and lets us reconstruct a tree at any past revision if we ever want time-travel UI.
CREATE TABLE tool_calls (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tool_name     TEXT NOT NULL,              -- "placeComponent" | "setProp" | ...
  input_json    TEXT NOT NULL,
  output_json   TEXT NOT NULL,
  revision_after INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
```

**Write moments:**
- `prototype_snapshots` is rewritten in place on every successful tool call that mutates the tree. Single row per project; no migration concerns from history sprawl.
- `messages` appends per user turn and per assistant turn (one row per role, content is the final assembled text).
- `tool_calls` appends per tool invocation as it lands.
- `projects.updated_at` bumps on any of the above.

**Read moments:**
- `GET /api/projects` selects `id, title, updated_at, manifest_rev` from `projects` ordered by `updated_at DESC`.
- `GET /api/projects/:id` joins all four tables: project metadata, current `prototype_snapshots.tree_json`, last N (default 50) messages, last N tool_calls.
- `POST /api/sessions` with a `projectId` rehydrates the in-memory `Prototype` from `prototype_snapshots.tree_json` and replays the message history into the agent's transcript before the first new turn.

**Migrations.** v1 ships migration 0001 = the four tables above. Later migrations follow open-design's [`apps/daemon/src/legacy-data-migrator.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\legacy-data-migrator.ts) pattern (numbered SQL files run in order at daemon boot). No need to design beyond that in v1.

**Drift handling.** When loading a project saved against an older `manifest_rev`, the daemon checks current manifest entry ids against the tree. If any node references a component id that no longer exists, the preview shows the `UnknownComponentFallback` chip (§7.1) and the chat surfaces a one-line notice. We never silently drop nodes; the user decides whether to fix the project or re-export to a new project.

## 7. Preview rendering

**Decision: bundle Beaver into the web UI bundle as a peer dependency; render the prototype tree client-side via a static component map.**

Considered:
1. **Bundle DS into web UI (chosen).** Beaver components run in the browser as the user sees them; no rendering server, no iframe boundary, no version-skew between preview and prototype.
2. **Iframe a Storybook instance.** Decouples preview from web UI build but ties us to whatever stories exist; component composition outside what a story already shows (the whole point of the product) becomes awkward.
3. **Dynamic ESM import per component.** Cute, but Beaver is a workspace with many packages and CJS+ESM build outputs; making this work for every package adds a build step that gives nothing over option 1.
4. **Server-side render in daemon.** Adds React to the Node side, doubles versions, complicates Beaver's CSS-in-JS / theming runtime. No upside given the prototype lives in the browser anyway.

Implementation sketch:

```ts
// packages/preview-runtime/src/component-map.ts (GENERATED at web-app build time
// from manifest-data/index.json — never hand-edited)
import * as BeaverNav from '@beaver-ui/side-navigation';
import * as BeaverSubheader from '@beaver-ui/subheader';
import * as BeaverTable from '@beaver-ui/table';
// ...
import * as KitButton from '@react-ui-kit/button';
import * as KitInput from '@react-ui-kit/input';
// ...
export const COMPONENT_MAP: Record<string, React.ComponentType<unknown>> = {
  // Beaver organisms — sourceSystem prefix in the key matches ManifestEntry.id.
  'beaver:@beaver-ui/side-navigation/SideNavigation':  BeaverNav.SideNavigation,
  'beaver:@beaver-ui/subheader/Subheader':              BeaverSubheader.Subheader,
  'beaver:@beaver-ui/table/Table':                      BeaverTable.Table,
  // react-ui-kit atoms.
  'react-ui-kit:@react-ui-kit/button/Button':           KitButton.Button,
  'react-ui-kit:@react-ui-kit/input/Input':             KitInput.Input,
  // ...
};
```

`apps/web/package.json` lists both `@beaver-ui/*` (workspace or registry) and `@react-ui-kit/*` as peer-ish dependencies. The component-map generator emits one `import` per package referenced in `manifest-data/index.json`, keyed by `<sourceSystem>:<id>` so the rendering path is one constant-time lookup.

```ts
// packages/preview-runtime/src/render.tsx
export function renderNode(node: PrototypeNode): React.ReactNode {
  const Comp = COMPONENT_MAP[node.component];
  if (!Comp) return <UnknownComponentFallback id={node.component} />; // defense in depth
  const children = node.children?.map((c) => <RenderNode key={c.nodeId} node={c} />);
  return <Comp {...(node.props as object)}>{children}</Comp>;
}
```

**Token loading.** Beaver components consume the upstream's tokens through CSS custom properties — the upstream's JS module (`animation.js` etc.) exports the literal value, and Beaver's runtime / styled-components / CSS layer writes a `var(--animation-curve-expressive-standard)` reference against the variant the consumer picks. For that to resolve, the manifest builder's synthesized `tokens.css` (§3.2 stage 4b step 5, default combo) must be applied to the document. We do this **once at preview boot**, not per render:

```tsx
// apps/web/src/preview/PreviewPane.tsx
import '@beaver-designus/preview-runtime/tokens.css';  // synthesized for the default combo
// ...
```

`tokens.css` is a build-time artifact committed to the repo alongside `manifest-data/`. Importing once at the top of the preview entry attaches the `:root { --animation-curve-… --color-brand-… }` variables to the document and every Beaver component that reads them downstream renders correctly. We synthesize this file from the upstream's JS+`.d.ts` source rather than importing the upstream's *own* CSS, because the upstream as described ships JS modules with typed objects — there is no upstream-published `tokens.css` for us to pass through. The builder writes one variable per `(group, variant, axis-combo)` triple; the default-combo file the preview imports has only the default-combo values (`tokens.css`), while non-default combos sit next to it as `tokens.<combo-id>.css` for the future combo picker (§13 flip).

**Why we synthesize CSS instead of importing the JS tokens directly.** The upstream's tokens are *values*, not CSS variables; a consumer is supposed to pick the right value for the active surface/theme and write it into CSS. Beaver's own runtime presumably does this (consumers don't reach into `animation.curve` directly — they pass a variant name to a prop and Beaver writes the right CSS var). Our preview is in the same position as any other Beaver consumer: we have to materialize the upstream's JS tokens into CSS once. Doing it at build time keeps the preview boot path free of evaluation work and lets the same synthesized file ship as a manifest artifact reviewers can diff.

**Combo selection in v1.** Default combo always. The project schema (§6.4) does not yet record a chosen combo; the M5 milestone runs against the default-combo CSS only. The runtime infrastructure (multiple `tokens.<combo-id>.css` files on disk, axis metadata in `tokens.json`) is in place so flipping §13 to add a combo picker becomes a small web-UI change plus a `combo_id` column on `projects`, not a re-extraction.

### 7.1 Defense in depth against a malformed tree

Tool-use is the primary constraint; but a defective manifest or a daemon bug could in principle hand the browser a tree with an unknown `component`. The preview-runtime treats this as a recoverable error: render `<UnknownComponentFallback>` (an inline error chip showing the unknown id), don't crash the preview, and emit a console-level diagnostic. The error chip is intentionally visible — silent fallback is worse than a wrong-looking preview. Props that fail the per-entry validator are dropped (logged) but the node is rendered with the surviving prop set; structural defects are tracked but rendering continues.

This catches three classes of bug that tool-use alone can't: (a) manifest drift between daemon and web UI on hot reload, (b) a node persisted from an older manifest version, (c) a developer bug in the tool-call handler. Layer one (SDK enum schema) makes the first bad write structurally impossible; layer two (preview validator) makes a corrupted tree user-visible instead of invisible.

## 8. dscan integration — concrete

**Primary mechanism: pnpm workspace package** under `packages/manifest/`. The package exports the lifted dscan functions as its public surface, plus the new prop-extraction code (§3.2 stage 2). dscan is *not* a dependency; we copy what we need into the workspace package with attribution comments pointing back to the original file path.

**Fallback: copy-in.** If dscan is private and we don't get an npm publish or a usable monorepo arrangement, we copy the relevant files verbatim into `packages/manifest/src/scan/` with the same paths shown below, plus a one-line provenance comment per file. This is the same code, just authored from a snapshot rather than tracked.

Not chosen and why: git submodule (operational pain on Windows, doesn't compose with pnpm), npm package (dscan isn't publicly published and we don't want to take on publishing its release cadence), fork-into-monorepo (drags in `src/classify/`, `src/route/`, `src/viewer/`, all the measurement-only code we explicitly don't want).

### 8.1 Per-module mapping

Each row: source path → role in new project → adaptation → effort (S = <1 day, M = 1–3 days, L = >3 days).

| dscan source | role here | adaptation | effort |
|---|---|---|---|
| [`src/ops/git.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src) | clone/describe Beaver into `.cache/` | none; honour the same `BEAVER_LOCAL_PATH` env var dscan's [beaver.ts:87](C:\Users\crash\AppData\Local\Temp\research\dscan\src\prescan\beaver.ts) honours | S |
| [`src/resolve/ts-resolver.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\resolve\ts-resolver.ts) | resolve module specifiers across Beaver's monorepo so prop extractor knows which file is the canonical source for `Button` | none; the `ResolveResult` union (`in-repo` / `external` / `unresolved`) is exactly the discrimination we need | S |
| [`src/prescan/beaver.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\prescan\beaver.ts) | symbol surfacing + re-export chain flattening (stage 1) | strip the `unresolvedPackages` warning channel that's measurement-oriented; otherwise lift `prescanBeaver()` and `BeaverRegistry` whole. Despite the name, the function's contract is generic (it just walks `packages/<pkg>/package.json` under any monorepo root, per [beaver.ts:108-129](C:\Users\crash\AppData\Local\Temp\research\dscan\src\prescan\beaver.ts)) — we invoke it **once per configured DS** (`beaver`, `react-ui-kit`) and merge the resulting `BeaverRegistry` map keyed by sourceSystem. v1 may keep the original function name internally and only rename if we generalise other call sites; the contract makes that a one-line refactor. | M |
| [`src/types/prescan.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\types\prescan.ts) | `BeaverRegistry` / `ReExportEntry` types | none | S |
| [`src/pipeline/discovery.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\pipeline\discovery.ts) | walk Beaver source tree to feed the prop extractor | drop the per-repo Zod config; the manifest builder uses a fixed include glob (`packages/*/src/**/*.{ts,tsx}`) | S |
| [`src/pipeline/parse.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\pipeline\parse.ts) | tolerant TS-ESTree parse for non-react-docgen fallbacks (when we want to inspect a file ourselves) | none | S |
| [`src/config/schema.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\config\schema.ts) | reference for Zod patterns; **not** imported | rewrite a much smaller schema for `manifest.config.ts`: `designSystems: DesignSystemConfig[]` (one per DS — Beaver, react-ui-kit; each declares `id`, `source.{gitUrl?, localPath?}`, `componentRoot`, `docsRoot?`, `tokenRoot?`, `categoryHint: 'organism'\|'atom'`, `description`), `output: { dir }`. Stage 4b token extraction runs against any DS where `tokenRoot` is set (typically just `react-ui-kit`). The same shape admits a v2 with N>2 DSes without code changes. | — |
| `src/prescan/local-lib.ts` | **not used in v1** | — | — |
| `src/pipeline/{collect,profile,classify-pass,aggregate}.ts` | **not used.** Adoption classification and metric aggregation are measurement-only | — | — |
| `src/classify/`, `src/route/`, `src/viewer/`, `src/writer/` | **not used.** | — | — |
| `tests/fixtures/beaver-ui/` | reused as the v1 manifest-build smoke test corpus until the real Beaver repo is wired up | none; same `BEAVER_LOCAL_PATH` mechanism | S |

### 8.2 Real-usage corpus

dscan also produces `dataset.jsonl` (instance-level JSX usages across consumer repos — [types/dataset.ts:31-49](C:\Users\crash\AppData\Local\Temp\research\dscan\src\types\dataset.ts)) and, as of the post-v0 dscan update, an `aggregates.recommendations` channel (PF3 addition; see `src/pipeline/recommendations.ts`) — auto-suggestions for "promote this Beaver package", "outreach this repo", "add this shadow group to Beaver". Either could in principle become a rich source for the composer:

- The dataset gives **real prop combinations**, real children, real Beaver-component co-occurrences. dscan's profile pass already collects `propNames` from JSX call sites ([pipeline/profile.ts](C:\Users\crash\AppData\Local\Temp\research\dscan\src\pipeline)), so we'd know which props actually get set in practice — useful for the composer when picking defaults.
- The recommendations channel could in principle tell the selector "this Beaver package is underused in real consumers — surface it more aggressively when applicable" or "this shadow pattern is so common we should prefer it as a composition target." Less direct than the dataset itself.

**Decision: defer both to post-v1.** Either source depends on dscan being run against T-Bank's consumer repos, which requires SSH access we don't have in this scaffold. v1 ships with Docusaurus MDX examples + Storybook fallback + hand overrides (§3.2 stage 3). Wiring either channel in is M4-or-later work.

What flips this: if the manifest's `examples` field comes back consistently thin (sparse MDX coverage, no Storybook for many Beaver packages) and the composer's first prototypes look like over-defaulted Lorem Ipsum, the dataset becomes the immediate next investment. The recommendations channel ranks behind the dataset because it's a derived signal of consumer behavior; the dataset is the behavior itself.

## 9. open-design adoption

**Decision: do not fork. Build a clean daemon. Adopt three patterns by name only.**

The audit's headline finding: open-design's `apps/daemon` has 88 TypeScript modules covering media generation (image/video/audio), MCP server hosting, deploy routing, langfuse tracing, memory extraction, routines, critique, telemetry, mac/win/linux packaging. The `apps/daemon/src/server.ts` alone is 4,680 lines. ~5% of it is relevant to a DS-only prototype tool — the route handlers, the SSE encoder, the agent spawn loop, the skill loader.

The cost of forking and stripping that down to the relevant 5% exceeds the cost of writing the relevant 5% from scratch, because the relevant 5% is itself small (estimated: ~800–1,200 lines of new daemon TS for v1) and what we'd save by forking is offset by:

- Cross-cutting concerns we'd inherit and have to neutralize: telemetry hooks, the memory subsystem, MCP injection, sidecar IPC protocols.
- Surface-area lock-in: the [route-context-contract.ts](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\route-context-contract.ts) pattern asserts all routes against a shared context; removing routes breaks the assertion until every dependency is excised.
- Their artifact format (`<artifact>` tags in a text stream) is the **wrong format** for a component tree (§4.1); the streaming parser is the most "novel" infrastructure they ship and we don't get to keep it.

What we adopt by name only (re-implemented, not copied):

| open-design pattern | Re-used as | Why not just copy the file |
|---|---|---|
| SKILL.md convention (frontmatter + body + side-files): `name`, `description`, `triggers`, `od.{mode, surface, design_system, category}` — [skills.ts:28-80](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\skills.ts), confirmed in practice at [skills/login-flow/SKILL.md](C:\Users\crash\AppData\Local\Temp\research\open-design\skills\login-flow) which uses exactly `od: mode: prototype` | Skills under `skills/` in our repo with identical frontmatter shape | Their loader file is 962 lines because it handles user-skill import/edit/shadow/delete, derived examples, deprecation aliases. We need ~80 lines to walk a directory and parse frontmatter. |
| Daemon ↔ web SSE event shape (`start` / `agent` / `stdout` / `stderr` / `end`) — [contracts/sse/chat.ts:63-69](C:\Users\crash\AppData\Local\Temp\research\open-design\packages\contracts\src\sse\chat.ts) | Our `ChatMessageEvent ∪ PrototypeSseEvent ∪ ...` union under `packages/contracts/src/sse/` | Their union includes `live_artifact`, `live_artifact_refresh`, agent-specific `tool_use` / `tool_result` payloads tuned to their `<artifact>` semantics. Our event types match our prototype semantics; reusing theirs forces a translation layer. |
| Runtime adapter pattern: `RuntimeAgentDef { id, bin, versionArgs, buildArgs, streamFormat, promptViaStdin, fallbackModels, … }` + `AGENT_DEFS` registry — [runtimes/types.ts:37-68](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\runtimes\types.ts), [runtimes/registry.ts:19-48](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\runtimes\registry.ts) | `apps/daemon/src/runtimes/` mirroring that shape, with only `defs/qwen.ts` and `defs/claude.ts` populated. v1 actually uses this — see §10. | Adopting the *type* costs nothing; importing their 16-CLI registry would inherit codex-native-binary path heuristics, all the Windows argv-budget code in [runtimes/prompt-budget.ts](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\runtimes\prompt-budget.ts), and capability probing for agents we don't use. We copy the *idea*. |
| Stdio MCP tools server hosting daemon-side tools to the spawned CLI ([mcp-live-artifacts-server.ts:46-114](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\mcp-live-artifacts-server.ts)) | `apps/daemon/src/mcp-tools-server.ts` exposes `placeComponent` / `setProp` / `removeNode` / `finishPrototype` / `getComponent` via the same JSON-RPC over stdio shape | Pattern is straightforward; their tool catalogue (live-artifacts CRUD, connectors) is irrelevant. |
| MCP config injection — daemon writes a config file the CLI picks up before spawn so it auto-connects to our MCP server, per [mcp-config.ts](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\mcp-config.ts) `MCP_TEMPLATES` | `apps/daemon/src/mcp-config.ts` — write `.beaver-designus/mcp.json` next to the project cwd | Same |
| SQLite at `.<datadir>/app.sqlite` for persistence (open-design uses better-sqlite3 — [`apps/daemon/src/db.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\db.ts)) | `apps/daemon/src/db.ts` with a much smaller schema (see §6.4) | Their schema covers projects, conversations, messages, runs, artifacts, memory, comments, routines. We need ~4 tables. |

We do *not* adopt: `apps/daemon/src/media*`, `deploy*`, `langfuse*`, `memory*`, `routines.ts`, `critique/`, `runtimes/defs/*` for non-Qwen-non-Claude agents, the `<artifact>` parser at [apps/web/src/artifacts/parser.ts](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\web\src\artifacts\parser.ts), the sidecar protocol, the desktop Electron shell.

## 10. Orchestration substrate

**Decision: spawn a local code-agent CLI as a subprocess per turn; expose our tool surface to it as an in-daemon stdio MCP server. Default agent is a Qwen Code fork; Claude Code is auto-detected as a second adapter. We adopt the open-design `RuntimeAgentDef` pattern verbatim (just the type + registry, not the 16-CLI catalogue).**

Why this inverts an earlier draft: the original v0 of this doc picked the Claude Agent SDK in-process. The constraint surface (`placeComponent` etc.) needs per-call JSON-schema enums that are *runtime-derived from the loaded manifest*, and that's natural in the SDK's `inputSchema`. But it forces lock-in to Claude, lock-in to a hosted-API workflow, and a code path that bypasses the local CLI ecosystem the user already runs. MCP gives us the same per-call enum guarantee through `inputSchema` ([open-design/apps/daemon/src/mcp-live-artifacts-server.ts:30-114](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\mcp-live-artifacts-server.ts) shows the shape, including `enum` on input properties) while keeping the agent loop *inside the user's CLI of choice*.

### 10.1 The pieces

```
+-------- daemon process ---------+      +--- spawned CLI subprocess ---+
|                                 |      |                              |
|  POST /api/sessions/:id/message |      |  qwen --yolo -               |
|              │                  |      |  (or: claude -p --output-    |
|              ▼                  |      |   format stream-json …)      |
|  agent-loop.ts                  |      |                              |
|    composes prompt (skills +    |      |  reads prompt from stdin,    |
|     manifest summary)           |      |  runs its own tool-use loop  |
|    spawns CLI per RuntimeAgent- |      |  emitting MCP tool calls     |
|     Def.buildArgs()             |      |     │                        |
|    writes prompt to stdin       │◄─────┤     │ stdout                 |
|    parses stdout per stream-    │      │     │ (text deltas, or       │
|     Format ('plain' for Qwen,   │      │     │  stream-json for       │
|     'claude-stream-json' for    │      │     │  Claude Code)          │
|     Claude Code)                |      |     ▼                        |
|    re-emits as SSE events to UI |      |  ┌──────────────────────────┐|
|                                 |      |  │ stdio MCP client         │|
|  mcp-tools-server.ts            │◄─────┤  │ (built into the CLI)     ││
|    stdio JSON-RPC server,       │ JSON │  │ talks to:                ││
|    one process per spawned CLI  │ RPC  │  │   beaver-designus mcp    ││
|    tools (per §4.2):            │      │  │   subcommand the daemon  │|
|     placeComponent              │      │  │   pointed it at via the  │|
|     setProp                     │      │  │   CLI's MCP config       │|
|     removeNode                  │      │  └──────────────────────────┘|
|     finishPrototype             │      │                              |
|     getComponent (read-only)    │      |                              |
|    each call → mutates session  │      |                              |
|     prototype + emits an SSE    │      |                              |
|     prototype:patch event       │      |                              |
+---------------------------------+      +------------------------------+
```

### 10.2 Choices closed

| Decision | Choice |
|---|---|
| **Primary agent CLI for v1** | Qwen Code fork (the user already runs this with open-design; [qwen.ts:4-27](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\runtimes\defs\qwen.ts) shows the existing adapter — `qwen --yolo --model <id> -`, prompt via stdin, `streamFormat: 'plain'`). |
| **Second adapter** | Claude Code (`claude -p --output-format stream-json --verbose`, prompt via stdin, per [defs/claude.ts:45-67](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\runtimes\defs\claude.ts)). Auto-detected by probing PATH. Selectable via session config; defaults to whichever is available with Qwen winning ties. |
| **Tool surface delivery** | In-daemon stdio MCP server. The daemon's `cli.ts` ships a `mcp` subcommand (`beaver-designus mcp`) that is the binary the spawned CLI's MCP client invokes; that subcommand serves the tool surface from §4.2 over JSON-RPC against the daemon's HTTP API (which is how it knows about the active session). Identical shape to open-design's [`apps/daemon/src/mcp-live-artifacts-server.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\mcp-live-artifacts-server.ts), trimmed to our tools. |
| **MCP config injection** | The daemon writes a per-session `.beaver-designus/mcp.json` into the CLI's working directory before spawn, configuring the CLI to launch `beaver-designus mcp --session <id>` as its MCP server. Same pattern as open-design's [mcp-config.ts](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\mcp-config.ts) writes via `MCP_TEMPLATES`. The session id flows through env (`OD_DAEMON_URL`-equivalent: `BEAVER_DESIGNUS_DAEMON_URL`, plus `BEAVER_DESIGNUS_SESSION_ID`). |
| **Per-call enum constraint** | Lives on the MCP tool's `inputSchema.properties.component.enum`. Built fresh at session start from the loaded manifest. The CLI's tool-use validator (in any modern code-agent CLI — Qwen Code, Claude Code, Codex, etc.) rejects out-of-enum values before the call ever leaves the CLI. The MCP server re-validates as backstop. |
| **API key / auth** | Owned by the CLI, not by the daemon. Qwen Code holds its own DashScope key, Claude Code holds its own Anthropic key. We never see them. This is the single most important consequence of the CLI route: the daemon ships without credentials. |
| **Prompt assembly** | The daemon composes a system prompt (skill bodies + manifest summary + current prototype state) and writes it to the CLI's stdin as the user-turn prompt. CLIs that support system-message separation (Claude Code accepts `--append-system-prompt`) get the system prompt routed there; CLIs that don't (Qwen Code in `--yolo`) get one combined stdin payload. The skill body for the active turn is selected by `agent-loop.ts` based on session state, identical decomposition to §5. |
| **Stream parsing** | A small `stream-format/` module per format. `'plain'` for Qwen: every stdout chunk becomes an SSE `text_delta`. `'claude-stream-json'` for Claude Code: parse JSONL events into typed `tool_use` / `text_delta` / `usage` SSE frames. Adapted from open-design's [claude-stream.ts](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\claude-stream.ts) but ~50 lines instead of their many hundreds. |

Tradeoffs and what we accept:

- **Two Node-style processes per turn** (daemon + CLI subprocess) instead of one in-process loop. Each turn pays a spawn cost; for Qwen `--yolo` that's ~100ms which is fine vs. an LLM call measured in seconds.
- **Tool-use events arrive out-of-band** via the MCP server, not through the CLI's stdout stream. The daemon correlates them with the active session by `BEAVER_DESIGNUS_SESSION_ID`. open-design solves this for `live_artifacts_*` the same way (the MCP server proxies to daemon HTTP routes); we follow the same pattern. The web UI sees both streams unified because both flow through `/api/sessions/:id/events` SSE on the daemon side.
- **Lock-in to "the user has a code-agent CLI installed"** — that's the entire premise of the local-CLI architecture and aligns with the user's existing workflow. No fallback to "no CLI, hosted only."

Not chosen and why (re-evaluated under the user's constraints):

| Option | Why not |
|---|---|
| Claude Agent SDK in-process | Requires Anthropic API key in the daemon, fights the local-CLI workflow, locks tools to Claude. The user explicitly prefers the local CLI route. |
| Raw Anthropic / OpenAI API in-process | Same lock-in problem one layer down, plus we'd be re-implementing the tool-use loop the CLIs already have. |
| WebSocket from web → CLI directly, bypassing daemon | The daemon owns prototype state and the MCP tool implementations; bypassing it duplicates that logic in the browser and loses the validate-server-side property. |

## 11. Project skeleton

```
beaver-designus/
├── ARCHITECTURE.md                       # this file
├── README.md
├── package.json                          # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── apps/
│   ├── daemon/                           # localhost CLI process
│   │   ├── package.json                  # bin: { "beaver-designus": "./dist/cli.js" }
│   │   ├── src/
│   │   │   ├── cli.ts                    # entry: subcommands `serve` (default), `manifest build`, `mcp` (stdio MCP server)
│   │   │   ├── server.ts                 # Express + SSE setup, registers all routes
│   │   │   ├── sse.ts                    # SSE response helper (createSseResponse pattern from open-design)
│   │   │   ├── db.ts                     # better-sqlite3 connection + migration runner (§6.4 schema)
│   │   │   ├── projects-store.ts         # CRUD over projects + prototype_snapshots + messages + tool_calls
│   │   │   ├── sessions.ts               # ephemeral session state (active CLI subprocess handle, SSE subscribers)
│   │   │   ├── agent-loop.ts             # spawns CLI per RuntimeAgentDef, pipes prompt to stdin, parses streamFormat, re-emits SSE
│   │   │   ├── prompt-composer.ts        # assemble system prompt from skills + manifest summary + current tree
│   │   │   ├── skills-loader.ts          # walk ./skills, parse SKILL.md frontmatter, return list
│   │   │   ├── manifest-server.ts        # reads ./manifest-data/* into memory at startup, serves GET /api/manifest*
│   │   │   ├── runtimes/                 # OPEN-DESIGN PATTERN ADOPTED (§9, §10)
│   │   │   │   ├── types.ts              # RuntimeAgentDef, DetectedAgent — mirrors open-design's shape
│   │   │   │   ├── registry.ts           # AGENT_DEFS = [qwenAgentDef, claudeAgentDef]
│   │   │   │   ├── detection.ts          # probe `--version`, fill DetectedAgent
│   │   │   │   ├── launch.ts             # spawn helper; PATH prepend; env injection
│   │   │   │   └── defs/
│   │   │   │       ├── qwen.ts           # default; mirrors open-design's qwen.ts:4-27
│   │   │   │       └── claude.ts         # secondary; mirrors open-design's claude.ts:5-70
│   │   │   ├── mcp-tools-server.ts       # stdio JSON-RPC server; tools = §4.2 surface; backed by daemon HTTP
│   │   │   ├── mcp-config.ts             # write `.beaver-designus/mcp.json` for the spawned CLI
│   │   │   ├── stream-format/
│   │   │   │   ├── plain.ts              # Qwen-style raw stdout → text_delta events
│   │   │   │   └── claude-stream-json.ts # Claude Code stream-json → typed events
│   │   │   └── routes/
│   │   │       ├── sessions.ts           # POST /api/sessions, POST/cancel, message
│   │   │       ├── projects.ts           # GET/POST/PATCH/DELETE /api/projects, export
│   │   │       └── manifest.ts           # GET /api/manifest, GET /api/manifest/:id
│   │   └── tests/                        # vitest
│   └── web/                              # browser UI
│       ├── package.json                  # depends on @beaver-ui/* as peer-ish; depends on workspace contracts + preview-runtime
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx                  # mount + router (single route in v1)
│           ├── App.tsx                   # two-pane layout: chat + preview
│           ├── chat/                     # message rendering, input box, status pills
│           ├── preview/                  # imports preview-runtime; subscribes to prototype events
│           ├── manifest-browser/         # right-pane drawer for inspecting components on click
│           ├── api/                      # typed fetch + SSE client (uses @beaver-designus/contracts)
│           └── state/                    # local session state, prototype mirror, current revision
├── packages/
│   ├── contracts/                        # pure TS types shared by daemon and web; no runtime deps
│   │   └── src/
│   │       ├── api.ts                    # request/response shapes
│   │       ├── sse.ts                    # event union
│   │       ├── prototype.ts              # PrototypeNode, Prototype
│   │       └── tools.ts                  # tool-input/output types
│   ├── manifest/                         # offline pipeline + types; lifts from dscan
│   │   └── src/
│   │       ├── index.ts                  # public exports
│   │       ├── types.ts                  # ManifestEntry, PropEntry, SlotPolicy, ExampleSnippet,
│   │       │                             #   TokenManifest, TokenSet, TokenEntry
│   │       ├── scan/                     # adapted from dscan/src/prescan + resolve + ops/git + pipeline/parse + pipeline/discovery
│   │       │   ├── beaver.ts             # lifted prescanBeaver
│   │       │   ├── resolve.ts            # lifted createTsResolver
│   │       │   ├── git.ts                # lifted gitClone, gitDescribe
│   │       │   ├── parse.ts              # lifted parseFiles
│   │       │   └── discovery.ts          # lifted discoverFiles
│   │       ├── props/                    # NEW — fills the dscan gap
│   │       │   ├── extract.ts            # react-docgen-typescript wrapper
│   │       │   └── slot-policy.ts        # stage-4 slot inference
│   │       ├── docs/                     # NEW — stage 3 description+examples
│   │       │   ├── mdx.ts                # Docusaurus MDX parser (primary)
│   │       │   ├── storybook.ts          # CSF parser (fallback)
│   │       │   └── overrides.ts          # load manifest-data/*.overrides.json
│   │       ├── tokens/                   # NEW — stage 4b (upstream design-tokens package)
│   │       │   ├── discover.ts           # walk design-tokens/, pair .js + .d.ts files
│   │       │   ├── parse-dts.ts          # TS compiler API → namespaces → groups → variants → axis-leaf keys
│   │       │   ├── load-js.ts            # import sibling .js, walk per .d.ts shape, fill values
│   │       │   ├── axes.ts               # axis-key grammar parser → axes[] + combos[]
│   │       │   ├── css-emit.ts           # synthesize tokens.css + tokens.<combo>.css
│   │       │   └── reconcile.ts          # ts-morph match Beaver prop types → TokenGroup paths
│   │       └── build.ts                  # orchestrates stages 1–5 (incl. 4b), writes manifest-data/
│   └── preview-runtime/                  # browser package consumed by apps/web
│       └── src/
│           ├── component-map.ts          # generated from manifest-data/index.json at web build time
│           ├── render.tsx                # PrototypeNode → React element
│           └── fallbacks.tsx             # UnknownComponentFallback, ValidationErrorBadge
├── skills/                               # SKILL.md convention adopted from open-design
│   ├── intake/
│   │   └── SKILL.md
│   ├── selector/
│   │   ├── SKILL.md
│   │   └── references/component-categories.md
│   ├── composer/
│   │   ├── SKILL.md
│   │   └── examples/                     # one or two HTML/JSON samples per recurring pattern (card grid, form, etc.)
│   └── explainer/
│       └── SKILL.md
└── manifest-data/                        # generated artifacts, committed
    ├── index.json                        # all entries across every DS, flat list,
    │                                     #   daemon loads at startup; each row carries
    │                                     #   sourceSystem + category
    ├── beaver/                           # one subtree per configured DS
    │   ├── @beaver-ui-side-navigation.json
    │   ├── @beaver-ui-side-navigation.overrides.json
    │   ├── @beaver-ui-subheader.json
    │   └── @beaver-ui-table.json
    ├── react-ui-kit/
    │   ├── @react-ui-kit-button.json
    │   ├── @react-ui-kit-input.json
    │   └── @react-ui-kit-checkbox.json
    ├── tokens.json                       # TokenManifest (§3.1.1) — single, tokens live
    │                                     #   in react-ui-kit but apply to both DSes
    ├── tokens.css                        # synthesized for default combo, imported by preview (§7)
    └── tokens.<combo-id>.css             # one per non-default combo (§13 flip)
```

### 11.1 Daemon v0 files (10)

| File | Responsibility |
|---|---|
| `apps/daemon/src/cli.ts` | argv parsing; subcommands `serve` (default), `manifest build`, `mcp` (the stdio server the spawned CLI invokes) |
| `apps/daemon/src/server.ts` | Express app, mount routes, listen on `127.0.0.1:7457`, graceful shutdown |
| `apps/daemon/src/db.ts` | open SQLite, run migration 0001 (§6.4 schema), expose `prepare()` helpers |
| `apps/daemon/src/projects-store.ts` | CRUD over `projects` + `prototype_snapshots` + `messages` + `tool_calls`; rehydrate `Prototype` on session resume |
| `apps/daemon/src/sessions.ts` | ephemeral state: active CLI subprocess, SSE subscribers, current `Prototype` mirror |
| `apps/daemon/src/agent-loop.ts` | per turn: pick `RuntimeAgentDef`, compose prompt, write `mcp-config.ts` output, spawn CLI, pipe prompt to stdin, parse `streamFormat`, re-emit SSE |
| `apps/daemon/src/runtimes/registry.ts` + `defs/qwen.ts` + `defs/claude.ts` | adapter definitions; runtime selection at session start |
| `apps/daemon/src/mcp-tools-server.ts` | stdio JSON-RPC; tools are §4.2; each tool POSTs back to the daemon's HTTP API (read `BEAVER_DESIGNUS_DAEMON_URL`, `BEAVER_DESIGNUS_SESSION_ID` from env) |
| `apps/daemon/src/manifest-server.ts` | load `manifest-data/*.json` at startup; serve `/api/manifest*`; build the per-session JSON-schema enum used in the MCP server's `inputSchema` |
| `apps/daemon/src/routes/{sessions,projects,manifest}.ts` | the §6 endpoints |

### 11.2 Web v0 files (5–10)

| File | Responsibility |
|---|---|
| `apps/web/src/main.tsx` | React root mount, env-driven daemon URL |
| `apps/web/src/App.tsx` | two-pane layout (chat left, preview right) |
| `apps/web/src/api/client.ts` | typed wrappers around fetch + SSE for the §6 endpoints |
| `apps/web/src/state/session.ts` | local session state, message log, current prototype mirror, revision counter |
| `apps/web/src/chat/Conversation.tsx` | render messages + input box |
| `apps/web/src/chat/Message.tsx` | one message; renders text + agent status pills |
| `apps/web/src/preview/PreviewPane.tsx` | subscribe to prototype SSE events, render via `@beaver-designus/preview-runtime` |
| `apps/web/src/preview/NodeOverlay.tsx` | click target to ask "what is this", overlays component bounds |
| `apps/web/src/manifest-browser/ComponentDrawer.tsx` | side drawer for `GET /api/manifest/:id` results |
| `apps/web/src/index.css` | minimum global styles; otherwise lean on Beaver |

## 12. Recommendations the user can override

Capped at 5. Each: recommendation → reason → what flips it.

1. **Two-DS scope in v1: Beaver organisms + react-ui-kit atoms+tokens. No third DS, no plugin registry, no theme layer.** The `designSystems[]` array in `manifest.config.ts` is the abstraction; we don't introduce a DesignSystem provider interface or hot-loading. Flips: a third concrete DS becomes a v1 requirement (e.g. an external partner's component kit), in which case add a third config block — no code change unless the new DS uses a wholly different token shape than `react-ui-kit` (then stage 4b grows a second extractor variant).
2. **Defer the dscan `dataset.jsonl` real-usage corpus to post-v1.** v1 uses Docusaurus MDX (primary) + Storybook + hand overrides for examples; the dataset is a richer source but requires SSH-accessing T-Bank consumer repos and running the full dscan pipeline before we have an end-to-end demo. Flips: composer outputs feel chronically over-defaulted because the Docusaurus docs are thin, then dataset becomes the next M after M3.
3. **Default agent is the Qwen Code fork; Claude Code auto-detected as a second adapter.** Matches the user's existing local-CLI workflow. The runtime registry has slots for both; selection follows availability and session-config override. Flips: if a third CLI becomes preferred (Codex, Gemini Code), add one ~30-line `defs/<id>.ts` mirroring open-design's pattern at [`runtimes/defs/qwen.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\runtimes\defs\qwen.ts); the rest of the daemon is unchanged because tools and prompt composition live above the adapter.
4. **One project = one prototype tree, flat list, no folders or tags.** Avoids designing a project-management UX before we know the actual usage shape. Flips: users routinely accumulate >50 projects, or there's demand for grouping by feature/team, at which point add a `tags TEXT` column to `projects` and a filter pill in the home screen — no schema migration beyond an `ALTER TABLE`.
5. **Single shared SQLite under the user's home dir (`~/.beaver-designus/app.sqlite`), no per-project file format.** One DB file, one backup, one place the user trusts. Export is JSON via `GET /api/projects/:id/export.json` for portability. Flips: users want per-project files they can move between machines or check into git, at which point add `beaver-designus project export <id> > project.bdproto` / `project import` CLI commands that round-trip the export JSON; the DB remains the source of truth.

## 13. Out of scope for v1

Aggressive list. None of these are designed in:

- Authentication, multi-user, hosted/remote deployment.
- Design systems beyond the two configured in v1 (Beaver + react-ui-kit). The `designSystems[]` array admits the future; v1 doesn't ship a third.
- Per-session DS gating ("force this turn to atoms-only"). The `category` filter is computed offline and surfaced in the manifest; no UI to override it at runtime.
- Auto-resolving Beaver-wrapped re-exports of react-ui-kit components into a "canonical" entry. Both entries land in the manifest under their `sourceSystem`-prefixed ids; the selector skill carries the preference logic. Flips: the duplicate-entry surface area becomes a real measured cost in selector context, then add a `wraps?: { sourceSystem, id }` field to ManifestEntry and let the selector dedupe.
- Telemetry, analytics, langfuse-style tracing.
- Outbound MCP server (sharing *our* tools with someone else's agent). The MCP server we ship is internal to the daemon ↔ CLI loop only.
- Plugin marketplace (skills, design systems, providers).
- Mobile-device preview (responsive view in the preview pane is fine; device emulators are not).
- **Combo picker at preview time** (multi-theme / multi-surface rendering). v1 always uses the default `TokenAxisCombo` (typically `surface=desktop.theme=light`). All four (or N) combo CSS files are *built* into `manifest-data/` so the runtime is ready; what's out of scope is the UI to switch between them and the per-project storage of a chosen combo. Flips: stakeholder wants dark-mode prototypes or mobile-surface prototypes; small change set — add `combo_id` column to `projects` (§6.4), surface a combo dropdown in the preview, swap the imported CSS file on change.
- Accessibility audit of generated trees. The DS owns this.
- Export of the prototype tree to production code (JSX-emitting back end). Out by design — "prototype ≠ production" per the principles. JSON export of the tree is in scope (§6.1); JSX generation is not.
- Per-project file format checked into git; users export JSON if they want portability (§12.5 flip condition).
- Time-travel UI over the `tool_calls` audit table; the table exists for explainer grounding, not for restoration in v1.
- Image / video / audio generation (open-design has it; we don't need it).
- Critique theater, memory subsystem, routines, deploy routes (all open-design features we drop).
- Watch mode for manifest rebuilds.
- Hot-swapping the agent CLI mid-session. A session is bound to one `RuntimeAgentDef` for its lifetime; changing requires a new session.

## 14. Implementation roadmap

Milestone-based; each gates on a verifiable exit criterion.

**M0 — Scaffold and bring-up.**
- Set up pnpm workspace per §11. Stub each top-level file with a TODO and the responsibility comment.
- Lift the dscan modules listed in §8.1 into `packages/manifest/src/scan/`, run `pnpm typecheck` to green.
- Wire daemon ↔ web hello-world: `POST /api/sessions` returns `{ sessionId, projectId }`, web echoes it.
- Stand up SQLite + migration 0001 (the four tables from §6.4). `POST /api/projects` creates a blank project; `GET /api/projects` lists it.
- Exit criterion: `pnpm -F daemon dev` and `pnpm -F web dev` both run; opening `http://127.0.0.1:5173` shows the two-pane layout with a home screen listing zero projects, then one after the "New" button; restarting the daemon and reloading the page still shows the project. Captured in `apps/web/tests/smoke.e2e.ts` (Playwright) and `apps/daemon/tests/projects.test.ts` (vitest).
- Depends on: nothing.

**M1 — Manifest v0 against two synthetic DS fixtures + a Docusaurus stub.**
- Implement `packages/manifest/src/build.ts` stages 1–5 end to end, including a stage-1 loop over `designSystems[]`, the Docusaurus MDX parser (stage 3 priority 1), the Storybook fallback (priority 2), and stage 4b token extraction.
- Reuse `BEAVER_LOCAL_PATH=/tmp/research/dscan/tests/fixtures/beaver-ui` as the **Beaver fixture** (`categoryHint: "organism"`). Treat its `SideNavigation`/`SideNavigationItem`/`Subheader` as the organism corpus.
- Author a synthetic **react-ui-kit fixture** under `tests/fixtures/upstream-stub/packages/`:
  - `button/`, `input/` packages — atom components with bare prop types, `categoryHint: "atom"`.
  - `design-tokens/animation.{js,d.ts}` with one group (`curve`) of two variants × four axis-leaf keys.
  - `design-tokens/color.{js,d.ts}` with one group (`brand`) of two variants, axis-less.
- Wire `tests/fixtures/docs-stub/SideNavigation.mdx` for the MDX path (one entry from the Beaver subtree). Edit the react-ui-kit fixture `Button.ts` to add `curve?: keyof typeof animation['curve']` so the reconciler has a real TS pin to match a token group across DSes.
- Hand-author overrides at `manifest-data/beaver/@beaver-ui-subheader.overrides.json` to verify the override merge path.
- Exit criterion: `pnpm beaver-designus manifest build` exits 0; `manifest-data/beaver/` contains entries for `SideNavigation`, `SideNavigationItem`, `Subheader` (each with `sourceSystem: "beaver"`, `category: "organism"`); `manifest-data/react-ui-kit/` contains entries for `Button`, `Input` (each with `sourceSystem: "react-ui-kit"`, `category: "atom"`); the `Button` entry has `curve` `PropEntry` with `kind: { type: "token-reference", group: "animation.curve" }` set via TS type inspection; `manifest-data/index.json` flat list has 5 rows total, each tagged by sourceSystem; `manifest-data/tokens.json` contains the two token groups; `manifest-data/tokens.css` defines `--animation-curve-expressive-standard` to the desktop-light value with three sibling combo files. `pnpm -F manifest test` covers (a) the source-priority chain (MDX > Storybook > JSDoc > override merge) and (b) the cross-DS scan invariant: changing only `designSystems[1]` (react-ui-kit) in the config and rebuilding leaves `manifest-data/beaver/*` byte-identical.
- Depends on: M0.

**M2 — Composer v0 with constraint enforcement via the CLI route.**
- Implement the §4.2 tool surface as MCP tools in `apps/daemon/src/mcp-tools-server.ts`.
- Implement `apps/daemon/src/runtimes/{registry,defs/qwen,defs/claude}.ts` plus the spawn helpers.
- Implement `agent-loop.ts`: assemble prompt, write `.beaver-designus/mcp.json`, spawn CLI per `RuntimeAgentDef.buildArgs()`, pipe prompt via stdin, parse `streamFormat`, re-emit SSE.
- The MCP tool's `placeComponent.inputSchema.properties.component.enum` is built fresh from the loaded manifest at session start.
- Use Qwen Code as the v0 CLI (the user already has it; matches their existing workflow). Claude Code path is wired but unused at M2.
- Exit criterion: sending a session message ("place a Button with variant=primary inside an empty Form") through a session bound to the local Qwen Code fork produces SSE frames containing at least one `tool_use` event whose `component` is in the manifest enum, ending with a `finishPrototype` call; the `prototype_snapshots` row for the session's project has `tree_json` whose root component is `@beaver-ui/form/Form`; a malicious test that attempts `placeComponent({component: "<div>"})` is rejected by the MCP server with a JSON-RPC validation error and never mutates state. Recorded as `apps/daemon/tests/composer.e2e.test.ts`.
- Depends on: M1.

**M3 — Preview v0 with tokens applied.**
- Implement `packages/preview-runtime` with a generated `component-map.ts`. v0 covers only the five fixture components.
- Copy `manifest-data/tokens.css` into the preview-runtime's bundled assets at web-app build time so the preview entry can `import` it (§7); attach to `:root` once at boot.
- Wire `apps/web/src/preview/PreviewPane.tsx` to subscribe to prototype SSE events and render.
- Exit criterion: after running the M2 scenario in a real browser, the preview pane shows the actual Beaver `Button` from the fixture rendering inside the fixture `Form`; the `Button`'s computed background `color` resolves to a value from the token stub (asserted via `getComputedStyle(button).backgroundColor` matching the hex from `tokens.css`, *not* the user-agent default); closing the browser tab and reopening the same project URL re-renders the same tree (verifying `prototype_snapshots` round-trips). Verified via screenshot at `apps/web/tests/preview.screenshot.png` and Playwright assertions on the button text + computed style both before and after a tab reload.
- Depends on: M2.

**M4 — Explainer v0 + saved-projects browsing.**
- Implement `getComponent` tool + `skills/explainer/SKILL.md`.
- Web home screen lists saved projects (from `GET /api/projects`), supports rename via `PATCH`, delete via `DELETE`, and export via `GET /api/projects/:id/export.json`.
- Clicking a node in the preview emits a follow-up message ("why this component"); the agent responds with an explanation grounded in the manifest entry.
- Exit criterion: a Playwright test clicks the rendered `<button>` from M3, sends the synthetic prompt through `POST /message`, and asserts the SSE response contains a `getComponent` tool call followed by a `text_delta` whose content mentions a string from the manifest entry's `description`. A second test exports a project to JSON, deletes it, creates a new project, and reimports — the resulting tree is byte-identical (or revision-bumped only). Recorded as `apps/web/tests/explainer.e2e.ts` and `apps/web/tests/export-roundtrip.e2e.ts`.
- Depends on: M3.

**M5 — Real-DS swap (both repos).**
- Update `manifest.config.ts` `designSystems`:
  - `{id: "beaver", source: <real Beaver repo>, componentRoot: 'packages', docsRoot: <Beaver Docusaurus path>, categoryHint: 'organism'}`,
  - `{id: "react-ui-kit", source: <real react-ui-kit repo>, componentRoot: 'packages', tokenRoot: 'packages/design-tokens', docsRoot: <if Docusaurus present>, categoryHint: 'atom'}`.
- Rebuild manifest; the stage-1 loop now runs twice, the Beaver subtree picks up organisms, the react-ui-kit subtree picks up atoms + feeds stage 4b.
- Regenerate `preview-runtime/component-map.ts` covering BOTH `@beaver-ui/*` and `@react-ui-kit/*` packages; the preview imports the synthesized default-combo `tokens.css`.
- Run the M2 and M4 scenarios against real components, including at least one prototype that *mixes* a Beaver organism with a react-ui-kit atom (e.g. a Beaver `SideNavigation` containing react-ui-kit `Button`s in a footer slot) to prove cross-DS composition works end-to-end.
- Exit criterion: real composition renders in the preview with the upstream's actual brand color and animation timing applied via the synthesized variables; `manifest-data/index.json` has >20 entries total spanning *both* `sourceSystem` values (at least 10 organisms from Beaver + at least 10 atoms from react-ui-kit, logged at build time with the per-DS counts); ≥50% of entries have a non-empty `description` sourced from MDX; `manifest-data/tokens.json` contains groups for at least `animation.curve` and the upstream's actual color/spacing groups; at least one token-reference `PropEntry` exists whose `group` field was derived from TS type inspection through `react-ui-kit/packages/design-tokens` (not override, not convention); `manifest build` completes inside 90 s (60 s budget per DS, parallelized); M2 and M4 e2e tests pass unchanged with the real manifest substituted (same MCP enum mechanism, larger component enum + real token-variant enums); a Playwright test confirms the mixed-DS prototype DOM contains *both* `[data-beaver]` (or whatever class Beaver components emit) and `[data-react-ui-kit]` (or equivalent) descendants; the `manifest_rev` drift handling (§6.4) is exercised by loading a project saved against the fixture manifest after switching to the real one.
- Depends on: M4 and access to the real Beaver + real `react-ui-kit` sources.

## 15. Audit appendix

### dscan files read

- [`/tmp/research/dscan/README.md`](C:\Users\crash\AppData\Local\Temp\research\dscan\README.md) — confirmed stage 5a/5b prescan model and the `BEAVER_LOCAL_PATH` env-var test path.
- [`/tmp/research/dscan/package.json`](C:\Users\crash\AppData\Local\Temp\research\dscan\package.json) — dependency budget (typescript, zod, picomatch, fdir, `@typescript-eslint/typescript-estree`); strict TS settings inherited from `tsconfig.json`.
- [`/tmp/research/dscan/tsconfig.json`](C:\Users\crash\AppData\Local\Temp\research\dscan\tsconfig.json) — Node-NEXT module resolution, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Lift wholesale into `tsconfig.base.json`.
- [`/tmp/research/dscan/src/prescan/beaver.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\prescan\beaver.ts) — `prescanBeaver`, package discovery, entry-file parsing, re-export chain flattening, `BEAVER_LOCAL_PATH` override at line 87.
- [`/tmp/research/dscan/src/prescan/local-lib.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\prescan\local-lib.ts) — same shape applied to consumer-repo local libraries; not used in v1.
- [`/tmp/research/dscan/src/resolve/ts-resolver.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\resolve\ts-resolver.ts) — `createTsResolver` wraps `ts.resolveModuleName`; returns `in-repo` / `external` / `unresolved`. Lifted whole.
- [`/tmp/research/dscan/src/pipeline/parse.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\pipeline\parse.ts) — tolerant parse with jsx flag keyed off extension; not used in stage 1–4 but useful for the prop-extraction fallback.
- [`/tmp/research/dscan/src/pipeline/discovery.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\pipeline\discovery.ts) — `discoverFiles` (fdir + picomatch); lifted with simplified config.
- [`/tmp/research/dscan/src/pipeline/collect.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\pipeline\collect.ts) — Pass-A usage collector; confirms dscan tracks *call sites*, never extracts prop *signatures*. Not used.
- [`/tmp/research/dscan/src/config/schema.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\config\schema.ts) — Zod patterns to crib for a much smaller `manifest.config.ts` schema.
- [`/tmp/research/dscan/src/config/loader.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\config\loader.ts) — tsx-on-demand for `.ts` configs; reuse the technique if we want a TS manifest config.
- [`/tmp/research/dscan/src/types/dataset.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\types\dataset.ts) — `UsageRecord` shape; relevant only for the deferred dataset corpus (§8.2).
- [`/tmp/research/dscan/src/types/prescan.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\types\prescan.ts) — `BeaverRegistry`, `ReExportEntry`; lifted whole as the input type to stage 2.
- [`/tmp/research/dscan/src/index.ts`](C:\Users\crash\AppData\Local\Temp\research\dscan\src\index.ts) — public API surface (small); confirms the lift targets aren't internal.
- [`/tmp/research/dscan/tests/fixtures/beaver-ui/`](C:\Users\crash\AppData\Local\Temp\research\dscan\tests\fixtures\beaver-ui) — five-package mock workspace used for the M1 smoke test; component bodies are `() => null` with bare prop literals (e.g. `Button.ts: (_props: { variant?: 'primary' | 'secondary' }) => null`), so M1 needs only react-docgen-typescript's most basic walk.

### open-design files read

- [`/tmp/research/open-design/package.json`](C:\Users\crash\AppData\Local\Temp\research\open-design\package.json), [`pnpm-workspace.yaml`](C:\Users\crash\AppData\Local\Temp\research\open-design\pnpm-workspace.yaml), [`AGENTS.md`](C:\Users\crash\AppData\Local\Temp\research\open-design\AGENTS.md) — workspace layout (`apps/*`, `packages/*`, `tools/*`, `e2e`), packageManager pinning, boundary rules (`apps/web` must not import `apps/daemon/src`).
- [`/tmp/research/open-design/apps/daemon/src/agents.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\agents.ts) — 22-line re-export shim; the real logic is in `runtimes/`.
- [`/tmp/research/open-design/apps/daemon/src/runtimes/registry.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\runtimes\registry.ts), [`runtimes/types.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\runtimes\types.ts), [`runtimes/detection.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\runtimes\detection.ts), [`runtimes/launch.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\runtimes\launch.ts), [`runtimes/defs/claude.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\runtimes\defs\claude.ts), [`runtimes/defs/qwen.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\runtimes\defs\qwen.ts) — adapter pattern, Claude defn invokes `claude -p --output-format stream-json --verbose` via stdin (confirms `--permission-mode bypassPermissions` for headless), Qwen defn invokes `qwen --yolo --model <id> -` (stdin) with `streamFormat: 'plain'`. v1 adopts both adapters as written, drops the other 14.
- [`/tmp/research/open-design/apps/daemon/src/mcp-live-artifacts-server.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\mcp-live-artifacts-server.ts) — concrete pattern for the in-daemon stdio MCP server we'll adopt as `mcp-tools-server.ts`. Tools registered with `inputSchema` that supports `enum` constraints (CONNECTORS_LIST_INPUT_SCHEMA at line 30-35). The `daemonUrl()` helper at line 105-114 shows how the spawned MCP server discovers the parent daemon via env var.
- [`/tmp/research/open-design/apps/daemon/src/mcp-routes.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\mcp-routes.ts) — shape of the install-info endpoint and the `OD_BIN` env-handoff pattern; we reuse the structure (renaming `OD_*` → `BEAVER_DESIGNUS_*`) so the CLI can find our daemon after spawn regardless of how it was launched.
- [`/tmp/research/open-design/apps/daemon/src/design-systems.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\design-systems.ts) — confirms their "design system" abstraction is a `DESIGN.md` style guide, not a component library. Their model is wrong for us; the path is *inspiration-only*.
- [`/tmp/research/open-design/apps/daemon/src/cli.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\cli.ts) — daemon entrypoint + media/mcp/research subcommands. The 127.0.0.1 + opt-in browser-open pattern is reused.
- [`/tmp/research/open-design/apps/daemon/src/skills.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\skills.ts) — 962-line skill registry; the relevant 80 lines are the directory walk + frontmatter parse + `od.mode` validation (including the `prototype` mode). User-skill import/edit/shadow we drop.
- [`/tmp/research/open-design/apps/daemon/src/server.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\server.ts) (4,680 lines, skimmed) — Express setup with `/api/health`, `/api/runs`, `/api/memory`, `/api/skills`, deep media routes. We adopt the Express+SSE shape, drop everything else.
- [`/tmp/research/open-design/apps/daemon/src/chat-routes.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\chat-routes.ts) — `POST /api/runs` returns runId, `GET /api/runs/:id/events` streams. Adopted.
- [`/tmp/research/open-design/packages/contracts/src/sse/chat.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\packages\contracts\src\sse\chat.ts) — `ChatSseEvent` union (`start`/`agent`/`stdout`/`stderr`/`end`). Adopted shape; substituted payload union.
- [`/tmp/research/open-design/apps/web/src/artifacts/types.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\web\src\artifacts\types.ts), [`artifacts/parser.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\web\src\artifacts\parser.ts) — confirms the `<artifact identifier="..." type="..." title="...">...</artifact>` text-stream format. Rejected for our use (§4.1).
- [`/tmp/research/open-design/apps/web/src/providers/daemon.ts`](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\web\src\providers\daemon.ts) — fetch-based SSE client; useful blueprint for `apps/web/src/api/client.ts`.
- [`/tmp/research/open-design/skills/login-flow/SKILL.md`](C:\Users\crash\AppData\Local\Temp\research\open-design\skills\login-flow\SKILL.md) — concrete proof that `od: mode: prototype` is a first-class skill mode in production today, with `references/checklist.md` siblings and an `example.html`. Our skills directory mirrors this shape.
- [`/tmp/research/open-design/skills/apple-hig/SKILL.md`](C:\Users\crash\AppData\Local\Temp\research\open-design\skills\apple-hig\SKILL.md), [`skills/artifacts-builder/SKILL.md`](C:\Users\crash\AppData\Local\Temp\research\open-design\skills\artifacts-builder\SKILL.md) — confirm the SKILL.md frontmatter shape (`name`, `description`, `triggers`, `od.{mode, category, upstream}`).

### Discrepancies between dscan README and actual code

- README §"Архитектура" lists `src/route/` and `src/viewer/`; both exist but are entirely measurement-oriented (react-router introspection, HTML adoption report). The README is accurate but the modules' actual scope is wider/narrower than the bullets suggest. None of it changes the lift plan.
- The README claims dscan parses `.ts` and `.tsx` separately to avoid generic-vs-JSX ambiguity (confirmed at [parse.ts:46-48](C:\Users\crash\AppData\Local\Temp\research\dscan\src\pipeline\parse.ts)); for our prop extractor stage 2 we can rely on the same convention since we walk by file extension.

### Re-audit after the post-v0 dscan update

A second clone was diffed against the version this architecture was initially authored against. Findings, with their architectural impact:

- **All §8.1 lift targets are byte-identical.** `src/prescan/{beaver,local-lib}.ts`, `src/resolve/ts-resolver.ts`, `src/pipeline/{parse,discovery}.ts`, `src/ops/git.ts`, `src/types/prescan.ts` — no changes. The lift plan is intact.
- **`tests/fixtures/beaver-ui/` is byte-identical.** M1's smoke target works exactly as planned.
- **`src/config/schema.ts` gained a `recommendations` sub-config** (4 thresholds: `addToBeaverMinRepos`, `outreachMaxAdoption`, `promotePackageMaxReposRatio`, `maxRecommendations`). We reference this file as a *pattern source* for Zod (§8.1 mapping), not as an import; the addition doesn't touch what we crib.
- **New `src/pipeline/recommendations.ts`** (post-v0 PF3) emits operator-facing recommendations from snapshot metrics. Measurement-side, not lifted, but noted in §8.2 as an additional channel of the deferred corpus.
- **`src/pipeline/{aggregate,classify-pass,collect,run}.ts` changed**, `src/types/dataset.ts` changed, `src/viewer/render.ts` changed, README/docs reorganized (English ops docs replaced with Russian-named files, new `CLAUDE.md` for agent conventions). All measurement-only or non-source; §8.1 already marks every one of these "**not used**."
- **No new prop-extraction or component-spec extraction** anywhere in the updated dscan (`grep` for `react-docgen`, `propType`, `extractProps`, `ComponentSpec` returned zero hits). The §3.2 stage 2 gap remains as identified — dscan still collects consumer-side usage, never DS-side prop declarations. The new code is all downstream of that observation (richer metrics + recommendations from those metrics), not upstream into the source-of-truth we'd need.

**Net architectural impact of the dscan update: none on the lift plan, one knock-on in §8.2 acknowledging the new recommendations channel as a deferred-corpus input.** The doc body did not need structural revision; this appendix entry is the audit trail.

### Two-DS scope clarification (r3)

A later user clarification moved `react-ui-kit` from "upstream token source plus a few re-exports through Beaver" to "first-class peer component source, co-equal with Beaver." Concretely: Beaver supplies organisms (tables, navigation, subheaders, page-level objects); `react-ui-kit` supplies atoms (Button, Input, etc.) plus all tokens. Both are valid composition targets for prototypes.

Architectural consequences threaded through the doc:

- **§1 product summary** now describes the two DSes as first-class with distinct contributions.
- **§3.1 `ManifestEntry`** gained `sourceSystem: string` and `category: 'atom' | 'molecule' | 'organism'`. Entry ids are now `<sourceSystem>:<package>/<exportName>` to keep the MCP enum unique across DSes when symbols collide.
- **§3.2 stage 1** runs `prescanBeaver()` once per configured DS (the function's contract is generic, not Beaver-specific — confirmed by reading [beaver.ts:108-129](C:\Users\crash\AppData\Local\Temp\research\dscan\src\prescan\beaver.ts)). The function may keep its current name for v1 internally; it's a one-line rename if we generalise later.
- **§3.3 storage** is now per-DS subtree (`manifest-data/beaver/`, `manifest-data/react-ui-kit/`); the spanning `index.json` carries the sourceSystem+category tags.
- **§5 selector role** explicitly owns the organism-vs-atom level-picking heuristic.
- **§7 preview** imports from both DSes' packages; the component-map keys by `<sourceSystem>:<id>`.
- **§11** `manifest.config.ts` is now `designSystems: DesignSystemConfig[]` keyed by id with per-DS `componentRoot`, `docsRoot`, `tokenRoot`, `categoryHint`.
- **§12.1** recommendation reframed from "Beaver-only" to "two-DS scope, no third DS".
- **§13** removes "DSes other than Beaver" out-of-scope; replaces with "no third DS" plus two new related items (no per-session DS gating UI; no auto-dedup of Beaver-wrapped re-exports of react-ui-kit).
- **§14 M1** uses a Beaver fixture (existing) + a new synthetic react-ui-kit fixture under `tests/fixtures/upstream-stub/packages/`. **§14 M5** points at both real repos and asserts cross-DS composition works (a Beaver organism containing react-ui-kit atoms).

What I did **not** change: the manifest pipeline stages (still 1 → 2 → 3 → 4 → 4b → 5, with stage 1 now looping over DSes); the MCP tool-use constraint mechanism (still a per-session enum, just larger); the persistence schema (sourceSystem prefix on `component` ids in the stored tree is transparent to SQLite); the §10 CLI route. The two-DS clarification widens scope without restructuring the substrate.

### Things expected and not found

- **A component prop registry in dscan.** The product vision implies "scanner of a DS" might already extract props. It doesn't — dscan tracks *consumer-side usage* (instances of `<Button .../>` in product code), not *DS-side declarations* (the shape of `ButtonProps`). The fixture button at [Button.ts:1](C:\Users\crash\AppData\Local\Temp\research\dscan\tests\fixtures\beaver-ui\packages\button\src\Button.ts) is `export const Button = (_props: { variant?: 'primary' | 'secondary' }) => null;` — a bare type annotation never inspected by dscan. This is the largest single gap and §3.2 stage 2 fills it.
- **A Docusaurus parsing precedent in dscan.** The user confirmed Beaver ships Docusaurus docs inside the DS repo. dscan's fixtures contain no docs at all (`tests/fixtures/beaver-ui/` is just `packages/`, no `docs/` or `website/`). The MDX parser in §3.2 stage 3 is new, but cheap — `@mdx-js/mdx` AST mode, code-fence + frontmatter extraction only, no JSX evaluation.
- **Direct view of the upstream DS Beaver builds on.** The user confirmed Beaver is layered on top of `react-ui-kit` (`packages/{components,core,design-tokens,styles,utils}`), and confirmed the design-tokens shape: paired `<namespace>.js` + `<namespace>.d.ts` files using a TS `namespace` export with `keyof`-able nested groups, leaf values keyed by an axis-encoding vocabulary (`desktopvalue`, `desktopdarkvalue`, `mobilevalue`, `mobiledarkvalue`). No part of dscan or open-design exposes this concretely — dscan's fixtures simulate Beaver with bare `Button.ts` stubs that have no token consumption, open-design's `design-systems/<id>/tokens.css` pattern ([apps/daemon/src/design-systems.ts:77-91](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\design-systems.ts)) is one-stylesheet-per-brand, not a component-DS-with-typed-tokens. The stage 4b design is now pinned to the actual upstream shape — TS-namespace walk + sibling `.js` load + axis-grammar parser — rather than hedging across speculative source forms. Open questions M5 will resolve: which top-level groups the real `design-tokens/` ships (animation/color/spacing are confirmed, the rest is unknown), whether any namespace breaks the `(desktop|mobile)(dark)?value` axis-key grammar, and which Beaver props actually use `keyof typeof <namespace>['<key>']` references in their public types (vs. erased through `any` / `string`).
- **A skill in open-design that uses tool-use to constrain output to a component library.** open-design's prototype-mode skills (`login-flow`, `artifacts-builder`) all emit HTML inside `<artifact>` tags. None of them constrain by tool use. The composer skill we author is a genuinely new pattern, not a copy.
- **A precedent for the agent-loop / preview boundary in open-design.** They render the artifact in an iframe that consumes the `<artifact>` text stream after the stripper post-processes it. The clean tree-render boundary in §4.3 and §7 has no direct counterpart there; it's adapted from v0 / Subframe-style designs cited in the prompt.
- **A code path in open-design that wires MCP tool calls from a spawned CLI back into per-session state.** Their MCP server proxies tool calls to daemon HTTP endpoints via the `OD_DAEMON_URL` env var ([mcp-live-artifacts-server.ts:105-114](C:\Users\crash\AppData\Local\Temp\research\open-design\apps\daemon\src\mcp-live-artifacts-server.ts)), but the live-artifact tools are project-scoped, not session-scoped. Our `BEAVER_DESIGNUS_SESSION_ID` env hand-off (§10.2) is new but a one-line addition to the pattern.
