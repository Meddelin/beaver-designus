import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { extractComponent, inferSlotPolicy } from "../../../packages/manifest/src/props/extract.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Reproduces the real T-Bank `SimpleTable` failure: a generic component
// whose props interface lives in a SIBLING file, extends a DS-local base,
// and is re-exported through a barrel. Before the cross-file resolver the
// manifest emitted `props: []` here → the agent never knew `columns`/`data`
// were required → the component crashed at render. These tests lock in
// that the required props are now recovered WITHOUT any hand-authoring.
const ROOT = join(tmpdir(), `bd-crossfile-${Date.now()}`);

beforeAll(() => {
  mkdirSync(ROOT, { recursive: true });

  // DS-local base props in their own file.
  writeFileSync(
    join(ROOT, "base.ts"),
    `export interface WithTestId {
  /** Stable selector for e2e. */
  testId?: string;
}
`
  );

  // The real props interface — generic, extends a local base, lives apart
  // from the component. Also a ReactNode slot to exercise inferSlotPolicy.
  writeFileSync(
    join(ROOT, "types.ts"),
    `import { WithTestId } from "./base";
import type * as React from "react";

export interface Column<T> {
  accessorKey: keyof T;
  headerCell: React.ReactNode;
}

export interface SimpleTableProps<T> extends WithTestId {
  /** Column definitions. */
  columns: Column<T>[];
  /** Row data. */
  data: T[];
  caption?: string;
  emptyState?: React.ReactNode;
}
`
  );

  // Barrel re-export — component imports the type THROUGH this.
  writeFileSync(
    join(ROOT, "index.ts"),
    `export * from "./types";
export * from "./base";
`
  );

  // The component: generic, props type imported via the barrel, wrapped in
  // PropsWithChildren — every layer that previously defeated extraction.
  writeFileSync(
    join(ROOT, "SimpleTable.tsx"),
    `import type { PropsWithChildren } from "react";
import { SimpleTableProps } from "./index";

export function SimpleTable<T>(props: PropsWithChildren<SimpleTableProps<T>>) {
  return null;
}
`
  );
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("cross-file / generic / heritage props resolution (SimpleTable case)", () => {
  it("recovers required props from a sibling, barrel-re-exported, generic props type", () => {
    const ex = extractComponent(join(ROOT, "SimpleTable.tsx"), "SimpleTable");
    expect(ex).not.toBeNull();
    const byName = Object.fromEntries(ex!.props.map((p) => [p.name, p]));

    // The two props whose absence crashed the real component.
    expect(byName.columns).toBeDefined();
    expect(byName.columns.required).toBe(true);
    expect(byName.data).toBeDefined();
    expect(byName.data.required).toBe(true);

    // Optional props stay optional.
    expect(byName.caption.required).toBe(false);

    // Heritage from the DS-local base interface is merged in.
    expect(byName.testId).toBeDefined();
    expect(byName.testId.required).toBe(false);
  });

  it("detects the ReactNode prop as a named slot through the same chain", () => {
    const policy = inferSlotPolicy(join(ROOT, "SimpleTable.tsx"), "SimpleTable", "none");
    expect(policy.kind).toBe("named-slots");
    if (policy.kind === "named-slots") {
      expect(Object.keys(policy.slots)).toContain("emptyState");
    }
  });

  it("does not flood props with DOM attributes when extending an HTML base", () => {
    writeFileSync(
      join(ROOT, "Input.tsx"),
      `import type * as React from "react";
export interface InputProps extends React.HTMLAttributes<HTMLInputElement> {
  value: string;
}
export function Input(props: InputProps) { return null; }
`
    );
    const ex = extractComponent(join(ROOT, "Input.tsx"), "Input");
    const names = ex!.props.map((p) => p.name);
    expect(names).toContain("value");
    // HTMLAttributes is in HERITAGE_SKIP → not expanded.
    expect(names).not.toContain("onClick");
    expect(names.length).toBeLessThan(5);
  });
});
