import { describe, it, expect, vi } from "vitest";
import {
  isDsSource,
  dsStubModule,
  withDsTransformResilience,
} from "../../../web/vite-ds-resilience.ts";

const DS_ROOTS = ["C:/Users/x/beaver-designus/.cache/react-ui-kit", "/home/x/bd/.cache/beaver-ui"];

describe("F6 — isDsSource", () => {
  it("matches DS source ids (incl. /@fs/ prefix, query, backslashes)", () => {
    expect(isDsSource("C:/Users/x/beaver-designus/.cache/react-ui-kit/tinkoff-packages/Scroll/ScrollBar.tsx", DS_ROOTS)).toBe(true);
    expect(isDsSource("/@fs/home/x/bd/.cache/beaver-ui/packages/box/src/box.tsx?v=1", DS_ROOTS)).toBe(true);
    expect(isDsSource("C:\\Users\\x\\beaver-designus\\.cache\\react-ui-kit\\a\\b.tsx", DS_ROOTS)).toBe(true);
  });
  it("does NOT match app/own/third-party code", () => {
    expect(isDsSource("/home/x/bd/web/src/App.tsx", DS_ROOTS)).toBe(false);
    expect(isDsSource("/home/x/bd/node_modules/react/index.js", DS_ROOTS)).toBe(false);
    expect(isDsSource("anything", [])).toBe(false);
  });
});

describe("F6 — dsStubModule", () => {
  it("emits a self-contained React default export + marker with the file name", () => {
    const code = dsStubModule("/x/.cache/react-ui-kit/Scroll/ScrollBar.tsx?v=2");
    expect(code).toContain('import * as React from "react"');
    expect(code).toContain("export default BvrTransformStub");
    expect(code).toContain("__bvrTransformStub");
    expect(code).toContain("ScrollBar.tsx");
    expect(code).toContain('"data-bvr-fallback": "transform-error"');
  });
});

describe("F6 — withDsTransformResilience", () => {
  function fakePlugin(transform: any) {
    return { name: "vite:react-babel", transform };
  }

  it("substitutes a stub when a DS-source transform throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = fakePlugin(() => {
      throw new Error("Support for the experimental syntax 'decorators' isn't currently enabled");
    });
    const [wrapped] = withDsTransformResilience([p], DS_ROOTS);
    const out = await wrapped.transform.call(
      {},
      "code",
      "C:/Users/x/beaver-designus/.cache/react-ui-kit/tinkoff-packages/Scroll/ScrollBar.tsx"
    );
    expect(out.code).toContain("export default BvrTransformStub");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("RETHROWS for non-DS code (never masks app/own bugs)", async () => {
    const p = fakePlugin(() => {
      throw new Error("real app bug");
    });
    const [wrapped] = withDsTransformResilience([p], DS_ROOTS);
    await expect(wrapped.transform.call({}, "code", "/home/x/bd/web/src/App.tsx")).rejects.toThrow("real app bug");
  });

  it("passes successful transforms through untouched", async () => {
    const p = fakePlugin(() => ({ code: "ok", map: null }));
    const [wrapped] = withDsTransformResilience([p], DS_ROOTS);
    const out = await wrapped.transform.call({}, "code", "/home/x/bd/.cache/beaver-ui/x.tsx");
    expect(out).toEqual({ code: "ok", map: null });
  });

  it("preserves the object-form { handler, order } transform shape", async () => {
    const p = fakePlugin({ order: "pre", handler: () => ({ code: "z", map: null }) });
    const [wrapped] = withDsTransformResilience([p], DS_ROOTS);
    expect(typeof wrapped.transform).toBe("object");
    expect(wrapped.transform.order).toBe("pre");
    const out = await wrapped.transform.handler.call({}, "c", "/home/x/bd/.cache/beaver-ui/y.tsx");
    expect(out.code).toBe("z");
  });

  it("ignores plugins without a transform hook", () => {
    const list = withDsTransformResilience([{ name: "vite:react-refresh" }], DS_ROOTS);
    expect(list).toHaveLength(1);
    expect(list[0].transform).toBeUndefined();
  });
});
