# Setup instruction — for a local AI agent bringing up beaver-designus inside the DS perimeter

> You are the bring-up agent. The operator has handed you (a) this repository, (b) paths to two design system repos, and (c) the corporate Qwen Code fork binary. Your job: perform every step needed to get the app running so the operator only has to open a browser tab.
>
> You **are** allowed to modify a narrow set of files (listed in §0.2). You are **not** allowed to refactor daemon/manifest internals, change the architecture, alter dependencies, or commit/push anything. You write a single report at `docs/setup-report.md` when done.

## 0. Contract

### 0.1 Inputs the operator gives you (mandatory)

1. **Two DS source locations**, each either:
   - an absolute path on disk (`C:\repos\beaver-ui` or `/home/u/repos/beaver-ui`), OR
   - a git clone URL with whatever auth (SSH, PAT-in-URL, or a checkout already on disk).

   The operator labels each by id: `beaver`, `react-ui-kit`. If they call them something else, use the operator's id verbatim.

2. **Path to the Qwen Code corporate fork binary**, absolute. Example: `/opt/corp/bin/qwen-corp` or `C:\corp\tools\qwen-tbank.exe`.

3. **(Optional)** any auth env vars / config files the corporate Qwen fork needs to talk to the LLM. The operator names them; you don't invent.

### 0.2 Files you may modify

- `manifest.config.json` — point at the operator's DS paths, set `excludePackages`, `docsRoot`, `tokenAxisGrammar`, `tokenCssVarPattern` per the audit guidance.
- `packages/preview-runtime/src/component-map.ts` — regenerate from `manifest-data/index.json`.
- `daemon/runtimes/defs/qwen.ts` — adapt to the corporate fork (binary name, CLI flags, stream format). **This is the only daemon file you may touch.**
- `web/src/main.tsx` — add DS CSS imports if needed (one or two `import "..."` lines, nothing else).
- `.cache/` — operator's DS clones go here; you may `mkdir`, `git clone`, or symlink.
- `manifest-overrides/<ds-id>/*.overrides.json` — only if you genuinely had to override something to make a component render. Author one override per *real* problem; don't pre-populate.

You may also write `docs/setup-report.md` at the end.

### 0.3 Files you must NOT modify

- `ARCHITECTURE.md`, `IMPROVEMENT_PLAN.md`, `README.md`, `docs/audit-by-local-agent.md`.
- Anything under `daemon/` except `daemon/runtimes/defs/qwen.ts`.
- Anything under `packages/manifest/src/` (pipeline source).
- `shared/`, `web/src/` (except the one allowed `main.tsx` line if needed).
- `tests/`, `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `vitest.config.ts`, `playwright.config.ts`.

If you think one of these needs a code change, **stop and write that into `docs/setup-report.md` as a "blocked-on" item** instead of editing. The operator routes it to the next agent.

### 0.4 No commits, no pushes

You do not `git add`, `git commit`, `git push`, `git checkout`, `git stash`. The operator handles git. You just leave the working tree in a state that, if committed, would be a clean setup PR.

---

## 1. Step-by-step procedure

Run these in order. After each step, verify the exit-criterion before moving to the next. If a step fails, stop and write the failure into the report.

### 1.1 Environment sanity

```bash
node --version       # → 20.x or later
npm --version        # → 10.x or later
git --version        # → 2.4x or later
```

If any is missing → blocked; write `Required tooling missing: <list>` and stop.

### 1.2 Install dependencies

```bash
npm install
```

Expected: ~30 sec, no errors. `node_modules/` populates.

If the operator's npm registry is behind a corporate proxy and the install fails: stop, write the exact error, ask the operator to run `npm config set registry <corp-mirror>` and retry. **Do not** edit `.npmrc` or `package.json`.

### 1.3 Place DS repos

For each DS the operator named (`beaver`, `react-ui-kit`):

```bash
mkdir -p .cache
# If operator gave a path:
ln -s <abs-path-to-ds> .cache/<ds-id>     # POSIX
# Windows PowerShell:
New-Item -ItemType Junction -Path .cache\<ds-id> -Target <abs-path-to-ds>

# Or if operator gave a git URL:
git clone <url> .cache/<ds-id>
```

Verify:
```bash
ls .cache/beaver/package.json .cache/react-ui-kit/package.json
```

Both must exist.

### 1.4 Configure manifest.config.json

Start from the existing file. Update each DS's `source.localPath` to `./.cache/<ds-id>`.

Run the **audit playbook** at `docs/audit-by-local-agent.md` mentally as you fill the config. Specifically: every check listed in §5a of that document maps to one or two fields here. Common config patterns:

#### 1.4.1 Internal packages (`excludePackages`)

`ls .cache/<ds>/packages` and identify everything that is **not** a UI component package (analytics, hooks, core, deprecated, internal-*, test-helpers, etc.). Add each basename to `excludePackages` with `*`-globs where useful. Auto-skipped already: `design-tokens`.

Example:
```json
"excludePackages": ["analytics", "context", "hooks", "core", "internal-*", "deprecated"]
```

#### 1.4.2 Docs paths (`docsRoot`)

Look for MDX in this order:
- `.cache/<ds>/auto-doc/docs/` — Docusaurus-style flat or nested docs.
- `.cache/<ds>/docs/` — root-level docs.
- `.cache/<ds>/packages/*/docs/` — per-package docs (no glob support; pass `packages` instead and let the recursion find them).
- `.cache/<ds>/packages/*/__stories__/*.mdx` — Storybook-adjacent tutorial MDX (same: pass `packages` to recurse).

Pick the smallest set of parent dirs that covers all relevant MDX. Multiple roots are fine:
```json
"docsRoot": ["auto-doc/docs/patterns", "docs"]
```

If MDX uses ancestor-directory naming (e.g. `auto-doc/docs/patterns/Navigation/SideNavigation/01/01.mdx`), no further config — the matcher walks ancestor dirs automatically.

#### 1.4.3 Token axis grammar (`tokenAxisGrammar`)

`cat .cache/<react-ui-kit>/packages/design-tokens/animation.d.ts` (or whichever namespace file exists). Look at the leaf-key vocabulary inside variants:
- If you see `desktopvalue`/`mobilevalue` (lowercase, no theme keys) → no config needed, default works.
- If you see `desktopValue`/`desktopDarkValue` (PascalCase, with theme) → configure the grammar.
- If you see 3+ surfaces (`desktop`/`ios`/`android` etc.) → list them all.

Example for `desktopValue` / `desktopDarkValue` / `iosValue` / `iosDarkValue` / `androidValue` / `androidDarkValue`:
```json
"tokenAxisGrammar": {
  "pattern": "^(?<surface>desktop|ios|android)(?<theme>Dark)?Value$",
  "defaultSurface": "desktop",
  "defaultTheme": "light"
}
```

The regex MUST have named group `surface`. Named group `theme` is optional. The matcher normalizes any captured `theme` to literal `"dark"`; the absence of capture means `"light"`.

#### 1.4.4 CSS variable naming (`tokenCssVarPattern`)

Default emitter writes `--<namespace>-<binding>-<variant>` (e.g. `--animation-curve-expressive-standard`). If your DS's runtime CSS reads variables with a different convention, override the template. Placeholders: `{namespace}`, `{binding}`, `{variant}`.

To find out which convention the DS uses, grep one of the DS's compiled CSS files (or `.module.css`):
```bash
grep -h "var(--" .cache/<ds>/packages/*/dist/*.css | head -5
```

Common shapes the agent may encounter:
- `--<namespace>-<binding>-<variant>` (our default) — set nothing.
- `--<prefix>-<namespace>-<binding>-<variant>` — set `"--tui-{namespace}-{binding}-{variant}"` (or whatever prefix).
- `--<namespace>_<binding>_<variant>` (underscore) — set `"--{namespace}_{binding}_{variant}"`.

If the DS uses a wildly different scheme (camelCase, runtime-computed names), don't try to fit it — just write the deviation into the setup-report's "non-blocking deltas" section and move on. The preview will fall back to default colors for affected props, which is non-fatal.

#### 1.4.5 Sanity-check the config

```bash
node -e "JSON.parse(require('fs').readFileSync('manifest.config.json'))"
```

If that fails, your JSON is malformed.

### 1.5 Build the manifest

```bash
npm run manifest:build
```

Expected output:
```
[manifest] [beaver] discovered N packages
[manifest] [beaver] indexed K MDX files across M root(s)
[manifest] [react-ui-kit] discovered N packages
[manifest] [react-ui-kit] extracted Z token groups
[manifest] wrote <total> entries to .../manifest-data
```

Verify:
- `manifest-data/index.json` exists and `entries` has > 0 items.
- `manifest-data/tokens.json` has > 0 `groups`.
- `manifest-data/tokens.css` is non-empty.

If the build exits non-zero, **stop and write the stderr into the report**. Don't blindly retry with different config — the audit playbook describes which knobs to tune.

### 1.6 Scaffold overrides (optional, recommended)

```bash
npm run manifest:scaffold-overrides
```

This writes empty `manifest-overrides/<ds>/<package>.overrides.json` skeletons for components with sparse descriptions or `kind: "unsupported"` props. **It does not overwrite existing override files.** You leave the skeletons for the operator to fill in (or the next agent pass). Don't author overrides yourself unless one is required to make a specific component render at all (§1.7 will surface that case).

### 1.7 Regenerate `component-map.ts`

This is the only piece of code generation you actually do. Read `manifest-data/index.json` and produce a TypeScript file at `packages/preview-runtime/src/component-map.ts` that:

1. One `import` line per *package* (NOT per entry — multiple exports from the same package collapse into one import).
2. `COMPONENT_MAP` is a Record keyed by `ManifestEntry.id`, valued by the imported component reference.

Algorithm:

```ts
import { readFileSync, writeFileSync } from "node:fs";

const idx = JSON.parse(readFileSync("manifest-data/index.json", "utf8"));

// Group exports by package
const byPkg = new Map<string, Array<{ exportName: string; id: string }>>();
for (const e of idx.entries) {
  if (!byPkg.has(e.packageName)) byPkg.set(e.packageName, []);
  byPkg.get(e.packageName)!.push({ exportName: e.exportName, id: e.id });
}

const importLines = [...byPkg.entries()].map(
  ([pkg, exports]) => `import { ${exports.map(e => e.exportName).join(", ")} } from "${pkg}";`
);
const mapLines = idx.entries.map(
  (e: any) => `  ${JSON.stringify(e.id)}: ${e.exportName},`
);

const out = `// AUTO-GENERATED — do not hand-edit.
//
// Regenerate with the procedure in docs/setup-by-local-agent.md §1.7
// (run after every \`npm run manifest:build\`).

import * as React from "react";
${importLines.join("\n")}

export const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
${mapLines.join("\n")}
};
`;

writeFileSync("packages/preview-runtime/src/component-map.ts", out);
```

After writing the file, verify TypeScript still compiles:
```bash
npm run typecheck
```

If `typecheck` fails because:
- **Import path is unresolvable.** The DS's `package.json` `main`/`exports` field doesn't expose the file you're importing. Look at the DS's actual exports and pick the right path. If the only path that works is a deep import (`@beaver-ui/button/dist/Button`), use that; record it as a delta.
- **Component name mismatch.** The manifest extracted an export name that the package doesn't re-export at the package root. Two causes:
  1. The DS uses aggregator packages that re-export from a different name. Resolve by importing from the canonical sub-package.
  2. The manifest mis-extracted. Open `packages/manifest/src/scan/discovery.ts` for context, then write a note in the report — but **do not** edit the file.

### 1.8 Wire CSS bundles (if applicable)

If the DS ships compiled CSS that the preview needs to load, add the imports to `web/src/main.tsx` near the top, **before** the existing `import "./index.css"` line:

```tsx
import "<package-name>/dist/styles.css";   // or wherever the DS puts it
```

Find which packages ship CSS:
```bash
ls .cache/<ds>/packages/*/dist/*.css 2>/dev/null
```

If the DS uses CSS Modules (`.module.css`) compiled at component-build-time, you typically **don't** need explicit imports — the component's own `import classes from './x.module.css'` resolves through Vite's CSS Modules support automatically. Verify by opening the rendered preview and checking if styles apply.

If the DS uses CSS-in-JS (styled-components, emotion) and needs a `<ThemeProvider>` wrapping the app, **stop and write that into the report**. Wrapping the App is out of your scope; the next agent pass adds the provider.

### 1.9 Adapt the Qwen Code runtime adapter

This is the longest step. The corporate Qwen fork almost certainly differs from the upstream `qwen` CLI. Walk through these adjustments to `daemon/runtimes/defs/qwen.ts`:

#### 1.9.1 Find the binary

The fork's binary path. Ask the operator if they didn't give it up front. Confirm:

```bash
<operator-path-to-qwen> --version
```

Two ways to wire it:
1. **Path on PATH**: if the binary is on PATH and is the only `qwen`-ish thing there, leave `bin: "qwen.exe"` / `"qwen"` and the daemon's `where`/`which` resolver picks it up.
2. **Explicit env var override**: set `QWEN_BIN=/abs/path/to/qwen-corp` in the env (write this into the report so the operator knows). The adapter reads `binEnvVar: "QWEN_BIN"` and prefers it over PATH lookup.
3. **Hardcode the bin name** if the fork's binary is named differently (e.g. `qwen-corp.exe`): change `bin:` in the def. Renaming `binEnvVar` is not necessary — `QWEN_BIN` works for any qwen-flavored binary.

#### 1.9.2 Check `--version` behavior

```bash
<qwen-corp> --version
```

If the fork doesn't support `--version` (or has a different flag like `-v` / `version`), update `versionArgs` in the def:
```ts
versionArgs: ["-v"],
// or
versionArgs: ["version"],
```

The daemon needs *some* probe that exits 0 quickly and prints anything. If absolutely nothing works, fall back to `versionArgs: ["--help"]` — it'll print help and exit 0, the daemon takes the first stdout line as the version string.

#### 1.9.3 Inspect the fork's argv shape

```bash
<qwen-corp> --help | head -40
```

Look for:
- **Prompt input mode**: does it accept the user prompt on stdin (`-` argument) or as a positional `--prompt <text>` / `<text>` arg?
- **MCP config flag**: does it support `--mcp-config <path>`? If named differently (`--mcp`, `--config`, `--tool-config`), update `buildArgs`.
- **Stream output**: does it support `--stream`, `--output-format jsonl`, anything similar? If yes, you may switch `streamFormat: "claude-stream-json"` if the format matches.
- **Headless / auto-approve mode**: upstream Qwen has `--yolo` which auto-approves tools. Look for `--yolo`, `--auto-approve`, `--no-confirm`, `--non-interactive`. If none, the CLI will hang on first tool prompt; **stop and report**.
- **Quiet/no-color**: useful but optional.

#### 1.9.4 Three example adaptations

**Example A — fork is identical to upstream Qwen:**
```ts
export const qwenAgentDef: RuntimeAgentDef = {
  id: "qwen",
  displayName: "Qwen Code (corp)",
  bin: process.platform === "win32" ? "qwen.exe" : "qwen",
  binEnvVar: "QWEN_BIN",
  versionArgs: ["--version"],
  streamFormat: "plain",
  promptViaStdin: true,
  buildArgs: ({ mcpConfigPath }) => ["--yolo", "--mcp-config", mcpConfigPath, "-"],
};
```
(no edits beyond what ships)

**Example B — fork renames `--yolo` to `--auto-approve` and uses `--mcp` instead of `--mcp-config`:**
```ts
export const qwenAgentDef: RuntimeAgentDef = {
  id: "qwen",
  displayName: "Qwen Code (corp)",
  bin: process.platform === "win32" ? "qwen-corp.exe" : "qwen-corp",
  binEnvVar: "QWEN_BIN",
  versionArgs: ["--version"],
  streamFormat: "plain",
  promptViaStdin: true,
  buildArgs: ({ mcpConfigPath }) => ["--auto-approve", "--mcp", mcpConfigPath, "-"],
};
```

**Example C — fork emits JSON Lines and wants the system prompt as a file:**
```ts
export const qwenAgentDef: RuntimeAgentDef = {
  id: "qwen",
  displayName: "Qwen Code (corp)",
  bin: process.platform === "win32" ? "qwen-corp.exe" : "qwen-corp",
  binEnvVar: "QWEN_BIN",
  versionArgs: ["--version"],
  streamFormat: "claude-stream-json",   // if compatible; otherwise still "plain"
  promptViaStdin: true,
  buildArgs: ({ mcpConfigPath, systemPromptFile }) => [
    "--auto-approve",
    "--mcp-config", mcpConfigPath,
    "--system-prompt-file", systemPromptFile,
    "--stream-format", "jsonl",
    "-",
  ],
};
```

If you go with Example C and `streamFormat: "claude-stream-json"`, **verify the JSON shape matches Claude Code's** by reading `daemon/stream-format/claude-stream-json.ts`. If the fork's JSONL events have different keys (`type`, `content`, etc.) than Claude Code's, you cannot reuse the handler — keep `streamFormat: "plain"` and accept that tool-call events arrive only via the daemon's MCP-server channel, not the CLI stdout.

#### 1.9.5 Auth + corporate environment

Most likely the corporate fork talks to a private LLM gateway with one of:
- An env var like `QWEN_API_KEY` or `CORP_LLM_TOKEN`.
- A config file in `~/.config/qwen-corp/config.json`.
- A bearer token in a header configured via flags.

Don't put credentials in `daemon/runtimes/defs/qwen.ts` or anywhere in the repo. Instead, instruct the operator in the setup-report to set the env vars in their shell before running `npm run dev`. The daemon's spawn already forwards `process.env` to the child (`agent-loop.ts` line ~107), so anything in the operator's shell env reaches Qwen.

Note: `daemon/agent-loop.ts` explicitly **strips** one var (`CLAUDE_CODE_USE_POWERSHELL_TOOL`) from the child env to keep the agent-spawned Claude predictable. If the operator says the Qwen fork is sensitive to *any* env var leaking from the host, list it in your report and ask whether to add it to the strip-list. Don't add it yourself — that's a daemon-code change outside your scope.

#### 1.9.6 Probe the adapter works

After saving the new `qwen.ts`:

```bash
# verify the daemon picks it up
node -e "import('./daemon/runtimes/detection.ts').then(m => console.log(m.detectAvailableAgents()))"
```

(That import may require `--import tsx` — adapt if needed. If you can't run TS modules directly, skip this probe and check at dev-server start in §1.10.)

Expected: at least one entry with `def.id === "qwen"` and a non-null `binPath`.

If the probe returns `[]` or no qwen entry, your binary path/flag adjustments are wrong; retry from §1.9.2.

### 1.10 Start the dev server

```bash
npm run dev
```

Wait until you see in the output:
- `[web] ➜  Local: http://127.0.0.1:5173/` (or 5174/5175 if 5173 is busy)
- `[daemon] daemon listening at http://127.0.0.1:7457 · log file <home>/.beaver-designus/daemon.log`

Health check:
```bash
curl -s -o /dev/null -w "vite=%{http_code} daemon=%{http_code}\n" http://127.0.0.1:5173/
curl -s http://127.0.0.1:7457/api/health
```

Both should return 200 / `{"ok":true,...}`.

### 1.11 Smoke test the agent loop

Create a session and send a one-line message:

```bash
SESSION=$(curl -s -X POST http://127.0.0.1:7457/api/sessions -H 'content-type: application/json' -d '{}' | python -c "import sys,json; print(json.load(sys.stdin)['sessionId'])")

curl -s -X POST http://127.0.0.1:7457/api/sessions/$SESSION/message \
  -H 'content-type: application/json' \
  -d '{"content":"Place a single PageShell as the root and stop."}'
```

In another shell, watch the SSE stream:
```bash
curl -N http://127.0.0.1:7457/api/sessions/$SESSION/events
```

You should see, in order:
1. `data: {"type":"prototype:set-root","revision":0,"root":null}` (initial hydrate)
2. `data: {"type":"status","phase":"start","data":{"runtime":"qwen",...}}`
3. One or more `data: {"type":"status","phase":"tool-call","data":{"name":"mcp__beaver_designus__placeComponent",...}}` events.
4. `data: {"type":"prototype:set-root","revision":1,"root":{"component":"<ds>:<...>/PageShell",...}}`
5. `data: {"type":"status","phase":"end","data":{"code":0}}`

If you don't see any tool-call events within 30 seconds, the CLI either hung waiting for confirmation (your `buildArgs` is missing `--yolo` / equivalent), or it's failing to talk to its LLM (auth env vars missing, network blocked). Stop and write the failure into the report.

### 1.12 Write `docs/setup-report.md`

Required sections:

```markdown
# Setup report — <date>

## Verdict
One of:
- ✅ Ready — operator can open http://127.0.0.1:5173 and use the app.
- ⚠️ Partial — server starts and the UI renders, but specific components fall back to UnknownComponentFallback / a turn fails. List which.
- ❌ Blocked — see "Required next steps".

## Open this URL
http://127.0.0.1:5173/

## Config applied
- DS paths: …
- excludePackages: …
- docsRoot: …
- tokenAxisGrammar: …
- tokenCssVarPattern: …

## Manifest stats
- N entries (split by DS)
- M MDX docs found
- T token groups
- K override skeletons scaffolded

## Qwen adapter
- Binary: <path>
- Binary version: <output of --version>
- Flags resolved: <full argv the daemon will spawn>
- Stream format: plain | claude-stream-json
- Env vars the operator must set before `npm run dev`:
  - `QWEN_BIN=<path>` (only if not on PATH)
  - `<auth env vars>`

## Smoke-test result
What happened when you sent the test prompt. SSE events captured.

## Required next steps (only if Verdict ≠ ✅)
- <thing the operator (or next agent) must do that I couldn't>

## Non-blocking deltas
- <minor mismatches that work-around-ed>
```

Stop after writing the report. Don't restart the server. Don't commit.

---

## 2. Failure modes the agent will likely hit

These are paths the agent should recognize and handle, not panic over.

| Symptom | Likely cause | Action |
|---|---|---|
| `npm install` fails on a `@platform-ui/*` private package | Corporate registry not configured | Stop, ask operator for `.npmrc` to drop in |
| `npm run manifest:build` outputs `discovered 0 packages` | `componentRoot` wrong, or all packages got excluded | Check `manifest.config.json`; common: react-ui-kit has components at `packages/components` not `packages` |
| `manifest:build` fails inside Stage 4b with `Cannot find module './<ns>'` | The `.js` runtime file doesn't exist next to the `.d.ts` | The DS ships .d.ts-only tokens; report as code-change-needed, can't fix in config |
| `npm run typecheck` after regenerating `component-map.ts` fails with `Cannot find module '@<ds>/...'` | Package isn't installed | The DS is a workspace package; run `npm install <ds-path>` or use file-protocol. Report which packages need installation |
| Preview renders but every node is an `UnknownComponentFallback` chip | `component-map.ts` keys don't match `manifest-data/index.json` ids | Regenerate `component-map.ts` from scratch using the canonical ids from `index.json` |
| Smoke test never shows a tool-call event | CLI confirm-prompt is blocking, or auth missing | Add `--yolo`-equivalent flag, or ensure auth env vars |
| Smoke test times out and stderr has `EACCES` / `socket hang up` to a corporate URL | Network/firewall | Out of agent scope, report to operator |

## 3. Rules of engagement (terse)

1. **Modify only the 4 files listed in §0.2.** No exceptions.
2. **No commits, no pushes, no git mutations.**
3. **No secrets in the repo.** Auth env vars belong in the operator's shell, never in the def file or a checked-in script.
4. **No dependency churn.** Don't run `npm install <pkg>` to fix an issue — report it.
5. **Single output file.** `docs/setup-report.md`. Optional: override skeletons under `manifest-overrides/` if `npm run manifest:scaffold-overrides` produced them.
6. **Stop when blocked.** If a step's exit-criterion isn't met after 2 reasonable attempts, write what you tried and stop. The operator chooses whether to escalate.
7. **Stop when done.** When verdict is ✅, write the report and exit. Don't keep the dev server running attached to your process — the operator restarts it themselves.
