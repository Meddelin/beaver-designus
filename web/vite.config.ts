import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

/* Pull DS source paths out of manifest.config.json so Vite can serve files
 * from symlinked / out-of-tree DS clones. Two things we need:
 *   1. server.fs.allow — Vite refuses to serve files outside the project
 *      root unless they're explicitly allowed.
 *   2. resolve.dedupe — ensures the host's react / react-dom wins when a
 *      symlinked DS has its own node_modules with a different React copy
 *      (mismatched copies break hooks at runtime).
 */
function readManifestConfigDsPaths(): string[] {
  const cfgPath = resolve(PROJECT_ROOT, "manifest.config.json");
  if (!existsSync(cfgPath)) return [];
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    const out: string[] = [];
    for (const ds of cfg.designSystems ?? []) {
      const p = ds?.source?.localPath;
      if (typeof p === "string") out.push(resolve(PROJECT_ROOT, p));
    }
    return out;
  } catch {
    return [];
  }
}

function readDsPackageNames(): string[] {
  const idxPath = resolve(PROJECT_ROOT, "manifest-data", "index.json");
  if (!existsSync(idxPath)) return [];
  try {
    const idx = JSON.parse(readFileSync(idxPath, "utf8"));
    const names = new Set<string>();
    for (const e of idx.entries ?? []) {
      if (typeof e.packageName === "string") names.add(e.packageName);
    }
    return [...names];
  } catch {
    return [];
  }
}

/* Read manifest-data/preview-aliases.json — the single source of truth
 * written by `npm run preview:wire` from a real on-disk DS scan. For each
 * package we emit TWO anchored-regex aliases:
 *   ^@scope/pkg$       → <exact resolved source entry file>
 *   ^@scope/pkg/(.*)$  → <package dir>/$1   (deep imports)
 * Anchored regex (not Vite's prefix-matching string alias) so
 * "@beaver-ui/button" never accidentally swallows "@beaver-ui/button-group",
 * and so the bare specifier maps to the precise entry FILE rather than a
 * directory whose package.json `main` points at an unbuilt dist/.
 *
 * If the sidecar is absent we intentionally return [] (no guessing): the
 * operator must run `npm run preview:wire` first — `npm run preview:doctor`
 * says so explicitly. A wrong alias is worse than a missing one. */
function readDsScopeAliases(): Array<{ find: RegExp; replacement: string }> {
  const sidecar = resolve(PROJECT_ROOT, "manifest-data", "preview-aliases.json");
  if (!existsSync(sidecar)) return [];
  const aliases: Array<{ find: RegExp; replacement: string }> = [];
  try {
    const j = JSON.parse(readFileSync(sidecar, "utf8"));
    const pkgs: Record<string, { entry: string | null; dir: string }> = j.packages ?? {};
    for (const [name, info] of Object.entries(pkgs)) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Exact-match alias first (Vite resolves alias array in order).
      if (info.entry) {
        aliases.push({ find: new RegExp(`^${esc}$`), replacement: info.entry });
      }
      // Deep-import alias → package dir.
      if (info.dir) {
        aliases.push({ find: new RegExp(`^${esc}/(.*)$`), replacement: `${info.dir}/$1` });
      }
    }
  } catch {}
  return aliases;
}

/* P6 — read the preview-styles.json sidecar (written by preview:wire) to
 * learn which CSS strategies the wired DSes use, and conditionally load the
 * matching Vite plugin. Optional plugins are dynamically imported and
 * tolerated-missing: a DS that needs vanilla-extract/linaria but whose
 * plugin isn't installed yields a loud console warning (and preview:doctor
 * flags it) rather than a hard crash. */
async function dsCssPlugins(): Promise<any[]> {
  const sidecar = resolve(PROJECT_ROOT, "manifest-data", "preview-styles.json");
  if (!existsSync(sidecar)) return [];
  const strategies = new Set<string>();
  try {
    const j = JSON.parse(readFileSync(sidecar, "utf8"));
    for (const d of j.perDs ?? []) if (d?.strategy) strategies.add(d.strategy);
  } catch {
    return [];
  }
  const out: any[] = [];
  if (strategies.has("vanilla-extract")) {
    try {
      // Non-literal specifier: optional dep, must not be a static type/resolve dependency.
      const mod: any = await import(["@vanilla-extract", "vite-plugin"].join("/"));
      out.push(mod.vanillaExtractPlugin());
    } catch {
      console.warn(
        "[vite] a wired DS uses vanilla-extract but @vanilla-extract/vite-plugin is not installed — " +
          "its components will be unstyled. Maintainer: `npm i -D @vanilla-extract/vite-plugin`."
      );
    }
  }
  if (strategies.has("linaria")) {
    try {
      const mod: any = await import(["@wyw-in-js", "vite"].join("/"));
      out.push((mod.default ?? mod)());
    } catch {
      console.warn(
        "[vite] a wired DS uses linaria but @wyw-in-js/vite is not installed — " +
          "its components will be unstyled. Maintainer: `npm i -D @wyw-in-js/vite`."
      );
    }
  }
  // "modules" and "runtime-css-in-js" need no extra plugin (Vite handles
  // CSS Modules natively; styled-components/emotion inject at runtime).
  return out;
}

/* If a DS points at its own PostCSS config, reuse it so nesting /
 * custom-media / mixins compile the way the DS's own build does. */
function readPostcssConfig(): string | undefined {
  const cfgPath = resolve(PROJECT_ROOT, "manifest.config.json");
  if (!existsSync(cfgPath)) return undefined;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    const found: string[] = [];
    for (const ds of cfg.designSystems ?? []) {
      const pc = ds?.styles?.postcssConfig;
      const lp = ds?.source?.localPath;
      if (pc && lp) found.push(resolve(PROJECT_ROOT, lp, pc));
    }
    const existing = found.filter((p) => existsSync(p));
    if (existing.length > 1) {
      console.warn(`[vite] multiple DS postcssConfig declared; using ${existing[0]}`);
    }
    return existing[0];
  } catch {
    return undefined;
  }
}

const dsPaths = readManifestConfigDsPaths();
const dsPackages = readDsPackageNames();
const dsAliases = readDsScopeAliases();

export default defineConfig(async () => ({
  root: __dirname,
  resolve: {
    alias: [
      // Project-internal aliases. Strings (not regex) so they apply on
      // exact-prefix match for the bare alias word.
      { find: "@shared", replacement: resolve(__dirname, "../shared") },
      { find: "@preview", replacement: resolve(__dirname, "../packages/preview-runtime/src") },
      { find: "@manifest-data", replacement: resolve(__dirname, "../manifest-data") },
      // DS scope aliases — derived from manifest.config.json so adding a
      // new DS doesn't require a vite.config change.
      ...dsAliases,
    ],
    // Force a single copy of React across symlinked DS packages.
    dedupe: ["react", "react-dom"],
    // Default behaviour is to follow symlinks — pin it so an upstream change
    // (or a stray .npmrc) can't flip the resolution mode silently.
    preserveSymlinks: false,
  },
  plugins: [react(), ...(await dsCssPlugins())],
  css: ((): any => {
    const postcss = readPostcssConfig();
    return postcss ? { postcss } : {};
  })(),
  optimizeDeps: {
    // Don't try to pre-bundle DS packages — they're source TS in symlinked
    // out-of-tree dirs and Vite's esbuild pre-bundle fails on them. Let the
    // dev server transpile each TSX file on demand through the React plugin.
    exclude: dsPackages,
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    fs: {
      // Project root + every DS root from manifest.config.json. With the
      // playbook flow `.cache/<ds>` is the canonical DS location, but a
      // developer may symlink an existing checkout elsewhere — we resolve
      // both to absolute paths so Vite's allow-list covers either.
      allow: [PROJECT_ROOT, ...dsPaths],
      // strict:false → Vite tolerates absolute paths outside the project
      // root (file:-installed DS packages produce these via node_modules).
      strict: false,
    },
    proxy: {
      "/api": "http://127.0.0.1:7457",
    },
  },
}));
