import * as React from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { Search, Filter } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Hero } from "./Hero.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { ProjectCard, type ProjectCardData } from "./ProjectCard.tsx";
import { SectionTitle, Pill } from "../ui/primitives.tsx";
import { CommandPalette, buildBaseItems } from "../ui/CommandPalette.tsx";
import { useTheme } from "../lib/theme.tsx";
import { cn } from "../lib/cn.ts";
import { api, type ProjectSummary } from "../api/client.ts";
import type { Prototype } from "@shared/types.ts";

export function Home({ onOpen }: { onOpen: (p: ProjectSummary) => void }): React.ReactElement {
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [prototypes, setPrototypes] = React.useState<Record<string, Prototype>>({});
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [dsFilter, setDsFilter] = React.useState<string | "all">("all");
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const { toggle: toggleTheme } = useTheme();

  const refresh = React.useCallback(async () => {
    setLoading(true);
    const r = await api.listProjects();
    setProjects(r.projects);
    setLoading(false);
    // Fetch prototypes in parallel for thumbnails. Best-effort, ignore failures.
    void Promise.all(
      r.projects.map((p) =>
        api.getProject(p.id).then(
          (full) => setPrototypes((prev) => ({ ...prev, [p.id]: full.prototype })),
          () => undefined
        )
      )
    );
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const onNew = React.useCallback(async () => {
    const { project } = await api.createProject();
    toast.success("New prototype created");
    onOpen(project);
  }, [onOpen]);

  const onImport = React.useCallback(async () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json";
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        const snapshot = JSON.parse(await file.text());
        const { project } = await api.importProject(snapshot);
        toast.success(`Imported "${project.title}"`);
        await refresh();
        onOpen(project);
      } catch (err: any) {
        toast.error(`Import failed: ${err?.message ?? err}`);
      }
    };
    inp.click();
  }, [onOpen, refresh]);

  const onRename = React.useCallback(async (p: ProjectSummary) => {
    const next = window.prompt("Rename project:", p.title);
    if (!next || next === p.title) return;
    await api.renameProject(p.id, next);
    toast.success("Renamed");
    void refresh();
  }, [refresh]);

  const onExport = React.useCallback(async (p: ProjectSummary) => {
    try {
      const snapshot = await api.exportProject(p.id);
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${p.title.replace(/[^\w-]+/g, "_")}.bdproto.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exported");
    } catch (err: any) {
      toast.error(`Export failed: ${err?.message ?? err}`);
    }
  }, []);

  const onDelete = React.useCallback(async (p: ProjectSummary) => {
    if (!window.confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
    await api.deleteProject(p.id);
    toast("Deleted", { description: p.title });
    void refresh();
  }, [refresh]);

  useHotkeys("mod+k", (e) => { e.preventDefault(); setPaletteOpen((v) => !v); }, []);
  useHotkeys("mod+n", (e) => { e.preventDefault(); void onNew(); }, [onNew]);
  useHotkeys("mod+i", (e) => { e.preventDefault(); void onImport(); }, [onImport]);
  useHotkeys("mod+shift+l", (e) => { e.preventDefault(); toggleTheme(); }, [toggleTheme]);

  const designSystems = React.useMemo(
    () => Array.from(new Set(projects.map((p) => p.design_system))),
    [projects]
  );

  const filtered = projects.filter((p) => {
    if (dsFilter !== "all" && p.design_system !== dsFilter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      if (!p.title.toLowerCase().includes(q) && !p.id.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const paletteItems = buildBaseItems({
    toggleTheme,
    onNewProject: onNew,
    onImport,
  });

  return (
    <div className="min-h-full">
      <div className="max-w-[1080px] mx-auto px-6 lg:px-10">
        <Hero onNew={onNew} onImport={onImport} onOpenPalette={() => setPaletteOpen(true)} />

        <section className="mt-2 mb-16">
          <SectionTitle
            hint={`${projects.length} ${projects.length === 1 ? "prototype" : "prototypes"}`}
            action={
              projects.length > 0 ? (
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search…"
                      className="h-8 pl-7 pr-3 w-[200px] rounded-md border border-line bg-paper-1 text-[13px] text-ink-0 placeholder:text-ink-3 outline-none focus:border-accent/60 focus:ring-accent-soft transition"
                    />
                  </div>
                  {designSystems.length > 1 ? (
                    <div className="flex items-center gap-1">
                      <Filter size={12} className="text-ink-3" />
                      <FilterChip active={dsFilter === "all"} onClick={() => setDsFilter("all")}>all</FilterChip>
                      {designSystems.map((ds) => (
                        <FilterChip key={ds} active={dsFilter === ds} onClick={() => setDsFilter(ds)}>{ds}</FilterChip>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null
            }
          >
            Projects
          </SectionTitle>

          {loading ? (
            <SkeletonGrid />
          ) : projects.length === 0 ? (
            <EmptyState onNew={onNew} />
          ) : (
            <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <AnimatePresence>
                {filtered.map((p, i) => (
                  <ProjectCard
                    key={p.id}
                    index={i}
                    project={p as ProjectCardData}
                    prototype={prototypes[p.id] ?? null}
                    onOpen={() => onOpen(p)}
                    onRename={() => onRename(p)}
                    onExport={() => onExport(p)}
                    onDelete={() => onDelete(p)}
                  />
                ))}
              </AnimatePresence>
              {filtered.length === 0 ? (
                <div className="col-span-full py-10 text-center text-[13px] text-ink-3">
                  No projects match the current filters.
                </div>
              ) : null}
            </motion.div>
          )}
        </section>

        <footer className="pb-12 text-[11px] font-mono text-ink-3 tabular flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <span>local-first</span>
          <span>·</span>
          <span>DS-only prototype tool</span>
          <span>·</span>
          <span>SQLite + SSE + MCP</span>
          <span className="ml-auto flex items-center gap-2">
            <Pill tone="neutral">v0.1</Pill>
          </span>
        </footer>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={paletteItems} />
    </div>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 px-2.5 rounded-sm text-[11px] font-mono uppercase tracking-wide border transition-colors",
        active
          ? "bg-accent/12 text-accent border-accent/40"
          : "bg-paper-1 text-ink-2 border-line hover:bg-paper-2 hover:text-ink-0"
      )}
    >
      {children}
    </button>
  );
}

function SkeletonGrid(): React.ReactElement {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-line bg-paper-1 p-3">
          <div className="h-[140px] rounded-md bg-paper-2 animate-pulse" />
          <div className="mt-3 h-4 w-1/2 rounded bg-paper-2 animate-pulse" />
          <div className="mt-2 h-3 w-1/3 rounded bg-paper-2 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
