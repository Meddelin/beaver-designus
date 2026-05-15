// Zod schema for manifest.config.json. Single source of truth for shape +
// validation; build.ts loads through this and surfaces structured errors.

import { z } from "zod";

export const DesignSystemConfig = z
  .object({
    /** Stable id surfaced in ManifestEntry.sourceSystem. Lowercase, kebab-ish. */
    id: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/, "id must be lowercase kebab"),
    /** Coarse default for entries in this DS. Per-entry overrides land in overrides JSON. */
    categoryHint: z.enum(["atom", "molecule", "organism"]),
    source: z
      .object({
        localPath: z.string().min(1).optional(),
        gitUrl: z.string().url().optional(),
      })
      .refine((s) => Boolean(s.localPath || s.gitUrl), { message: "source.localPath OR source.gitUrl required" }),
    /** Workspace folder containing packages (e.g. "packages"). */
    componentRoot: z.string().min(1),
    /** Package basenames (under componentRoot) to skip during Stage 1.
     *  Supports prefix/suffix wildcards via simple `*`-glob. Defaults to []
     *  (only "design-tokens" is auto-excluded by Stage 4b regardless).
     *  Real DSes typically need this for `analytics`/`hooks`/`core`/internal
     *  packages that share the workspace but aren't UI components. */
    excludePackages: z.array(z.string()).default([]),
    /** Docusaurus MDX roots. One path or a list of paths relative to the DS
     *  root. Each is recursed; every .mdx/.md file becomes a candidate.
     *  Star-glob patterns like "packages/_/docs" are NOT supported — pass
     *  the parent dir instead and let the recursion find the MDX.
     *  For Beaver-style "auto-doc" layouts where MDX is keyed by ancestor
     *  directory rather than frontmatter title (e.g.
     *  auto-doc/docs/patterns/<Category>/<Component>/<section>/file.mdx),
     *  the matcher walks parent dirnames and matches on exportName. */
    docsRoot: z.union([z.string(), z.array(z.string())]).optional(),
    /** Stage 4b runs only when set. Points at design-tokens package root. */
    tokenRoot: z.string().optional(),
    /** Customize the Stage 4b axis-key grammar — must include named groups
     *  `surface` (always) and `theme` (optional). Default matches the v1
     *  upstream's lowercase 2-surface vocabulary; real DSes that ship
     *  e.g. `desktopValue`/`iosValue`/`androidDarkValue` (PascalCase, 3
     *  surfaces) must override this. */
    tokenAxisGrammar: z
      .object({
        pattern: z.string().min(1),
        /** Default value used to pick the "default combo" when emitting CSS.
         *  E.g. "desktop" or "light". If absent, the first observed value of
         *  each axis is taken as default. */
        defaultSurface: z.string().optional(),
        defaultTheme: z.string().optional(),
      })
      .optional(),
    /** Template for the CSS custom property name emitted per token variant.
     *  Placeholders: {namespace}, {binding}, {variant}. Default produces
     *  --animation-curve-expressive-standard. Override to match your DS's
     *  CSS-var convention — e.g. "--tui-{namespace}-{binding}-{variant}"
     *  for a "tui-" prefix, or "--{namespace}{binding}-{variant}" for no
     *  separator between namespace and binding. */
    tokenCssVarPattern: z.string().optional(),
    /** Optional: opt-in convention-map for token reconciliation (priority 3). */
    tokenConventionMap: z
      .object({
        enabled: z.boolean().default(false),
        propNameToGroupPrefix: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    /** Description shown in selector context (helps the agent pick a DS in
     *  forward-looking multi-DS sessions). */
    description: z.string().optional(),
    /** P6 — how this DS's component CSS reaches the preview iframe. Without
     *  this, components render unstyled (e.g. a table collapses to one
     *  column). All paths are relative to the DS root.
     *   - globalStylesheets: CSS the DS expects loaded ONCE by the consumer
     *     (reset/base/layout + CSS-var defs, or an aggregated bundle).
     *     Plain relative paths; the first existing of each is imported into
     *     the preview document, in order, after tokens.css.
     *   - cssStrategy: drives Vite's CSS handling. "auto" → detect from the
     *     DS (\*.css.ts → vanilla-extract, .module.css → modules,
     *     styled-components/@emotion/@linaria dep → that). "modules" is the
     *     safe explicit default for most DSes.
     *   - postcssConfig: path to the DS's own postcss config to reuse so
     *     nesting/custom-media/mixins compile the way the DS build does. */
    styles: z
      .object({
        globalStylesheets: z.array(z.string()).default([]),
        cssStrategy: z
          .enum(["modules", "runtime-css-in-js", "vanilla-extract", "linaria", "auto"])
          .default("auto"),
        postcssConfig: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export const ManifestConfig = z
  .object({
    $comment: z.string().optional(),
    designSystems: z.array(DesignSystemConfig).min(1, "at least one designSystem required"),
    output: z.object({ dir: z.string().min(1) }),
  })
  .strict();

export type DesignSystemConfigT = z.infer<typeof DesignSystemConfig>;
export type ManifestConfigT = z.infer<typeof ManifestConfig>;

/** Parse + throw a structured error string useful in CLI output. */
export function parseConfig(raw: unknown): ManifestConfigT {
  const r = ManifestConfig.safeParse(raw);
  if (r.success) return r.data;
  const issues = r.error.issues
    .map((i) => `  · ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`manifest.config.json is invalid:\n${issues}`);
}
