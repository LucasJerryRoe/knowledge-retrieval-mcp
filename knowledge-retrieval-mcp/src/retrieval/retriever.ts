import type { SemanticType } from "../knowledge/document.js";

export interface RetrievalResult {
  knowledgeId: string;
  score: number;
  title: string;
  excerpt: string;
}

export interface Retriever {
  search(
    query: string,
    options: { topK: number; type?: SemanticType },
  ): Promise<RetrievalResult[]>;
}
