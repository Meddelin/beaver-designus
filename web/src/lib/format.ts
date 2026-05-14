export function shortRev(rev: string | null | undefined, len = 6): string {
  if (!rev) return "—";
  return rev.slice(0, len);
}

export function relativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const s = Math.round(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(epochMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

export function modKeyLabel(): string {
  return isMac() ? "⌘" : "Ctrl";
}
