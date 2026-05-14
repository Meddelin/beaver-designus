import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { extractComponent } from "../../../packages/manifest/src/props/extract.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(tmpdir(), `bd-hoc-extraction-${Date.now()}`);

beforeAll(() => {
  mkdirSync(ROOT, { recursive: true });

  // forwardComponent<TElement, TProps> — Beaver pattern. Props live in a
  // sibling interface named ButtonProps that the extractor must dereference.
  writeFileSync(
    join(ROOT, "Button.tsx"),
    `import { forwardComponent } from "@beaver-ui/core";

export interface ButtonProps {
  appearance: "primary" | "secondary" | "flat";
  size?: "s" | "m" | "l";
  disabled?: boolean;
}

export const Button = forwardComponent<"button", ButtonProps>((props, ref) => {
  return null;
});
`
  );

  // createComponent<TProps>(useHook) — react-ui-kit factory pattern.
  writeFileSync(
    join(ROOT, "Checkbox.tsx"),
    `import { createCheckbox } from "@tui-react/core";

export interface CheckboxProps {
  checked: boolean;
  label?: string;
}

export const Checkbox = createCheckbox<CheckboxProps>(useCheckboxHook);
`
  );

  // const Foo: React.FC<Props> = (...) => ... — type-annotation pattern.
  writeFileSync(
    join(ROOT, "Annotated.tsx"),
    `import * as React from "react";

export interface AnnotatedProps {
  value: string;
}

export const Annotated: React.FC<AnnotatedProps> = (props) => null;
`
  );

  // type-alias-based props (not interface) — to confirm we dereference TypeAliasDeclaration too.
  writeFileSync(
    join(ROOT, "AliasedProps.tsx"),
    `export type AliasedPropsT = { kind: "a" | "b"; count: number };

export const Aliased = (props: AliasedPropsT) => null;
`
  );

  // No props at all — extractor must not crash, must return empty array.
  writeFileSync(
    join(ROOT, "NoProps.tsx"),
    `export const NoProps = () => null;
`
  );
});

afterAll(() => {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

describe("locatePropsTypeNode — HOC + dereference", () => {
  it("extracts props from forwardComponent<E, Props>(cb)", () => {
    const c = extractComponent(join(ROOT, "Button.tsx"), "Button");
    expect(c).not.toBeNull();
    expect(c!.props).toHaveLength(3);
    const appearance = c!.props.find((p) => p.name === "appearance")!;
    expect(appearance.kind.type).toBe("literal-union");
    if (appearance.kind.type === "literal-union") {
      expect(appearance.kind.options).toEqual(["primary", "secondary", "flat"]);
    }
    const disabled = c!.props.find((p) => p.name === "disabled")!;
    expect(disabled.kind.type).toBe("boolean");
    expect(disabled.required).toBe(false);
  });

  it("extracts props from createXxx<Props>(hook) factory pattern", () => {
    const c = extractComponent(join(ROOT, "Checkbox.tsx"), "Checkbox");
    expect(c).not.toBeNull();
    expect(c!.props).toHaveLength(2);
    expect(c!.props.find((p) => p.name === "checked")!.kind.type).toBe("boolean");
  });

  it("extracts props from `const X: React.FC<Props>` variable annotation", () => {
    const c = extractComponent(join(ROOT, "Annotated.tsx"), "Annotated");
    expect(c).not.toBeNull();
    expect(c!.props).toHaveLength(1);
    expect(c!.props[0].name).toBe("value");
  });

  it("dereferences type-alias-shaped props (AliasedPropsT, not ending in Props)", () => {
    const c = extractComponent(join(ROOT, "AliasedProps.tsx"), "Aliased");
    expect(c).not.toBeNull();
    expect(c!.props).toHaveLength(2);
    const kind = c!.props.find((p) => p.name === "kind")!;
    expect(kind.kind.type).toBe("literal-union");
  });

  it("returns empty props (not null) for a component with no props parameter", () => {
    const c = extractComponent(join(ROOT, "NoProps.tsx"), "NoProps");
    expect(c).not.toBeNull();
    expect(c!.props).toEqual([]);
  });
});
