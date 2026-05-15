import type { Express, Request, Response } from "express";
import {
  createProject,
  listProjects,
  getProject,
  renameProject,
  deleteProject,
  loadPrototype,
  savePrototype,
  recordToolCall,
  appendMessage,
  findNode,
  removeNode as removeNodeFromTree,
  setProp as setPropOnTree,
  exportProject,
  importProject,
  listMessages,
  listToolCalls,
} from "./projects-store.ts";
import { currentManifestRev } from "./manifest-rev.ts";
import { createSession, getSession, broadcast, killProcessTree } from "./sessions.ts";
import { setupSse } from "./sse.ts";
import { loadManifest } from "./manifest-server.ts";
import { runTurn } from "./agent-loop.ts";
import { ulid } from "ulid";
import type { JsonValue, PrototypeNode, PrototypeSeed } from "../shared/types.ts";
import { log } from "./log.ts";
import { validateProps, checkKind } from "./prop-validator.ts";

export function registerRoutes(app: Express): void {
  // -------- Manifest ----------
  app.get("/api/manifest", (_req, res) => {
    const { entries, tokens } = loadManifest();
    res.json({ entries, tokens });
  });

  // Manifest entry ids contain "/" — accept the rest of the URL as the id.
  app.get(/^\/api\/manifest\/(.+)$/, (req, res) => {
    const id = decodeURIComponent((req.params as any)[0]);
    const { byId } = loadManifest();
    const entry = byId.get(id);
    if (!entry) return res.status(404).json({ error: "not found", id });
    res.json(entry);
  });

  // -------- Projects ----------
  app.get("/api/projects", (_req, res) => {
    res.json({ projects: listProjects() });
  });

  app.post("/api/projects", (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title : undefined;
    res.json({ project: createProject(title) });
  });

  app.get("/api/projects/:id", (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "not found" });
    const proto = loadPrototype(project.id);
    const messages = listMessages(project.id, 200);
    const toolCalls = listToolCalls(project.id, 500).map((t) => ({
      id: t.id,
      tool_name: t.tool_name,
      input: safeJson(t.input_json),
      output: safeJson(t.output_json),
      revision_after: t.revision_after,
      created_at: t.created_at,
    }));
    const currentRev = currentManifestRev();
    const drift = project.manifest_rev && project.manifest_rev !== currentRev
      ? { authoredAt: project.manifest_rev, currentAt: currentRev }
      : null;
    res.json({ project, prototype: proto, messages, toolCalls, drift });
  });

  app.patch("/api/projects/:id", (req, res) => {
    const title = req.body?.title;
    if (typeof title !== "string") return res.status(400).json({ error: "title required" });
    const project = renameProject(req.params.id, title);
    if (!project) return res.status(404).json({ error: "not found" });
    res.json({ project });
  });

  app.delete("/api/projects/:id", (req, res) => {
    const ok = deleteProject(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  });

  app.get("/api/projects/:id/export.json", (req, res) => {
    const snap = exportProject(req.params.id);
    if (!snap) return res.status(404).json({ error: "not found" });
    res.json(snap);
  });

  app.post("/api/projects/import", (req, res) => {
    const snapshot = req.body?.snapshot;
    if (!snapshot?.project?.title || !snapshot?.prototype) {
      return res.status(400).json({ error: "snapshot.project.title and snapshot.prototype required" });
    }
    const project = importProject(snapshot);
    res.json({ project });
  });

  app.get("/api/manifest-rev", (_req, res) => {
    res.json({ rev: currentManifestRev() });
  });

  // -------- Sessions / chat ----------
  app.post("/api/sessions", (req, res) => {
    let projectId: string = req.body?.projectId;
    if (!projectId) {
      const p = createProject();
      projectId = p.id;
    } else if (!getProject(projectId)) {
      return res.status(404).json({ error: "project not found" });
    }
    const session = createSession(projectId);
    res.json({ sessionId: session.id, projectId });
  });

  app.get("/api/sessions/:id/events", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session not found" });
    const send = setupSse(res);
    session.subscribers.add(send);
    // Emit current tree on connect so the UI hydrates.
    const proto = loadPrototype(session.projectId);
    send({ type: "prototype:set-root", revision: proto.revision, root: proto.root });
    req.on("close", () => session.subscribers.delete(send));
  });

  app.post("/api/sessions/:id/message", async (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session not found" });
    const content = req.body?.content;
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content required" });
    }
    res.status(202).json({ ok: true });
    runTurn({ session, userMessage: content }).catch((err) => {
      log.error({ sessionId: session.id, err }, "runTurn rejected");
      broadcast(session.id, { type: "error", phase: "agent", message: String(err?.message ?? err) });
    });
  });

  app.post("/api/sessions/:id/cancel", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session not found" });
    try {
      session.abort?.abort();
    } catch (err) {
      log.warn({ sessionId: session.id, err }, "abort threw");
    }
    if (session.childPid) {
      // Belt-and-suspenders: kill the whole process tree. AbortController's
      // TerminateProcess on Windows hits only the direct child, leaving
      // claude.exe's MCP subprocess orphaned.
      killProcessTree(session.childPid);
      session.childPid = null;
    }
    res.json({ ok: true });
  });

  // User-initiated tool call (inspector edits, future drag-drop). Same code
  // path as the MCP server uses internally, plus an audit-trail entry tagged
  // with the user as the driver.
  app.post("/api/sessions/:id/apply", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session not found" });
    const { toolName, input } = req.body ?? {};
    if (typeof toolName !== "string") {
      return res.status(400).json({ error: "toolName required" });
    }
    const project = getProject(session.projectId);
    if (!project) return res.status(404).json({ error: "project not found" });

    const proto = loadPrototype(session.projectId);
    const result = applyToolCall(proto, toolName, input);
    if (!result.ok) return res.status(400).json({ error: result.error });

    proto.revision += 1;
    savePrototype(session.projectId, proto);
    recordToolCall({
      projectId: session.projectId,
      toolName,
      input: { ...input, _driver: "user" },
      output: result.output,
      revisionAfter: proto.revision,
    });

    broadcast(session.id, { type: "prototype:set-root", revision: proto.revision, root: proto.root });
    res.json(result.output);
  });

  // -------- Internal tool-call relay -----
  // The stdio MCP server in a subprocess can't share in-memory state with the
  // daemon. It POSTs the validated tool call here; we mutate the tree, persist,
  // and broadcast. The MCP server then returns the daemon's JSON to the CLI.
  app.post("/internal/tool-call", (req, res) => {
    const { sessionId, projectId, toolName, input } = req.body ?? {};
    if (typeof sessionId !== "string" || typeof projectId !== "string" || typeof toolName !== "string") {
      return res.status(400).json({ error: "sessionId/projectId/toolName required" });
    }
    const project = getProject(projectId);
    if (!project) return res.status(404).json({ error: "project not found" });

    const proto = loadPrototype(projectId);
    const result = applyToolCall(proto, toolName, input);
    if (!result.ok) return res.status(400).json({ error: result.error });

    proto.revision += 1;
    savePrototype(projectId, proto);
    recordToolCall({
      projectId,
      toolName,
      input,
      output: result.output,
      revisionAfter: proto.revision,
    });

    broadcast(sessionId, { type: "prototype:set-root", revision: proto.revision, root: proto.root });

    res.json(result.output);
  });
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

type ApplyResult = { ok: true; output: any } | { ok: false; error: string };

function applyToolCall(
  proto: { revision: number; root: PrototypeNode | null },
  toolName: string,
  input: any
): ApplyResult {
  const { byId } = loadManifest();

  if (toolName === "placeComponent") {
    const r = placeNode(proto, byId, input.component, (input.props ?? {}) as Record<string, JsonValue>, input.parentNodeId ?? null, input.slot);
    if (!r.ok) return r;
    return { ok: true, output: { nodeId: r.nodeId, revision: proto.revision + 1 } };
  }

  if (toolName === "getComponentUsage") {
    const entry = byId.get(input.id);
    if (!entry) return { ok: false, error: `unknown id: ${input.id}` };
    return {
      ok: true,
      output: {
        id: entry.id,
        description: entry.description,
        slots: entry.slots,
        usage: entry.usage ?? null,
        requiredProps: entry.props
          .filter((p) => p.required)
          .map((p) => ({ name: p.name, shape: p.shape ?? null, description: p.description })),
        optionalProps: entry.props.filter((p) => !p.required).map((p) => p.name),
      },
    };
  }

  if (toolName === "insertSubtree") {
    const tree = input.tree as PrototypeSeed | undefined;
    if (!tree || typeof tree.component !== "string") {
      return { ok: false, error: "insertSubtree: `tree.component` (a manifest id) is required" };
    }
    const r = insertSeed(proto, byId, tree, input.parentNodeId ?? null, input.slot);
    if (!r.ok) return r;
    return { ok: true, output: { rootNodeId: r.nodeId, revision: proto.revision + 1 } };
  }

  if (toolName === "setProp") {
    const { nodeId, propName, propValue } = input;
    const node = findNode(proto.root, nodeId);
    if (!node) return { ok: false, error: `node not found: ${nodeId}` };
    const entry = byId.get(node.component);
    if (!entry) return { ok: false, error: `manifest entry missing for ${node.component}` };
    const prop = entry.props.find((p) => p.name === propName);
    if (!prop) return { ok: false, error: `prop ${propName} not on ${node.component}` };
    const r = checkKind(prop, propValue as JsonValue, loadManifest().tokens);
    if (!r.ok) return { ok: false, error: `setProp ${propName}: ${r.error}` };
    if (!setPropOnTree(proto.root, nodeId, propName, propValue as JsonValue)) {
      return { ok: false, error: "failed to set prop" };
    }
    return { ok: true, output: { ok: true, revision: proto.revision + 1 } };
  }

  if (toolName === "removeNode") {
    const { nodeId } = input;
    const { root, removed } = removeNodeFromTree(proto.root, nodeId);
    if (!removed) return { ok: false, error: `node not found: ${nodeId}` };
    proto.root = root;
    return { ok: true, output: { ok: true, revision: proto.revision + 1 } };
  }

  if (toolName === "finishPrototype") {
    return { ok: true, output: { ok: true, summary: input.summary } };
  }

  if (toolName === "getComponent") {
    const entry = byId.get(input.id);
    if (!entry) return { ok: false, error: `unknown id: ${input.id}` };
    return { ok: true, output: entry };
  }

  return { ok: false, error: `unknown tool: ${toolName}` };
}

type ManifestById = ReturnType<typeof loadManifest>["byId"];

/* Single placement primitive — shared by placeComponent and (recursively)
 * insertSeed. Validates props against the manifest entry, assigns a nodeId,
 * and attaches to the parent honouring its slot policy. */
function placeNode(
  proto: { revision: number; root: PrototypeNode | null },
  byId: ManifestById,
  componentId: string,
  propsIn: Record<string, JsonValue>,
  parentNodeId: string | null,
  slot: string | undefined
): { ok: true; nodeId: string } | { ok: false; error: string } {
  const entry = byId.get(componentId);
  if (!entry) return { ok: false, error: `unknown component: ${componentId}` };

  const validated = validateProps(entry, propsIn, loadManifest().tokens);
  if (!validated.ok) return { ok: false, error: validated.error };
  if (validated.rejected.length) {
    log.warn({ component: componentId, rejected: validated.rejected }, "placeNode: rejected props (kept node)");
  }

  const node: PrototypeNode = { nodeId: ulid(), component: componentId, props: validated.props };

  if (parentNodeId === null) {
    if (proto.root !== null) return { ok: false, error: "root already exists; pass an existing parentNodeId" };
    proto.root = node;
    return { ok: true, nodeId: node.nodeId };
  }

  const parent = findNode(proto.root, parentNodeId);
  if (!parent) return { ok: false, error: `parent not found: ${parentNodeId}` };
  const parentEntry = byId.get(parent.component);
  if (!parentEntry) return { ok: false, error: `manifest entry missing for parent: ${parent.component}` };

  if (parentEntry.slots.kind === "named-slots") {
    if (!slot || !parentEntry.slots.slots[slot]) {
      return { ok: false, error: `parent ${parent.component} requires a named slot; valid: ${Object.keys(parentEntry.slots.slots).join(",")}` };
    }
    parent.slots ??= {};
    parent.slots[slot] ??= [];
    parent.slots[slot].push(node);
  } else if (parentEntry.slots.kind === "components") {
    if (parentEntry.slots.allowedComponents && !parentEntry.slots.allowedComponents.includes(componentId)) {
      return { ok: false, error: `parent ${parent.component} does not accept ${componentId} as a child` };
    }
    parent.children ??= [];
    parent.children.push(node);
  } else {
    return { ok: false, error: `parent ${parent.component} cannot host children (slots.kind=${parentEntry.slots.kind})` };
  }
  return { ok: true, nodeId: node.nodeId };
}

/* Recursively instantiate a PrototypeSeed. Fails fast on the first invalid
 * node so a half-tree never silently lands. */
function insertSeed(
  proto: { revision: number; root: PrototypeNode | null },
  byId: ManifestById,
  seed: PrototypeSeed,
  parentNodeId: string | null,
  slot: string | undefined
): { ok: true; nodeId: string } | { ok: false; error: string } {
  if (!seed || typeof seed.component !== "string") {
    return { ok: false, error: "seed node missing `component` (manifest id)" };
  }
  const placed = placeNode(proto, byId, seed.component, seed.props ?? {}, parentNodeId, slot);
  if (!placed.ok) return placed;
  for (const child of seed.children ?? []) {
    const r = insertSeed(proto, byId, child, placed.nodeId, undefined);
    if (!r.ok) return r;
  }
  for (const [slotName, slotSeeds] of Object.entries(seed.slots ?? {})) {
    for (const ss of slotSeeds) {
      const r = insertSeed(proto, byId, ss, placed.nodeId, slotName);
      if (!r.ok) return r;
    }
  }
  return { ok: true, nodeId: placed.nodeId };
}

