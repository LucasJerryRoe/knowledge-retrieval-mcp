import { z } from "zod/v4";
import type { KnowledgeRuntime } from "../server/runtime.js";

const CiteEvidenceInputSchema = z.object({
  candidate_id: z.string().min(1),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  snippet: z.string().min(1),
  reason: z.string().optional(),
});

export const citeEvidenceTool = {
  name: "cite_evidence",
  description: [
    "在通过 read_knowledge 读取文档后，记录最终答案引用了文档中哪些具体行。",
    "每一条用到的证据各调用一次。",
    "此工具会创建从搜索→读取→引用的完整证据链，",
    "确保答案可追溯至原文，也便于诊断知识库的覆盖质量。",
  ].join("\n"),
  inputSchema: {
    type: "object",
    properties: {
      candidate_id: {
        type: "string",
        description: "已读取的 search_knowledge 结果中的 candidate_id。",
      },
      line_start: {
        type: "integer",
        minimum: 1,
        description: "被引用段落的起始行号（从 1 开始，含）。",
      },
      line_end: {
        type: "integer",
        minimum: 1,
        description: "被引用段落的结束行号（从 1 开始，含）。",
      },
      snippet: {
        type: "string",
        description: "文档中被引用的原文内容。",
      },
      reason: {
        type: "string",
        description: "选取该段作为证据的原因。",
      },
    },
    required: ["candidate_id", "line_start", "line_end", "snippet"],
  },
} as const;

export async function handleCiteEvidence(
  rawArgs: Record<string, unknown>,
  runtime: KnowledgeRuntime,
) {
  const args = CiteEvidenceInputSchema.parse(rawArgs);
  const payload = await runtime.citeEvidence(args);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}