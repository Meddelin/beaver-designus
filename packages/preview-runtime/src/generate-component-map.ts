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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");
const OUT_FILE = join(__dirname, "component-map.ts");
const REPORT_FILE = join(__dirname, "component-map.report.json");
const INDEX_PATH = join(PROJECT_ROOT, "manifest-data", "index.json");

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
    ["tsc", "--noEmit", "--pretty", "false"],
    { cwd: PROJECT_ROOT, encoding: "utf8" }
  );

  if (tsCheck.status === 0) {
    finalize(byPkg, droppedPackages, warnings);
    return;
  }

  // Parse TS errors per file → identify failing imports → drop those packages
  // and retry once. We don't iterate forever; the second emit either passes
  // or we surface the errors as a report.
  const errors = (tsCheck.stdout ?? "") + "\n" + (tsCheck.stderr ?? "");
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
    ["tsc", "--noEmit", "--pretty", "false"],
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
