import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { discoverPackages, discoverSymbols } from "../../../packages/manifest/src/scan/discovery.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(tmpdir(), `bd-export-star-${Date.now()}`);
const PKGS = join(ROOT, "packages");

beforeAll(() => {
  // Create a package whose entry uses `export * from "./button"`, the button
  // submodule itself uses `export * from "./impl"`, and ./impl/index.ts
  // re-exports a typed declaration. We want the manifest to pick up both
  // PrimaryButton (from "./button") and SecondaryButton (from "./impl").
  const pkg = join(PKGS, "ui");
  mkdirSync(join(pkg, "src"), { recursive: true });
  mkdirSync(join(pkg, "src", "button"), { recursive: true });
  mkdirSync(join(pkg, "src", "button", "impl"), { recursive: true });

  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "@x/ui", main: "src/index.ts" })
  );
  writeFileSync(
    join(pkg, "src", "index.ts"),
    `export * from "./button";\n`
  );
  writeFileSync(
    join(pkg, "src", "button", "index.ts"),
    `export const PrimaryButton = (_p: { variant?: "a" | "b" }) => null;\nexport * from "./impl";\n`
  );
  writeFileSync(
    join(pkg, "src", "button", "impl", "index.ts"),
    `export const SecondaryButton = (_p: { size?: "s" | "m" }) => null;\n`
  );
});

afterAll(() => {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

describe("discoverSymbols — `export *` wildcard re-exports", () => {
  it("follows export * chains and collects descendants", () => {
    const pkgs = discoverPackages(ROOT, "packages");
    const pkg = pkgs.find((p) => p.name === "@x/ui")!;
    const symbols = discoverSymbols(pkg);
    const names = symbols.map((s) => s.exportName).sort();
    expect(names).toEqual(["PrimaryButton", "SecondaryButton"]);
  });
});
