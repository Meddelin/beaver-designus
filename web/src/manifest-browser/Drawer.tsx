import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Tabs from "@radix-ui/react-tabs";
import { X, Sparkles, Hash, Layers, Tag, Code2, ArrowRight, Trash2, Check } from "lucide-react";
import { api } from "../api/client.ts";
import { Pill, IconButton, Button } from "../ui/primitives.tsx";
import { cn } from "../lib/cn.ts";
import type { ManifestEntry, PropShape, JsonValue } from "@shared/types.ts";

// Shape of manifest-data/tokens.json (per ARCHITECTURE §3.1.1).
interface TokenManifest {
  groups: Record<string, {
    path: string;
    description?: string;
    variants: Array<{ name: string; values: Record<string, string>; cssVar: string }>;
  }>;
  defaultComboId?: string;
}

/* Tokens are loaded once per drawer lifetime — cached at module scope so the
 * second open doesn't re-fetch. The shape mirrors §3.1.1. */
let TOKENS_CACHE: Promise<TokenManifest | null> | null = null;
function loadTokens(): Promise<TokenManifest | null> {
  if (!TOKENS_CACHE) {
    TOKENS_CACHE = fetch("/api/manifest")
      .then((r) => r.json())
      .then((d) => (d.tokens ?? null) as TokenManifest | null)
      .catch(() => null);
  }
  return TOKENS_CACHE;
}

export interface InspectorDrawerProps {
  componentId: string | null;
  nodeId?: string | null;
  nodeProps?: Record<string, unknown> | null;
  open: boolean;
  onClose: () => void;
  onAskExplainer: () => void;
  onSetProp?: (propName: string, propValue: unknown) => Promise<void> | void;
  onRemoveNode?: () => Promise<void> | void;
}

export function InspectorDrawer({
  componentId,
  nodeId,
  nodeProps,
  open,
  onClose,
  onAskExplainer,
  onSetProp,
  onRemoveNode,
}: InspectorDrawerProps): React.ReactElement {
  const [entry, setEntry] = React.useState<ManifestEntry | null>(null);

  React.useEffect(() => {
    if (!componentId || !open) return;
    let cancelled = false;
    setEntry(null);
    api.getManifestEntry(componentId)
      .then((e) => { if (!cancelled) setEntry(e); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [componentId, open]);

  return (
    <AnimatePresence initial={false}>
      {open && componentId ? (
        <motion.aside
          key="drawer"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 380, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 280, damping: 32, mass: 0.6 }}
          className="shrink-0 border-l border-line bg-paper-1 flex flex-col overflow-hidden h-full"
          aria-label="Component inspector"
          style={{ minWidth: 0 }}
        >
          <div className="w-[380px] h-full flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 h-12 border-b border-line">
            <div className="flex items-center gap-2 min-w-0">
              <Layers size={13} className="text-accent" />
              <span className="text-[11.5px] font-mono uppercase tracking-widest text-ink-3">inspector</span>
            </div>
            <IconButton variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close inspector">
              <X size={14} />
            </IconButton>
          </div>
          {!entry ? (
            <DrawerSkeleton componentId={componentId} />
          ) : (
            <DrawerContent
              entry={entry}
              nodeId={nodeId ?? null}
              nodeProps={nodeProps ?? {}}
              onAskExplainer={onAskExplainer}
              onSetProp={onSetProp}
              onRemoveNode={onRemoveNode}
            />
          )}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function DrawerContent({
  entry,
  nodeId,
  nodeProps,
  onAskExplainer,
  onSetProp,
  onRemoveNode,
}: {
  entry: ManifestEntry;
  nodeId: string | null;
  nodeProps: Record<string, unknown>;
  onAskExplainer: () => void;
  onSetProp?: (propName: string, propValue: unknown) => Promise<void> | void;
  onRemoveNode?: () => Promise<void> | void;
}): React.ReactElement {
  // P2/P5 — canonical example values, used for the "reset to example" affordance.
  const usageProps = (entry.usage?.tree?.props ?? {}) as Record<string, JsonValue>;
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 pt-3 pb-3 border-b border-line">
        <div className="flex items-baseline gap-2 mb-1.5">
          <h3 className="text-[18px] font-semibold tracking-tight text-ink-0">{entry.name}</h3>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-[11.5px] font-mono text-ink-2 mb-2">
          <Pill tone="accent">{entry.sourceSystem}</Pill>
          <Pill tone="neutral">{entry.category}</Pill>
          <span className="truncate text-ink-3">{entry.packageName}</span>
        </div>
        {entry.description ? (
          <p className="text-[13px] text-ink-1 leading-relaxed mt-1">{entry.description}</p>
        ) : null}
      </div>

      <Tabs.Root defaultValue="props" className="flex-1 flex flex-col min-h-0">
        <Tabs.List className="flex items-center gap-0 px-3 border-b border-line bg-paper-1/60">
          <TabTrigger value="props" icon={Hash}>Props <span className="text-ink-3 ml-0.5">{entry.props.length}</span></TabTrigger>
          <TabTrigger value="slots" icon={Layers}>Slots</TabTrigger>
          {entry.tags.length > 0 ? <TabTrigger value="tags" icon={Tag}>Tags</TabTrigger> : null}
          {entry.examples.length > 0 ? <TabTrigger value="examples" icon={Code2}>Examples</TabTrigger> : null}
        </Tabs.List>

        <div className="flex-1 overflow-auto">
          <Tabs.Content value="props" className="p-4 outline-none">
            {entry.props.length === 0 ? (
              <p className="text-[12.5px] text-ink-3 italic">No props.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {entry.props.map((p: any) => (
                  <EditablePropRow
                    key={p.name}
                    prop={p}
                    currentValue={nodeProps[p.name]}
                    usageValue={usageProps[p.name]}
                    editable={Boolean(nodeId && onSetProp)}
                    onChange={(v) => onSetProp?.(p.name, v)}
                  />
                ))}
              </div>
            )}
          </Tabs.Content>
          <Tabs.Content value="slots" className="p-4 outline-none">
            <SlotInfo slots={entry.slots as any} />
          </Tabs.Content>
          <Tabs.Content value="tags" className="p-4 outline-none">
            <div className="flex flex-wrap gap-1.5">
              {entry.tags.map((t) => <Pill key={t} tone="neutral">{t}</Pill>)}
            </div>
          </Tabs.Content>
          <Tabs.Content value="examples" className="p-4 outline-none flex flex-col gap-3">
            {entry.examples.map((ex: any, i: number) => (
              <div key={i} className="rounded-md border border-line overflow-hidden">
                {ex.title ? (
                  <div className="px-3 py-1.5 text-[11.5px] font-mono uppercase tracking-widest text-ink-3 border-b border-line bg-paper-2">
                    {ex.title}
                  </div>
                ) : null}
                <pre className="m-0 p-3 text-[11.5px] leading-relaxed font-mono text-ink-1 bg-paper-0 overflow-x-auto">
                  {ex.code}
                </pre>
              </div>
            ))}
          </Tabs.Content>
        </div>
      </Tabs.Root>

      <div className="px-3 py-3 border-t border-line bg-paper-1/70 backdrop-blur flex items-center gap-2">
        <Button variant="primary" size="md" onClick={onAskExplainer} className="flex-1 gap-1.5">
          <Sparkles size={13} />
          Ask the explainer
          <ArrowRight size={13} className="ml-auto" />
        </Button>
        {onRemoveNode ? (
          <IconButton variant="danger" size="icon" onClick={() => onRemoveNode()} aria-label="Remove node" title="Remove this node and its subtree">
            <Trash2 size={14} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Editable prop row ─────────────────────────────────────────────────── */

function EditablePropRow({
  prop,
  currentValue,
  usageValue,
  editable,
  onChange,
}: {
  prop: any;
  currentValue: unknown;
  usageValue?: JsonValue;
  editable: boolean;
  onChange: (v: unknown) => void | Promise<void>;
}): React.ReactElement {
  const label = prop.shape ? shapeLabel(prop.shape) : kindLabel(prop.kind);
  const canReset =
    editable && usageValue !== undefined && JSON.stringify(usageValue) !== JSON.stringify(currentValue);
  return (
    <div className="rounded-md border border-line bg-paper-1 px-3 py-2.5">
      <div className="flex items-baseline gap-1.5 flex-wrap mb-1.5">
        <code className="font-mono text-[12.5px] text-ink-0">{prop.name}</code>
        {prop.required ? <span className="text-state-warning text-[10px] font-mono uppercase tracking-wider">req</span> : null}
        <span className="text-ink-3 text-[12px]">:</span>
        <code className="font-mono text-[11.5px] text-accent/80">{label}</code>
        {prop.defaultValue ? (
          <span className="text-ink-3 text-[10.5px] font-mono">default {prop.defaultValue}</span>
        ) : null}
        {canReset ? (
          <button
            type="button"
            onClick={() => void onChange(usageValue)}
            title={`Reset to the design system's example value:\n${truncate(JSON.stringify(usageValue), 200)}`}
            className="ml-auto text-[10.5px] font-mono text-ink-3 hover:text-accent transition-colors"
          >
            ↺ example
          </button>
        ) : null}
      </div>
      {prop.description ? (
        <p className="mb-2 text-[11.5px] text-ink-2 leading-snug">{prop.description}</p>
      ) : null}
      <PropEditor
        kind={prop.kind}
        shape={prop.shape}
        currentValue={currentValue}
        editable={editable}
        onChange={onChange}
      />
    </div>
  );
}

function PropEditor({
  kind,
  shape,
  currentValue,
  editable,
  onChange,
}: {
  kind: any;
  shape?: PropShape;
  currentValue: unknown;
  editable: boolean;
  onChange: (v: unknown) => void | Promise<void>;
}): React.ReactElement {
  if (kind?.type === "literal-union") {
    const opts: Array<string | number | boolean> = kind.options ?? [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {opts.map((opt) => {
          const active = currentValue === opt;
          return (
            <button
              key={String(opt)}
              type="button"
              disabled={!editable}
              onClick={() => onChange(opt)}
              className={cn(
                "h-7 px-2.5 rounded-sm text-[11.5px] font-mono border transition-colors flex items-center gap-1",
                active
                  ? "bg-accent text-[var(--accent-contrast)] border-accent font-medium"
                  : "bg-paper-2 text-ink-1 border-line hover:bg-paper-3 hover:text-ink-0",
                !editable && "opacity-50 cursor-not-allowed"
              )}
            >
              {active ? <Check size={10} /> : null}
              {typeof opt === "string" ? `"${opt}"` : String(opt)}
            </button>
          );
        })}
        {currentValue === undefined ? (
          <span className="text-[10.5px] font-mono text-ink-3 self-center">unset</span>
        ) : null}
      </div>
    );
  }
  if (kind?.type === "boolean") {
    const v = currentValue === true;
    return (
      <button
        type="button"
        disabled={!editable}
        onClick={() => onChange(!v)}
        className={cn(
          "inline-flex items-center gap-2 h-7 px-2.5 rounded-sm border text-[11.5px] font-mono transition-colors",
          v ? "bg-accent text-[var(--accent-contrast)] border-accent" : "bg-paper-2 text-ink-1 border-line"
        )}
      >
        <span className={cn(
          "w-3 h-3 rounded-full border",
          v ? "bg-[var(--accent-contrast)] border-[var(--accent-contrast)]" : "border-ink-3"
        )} />
        {v ? "true" : "false"}
      </button>
    );
  }
  if (kind?.type === "string") {
    return <TextEditor currentValue={currentValue} editable={editable} onChange={onChange} parse={(s) => s} />;
  }
  if (kind?.type === "number") {
    return <TextEditor currentValue={currentValue} editable={editable} onChange={onChange} parse={(s) => {
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    }} />;
  }
  if (kind?.type === "token-reference") {
    return <TokenPicker group={kind.group} currentValue={currentValue} editable={editable} onChange={onChange} />;
  }
  // `kind` is too coarse here (unsupported / object / array). Drive the
  // editor off the P1 recursive shape instead — this is what makes
  // structured props (table columns/data, option lists, …) editable.
  if (shape) {
    return <ShapeEditor shape={shape} currentValue={currentValue} editable={editable} onChange={onChange} />;
  }
  return (
    <div className="text-[11.5px] font-mono text-ink-3 italic">
      not editable here {currentValue !== undefined ? <>· current: <code className="text-ink-1">{JSON.stringify(currentValue)}</code></> : null}
    </div>
  );
}

/* Shape-driven editor. Primitives/enums get the same focused controls as the
 * kind path; object/array/tuple/record/union fall to a JSON editor with
 * live, lenient shape validation (server is still authoritative). */
function ShapeEditor({
  shape,
  currentValue,
  editable,
  onChange,
}: {
  shape: PropShape;
  currentValue: unknown;
  editable: boolean;
  onChange: (v: unknown) => void | Promise<void>;
}): React.ReactElement {
  switch (shape.t) {
    case "string":
      return <TextEditor currentValue={currentValue} editable={editable} onChange={onChange} parse={(s) => s} />;
    case "number":
      return (
        <TextEditor
          currentValue={currentValue}
          editable={editable}
          onChange={onChange}
          parse={(s) => {
            const n = Number(s);
            return Number.isFinite(n) ? n : undefined;
          }}
        />
      );
    case "boolean": {
      const v = currentValue === true;
      return (
        <button
          type="button"
          disabled={!editable}
          onClick={() => onChange(!v)}
          className={cn(
            "inline-flex items-center gap-2 h-7 px-2.5 rounded-sm border text-[11.5px] font-mono transition-colors",
            v ? "bg-accent text-[var(--accent-contrast)] border-accent" : "bg-paper-2 text-ink-1 border-line"
          )}
        >
          <span className={cn("w-3 h-3 rounded-full border", v ? "bg-[var(--accent-contrast)] border-[var(--accent-contrast)]" : "border-ink-3")} />
          {v ? "true" : "false"}
        </button>
      );
    }
    case "literal":
      return (
        <button
          type="button"
          disabled={!editable}
          onClick={() => onChange(shape.value)}
          className="h-7 px-2.5 rounded-sm text-[11.5px] font-mono border bg-paper-2 text-ink-1 border-line hover:bg-paper-3"
        >
          {JSON.stringify(shape.value)}
        </button>
      );
    case "enum": {
      const opts = shape.options;
      return (
        <div className="flex flex-wrap gap-1.5">
          {opts.map((opt) => {
            const active = currentValue === opt;
            return (
              <button
                key={String(opt)}
                type="button"
                disabled={!editable}
                onClick={() => onChange(opt)}
                className={cn(
                  "h-7 px-2.5 rounded-sm text-[11.5px] font-mono border transition-colors flex items-center gap-1",
                  active
                    ? "bg-accent text-[var(--accent-contrast)] border-accent font-medium"
                    : "bg-paper-2 text-ink-1 border-line hover:bg-paper-3 hover:text-ink-0",
                  !editable && "opacity-50 cursor-not-allowed"
                )}
              >
                {active ? <Check size={10} /> : null}
                {typeof opt === "string" ? `"${opt}"` : String(opt)}
              </button>
            );
          })}
        </div>
      );
    }
    case "union": {
      // If every variant is a literal/enum, present a flat option set.
      const flat: Array<string | number | boolean> = [];
      let allSimple = true;
      for (const v of shape.variants) {
        if (v.t === "literal") flat.push(v.value);
        else if (v.t === "enum") flat.push(...v.options);
        else allSimple = false;
      }
      if (allSimple && flat.length) {
        return (
          <ShapeEditor
            shape={{ t: "enum", options: flat }}
            currentValue={currentValue}
            editable={editable}
            onChange={onChange}
          />
        );
      }
      return <JsonEditor shape={shape} currentValue={currentValue} editable={editable} onChange={onChange} />;
    }
    case "react-node":
      return (
        <div className="text-[11.5px] font-mono text-ink-3 italic">
          ReactNode — composed as a child/slot in the tree, not edited here
        </div>
      );
    case "function":
      return (
        <div className="text-[11.5px] font-mono text-ink-3 italic">
          callback (arity {shape.arity}) — wired by the design system, not set here
        </div>
      );
    case "array":
    case "tuple":
    case "object":
    case "record":
    case "ref":
    case "unknown":
    default:
      return <JsonEditor shape={shape} currentValue={currentValue} editable={editable} onChange={onChange} />;
  }
}

/* JSON editor for structured props. Pretty-prints the current value, parses
 * on apply, and runs the same lenient structural check the server uses so
 * the user gets feedback before the round-trip. */
function JsonEditor({
  shape,
  currentValue,
  editable,
  onChange,
}: {
  shape: PropShape;
  currentValue: unknown;
  editable: boolean;
  onChange: (v: unknown) => void | Promise<void>;
}): React.ReactElement {
  const initial = currentValue === undefined ? "" : JSON.stringify(currentValue, null, 2);
  const [draft, setDraft] = React.useState(initial);
  React.useEffect(() => {
    setDraft(currentValue === undefined ? "" : JSON.stringify(currentValue, null, 2));
  }, [currentValue]);

  const dirty = draft !== initial;
  let parseError: string | null = null;
  let parsed: JsonValue | undefined;
  if (dirty && draft.trim()) {
    try {
      parsed = JSON.parse(draft) as JsonValue;
      const r = shapeMatches(shape, parsed);
      if (!r.ok) parseError = r.error;
    } catch (e: any) {
      parseError = `invalid JSON: ${e?.message ?? e}`;
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={!editable}
        spellCheck={false}
        rows={Math.min(14, Math.max(3, draft.split("\n").length))}
        className={cn(
          "w-full px-2 py-1.5 rounded-sm bg-paper-0 border text-[11.5px] leading-relaxed font-mono resize-y",
          "focus:outline-none focus:border-accent/60",
          parseError ? "border-state-error" : "border-line",
          !editable && "opacity-50 cursor-not-allowed"
        )}
        placeholder="(unset)"
      />
      {parseError ? (
        <span className="text-[10.5px] font-mono text-state-error">{parseError}</span>
      ) : null}
      <div className="flex items-center gap-2">
        {dirty && editable ? (
          <button
            type="button"
            disabled={Boolean(parseError)}
            onClick={() => {
              if (parseError) return;
              void onChange(draft.trim() ? parsed : undefined);
            }}
            className={cn(
              "h-7 px-2 rounded-sm text-[11px] font-mono",
              parseError ? "bg-paper-2 text-ink-3 cursor-not-allowed" : "bg-accent text-[var(--accent-contrast)]"
            )}
          >
            ↵ apply
          </button>
        ) : null}
        {dirty ? (
          <button
            type="button"
            onClick={() => setDraft(initial)}
            className="h-7 px-2 rounded-sm text-[11px] font-mono text-ink-3 hover:text-ink-1"
          >
            revert
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* Client-side mirror of daemon/prop-validator checkShape — deliberately
 * lenient, advisory only (the daemon re-validates authoritatively). */
function shapeMatches(shape: PropShape | undefined, v: JsonValue, depth = 0): { ok: true } | { ok: false; error: string } {
  if (!shape || depth > 5) return { ok: true };
  const ty = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  switch (shape.t) {
    case "string": return ty === "string" ? { ok: true } : { ok: false, error: `expected string, got ${ty}` };
    case "number": return ty === "number" ? { ok: true } : { ok: false, error: `expected number, got ${ty}` };
    case "boolean": return ty === "boolean" ? { ok: true } : { ok: false, error: `expected boolean, got ${ty}` };
    case "literal": return v === shape.value ? { ok: true } : { ok: false, error: `expected ${JSON.stringify(shape.value)}` };
    case "enum":
      return shape.options.some((o) => o === v) ? { ok: true } : { ok: false, error: `not in [${shape.options.map((o) => JSON.stringify(o)).join(", ")}]` };
    case "array":
    case "tuple":
      if (!Array.isArray(v)) return { ok: false, error: `expected array, got ${ty}` };
      if (shape.t === "array" && v.length > 0) return shapeMatches(shape.element, v[0], depth + 1);
      return { ok: true };
    case "object":
      return v !== null && ty === "object" ? { ok: true } : { ok: false, error: `expected object, got ${ty}` };
    case "union":
      for (const variant of shape.variants) if (shapeMatches(variant, v, depth + 1).ok) return { ok: true };
      return { ok: false, error: "no union variant matched" };
    default:
      return { ok: true };
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function shapeLabel(shape: PropShape): string {
  switch (shape.t) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    case "literal": return JSON.stringify(shape.value);
    case "enum": return shape.options.map((o) => JSON.stringify(o)).join(" | ");
    case "array": return `${shapeLabel(shape.element)}[]`;
    case "tuple": return `[${shape.items.map(shapeLabel).join(", ")}]`;
    case "object": return `{ ${shape.fields.slice(0, 4).map((f) => f.name + (f.optional ? "?" : "")).join(", ")}${shape.fields.length > 4 ? ", …" : ""} }`;
    case "record": return `Record<string, ${shapeLabel(shape.value)}>`;
    case "union": return shape.variants.map(shapeLabel).join(" | ");
    case "function": return `(…${shape.arity}) => …`;
    case "react-node": return "ReactNode";
    case "ref": return shape.name;
    case "unknown": return shape.raw;
    default: return "?";
  }
}

/* Token picker — shows variants from the token group with a real value swatch
 * (color tile for color.*, gradient tile for spacing/animation, text otherwise). */
function TokenPicker({
  group,
  currentValue,
  editable,
  onChange,
}: {
  group: string;
  currentValue: unknown;
  editable: boolean;
  onChange: (v: unknown) => void | Promise<void>;
}): React.ReactElement {
  const [tokens, setTokens] = React.useState<TokenManifest | null>(null);
  React.useEffect(() => { void loadTokens().then(setTokens); }, []);
  if (!tokens) return <div className="text-[11.5px] font-mono text-ink-3">loading tokens…</div>;
  const g = tokens.groups[group];
  if (!g) {
    return (
      <div className="text-[11.5px] font-mono text-ink-3">
        token group <span className="text-accent">{group}</span> · not in manifest tokens.json
      </div>
    );
  }
  const combo = tokens.defaultComboId ?? "";
  const isColor = group.startsWith("color");
  const isSpacing = group.startsWith("spacing");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {g.variants.map((v) => {
          const active = currentValue === v.name;
          const value = v.values[combo] ?? Object.values(v.values)[0] ?? "";
          return (
            <button
              key={v.name}
              type="button"
              disabled={!editable}
              onClick={() => onChange(v.name)}
              title={value}
              className={cn(
                "h-7 px-2 rounded-sm text-[11.5px] font-mono border transition-colors inline-flex items-center gap-1.5",
                active
                  ? "bg-accent/20 text-ink-0 border-accent font-medium"
                  : "bg-paper-2 text-ink-1 border-line hover:bg-paper-3 hover:text-ink-0",
                !editable && "opacity-50 cursor-not-allowed"
              )}
            >
              {active ? <Check size={10} className="text-accent" /> : null}
              {isColor ? (
                <span className="w-3 h-3 rounded-[2px] border border-line" style={{ background: value }} />
              ) : isSpacing ? (
                <span className="text-ink-3 text-[10px]">{value}</span>
              ) : null}
              {v.name}
            </button>
          );
        })}
      </div>
      <span className="text-[10.5px] font-mono text-ink-3">
        group <span className="text-accent">{group}</span> · combo <span className="text-ink-2">{combo}</span>
      </span>
    </div>
  );
}

function TextEditor({
  currentValue,
  editable,
  onChange,
  parse,
}: {
  currentValue: unknown;
  editable: boolean;
  onChange: (v: unknown) => void | Promise<void>;
  parse: (s: string) => unknown;
}): React.ReactElement {
  const [draft, setDraft] = React.useState<string>(currentValue == null ? "" : String(currentValue));
  React.useEffect(() => {
    setDraft(currentValue == null ? "" : String(currentValue));
  }, [currentValue]);
  const dirty = draft !== (currentValue == null ? "" : String(currentValue));
  const commit = () => {
    if (!dirty) return;
    const v = parse(draft);
    if (v !== undefined) void onChange(v);
  };
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") setDraft(currentValue == null ? "" : String(currentValue));
        }}
        disabled={!editable}
        className={cn(
          "flex-1 h-7 px-2 rounded-sm bg-paper-2 border border-line text-[12.5px] font-mono",
          "focus:outline-none focus:border-accent/60 focus:ring-accent-soft",
          !editable && "opacity-50 cursor-not-allowed"
        )}
        placeholder="(unset)"
      />
      {dirty && editable ? (
        <button
          type="button"
          onClick={commit}
          className="h-7 px-2 rounded-sm bg-accent text-[var(--accent-contrast)] text-[11px] font-mono"
        >
          ↵ apply
        </button>
      ) : null}
    </div>
  );
}

function TabTrigger({
  value,
  icon: Icon,
  children,
}: {
  value: string;
  icon: React.ComponentType<any>;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Tabs.Trigger
      value={value}
      className={cn(
        "flex items-center gap-1.5 h-9 px-3 text-[12.5px] font-medium text-ink-2 border-b-2 border-transparent -mb-px",
        "data-[state=active]:text-ink-0 data-[state=active]:border-accent transition-colors",
        "focus-visible:outline-none focus-visible:bg-paper-2"
      )}
    >
      <Icon size={12} />
      {children}
    </Tabs.Trigger>
  );
}

function kindLabel(kind: any): string {
  if (!kind) return "?";
  if (kind.type === "literal-union") return kind.options.map((o: any) => JSON.stringify(o)).join(" | ");
  if (kind.type === "token-reference") return `token<${kind.group}>`;
  if (kind.type === "react-node") return "ReactNode";
  if (kind.type === "callback") return kind.signature ?? "(…) => void";
  if (kind.type === "unsupported") return `unknown(${kind.raw})`;
  return String(kind.type);
}

function SlotInfo({ slots }: { slots: any }): React.ReactElement {
  if (slots.kind === "none") return <p className="text-[12.5px] text-ink-2">No children allowed.</p>;
  if (slots.kind === "text-only") return <p className="text-[12.5px] text-ink-2">Text children only.</p>;
  if (slots.kind === "components") return (
    <p className="text-[12.5px] text-ink-2">
      Accepts component children
      {slots.allowedComponents ? `: ${slots.allowedComponents.join(", ")}` : "."}
    </p>
  );
  if (slots.kind === "named-slots") return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12.5px] text-ink-2">Named slots:</p>
      {Object.keys(slots.slots).map((name) => (
        <Pill key={name} tone="neutral">{name}</Pill>
      ))}
    </div>
  );
  return <pre className="text-[11px] font-mono text-ink-2">{JSON.stringify(slots, null, 2)}</pre>;
}

function DrawerSkeleton({ componentId }: { componentId: string }): React.ReactElement {
  return (
    <div className="flex-1 p-4">
      <div className="text-[11px] font-mono text-ink-3 truncate">{componentId}</div>
      <div className="h-6 w-1/2 mt-3 rounded bg-paper-2 animate-pulse" />
      <div className="h-3 w-1/3 mt-2 rounded bg-paper-2 animate-pulse" />
      <div className="h-20 mt-4 rounded bg-paper-2 animate-pulse" />
    </div>
  );
}
