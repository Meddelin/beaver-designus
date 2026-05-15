import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractStoryArgs } from "../../../packages/manifest/src/docs/storybook.ts";
import { findJsxUsage } from "../../../packages/manifest/src/docs/mdx.ts";
import {
  parseExprToJson,
  synthesizeFromShape,
  buildUsage,
} from "../../../packages/manifest/src/docs/usage.ts";
import type { PropEntry } from "../../../shared/types.ts";

const ROOT = join(tmpdir(), `bd-usage-${Date.now()}`);

beforeAll(() => {
  mkdirSync(join(ROOT, "csf3"), { recursive: true });
  mkdirSync(join(ROOT, "csf2"), { recursive: true });
  mkdirSync(join(ROOT, "mdx"), { recursive: true });

  // CSF3 with args + a non-representable callback (must be dropped).
  writeFileSync(
    join(ROOT, "csf3", "SimpleTable.stories.tsx"),
    `import { SimpleTable } from "./SimpleTable";
const meta = { title: "Data/SimpleTable", component: SimpleTable };
export default meta;
export const Empty = { args: {} };
export const Default = {
  args: {
    columns: [{ accessorKey: "name", header: "Name" }, { accessorKey: "age", header: "Age" }],
    data: [{ name: "Ann", age: 30 }, { name: "Bob", age: 25 }],
    density: "m",
    onRowClick: (row) => console.log(row),
  },
};
`
  );

  // CSF2: Default.args = {...}
  writeFileSync(
    join(ROOT, "csf2", "Badge.stories.tsx"),
    `import { Badge } from "./Badge";
export default { title: "Badge", component: Badge };
const Template = (args) => <Badge {...args} />;
export const Default = Template.bind({});
Default.args = { label: "New", tone: "positive" };
`
  );

  writeFileSync(
    join(ROOT, "mdx", "Tabs.mdx"),
    `---
title: Tabs
---
# Tabs

<Tabs defaultIndex={1} items={[{ id: "a", label: "A" }]} fitted />
`
  );
});

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

describe("P2 — Storybook CSF args extraction (static)", () => {
  it("picks the Default story over Empty and drops non-JSON values", () => {
    const r = extractStoryArgs(join(ROOT, "csf3"), "SimpleTable")!;
    expect(r).not.toBeNull();
    expect(r.storyId).toBe("Default");
    expect(r.args.columns).toEqual([
      { accessorKey: "name", header: "Name" },
      { accessorKey: "age", header: "Age" },
    ]);
    expect(r.args.data).toEqual([
      { name: "Ann", age: 30 },
      { name: "Bob", age: 25 },
    ]);
    expect(r.args.density).toBe("m");
    expect("onRowClick" in r.args).toBe(false); // arrow fn dropped
  });

  it("handles CSF2 `Story.args = {…}` assignment form", () => {
    const r = extractStoryArgs(join(ROOT, "csf2"), "Badge")!;
    expect(r.storyId).toBe("Default");
    expect(r.args).toEqual({ label: "New", tone: "positive" });
  });
});

describe("P2 — MDX JSX usage extraction (static)", () => {
  it("reads string, expression and boolean-shorthand attributes", () => {
    const u = findJsxUsage(join(ROOT, "mdx", "Tabs.mdx"), "Tabs")!;
    expect(u).not.toBeNull();
    expect(u.defaultIndex).toBe(1);
    expect(u.items).toEqual([{ id: "a", label: "A" }]);
    expect(u.fitted).toBe(true);
  });
});

describe("P2 — parseExprToJson / synthesizeFromShape / buildUsage", () => {
  it("parseExprToJson is static-only", () => {
    expect(parseExprToJson(`[{ a: 1 }, { a: 2 }]`)).toEqual([{ a: 1 }, { a: 2 }]);
    expect(parseExprToJson(`"hi"`)).toBe("hi");
    expect(parseExprToJson(`columnHelper.accessor("x")`)).toBeUndefined();
  });

  it("synthesizes minimal valid values from shape", () => {
    expect(synthesizeFromShape({ t: "string" })).toBe("");
    expect(synthesizeFromShape({ t: "enum", options: ["s", "m"] })).toBe("s");
    expect(synthesizeFromShape({ t: "array", element: { t: "string" } })).toEqual([]);
    expect(
      synthesizeFromShape({
        t: "object",
        fields: [
          { name: "id", optional: false, shape: { t: "number" } },
          { name: "note", optional: true, shape: { t: "string" } },
        ],
      })
    ).toEqual({ id: 0 });
    expect(synthesizeFromShape({ t: "function", arity: 1 })).toBeUndefined();
  });

  it("buildUsage prefers story → mdx → synth, else undefined", () => {
    const props: PropEntry[] = [
      { name: "label", kind: { type: "string" }, shape: { t: "string" }, required: true, description: "" },
    ];
    const story = { storyId: "Default", args: { label: "Hi" } };
    expect(buildUsage("x:y/Z", props, story, null)!.source).toBe("storybook");
    expect(buildUsage("x:y/Z", props, null, { label: "Doc" })!.source).toBe("mdx");
    const synth = buildUsage("x:y/Z", props, null, null)!;
    expect(synth.source).toBe("synthesized");
    expect(synth.tree.props).toEqual({ label: "" });
    const none = buildUsage("x:y/Z", [], null, null);
    expect(none).toBeUndefined();
  });
});
