# knowledge-retrieval-mcp

面向 Agent 的只读 Markdown 知识检索 MCP。对外提供 `search_knowledge`、`read_knowledge`、
`cite_evidence` 三个工具，并在 SQLite 中记录完整的 检索 → 阅读 → 引用 链路，
用于诊断知识库的覆盖质量。

设计文档见 [docs/knowledge_retrieval_mcp_v1.md](./docs/knowledge_retrieval_mcp_v1.md)。

## 为什么优先用它而不是 grep

裸 grep 只能做扁平的全文关键词匹配。本 MCP 在其之上提供了：

- **分层加权排序**：标题 3.0 / 小标题 2.5 / 摘要 2.0 / 正文 1.0，完整短语命中额外加分
- **直接返回摘要片段**：无需逐个打开文件即可判断相关性
- **语义类型过滤**：`entity`（数据模型、字段、API）或 `concept`（工作流、规则、流程）
- **全链路留痕**：每次 检索 → 阅读 → 引用 都落库，可事后按任务分析检索质量

## 架构

```text
MCP Client (Codex / Trae / ...)
        |
        | stdio
        v
MCP Tools ----> KnowledgeRuntime
                  |        |
                  v        v
        LexicalRetriever  TraceRepository
                  |            |
                  v            v
            Markdown Wiki   SQLite
```

MCP 层、检索层、知识仓储与 Trace 持久化相互解耦。检索实现可替换，
替换检索引擎时 MCP 接口保持不变。

## 安装与配置

使用者只需要准备 Node.js 和一份本地 Markdown 知识库。不需要安装或启动 MySQL、
PostgreSQL 等数据库服务。

### 1. 安装

要求 Node.js >= 20。克隆仓库后，安装依赖并构建：

```bash
git clone git@code.byted.org:motor_qa/mcp-development.git
cd mcp-development/knowledge-retrieval-mcp
npm install
npm run build
```

### 2. 准备两个本地路径

| 路径 | 示例 | 用途 |
| --- | --- | --- |
| 知识库路径 | `/Users/me/wiki` | 存放 Markdown 文档的目录。MCP 只读取此目录，不修改原文。 |
| 留痕库路径 | `/Users/me/.knowledge-retrieval/trace.db` | 保存搜索、候选、阅读与证据引用记录的 SQLite 文件。文件及不存在的父目录会自动创建。 |

留痕库是本机 SQLite 文件，不需要单独安装数据库。运行期间同目录还可能出现
`trace.db-wal` 与 `trace.db-shm`，它们是 SQLite 的运行时辅助文件，应与
`trace.db` 一起保留。

### 3. 在 MCP 客户端中配置

把上面的两个路径分别填入 `KNOWLEDGE_ROOT` 和 `TRACE_DB_PATH`：

| 环境变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `KNOWLEDGE_ROOT` | 是 | - | Markdown 知识库根目录的绝对路径 |
| `TRACE_DB_PATH` | 是 | - | SQLite 留痕库文件的绝对路径，可指向尚不存在的新文件 |
| `DEFAULT_TOP_K` | 否 | `20` | 未传 `top_k` 时的候选数量 |
| `MAX_TOP_K` | 否 | `30` | 允许请求的最大候选数量 |

`DEFAULT_TOP_K` 必须不大于 `MAX_TOP_K`。

### 4. 接入客户端

以下示例假设 MCP 安装在 `/Users/me/mcp-development/knowledge-retrieval-mcp`，
知识库位于 `/Users/me/wiki`。将路径替换为自己的实际位置。

Codex（`config.toml`）：

```toml
[mcp_servers.knowledge]
command = "node"
args = ["/Users/me/mcp-development/knowledge-retrieval-mcp/dist/index.js"]

[mcp_servers.knowledge.env]
KNOWLEDGE_ROOT = "/Users/me/wiki"
TRACE_DB_PATH = "/Users/me/.knowledge-retrieval/trace.db"
```

Trae / Claude 等使用 JSON 配置的客户端：

```json
{
  "mcpServers": {
    "knowledge-retrieval": {
      "command": "node",
      "args": ["/Users/me/mcp-development/knowledge-retrieval-mcp/dist/index.js"],
      "env": {
        "KNOWLEDGE_ROOT": "/Users/me/wiki",
        "TRACE_DB_PATH": "/Users/me/.knowledge-retrieval/trace.db"
      }
    }
  }
}
```

配置保存并重启 MCP 客户端后，即可调用 `search_knowledge`。

开发模式用 `npm run dev`。用 MCP Inspector 检查工具发现与调用：

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

stdio 场景下 stdout 专用于 MCP 协议，运行日志只写 stderr。

## 工具定义

### `search_knowledge`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `query` | 是 | 查询词，去首尾空白后 1-512 字符 |
| `task_id` | 是 | 调查任务标识，同一主题的多次搜索传同一个值，作为质量分析的聚合键 |
| `top_k` | 否 | 候选数量，需在 `1..MAX_TOP_K` 内 |
| `type` | 否 | `entity` 或 `concept`；不传则搜索所有类型 |

返回：

```json
{
  "query_id": "q_...",
  "results": [
    {
      "candidate_id": "c_...",
      "knowledge_id": "payment/refund-timeout",
      "title": "退款超时处理",
      "rank": 1,
      "score": 31,
      "excerpt": "退款超过 24 小时..."
    }
  ]
}
```

### `read_knowledge`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `candidate_id` | 是 | 上一次 `search_knowledge` 返回的 `candidate_id` |

只能传 `candidate_id`，不能传文件路径或 `knowledge_id`。检索后文档若已变化，
返回 `warning`；若已删除，返回 `KNOWLEDGE_GONE`。两种情况均写入 Trace。

### `cite_evidence`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `candidate_id` | 是 | 已读取的候选 |
| `line_start` / `line_end` | 是 | 被引用段落的起止行号（从 1 开始，含） |
| `snippet` | 是 | 被引用的原文内容 |
| `reason` | 否 | 选取该段作为证据的原因 |

记录答案引用了文档中的哪些行，形成从搜索到引用的完整证据链。每条证据调用一次。

## 检索行为

- 标题、小标题、摘要、正文权重分别为 `3.0 / 2.5 / 2.0 / 1.0`
- 标题、小标题、摘要、正文包含完整查询短语时额外加分
- 支持英文单词与中文 CJK bigram 分词
- 只返回分数大于 0 的候选
- 同分时按 `knowledge_id` 排序，保证结果稳定
- 摘要片段硬上限 600 字符

分数只是排序信号，不是概率，也不能跨检索策略或跨查询直接比较。

## Trace 数据表

| 表 | 内容 |
| --- | --- |
| `knowledge_document` | 知识文档元数据（含软删除标记） |
| `knowledge_task` | 按 `task_id` 聚合的调查任务，含任务描述 |
| `knowledge_search` | 每次搜索（query、task_id、会话） |
| `knowledge_candidate` | 每次搜索召回并排序的候选 |
| `document_read` | 实际读取的文档及其版本 |
| `evidence` | 最终引用的原文行 |

```text
knowledge_task 1---N knowledge_search 1---N knowledge_candidate
                                              |
                                              N
                                              |
                     knowledge_document <---- document_read 1---N evidence
```

服务启动时会把遗留的 `RUNNING` 搜索标记为 `CRASHED`，并把本次扫描未发现的知识标记为软删除。
库表定义见 [src/storage/schema.sql](./src/storage/schema.sql)。

## 查看检索情况

每次 `search_knowledge`、`read_knowledge` 和 `cite_evidence` 调用都会写入
`TRACE_DB_PATH` 指向的留痕库。可通过实时看板或 SQLite 命令行查看。

### 实时看板

在 MCP 项目目录启动看板，并把 `TRACE_DB_PATH` 替换为配置给 MCP 的同一路径：

```bash
cd /Users/me/mcp-development/knowledge-retrieval-mcp
TRACE_DB_PATH=/Users/me/.knowledge-retrieval/trace.db npm run dashboard
```

浏览器打开 `http://localhost:3100`。服务默认使用端口 `3100`；端口冲突时可指定
其他端口：

```bash
PORT=3101 TRACE_DB_PATH=/Users/me/.knowledge-retrieval/trace.db npm run dashboard
```

看板按任务、搜索和文档维度展示检索情况。重点查看「质量分析」页中的每一条搜索：

| 现象 | 判定 | 含义 |
| --- | --- | --- |
| 召回但未被阅读 | - | 摘要/标题不足以判断，或检索词偏差 |
| 读取全文但无 evidence | **知识缺失** | 检索词合理但知识库缺该主题内容，需补充 Wiki |
| 读取全文且有 evidence | 有效 | 检索与内容均匹配 |

### 命令行查询

安装了 SQLite 命令行工具时，可直接打开同一个文件：

```bash
sqlite3 /Users/me/.knowledge-retrieval/trace.db
```

例如，查看最近的搜索及其候选、阅读和证据数量：

```sql
SELECT
  s.created_at,
  s.task_id,
  s.query_text,
  s.candidate_count,
  COUNT(DISTINCT r.read_id) AS read_count,
  COUNT(DISTINCT e.evidence_id) AS evidence_count
FROM knowledge_search AS s
LEFT JOIN document_read AS r ON r.search_id = s.search_id
LEFT JOIN evidence AS e ON e.read_id = r.read_id
GROUP BY s.search_id
ORDER BY s.created_at DESC
LIMIT 20;
```

`evidence_count = 0` 且 `read_count > 0` 的搜索，表示 Agent 已读过候选全文但没有
引用到有效内容，是排查知识缺失的主要入口。

## 测试

```bash
npm test          # vitest
npm run typecheck
npm run build
```

## 已知限制

- 仅支持启动时全量扫描，知识变更后需重启服务才能刷新索引
- 仅加权词法检索，不包含向量、Embedding、Reranker 或 LLM 判断
- 不提供知识写入、文件监听或权限系统
