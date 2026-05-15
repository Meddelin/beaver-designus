// Defense-in-depth backstop (§4.2). The CLI's tool-use validator enforces the
// inputSchema enum; this is a server-side re-check that catches shape errors
// the enum can't see — e.g. wrong-type literal for a literal-union, value
// outside variants for a token-reference, required-missing.
//
// Exported as a standalone module so it can be unit-tested without the HTTP
// surface (and reused if/when a setProp-equivalent grows elsewhere).

import type { JsonValue, ManifestEntry, PropEntry, PropShape } from "../shared/types.ts";

/* Lenient structural check against the P1 PropShape. Deliberately permissive:
 * it only catches a *category* mismatch (a string where an array/object is
 * required, etc.) so realistic story args and generic-degraded shapes pass.
 * Extra object keys are allowed, optional/missing fields ignored, and
 * function / react-node / ref / unknown / record always pass. This runs
 * only where `kind` is too coarse to judge (kind.type === "unsupported").
 */
export function checkShape(
  shape: PropShape | undefined,
  v: JsonValue,
  depth = 0
): { ok: true } | { ok: false; error: string } {
  if (!shape || depth > 5) return { ok: true };
  switch (shape.t) {
    case "string":
      return typeof v === "string" ? { ok: true } : { ok: false, error: `expected string, got ${typeofJson(v)}` };
    case "number":
      return typeof v === "number" ? { ok: true } : { ok: false, error: `expected number, got ${typeofJson(v)}` };
    case "boolean":
      return typeof v === "boolean" ? { ok: true } : { ok: false, error: `expected boolean, got ${typeofJson(v)}` };
    case "literal":
      return v === shape.value ? { ok: true } : { ok: false, error: `expected ${JSON.stringify(shape.value)}` };
    case "enum":
      return shape.options.some((o) => o === v)
        ? { ok: true }
        : { ok: false, error: `not in [${shape.options.map((o) => JSON.stringify(o)).join(", ")}]` };
    case "array":
    case "tuple": {
      if (!Array.isArray(v)) return { ok: false, error: `expected array, got ${typeofJson(v)}` };
      // Validate the first element only — enough to catch a wrong-shape
      // dataset without rejecting large realistic ones or T-degraded elems.
      if (shape.t === "array" && v.length > 0) return checkShape(shape.element, v[0], depth + 1);
      return { ok: true };
    }
    case "object":
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        return { ok: false, error: `expected object, got ${typeofJson(v)}` };
      }
      return { ok: true }; // shallow — don't over-enforce nested required fields
    case "union": {
      for (const variant of shape.variants) {
        if (checkShape(variant, v, depth + 1).ok) return { ok: true };
      }
      return { ok: false, error: "no union variant matched" };
    }
    default:
      return { ok: true }; // record | function | react-node | ref | unknown
  }
}

function typeofJson(v: JsonValue): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/* Minimal valid value from a shape — used as a fallback so a node with a
 * missing required prop still ASSEMBLES (e.g. empty table) instead of the
 * tool call hard-failing and the agent flailing. Returns undefined when we
 * can't responsibly synthesize (function/react-node/ref/unknown). Mirrors
 * the builder's synthesizer; kept daemon-local to avoid a cross-package
 * import. */
export function placeholderFromShape(shape: PropShape | undefined, depth = 0): JsonValue | undefined {
  if (!shape || depth > 5) return undefined;
  switch (shape.t) {
    case "string": return "";
    case "number": return 0;
    case "boolean": return false;
    case "literal": return shape.value;
    case "enum": return shape.options[0];
    case "array": return [];
    case "tuple": return shape.items.map((s) => placeholderFromShape(s, depth + 1) ?? null);
    case "record": return {};
    case "union": return placeholderFromShape(shape.variants[0], depth + 1);
    case "object": {
      const out: { [k: string]: JsonValue } = {};
      for (const f of shape.fields) {
        if (f.optional) continue;
        const v = placeholderFromShape(f.shape, depth + 1);
        if (v !== undefined) out[f.name] = v;
      }
      return out;
    }
    default:
      return undefined;
  }
}

export type TokensManifest = {
  groups?: Record<string, { variants: Array<{ name: string }> }>;
};

export type ValidateResult =
  | { ok: true; props: Record<string, JsonValue>; rejected: Array<{ name: string; reason: string }> }
  | { ok: false; error: string };

export function validateProps(
  entry: ManifestEntry,
  propsIn: Record<string, JsonValue>,
  tokens?: TokensManifest
): ValidateResult {
  const byName = new Map<string, PropEntry>();
  for (const p of entry.props) byName.set(p.name, p);

  for (const k of Object.keys(propsIn)) {
    if (!byName.has(k)) {
      return {
        ok: false,
        error: `unknown prop ${k} on ${entry.id}; allowed: ${[...byName.keys()].join(",")}`,
      };
    }
  }

  const out: Record<string, JsonValue> = {};
  const rejected: Array<{ name: string; reason: string }> = [];

  for (const [k, v] of Object.entries(propsIn)) {
    const prop = byName.get(k)!;
    const r = checkKind(prop, v, tokens);
    if (r.ok) {
      out[k] = v;
    } else {
      rejected.push({ name: k, reason: r.error });
      if (prop.required) {
        return { ok: false, error: `prop ${k} on ${entry.id}: ${r.error} (and required)` };
      }
    }
  }

  for (const p of entry.props) {
    if (!p.required || p.name in out) continue;
    // Missing required prop: synthesize a minimal placeholder from the P1
    // shape so the node still assembles (empty list / zeroed object) and
    // the agent can fill the real value next, instead of the whole tool
    // call failing. Only hard-fail when we genuinely can't synthesize.
    const ph = placeholderFromShape(p.shape);
    if (ph === undefined) {
      return { ok: false, error: `missing required prop ${p.name} on ${entry.id}` };
    }
    out[p.name] = ph;
    rejected.push({ name: p.name, reason: "required but missing — defaulted from shape" });
  }

  return { ok: true, props: out, rejected };
}

export function checkKind(
  prop: PropEntry,
  v: JsonValue,
  tokens?: TokensManifest
): { ok: true } | { ok: false; error: string } {
  const k = prop.kind;
  if (k.type === "literal-union") {
    if (k.options.some((o) => o === v)) return { ok: true };
    return {
      ok: false,
      error: `value ${JSON.stringify(v)} not in union [${k.options.map((o) => JSON.stringify(o)).join(", ")}]`,
    };
  }
  if (k.type === "string") {
    if (typeof v === "string") return { ok: true };
    return { ok: false, error: `expected string, got ${typeof v}` };
  }
  if (k.type === "number") {
    if (typeof v === "number" && Number.isFinite(v)) return { ok: true };
    return { ok: false, error: `expected number, got ${typeof v}` };
  }
  if (k.type === "boolean") {
    if (typeof v === "boolean") return { ok: true };
    return { ok: false, error: `expected boolean, got ${typeof v}` };
  }
  if (k.type === "react-node") {
    return { ok: true };
  }
  if (k.type === "token-reference") {
    const group = tokens?.groups?.[k.group];
    if (!group) return { ok: true }; // tokens missing → don't block
    if (typeof v !== "string") {
      return { ok: false, error: `token-reference expects variant name (string), got ${typeof v}` };
    }
    if (group.variants.some((vt) => vt.name === v)) return { ok: true };
    return {
      ok: false,
      error: `value ${JSON.stringify(v)} not in token group ${k.group} variants [${group.variants.map((vt) => vt.name).join(", ")}]`,
    };
  }
  // k.type === "unsupported": `kind` can't judge object/array props — defer
  // to the (lenient) structural shape check when P1 gave us one.
  return checkShape(prop.shape, v);
}
