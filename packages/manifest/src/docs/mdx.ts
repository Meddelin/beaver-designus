// Stage 3 — Docusaurus MDX docs parser. AST-based per §3.2 stage 3 priority 1.
//
// We walk the mdast tree produced by remark + remark-frontmatter + remark-mdx
// and pull ONLY frontmatter (yaml) and code blocks. JSX is left as-is — never
// evaluated, no Docusaurus runtime, no React. The output shape is the same as
// the regex-era parser so callers don't change.
//
// The regex variant lives at `mdx-regex.ts` as a fallback for malformed input
// (e.g. truncated frontmatter); we try AST first.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { remark } from "remark";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";
import { visit } from "unist-util-visit";
import { parseMdxRegex } from "./mdx-regex.ts";
import { parseExprToJson } from "./usage.ts";
import type { JsonValue } from "../types.ts";

export interface ParsedMdx {
  title: string | null;
  tags: string[];
  description: string | null;
  examples: Array<{ source: "mdx"; code: string }>;
}

const processor = remark().use(remarkFrontmatter, ["yaml"]).use(remarkMdx);

export function parseMdx(file: string): ParsedMdx {
  const raw = readFileSync(file, "utf8");
  try {
    return parseAst(raw);
  } catch (err) {
    // Bad MDX — fall back to the regex parser so a single malformed file
    // doesn't take down the whole build.
    return parseMdxRegex(raw);
  }
}

function parseAst(raw: string): ParsedMdx {
  const tree = processor.parse(raw);

  let frontmatter: Record<string, unknown> = {};
  const examples: Array<{ source: "mdx"; code: string }> = [];
  let title: string | null = null;
  let description: string | null = null;

  visit(tree, (node: any) => {
    if (node.type === "yaml" && typeof node.value === "string" && Object.keys(frontmatter).length === 0) {
      frontmatter = parseYamlish(node.value);
    } else if (node.type === "heading" && node.depth === 1 && title === null) {
      title = extractText(node);
    } else if (node.type === "code" && typeof node.value === "string") {
      const lang = (node.lang ?? "").toLowerCase();
      if (lang === "tsx" || lang === "jsx" || lang === "ts" || lang === "js") {
        examples.push({ source: "mdx", code: node.value.trim() });
      }
    } else if (node.type === "paragraph" && description === null) {
      description = extractText(node);
    }
  });

  // Frontmatter title wins over first H1.
  if (typeof frontmatter.title === "string") title = frontmatter.title;
  const tags = Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]) : [];

  return { title, tags, description, examples };
}

function extractText(node: any): string {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  if (Array.isArray(node.children)) return node.children.map(extractText).join("");
  return "";
}

/* P2 — find the first JSX usage of `<exportName .../>` in an MDX doc and
 * statically read its attributes into JSON. String attributes win directly;
 * `prop={<expr>}` attributes are parsed iff statically representable;
 * boolean shorthand (`<C disabled/>`) → true. Returns null when there's no
 * usage or no usable attributes. Never evaluates anything. */
export function findJsxUsage(file: string, exportName: string): Record<string, JsonValue> | null {
  let raw: string;
  try { raw = readFileSync(file, "utf8"); } catch { return null; }
  let tree: ReturnType<typeof processor.parse>;
  try { tree = processor.parse(raw); } catch { return null; }

  let result: Record<string, JsonValue> | null = null;
  visit(tree, (node: any) => {
    if (result) return;
    if (
      (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
      node.name === exportName &&
      Array.isArray(node.attributes)
    ) {
      const out: Record<string, JsonValue> = {};
      for (const attr of node.attributes) {
        if (attr?.type !== "mdxJsxAttribute" || typeof attr.name !== "string") continue;
        const v = attr.value;
        if (v == null) {
          out[attr.name] = true; // boolean shorthand
        } else if (typeof v === "string") {
          out[attr.name] = v;
        } else if (v && typeof v === "object" && typeof v.value === "string") {
          const parsed = parseExprToJson(v.value);
          if (parsed !== undefined) out[attr.name] = parsed;
        }
      }
      if (Object.keys(out).length > 0) result = out;
    }
  });
  return result;
}

export function findAllMdx(rootDir: string): string[] {
  const out: string[] = [];
  if (!existsSync(rootDir)) return out;
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else if (f.endsWith(".mdx") || f.endsWith(".md")) out.push(full);
    }
  };
  walk(rootDir);
  return out;
}

/* Minimal YAML subset matching frontmatter shape: key: value, key: [a,b,c]. */
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
