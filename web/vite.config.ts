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

const dsPaths = readManifestConfigDsPaths();
const dsPackages = readDsPackageNames();

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../shared"),
      "@preview": resolve(__dirname, "../packages/preview-runtime/src"),
      "@manifest-data": resolve(__dirname, "../manifest-data"),
    },
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
