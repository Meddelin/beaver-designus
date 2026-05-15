// Shared types between daemon, MCP server, and web UI.
// Maps to §3.1 + §4.1 of ARCHITECTURE.md.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

/**
 * Recursive structural description of a prop's type. Where `kind` is the
 * flat legacy classification (kept for back-compat + the MCP enum
 * backstop), `shape` is the precise tree the agent uses to synthesize
 * valid sample data, prop-validator uses to structurally validate, and the
 * Inspector uses to render a real editor. Depth/cycle-bounded at extraction
 * time; unresolved named types degrade to `ref`, anything we can't model to
 * `unknown` (never throws, never omitted for a non-slot prop).
 */
export type PropShape =
  | { t: "string" }
  | { t: "number" }
  | { t: "boolean" }
  | { t: "literal"; value: string | number | boolean }
  | { t: "enum"; options: Array<string | number | boolean> }
  | { t: "array"; element: PropShape }
  | { t: "tuple"; items: PropShape[] }
  | { t: "object"; fields: Array<{ name: string; optional: boolean; shape: PropShape }> }
  | { t: "record"; value: PropShape }
  | { t: "union"; variants: PropShape[] }
  | { t: "function"; arity: number }
  | { t: "react-node" }
  | { t: "ref"; name: string }
  | { t: "unknown"; raw: string };

export interface PropEntry {
  name: string;
  kind:
    | { type: "literal-union"; options: Array<string | number | boolean> }
    | { type: "string" }
    | { type: "number" }
    | { type: "boolean" }
    | { type: "react-node" }
    | { type: "token-reference"; group: string }
    | { type: "unsupported"; raw: string };
  /** Precise recursive shape. Optional only for forward-compat with old
   *  manifests; the current builder always emits it for non-slot props. */
  shape?: PropShape;
  required: boolean;
  description: string;
  defaultValue?: string;
}

export type SlotPolicy =
  | { kind: "none" }
  | { kind: "text-only" }
  | { kind: "components"; allowedComponents?: string[] }
  | { kind: "named-slots"; slots: Record<string, SlotPolicy> };

export interface ExampleSnippet {
  source: string;
  code: string;
}

export interface ManifestEntry {
  id: string;
  sourceSystem: string;
  category: "atom" | "molecule" | "organism";
  name: string;
  packageName: string;
  exportName: string;
  description: string;
  props: PropEntry[];
  slots: SlotPolicy;
  examples: ExampleSnippet[];
  tags: string[];
}

export interface PrototypeNode {
  nodeId: string;
  component: string;
  props: Record<string, JsonValue>;
  children?: PrototypeNode[];
  slots?: Record<string, PrototypeNode[]>;
}

export interface Prototype {
  revision: number;
  root: PrototypeNode | null;
}

// SSE event union — superset of §4.3 + chat status events.
export type SseEvent =
  | { type: "status"; phase: "start" | "agent-text" | "agent-thinking" | "tool-call" | "end"; data?: any }
  | { type: "error"; phase?: "agent" | "tool" | "transport"; message: string; data?: any }
  | { type: "chat:message"; role: "assistant" | "system"; content: string }
  | { type: "prototype:set-root"; revision: number; root: PrototypeNode | null }
  | { type: "prototype:patch"; revision: number; patch: TreePatch[] };

export type TreePatch =
  | { op: "set-root"; node: PrototypeNode | null }
  | { op: "add"; parentId: string | null; slot?: string; beforeNodeId?: string; node: PrototypeNode }
  | { op: "set-prop"; nodeId: string; propName: string; propValue: JsonValue }
  | { op: "remove"; nodeId: string };

export interface PlaceComponentInput {
  parentNodeId: string | null;
  slot?: string;
  beforeNodeId?: string;
  component: string;
  props?: Record<string, JsonValue>;
  children?: PlaceComponentInput[];
}
