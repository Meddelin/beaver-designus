// Stdio JSON-RPC MCP server, spawned by Claude Code CLI per turn.
// Exposes the §4.2 tool surface; each tool POSTs to the daemon's
// /internal/tool-call endpoint which owns the prototype state.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  buildPlaceComponentSchema,
  buildSetPropSchema,
  buildRemoveNodeSchema,
  buildFinishPrototypeSchema,
  buildGetComponentSchema,
  buildGetComponentUsageSchema,
  buildInsertSubtreeSchema,
} from "./manifest-server.ts";

const DAEMON_URL = process.env.BEAVER_DESIGNUS_DAEMON_URL ?? "http://127.0.0.1:7457";
const SESSION_ID = process.env.BEAVER_DESIGNUS_SESSION_ID;
const PROJECT_ID = process.env.BEAVER_DESIGNUS_PROJECT_ID;

if (!SESSION_ID || !PROJECT_ID) {
  console.error("BEAVER_DESIGNUS_SESSION_ID and BEAVER_DESIGNUS_PROJECT_ID env vars are required");
  process.exit(2);
}

async function callDaemon(toolName: string, input: unknown): Promise<any> {
  const res = await fetch(`${DAEMON_URL}/internal/tool-call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: SESSION_ID, projectId: PROJECT_ID, toolName, input }),
  });
  const body = await res.json().catch(() => ({ error: "non-json response" }));
  if (!res.ok) throw new Error(body.error ?? `daemon returned ${res.status}`);
  return body;
}

const server = new Server(
  {
    name: "beaver-designus",
    version: "0.1.0",
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "placeComponent",
        description: "Place a design-system component into the prototype tree. The `component` argument is constrained by enum to manifest ids — off-DS values are structurally impossible. Pass parentNodeId=null to create the root; otherwise pass the nodeId of an existing parent (and `slot` if the parent declares named slots).",
        inputSchema: buildPlaceComponentSchema(),
      },
      {
        name: "setProp",
        description: "Update one prop on an existing node. Prop must be declared on the manifest entry.",
        inputSchema: buildSetPropSchema(),
      },
      {
        name: "removeNode",
        description: "Remove a node and its subtree.",
        inputSchema: buildRemoveNodeSchema(),
      },
      {
        name: "finishPrototype",
        description: "End the composer turn. Pass a one-sentence summary that will be shown to the user.",
        inputSchema: buildFinishPrototypeSchema(),
      },
      {
        name: "getComponent",
        description: "Fetch the full manifest entry for one component id (props with recursive `shape`, slot policy, description). Use when you need exact prop shapes.",
        inputSchema: buildGetComponentSchema(),
      },
      {
        name: "getComponentUsage",
        description:
          "EXAMPLE-FIRST: for any component with required props or a ✓usage marker, call this FIRST. Returns a canonical, ready-to-use PrototypeSeed `tree` (derived from the design system's own Storybook/MDX, with realistic prop values) plus the required-prop shapes. Then call insertSubtree with that tree (adapt the props to the user's intent) instead of guessing placeComponent props.",
        inputSchema: buildGetComponentUsageSchema(),
      },
      {
        name: "insertSubtree",
        description:
          "Instantiate a whole PrototypeSeed (typically getComponentUsage(id).tree, optionally tweaked) under a parent in ONE call — nodeIds are assigned and every node's props are validated. Use this for complex/data-driven components instead of placeComponent + many setProp calls.",
        inputSchema: buildInsertSubtreeSchema(),
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const input = req.params.arguments ?? {};
  try {
    const output = await callDaemon(name, input);
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
    };
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: "text", text: `tool call failed: ${err?.message ?? String(err)}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
