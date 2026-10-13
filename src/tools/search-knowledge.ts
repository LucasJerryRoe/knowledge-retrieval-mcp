import { z } from "zod/v4";
import type { KnowledgeRuntime } from "../server/runtime.js";

const SearchKnowledgeInputSchema = z.object({
  query: z.string(),
  top_k: z.number().optional(),
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
  runtime: KnowledgeRuntime,
  sessionId?: string,
) {
  const args = SearchKnowledgeInputSchema.parse(rawArgs);
  const payload = await runtime.search(args.query, args.top_k, sessionId);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
