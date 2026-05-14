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

/* Derive scope→path aliases mirroring what `npm run preview:wire` writes
 * into tsconfig.dev.json. Returns an alias array suitable for Vite's
 * resolve.alias config. We compute it here directly (rather than read
 * tsconfig.dev.json) so the dev server works even before the first
 * preview:wire run — same source of truth (manifest.config.json) avoids
 * drift. */
function readDsScopeAliases(): Array<{ find: RegExp; replacement: string }> {
  const cfgPath = resolve(PROJECT_ROOT, "manifest.config.json");
  if (!existsSync(cfgPath)) return [];
  const aliases: Array<{ find: RegExp; replacement: string }> = [];
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    for (const ds of cfg.designSystems ?? []) {
      const localPath: string | undefined = ds?.source?.localPath;
      const componentRoot: string | undefined = ds?.componentRoot;
      if (!localPath || !componentRoot) continue;
      const dsRoot = resolve(PROJECT_ROOT, localPath);
      const pkgsDir = resolve(dsRoot, componentRoot);
      const fs = require("node:fs") as typeof import("node:fs");
      if (!fs.existsSync(pkgsDir)) continue;
      // Find one package, extract its scope from package.json `name`.
      for (const dir of fs.readdirSync(pkgsDir)) {
        const pjPath = resolve(pkgsDir, dir, "package.json");
        if (!fs.existsSync(pjPath)) continue;
        try {
          const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
          if (typeof pj.name === "string" && pj.name.startsWith("@") && pj.name.includes("/")) {
            const scope = pj.name.split("/")[0];
            // Vite's resolve.alias accepts a regex `find`. We match
            // `<scope>/<rest>` and rewrite to `<absPkgsDir>/<rest>`.
            // Escape regex meta in the scope (only @ and - are common).
            const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            aliases.push({
              find: new RegExp(`^${escaped}/(.+)`),
              replacement: `${pkgsDir.replace(/\\/g, "/")}/$1`,
            });
            break;
          }
        } catch {}
      }
    }
  } catch {}
  return aliases;
}

const dsPaths = readManifestConfigDsPaths();
const dsPackages = readDsPackageNames();
const dsAliases = readDsScopeAliases();

export default defineConfig({
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
  plugins: [react()],
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
});
