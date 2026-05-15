import { describe, it, expect } from "vitest";
import { validateProps, placeholderFromShape } from "../../../daemon/prop-validator.ts";
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

describe("P4 — placeholderFromShape", () => {
  it("synthesizes minimal valid values", () => {
    expect(placeholderFromShape({ t: "array", element: { t: "string" } })).toEqual([]);
    expect(placeholderFromShape({ t: "enum", options: ["a", "b"] })).toBe("a");
    expect(
      placeholderFromShape({
        t: "object",
        fields: [
          { name: "id", optional: false, shape: { t: "number" } },
          { name: "x", optional: true, shape: { t: "string" } },
        ],
      })
    ).toEqual({ id: 0 });
  });
  it("returns undefined for un-synthesizable shapes", () => {
    expect(placeholderFromShape({ t: "function", arity: 1 })).toBeUndefined();
    expect(placeholderFromShape({ t: "react-node" })).toBeUndefined();
    expect(placeholderFromShape(undefined)).toBeUndefined();
  });
});

describe("P4 — missing required prop degrades to a shape placeholder", () => {
  it("assembles the node (ok:true) and records the defaulting", () => {
    const columns: PropEntry = {
      name: "columns",
      kind: { type: "unsupported", raw: "Column[]" },
      shape: { t: "array", element: { t: "object", fields: [] } },
      required: true,
      description: "",
    };
    const r = validateProps(entry([columns]), {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.props.columns).toEqual([]);
      expect(r.rejected.some((x) => x.name === "columns" && /defaulted from shape/.test(x.reason))).toBe(true);
    }
  });

  it("still hard-fails a missing required prop with NO shape (back-compat)", () => {
    const r = validateProps(
      entry([{ name: "title", kind: { type: "string" }, required: true, description: "" }]),
      {}
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/missing required prop title/);
  });
});
