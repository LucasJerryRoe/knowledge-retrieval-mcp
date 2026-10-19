import { z } from "zod/v4";
import type { KnowledgeRuntime } from "../server/runtime.js";

const ReadKnowledgeInputSchema = z.object({
  candidate_id: z.string().min(1),
});

export const readKnowledgeTool = {
  name: "read_knowledge",
  description: [
    "【必须通过本工具读取】使用 search_knowledge 返回的 candidate_id 读取候选文档全文。",
    "不要直接使用文件读取工具打开知识库文件——本工具会校验版本一致性，",
    "确保读取内容与检索时的文档版本匹配，防止读到已更新或已删除的内容。",
    "读取完成后可用 cite_evidence 引用具体行。",
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
