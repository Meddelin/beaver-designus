import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { withDsTransformResilience, dsJsxPrePlugin } from "./vite-ds-resilience.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

/* Real DS source (e.g. react-ui-kit's tinkoff-packages) still ships
 * 2018-style class decorators (`@dragHOC class Foo extends …`). The DS's
 * OWN build compiles these; a faithful preview must too, otherwise a
 * single legacy file transitively imported by a *modern, supported*
 * component takes down the whole iframe with a Babel parse error. So we
 * enable legacy decorators in @vitejs/plugin-react's Babel pass.
 *
 * This is NOT our tech debt — we're compiling the DS as the DS does.
 * Loaded defensively: if the plugin isn't installed yet, warn loudly
 * (preview:doctor surfaces it) instead of hard-crashing the config. */
function reactPluginWithDecorators() {
  try {
    const decorators = require.resolve("@babel/plugin-proposal-decorators");
    return react({ babel: { plugins: [[decorators, { legacy: true }]] } });
  } catch {
    console.warn(
      "[vite] @babel/plugin-proposal-decorators not installed — DS files using " +
        "legacy class decorators (e.g. react-ui-kit tinkoff-packages) will fail to " +
        "transform and crash the preview. Maintainer: `npm i -D @babel/plugin-proposal-decorators`."
    );
    return react();
  }
}

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
    type PkgAlias = {
      entry: string | null;
      dir: string;
      subpaths?: Record<string, string>;
      wildcardBase?: string | null;
    };
    const pkgs: Record<string, PkgAlias> = j.packages ?? {};
    for (const [name, info] of Object.entries(pkgs)) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Order matters — Vite resolves the alias array in sequence, so the
      // most specific patterns must come first:
      //   1. concrete subpath exports  (@x/pkg/legacy → exact file)
      //   2. exact package root        (@x/pkg → entry)
      //   3. deep-import wildcard       (@x/pkg/* → wildcard base | dir)
      for (const [sub, file] of Object.entries(info.subpaths ?? {})) {
        const subEsc = sub.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        aliases.push({ find: new RegExp(`^${esc}/${subEsc}$`), replacement: file });
      }
      if (info.entry) {
        aliases.push({ find: new RegExp(`^${esc}$`), replacement: info.entry });
      }
      const deepBase = info.wildcardBase || info.dir;
      if (deepBase) {
        aliases.push({ find: new RegExp(`^${esc}/(.*)$`), replacement: `${deepBase}/$1` });
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
  plugins: [
    // F10: compile JSX in legacy DS `.js` before React/import-analysis.
    dsJsxPrePlugin(dsPaths),
    ...withDsTransformResilience(reactPluginWithDecorators(), dsPaths),
    ...(await dsCssPlugins()),
  ],
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
