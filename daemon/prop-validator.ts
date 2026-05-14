// Defense-in-depth backstop (§4.2). The CLI's tool-use validator enforces the
// inputSchema enum; this is a server-side re-check that catches shape errors
// the enum can't see — e.g. wrong-type literal for a literal-union, value
// outside variants for a token-reference, required-missing.
//
// Exported as a standalone module so it can be unit-tested without the HTTP
// surface (and reused if/when a setProp-equivalent grows elsewhere).

import type { JsonValue, ManifestEntry, PropEntry } from "../shared/types.ts";

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
    if (p.required && !(p.name in out)) {
      return { ok: false, error: `missing required prop ${p.name} on ${entry.id}` };
    }
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
  return { ok: true };
}
