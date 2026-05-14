#!/usr/bin/env node
// `npm run setup:ds` — install transitive dependencies inside each DS clone.
//
// Reads manifest.config.json, walks every designSystems[].source.localPath,
// and runs `npm install --ignore-scripts --legacy-peer-deps --no-audit
// --no-fund` from inside that directory if its node_modules/ is missing.
//
// Why each of those flags:
//   --ignore-scripts        DS repos often have husky/prepare scripts that
//                           assume a dev-shell setup we don't have. Skip them.
//   --legacy-peer-deps      DSes tend to pin react peer-deps loosely; npm 7+
//                           strict resolution rejects compatible majors.
//   --no-audit --no-fund    Cosmetic — keeps stdout focused on real errors.
//
// The script is read-only outside .cache/ — it never modifies our package.json
// or installs DS packages into our node_modules. DSes keep their own
// node_modules; vite.config.ts is wired to find them via fs.allow.

import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const cfgPath = resolve(PROJECT_ROOT, "manifest.config.json");
if (!existsSync(cfgPath)) {
  console.error(`[setup:ds] manifest.config.json not found at ${cfgPath}`);
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));

const force = process.argv.includes("--force");
let failures = 0;

for (const ds of cfg.designSystems ?? []) {
  const localPath = ds?.source?.localPath;
  if (!localPath) {
    console.warn(`[setup:ds] [${ds.id}] no source.localPath — skipping`);
    continue;
  }
  const dsRoot = resolve(PROJECT_ROOT, localPath);
  if (!existsSync(dsRoot)) {
    console.error(`[setup:ds] [${ds.id}] path ${dsRoot} does not exist — operator must place the DS here first`);
    failures++;
    continue;
  }
  if (!existsSync(join(dsRoot, "package.json"))) {
    console.error(`[setup:ds] [${ds.id}] no package.json in ${dsRoot} — wrong path?`);
    failures++;
    continue;
  }
  const hasNodeModules = existsSync(join(dsRoot, "node_modules"));
  if (hasNodeModules && !force) {
    console.log(`[setup:ds] [${ds.id}] ${join(dsRoot, "node_modules")} already exists — skipping (use --force to reinstall)`);
    continue;
  }

  console.log(`[setup:ds] [${ds.id}] installing deps in ${dsRoot} ...`);
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npmCmd,
    ["install", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund"],
    {
      cwd: dsRoot,
      stdio: "inherit",
      shell: false,
    }
  );
  if (result.status !== 0) {
    console.error(`[setup:ds] [${ds.id}] npm install failed with exit code ${result.status}`);
    failures++;
  } else {
    console.log(`[setup:ds] [${ds.id}] ok`);
  }
}

if (failures) {
  console.error(`[setup:ds] ${failures} DS installation(s) failed — fix and re-run \`npm run setup:ds\``);
  process.exit(1);
}
console.log(`[setup:ds] done`);
