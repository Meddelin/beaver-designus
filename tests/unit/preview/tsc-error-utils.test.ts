import { describe, it, expect } from "vitest";
import { stripStyleModuleErrors, extractTs2352Ids } from "../../../packages/preview-runtime/src/tsc-error-utils.ts";

describe("F3 — stripStyleModuleErrors", () => {
  it("drops TS2307 lines for *.module.css / scss / less, keeps real ones", () => {
    const input = [
      ".cache/beaver-ui/packages/box/src/box.tsx(8,21): error TS2307: Cannot find module './box.module.css'.",
      ".cache/beaver-ui/packages/x/src/x.tsx(3,9): error TS2307: Cannot find module './x.module.scss'.",
      "component-map.ts(7,1): error TS2307: Cannot find module '@beaver-ui/real-missing'.",
      "component-map.ts(9,5): error TS2305: '\"@x/y\"' has no exported member 'Z'.",
    ].join("\n");
    const out = stripStyleModuleErrors(input).split("\n").filter(Boolean);
    expect(out).toHaveLength(2);
    expect(out.join("\n")).toContain("@beaver-ui/real-missing");
    expect(out.join("\n")).toContain("TS2305");
    expect(out.join("\n")).not.toContain(".module.css");
  });
});

describe("F1 — extractTs2352Ids (compiler as oracle for non-components)", () => {
  const srcLines = [
    "// header",
    "import { DefaultNowDate as BeaverUiSmartFilter__DefaultNowDate } from \"@beaver-ui/smart-filter\";",
    "export const COMPONENT_MAP = {",
    '  "beaver:@beaver-ui/smart-filter/DefaultNowDate": BeaverUiSmartFilter__DefaultNowDate as React.ComponentType<any>,',
    '  "beaver:@beaver-ui/button/Button": BeaverUiButton__Button as React.ComponentType<any>,',
    "};",
  ];

  it("maps a TS2352 line back to the canonical id + offending type", () => {
    const tsc =
      "packages/preview-runtime/src/component-map.ts(4,62): error TS2352: Conversion of type 'NowDateDescriptor' to type 'ComponentType<any>' may be a mistake because neither type sufficiently overlaps with the other.";
    const m = extractTs2352Ids(tsc, srcLines);
    expect(m.get("beaver:@beaver-ui/smart-filter/DefaultNowDate")).toBe("NowDateDescriptor");
    expect(m.size).toBe(1);
  });

  it("ignores non-TS2352 errors and non-map lines", () => {
    const tsc = [
      "component-map.ts(2,9): error TS2307: Cannot find module '@x/y'.",
      "component-map.ts(99,1): error TS2352: Conversion of type 'Foo' to type 'Bar'.", // out-of-range line
    ].join("\n");
    expect(extractTs2352Ids(tsc, srcLines).size).toBe(0);
  });
});
