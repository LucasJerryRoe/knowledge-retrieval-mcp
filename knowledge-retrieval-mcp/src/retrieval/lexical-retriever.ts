import type { KnowledgeRepository } from "../knowledge/repository.js";
import type { SemanticType } from "../knowledge/document.js";
import type { Retriever, RetrievalResult } from "./retriever.js";
import { scoreIndexed } from "./scorer.js";
import { tokenize } from "./tokenizer.js";

const BOUNDARIES = new Set(["。", "！", "？", ".", "!", "?", "\n"]);

function excerpt(body: string, tokens: string[]): string {
  const positions = tokens
    .map((token) => body.indexOf(token))
    .filter((position) => position >= 0);
  if (positions.length === 0) return body.slice(0, 300);

  const hit = Math.min(...positions);
  const rawStart = Math.max(0, hit - 200);
  const rawEnd = Math.min(body.length, hit + 400);
  let start = rawStart;
  let end = rawEnd;

  for (let index = hit - 1; index >= rawStart; index -= 1) {
    if (BOUNDARIES.has(body[index])) {
      start = index + 1;
      break;
    }
  }
  for (let index = hit; index < rawEnd; index += 1) {
    if (BOUNDARIES.has(body[index])) {
      end = index + 1;
      break;
    }
  }
  return body.slice(start, Math.min(end, start + 600)).trim();
}

export class LexicalRetriever implements Retriever {
  constructor(private readonly repo: KnowledgeRepository) {}

  async search(
    query: string,
    options: { topK: number; type?: SemanticType },
  ): Promise<RetrievalResult[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    return this.repo
      .listScorable(options.type)
      .map((doc) => ({
        knowledgeId: doc.knowledgeId,
        score: scoreIndexed(doc, query, tokens),
        title: doc.titleLower,
        excerpt: excerpt(doc.bodyLower, tokens),
      }))
      .filter((result) => result.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.knowledgeId.localeCompare(right.knowledgeId),
      )
      .slice(0, options.topK);
  }
}

export { excerpt as createExcerpt };
