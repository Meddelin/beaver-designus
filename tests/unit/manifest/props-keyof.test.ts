import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { extractComponent } from "../../../packages/manifest/src/props/extract.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(tmpdir(), `bd-props-keyof-${Date.now()}`);

beforeAll(() => {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(
    join(ROOT, "MemberAccess.tsx"),
    `import { animation } from "@x/design-tokens";

interface MemberAccessProps {
  curve: keyof typeof animation.curve;
}

export const MemberAccess = (_props: MemberAccessProps) => null;
`
  );

  writeFileSync(
    join(ROOT, "BareIdentifier.tsx"),
    `import { SPACING_ALIAS } from "@platform-ui/constants";

interface BareIdentifierProps {
  size: keyof typeof SPACING_ALIAS;
}

export const BareIdentifier = (_props: BareIdentifierProps) => null;
`
  );
});

afterAll(() => {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

describe("classifyType — keyof typeof <expr> dot-notation guard", () => {
  it("member access (namespace.member) → token-reference with the dotted group name", () => {
    const c = extractComponent(join(ROOT, "MemberAccess.tsx"), "MemberAccess");
    expect(c).not.toBeNull();
    const prop = c!.props.find((p) => p.name === "curve")!;
    expect(prop.kind.type).toBe("token-reference");
    if (prop.kind.type === "token-reference") {
      expect(prop.kind.group).toBe("animation.curve");
    }
  });

  it("bare identifier (no dot) → unsupported, NOT a false-positive token-reference", () => {
    const c = extractComponent(join(ROOT, "BareIdentifier.tsx"), "BareIdentifier");
    expect(c).not.toBeNull();
    const prop = c!.props.find((p) => p.name === "size")!;
    expect(prop.kind.type).toBe("unsupported");
    if (prop.kind.type === "unsupported") {
      expect(prop.kind.raw).toBe("keyof typeof SPACING_ALIAS");
    }
  });
});
