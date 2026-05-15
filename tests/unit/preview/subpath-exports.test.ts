import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSubpathExports } from "../../../packages/preview-runtime/src/resolve-entry.ts";

const fwd = (p: string | null | undefined) => (p ? p.replace(/\\/g, "/") : p);

let dir: string;
function touch(rel: string) {
  const abs = join(dir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, "export {};");
  return abs.replace(/\\/g, "/");
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "bd-subpath-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("F4 — resolveSubpathExports", () => {
  it("resolves a concrete subpath from its declared (source) condition", () => {
    const f = touch("src/legacy/index.ts");
    const r = resolveSubpathExports(dir, {
      exports: { ".": "./src/index.ts", "./legacy": { source: "./src/legacy/index.ts", types: "./dist/legacy.d.ts" } },
    });
    expect(fwd(r.subpaths.legacy)).toBe(f);
  });

  it("falls back to src/<sub>/index.tsx when the declared target is an unbuilt dist/", () => {
    const f = touch("src/legacy/index.tsx");
    const r = resolveSubpathExports(dir, {
      exports: { "./legacy": "./dist/legacy.js" }, // dist not built
    });
    expect(fwd(r.subpaths.legacy)).toBe(f);
  });

  it("captures a './*' wildcard base dir", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    const r = resolveSubpathExports(dir, { exports: { ".": "./src/index.ts", "./*": "./src/*" } });
    expect(r.wildcardBase?.replace(/\\/g, "/")).toBe(join(dir, "src").replace(/\\/g, "/"));
    expect(Object.keys(r.subpaths)).toHaveLength(0);
  });

  it("ignores '.' and a types-only subpath value with no loadable file", () => {
    const r = resolveSubpathExports(dir, {
      exports: { ".": "./src/index.ts", "./broken": { types: "./dist/broken.d.ts" } },
    });
    expect(r.subpaths).toEqual({});
    expect(r.wildcardBase).toBeNull();
  });

  it("no exports field → empty result", () => {
    expect(resolveSubpathExports(dir, { main: "dist/index.js" })).toEqual({ subpaths: {}, wildcardBase: null });
  });
});
