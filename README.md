# beaver-designus

> Local-first, LLM-orchestrated UI prototyping. Prototypes are built exclusively from your configured design systems' real components — never JSX strings.

A designer or PM describes a screen in chat. A local code-agent CLI (Claude Code or Qwen Code) reads the description and calls a small, constrained tool surface — `placeComponent`, `setProp`, `removeNode`, `finishPrototype` — whose `component` argument is enumerated from a precomputed manifest of your design systems. The output tree is **structurally incapable** of containing off-palette components. The preview renders from the live DS code, not a screenshot.

The repository ships with no design system. To bring it to life you point `manifest.config.json` at your own DS clones (or our defaults — `T-Bank Beaver` + `react-ui-kit`) and run `npm run manifest:build`.

## What's inside

```
beaver-designus/
├── ARCHITECTURE.md                # 1300-line spec — read this first
├── IMPROVEMENT_PLAN.md            # post-M5 audit, phased improvement plan
├── daemon/                        # Express + SQLite + MCP + agent loop
├── packages/
│   ├── manifest/                  # offline pipeline: discover → extract props → MDX → tokens
│   └── preview-runtime/           # browser renderer, [data-node-id] wrappers, fallbacks
├── web/                           # Vite + React 18 UI (chat + preview + inspector)
├── shared/                        # contracts shared between daemon and web
├── skills/                        # SKILL.md bodies — intake / selector / composer / explainer
├── docs/audit-by-local-agent.md   # instruction for an in-perimeter audit agent (see below)
├── manifest.config.json           # which DSes to scan
└── tests/{unit,e2e}/              # vitest + Playwright suites
```

## Quick start (zero DS — to see the shell)

```bash
npm install
npm run dev
# → http://127.0.0.1:5173    (web)
# → http://127.0.0.1:7457    (daemon)
```

The preview will render `UnknownComponentFallback` chips for every node because `COMPONENT_MAP` is empty until you wire your DS.

## Wiring a real design system

1. Clone your DS repo(s) into `./.cache/<ds-id>` (or anywhere — adjust `manifest.config.json` `source.localPath`).
2. Run `npm run manifest:build`. The pipeline (per ARCHITECTURE §3.2) discovers packages, extracts prop signatures via the TypeScript compiler, parses Docusaurus MDX docs and Storybook stories as fallback, and (if `tokenRoot` is set) extracts design tokens into `manifest-data/tokens.{json,css}`. *Shortcut for T-Bank Beaver + react-ui-kit:* `cp manifest.config.tbank.example.json manifest.config.json` — pre-tuned to the audited shape (componentRoot, excludePackages, docsRoot, PascalCase 3-surface tokenAxisGrammar).
3. Regenerate `packages/preview-runtime/src/component-map.ts` — one entry per `<sourceSystem>:<package>/<exportName>` id pointing at the real React component.
4. Run `npm run dev` again — the preview now renders your DS's actual components.

## Running a turn

You need either [Claude Code](https://docs.claude.com/en/docs/claude-code) or Qwen Code installed and on `PATH`. The daemon detects them via `where claude.exe` / `which claude`. No API key in the daemon — the spawned CLI owns its credentials.

Send a message in chat (e.g. *"a customer profile screen with a top nav and three metric cards"*). You'll see tool calls stream into the chat as the agent composes, the preview updates after each call, and the inspector lets you click a node to read its manifest entry and edit pill-controlled props.

## Scripts

```bash
npm run dev               # daemon + vite, both with HMR
npm run dev:daemon        # just the daemon
npm run dev:web           # just vite
npm run manifest:build    # rebuild manifest-data/

npm run typecheck         # tsc --noEmit
npm run lint              # eslint flat config
npm run format            # prettier --write .
npm test                  # vitest unit tests
npm run test:e2e          # Playwright against running dev stack
```

## Auditing this project against your DS

If your design systems live inside a corporate perimeter and can't be cloned out, but you can run an AI agent inside that perimeter, see [`docs/audit-by-local-agent.md`](docs/audit-by-local-agent.md). Hand the agent that file and your two DS repos; it produces a markdown report telling you whether the manifest pipeline will scan them cleanly or which assumptions need adjustment.

## Bringing the project up in the perimeter

After the audit, if you want the same in-perimeter agent to do the full bring-up — clone the DS repos, configure the manifest, regenerate the component map, adapt the runtime adapter to your corporate Qwen Code fork, start the server — hand it [`docs/setup-by-local-agent.md`](docs/setup-by-local-agent.md). You provide DS paths + the path to the Qwen binary; the agent writes `docs/setup-report.md` and the dev server is ready to open.

## Architecture

The full spec is in [`ARCHITECTURE.md`](ARCHITECTURE.md) — 1300 lines, written before the code and kept current. Key decisions:

- **Manifest is the constraint.** Component ids are enumerated into the MCP tool's `inputSchema.enum`. The agent CLI's tool-use validator rejects off-palette values before they reach our handler. The daemon re-validates as backstop (defense in depth).
- **Two DSes, first-class.** Beaver (organisms) layered on react-ui-kit (atoms + tokens). The `designSystems[]` config admits more without code changes.
- **Local-first.** SQLite on disk, `127.0.0.1`-only HTTP, no telemetry, no auth. The agent CLI owns its API keys.
- **JSON prototype tree.** Not JSX, not HTML. Validatable. Inspectable. Survives the SSE boundary.

## License

Not yet specified. Treat the repo as "ask before reusing significant portions".
