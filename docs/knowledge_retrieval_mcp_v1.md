# Knowledge Retrieval MCP 技术实现方案 v1.0

## 1. 项目目标

实现一个供 Codex 等通用 Agent 使用的 Knowledge Retrieval MCP Server。

当前已有知识库为 Markdown 文件集合，本项目不负责重新生成知识，不修改现有 Wiki 结构。

MCP 负责两个核心能力：

```text
1. search_knowledge
   根据 Query 检索相关知识

2. read_knowledge
   阅读某次检索返回的具体知识
```

同时自动记录完整知识检索链路：

```text
Query
  ↓
Retrieval Candidates
  ↓
Candidate Ranking / Score
  ↓
Agent Read
```

目标是让知识检索从：

```text
Agent
↓
自己 grep / 自己找文件
↓
过程不可控
```

变成：

```text
Codex
  ↓
Knowledge MCP
  ├── Retrieval
  └── Trace
       ↓
   Markdown Wiki
       +
   Retrieval DB
```

---

## 2. v1 范围

v1 只实现：

```text
Markdown 扫描与索引

search_knowledge

read_knowledge

基础 Lexical Retrieval

Query Trace

Candidate Trace

Knowledge Read Trace

Knowledge Version

SQLite Persistence

Codex MCP 接入
```

暂时不实现：

```text
Vector DB
Embedding
Reranker
LLM Judge
JEV
OpenTelemetry
Langfuse / Phoenix
Evidence Binding
Knowledge Write
自动知识生成
复杂权限系统
Dashboard
强制 Agent Retrieval
```

不要为了未来能力提前增加复杂架构。

---

## 3. 总体架构

```text
                     Codex
                       │
                       │ MCP / stdio
                       ▼
            Knowledge Retrieval MCP
        ┌──────────────────────────────┐
        │                              │
        │  search_knowledge            │
        │  read_knowledge              │
        │                              │
        └─────────────┬────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
   Retrieval Engine          Trace Recorder
          │                       │
          ▼                       ▼
   Markdown Knowledge          SQLite
       Repository
```

MCP 层和 Retrieval 层必须解耦。

Codex 永远只感知：

```text
search_knowledge
read_knowledge
```

以后即使 Retrieval Engine 替换成：

```text
BM25
Vector Search
Hybrid Search
Remote Knowledge Service
```

MCP Tool 接口也不应该发生破坏性变化。

---

## 4. 技术栈

推荐：

```text
Language
TypeScript

Runtime
Node.js >= 20

MCP SDK
@modelcontextprotocol/server

Schema
zod/v4

Transport
stdio

Database
SQLite

Markdown parser
gray-matter + markdown parser

ID
UUID / ULID

Hash
SHA-256

Test
Vitest
```

项目使用 ESM。

---

## 5. 项目目录

建议创建：

```text
mcp-development/

├── src/
│
│   ├── index.ts
│
│   ├── server/
│   │   ├── create-server.ts
│   │   └── config.ts
│
│   ├── tools/
│   │   ├── search-knowledge.ts
│   │   └── read-knowledge.ts
│
│   ├── knowledge/
│   │   ├── scanner.ts
│   │   ├── markdown-parser.ts
│   │   ├── document.ts
│   │   └── repository.ts
│
│   ├── retrieval/
│   │   ├── retriever.ts
│   │   ├── lexical-retriever.ts
│   │   ├── tokenizer.ts
│   │   └── scorer.ts
│
│   ├── trace/
│   │   ├── recorder.ts
│   │   ├── models.ts
│   │   └── repository.ts
│
│   ├── storage/
│   │   ├── sqlite.ts
│   │   ├── schema.sql
│   │   └── migrations/
│
│   └── common/
│       ├── id.ts
│       ├── hash.ts
│       └── errors.ts
│
├── tests/
│   ├── retrieval/
│   ├── tools/
│   └── trace/
│
├── fixtures/
│   └── wiki/
│
├── data/
│   └── .gitkeep
│
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

---

## 6. 配置

通过环境变量或者配置文件传入：

```text
KNOWLEDGE_ROOT
知识库根目录

TRACE_DB_PATH
SQLite 数据库位置

DEFAULT_TOP_K
默认 8

MAX_TOP_K
默认 10
```

说明：默认 topK 偏宽，是为了给 Agent 保留足够可见候选，避免因为排序偏差导致真答案被截断。真正提升召回质量依靠 Agent 多轮重试，而不是加大 topK 后靠 Agent 自己筛。

例如：

```text
KNOWLEDGE_ROOT=D:/workspace/wiki
TRACE_DB_PATH=D:/workspace/knowledge-mcp/data/trace.db
DEFAULT_TOP_K=8
MAX_TOP_K=10
```

不要在代码中写死 Wiki 路径。

---

## 7. KnowledgeDocument

内部统一把 Markdown 转成：

```ts
interface KnowledgeDocument {
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
```

### knowledgeId

要求：

```text
稳定
唯一
与绝对文件路径解耦
```

优先：

```text
frontmatter.id
```

如果不存在：

```text
relative markdown path 去掉 .md
```

例如：

```text
payment/refund-timeout.md

→

payment/refund-timeout
```

不要使用绝对路径作为 knowledgeId。

### 冲突处理

如果多个 Markdown 文件声明了相同的 `frontmatter.id`，或不同文件推导出相同的 knowledgeId：

```text
索引构建失败
stderr 打印所有冲突的 knowledgeId 与对应绝对路径
进程退出（非 0）
```

不要静默覆盖，也不要自动 rename。冲突必须由知识库维护者显式解决。

---

## 8. Markdown 兼容原则

不能要求现有 Wiki 全部改成某种固定格式。

至少支持：

```markdown
# 退款超时处理

退款超过 24 小时……
```

也支持：

```markdown
---
id: payment-refund-timeout
title: 退款超时处理
summary: 退款超时场景处理规则
tags:
  - payment
  - refund
---

# 退款超时处理
```

字段提取优先级：

```text
title:
frontmatter.title
→ 第一个 H1
→ filename

summary:
frontmatter.summary
→ 可为空

tags:
frontmatter.tags
→ 可为空
```

没有 frontmatter 不能导致文件无法进入索引。

---

## 9. Index 构建

MCP Server 启动时：

```text
扫描 KNOWLEDGE_ROOT
        ↓
找到所有 *.md
        ↓
Parse Markdown
        ↓
生成 KnowledgeDocument
        ↓
计算 contentHash
        ↓
构建内存 Index
```

忽略：

```text
.git
node_modules
隐藏目录
配置指定的 ignore pattern
```

v1 不需要实现实时文件监听。

知识更新后：

```text
重启 MCP
```

即可重新建立索引。

未来再考虑 incremental indexing。

---

## 10. Retriever 抽象

必须定义接口：

```ts
interface Retriever {
  search(
    query: string,
    options: {
      topK: number;
    }
  ): Promise<RetrievalResult[]>;
}
```

返回：

```ts
interface RetrievalResult {
  knowledgeId: string;
  score: number;
  title: string;
  excerpt: string;
}
```

v1 实现：

```text
LexicalRetriever
```

以后才能无痛增加：

```text
BM25Retriever

VectorRetriever

HybridRetriever
```

---

## 11. v1 Retrieval Algorithm

不要追求复杂。

采用 Weighted Lexical Search。

基本字段权重：

```text
title     3.0

heading   2.5

summary   2.0

body      1.0
```

增加 Exact Phrase Bonus。

例如 Query：

```text
退款超时
```

如果 title 为：

```text
退款超时处理规则
```

应明显高于：

```text
支付系统说明
```

即使后者正文中出现一次“退款超时”。

---

## 12. 中文 Tokenization

不能只按照空格 split。

最低支持：

```text
英文：
word tokenization

中文：
CJK bigram + 原始 Query
```

例如：

```text
退款超时
```

可以产生：

```text
退款
款超
超时
退款超时
```

v1 重点是：

```text
简单
可解释
稳定
```

不是追求最佳召回率。

---

## 13. search_knowledge Tool

Tool：

```text
search_knowledge
```

Description：

```text
Search the internal Markdown knowledge base for information
relevant to the current task. Use this tool when internal
domain knowledge, rules, specifications, procedures, or
project documentation may be needed.

If the returned candidates do not clearly match the task,
rewrite the query with alternative wording, synonyms, or
more specific terms, and call this tool again. Multiple
search calls per task are expected and encouraged — the
retrieval engine performs lexical matching only and cannot
resolve paraphrases on its own.
```

Input：

```ts
{
  query: string;
  top_k?: number;
}
```

规则：

```text
query:
trim 后不能为空
trim 后长度 ∈ [1, 512]
超出长度直接 FAILED，error_message 记录原因

top_k:
默认 DEFAULT_TOP_K

最大不能超过 MAX_TOP_K
```

Tokenize 结果为空（例如 query 全是标点或不可分词字符）：

```text
不作为 FAILED
retrieval_query.status = SUCCESS
candidate_count = 0
返回空 results
```

这种情况和 “有 token 但 wiki 里没匹配” 在 trace 上是同一档，都是 NO_HIT。

---

## 14. search_knowledge 返回结构

返回：

```json
{
  "query_id": "q_xxx",
  "results": [
    {
      "candidate_id": "c_xxx",
      "knowledge_id": "payment/refund-timeout",
      "title": "退款超时处理",
      "rank": 1,
      "score": 0.92,
      "excerpt": "退款超过24小时后需要……"
    }
  ]
}
```

`rank` 从 1 开始，即使 results 数组已排序也显式返回，避免 Agent 依赖数组顺序。

这里必须区分三个 ID：

```text
query_id

candidate_id

knowledge_id
```

---

## 15. 为什么需要 candidate_id

这是核心设计。

一次：

```text
Query Q1
```

返回：

```text
Candidate C1 → Knowledge A

Candidate C2 → Knowledge B

Candidate C3 → Knowledge C
```

如果 Agent 随后：

```text
read_knowledge(candidate_id=C1)
```

数据库就可以确定：

```text
Q1
 ↓
C1
 ↓
Knowledge A
 ↓
READ
```

从而不依赖 Agent 自己汇报：

```text
“我使用了 Knowledge A”
```

这是后续所有 Retrieval Analysis 的基础。

---

## 16. read_knowledge Tool

接口：

```text
read_knowledge
```

Description：

```text
Read the full content of a knowledge candidate returned by
search_knowledge. Use the candidate_id returned by a previous
search_knowledge call.
```

Input：

```ts
{
  candidate_id: string;
}
```

Server 内部：

```text
candidate_id
     ↓
retrieval_candidate
     ↓
knowledge_id
     ↓
KnowledgeRepository
     ↓
Markdown Content
```

返回：

```json
{
  "knowledge_id": "payment/refund-timeout",
  "title": "退款超时处理",
  "content": "...",
  "version": "sha256:xxxx"
}
```

---

## 17. 不允许直接读取任意 path

不要设计：

```text
read_knowledge(path)
```

必须优先使用：

```text
candidate_id
```

这样可以避免：

```text
Agent 任意读取文件

../ path traversal

Search 和 Read 无法关联

绕过 Retrieval Trace
```

v1 暂时不提供：

```text
read arbitrary knowledge by knowledgeId
```

---

## 18. Trace 数据模型

SQLite 至少建立四张表。

### knowledge_document

```sql
knowledge_id TEXT PRIMARY KEY
path TEXT NOT NULL
title TEXT NOT NULL
summary TEXT
content_hash TEXT NOT NULL
indexed_at TEXT NOT NULL
deleted_at TEXT
```

说明：

```text
knowledge_document 使用 upsert 语义。
本次索引扫描未发现的记录写 deleted_at，
不物理删除，保证历史 candidate / read 的外键完整性。
```

### retrieval_query

```sql
query_id TEXT PRIMARY KEY

session_id TEXT

query_text TEXT NOT NULL
top_k INTEGER NOT NULL

retrieval_strategy TEXT NOT NULL
index_version TEXT

status TEXT NOT NULL

latency_ms INTEGER

created_at TEXT NOT NULL

error_message TEXT
```

status：

```text
RUNNING
SUCCESS
FAILED
CRASHED
```

说明：

```text
session_id
  由 MCP 层从上下文注入（例如客户端提供的 session/task id）。
  用于聚合同一次任务内的多次 search 行为，是 gap 分析和
  “Agent 换词重试”识别的关键。
  没有可用来源时可以为 NULL。

CRASHED
  仅由 Server 启动时的孤儿 RUNNING 记录扫描器写入。
  不与 FAILED 混淆：FAILED 表示 retriever 主动报错，
  CRASHED 表示进程在检索过程中意外退出。
```

### retrieval_candidate

```sql
candidate_id TEXT PRIMARY KEY

query_id TEXT NOT NULL
knowledge_id TEXT NOT NULL

rank INTEGER NOT NULL
score REAL NOT NULL

title TEXT NOT NULL
excerpt TEXT

retrieval_snapshot_hash TEXT NOT NULL

created_at TEXT NOT NULL
```

Foreign key：

```text
query_id
→ retrieval_query

knowledge_id
→ knowledge_document
```

`retrieval_snapshot_hash` 记录检索发生时该 knowledge 的 content_hash，
用于 read 时对齐版本。

### knowledge_read

```sql
read_id TEXT PRIMARY KEY

candidate_id TEXT NOT NULL
query_id TEXT NOT NULL
knowledge_id TEXT NOT NULL

read_snapshot_hash TEXT NOT NULL

version_changed INTEGER NOT NULL DEFAULT 0

latency_ms INTEGER

created_at TEXT NOT NULL
```

`version_changed` 是派生字段：
`read_snapshot_hash != retrieval_snapshot_hash` 时置 1。

---

## 19. search_knowledge 执行流程

严格按：

```text
收到 MCP Call
      ↓
从 MCP 上下文读取 session_id
（无则记为 NULL）
      ↓
生成 query_id
      ↓
写 retrieval_query
status=RUNNING
      ↓
执行 Retriever.search()
      ↓
生成 Candidate IDs
      ↓
写 retrieval_candidate
每条附 retrieval_snapshot_hash
      ↓
query.status=SUCCESS
      ↓
Commit
      ↓
返回 Agent
```

如果失败：

```text
query.status=FAILED

error_message=xxx
```

即使失败，也必须留下 Query Trace。

崩溃恢复：

```text
Server 启动时扫描 retrieval_query。
将所有 status=RUNNING 且非本进程创建的记录
统一置为 status=CRASHED。
CRASHED 不进入 FAILED 归因样本。
```

---

## 20. read_knowledge 执行流程

```text
收到 candidate_id
      ↓
查询 Candidate
      ↓
获取 knowledge_id
      ↓
检查 knowledge_document.deleted_at
      ↓
读取 Markdown
      ↓
重新计算 contentHash（作为 read_snapshot_hash）
      ↓
与 candidate.retrieval_snapshot_hash 比较
      ↓
写 knowledge_read
      ↓
返回 Content
```

如果：

```text
read_snapshot_hash != retrieval_snapshot_hash
```

记录：

```text
version_changed = 1
```

同时返回 warning：

```text
Knowledge changed after retrieval.
```

如果 `knowledge_document.deleted_at` 非空或文件已从磁盘消失：

```text
仍然写入 knowledge_read
（read_snapshot_hash 记为空串或占位值，
 由 version_changed=1 表达“不可读”）

返回 error 结构：
{
  "error": "KNOWLEDGE_GONE",
  "knowledge_id": "..."
}
```

这样 Read 行为本身仍然被完整记录，可分析“被引用但已消失”的知识条目。

---

## 21. Knowledge Version

v1：

```text
SHA256(markdown content)
```

作为：

```text
knowledge_version
```

如果知识库本身在 Git Repository：

允许额外记录：

```text
git_commit_sha
```

但不是 v1 强依赖。

目标是确保未来能够知道：

> Agent 当时检索到的是哪一个版本的知识。

---

## 22. Excerpt 生成

Excerpt 不应该直接返回整个 Markdown。

v1 锁定实现：

```text
1. 对 body 内容做 tokenize
2. 找到第一个 query token 命中的位置
3. 取该位置前 200 字符 + 命中词 + 后 400 字符
4. 前后边界向最近的句号 / 换行截断，避免半句
5. 全文都没命中时，返回 body 前 300 字符
```

硬上限：

```text
600 chars（约 300~800 之间的中位选择）
```

不同实现必须产生相同 excerpt，保证 §29 验收场景可复现。

完整正文只能通过：

```text
read_knowledge
```

获取。

---

## 23. 空结果

如果没有合理 Candidate：

返回：

```json
{
  "query_id": "q_xxx",
  "results": []
}
```

不要强行返回低质量内容。

数据库正常记录：

```text
SUCCESS
candidate_count = 0
```

以后可以直接分析：

```text
NO_HIT Query
```

---

## 24. Score

Score 只用于：

```text
同一 Retrieval Strategy 内排序
```

第一版不要承诺：

```text
0.9 = 90% 正确
```

Score 不代表 Probability。

README 中明确说明：

> Retrieval score is strategy-specific and should only be interpreted as a ranking signal.

---

## 25. 安全

Knowledge MCP 是只读 MCP。

只允许：

```text
search
read
```

禁止：

```text
write
delete
rename
modify
execute
```

Markdown path 必须：

```text
resolve()
↓
canonicalize
↓
确认仍位于 KNOWLEDGE_ROOT
```

任何超出根目录的文件访问必须拒绝。

不要把绝对文件路径返回给 Agent。

---

## 26. stdio 注意事项

MCP 使用 stdio 时：

```text
stdout
```

只能用于 MCP Protocol。

日志必须使用：

```text
stderr
```

例如：

```ts
console.error("knowledge MCP started");
```

禁止：

```ts
console.log(...)
```

避免破坏 MCP JSON-RPC 通道。

---

## 27. 测试

至少实现以下测试。

### Markdown Parser

验证：

```text
有 frontmatter
无 frontmatter
无 H1
中文标题
重复标题
```

### Retrieval

构造至少 10～20 篇 fixture Markdown。

测试：

```text
Title exact match

Heading match

Body match

中文 Query

英文 Query

No hit

TopK
```

### Trace

验证：

```text
每次 Query 必须生成 query_id

Candidates 正确关联 Query

Read 正确关联 Candidate

Failed Query 仍落库

孤儿 RUNNING 记录启动后被置为 CRASHED

同 session_id 下的多次 search 可查询聚合

Knowledge version 正确

retrieval_snapshot_hash 与 read_snapshot_hash 记录并可比较

软删 knowledge 后 read 仍写 trace 并返回 KNOWLEDGE_GONE
```

### Security

验证：

```text
非法 candidate_id

不存在 Knowledge

../ traversal

Knowledge Root 之外文件

文件删除
```

---

## 28. MCP Integration Test

使用 MCP Inspector 验证：

```text
Server 初始化成功

search_knowledge 能被发现

read_knowledge 能被发现

Input Schema 正确

Tool 正常返回

错误参数正常失败
```

然后接入 Codex。

---

## 29. Codex 验收场景

准备知识：

```text
payment/
  refund.md
  refund-timeout.md
  payment-error.md
```

向 Codex 提问：

```text
请查一下内部知识，退款超过 24 小时应该怎么处理？
```

期望：

```text
Codex
 ↓
search_knowledge
 ↓
返回 Candidate
 ↓
read_knowledge
 ↓
回答用户
```

SQLite 中必须出现：

```text
retrieval_query     1+

retrieval_candidate 1+

knowledge_read      1+
```

并且：

```text
knowledge_read.candidate_id
```

能够完整追溯到：

```text
Query
→ Candidate
→ Knowledge
```

---

## 30. README 必须包含

README 至少写：

```text
项目目的

架构

安装方式

环境变量

启动方式

Codex MCP 配置

Tool 定义

数据库结构

示例调用

测试方式

当前限制
```

并明确：

```text
v1 currently uses lexical retrieval.

The retrieval implementation is replaceable.

The MCP API should remain stable when the retrieval engine changes.
```

---

## 31. 实施顺序

请按照下面顺序开发，不要同时展开多个高级功能：

```text
Step 1
初始化 TypeScript + MCP Server

Step 2
实现 search_knowledge Mock

Step 3
确认 Codex / MCP Inspector 可调用

Step 4
实现 Markdown Scanner / Parser

Step 5
实现 LexicalRetriever

Step 6
实现真实 search_knowledge

Step 7
实现 SQLite Schema

Step 8
加入 Query / Candidate Trace

Step 9
实现 read_knowledge

Step 10
加入 KnowledgeRead Trace

Step 11
加入 Version Check + 孤儿 RUNNING → CRASHED 恢复扫描

Step 12
补测试

Step 13
Codex End-to-End Test
```

---

## 32. 不要做的事情

在完成 v1 验收前不要：

```text
引入 LangChain

引入 LangGraph

引入 Vector Database

调用 Embedding API

加入 LLM Judge

加入复杂 Agent

开发 Web UI

开发 Dashboard

引入 OpenTelemetry

开发 Knowledge Writer

自动修改 Wiki

重构现有 Markdown Wiki
```

如果发现这些能力可能有价值，在 README 的 Future Work 中记录即可。

---

## 33. Definition of Done

项目只有满足以下条件才算 v1 完成：

```text
Codex 可以连接 MCP

Codex 可以发现两个 Tool

search_knowledge 可以真实检索现有 Markdown Wiki

Search 返回 query_id

每个结果都有 candidate_id 与显式 rank

read_knowledge 必须通过 candidate_id 工作

Query / Candidate / Read 全部结构化落库

可以从 Read 反查到 Candidate 和 Query

同一次任务内的多次 search 可以通过 session_id 聚合

Knowledge Version 被记录
retrieval_snapshot_hash 与 read_snapshot_hash 一致性可校验

Search 失败仍有 Trace
Server 崩溃产生的孤儿 RUNNING 记录可被恢复为 CRASHED

knowledgeId 冲突导致启动失败并输出可诊断信息

已被软删的 knowledge 仍然能记录 read 行为并返回 KNOWLEDGE_GONE

不能读取 Wiki Root 外的文件

基本测试通过

README 可以让新的开发者独立启动项目
```

所有时间字段：

```text
统一使用 ISO 8601 UTC，例如 2026-09-24T10:00:00Z
```

---

## 34. 核心设计约束

开发过程中始终保持：

```text
Agent Interface
       │
       ▼
search_knowledge
read_knowledge

       │
       ▼
Retrieval Engine

       │
       ▼
Markdown Wiki
```

同时旁路：

```text
Retrieval Event
       ↓
Structured Trace DB
```

不要让：

```text
MCP
Retriever
Trace
Markdown Storage
```

互相强耦合。

最终我们需要的是：

> 一个稳定的 Knowledge MCP Contract，一个可替换的 Retrieval Engine，以及一套可信的 Query → Candidate → Read 数据链路。

这三部分是 v1 最核心的产物。
