import { describe, it, expect } from "vitest";
import { applyRuntimeOverridesWithMap } from "../../../daemon/runtimes/load-overrides.ts";
import type { RuntimeAgentDef } from "../../../daemon/runtimes/types.ts";

function dummyDef(id: string): RuntimeAgentDef {
  return {
    id,
    displayName: `${id} default`,
    bin: `${id}.exe`,
    binEnvVar: `${id.toUpperCase()}_BIN`,
    versionArgs: ["--version"],
    streamFormat: "plain",
    promptViaStdin: true,
    buildArgs: () => ["--default", "args"],
  };
}

const INPUT = {
  mcpConfigPath: "/tmp/mcp.json",
  systemPrompt: "ignored",
  systemPromptFile: "/tmp/sys.md",
  userMessage: "hi",
  userMessageFile: "/tmp/msg.txt",
  allowedTools: ["mcp__a", "mcp__b", "mcp__c"],
};

describe("applyRuntimeOverridesWithMap — JSON-driven adapter overrides", () => {
  it("returns defs unchanged when overrides map is null", () => {
    const out = applyRuntimeOverridesWithMap([dummyDef("foo")], null);
    expect(out[0].displayName).toBe("foo default");
    expect(out[0].bin).toBe("foo.exe");
  });

  it("returns defs unchanged when overrides is empty object", () => {
    const out = applyRuntimeOverridesWithMap([dummyDef("foo")], {});
    expect(out[0].bin).toBe("foo.exe");
  });

  it("overrides simple fields (bin, displayName, versionArgs)", () => {
    const out = applyRuntimeOverridesWithMap([dummyDef("foo")], {
      foo: {
        displayName: "Foo (corp fork)",
        bin: "foo-corp.exe",
        versionArgs: ["-v"],
      },
    });
    expect(out[0].displayName).toBe("Foo (corp fork)");
    expect(out[0].bin).toBe("foo-corp.exe");
    expect(out[0].versionArgs).toEqual(["-v"]);
    // Untouched fields preserved
    expect(out[0].binEnvVar).toBe("FOO_BIN");
    expect(out[0].streamFormat).toBe("plain");
  });

  it("buildArgs template substitutes known placeholders", () => {
    const out = applyRuntimeOverridesWithMap([dummyDef("foo")], {
      foo: {
        buildArgs: [
          "--auto-approve",
          "--mcp", "${mcpConfigPath}",
          "--prompt-file", "${systemPromptFile}",
          "--tools", "${allowedTools}",
          "-",
        ],
      },
    });
    const argv = out[0].buildArgs(INPUT);
    expect(argv).toEqual([
      "--auto-approve",
      "--mcp", "/tmp/mcp.json",
      "--prompt-file", "/tmp/sys.md",
      "--tools", "mcp__a,mcp__b,mcp__c",
      "-",
    ]);
  });

  it("buildArgs leaves unknown placeholders verbatim (so typos are visible)", () => {
    const out = applyRuntimeOverridesWithMap([dummyDef("foo")], {
      foo: { buildArgs: ["--key", "${notARealPlaceholder}"] },
    });
    const argv = out[0].buildArgs(INPUT);
    expect(argv).toEqual(["--key", "${notARealPlaceholder}"]);
  });

  it("supports allowedToolsSpaced variant", () => {
    const out = applyRuntimeOverridesWithMap([dummyDef("foo")], {
      foo: { buildArgs: ["--tools", "${allowedToolsSpaced}"] },
    });
    const argv = out[0].buildArgs(INPUT);
    expect(argv).toEqual(["--tools", "mcp__a mcp__b mcp__c"]);
  });

  it("ignores override entries that don't match a built-in def id", () => {
    const out = applyRuntimeOverridesWithMap([dummyDef("foo")], {
      nonexistent: { bin: "ghost.exe" },
    });
    expect(out[0].bin).toBe("foo.exe");
  });

  it("preserves the built-in buildArgs when override omits it", () => {
    const out = applyRuntimeOverridesWithMap([dummyDef("foo")], {
      foo: { bin: "foo-corp.exe" }, // only patches bin
    });
    const argv = out[0].buildArgs(INPUT);
    expect(argv).toEqual(["--default", "args"]); // original function preserved
  });
});
