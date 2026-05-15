import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { extractComponent } from "../../../packages/manifest/src/props/extract.ts";
import type { PropShape } from "../../../shared/types.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// P1 — deep prop-shape extraction. The real T-Bank SimpleTable: generic,
// props interface in a sibling file, behind a barrel, extends a DS-local
// base, wrapped in PropsWithChildren. Before P1 the manifest emitted
// `props: []` / `unsupported`; now it must emit a precise recursive shape
// the agent can synthesize valid data from.
const ROOT = join(tmpdir(), `bd-shape-${Date.now()}`);

function find(props: { name: string; shape?: PropShape }[], n: string) {
  return props.find((p) => p.name === n);
}

beforeAll(() => {
  mkdirSync(ROOT, { recursive: true });

  writeFileSync(
    join(ROOT, "base.ts"),
    `export interface WithTestId { testId?: string }`
  );

  writeFileSync(
    join(ROOT, "types.ts"),
    `import { WithTestId } from "./base";
import type * as React from "react";

export interface Column<T> {
  accessorKey: keyof T;
  header: string;
  width?: number;
  cell?: (row: T) => React.ReactNode;
}

export type Density = "s" | "m" | "l";

export interface SimpleTableProps<T> extends WithTestId {
  columns: Column<T>[];
  data: T[];
  density?: Density;
  pageSize?: number;
  selectable?: boolean;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  meta?: Record<string, string>;
}
`
  );

  writeFileSync(join(ROOT, "index.ts"), `export * from "./types";\nexport * from "./base";`);

  writeFileSync(
    join(ROOT, "SimpleTable.tsx"),
    `import type { PropsWithChildren } from "react";
import { SimpleTableProps } from "./index";
export function SimpleTable<T>(props: PropsWithChildren<SimpleTableProps<T>>) { return null; }
`
  );
});

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

describe("P1 prop-shape — SimpleTable (generic / cross-file / heritage)", () => {
  it("emits a precise recursive shape for array-of-object props", () => {
    const ex = extractComponent(join(ROOT, "SimpleTable.tsx"), "SimpleTable")!;
    expect(ex).not.toBeNull();

    const columns = find(ex.props, "columns")!;
    expect(columns.required).toBe(true);
    expect(columns.shape?.t).toBe("array");
    const el = (columns.shape as Extract<PropShape, { t: "array" }>).element;
    expect(el.t).toBe("object");
    const fieldNames = (el as Extract<PropShape, { t: "object" }>).fields.map((f) => f.name).sort();
    expect(fieldNames).toEqual(["accessorKey", "cell", "header", "width"]);
    const obj = el as Extract<PropShape, { t: "object" }>;
    expect(obj.fields.find((f) => f.name === "header")!.shape).toEqual({ t: "string" });
    expect(obj.fields.find((f) => f.name === "width")!.optional).toBe(true);
    expect(obj.fields.find((f) => f.name === "cell")!.shape.t).toBe("function");
  });

  it("keeps generic element props (data: T[]) as array with a degraded element", () => {
    const ex = extractComponent(join(ROOT, "SimpleTable.tsx"), "SimpleTable")!;
    const data = find(ex.props, "data")!;
    expect(data.required).toBe(true);
    expect(data.shape?.t).toBe("array"); // element is ref/unknown (T) — acceptable
  });

  it("models enums, primitives, records and merged heritage", () => {
    const ex = extractComponent(join(ROOT, "SimpleTable.tsx"), "SimpleTable")!;
    expect(find(ex.props, "density")!.shape).toEqual({ t: "enum", options: ["s", "m", "l"] });
    expect(find(ex.props, "pageSize")!.shape).toEqual({ t: "number" });
    expect(find(ex.props, "selectable")!.shape).toEqual({ t: "boolean" });
    expect(find(ex.props, "meta")!.shape).toEqual({ t: "record", value: { t: "string" } });
    // testId comes from the DS-local base via `extends`.
    expect(find(ex.props, "testId")!.shape).toEqual({ t: "string" });
    // onRowClick is a callback → function shape (not a slot, not unknown).
    expect(find(ex.props, "onRowClick")!.shape).toEqual({ t: "function", arity: 1 });
  });

  it("does not flood shape with DOM attributes for HTML-extending props", () => {
    writeFileSync(
      join(ROOT, "Box.tsx"),
      `import type * as React from "react";
export interface BoxProps extends React.HTMLAttributes<HTMLDivElement> { pad: number }
export function Box(props: BoxProps) { return null; }
`
    );
    const ex = extractComponent(join(ROOT, "Box.tsx"), "Box")!;
    expect(ex.props.map((p) => p.name)).toEqual(["pad"]);
    expect(find(ex.props, "pad")!.shape).toEqual({ t: "number" });
  });
});
