// Pure helpers for classifying the `tsc` output that `preview:wire` runs
// over the generated component-map.ts. Extracted into their own module so
// they're unit-testable without importing generate-component-map.ts (which
// runs the generator on import).

/* Belt-and-suspenders for the css-modules.d.ts shim: drop any TS2307
 * "Cannot find module './x.module.css'" lines before error classification,
 * so a DS that imports a style flavour the shim doesn't cover (or a stale
 * tsconfig) can never knock a component out of the map over a CSS import.
 * Real JS/TS resolution TS2307s are untouched. */
export function stripStyleModuleErrors(text: string): string {
  const styleMod = /error TS2307: Cannot find module '[^']*\.(?:module\.)?(?:css|scss|sass|less)'/;
  return text
    .split(/\r?\n/)
    .filter((l) => !styleMod.test(l))
    .join("\n");
}

/* Given tsc output + the generated source lines, map each
 * component-map.ts TS2352 ("Conversion of type 'X' to ComponentType<any>
 * may be a mistake") back to the canonical entry id on that line. Those
 * exports are NOT React components (data/type descriptors discovery
 * mis-picked). Returns id → offending-type-name. */
export function extractTs2352Ids(tscText: string, srcLines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const re = /component-map\.ts\((\d+),\d+\): error TS2352:[^']*'([^']+)'/;
  for (const line of tscText.split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const srcLine = srcLines[Number(m[1]) - 1] ?? "";
    // Map line shape: `  "canonical:id": Alias as React.ComponentType<any>,`
    const idMatch = /^\s*("(?:[^"\\]|\\.)*")\s*:/.exec(srcLine);
    if (!idMatch) continue;
    try {
      out.set(JSON.parse(idMatch[1]) as string, m[2]);
    } catch {
      /* not a map line — ignore */
    }
  }
  return out;
}
