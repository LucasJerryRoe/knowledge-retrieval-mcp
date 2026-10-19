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

## 环境要求

- Node.js >= 20
- 一份本地可读的 Markdown 知识库目录

## 安装与构建

```bash
cd knowledge-retrieval-mcp
npm install
npm run build
```

## 配置

通过环境变量注入：

| 环境变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `KNOWLEDGE_ROOT` | 是 | - | Markdown 知识库根目录的绝对路径 |
| `TRACE_DB_PATH` | 是 | - | SQLite trace 数据库文件路径 |
| `DEFAULT_TOP_K` | 否 | `20` | 未传 `top_k` 时的候选数量 |
| `MAX_TOP_K` | 否 | `30` | 允许请求的最大候选数量 |

`DEFAULT_TOP_K` 必须不大于 `MAX_TOP_K`。

## 接入 MCP 客户端

Codex（`config.toml`）：

```toml
[mcp_servers.knowledge]
command = "node"
args = ["/absolute/path/to/knowledge-retrieval-mcp/dist/index.js"]

[mcp_servers.knowledge.env]
KNOWLEDGE_ROOT = "/absolute/path/to/wiki"
TRACE_DB_PATH = "/absolute/path/to/knowledge-retrieval-mcp/data/trace.db"
```

Trae / Claude 等使用 JSON 配置的客户端：

```json
{
  "mcpServers": {
    "knowledge-retrieval": {
      "command": "node",
      "args": ["/absolute/path/to/knowledge-retrieval-mcp/dist/index.js"],
      "env": {
        "KNOWLEDGE_ROOT": "/absolute/path/to/wiki",
        "TRACE_DB_PATH": "/absolute/path/to/knowledge-retrieval-mcp/data/trace.db"
      }
    }
  }
}
```

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

## 检索质量分析看板

```bash
TRACE_DB_PATH=/absolute/path/to/data/trace.db npm run dashboard
# http://localhost:3100   （可用 PORT 覆盖端口）
```

看板按 任务 / 搜索 / 文档 维度展示检索情况，核心判定：

| 现象 | 判定 | 含义 |
| --- | --- | --- |
| 召回但未被阅读 | - | 摘要/标题不足以判断，或检索词偏差 |
| 读取全文但无 evidence | **知识缺失** | 检索词合理但知识库缺该主题内容，需补充 Wiki |
| 读取全文且有 evidence | 有效 | 检索与内容均匹配 |

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
