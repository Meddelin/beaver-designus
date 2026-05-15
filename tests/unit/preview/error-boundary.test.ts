import { describe, it, expect } from "vitest";
import { RenderErrorBoundary } from "../../../packages/preview-runtime/src/fallbacks.tsx";

// The boundary's behaviour is fully encoded in its two static methods;
// testing them needs no DOM. Full render isolation is exercised in e2e.
describe("P4 — RenderErrorBoundary state logic", () => {
  it("captures a thrown error", () => {
    expect(RenderErrorBoundary.getDerivedStateFromError(new Error("boom"))).toEqual({
      error: expect.any(Error),
    });
  });

  it("self-heals when the node's props (resetKey) change", () => {
    const errored = { error: new Error("x"), key: "props-v1" };
    expect(RenderErrorBoundary.getDerivedStateFromProps({ resetKey: "props-v2" }, errored)).toEqual({
      error: null,
      key: "props-v2",
    });
  });

  it("keeps the error while resetKey is unchanged", () => {
    const errored = { error: new Error("x"), key: "props-v1" };
    expect(RenderErrorBoundary.getDerivedStateFromProps({ resetKey: "props-v1" }, errored)).toBeNull();
  });
});
