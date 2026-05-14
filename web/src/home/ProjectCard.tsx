import * as React from "react";
import { motion } from "framer-motion";
import { MoreHorizontal, Download, Pencil, Trash2, Sparkles } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Card, Pill, IconButton } from "../ui/primitives.tsx";
import { cn } from "../lib/cn.ts";
import { relativeTime, shortRev } from "../lib/format.ts";
import { PrototypeRender } from "@preview/render.tsx";
import type { Prototype } from "@shared/types.ts";

export interface ProjectCardData {
  id: string;
  title: string;
  design_system: string;
  manifest_rev: string | null;
  updated_at: number;
}

export function ProjectCard({
  project,
  prototype,
  onOpen,
  onRename,
  onDelete,
  onExport,
  index = 0,
}: {
  project: ProjectCardData;
  prototype: Prototype | null;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onExport: () => void;
  index?: number;
}): React.ReactElement {
  const empty = !prototype || !prototype.root;
  const nodeCount = prototype ? countNodes(prototype.root) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.02 + index * 0.04, duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
      layout
    >
      <Card interactive onClick={onOpen} className="group p-3 flex flex-col gap-3">
        <div className="relative h-[140px] rounded-md border border-line bg-paper-2 overflow-hidden dotted-grid">
          {empty ? (
            <div className="absolute inset-0 flex items-center justify-center text-[11.5px] text-ink-3 font-mono uppercase tracking-widest">
              empty
            </div>
          ) : (
            <div
              className="absolute top-0 left-0 origin-top-left pointer-events-none select-none transition-transform duration-[1800ms] ease-snap group-hover:scale-[0.20]"
              style={{ transform: "scale(0.18)", width: "555%", height: "555%" }}
              aria-hidden
            >
              <ThumbnailRender prototype={prototype!} />
            </div>
          )}
          <div className="absolute bottom-2 left-2 flex items-center gap-1">
            <Pill tone="neutral" className="bg-paper-1/80 backdrop-blur">
              <Sparkles size={9} />
              <span>{project.design_system}</span>
            </Pill>
          </div>
          <div className="absolute top-2 right-2">
            <ProjectMenu onRename={onRename} onExport={onExport} onDelete={onDelete} />
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-2 px-0.5">
          <h3 className={cn(
            "truncate text-[14.5px] font-medium text-ink-0 tracking-tight",
            "group-hover:text-accent transition-colors duration-200"
          )}>
            {project.title}
          </h3>
        </div>
        <div className="flex items-center justify-between gap-2 px-0.5 text-[11px] font-mono text-ink-3 tabular">
          <span>{nodeCount} {nodeCount === 1 ? "node" : "nodes"}</span>
          <span>rev {shortRev(project.manifest_rev, 6)}</span>
          <span className="text-ink-2">{relativeTime(project.updated_at)}</span>
        </div>
      </Card>
    </motion.div>
  );
}

function ProjectMenu({
  onRename,
  onExport,
  onDelete,
}: {
  onRename: () => void;
  onExport: () => void;
  onDelete: () => void;
}): React.ReactElement {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild onClick={(e) => e.stopPropagation()}>
        <IconButton variant="secondary" size="icon-sm" aria-label="Project actions" className="bg-paper-1/85 backdrop-blur border border-line">
          <MoreHorizontal size={13} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          onClick={(e) => e.stopPropagation()}
          className="z-[120] min-w-[160px] rounded-md border border-line bg-paper-1 shadow-elev-3 p-1 text-[13px]"
        >
          <MenuItem icon={Pencil} label="Rename" onSelect={onRename} />
          <MenuItem icon={Download} label="Export" onSelect={onExport} />
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <MenuItem icon={Trash2} label="Delete" onSelect={onDelete} danger />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onSelect,
  danger,
}: {
  icon: React.ComponentType<any>;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}): React.ReactElement {
  return (
    <DropdownMenu.Item
      onSelect={(e) => { e.preventDefault(); onSelect(); }}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer outline-none",
        "data-[highlighted]:bg-paper-3",
        danger ? "text-state-danger data-[highlighted]:bg-state-danger/12" : "text-ink-0"
      )}
    >
      <Icon size={13} className={danger ? "text-state-danger" : "text-ink-2"} />
      {label}
    </DropdownMenu.Item>
  );
}

function countNodes(root: any): number {
  if (!root) return 0;
  let n = 1;
  for (const c of root.children ?? []) n += countNodes(c);
  for (const arr of Object.values(root.slots ?? {}) as any[]) {
    for (const c of arr) n += countNodes(c);
  }
  return n;
}

function ThumbnailRender({ prototype }: { prototype: Prototype }): React.ReactElement {
  if (!prototype.root) return <span />;
  return <PrototypeRender node={prototype.root} />;
}
