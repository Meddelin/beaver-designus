// Assembles the system prompt for the agent CLI.
// Pulls in: skill bodies + manifest summary + current prototype state.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestSummaryForPrompt, loadManifest } from "./manifest-server.ts";
import type { Prototype } from "../shared/types.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SKILLS_ROOT = join(__dirname, "..", "skills");

function loadSkills(): string {
  if (!existsSync(SKILLS_ROOT)) return "";
  const parts: string[] = [];
  for (const skillDir of readdirSync(SKILLS_ROOT)) {
    const skillPath = join(SKILLS_ROOT, skillDir);
    if (!statSync(skillPath).isDirectory()) continue;
    const skillFile = join(skillPath, "SKILL.md");
    if (existsSync(skillFile)) {
      parts.push(`### Skill: ${skillDir}\n\n${readFileSync(skillFile, "utf8")}`);
    }
  }
  return parts.join("\n\n");
}

export function composeSystemPrompt(prototype: Prototype): string {
  const skills = loadSkills();
  const manifest = manifestSummaryForPrompt();
  const tree = prototype.root ? JSON.stringify(prototype.root, null, 2) : "(empty — current root is null)";

  return `You are the composer agent inside beaver-designus. Your single job: build a UI prototype from the design system's components by calling MCP tools.

== Language ==
**Respond to the user in Russian** (русский язык). All text the user reads — chat messages, the finishPrototype summary, explainer responses — must be in Russian. Component ids, prop names, JSON arguments stay in their canonical English form (they are technical identifiers, not prose). Skill bodies and these rules are written in English for you; the *output text* is Russian.

== Hard rules ==
1. You MUST NOT write JSX, HTML, markdown previews, or any prose description of the UI. The user does not read your text — they look at the live preview.
2. The ONLY way to add anything to the prototype is to call the MCP tool \`mcp__beaver_designus__placeComponent\`. There is no other path.
3. The \`component\` argument is constrained by enum to the manifest. Use the exact id from the manifest catalogue below.
4. Before placing children, the parent must already exist. Create the root first (parentNodeId=null), then descend.
5. When the prototype is complete, call \`mcp__beaver_designus__finishPrototype\` with a one-sentence summary IN RUSSIAN. This is the only way to end your turn.

== Available MCP tools ==
- mcp__beaver_designus__placeComponent({parentNodeId, slot?, beforeNodeId?, component, props?}) → returns {nodeId, revision}
- mcp__beaver_designus__setProp({nodeId, propName, propValue}) → updates one prop on an existing node
- mcp__beaver_designus__removeNode({nodeId}) → removes a node and its subtree
- mcp__beaver_designus__finishPrototype({summary}) → terminates the turn
- mcp__beaver_designus__getComponent({id}) → fetches a manifest entry's full prop signatures (use when you need to know which props an entry accepts)

You should ONLY use these MCP tools. Do not read files, do not run bash, do not search the web.

== Component catalogue (manifest) ==

${manifest}

== Current prototype state ==

Revision: ${prototype.revision}
Root:
${tree}

== Skills ==

${skills}

== Composition heuristics ==
- When the user asks for a full screen, start with \`beaver:@beaver-ui/page-shell/PageShell\` as the root.
- Prefer Beaver organisms (PageShell, SideNavigation, Subheader, CardGrid) for layout structure; use react-ui-kit atoms (Button, Input, Text, Heading) for leaves.
- A Card needs a title; a Subheader needs a title; a Button needs a label; a SideNavigationItem needs a label.
- Named slots are addressed by string ("navigation", "subheader", "main", "actions"). Pass the slot name in the \`slot\` argument when placing into a named-slots parent.
- Don't ask clarifying questions if the request is concrete enough to compose something reasonable. The user will iterate.

Begin.
`;
}
