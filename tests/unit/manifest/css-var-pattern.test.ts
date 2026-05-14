import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { extractTokens } from "../../../packages/manifest/src/tokens/extract.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(tmpdir(), `bd-cssvar-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(
    join(ROOT, "color.d.ts"),
    `export namespace color { export { brand }; }
declare const brand: any;`
  );
  writeFileSync(
    join(ROOT, "color.js"),
    `const brand = {
  primary: { desktopvalue: "#ffdd2d" },
  secondary: { desktopvalue: "#000" },
};
module.exports = { color: { brand } };`
  );
});

afterAll(() => {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

describe("extractTokens — cssVarPattern", () => {
  it("uses the default pattern when not configured", () => {
    const r = extractTokens(ROOT);
    const variant = r.manifest.groups["color.brand"].variants.find((v) => v.name === "primary")!;
    expect(variant.cssVar).toBe("--color-brand-primary");
  });

  it("applies a custom prefix pattern", () => {
    const r = extractTokens(ROOT, { cssVarPattern: "--tui-{namespace}-{binding}-{variant}" });
    const variant = r.manifest.groups["color.brand"].variants.find((v) => v.name === "primary")!;
    expect(variant.cssVar).toBe("--tui-color-brand-primary");
  });

  it("supports patterns without separator between namespace and binding", () => {
    const r = extractTokens(ROOT, { cssVarPattern: "--{namespace}{binding}-{variant}" });
    const variant = r.manifest.groups["color.brand"].variants.find((v) => v.name === "secondary")!;
    expect(variant.cssVar).toBe("--colorbrand-secondary");
  });
});
