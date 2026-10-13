import path from "node:path";
import matter from "gray-matter";
import { remark } from "remark";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import type { Heading, Root, Text } from "mdast";
import { sha256 } from "../common/hash.js";
import type { KnowledgeDocument } from "./document.js";

function headingText(node: Heading): string {
  const parts: string[] = [];
  visit(node, "text", (text: Text) => parts.push(text.value));
  return parts.join("").trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

export function markdownBody(rawContent: string): string {
  return matter(rawContent).content;
}

export function parseMarkdown(
  rawContent: string,
  relativePath: string,
): KnowledgeDocument {
  const parsed = matter(rawContent);
  const tree = remark().use(remarkParse).parse(parsed.content) as Root;
  const headings: string[] = [];
  let firstH1: string | undefined;

  visit(tree, "heading", (node: Heading) => {
    const text = headingText(node);
    if (!text) return;
    headings.push(text);
    if (node.depth === 1 && firstH1 === undefined) firstH1 = text;
  });

  const normalizedPath = relativePath.split(path.sep).join("/");
  const fallbackId = normalizedPath.replace(/\.md$/i, "");
  const knowledgeId = optionalString(parsed.data.id) ?? fallbackId;
  const filename = path.basename(relativePath, path.extname(relativePath));

  return {
    knowledgeId,
    path: normalizedPath,
    title: optionalString(parsed.data.title) ?? firstH1 ?? filename,
    summary: optionalString(parsed.data.summary),
    tags: optionalTags(parsed.data.tags),
    headings,
    content: rawContent,
    contentHash: sha256(rawContent),
    updatedAt: optionalString(parsed.data.updatedAt),
  };
}
