import { describe, it, expect } from "vitest";
import { validateProps, checkShape } from "../../../daemon/prop-validator.ts";
import type { ManifestEntry, PropEntry } from "../../../shared/types.ts";

function entry(props: PropEntry[]): ManifestEntry {
  return {
    id: "test:pkg/Table",
    sourceSystem: "test",
    category: "organism",
    name: "Table",
    packageName: "pkg",
    exportName: "Table",
    description: "",
    props,
    slots: { kind: "none" },
    examples: [],
    tags: [],
  };
}

// A typical structured prop the legacy `kind` couldn't judge (unsupported),
// now backed by a P1 shape.
const columns: PropEntry = {
  name: "columns",
  kind: { type: "unsupported", raw: "Column[]" },
  shape: {
    t: "array",
    element: {
      t: "object",
      fields: [
        { name: "accessorKey", optional: false, shape: { t: "string" } },
        { name: "header", optional: false, shape: { t: "string" } },
      ],
    },
  },
  required: true,
  description: "",
};

describe("P3 — lenient structural shape validation", () => {
  it("accepts a well-formed array-of-object value", () => {
    const r = validateProps(entry([columns]), {
      columns: [{ accessorKey: "name", header: "Name" }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a gross category mismatch on a required structured prop", () => {
    const r = validateProps(entry([columns]), { columns: "oops" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/columns/);
  });

  it("is lenient: extra object keys and large arrays pass", () => {
    expect(
      checkShape(columns.shape, [
        { accessorKey: "a", header: "A", extra: 1 },
        { accessorKey: "b", header: "B" },
      ]).ok
    ).toBe(true);
  });

  it("treats function / react-node / ref / unknown / record shapes as pass", () => {
    expect(checkShape({ t: "function", arity: 1 }, "anything").ok).toBe(true);
    expect(checkShape({ t: "react-node" }, 42).ok).toBe(true);
    expect(checkShape({ t: "ref", name: "T" }, { a: 1 }).ok).toBe(true);
    expect(checkShape({ t: "record", value: { t: "string" } }, { x: "y" }).ok).toBe(true);
    expect(checkShape(undefined, [1, 2, 3]).ok).toBe(true);
  });

  it("validates enums and primitives structurally", () => {
    expect(checkShape({ t: "enum", options: ["s", "m", "l"] }, "m").ok).toBe(true);
    expect(checkShape({ t: "enum", options: ["s", "m", "l"] }, "xl").ok).toBe(false);
    expect(checkShape({ t: "number" }, "3").ok).toBe(false);
  });

  it("does not regress well-defined kinds (literal-union still enforced)", () => {
    const size: PropEntry = {
      name: "size",
      kind: { type: "literal-union", options: ["s", "m"] },
      shape: { t: "enum", options: ["s", "m"] },
      required: false,
      description: "",
    };
    const ok = validateProps(entry([size]), { size: "m" });
    expect(ok.ok).toBe(true);
    const bad = validateProps(entry([size]), { size: "xl" });
    // non-required + kind mismatch → rejected list, not hard fail
    if (bad.ok) expect(bad.rejected.some((x) => x.name === "size")).toBe(true);
  });
});
