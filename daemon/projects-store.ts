// CRUD for projects + prototype state per §6.4. Used by REST routes and the
// MCP tool handlers (which write tool_calls + prototype_snapshots in-place).

import { ulid } from "ulid";
import { db } from "./db.ts";
import { currentManifestRev } from "./manifest-rev.ts";
import type { Prototype, PrototypeNode, JsonValue } from "../shared/types.ts";

export interface ProjectSummary {
  id: string;
  title: string;
  design_system: string;
  manifest_rev: string | null;
  created_at: number;
  updated_at: number;
}

export function createProject(title?: string): ProjectSummary {
  const id = ulid();
  const now = Date.now();
  const finalTitle = title ?? `Untitled ${new Date(now).toISOString().slice(0, 10)}`;
  const rev = currentManifestRev();
  db.prepare(
    "INSERT INTO projects (id, title, design_system, manifest_rev, created_at, updated_at) VALUES (?, ?, 'beaver', ?, ?, ?)"
  ).run(id, finalTitle, rev, now, now);
  db.prepare(
    "INSERT INTO prototype_snapshots (project_id, revision, tree_json, updated_at) VALUES (?, 0, ?, ?)"
  ).run(id, JSON.stringify({ revision: 0, root: null }), now);
  return { id, title: finalTitle, design_system: "beaver", manifest_rev: rev, created_at: now, updated_at: now };
}

export function importProject(snapshot: {
  project: { title: string; design_system?: string; manifest_rev?: string };
  prototype: Prototype;
  messages?: Array<{ role: "user" | "assistant" | "system-status"; content: string }>;
}): ProjectSummary {
  const id = ulid();
  const now = Date.now();
  const designSystem = snapshot.project.design_system ?? "beaver";
  const manifestRev = snapshot.project.manifest_rev ?? null;
  db.prepare(
    "INSERT INTO projects (id, title, design_system, manifest_rev, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, snapshot.project.title, designSystem, manifestRev, now, now);
  db.prepare(
    "INSERT INTO prototype_snapshots (project_id, revision, tree_json, updated_at) VALUES (?, ?, ?, ?)"
  ).run(id, snapshot.prototype.revision ?? 0, JSON.stringify(snapshot.prototype), now);
  for (const m of snapshot.messages ?? []) {
    appendMessage(id, m.role, m.content);
  }
  return getProject(id)!;
}

export function exportProject(id: string): {
  project: ProjectSummary;
  prototype: Prototype;
  messages: Array<{ id: string; role: string; content: string; created_at: number }>;
} | null {
  const project = getProject(id);
  if (!project) return null;
  const prototype = loadPrototype(id);
  const messages = db
    .prepare("SELECT id, role, content, created_at FROM messages WHERE project_id = ? ORDER BY created_at ASC")
    .all(id) as Array<{ id: string; role: string; content: string; created_at: number }>;
  return { project, prototype, messages };
}

export function listProjects(): ProjectSummary[] {
  return db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectSummary[];
}

export function getProject(id: string): ProjectSummary | null {
  return (db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectSummary | undefined) ?? null;
}

export function renameProject(id: string, title: string): ProjectSummary | null {
  const now = Date.now();
  const r = db.prepare("UPDATE projects SET title = ?, updated_at = ? WHERE id = ?").run(title, now, id);
  if (r.changes === 0) return null;
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  return db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
}

export function loadPrototype(projectId: string): Prototype {
  const row = db
    .prepare("SELECT revision, tree_json FROM prototype_snapshots WHERE project_id = ?")
    .get(projectId) as { revision: number; tree_json: string } | undefined;
  if (!row) return { revision: 0, root: null };
  return { revision: row.revision, root: JSON.parse(row.tree_json).root };
}

export function savePrototype(projectId: string, proto: Prototype): void {
  const now = Date.now();
  db.prepare(
    "UPDATE prototype_snapshots SET revision = ?, tree_json = ?, updated_at = ? WHERE project_id = ?"
  ).run(proto.revision, JSON.stringify(proto), now, projectId);
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
}

export function listMessages(projectId: string, limit = 200): Array<{ id: string; role: string; content: string; created_at: number }> {
  return db
    .prepare("SELECT id, role, content, created_at FROM messages WHERE project_id = ? ORDER BY created_at ASC LIMIT ?")
    .all(projectId, limit) as Array<{ id: string; role: string; content: string; created_at: number }>;
}

export function listToolCalls(projectId: string, limit = 500): Array<{ id: string; tool_name: string; input_json: string; output_json: string; revision_after: number; created_at: number }> {
  return db
    .prepare("SELECT id, tool_name, input_json, output_json, revision_after, created_at FROM tool_calls WHERE project_id = ? ORDER BY created_at ASC LIMIT ?")
    .all(projectId, limit) as Array<{ id: string; tool_name: string; input_json: string; output_json: string; revision_after: number; created_at: number }>;
}

export function appendMessage(projectId: string, role: "user" | "assistant" | "system-status", content: string): string {
  const id = ulid();
  db.prepare("INSERT INTO messages (id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    projectId,
    role,
    content,
    Date.now()
  );
  return id;
}

export function recordToolCall(args: {
  projectId: string;
  messageId?: string;
  toolName: string;
  input: unknown;
  output: unknown;
  revisionAfter: number;
}): void {
  db.prepare(
    "INSERT INTO tool_calls (id, project_id, message_id, tool_name, input_json, output_json, revision_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    ulid(),
    args.projectId,
    args.messageId ?? null,
    args.toolName,
    JSON.stringify(args.input),
    JSON.stringify(args.output),
    args.revisionAfter,
    Date.now()
  );
}

// Tree mutators ------------------------------------------------------------

export function findNode(root: PrototypeNode | null, nodeId: string): PrototypeNode | null {
  if (!root) return null;
  if (root.nodeId === nodeId) return root;
  for (const c of root.children ?? []) {
    const hit = findNode(c, nodeId);
    if (hit) return hit;
  }
  if (root.slots) {
    for (const slotKids of Object.values(root.slots)) {
      for (const c of slotKids) {
        const hit = findNode(c, nodeId);
        if (hit) return hit;
      }
    }
  }
  return null;
}

export function removeNode(root: PrototypeNode | null, nodeId: string): { root: PrototypeNode | null; removed: boolean } {
  if (!root) return { root: null, removed: false };
  if (root.nodeId === nodeId) return { root: null, removed: true };
  let removed = false;
  const recurse = (n: PrototypeNode): void => {
    if (n.children) {
      const before = n.children.length;
      n.children = n.children.filter((c) => c.nodeId !== nodeId);
      if (n.children.length !== before) removed = true;
      n.children.forEach(recurse);
    }
    if (n.slots) {
      for (const k of Object.keys(n.slots)) {
        const before = n.slots[k].length;
        n.slots[k] = n.slots[k].filter((c) => c.nodeId !== nodeId);
        if (n.slots[k].length !== before) removed = true;
        n.slots[k].forEach(recurse);
      }
    }
  };
  recurse(root);
  return { root, removed };
}

export function setProp(root: PrototypeNode | null, nodeId: string, propName: string, propValue: JsonValue): boolean {
  const node = findNode(root, nodeId);
  if (!node) return false;
  node.props[propName] = propValue;
  return true;
}
