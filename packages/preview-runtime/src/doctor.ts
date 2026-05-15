// `npm run preview:doctor` — preflight sanity check.
//
// Runs the cheap-but-non-trivial validations before `npm run dev` so the
// operator (and the bring-up agent) catch wiring issues as a structured
// report rather than a chaotic browser console. Exit code is non-zero on
// the first failed check.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");

interface Check {
  id: string;
  description: string;
  run(): { ok: true } | { ok: false; reason: string; fix?: string };
}

const checks: Check[] = [
  {
    id: "manifest-built",
    description: "manifest-data/index.json exists and parses",
    run() {
      const p = join(PROJECT_ROOT, "manifest-data", "index.json");
      if (!existsSync(p)) {
        return {
          ok: false,
          reason: `${p} not found`,
          fix: "run `npm run manifest:build` first",
        };
      }
      try {
        const idx = JSON.parse(readFileSync(p, "utf8"));
        if (!Array.isArray(idx.entries) || idx.entries.length === 0) {
          return {
            ok: false,
            reason: "manifest-data/index.json has no entries",
            fix: "check manifest.config.json `componentRoot` + `excludePackages`; re-run `npm run manifest:build`",
          };
        }
      } catch (err) {
        return {
          ok: false,
          reason: `manifest-data/index.json invalid JSON: ${(err as Error).message}`,
          fix: "re-run `npm run manifest:build`",
        };
      }
      return { ok: true };
    },
  },
  {
    id: "tokens-css",
    description: "manifest-data/tokens.css exists (placeholder ok)",
    run() {
      const p = join(PROJECT_ROOT, "manifest-data", "tokens.css");
      if (!existsSync(p)) {
        return {
          ok: false,
          reason: `${p} missing`,
          fix: "re-run `npm run manifest:build` — Stage 4b should write it",
        };
      }
      return { ok: true };
    },
  },
  {
    id: "component-map-current",
    description: "component-map.ts up-to-date with manifest-data/index.json",
    run() {
      const cm = join(PROJECT_ROOT, "packages", "preview-runtime", "src", "component-map.ts");
      const idx = join(PROJECT_ROOT, "manifest-data", "index.json");
      if (!existsSync(cm)) {
        return {
          ok: false,
          reason: "packages/preview-runtime/src/component-map.ts missing",
          fix: "run `npm run preview:wire`",
        };
      }
      if (existsSync(idx) && statSync(idx).mtimeMs > statSync(cm).mtimeMs) {
        return {
          ok: false,
          reason: "manifest-data/index.json is newer than component-map.ts",
          fix: "run `npm run preview:wire` to regenerate",
        };
      }
      return { ok: true };
    },
  },
  {
    id: "ds-paths-exist",
    description: "every designSystems[].source.localPath in manifest.config.json points at a real directory",
    run() {
      const cfgPath = join(PROJECT_ROOT, "manifest.config.json");
      if (!existsSync(cfgPath)) {
        return { ok: false, reason: "manifest.config.json missing" };
      }
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      for (const ds of cfg.designSystems ?? []) {
        const lp = ds?.source?.localPath;
        if (!lp) continue;
        const abs = resolve(PROJECT_ROOT, lp);
        if (!existsSync(abs)) {
          return {
            ok: false,
            reason: `DS '${ds.id}' source.localPath ${abs} does not exist`,
            fix: `place the DS clone (symlink, junction, or git clone) at that path`,
          };
        }
        if (!existsSync(join(abs, "package.json"))) {
          return {
            ok: false,
            reason: `DS '${ds.id}' path ${abs} has no package.json`,
            fix: `point source.localPath at the DS repo root (containing package.json)`,
          };
        }
      }
      return { ok: true };
    },
  },
  {
    id: "ds-deps-installed",
    description: "each DS has its own node_modules (transitive deps available to Vite)",
    run() {
      const cfgPath = join(PROJECT_ROOT, "manifest.config.json");
      if (!existsSync(cfgPath)) return { ok: true }; // earlier check catches missing config
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      for (const ds of cfg.designSystems ?? []) {
        const lp = ds?.source?.localPath;
        if (!lp) continue;
        const abs = resolve(PROJECT_ROOT, lp);
        if (!existsSync(abs)) continue; // earlier check catches missing path
        if (!existsSync(join(abs, "node_modules"))) {
          return {
            ok: false,
            reason: `DS '${ds.id}' has no node_modules at ${abs}`,
            fix: "run `npm run setup:ds` — installs DS transitive deps in-place",
          };
        }
      }
      return { ok: true };
    },
  },
  {
    id: "preview-entries-resolve",
    description: "every DS package referenced by the manifest has a loadable source entry on disk",
    run() {
      const sidecar = join(PROJECT_ROOT, "manifest-data", "preview-aliases.json");
      if (!existsSync(sidecar)) {
        return {
          ok: false,
          reason: "manifest-data/preview-aliases.json missing",
          fix: "run `npm run preview:wire` (it writes the sidecar from a real DS scan)",
        };
      }
      const idxPath = join(PROJECT_ROOT, "manifest-data", "index.json");
      let referenced: Set<string>;
      try {
        const idx = JSON.parse(readFileSync(idxPath, "utf8"));
        referenced = new Set<string>((idx.entries ?? []).map((e: any) => e.packageName));
      } catch {
        return { ok: false, reason: "manifest-data/index.json unreadable", fix: "re-run `npm run manifest:build`" };
      }
      let pkgs: Record<string, { entry: string | null; dir: string }>;
      try {
        pkgs = JSON.parse(readFileSync(sidecar, "utf8")).packages ?? {};
      } catch (err) {
        return { ok: false, reason: `preview-aliases.json invalid JSON: ${(err as Error).message}`, fix: "re-run `npm run preview:wire`" };
      }
      // A manifest-referenced package with no resolvable entry → it was
      // dropped from component-map.ts and would 404 in the preview iframe.
      const broken = [...referenced].filter((name) => {
        const info = pkgs[name];
        return !info || !info.entry || !existsSync(info.entry);
      });
      if (broken.length) {
        const sample = broken.slice(0, 8).join(", ");
        return {
          ok: false,
          reason:
            `${broken.length} manifest package(s) have no loadable source entry: ${sample}` +
            (broken.length > 8 ? ` … (+${broken.length - 8} more)` : ""),
          fix:
            "see packages/preview-runtime/src/component-map.report.json `dropped[]` for the exact per-package " +
            "`tried:` paths. This is a DS-side packaging issue (built-output-only package installed with " +
            "--ignore-scripts, or no `src/index.*` / `source` field) — NOT a manifest.config.json fix. " +
            "Record it in docs/setup-report.md and STOP; do not edit code.",
        };
      }
      return { ok: true };
    },
  },
  {
    id: "ds-styles-resolve",
    description: "declared DS global stylesheets exist; CSS strategy has its Vite plugin",
    run() {
      const sidecar = join(PROJECT_ROOT, "manifest-data", "preview-styles.json");
      if (!existsSync(sidecar)) {
        return { ok: false, reason: "manifest-data/preview-styles.json missing", fix: "run `npm run preview:wire`" };
      }
      let j: any;
      try {
        j = JSON.parse(readFileSync(sidecar, "utf8"));
      } catch (err) {
        return { ok: false, reason: `preview-styles.json invalid JSON: ${(err as Error).message}`, fix: "re-run `npm run preview:wire`" };
      }
      const perDs: Array<{ id: string; strategy: string; resolved: string[]; missing: string[] }> = j.perDs ?? [];
      // 1. Declared-but-missing global stylesheet → operator typo'd a path.
      const broken = perDs.filter((d) => d.missing?.length);
      if (broken.length) {
        const lines = broken.map((d) => `${d.id}: ${d.missing.join(", ")}`).join(" | ");
        return {
          ok: false,
          reason: `declared global stylesheet(s) not found — ${lines}`,
          fix: "fix the relative paths in manifest.config.json `designSystems[].styles.globalStylesheets` (relative to the DS root)",
        };
      }
      // 2. zero-runtime strategy needs a Vite plugin available.
      const need: Record<string, string> = {
        "vanilla-extract": "@vanilla-extract/vite-plugin",
        linaria: "@wyw-in-js/vite",
      };
      for (const d of perDs) {
        const dep = need[d.strategy];
        if (!dep) continue;
        const installed = existsSync(join(PROJECT_ROOT, "node_modules", ...dep.split("/")));
        if (!installed) {
          return {
            ok: false,
            reason: `DS '${d.id}' uses ${d.strategy} but ${dep} is not installed — its components render unstyled`,
            fix: `maintainer installs it: \`npm i -D ${dep}\` (this is a code/dependency change, NOT a config one — record in docs/setup-report.md if you are the bring-up agent)`,
          };
        }
      }
      // 3. No global stylesheets anywhere is NOT a failure: CSS-modules /
      //    runtime-css-in-js DSes legitimately self-import their CSS, and an
      //    explicit `globalStylesheets: []` is a conscious operator choice.
      //    We can't know from here whether components self-import, so this is
      //    advisory only — surfaced on the console, never blocks bring-up.
      const total = perDs.reduce((n, d) => n + (d.resolved?.length ?? 0), 0);
      if (perDs.length > 0 && total === 0) {
        const strategies = [...new Set(perDs.map((d) => d.strategy))].join(", ");
        process.stdout.write(
          `           note: no DS declares styles.globalStylesheets (strategy: ${strategies}). ` +
            `Fine for self-importing CSS-modules; if components look unstyled, add the DS's base/reset CSS to ` +
            `manifest.config.json designSystems[].styles.globalStylesheets.\n`
        );
      }
      return { ok: true };
    },
  },
  {
    id: "typecheck-component-map",
    description: "tsc --noEmit on the project filters component-map.ts errors",
    run() {
      const cm = join(PROJECT_ROOT, "packages", "preview-runtime", "src", "component-map.ts");
      if (!existsSync(cm)) return { ok: false, reason: "component-map.ts missing", fix: "run `npm run preview:wire`" };
      // Use the project tsconfig so module resolution, paths, and JSX runtime
      // settings match real dev-time behaviour. Single-file `tsc <file>`
      // ignores tsconfig.
      // Use tsconfig.dev.json (auto-generated by preview:wire) — it has
      // the DS scope path aliases. Fall back to tsconfig.json if not present.
      const tsconfigDev = join(PROJECT_ROOT, "tsconfig.dev.json");
      const projectFlag = existsSync(tsconfigDev) ? "tsconfig.dev.json" : "tsconfig.json";
      const r = spawnSync(
        process.platform === "win32" ? "npx.cmd" : "npx",
        ["tsc", "--noEmit", "--pretty", "false", "-p", projectFlag],
        { cwd: PROJECT_ROOT, encoding: "utf8" }
      );
      if (r.status !== 0) {
        const all = (r.stdout ?? "") + "\n" + (r.stderr ?? "");
        // Surface only errors that point at component-map.ts — other files
        // are out of this check's scope.
        const cmErrors = all
          .split(/\r?\n/)
          .filter((l) => l.includes("component-map.ts") && l.includes("error"));
        if (cmErrors.length === 0) {
          // tsc failed but not on component-map.ts → not our problem; pass.
          return { ok: true };
        }
        return {
          ok: false,
          reason: `tsc reported errors in component-map.ts:\n${cmErrors.slice(0, 5).join("\n")}`,
          fix: "re-run `npm run preview:wire` — generator drops failing packages and writes component-map.report.json",
        };
      }
      return { ok: true };
    },
  },
];

let failures = 0;
for (const c of checks) {
  process.stdout.write(`  [check] ${c.id.padEnd(28)} — `);
  const r = c.run();
  if (r.ok) {
    process.stdout.write("ok\n");
  } else {
    process.stdout.write(`FAIL\n           reason: ${r.reason}\n`);
    if (r.fix) process.stdout.write(`           fix:    ${r.fix}\n`);
    failures++;
  }
}

if (failures) {
  process.stdout.write(`\n[preview:doctor] ${failures} check(s) failed. Apply the fix above and re-run.\n`);
  process.exit(1);
}
process.stdout.write(`\n[preview:doctor] all checks passed — run \`npm run dev\`.\n`);
