import * as React from "react";
import { LayoutGrid } from "lucide-react";

export function EmptyState({
  onNew,
}: {
  onNew: () => void | Promise<void>;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 rounded-lg border border-dashed border-line bg-paper-1/40">
      <div className="w-12 h-12 rounded-md border border-line flex items-center justify-center text-ink-2 mb-4">
        <LayoutGrid size={20} />
      </div>
      <h3 className="text-[16px] font-medium text-ink-0">No prototypes yet</h3>
      <p className="mt-1.5 text-[13px] text-ink-2 max-w-[420px] leading-relaxed">
        Describe a screen — a profile page, a dashboard, an onboarding flow —
        and let the agent compose it from your design system's real components.
      </p>
      <button
        onClick={() => onNew()}
        className="mt-5 text-[12.5px] font-mono uppercase tracking-widest text-accent hover:underline underline-offset-4"
      >
        Start a new prototype →
      </button>
    </div>
  );
}
