import { z } from "zod";
import type { Config } from "../server/config.js";

const SearchKnowledgeInputSchema = z.object({
  query: z.string(),
  top_k: z.number().int().positive().optional(),
});

export const searchKnowledgeTool = {
  name: "search_knowledge",
  description: [
    "Search the internal Markdown knowledge base for information",
    "relevant to the current task. Use this tool when internal",
    "domain knowledge, rules, specifications, procedures, or",
    "project documentation may be needed.",
    "",
    "If the returned candidates do not clearly match the task,",
    "rewrite the query with alternative wording, synonyms, or",
    "more specific terms, and call this tool again. Multiple",
    "search calls per task are expected and encouraged - the",
    "retrieval engine performs lexical matching only and cannot",
    "resolve paraphrases on its own.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      top_k: { type: "integer", minimum: 1 },
    },
    required: ["query"],
  },
} as const;

export async function handleSearchKnowledge(
  rawArgs: Record<string, unknown>,
  config: Config,
) {
  const args = SearchKnowledgeInputSchema.parse(rawArgs);
  const trimmed = args.query.trim();

  if (trimmed.length === 0 || trimmed.length > 512) {
    throw new Error(
      `query length must be in [1, 512] after trim (got ${trimmed.length})`,
    );
  }

  const topK = Math.min(args.top_k ?? config.defaultTopK, config.maxTopK);

  // TODO(step 5+): plug real retriever + trace recorder.
  const payload = {
    query_id: `q_mock_${Date.now()}`,
    results: [] as Array<{
      candidate_id: string;
      knowledge_id: string;
      title: string;
      rank: number;
      score: number;
      excerpt: string;
    }>,
    _debug: { trimmed_query: trimmed, top_k: topK },
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
