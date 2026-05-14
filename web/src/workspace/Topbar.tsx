import * as React from "react";
import { ArrowLeft, PanelRight, PanelRightClose, SunMoon } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { IconButton, Pill, Kbd } from "../ui/primitives.tsx";
import { useTheme } from "../lib/theme.tsx";
import { shortRev, modKeyLabel } from "../lib/format.ts";

export function Topbar({
  title,
  manifestRev,
  nodeCount,
  drawerOpen,
  onToggleDrawer,
  onOpenPalette,
  onBackHome,
}: {
  title: string;
  manifestRev: string | null;
  nodeCount: number;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onOpenPalette: () => void;
  onBackHome: () => void;
}): React.ReactElement {
  const { theme, toggle } = useTheme();
  const mod = modKeyLabel();
  return (
    <Tooltip.Provider delayDuration={200}>
      <header className="h-12 flex items-center gap-2 px-3 border-b border-line bg-paper-1/85 backdrop-blur z-10 sticky top-0">
        <IconButton variant="ghost" size="icon-sm" onClick={onBackHome} aria-label="Back to projects">
          <ArrowLeft size={15} />
        </IconButton>
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="truncate text-[13.5px] font-medium text-ink-0 tracking-tight max-w-[260px]">{title}</h1>
          <Pill tone="neutral" title="manifest revision">rev {shortRev(manifestRev, 6)}</Pill>
          <Pill tone="neutral" className="tabular">{nodeCount} {nodeCount === 1 ? "node" : "nodes"}</Pill>
        </div>
        <div className="flex-1" />
        <TooltipBtn label={`Command palette (${mod}K)`}>
          <IconButton variant="secondary" size="sm" onClick={onOpenPalette} className="gap-1.5 px-2.5">
            <span className="flex items-center gap-0.5"><Kbd>{mod}</Kbd><Kbd>K</Kbd></span>
          </IconButton>
        </TooltipBtn>
        <TooltipBtn label={`Toggle theme (${mod},) — ${theme}`}>
          <IconButton variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle theme">
            <SunMoon size={14} />
          </IconButton>
        </TooltipBtn>
        <TooltipBtn label={`Toggle inspector (${mod}B)`}>
          <IconButton variant="ghost" size="icon-sm" onClick={onToggleDrawer} aria-label="Toggle inspector">
            {drawerOpen ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
          </IconButton>
        </TooltipBtn>
      </header>
    </Tooltip.Provider>
  );
}

function TooltipBtn({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children as any}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={6}
          className="px-2 py-1 rounded-sm bg-paper-3 text-ink-0 text-[11.5px] font-mono border border-line shadow-elev-2"
        >
          {label}
          <Tooltip.Arrow className="fill-paper-3" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
