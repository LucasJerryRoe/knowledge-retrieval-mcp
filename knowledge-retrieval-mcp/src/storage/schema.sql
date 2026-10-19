-- 统一知识文档表 —— 同时承担文档注册和搜索索引（LLMWiki 风格单一索引）
CREATE TABLE IF NOT EXISTS knowledge_document (
  knowledge_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  title_lower TEXT NOT NULL,
  headings_lower TEXT NOT NULL DEFAULT '',
  summary TEXT,
  summary_lower TEXT NOT NULL DEFAULT '',
  body_lower TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  semantic_type TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_doc_category ON knowledge_document(category);
CREATE INDEX IF NOT EXISTS idx_doc_semantic_type ON knowledge_document(semantic_type);

-- Layer 1: Knowledge Task —— 大模型指定的检索任务（替代原来的 knowledge_session）
CREATE TABLE IF NOT EXISTS knowledge_task (
  task_id TEXT PRIMARY KEY,
  task_desc TEXT NOT NULL,
  conversation_id TEXT,
  index_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED', 'ABANDONED')),
  search_count INTEGER NOT NULL DEFAULT 0,
  document_read_count INTEGER NOT NULL DEFAULT 0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  closed_at TEXT
);

-- 搜索记录
CREATE TABLE IF NOT EXISTS knowledge_search (
  search_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES knowledge_task(task_id),
  query_text TEXT NOT NULL,
  top_k INTEGER NOT NULL,
  retrieval_strategy TEXT NOT NULL,
  index_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED', 'CRASHED')),
  candidate_count INTEGER,
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  error_message TEXT
);

-- 搜索候选
CREATE TABLE IF NOT EXISTS knowledge_candidate (
  candidate_id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL REFERENCES knowledge_search(search_id),
  knowledge_id TEXT NOT NULL REFERENCES knowledge_document(knowledge_id),
  rank INTEGER NOT NULL,
  score REAL NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  retrieval_snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Layer 2: Document Read —— 按任务+文档去重
CREATE TABLE IF NOT EXISTS document_read (
  read_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES knowledge_task(task_id),
  knowledge_id TEXT NOT NULL REFERENCES knowledge_document(knowledge_id),
  search_id TEXT NOT NULL REFERENCES knowledge_search(search_id),
  read_snapshot_hash TEXT NOT NULL,
  retrieval_snapshot_hash TEXT NOT NULL,
  version_changed INTEGER NOT NULL DEFAULT 0,
  adopted INTEGER NOT NULL DEFAULT 0,
  search_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Layer 3: Evidence —— 最终采用的原文片段
CREATE TABLE IF NOT EXISTS evidence (
  evidence_id TEXT PRIMARY KEY,
  read_id TEXT NOT NULL REFERENCES document_read(read_id),
  task_id TEXT NOT NULL REFERENCES knowledge_task(task_id),
  knowledge_id TEXT NOT NULL REFERENCES knowledge_document(knowledge_id),
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  snippet TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_task ON knowledge_search(task_id);
CREATE INDEX IF NOT EXISTS idx_candidate_search ON knowledge_candidate(search_id);
CREATE INDEX IF NOT EXISTS idx_read_task ON document_read(task_id);
CREATE INDEX IF NOT EXISTS idx_read_knowledge ON document_read(task_id, knowledge_id);
CREATE INDEX IF NOT EXISTS idx_evidence_read ON evidence(read_id);
CREATE INDEX IF NOT EXISTS idx_evidence_task ON evidence(task_id);