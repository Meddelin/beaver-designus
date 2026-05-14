// Stage orchestrator. Reads manifest.config.json, runs each stage per DS,
// writes manifest-data/.
//
// Pipeline per §3.2:
//   Stage 1  — discoverPackages + discoverSymbols
//   Stage 2  — extractComponent (props)
//   Stage 3  — parseMdx (docs/<Component>.mdx)
//   Stage 4  — inferSlotPolicy
//   Stage 4b — extractTokens (only on DSes with tokenRoot)
//   Stage 5  — write manifest-data/

import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPackages, discoverSymbols } from "./scan/discovery.ts";
import { extractComponent, inferSlotPolicy } from "./props/extract.ts";
import { parseMdx, findAllMdx } from "./docs/mdx.ts";
import { parseStorybook, findAllStories } from "./docs/storybook.ts";
import { extractTokens } from "./tokens/extract.ts";
import { loadOverrides, applyOverride, type OverrideMap } from "./overrides.ts";
import { parseConfig, type ManifestConfigT } from "./config-schema.ts";
import type { ManifestEntry, PropEntry } from "./types.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");

type Config = ManifestConfigT;

export async function build(): Promise<void> {
  const rawCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, "manifest.config.json"), "utf8"));
  let cfg: Config;
  try {
    cfg = parseConfig(rawCfg);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(2);
  }
  const outDir = resolve(PROJECT_ROOT, cfg.output.dir);
  const overridesDir = resolve(PROJECT_ROOT, "manifest-overrides");
  // Reset output (overrides live in a separate dir so we can wipe freely).
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const allEntries: ManifestEntry[] = [];
  let tokensWritten = false;
  const perDsCounts: Record<string, number> = {};

  for (const ds of cfg.designSystems) {
    const dsRoot = ds.source.localPath ? resolve(PROJECT_ROOT, ds.source.localPath) : null;
    if (!dsRoot) {
      console.warn(`[manifest] skipping ${ds.id} — no localPath (git clone not implemented in M1).`);
      continue;
    }

    // Per-DS subtree.
    const dsOutDir = join(outDir, ds.id);
    mkdirSync(dsOutDir, { recursive: true });

    // Stage 1
    const packages = discoverPackages(dsRoot, ds.componentRoot);
    console.log(`[manifest] [${ds.id}] discovered ${packages.length} packages`);

    // Load overrides for this DS once (per-entry merges by manifest id).
    const dsOverridesDir = join(overridesDir, ds.id);
    const overrides: OverrideMap = loadOverrides(dsOverridesDir);
    if (Object.keys(overrides).length) {
      console.log(`[manifest] [${ds.id}] loaded ${Object.keys(overrides).length} overrides`);
    }

    // Stage 4b — once per DS (only if tokenRoot is set).
    let tokenGroupPaths: Set<string> = new Set();
    if (ds.tokenRoot) {
      const tokenRoot = resolve(dsRoot, ds.tokenRoot);
      const tokensResult = extractTokens(tokenRoot);
      tokenGroupPaths = new Set(Object.keys(tokensResult.manifest.groups));

      // tokens.json — overwrite per DS that has one (last DS wins; in practice
      // only react-ui-kit defines tokens).
      writeFileSync(join(outDir, "tokens.json"), JSON.stringify(tokensResult.manifest, null, 2));
      for (const [comboId, css] of Object.entries(tokensResult.cssByCombo)) {
        const fname = comboId === tokensResult.manifest.defaultComboId ? "tokens.css" : `tokens.${comboId}.css`;
        writeFileSync(join(outDir, fname), css);
      }
      tokensWritten = true;
      console.log(`[manifest] [${ds.id}] extracted ${Object.keys(tokensResult.manifest.groups).length} token groups`);
    }

    // Stage 2-4 per package
    const perDsEntries: ManifestEntry[] = [];
    for (const pkg of packages) {
      if (pkg.name.includes("design-tokens")) continue; // tokens-only package, handled by 4b
      const symbols = discoverSymbols(pkg);
      for (const sym of symbols) {
        const extracted = extractComponent(sym.declarationFile, sym.exportName);
        if (!extracted) continue;

        const slots = inferSlotPolicy(sym.declarationFile, sym.exportName, extracted.childrenShape);

        // Stage 3 — source priority: MDX → Storybook CSF → JSDoc.
        const docsDir = join(pkg.root, "docs");
        const mdxMatch = matchMdxForExport(docsDir, sym.exportName);
        const sbMatch = mdxMatch ? null : matchStorybookForExport(pkg.root, sym.exportName);

        let description: string | null | undefined = mdxMatch?.description ?? sbMatch?.description ?? extracted.description;
        let tags = mdxMatch?.tags ?? sbMatch?.tags ?? [];
        const examples = (mdxMatch?.examples as Array<{ source: string; code: string }> | undefined)
          ?? sbMatch?.examples
          ?? [];

        // Reconcile token-reference (§3.2 stage 4b step 6):
        //   priority 1 — TS type inspection (extractor already set kind)
        //   priority 2 — overrides (applied below via applyOverride)
        //   priority 3 — convention map (opt-in via config)
        const conventionMap = ds.tokenConventionMap?.enabled
          ? (ds.tokenConventionMap.propNameToGroupPrefix ?? {})
          : null;
        const props: PropEntry[] = extracted.props.map((p) => {
          if (p.kind.type === "token-reference") return p;
          if (conventionMap) {
            const groupPath = (conventionMap as Record<string, string>)[p.name];
            if (groupPath && tokenGroupPaths.has(groupPath)) {
              return { ...p, kind: { type: "token-reference", group: groupPath } };
            }
          }
          return p;
        });

        const id = `${ds.id}:${pkg.name}/${sym.exportName}`;
        const baseEntry: ManifestEntry = {
          id,
          sourceSystem: ds.id,
          category: ds.categoryHint,
          name: sym.exportName,
          packageName: pkg.name,
          exportName: sym.exportName,
          description: description ?? "",
          props,
          slots,
          examples,
          tags,
        };
        const entry = applyOverride(baseEntry, overrides);
        perDsEntries.push(entry);
      }
    }

    // Stage 5 — write per-package JSON files within the DS subtree.
    const byPackage: Record<string, ManifestEntry[]> = {};
    for (const e of perDsEntries) {
      const slug = e.packageName.replace("/", "-").replace("@", "");
      byPackage[slug] ??= [];
      byPackage[slug].push(e);
    }
    for (const [slug, entries] of Object.entries(byPackage)) {
      writeFileSync(join(dsOutDir, `${slug}.json`), JSON.stringify(entries, null, 2));
    }

    perDsCounts[ds.id] = perDsEntries.length;
    allEntries.push(...perDsEntries);
  }

  // index.json
  writeFileSync(join(outDir, "index.json"), JSON.stringify({
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    counts: perDsCounts,
    entries: allEntries,
  }, null, 2));

  console.log(`[manifest] wrote ${allEntries.length} entries to ${outDir}`);
  for (const [id, n] of Object.entries(perDsCounts)) console.log(`[manifest]   ${id}: ${n}`);
  if (!tokensWritten) console.warn("[manifest] no DS defined tokenRoot; tokens.json not written");
}

function matchMdxForExport(docsDir: string, exportName: string): ReturnType<typeof parseMdx> | null {
  const files = findAllMdx(docsDir);
  for (const f of files) {
    const parsed = parseMdx(f);
    if (parsed.title === exportName) return parsed;
    if (basename(f).startsWith(exportName + ".")) return parsed;
  }
  return null;
}

function matchStorybookForExport(pkgRoot: string, exportName: string): ReturnType<typeof parseStorybook> | null {
  const files = findAllStories(pkgRoot);
  for (const f of files) {
    const parsed = parseStorybook(f, exportName);
    if (parsed) return parsed;
  }
  return null;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("build.ts")) {
  build().catch((err) => {
    console.error("[manifest] build failed:", err);
    process.exit(1);
  });
}
