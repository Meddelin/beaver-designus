// `npm run preview:wire` — deterministic component-map generator.
//
// Reads manifest-data/index.json, emits packages/preview-runtime/src/component-map.ts
// with per-package imports, always-aliased export names (so cross-package
// collisions are structurally impossible), and a sidecar report listing any
// packages that had to be dropped due to TS-resolution failure during a
// post-write `tsc --noEmit` pass.
//
// The local bring-up agent should NOT hand-author component-map.ts. Run this
// script after every `npm run manifest:build`.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");
const OUT_FILE = join(__dirname, "component-map.ts");
const REPORT_FILE = join(__dirname, "component-map.report.json");
const INDEX_PATH = join(PROJECT_ROOT, "manifest-data", "index.json");
const CONFIG_PATH = join(PROJECT_ROOT, "manifest.config.json");
const TSCONFIG_DEV_PATH = join(PROJECT_ROOT, "tsconfig.dev.json");

interface ManifestEntryLite {
  id: string;
  sourceSystem: string;
  packageName: string;
  exportName: string;
}

interface DroppedPackage {
  packageName: string;
  reason: string;
  components: string[];
}

interface GeneratorReport {
  generatedAt: string;
  totalEntries: number;
  totalPackages: number;
  written: { entries: number; packages: number };
  dropped: DroppedPackage[];
  warnings: string[];
}

run();

function run(): void {
  if (!existsSync(INDEX_PATH)) {
    console.error(`[preview:wire] ${INDEX_PATH} not found. Run \`npm run manifest:build\` first.`);
    process.exit(2);
  }

  // Step 0 — Before anything else, write tsconfig.dev.json with DS path
  // aliases derived from manifest.config.json. Without this, every tsc
  // check below would surface TS2307 (Cannot find module @ds/X) because
  // DS packages live in .cache/<ds>/<componentRoot>/* — not in our root
  // node_modules. The dev tsconfig extends the project tsconfig and adds
  // <scope>/* → .cache/<ds>/<componentRoot>/* paths.
  const writtenAliases = writeTsconfigDev();
  if (writtenAliases.length) {
    console.log(`[preview:wire] wrote tsconfig.dev.json with ${writtenAliases.length} DS scope alias(es)`);
  }

  const idx = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  const entries: ManifestEntryLite[] = idx.entries ?? [];
  if (entries.length === 0) {
    writePlaceholder("manifest is empty — produced an empty COMPONENT_MAP");
    writeReport({
      generatedAt: new Date().toISOString(),
      totalEntries: 0,
      totalPackages: 0,
      written: { entries: 0, packages: 0 },
      dropped: [],
      warnings: ["manifest-data/index.json had zero entries; nothing to wire"],
    });
    console.log("[preview:wire] wrote empty COMPONENT_MAP (no entries in manifest)");
    return;
  }

  // Group by package. Within a package, dedupe by exportName.
  const byPkg = new Map<string, Map<string, ManifestEntryLite>>();
  for (const e of entries) {
    if (!byPkg.has(e.packageName)) byPkg.set(e.packageName, new Map());
    const inner = byPkg.get(e.packageName)!;
    if (!inner.has(e.exportName)) inner.set(e.exportName, e);
  }

  const warnings: string[] = [];
  const droppedPackages: DroppedPackage[] = [];

  // First pass: write the full map.
  emit(byPkg, []);

  // Validate by running TS on just the generated file. We use the project's
  // tsconfig so module resolution mirrors the dev server.
  const tsCheck = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsc", "--noEmit", "--pretty", "false", "-p", existsSync(TSCONFIG_DEV_PATH) ? "tsconfig.dev.json" : "tsconfig.json"],
    { cwd: PROJECT_ROOT, encoding: "utf8" }
  );

  if (tsCheck.status === 0) {
    finalize(byPkg, droppedPackages, warnings);
    return;
  }

  // Parse TS errors. Distinguish two failure classes:
  //   TS2307 ("Cannot find module ...")        → resolution / config issue.
  //     Don't drop packages — surface the failure with a concrete fix.
  //   TS2305 / TS2724 ("has no exported member ...")  → real export
  //     mismatch on the DS side. Drop the specific package(s) and retry.
  const errors = (tsCheck.stdout ?? "") + "\n" + (tsCheck.stderr ?? "");
  const cmErrorLines = errors.split(/\r?\n/).filter((l) => l.includes("component-map.ts") && l.includes("error"));
  const hasResolutionErrors = cmErrorLines.some((l) => /error TS2307/.test(l));
  if (hasResolutionErrors) {
    const sample = cmErrorLines.filter((l) => /error TS2307/.test(l)).slice(0, 5).join("\n");
    warnings.push(
      "tsc reported TS2307 (Cannot find module) — DS scope aliases are likely missing.\n" +
        "  Hint: confirm `npm run setup:ds` ran successfully and tsconfig.dev.json contains the right paths.\n" +
        "  Sample errors:\n" + sample
    );
    // Don't drop anything — keep the full component-map.ts so the
    // operator can still inspect what was generated. Report the issue.
    finalize(byPkg, droppedPackages, warnings, errors);
    return;
  }
  const failingPackages = extractFailingPackages(errors, byPkg);

  if (failingPackages.size === 0) {
    // Errors exist but we can't attribute them to a specific package. Leave
    // the file as-is and report verbatim.
    warnings.push("tsc reported errors that don't map to a specific package import — see component-map.report.json `tscOutput`");
    finalize(byPkg, droppedPackages, warnings, errors);
    return;
  }

  for (const pkg of failingPackages) {
    const entries = byPkg.get(pkg);
    if (!entries) continue;
    droppedPackages.push({
      packageName: pkg,
      reason: "import resolution failed during tsc check",
      components: [...entries.values()].map((e) => e.id),
    });
    byPkg.delete(pkg);
  }

  // Second pass with failing packages removed.
  emit(byPkg, droppedPackages);
  const tsCheck2 = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsc", "--noEmit", "--pretty", "false", "-p", existsSync(TSCONFIG_DEV_PATH) ? "tsconfig.dev.json" : "tsconfig.json"],
    { cwd: PROJECT_ROOT, encoding: "utf8" }
  );
  if (tsCheck2.status !== 0) {
    const remaining = (tsCheck2.stdout ?? "") + "\n" + (tsCheck2.stderr ?? "");
    const cmErrors = remaining.split(/\r?\n/).filter((l) => l.includes("component-map.ts") && l.includes("error"));
    if (cmErrors.length > 0) {
      warnings.push("tsc still reports errors after dropping failing packages — see tscOutput");
      finalize(byPkg, droppedPackages, warnings, remaining);
      return;
    }
  }

  finalize(byPkg, droppedPackages, warnings);
}

function emit(byPkg: Map<string, Map<string, ManifestEntryLite>>, dropped: DroppedPackage[]): void {
  if (byPkg.size === 0) {
    writePlaceholder("no packages survived TS-resolution check");
    return;
  }

  const importLines: string[] = [];
  const mapLines: string[] = [];

  // Deterministic order — sort by package name then export name. Keeps
  // diffs stable across regenerations.
  const sortedPkgs = [...byPkg.keys()].sort();
  for (const pkg of sortedPkgs) {
    const exports = [...byPkg.get(pkg)!.values()].sort((a, b) => a.exportName.localeCompare(b.exportName));
    const specs = exports.map((e) => `${e.exportName} as ${aliasFor(pkg, e.exportName)}`);
    importLines.push(`import { ${specs.join(", ")} } from "${pkg}";`);
  }

  for (const pkg of sortedPkgs) {
    const exports = [...byPkg.get(pkg)!.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (const e of exports) {
      mapLines.push(`  ${JSON.stringify(e.id)}: ${aliasFor(pkg, e.exportName)} as React.ComponentType<any>,`);
    }
  }

  const droppedComment = dropped.length
    ? `// Dropped from this map (resolution failed):\n${dropped
        .map((d) => `//   - ${d.packageName} (${d.components.length} component(s))`)
        .join("\n")}\n//\n`
    : "";

  const out =
`// AUTO-GENERATED by \`npm run preview:wire\` — do not hand-edit.
// Regenerate after every \`npm run manifest:build\`.
//
${droppedComment}// Aliasing convention: every imported symbol is renamed to
// <PackageSlugPascalCase>__<ExportName>, eliminating cross-package collisions
// (e.g. LabelDesktop in @tui-react/checkbox AND @tui-react/radio AND ...).
// The COMPONENT_MAP keys remain canonical \`<sourceSystem>:<package>/<exportName>\`
// strings produced by the manifest builder.

import * as React from "react";
import { UnknownComponentFallback } from "./fallbacks.tsx";

${importLines.join("\n")}

export const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
${mapLines.join("\n")}
};

export function resolveComponent(id: string): React.ComponentType<any> {
  return COMPONENT_MAP[id] ?? ((_props: any) => React.createElement(UnknownComponentFallback, { id }));
}
`;
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, out);
}

function finalize(
  byPkg: Map<string, Map<string, ManifestEntryLite>>,
  dropped: DroppedPackage[],
  warnings: string[],
  tscOutput?: string
): void {
  const totalWrittenEntries = [...byPkg.values()].reduce((n, m) => n + m.size, 0);
  const report: GeneratorReport & { tscOutput?: string } = {
    generatedAt: new Date().toISOString(),
    totalEntries: totalWrittenEntries + dropped.reduce((n, d) => n + d.components.length, 0),
    totalPackages: byPkg.size + dropped.length,
    written: { entries: totalWrittenEntries, packages: byPkg.size },
    dropped,
    warnings,
  };
  if (tscOutput) report.tscOutput = tscOutput;
  writeReport(report);
  console.log(
    `[preview:wire] wrote ${totalWrittenEntries} entries across ${byPkg.size} package(s); ` +
      `dropped ${dropped.length}; warnings: ${warnings.length}`
  );
  if (dropped.length) {
    console.log(`[preview:wire] dropped packages (see component-map.report.json):`);
    for (const d of dropped) console.log(`  · ${d.packageName} — ${d.components.length} component(s)`);
  }
}

function writePlaceholder(reason: string): void {
  const out =
`// AUTO-GENERATED by \`npm run preview:wire\` — placeholder.
// Reason: ${reason}
import * as React from "react";
import { UnknownComponentFallback } from "./fallbacks.tsx";

export const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {};

export function resolveComponent(id: string): React.ComponentType<any> {
  return (_props: any) => React.createElement(UnknownComponentFallback, { id });
}
`;
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, out);
}

function writeReport(report: object): void {
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
}

/* Derive scope→path aliases from manifest.config.json and write
 * tsconfig.dev.json that extends the project tsconfig. Returns the list
 * of aliases written so the caller can log it.
 *
 * For each DS in the config:
 *  - Look at <dsRoot>/<componentRoot>/<first-pkg>/package.json
 *  - Extract `name` (e.g. "@tui-react/button") → scope "@tui-react"
 *  - Emit `<scope>/*` → `<dsRoot>/<componentRoot>/*`
 *
 * This handles the common case where package basename matches the
 * second segment of the package name. DSes with name/basename
 * divergence need explicit per-package paths — left as a follow-up.
 */
function writeTsconfigDev(): string[] {
  if (!existsSync(CONFIG_PATH)) return [];
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

  // Preserve the project's base paths. The dev config's `paths` REPLACES
  // the parent's, so we read base paths from the main tsconfig and
  // concatenate. Use a tolerant JSONC-style strip-comments parse —
  // typical tsconfig.json has no comments in this repo, but be safe.
  let basePaths: Record<string, string[]> = {};
  const tsRoot = join(PROJECT_ROOT, "tsconfig.json");
  if (existsSync(tsRoot)) {
    try {
      const raw = readFileSync(tsRoot, "utf8").replace(/\/\/[^\n]*/g, "");
      const parsed = JSON.parse(raw);
      basePaths = parsed?.compilerOptions?.paths ?? {};
    } catch {
      // Fall through with empty basePaths — `extends` still pulls compilerOptions.
    }
  }

  const dsPaths: Record<string, string[]> = {};
  const writtenAliases: string[] = [];

  for (const ds of cfg.designSystems ?? []) {
    const localPath = ds?.source?.localPath;
    const componentRoot = ds?.componentRoot;
    if (!localPath || !componentRoot) continue;
    const dsRoot = resolve(PROJECT_ROOT, localPath);
    const pkgsDir = resolve(dsRoot, componentRoot);
    if (!existsSync(pkgsDir)) continue;

    // Find the first package and read its scope.
    let scope: string | null = null;
    for (const dir of readdirSync(pkgsDir)) {
      const pjPath = join(pkgsDir, dir, "package.json");
      if (!existsSync(pjPath)) continue;
      try {
        const pj = JSON.parse(readFileSync(pjPath, "utf8"));
        if (typeof pj.name === "string" && pj.name.startsWith("@") && pj.name.includes("/")) {
          scope = pj.name.split("/")[0];
          break;
        }
      } catch {}
    }
    if (!scope) continue;

    // Build the path mapping (relative to PROJECT_ROOT for tsconfig).
    const relRoot = relative(PROJECT_ROOT, pkgsDir).replace(/\\/g, "/");
    const alias = `${scope}/*`;
    dsPaths[alias] = [`./${relRoot}/*`];
    writtenAliases.push(`${alias} → ./${relRoot}/*`);
  }

  // If the operator passes peerless DSes (no scope or empty pkgsDir), we
  // still emit a tsconfig.dev.json that just inherits base paths — keeps
  // the downstream `tsc -p tsconfig.dev.json` working without surprises.
  const merged = { ...basePaths, ...dsPaths };
  const out = {
    $comment: "Auto-generated by `npm run preview:wire`. Refreshes every run. Don't hand-edit; rerun the generator to regenerate.",
    extends: "./tsconfig.json",
    compilerOptions: {
      paths: merged,
    },
  };
  writeFileSync(TSCONFIG_DEV_PATH, JSON.stringify(out, null, 2) + "\n");
  return writtenAliases;
}

/* Convert "@tui-react/checkbox" → "TuiReactCheckbox".  "@beaver-ui/button" → "BeaverUiButton". */
function packageSlug(pkg: string): string {
  return pkg
    .replace(/^@/, "")
    .split(/[\/\-_]+/)
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join("");
}

function aliasFor(pkg: string, exportName: string): string {
  return `${packageSlug(pkg)}__${exportName}`;
}

/* Walk tsc error output and identify which package imports are unresolved.
 * Matches errors like:
 *   ".../component-map.ts(7,X): error TS2307: Cannot find module '@tui-react/foo'..."
 *   ".../component-map.ts(7,X): error TS2724: '"@tui-react/foo"' has no exported member 'Bar'..."
 */
function extractFailingPackages(stderr: string, byPkg: Map<string, unknown>): Set<string> {
  const failing = new Set<string>();
  const packagePattern = /['"]([@\w][\w@\/\-.]+)['"]/g;
  for (const line of stderr.split(/\r?\n/)) {
    if (!/component-map\.ts.*error TS(2307|2305|2724)/.test(line)) continue;
    let m: RegExpExecArray | null;
    while ((m = packagePattern.exec(line))) {
      const candidate = m[1];
      if (byPkg.has(candidate)) failing.add(candidate);
    }
  }
  return failing;
}
