// Loads ./manifest-data into memory at startup.
// Exposes the entry list + lookups + JSON-schema builders for the MCP server.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ManifestEntry } from "../shared/types.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
export const MANIFEST_ROOT = join(__dirname, "..", "manifest-data");

let entries: ManifestEntry[] | null = null;
let byId: Map<string, ManifestEntry> | null = null;
let tokens: any = null;

export function loadManifest(): { entries: ManifestEntry[]; byId: Map<string, ManifestEntry>; tokens: any } {
  if (entries && byId && tokens) return { entries, byId, tokens };

  const collected: ManifestEntry[] = [];
  for (const subdir of readdirSync(MANIFEST_ROOT)) {
    const subPath = join(MANIFEST_ROOT, subdir);
    if (!statSync(subPath).isDirectory()) continue;
    for (const file of readdirSync(subPath)) {
      if (!file.endsWith(".json")) continue;
      const raw = readFileSync(join(subPath, file), "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) collected.push(...parsed);
    }
  }

  entries = collected;
  byId = new Map(collected.map((e) => [e.id, e]));
  tokens = JSON.parse(readFileSync(join(MANIFEST_ROOT, "tokens.json"), "utf8"));
  return { entries, byId, tokens };
}

/**
 * Build the MCP placeComponent.inputSchema. The `component` field gets an
 * `enum` of valid manifest ids — this is the §4.2 structural constraint:
 * an off-DS component id is rejected by the SDK before it reaches our handler.
 */
export function buildPlaceComponentSchema(): object {
  const { entries } = loadManifest();
  return {
    type: "object",
    required: ["parentNodeId", "component"],
    properties: {
      parentNodeId: {
        type: ["string", "null"],
        description: "nodeId of the parent. Pass null to create the root (only valid if the prototype root is currently null).",
      },
      slot: {
        type: "string",
        description: "Named slot on the parent (only when the parent declares named-slots).",
      },
      beforeNodeId: {
        type: "string",
        description: "Insert before this sibling nodeId; otherwise append.",
      },
      component: {
        type: "string",
        enum: entries.map((e) => e.id),
        description: "Manifest id of the component to place. Must come from the manifest — no free-form values.",
      },
      props: {
        type: "object",
        description: "Prop values for the component. Must satisfy the manifest entry's PropEntry shapes.",
        additionalProperties: true,
      },
    },
    additionalProperties: false,
  };
}

export function buildSetPropSchema(): object {
  return {
    type: "object",
    required: ["nodeId", "propName", "propValue"],
    properties: {
      nodeId: { type: "string", description: "Target node id." },
      propName: { type: "string", description: "Name of the prop to update; must exist on the manifest entry." },
      propValue: { description: "New value (must match the prop's kind)." },
    },
    additionalProperties: false,
  };
}

export function buildRemoveNodeSchema(): object {
  return {
    type: "object",
    required: ["nodeId"],
    properties: {
      nodeId: { type: "string", description: "Node id to remove." },
    },
    additionalProperties: false,
  };
}

export function buildFinishPrototypeSchema(): object {
  return {
    type: "object",
    required: ["summary"],
    properties: {
      summary: { type: "string", description: "Short rationale shown as the assistant's wrap-up turn." },
    },
    additionalProperties: false,
  };
}

export function buildGetComponentSchema(): object {
  const { entries } = loadManifest();
  return {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", enum: entries.map((e) => e.id) },
    },
    additionalProperties: false,
  };
}

/** Example-first entry point: same id enum as getComponent. */
export function buildGetComponentUsageSchema(): object {
  const { entries } = loadManifest();
  return {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", enum: entries.map((e) => e.id) },
    },
    additionalProperties: false,
  };
}

/** Drop a whole canonical subtree (a PrototypeSeed — typically the `tree`
 *  from getComponentUsage, optionally tweaked) under a parent in one call. */
export function buildInsertSubtreeSchema(): object {
  return {
    type: "object",
    required: ["parentNodeId", "tree"],
    properties: {
      parentNodeId: {
        type: ["string", "null"],
        description: "nodeId of the parent. Pass null to set the prototype root (only valid if root is currently null).",
      },
      slot: { type: "string", description: "Named slot on the parent (only when the parent declares named-slots)." },
      beforeNodeId: { type: "string", description: "Insert before this sibling nodeId; otherwise append." },
      tree: {
        type: "object",
        description:
          "A PrototypeSeed: { component: <manifest id>, props: {…}, children?: PrototypeSeed[], slots?: { <name>: PrototypeSeed[] } }. " +
          "Every `component` must be a manifest id. Start from getComponentUsage(id).tree and adapt its props.",
        additionalProperties: true,
      },
    },
    additionalProperties: false,
  };
}

/**
 * Compact summary the composer prompt embeds. One row per entry; <1 line each
 * so we stay inside the context budget.
 */
export function manifestSummaryForPrompt(): string {
  const { entries } = loadManifest();
  return entries
    .map((e) => {
      const req = e.props.filter((p) => p.required).map((p) => p.name);
      const reqStr = req.length ? ` req:[${req.join(",")}]` : "";
      // ✓usage = a canonical example exists — fetch it before composing.
      const usageMark = e.usage ? " ✓usage" : "";
      return `- ${e.id}  [${e.category}/${e.sourceSystem}]${reqStr}${usageMark}  — ${e.description}`;
    })
    .join("\n");
}
