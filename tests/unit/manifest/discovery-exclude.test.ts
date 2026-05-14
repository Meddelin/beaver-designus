import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { discoverPackages } from "../../../packages/manifest/src/scan/discovery.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(tmpdir(), `bd-discovery-test-${Date.now()}`);
const PKGS = join(ROOT, "packages");

function mkPkg(name: string): void {
  const dir = join(PKGS, name);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@x/${name}`, main: "src/index.ts" }));
  writeFileSync(join(dir, "src", "index.ts"), `export const ${name.replace(/[^a-z]/g, "_")} = 1;`);
}

beforeAll(() => {
  mkdirSync(PKGS, { recursive: true });
  for (const n of ["button", "card", "analytics", "hooks-utils", "internal-state", "design-tokens"]) mkPkg(n);
});

afterAll(() => {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

describe("discoverPackages — excludePackages filter", () => {
  it("returns every package when no exclude list is given (except design-tokens)", () => {
    const pkgs = discoverPackages(ROOT, "packages");
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toContain("@x/button");
    expect(names).toContain("@x/card");
    // design-tokens is auto-skipped (handled by Stage 4b)
    expect(names).not.toContain("@x/design-tokens");
  });

  it("filters exact basenames", () => {
    const pkgs = discoverPackages(ROOT, "packages", { excludePackages: ["analytics"] });
    const names = pkgs.map((p) => p.name);
    expect(names).not.toContain("@x/analytics");
    expect(names).toContain("@x/button");
  });

  it("filters with prefix-wildcard glob", () => {
    const pkgs = discoverPackages(ROOT, "packages", { excludePackages: ["internal-*"] });
    const names = pkgs.map((p) => p.name);
    expect(names).not.toContain("@x/internal-state");
    expect(names).toContain("@x/hooks-utils");
  });

  it("filters with suffix-wildcard glob", () => {
    const pkgs = discoverPackages(ROOT, "packages", { excludePackages: ["*-utils"] });
    const names = pkgs.map((p) => p.name);
    expect(names).not.toContain("@x/hooks-utils");
    expect(names).toContain("@x/button");
  });
});
