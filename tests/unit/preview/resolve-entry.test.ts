import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePreviewEntry } from "../../../packages/preview-runtime/src/resolve-entry.ts";

let dir: string;

function touch(rel: string, body = "export {};") {
  const abs = join(dir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
  return abs.replace(/\\/g, "/");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bd-resolve-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolvePreviewEntry — source-first, never .d.ts, must exist", () => {
  it("prefers package.json `source` (Tinkoff/T-Bank react-ui-kit convention)", () => {
    const entry = touch("src/index.ts");
    touch("dist/index.js"); // present but `source` wins
    const r = resolvePreviewEntry(dir, { name: "@x/a", source: "src/index.ts", main: "dist/index.js" });
    expect(r.entry?.replace(/\\/g, "/")).toBe(entry);
  });

  it("falls back to src/index.tsx when no `source` field", () => {
    const entry = touch("src/index.tsx");
    const r = resolvePreviewEntry(dir, { name: "@x/b", main: "dist/index.js" });
    expect(r.entry?.replace(/\\/g, "/")).toBe(entry);
  });

  it("returns null when only an unbuilt dist/ main is declared (the T-Bank failure)", () => {
    // package.json points main+types at dist/ which was never built
    const r = resolvePreviewEntry(dir, {
      name: "@beaver-ui/action-bar",
      main: "dist/index.js",
      module: "dist/index.esm.js",
      types: "dist/index.d.ts",
    });
    expect(r.entry).toBeNull();
    // every probed candidate is surfaced for the report
    expect(r.tried.some((p) => p.replace(/\\/g, "/").endsWith("dist/index.js"))).toBe(true);
    expect(r.tried.some((p) => p.replace(/\\/g, "/").endsWith("src/index.ts"))).toBe(true);
  });

  it("never accepts a .d.ts even if it exists on disk", () => {
    touch("index.d.ts");
    touch("dist/index.d.ts");
    const r = resolvePreviewEntry(dir, { name: "@x/c", types: "dist/index.d.ts", main: "index.d.ts" });
    expect(r.entry).toBeNull();
  });

  it("accepts an existing built dist/ main (prebuilt DS, dist checked in)", () => {
    const entry = touch("dist/index.js");
    const r = resolvePreviewEntry(dir, { name: "@x/d", main: "dist/index.js" });
    expect(r.entry?.replace(/\\/g, "/")).toBe(entry);
  });

  it("resolves the `.` entry from an exports map, skipping the types condition", () => {
    const entry = touch("src/main.ts");
    const r = resolvePreviewEntry(dir, {
      name: "@x/e",
      exports: { ".": { types: "./dist/index.d.ts", import: "./src/main.ts" } },
    });
    expect(r.entry?.replace(/\\/g, "/")).toBe(entry);
  });

  it("resolves a string exports value", () => {
    const entry = touch("lib/index.js");
    const r = resolvePreviewEntry(dir, { name: "@x/f", exports: "./lib/index.js" });
    expect(r.entry?.replace(/\\/g, "/")).toBe(entry);
  });

  it("uses `module` over `main` when both exist", () => {
    const mod = touch("dist/index.esm.js");
    touch("dist/index.cjs");
    const r = resolvePreviewEntry(dir, { name: "@x/g", main: "dist/index.cjs", module: "dist/index.esm.js" });
    expect(r.entry?.replace(/\\/g, "/")).toBe(mod);
  });
});
