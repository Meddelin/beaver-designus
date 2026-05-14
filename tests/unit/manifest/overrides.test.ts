import { describe, it, expect } from "vitest";
import { applyOverride } from "../../../packages/manifest/src/overrides.ts";
import type { ManifestEntry } from "../../../packages/manifest/src/types.ts";

function makeEntry(): ManifestEntry {
  return {
    id: "beaver:@beaver-ui/card/Card",
    sourceSystem: "beaver",
    category: "organism",
    name: "Card",
    packageName: "@beaver-ui/card",
    exportName: "Card",
    description: "from extractor",
    props: [
      { name: "title", kind: { type: "string" }, required: true, description: "" },
      { name: "tone", kind: { type: "string" }, required: false, description: "" },
    ],
    slots: { kind: "none" },
    examples: [],
    tags: [],
  };
}

describe("applyOverride", () => {
  it("returns the entry unchanged when no override matches", () => {
    const base = makeEntry();
    const out = applyOverride(base, {});
    expect(out).toBe(base);
  });

  it("top-level fields are shallow-merged (override wins)", () => {
    const base = makeEntry();
    const out = applyOverride(base, {
      [base.id]: { id: base.id, description: "patched", category: "atom" },
    });
    expect(out.description).toBe("patched");
    expect(out.category).toBe("atom");
    expect(out.name).toBe("Card");
  });

  it("props array is deep-merged by name — patch single prop kind", () => {
    const base = makeEntry();
    const out = applyOverride(base, {
      [base.id]: {
        id: base.id,
        props: [{ name: "tone", kind: { type: "token-reference", group: "color.brand" } } as any],
      },
    });
    expect(out.props).toHaveLength(2);
    const tone = out.props.find((p) => p.name === "tone")!;
    expect(tone.kind.type).toBe("token-reference");
    if (tone.kind.type === "token-reference") expect(tone.kind.group).toBe("color.brand");
    // Other prop preserved
    expect(out.props.find((p) => p.name === "title")!.required).toBe(true);
  });

  it("override props can ADD a new prop the extractor missed", () => {
    const base = makeEntry();
    const out = applyOverride(base, {
      [base.id]: {
        id: base.id,
        props: [
          { name: "ariaLabel", kind: { type: "string" }, required: false, description: "a11y" } as any,
        ],
      },
    });
    expect(out.props.find((p) => p.name === "ariaLabel")).toBeTruthy();
  });
});
