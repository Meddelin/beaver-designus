import * as React from "react";
import { Command } from "cmdk";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Upload, Download, Pencil, Trash2, Home as HomeIcon,
  Sparkles, Bot, Square, SunMoon, Search, Layers, X,
} from "lucide-react";
import { Kbd } from "./primitives.tsx";
import { useTheme } from "../lib/theme.tsx";
import { cn } from "../lib/cn.ts";

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  group: "Actions" | "Navigate" | "Compose" | "Inspect" | "Theme";
  icon?: React.ComponentType<any>;
  shortcut?: string[];
  run: () => void | Promise<void>;
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  items: CommandItem[];
}): React.ReactElement {
  const [query, setQuery] = React.useState("");
  React.useEffect(() => { if (open) setQuery(""); }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onOpenChange]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="palette"
          className="fixed inset-0 z-[200] flex items-start justify-center pt-[14vh] px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
          <motion.div
            className="relative w-full max-w-[640px] glass rounded-xl border border-line shadow-elev-3 overflow-hidden"
            initial={{ y: -12, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -8, opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
          >
            <Command label="Command palette" loop>
              <div className="flex items-center gap-2 px-4 h-12 border-b border-line">
                <Search size={15} className="text-ink-3" />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Type a command or search…"
                  className="flex-1 bg-transparent outline-none text-[14px] text-ink-0 placeholder:text-ink-3"
                />
                <Kbd>esc</Kbd>
              </div>
              <Command.List className="max-h-[60vh] overflow-auto p-1.5">
                <Command.Empty className="px-4 py-6 text-center text-[13px] text-ink-3">
                  No matches.
                </Command.Empty>
                {(["Actions", "Navigate", "Compose", "Inspect", "Theme"] as const).map((group) => {
                  const grouped = items.filter((i) => i.group === group);
                  if (grouped.length === 0) return null;
                  return (
                    <Command.Group
                      key={group}
                      heading={<span className="px-2 text-[10.5px] uppercase tracking-widest text-ink-3 font-mono">{group}</span>}
                    >
                      {grouped.map((it) => (
                        <Command.Item
                          key={it.id}
                          value={`${it.group} ${it.label} ${it.hint ?? ""}`}
                          onSelect={async () => {
                            onOpenChange(false);
                            await it.run();
                          }}
                          className={cn(
                            "group flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer text-[13px]",
                            "data-[selected=true]:bg-accent/8 data-[selected=true]:border-l-2 data-[selected=true]:border-accent",
                            "border-l-2 border-transparent"
                          )}
                        >
                          {it.icon ? <it.icon size={14} className="text-ink-2 group-data-[selected=true]:text-accent" /> : <span className="w-3.5" />}
                          <span className="text-ink-0">{it.label}</span>
                          {it.hint ? <span className="text-ink-3 text-[12px] font-mono">{it.hint}</span> : null}
                          <span className="flex-1" />
                          {it.shortcut ? (
                            <span className="flex items-center gap-1">
                              {it.shortcut.map((k, i) => <Kbd key={i}>{k}</Kbd>)}
                            </span>
                          ) : null}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  );
                })}
              </Command.List>
              <div className="flex items-center gap-3 px-4 h-9 border-t border-line text-[11px] text-ink-3 font-mono">
                <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
                <span className="flex items-center gap-1"><Kbd>↵</Kbd> select</span>
                <span className="flex items-center gap-1"><Kbd>esc</Kbd> close</span>
                <span className="flex-1" />
                <span>beaver · designus</span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ─── Helper to build a default set of items for a given screen ─────────── */

export function buildBaseItems(opts: {
  toggleTheme: () => void;
  onHome?: () => void;
  onNewProject?: () => Promise<void> | void;
  onImport?: () => Promise<void> | void;
  onExportCurrent?: () => Promise<void> | void;
  onRenameCurrent?: () => Promise<void> | void;
  onDeleteCurrent?: () => Promise<void> | void;
  onCancelTurn?: () => Promise<void> | void;
  onToggleDrawer?: () => void;
}): CommandItem[] {
  const items: CommandItem[] = [];
  if (opts.onNewProject) items.push({ id: "new-proto", label: "New prototype", group: "Actions", icon: Plus, shortcut: ["⌘", "N"], run: opts.onNewProject });
  if (opts.onImport) items.push({ id: "import", label: "Import prototype…", group: "Actions", icon: Upload, shortcut: ["⌘", "I"], run: opts.onImport });
  if (opts.onExportCurrent) items.push({ id: "export-cur", label: "Export current prototype", group: "Actions", icon: Download, shortcut: ["⌘", "E"], run: opts.onExportCurrent });
  if (opts.onRenameCurrent) items.push({ id: "rename-cur", label: "Rename current prototype", group: "Actions", icon: Pencil, shortcut: ["⌘", "R"], run: opts.onRenameCurrent });
  if (opts.onDeleteCurrent) items.push({ id: "delete-cur", label: "Delete current prototype", group: "Actions", icon: Trash2, run: opts.onDeleteCurrent });
  if (opts.onHome) items.push({ id: "home", label: "Back to projects", group: "Navigate", icon: HomeIcon, shortcut: ["⌘", "H"], run: opts.onHome });
  if (opts.onCancelTurn) items.push({ id: "cancel-turn", label: "Cancel current turn", group: "Compose", icon: Square, shortcut: ["esc"], run: opts.onCancelTurn });
  if (opts.onToggleDrawer) items.push({ id: "toggle-drawer", label: "Toggle inspector", group: "Inspect", icon: Layers, shortcut: ["⌘", "B"], run: opts.onToggleDrawer });
  items.push({ id: "toggle-theme", label: "Toggle theme", group: "Theme", icon: SunMoon, shortcut: ["⌘", ","], run: opts.toggleTheme });
  return items;
}

export { X, Sparkles, Bot };
