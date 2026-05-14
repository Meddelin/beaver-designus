# beaver-designus — improvement plan (post-M5 audit)

> Сформирован после установки расширенного набора плагинов и полного gap-аудита
> кода против `ARCHITECTURE.md`. Архитектурное покрытие ~85–90%. Этот документ —
> приоритезированный план правок, разбитый на три фазы. Каждый пункт сослан на
> соответствующий раздел архитектуры либо помечен `(M4+)` как пост-v1.

---

## Установленные зависимости (свежий батч)

**UX runtime** — для апгрейда до уровня Claude.ai / Lovable / Bolt:
`framer-motion`, `lucide-react`, `cmdk`, `sonner`, `react-markdown`,
`remark-gfm`, `rehype-highlight`, `highlight.js`, `class-variance-authority`,
`clsx`, `tailwind-merge`, `@radix-ui/react-{dialog,tooltip,popover,
dropdown-menu,tabs,scroll-area}`, `react-resizable-panels`,
`react-hotkeys-hook`.

**Architecture-gap runtime** — для закрытия пробелов §3.2/§6.4/§10:
`zod`, `@mdx-js/mdx`, `pino`, `pino-http`.

**Dev tooling** — для закрытия §14 exit-criteria и санитарии:
`tailwindcss`, `postcss`, `autoprefixer`, `vitest`,
`@testing-library/{react,jest-dom,user-event}`, `jsdom`, `@playwright/test`,
`prettier`, `eslint`, `@typescript-eslint/{parser,eslint-plugin}`,
`eslint-plugin-react`, `eslint-plugin-react-hooks`, `@types/mdx`.

---

## Фаза P1 — UX-каркас «как Claude / Lovable / Bolt» (in progress)

Цель: визуальный язык, дисциплина, плотность, узнаваемые micro-interactions.
Не косметика — переработка всех ключевых экранов.

| Артефакт | Состояние | Описание |
|---|---|---|
| Design tokens (CSS vars + Tailwind theme) | TODO | Editorial-tech palette: paper-black `#0a0a0a` base, T-Bank yellow `#ffdd2d` единственный акцент, IBM Plex Sans/Mono, 4 уровня elevation, snappy cubic-bezier(.32,.72,0,1). Поддержка light/dark через `data-theme`. |
| `lib/cn.ts` | TODO | `clsx` + `tailwind-merge` обёртка. |
| `lib/theme.tsx` | TODO | Provider + `useTheme()` + persist в localStorage + system-preferences fallback. |
| `ui/Button`, `IconButton`, `Pill`, `Kbd`, `Card`, `SectionTitle` | TODO | CVA-варианты (primary/ghost/secondary/danger), tabular-nums для счётчиков, размеры sm/md/lg. |
| `ui/CommandPalette.tsx` (cmdk) | TODO | ⌘K. Группы: Actions / Navigate / Compose / Inspect / Theme. Mono-shortcuts справа, yellow left-edge на selected. |
| `ui/HotkeyCheatsheet.tsx` | TODO | Открывается по `?`. Сетка hotkeys через Radix Dialog. |
| Toaster (sonner) | TODO | Заменяет `alert/confirm`. Dark theme adaptive. |
| `chat/Markdown.tsx` | TODO | react-markdown + remark-gfm + rehype-highlight (`github-dark-dimmed`). Inline code → mono-chip, fenced → tonal card. |
| `chat/ToolCallCard.tsx` | TODO | Carded UI для `placeComponent`/`setProp` (как Claude tool-use): иконка + название + collapsible JSON args, monospace. Replaces текущий `chat__msg--tool`. |
| `chat/StreamingText.tsx` | TODO | Character-staggered fade-in + blinking caret для assistant streaming. Уважает `prefers-reduced-motion`. |
| `chat/Composer.tsx` | TODO | Auto-resize textarea, focus-ring yellow, кнопка-иконка `ArrowUp`, hint pill «⌘↵ to send / Esc to cancel». |
| `preview/Canvas.tsx` | TODO | Dotted-grid фон, zoom-controls (`⌘+`/`⌘−`/`⌘0`), `transform: scale()` с центрированием, чип «Generated · rev <hash>» сверху-слева. |
| `preview/NodeFocusOverlay.tsx` | TODO | Dashed yellow outline, scale-in spring animation, отдельный компонент (сейчас inline в render.tsx). |
| `manifest-browser/Drawer.tsx` (новый) | TODO | Radix Dialog + framer slide-from-right (spring 320/30). Tabs: Overview / Props / Slots / Examples / Tokens. Examples с syntax highlighting. CTA «Ask the explainer» yellow primary. |
| `home/Hero.tsx` | TODO | 40px Plex Sans 600 `-0.04em`, blinking yellow caret, две CTA (New / Import) + mono shortcuts hint `⌘N · ⌘I · ⌘K`. |
| `home/ProjectCard.tsx` | TODO | Live-thumbnail (real `<PrototypeRender scale={.18}>` clipped 240×140), hover-zoom 2s, метаданные в mono. Поиск + DS фильтры. |
| `home/EmptyState.tsx` | TODO | Outlined lucide-иконка + одна строка + CTA. |
| `App.tsx` route transition | TODO | `<AnimatePresence mode="wait">` + 240ms fade через `#0a0a0a`. |
| Workspace three-pane | TODO | `react-resizable-panels` (chat 380–520, preview flex, inspector drawer overlay). Toolbar 48px с lucide иконками. |
| Hotkeys (`react-hotkeys-hook`) | TODO | `⌘K` palette, `⌘↵` send, `⌘/` focus composer, `⌘B` toggle drawer, `⌘\` toggle chat, `Esc` close, `?` cheat-sheet, `[`/`]` prev/next node, `⌘,` theme. |
| Accessibility | TODO | `:focus-visible` yellow ring 2px offset 2px; `prefers-reduced-motion` через `useReducedMotion()`; `aria-live="polite"` для статуса агента; Radix primitives покрывают остальное. |

Exit-criterion P1: открыть `http://127.0.0.1:5173`, увидеть Hero → создать project → запустить генерацию → увидеть streaming chat с markdown + tool-cards → кликнуть ноду → увидеть drawer с табами → нажать ⌘K → выбрать команду. Без `alert()` / `confirm()` / `prompt()` ни в одном месте.

---

## Фаза P2 — Закрытие архитектурных пробелов

Цель: довести покрытие vs ARCHITECTURE.md с 85–90% до 100% без UX-косметики.

### P2.1 Manifest pipeline (§3.2)

- [ ] **Storybook CSF fallback** (§3.2 stage 3 priority 2). Файл `packages/manifest/src/docs/storybook.ts`. Парсит `<pkg>/src/**/*.stories.{ts,tsx}` через TS compiler API: default-export `argTypes` → `PropEntry.description` patches; named exports → `examples`. Включается когда MDX источник пуст.
- [ ] **MDX через AST** вместо regex (§3.2 stage 3 priority 1). `@mdx-js/mdx` AST: ходить только `frontmatter` + `code` ноды, не выполняя JSX. Текущий `docs/mdx.ts` остаётся как `mdx-regex.ts` fallback.
- [ ] **Token overrides merge** (§3.1.1 + §3.2 stage 4b step 6 priority 2). Расширить `overrides.ts` чтобы пропсы могли получать `tokenGroup: "animation.curve"` через override (приоритет 2), если TS inspection (priority 1) не сработал.
- [ ] **Convention map для tokens** (§3.2 stage 4b step 6 priority 3). Опционально (по умолчанию off) маппинг `color` → любая `color.*` группа. Включается через `manifest.config.json` флаг.
- [ ] **zod-валидация `manifest.config.json`** (§8.1). Файл `packages/manifest/src/config-schema.ts` экспортирует `ManifestConfig` Zod-схему. Loader использует её при чтении.
- [ ] **Defensive freshness check** (§3.4). Лог-варнинг если `manifest-data/index.json` старше `libraries/*/package.json` mtime.

### P2.2 Daemon (§6.4, §10)

- [ ] **Drift warning UI** (§6.4). Когда `GET /api/projects/:id` возвращает project с `manifest_rev !== currentManifestRev()`, web показывает sonner-toast «This prototype was authored against an older manifest. Some components may render as Unknown. Continue?» с опцией показать diff.
- [ ] **Structured logging** через `pino` + `pino-http` middleware. Daemon пишет в `~/.beaver-designus/daemon.log` JSON-строки. Уровни: trace/debug/info/warn/error. CLI-flag `--log-level`.
- [ ] **Error event как отдельный SSE type** (§6.1). Сейчас ошибки идут как `status.phase==="error"`. Архитектура специфицирует отдельный `ErrorEvent`. Добавить в `SseEvent` union + миграция handler-а в web.
- [ ] **`prototype:patch` фактическое использование**. Сейчас daemon шлёт только `set-root`. Реализовать diff через json-patch-like операции для крупных деревьев (>50 нод), чтобы избежать ре-сериализации. Web уже игнорирует patch — добавить apply-patch reducer.
- [ ] **MCP defense-in-depth validation** (§4.2). В `mcp-tools-server.ts` после schema enum валидировать `props` против `entry.props[].kind`: literal-union → проверка значения в options; token-reference → проверка против group variants; required → проверка наличия. Сейчас только schema enum.
- [ ] **Cancel session корректно убивает CLI** (§6.1). Проверить что `child.kill('SIGTERM')` через `AbortController` доходит на Windows.

### P2.3 Web UI + skills

- [ ] **NodeOverlay как отдельный компонент** (§11.2). Вынести inline в `render.tsx` подсветку в `preview/NodeFocusOverlay.tsx` с framer spring.
- [ ] **`skills/*/references/`** subfolders (§5). Selector skill уже имеет inline таблицу — вынести в `skills/selector/references/component-categories.md`. Composer — добавить `skills/composer/examples/{dashboard,form,empty-state}.md`.

### P2.4 Tests (§14 exit criteria)

- [ ] `vitest` config (`vitest.config.ts`) + `tsconfig.test.json`.
- [ ] **Unit tests manifest pipeline**:
  - `packages/manifest/tests/discovery.test.ts` — dedup symbols, re-export chain.
  - `packages/manifest/tests/props.extract.test.ts` — literal-union, token-reference, ReactNode.
  - `packages/manifest/tests/tokens.extract.test.ts` — axis grammar, combos, CSS emit.
  - `packages/manifest/tests/overrides.test.ts` — merge precedence.
- [ ] **Daemon integration tests** (`vitest --pool threads`):
  - `daemon/tests/projects.test.ts` — CRUD + manifest_rev stamp.
  - `daemon/tests/mcp-validation.test.ts` — `placeComponent({component:"<div>"})` rejected.
  - `daemon/tests/export-roundtrip.test.ts` — export → import → tree byte-identical.
- [ ] **Playwright e2e** (`tests/e2e/`):
  - `home.spec.ts` — create / rename / delete / import / export.
  - `composer.spec.ts` — send message → tool calls arrive via SSE → tree renders.
  - `explainer.spec.ts` — click node → drawer open → CTA fires explainer turn.
  - `command-palette.spec.ts` — ⌘K → search → execute.

### P2.5 DX / тулинг

- [ ] `eslint.config.js` (flat config) с `@typescript-eslint`, react-hooks plugin, no-floating-promises.
- [ ] `.prettierrc` + `prettier --write` в pre-commit hook (опционально husky).
- [ ] `tsconfig.json` — добавить `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` (§15 dscan inheritance).
- [ ] `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:e2e` в `package.json`.

---

## Фаза P3 — Архитектурные «out of scope» элементы, которые имеет смысл начать (M4+)

Не критично для v1, но описано в §13 как пост-v1 work.

- [ ] **Combo picker** (§13 flip): dropdown в topbar workspace для surface×theme, переключает импорт `tokens.<combo>.css` без перезагрузки.
- [ ] **`manifest-data/index.json` hot-reload** (§3.4 «future extension»). Endpoint `POST /api/manifest/reload`.
- [ ] **Time-travel UI** через `tool_calls` audit (§6.4). Slider в превью, перематывающий по revision.
- [ ] **Композер skill recipes refresh**: после M5 проанализировать тенденции over-default-ов и обновить `skills/composer/examples/`.

---

## Маппинг tasks → файлы (для удобства implementation phase)

```
Phase P1 (UX)
├── tailwind.config.js                          (new)
├── postcss.config.js                           (new)
├── web/src/index.css                           (rewrite — Tailwind + tokens)
├── web/src/main.tsx                            (wire ThemeProvider, Toaster, fonts)
├── web/src/App.tsx                             (AnimatePresence)
├── web/src/lib/cn.ts                           (new)
├── web/src/lib/theme.tsx                       (new)
├── web/src/lib/format.ts                       (new — relative time, hash slice)
├── web/src/ui/{Button,IconButton,Pill,Kbd,Card,SectionTitle}.tsx  (new)
├── web/src/ui/CommandPalette.tsx               (new)
├── web/src/ui/HotkeyCheatsheet.tsx             (new)
├── web/src/home/{Hero,ProjectCard,EmptyState,Home}.tsx          (rewrite Home; rest new)
├── web/src/workspace/WorkspaceView.tsx         (rewrite — resizable + palette + hotkeys)
├── web/src/workspace/Topbar.tsx                (new)
├── web/src/chat/{ChatPane,Markdown,ToolCallCard,StreamingText,Composer}.tsx
│                                               (rewrite ChatPane; rest new)
├── web/src/preview/{PreviewPane,Canvas,NodeFocusOverlay}.tsx    (rewrite PreviewPane; rest new)
├── web/src/manifest-browser/Drawer.tsx         (replaces ComponentDrawer.tsx)
└── packages/preview-runtime/src/render.tsx     (extract focus overlay)

Phase P2 (architecture)
├── packages/manifest/src/docs/storybook.ts                       (new)
├── packages/manifest/src/docs/mdx-ast.ts                         (new — @mdx-js/mdx based)
├── packages/manifest/src/config-schema.ts                        (new — zod)
├── daemon/log.ts                                                 (new — pino setup)
├── daemon/routes.ts                                              (modify — pino-http, error event)
├── daemon/mcp-tools-server.ts                                    (modify — defensive validate)
├── shared/types.ts                                               (modify — ErrorEvent)
├── vitest.config.ts                                              (new)
├── playwright.config.ts                                          (new)
├── tests/e2e/{home,composer,explainer,command-palette}.spec.ts   (new)
├── packages/manifest/tests/*.test.ts                             (new)
└── daemon/tests/*.test.ts                                        (new)
```

---

## Verification protocol

После каждой фазы:

1. `npm run typecheck` — no errors.
2. `npm run manifest:build` — exits 0, `manifest-data/` regenerated.
3. `npm run dev` — daemon + vite поднимаются.
4. Browser-smoke: открыть `http://127.0.0.1:5173`, выполнить сценарии из exit-criterion соответствующей фазы.
5. `tests/render-tree.tsx <projectId>` — 11/11 sanity-чеков остаются зелёными.

---

## Архитектурные ссылки

- §3.1 ManifestEntry / PropEntry / SlotPolicy
- §3.1.1 Design tokens
- §3.2 Extraction pipeline (stages 1–5 + 4b)
- §4.2 Tool-use constraint
- §5 Agent decomposition / skills
- §6.1 Operations / SSE events
- §6.4 Persistence schema + drift handling
- §7 Preview rendering
- §10 Orchestration substrate
- §11.2 Web v0 files
- §13 Out of scope (P3 candidates)
- §14 Roadmap milestones M0–M5

## Не делается (по §13 — out of scope v1)

Auth, multi-user, hosted deploy; third DS / plugin marketplace; per-session DS gating; auto-dedup re-exports; telemetry/langfuse; outbound MCP server; mobile emulator preview; accessibility audit of generated trees; JSX export; per-project file format; image/video generation; critique/memory subsystems; manifest watch mode; hot-swap CLI mid-session.
