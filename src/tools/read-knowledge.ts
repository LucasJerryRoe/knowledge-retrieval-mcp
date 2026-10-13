import { z } from "zod/v4";
import type { KnowledgeRuntime } from "../server/runtime.js";

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
  runtime: KnowledgeRuntime,
) {
  const args = ReadKnowledgeInputSchema.parse(rawArgs);
  const payload = await runtime.read(args.candidate_id);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    isError: "error" in payload,
  };
}
