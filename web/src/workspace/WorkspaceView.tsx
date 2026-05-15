import * as React from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { SplitPane } from "./SplitPane.tsx";
import { cn } from "../lib/cn.ts";
import { toast } from "sonner";
import { api, type ProjectSummary } from "../api/client.ts";
import { ChatPane, type ChatMessage } from "../chat/ChatPane.tsx";
import { applySse, rehydrateMessages } from "./turn-model.ts";
import { PreviewPane } from "../preview/PreviewPane.tsx";
import { InspectorDrawer } from "../manifest-browser/Drawer.tsx";
import { Topbar } from "./Topbar.tsx";
import { CommandPalette, buildBaseItems } from "../ui/CommandPalette.tsx";
import { useTheme } from "../lib/theme.tsx";
import type { Prototype, PrototypeNode, SseEvent } from "@shared/types.ts";

export function WorkspaceView({
  projectId,
  onBackHome,
}: {
  projectId: string;
  onBackHome: () => void;
}): React.ReactElement {
  const [project, setProject] = React.useState<ProjectSummary | null>(null);
  const [prototype, setPrototype] = React.useState<Prototype>({ revision: 0, root: null });
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [status, setStatus] = React.useState<{ phase: string; runtime?: string; version?: string | null } | null>(null);
  const [drawerNodeId, setDrawerNodeId] = React.useState<string | null>(null);
  const [drawerComponentId, setDrawerComponentId] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const { toggle: toggleTheme } = useTheme();

  // Boot: load project + start session + open SSE.
  React.useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    (async () => {
      const { project, prototype, messages: history, toolCalls, drift } = await api.getProject(projectId);
      if (cancelled) return;
      setProject(project);
      setPrototype(prototype);
      if (drift) {
        toast.warning("Прототип собран против старого манифеста", {
          description: `Authored at rev ${drift.authoredAt.slice(0, 8)}, current ${drift.currentAt.slice(0, 8)}. Часть компонентов может отрендериться как Unknown — пересобери, чтобы синхронизировать.`,
          duration: 12000,
        });
      }

      // Rehydrate chat from durable storage: group tool calls into their
      // owning assistant turn block (mirrors the live inline layout).
      setMessages(rehydrateMessages(history, toolCalls));

      const { sessionId } = await api.createSession(project.id);
      if (cancelled) return;
      setSessionId(sessionId);
      es = api.events(sessionId, handleSseEvent);
    })();
    return () => {
      cancelled = true;
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleSseEvent = (e: SseEvent) => {
    if (e.type === "prototype:set-root") {
      setPrototype({ revision: e.revision, root: e.root });
      return;
    }
    if (e.type === "error") {
      setStatus({ phase: "error" });
      toast.error(e.message);
      setMessages((prev) => applySse(prev, e));
      return;
    }
    if (e.type === "chat:message") {
      setMessages((prev) => applySse(prev, e));
      return;
    }
    if (e.type === "status") {
      if (e.phase === "start") setStatus({ phase: "running", runtime: e.data?.runtime, version: e.data?.version });
      else if (e.phase === "end") setStatus({ phase: "idle" });
      // agent-text / agent-thinking / tool-call / end all fold into the
      // live turn block via the pure reducer.
      setMessages((prev) => applySse(prev, e));
      return;
    }
  };

  const pushMsg = (m: ChatMessage) => setMessages((prev) => [...prev, m]);

  const onSend = async (content: string) => {
    if (!sessionId || !content.trim()) return;
    pushMsg({ id: cryptoId(), kind: "user", content });
    setStatus({ phase: "starting" });
    try {
      await api.sendMessage(sessionId, content);
    } catch (err: any) {
      pushMsg({ id: cryptoId(), kind: "error", content: String(err?.message ?? err) });
      setStatus({ phase: "error" });
      toast.error(String(err?.message ?? err));
    }
  };

  const onCancel = async () => {
    if (!sessionId) return;
    try {
      await api.cancelSession(sessionId);
      toast("Cancelled");
    } catch {}
  };

  const onNodeClick = (nodeId: string, component: string) => {
    setDrawerNodeId(nodeId);
    setDrawerComponentId(component);
    setDrawerOpen(true);
  };

  const onCloseDrawer = () => {
    setDrawerOpen(false);
    setTimeout(() => { setDrawerNodeId(null); setDrawerComponentId(null); }, 320);
  };

  const onExplainNode = async () => {
    if (!sessionId || !drawerComponentId) return;
    const msg = `Объясни компонент "${drawerComponentId}" (node ${drawerNodeId}) — что это, какую задачу решает в продукте и почему он подходит для этого места в текущем макете. Используй explainer skill, отвечай на русском.`;
    await onSend(msg);
  };

  const onRenameCurrent = async () => {
    if (!project) return;
    const next = window.prompt("Rename project:", project.title);
    if (!next || next === project.title) return;
    const { project: updated } = await api.renameProject(project.id, next);
    setProject(updated);
    toast.success("Renamed");
  };

  const onExportCurrent = async () => {
    if (!project) return;
    try {
      const snapshot = await api.exportProject(project.id);
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.title.replace(/[^\w-]+/g, "_")}.bdproto.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exported");
    } catch (err: any) {
      toast.error(`Export failed: ${err?.message ?? err}`);
    }
  };

  const onDeleteCurrent = async () => {
    if (!project) return;
    if (!window.confirm(`Delete "${project.title}"?`)) return;
    await api.deleteProject(project.id);
    toast("Deleted");
    onBackHome();
  };

  useHotkeys("mod+k", (e) => { e.preventDefault(); setPaletteOpen((v) => !v); }, []);
  useHotkeys("mod+b", (e) => { e.preventDefault(); setDrawerOpen((v) => !v); }, []);
  useHotkeys("mod+/", (e) => { e.preventDefault(); composerRef.current?.focus(); }, []);
  useHotkeys("mod+h", (e) => { e.preventDefault(); onBackHome(); }, [onBackHome]);
  useHotkeys("mod+shift+l", (e) => { e.preventDefault(); toggleTheme(); }, [toggleTheme]);
  useHotkeys("escape", () => {
    if (paletteOpen) setPaletteOpen(false);
    else if (drawerOpen) onCloseDrawer();
  }, [paletteOpen, drawerOpen]);

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center text-[13px] text-ink-3">
        Loading project…
      </div>
    );
  }

  const paletteItems = buildBaseItems({
    toggleTheme,
    onHome: onBackHome,
    onCancelTurn: onCancel,
    onToggleDrawer: () => setDrawerOpen((v) => !v),
    onRenameCurrent,
    onExportCurrent,
    onDeleteCurrent,
  });

  const nodeCount = countNodes(prototype.root);

  return (
    <div className="h-full flex flex-col">
      <Topbar
        title={project.title}
        manifestRev={project.manifest_rev}
        nodeCount={nodeCount}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((v) => !v)}
        onOpenPalette={() => setPaletteOpen(true)}
        onBackHome={onBackHome}
      />

      <div className="flex-1 min-h-0 flex">
        <div className={cn("flex-1 min-w-0", drawerOpen && drawerComponentId ? "" : "")}>
          <SplitPane
            leftMinPct={26}
            leftMaxPct={64}
            leftDefaultPct={42}
            left={
              <ChatPane
                messages={messages}
                onSend={onSend}
                onCancel={onCancel}
                status={status}
                composerRef={composerRef}
              />
            }
            right={
              <PreviewPane
                prototype={prototype}
                onNodeClick={onNodeClick}
                focusedNodeId={drawerNodeId}
                manifestRev={project.manifest_rev}
              />
            }
          />
        </div>

        <InspectorDrawer
          componentId={drawerComponentId}
          nodeId={drawerNodeId}
          nodeProps={(findNode(prototype.root, drawerNodeId)?.props as Record<string, unknown>) ?? null}
          open={drawerOpen && drawerComponentId !== null}
          onClose={onCloseDrawer}
          onAskExplainer={onExplainNode}
          onSetProp={async (propName, propValue) => {
            if (!sessionId || !drawerNodeId) return;
            try {
              await api.applyTool(sessionId, "setProp", { nodeId: drawerNodeId, propName, propValue });
            } catch (err: any) {
              toast.error(`setProp failed: ${err?.message ?? err}`);
            }
          }}
          onRemoveNode={async () => {
            if (!sessionId || !drawerNodeId) return;
            if (!window.confirm("Remove this node and its subtree?")) return;
            try {
              await api.applyTool(sessionId, "removeNode", { nodeId: drawerNodeId });
              onCloseDrawer();
            } catch (err: any) {
              toast.error(`removeNode failed: ${err?.message ?? err}`);
            }
          }}
        />
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={paletteItems} />
    </div>
  );
}

function cryptoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function countNodes(root: PrototypeNode | null): number {
  if (!root) return 0;
  let n = 1;
  for (const c of root.children ?? []) n += countNodes(c);
  for (const arr of Object.values(root.slots ?? {}) as PrototypeNode[][]) {
    for (const c of arr) n += countNodes(c);
  }
  return n;
}

function findNode(root: PrototypeNode | null, id: string | null): PrototypeNode | null {
  if (!root || !id) return null;
  if (root.nodeId === id) return root;
  for (const c of root.children ?? []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  if (root.slots) {
    for (const arr of Object.values(root.slots) as PrototypeNode[][]) {
      for (const c of arr) {
        const hit = findNode(c, id);
        if (hit) return hit;
      }
    }
  }
  return null;
}
