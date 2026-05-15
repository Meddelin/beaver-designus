// Thin typed client over the daemon's HTTP + SSE API. All routes hit /api/*
// which Vite proxies to 127.0.0.1:7457.

import type { ManifestEntry, Prototype, PrototypeNode, SseEvent } from "@shared/types.ts";

export interface ProjectSummary {
  id: string;
  title: string;
  design_system: string;
  manifest_rev: string | null;
  created_at: number;
  updated_at: number;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `${r.status}`);
  }
  return r.json();
}

export const api = {
  listProjects: () => jsonFetch<{ projects: ProjectSummary[] }>("/api/projects"),
  createProject: (title?: string) =>
    jsonFetch<{ project: ProjectSummary }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(title != null ? { title } : {}),
    }),
  getProject: (id: string) =>
    jsonFetch<{
      project: ProjectSummary;
      prototype: Prototype;
      messages: Array<{ id: string; role: string; content: string; reasoning?: string | null; created_at: number }>;
      toolCalls: Array<{ id: string; tool_name: string; input: unknown; output: unknown; revision_after: number; created_at: number }>;
      drift: { authoredAt: string; currentAt: string } | null;
    }>(`/api/projects/${id}`),
  renameProject: (id: string, title: string) =>
    jsonFetch<{ project: ProjectSummary }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  deleteProject: (id: string) => fetch(`/api/projects/${id}`, { method: "DELETE" }),
  exportProject: (id: string) => fetch(`/api/projects/${id}/export.json`).then((r) => r.json()),
  importProject: (snapshot: unknown) =>
    jsonFetch<{ project: ProjectSummary }>(`/api/projects/import`, {
      method: "POST",
      body: JSON.stringify({ snapshot }),
    }),

  createSession: (projectId: string) =>
    jsonFetch<{ sessionId: string; projectId: string }>(`/api/sessions`, {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),
  sendMessage: (sessionId: string, content: string) =>
    jsonFetch<{ ok: true }>(`/api/sessions/${sessionId}/message`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  cancelSession: (sessionId: string) =>
    jsonFetch<{ ok: true }>(`/api/sessions/${sessionId}/cancel`, { method: "POST" }),
  applyTool: (sessionId: string, toolName: string, input: unknown) =>
    jsonFetch<{ ok?: true; revision?: number; nodeId?: string }>(`/api/sessions/${sessionId}/apply`, {
      method: "POST",
      body: JSON.stringify({ toolName, input }),
    }),
  events: (sessionId: string, onEvent: (e: SseEvent) => void): EventSource => {
    const es = new EventSource(`/api/sessions/${sessionId}/events`);
    es.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {}
    };
    return es;
  },

  getManifest: () => jsonFetch<{ entries: ManifestEntry[]; tokens: any }>("/api/manifest"),
  getManifestEntry: (id: string) =>
    jsonFetch<ManifestEntry>(`/api/manifest/${encodeURIComponent(id)}`),
};
