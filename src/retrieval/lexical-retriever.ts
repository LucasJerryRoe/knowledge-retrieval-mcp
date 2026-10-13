import type { KnowledgeRepository } from "../knowledge/repository.js";
import { markdownBody } from "../knowledge/markdown-parser.js";
import type { Retriever, RetrievalResult } from "./retriever.js";
import { scoreDocument } from "./scorer.js";
import { tokenize } from "./tokenizer.js";

const BOUNDARIES = new Set(["。", "！", "？", ".", "!", "?", "\n"]);

function excerpt(content: string, tokens: string[]): string {
  const normalized = content.toLocaleLowerCase();
  const positions = tokens
    .map((token) => normalized.indexOf(token))
    .filter((position) => position >= 0);
  if (positions.length === 0) return content.slice(0, 300);

  const hit = Math.min(...positions);
  const rawStart = Math.max(0, hit - 200);
  const rawEnd = Math.min(content.length, hit + 400);
  let start = rawStart;
  let end = rawEnd;

  for (let index = hit - 1; index >= rawStart; index -= 1) {
    if (BOUNDARIES.has(content[index])) {
      start = index + 1;
      break;
    }
  }
  for (let index = hit; index < rawEnd; index += 1) {
    if (BOUNDARIES.has(content[index])) {
      end = index + 1;
      break;
    }
  }
  return content.slice(start, Math.min(end, start + 600)).trim();
}

export class LexicalRetriever implements Retriever {
  constructor(private readonly repository: KnowledgeRepository) {}

  async search(
    query: string,
    options: { topK: number },
  ): Promise<RetrievalResult[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    return this.repository
      .list()
      .map((document) => {
        const body = markdownBody(document.content);
        return {
          knowledgeId: document.knowledgeId,
          score: scoreDocument(document, query, tokens),
          title: document.title,
          excerpt: excerpt(body, tokens),
        };
      })
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
