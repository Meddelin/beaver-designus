// Shared types between daemon, MCP server, and web UI.
// Maps to §3.1 + §4.1 of ARCHITECTURE.md.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

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
