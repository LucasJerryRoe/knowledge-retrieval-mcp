import { z } from "zod/v4";
import type { KnowledgeRuntime } from "../server/runtime.js";

const SearchKnowledgeInputSchema = z.object({
  query: z.string(),
  top_k: z.number().optional(),
  task_id: z.string().min(1).max(200),
  type: z.enum(["entity", "concept"]).optional(),
});

export const searchKnowledgeTool = {
  name: "search_knowledge",
  description: [
    "【优先使用】在内部 Markdown 知识库中检索信息。",
    "需要查阅内部领域知识、业务规则、技术规范、流程文档或项目资料时，",
    "必须优先使用此工具，而非 grep 或文件系统搜索。",
    "",
    "相比裸 grep，本工具提供：",
    "- 标题/子标题/正文分层加权排序，比扁平关键词匹配更准确",
    "- 返回排序后的摘要片段，无需逐一打开文件即可快速判断相关性",
    "- 支持按语义类型过滤：entity（数据模型、字段定义、API 规范）或 concept（工作流、业务规则、流程）",
    "",
    "提供一个稳定的 task_id，将同一调查主题下的多次搜索归为一组，",
    "便于事后分析检索质量与知识库覆盖度。",
    "task_id 应为简洁、人类可读的标签，描述你正在尝试解决的问题",
    "（如\"公海客户标签规则\"、\"车型库测试要点\"）。",
    "",
    "如果返回的候选结果与任务不匹配，使用替代措辞、同义词或更具体的",
    "术语重新改写 query，并再次调用此工具。每个任务允许多次搜索。",
    "如果多次搜索后所有已读文档均无法产生有效证据，",
    "应向用户反馈该主题在当前知识库中覆盖不足。",
  ].join("\n"),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      top_k: { type: "integer", minimum: 1 },
      task_id: { type: "string", description: "用于归组同一调查多次搜索的任务标识，使用简洁、人类可读的标签。" },
      type: { type: "string", enum: ["entity", "concept"], description: "按语义类型过滤：entity（数据模型、API、字段定义）或 concept（工作流、规则、流程）。不设则搜索全部。" },
    },
    required: ["query", "task_id"],
  },
} as const;

export async function handleSearchKnowledge(
  rawArgs: Record<string, unknown>,
  runtime: KnowledgeRuntime,
  conversationId?: string,
) {
  const args = SearchKnowledgeInputSchema.parse(rawArgs);
  const payload = await runtime.search(args.query, args.top_k, args.task_id, conversationId, args.type);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}