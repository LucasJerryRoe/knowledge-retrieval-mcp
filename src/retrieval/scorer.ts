import type { KnowledgeDocument } from "../knowledge/document.js";
import { markdownBody } from "../knowledge/markdown-parser.js";

const WEIGHTS = {
  title: 3,
  heading: 2.5,
  summary: 2,
  body: 1,
} as const;

function matchWeight(haystack: string, needle: string, weight: number): number {
  return needle && haystack.includes(needle) ? weight : 0;
}

export function scoreDocument(
  document: KnowledgeDocument,
  query: string,
  tokens: string[],
): number {
  const title = document.title.toLocaleLowerCase();
  const headings = document.headings.join("\n").toLocaleLowerCase();
  const summary = document.summary?.toLocaleLowerCase() ?? "";
  const body = markdownBody(document.content).toLocaleLowerCase();
  let score = 0;

  for (const token of tokens) {
    score += matchWeight(title, token, WEIGHTS.title);
    score += matchWeight(headings, token, WEIGHTS.heading);
    score += matchWeight(summary, token, WEIGHTS.summary);
    score += matchWeight(body, token, WEIGHTS.body);
  }

  const phrase = query.trim().toLocaleLowerCase();
  if (phrase) {
    if (title.includes(phrase)) score += 12;
    if (headings.includes(phrase)) score += 8;
    if (summary.includes(phrase)) score += 5;
    if (body.includes(phrase)) score += 2;
  }
  return score;
}
