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
    /** Docusaurus MDX root. Glob; "*" matches package names. */
    docsRoot: z.string().optional(),
    /** Stage 4b runs only when set. Points at design-tokens package root. */
    tokenRoot: z.string().optional(),
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
