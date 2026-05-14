import { describe, it, expect } from "vitest";
import { validateProps, checkKind } from "../../../daemon/prop-validator.ts";
import type { ManifestEntry } from "../../../shared/types.ts";

function entry(props: ManifestEntry["props"]): ManifestEntry {
  return {
    id: "test:pkg/Comp",
    sourceSystem: "test",
    category: "atom",
    name: "Comp",
    packageName: "pkg",
    exportName: "Comp",
    description: "",
    props,
    slots: { kind: "none" },
    examples: [],
    tags: [],
  };
}

const TOKENS = {
  groups: {
    "color.brand": {
      variants: [{ name: "primary" }, { name: "secondary" }],
    },
  },
};

describe("validateProps (MCP backstop)", () => {
  it("rejects an unknown prop key", () => {
    const r = validateProps(entry([{ name: "x", kind: { type: "string" }, required: false, description: "" }]), {
      y: "oops",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown prop y/);
  });

  it("rejects a missing required prop", () => {
    const r = validateProps(entry([{ name: "title", kind: { type: "string" }, required: true, description: "" }]), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/missing required prop title/);
  });

  it("rejects a wrong-type for a required prop", () => {
    const r = validateProps(
      entry([{ name: "count", kind: { type: "number" }, required: true, description: "" }]),
      { count: "not-a-number" as any }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/expected number/);
  });

  it("drops a wrong-type for an optional prop and reports it", () => {
    const r = validateProps(
      entry([{ name: "size", kind: { type: "number" }, required: false, description: "" }]),
      { size: "huge" as any }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.props.size).toBeUndefined();
      expect(r.rejected).toHaveLength(1);
      expect(r.rejected[0].name).toBe("size");
    }
  });

  it("accepts a value in a literal-union", () => {
    const r = validateProps(
      entry([
        {
          name: "tone",
          kind: { type: "literal-union", options: ["neutral", "danger"] },
          required: false,
          description: "",
        },
      ]),
      { tone: "danger" }
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.props.tone).toBe("danger");
  });

  it("rejects a value outside the literal-union", () => {
    const r = validateProps(
      entry([
        {
          name: "tone",
          kind: { type: "literal-union", options: ["neutral", "danger"] },
          required: true,
          description: "",
        },
      ]),
      { tone: "fuchsia" as any }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not in union/);
  });
});

describe("checkKind — token-reference", () => {
  const prop = {
    name: "color",
    kind: { type: "token-reference" as const, group: "color.brand" },
    required: false,
    description: "",
  };

  it("accepts a known variant", () => {
    expect(checkKind(prop, "primary", TOKENS).ok).toBe(true);
  });

  it("rejects an unknown variant", () => {
    const r = checkKind(prop, "neon-pink", TOKENS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not in token group color\.brand/);
  });

  it("rejects non-string value", () => {
    const r = checkKind(prop, 42 as any, TOKENS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/variant name/);
  });

  it("passes through when tokens manifest is unavailable", () => {
    expect(checkKind(prop, "anything", undefined).ok).toBe(true);
  });
});
