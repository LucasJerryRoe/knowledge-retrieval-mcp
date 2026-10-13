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
