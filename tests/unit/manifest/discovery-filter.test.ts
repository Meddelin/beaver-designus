import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  discoverPackages,
  discoverSymbols,
  isLikelyComponentName,
} from "../../../packages/manifest/src/scan/discovery.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("isLikelyComponentName — name-based filter", () => {
  it("accepts PascalCase component names", () => {
    for (const n of ["Button", "SideNavigation", "PageShell", "CardGrid"]) {
      expect(isLikelyComponentName(n)).toBe(true);
    }
  });

  it("rejects hooks and factories (lowercase-starting)", () => {
    for (const n of ["useButton", "useBottomSheetFloatingContainerContext", "createButton", "withClickable"]) {
      expect(isLikelyComponentName(n)).toBe(false);
    }
  });

  it("rejects SCREAMING_SNAKE_CASE constants", () => {
    for (const n of ["CELL_AVATAR_SIZE_MAP", "ANIMATION_PRESETS", "SPACING_ALIAS"]) {
      expect(isLikelyComponentName(n)).toBe(false);
    }
  });

  it("rejects Context-suffixed exports", () => {
    expect(isLikelyComponentName("ToggleLabelContext")).toBe(false);
    expect(isLikelyComponentName("ModalSizeContextValue")).toBe(false);
  });

  it("rejects utility-suffixed exports", () => {
    expect(isLikelyComponentName("SizeMap")).toBe(false);
    expect(isLikelyComponentName("StringHelpers")).toBe(false);
    expect(isLikelyComponentName("DateUtils")).toBe(false);
  });

  it("handles empty / weird strings gracefully", () => {
    expect(isLikelyComponentName("")).toBe(false);
    expect(isLikelyComponentName("$weird")).toBe(false);
  });
});

const ROOT = join(tmpdir(), `bd-discovery-filter-${Date.now()}`);

beforeAll(() => {
  const pkgRoot = join(ROOT, "packages", "kit");
  const src = join(pkgRoot, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(
    join(pkgRoot, "package.json"),
    JSON.stringify({ name: "@x/kit", main: "src/index.ts" })
  );
  writeFileSync(
    join(src, "index.ts"),
    `export { Button } from "./button";
export { useButton } from "./button";
export { createButton } from "./button";
export { ButtonProps } from "./button";
export type { ButtonVariant } from "./button";
export { BUTTON_SIZES } from "./button";
export { ButtonContext } from "./button";
`
  );
  writeFileSync(
    join(src, "button.ts"),
    `import * as React from "react";

export interface ButtonProps { kind: "primary" | "secondary" }
export type ButtonVariant = "a" | "b";
export const BUTTON_SIZES = ["s", "m", "l"] as const;
export const ButtonContext = React.createContext(null);
export function useButton() { return {}; }
export function createButton<P>(useHook: () => P) { return (props: P) => null; }
export const Button = (_props: ButtonProps) => null;
`
  );
});

afterAll(() => {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

describe("discoverSymbols — filters non-components", () => {
  it("returns only PascalCase value exports that aren't type-only", () => {
    const pkgs = discoverPackages(ROOT, "packages");
    const pkg = pkgs.find((p) => p.name === "@x/kit")!;
    const symbols = discoverSymbols(pkg);
    const names = symbols.map((s) => s.exportName);
    expect(names).toEqual(["Button"]);
    expect(names).not.toContain("useButton");
    expect(names).not.toContain("createButton");
    expect(names).not.toContain("ButtonProps");
    expect(names).not.toContain("ButtonVariant");
    expect(names).not.toContain("BUTTON_SIZES");
    expect(names).not.toContain("ButtonContext");
  });
});
