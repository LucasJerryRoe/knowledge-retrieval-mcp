export interface KnowledgeDocument {
  knowledgeId: string;
  path: string;
  title: string;
  summary?: string;
  tags?: string[];
  headings: string[];
  content: string;
  contentHash: string;
  updatedAt?: string;
}

export interface KnowledgeSnapshot {
  document: KnowledgeDocument;
  absolutePath: string;
}

// ---- 搜索索引相关（原 IndexRepository，现统一放在 document 内） ----

export type SemanticType = "entity" | "concept" | "unclassified";

export interface ScorableDocument {
  knowledgeId: string;
  titleLower: string;
  headingsLower: string;
  summaryLower: string;
  bodyLower: string;
  category: string;
  semanticType: SemanticType;
}

export function deriveCategory(knowledgeId: string): string {
  if (!knowledgeId.includes("/")) return "general";
  return knowledgeId.split("/")[0];
}

/** 从路径 + 正文特征推断语义类型。不命中也返回 unclassified，不会丢文档。 */
export function deriveType(
  knowledgeId: string,
  bodyLower: string,
): SemanticType {
  const path = knowledgeId.toLocaleLowerCase();

  // L1: 路径关键词强信号
  if (/\/实体\//.test(path)) return "entity";
  if (/\/(api|接口|数据模型|schema)\//.test(path)) return "entity";
  if (/\/(业务流程|流程|规则|攻略|指南|快速开始)\//.test(path)) return "concept";
  if (/\/(用例|场景|测试|风险)\//.test(path)) return "concept";

  // L2: top-level 目录语义
  if (path.startsWith("tech_knowledge/")) return "entity";
  if (path.startsWith("qa_knowledge/")) return "concept";

  // L3: 正文特征推断（仅 biz_knowledge 等模糊目录走这层）
  const entitySignals = (bodyLower.match(/\|\s*字段\s*\|/g) ?? []).length +
    (bodyLower.match(/\|\s*属性\s*\|/g) ?? []).length +
    (bodyLower.match(/\|\s*类型\s*\|/g) ?? []).length +
    (bodyLower.match(/\|\s*说明\s*\|/g) ?? []).length +
    (bodyLower.match(/^```[a-z]*\n(?:get|post|put|delete|patch)\s/i) ?? []).length;
  const conceptSignals = (bodyLower.match(/步骤\s*\d/gi) ?? []).length +
    (bodyLower.match(/流程(?:图|说明)/gi) ?? []).length +
    (bodyLower.match(/状态机/gi) ?? []).length +
    (bodyLower.match(/(?:前提条件|前置条件|触发条件)/gi) ?? []).length;

  if (entitySignals > conceptSignals) return "entity";
  if (conceptSignals > entitySignals) return "concept";

  return "unclassified";
}
