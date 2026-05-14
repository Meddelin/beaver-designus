import { describe, it, expect } from "vitest";
import { parseMdxRegex } from "../../../packages/manifest/src/docs/mdx-regex.ts";

describe("parseMdxRegex (fallback parser)", () => {
  it("extracts frontmatter title and tags", () => {
    const raw = `---
title: SideNavigation
tags: [navigation, layout]
---
First prose paragraph here.

# heading should be ignored

\`\`\`tsx
<SideNavigation items={items} />
\`\`\`
`;
    const parsed = parseMdxRegex(raw);
    expect(parsed.title).toBe("SideNavigation");
    expect(parsed.tags).toEqual(["navigation", "layout"]);
    expect(parsed.description).toBe("First prose paragraph here.");
    expect(parsed.examples).toHaveLength(1);
    expect(parsed.examples[0].code).toContain("<SideNavigation");
  });

  it("falls back to H1 when no frontmatter title", () => {
    const raw = `# Button\n\nA simple button.\n`;
    const parsed = parseMdxRegex(raw);
    expect(parsed.title).toBe("Button");
  });

  it("handles missing frontmatter / paragraph / code", () => {
    const parsed = parseMdxRegex("");
    expect(parsed.title).toBeNull();
    expect(parsed.tags).toEqual([]);
    expect(parsed.description).toBeNull();
    expect(parsed.examples).toEqual([]);
  });

  it("captures multiple code fences", () => {
    const raw = `# Card

\`\`\`tsx
<Card title="A" />
\`\`\`

prose

\`\`\`jsx
<Card title="B" />
\`\`\`
`;
    const parsed = parseMdxRegex(raw);
    expect(parsed.examples).toHaveLength(2);
  });
});
