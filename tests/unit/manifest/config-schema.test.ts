import { describe, it, expect } from "vitest";
import { parseConfig } from "../../../packages/manifest/src/config-schema.ts";

describe("manifest.config.json — zod schema", () => {
  it("accepts a minimal valid config", () => {
    const cfg = parseConfig({
      designSystems: [
        {
          id: "beaver",
          categoryHint: "organism",
          source: { localPath: "./libraries/beaver-ui" },
          componentRoot: "packages",
        },
      ],
      output: { dir: "./manifest-data" },
    });
    expect(cfg.designSystems[0].id).toBe("beaver");
  });

  it("rejects an empty designSystems array", () => {
    expect(() =>
      parseConfig({ designSystems: [], output: { dir: "./manifest-data" } })
    ).toThrow(/at least one designSystem required/);
  });

  it("rejects an upper-case id (must match kebab)", () => {
    expect(() =>
      parseConfig({
        designSystems: [
          {
            id: "Beaver",
            categoryHint: "organism",
            source: { localPath: "./x" },
            componentRoot: "packages",
          },
        ],
        output: { dir: "./manifest-data" },
      })
    ).toThrow(/lowercase kebab/);
  });

  it("rejects a source missing both localPath and gitUrl", () => {
    expect(() =>
      parseConfig({
        designSystems: [
          {
            id: "x",
            categoryHint: "atom",
            source: {},
            componentRoot: "packages",
          },
        ],
        output: { dir: "./manifest-data" },
      })
    ).toThrow(/localPath OR source\.gitUrl required/);
  });

  it("accepts tokenConventionMap shape", () => {
    const cfg = parseConfig({
      designSystems: [
        {
          id: "x",
          categoryHint: "atom",
          source: { localPath: "./x" },
          componentRoot: "packages",
          tokenConventionMap: {
            enabled: true,
            propNameToGroupPrefix: { color: "color.brand", curve: "animation.curve" },
          },
        },
      ],
      output: { dir: "./manifest-data" },
    });
    expect(cfg.designSystems[0].tokenConventionMap?.enabled).toBe(true);
    expect(cfg.designSystems[0].tokenConventionMap?.propNameToGroupPrefix?.color).toBe("color.brand");
  });

  it("P6 — accepts a styles block and defaults cssStrategy to auto", () => {
    const cfg = parseConfig({
      designSystems: [
        {
          id: "x",
          categoryHint: "atom",
          source: { localPath: "./x" },
          componentRoot: "packages",
          styles: { globalStylesheets: ["dist/index.css", "src/reset.css"] },
        },
      ],
      output: { dir: "./manifest-data" },
    });
    const s = cfg.designSystems[0].styles!;
    expect(s.globalStylesheets).toEqual(["dist/index.css", "src/reset.css"]);
    expect(s.cssStrategy).toBe("auto");
  });

  it("P6 — accepts an explicit cssStrategy + postcssConfig", () => {
    const cfg = parseConfig({
      designSystems: [
        {
          id: "x",
          categoryHint: "atom",
          source: { localPath: "./x" },
          componentRoot: "packages",
          styles: { cssStrategy: "vanilla-extract", postcssConfig: "postcss.config.cjs" },
        },
      ],
      output: { dir: "./manifest-data" },
    });
    expect(cfg.designSystems[0].styles?.cssStrategy).toBe("vanilla-extract");
    expect(cfg.designSystems[0].styles?.postcssConfig).toBe("postcss.config.cjs");
  });

  it("P6 — rejects an unknown cssStrategy", () => {
    expect(() =>
      parseConfig({
        designSystems: [
          {
            id: "x",
            categoryHint: "atom",
            source: { localPath: "./x" },
            componentRoot: "packages",
            styles: { cssStrategy: "tailwind" },
          },
        ],
        output: { dir: "./manifest-data" },
      })
    ).toThrow(/styles\.cssStrategy/);
  });
});
