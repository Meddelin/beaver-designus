import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { extractTokens } from "../../../packages/manifest/src/tokens/extract.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(tmpdir(), `bd-tokens-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(ROOT, { recursive: true });

  // A PascalCase, 3-surface token namespace mimicking the real react-ui-kit
  // shape: animation.curve has desktopValue / desktopDarkValue / iosValue /
  // iosDarkValue / androidValue / androidDarkValue.
  writeFileSync(
    join(ROOT, "animation.d.ts"),
    `export namespace animation { export { curve }; }
declare const curve: any;`
  );
  writeFileSync(
    join(ROOT, "animation.js"),
    `const curve = {
  "expressive-standard": {
    desktopValue: "cubic-bezier(.2, 0, 0, 1)",
    desktopDarkValue: "cubic-bezier(.2, 0, 0, 1)",
    iosValue: "cubic-bezier(.4, 0, .2, 1)",
    iosDarkValue: "cubic-bezier(.4, 0, .2, 1)",
    androidValue: "cubic-bezier(.4, 0, .2, 1)",
    androidDarkValue: "cubic-bezier(.4, 0, .2, 1)",
  },
};
module.exports = { animation: { curve } };`
  );
});

afterAll(() => {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

describe("extractTokens — configurable axis grammar", () => {
  it("default grammar rejects PascalCase axis keys (no axes detected)", () => {
    const r = extractTokens(ROOT);
    // None of the leaf keys match the default lowercase grammar, so no axes.
    expect(r.manifest.axes).toEqual([]);
    expect(r.manifest.combos).toHaveLength(1);
    expect(r.manifest.combos[0].id).toBe("default");
  });

  it("custom grammar with PascalCase + 3 surfaces emits the right cross-product", () => {
    const r = extractTokens(ROOT, {
      axisGrammar: {
        pattern: /^(?<surface>desktop|ios|android)(?<theme>Dark)?Value$/,
        defaultSurface: "desktop",
        defaultTheme: "light",
      },
    });
    expect(r.manifest.axes).toHaveLength(2);
    const surfaceAxis = r.manifest.axes.find((a) => a.id === "surface")!;
    expect(surfaceAxis.values.sort()).toEqual(["android", "desktop", "ios"]);
    const themeAxis = r.manifest.axes.find((a) => a.id === "theme")!;
    expect(themeAxis.values.sort()).toEqual(["dark", "light"]);
    // 3 surfaces × 2 themes = 6 combos
    expect(r.manifest.combos).toHaveLength(6);
    expect(r.manifest.defaultComboId).toBe("surface=desktop.theme=light");
  });

  it("custom grammar resolves the correct value per combo", () => {
    const r = extractTokens(ROOT, {
      axisGrammar: {
        pattern: /^(?<surface>desktop|ios|android)(?<theme>Dark)?Value$/,
        defaultSurface: "desktop",
      },
    });
    const desktopLightCss = r.cssByCombo["surface=desktop.theme=light"];
    expect(desktopLightCss).toContain("--animation-curve-expressive-standard:");
    expect(desktopLightCss).toContain("cubic-bezier(.2, 0, 0, 1)");

    const iosDarkCss = r.cssByCombo["surface=ios.theme=dark"];
    expect(iosDarkCss).toContain("cubic-bezier(.4, 0, .2, 1)");
  });
});
