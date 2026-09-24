import { z } from "zod";
import type { Config } from "../server/config.js";

const ReadKnowledgeInputSchema = z.object({
  candidate_id: z.string().min(1),
});

export const readKnowledgeTool = {
  name: "read_knowledge",
  description: [
    "Read the full content of a knowledge candidate returned by",
    "search_knowledge. Use the candidate_id returned by a previous",
    "search_knowledge call.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    properties: {
      candidate_id: { type: "string" },
    },
    required: ["candidate_id"],
  },
} as const;

export async function handleReadKnowledge(
  rawArgs: Record<string, unknown>,
  _config: Config,
) {
  const args = ReadKnowledgeInputSchema.parse(rawArgs);

  // TODO(step 9+): resolve candidate -> knowledge -> markdown, and write knowledge_read trace.
  const payload = {
    error: "NOT_IMPLEMENTED",
    candidate_id: args.candidate_id,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
