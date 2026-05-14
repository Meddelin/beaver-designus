// Regex-based MDX parser. The original implementation; now a fallback used
// when the AST parser in `mdx.ts` throws on malformed input.

export interface ParsedMdx {
  title: string | null;
  tags: string[];
  description: string | null;
  examples: Array<{ source: "mdx"; code: string }>;
}

export function parseMdxRegex(raw: string): ParsedMdx {
  const { frontmatter, body } = splitFrontmatter(raw);
  const title = (frontmatter.title as string | undefined) ?? extractFirstH1(body);
  const tags = Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]) : [];
  const description = extractFirstParagraph(body);
  const examples = extractCodeFences(body);
  return { title, tags, description, examples };
}

function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end < 0) return { frontmatter: {}, body: raw };
  const head = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  return { frontmatter: parseYamlish(head), body };
}

function parseYamlish(head: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of head.split("\n")) {
    const m = line.match(/^([\w.-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (!val) continue;
    if (val.startsWith("[") && val.endsWith("]")) {
      out[key] = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      out[key] = val.replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

function extractFirstH1(body: string): string | null {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function extractFirstParagraph(body: string): string | null {
  const lines = body.split(/\r?\n/);
  let inFence = false;
  const paragraph: string[] = [];
  let started = false;
  for (const line of lines) {
    if (line.startsWith("```")) { inFence = !inFence; if (started) break; continue; }
    if (inFence) continue;
    if (line.startsWith("#")) { if (started) break; continue; }
    if (!line.trim()) { if (started) break; continue; }
    paragraph.push(line.trim());
    started = true;
  }
  return paragraph.length ? paragraph.join(" ") : null;
}

function extractCodeFences(body: string): Array<{ source: "mdx"; code: string }> {
  const out: Array<{ source: "mdx"; code: string }> = [];
  const re = /```(tsx|jsx|ts|js)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push({ source: "mdx", code: m[2].trim() });
  }
  return out;
}
