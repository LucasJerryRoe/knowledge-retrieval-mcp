# Knowledge Retrieval MCP

面向 Codex 等通用 Agent 的只读 Markdown 知识检索 MCP，对外提供
`search_knowledge` 和 `read_knowledge`，并在 SQLite 中记录完整的
Query → Candidate → Read 链路。

设计方案见 [docs/knowledge_retrieval_mcp_v1.md](./docs/knowledge_retrieval_mcp_v1.md)。

## 架构

```text
Codex / MCP Client
        |
        | stdio
        v
MCP Tools -----> KnowledgeRuntime
                    |       |
                    v       v
            LexicalRetriever  TraceRepository
                    |             |
                    v             v
              Markdown Wiki     SQLite
```

MCP 层、检索层、知识仓储和 Trace 持久化相互解耦。v1 currently uses
lexical retrieval. The retrieval implementation is replaceable. The MCP API
should remain stable when the retrieval engine changes.

## 环境要求

- Node.js >= 20
- 本地可读的 Markdown 知识库目录

## 安装与构建

```bash
npm install
npm run build
```

## 配置

| 环境变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `KNOWLEDGE_ROOT` | 是 | - | Markdown 知识库绝对路径 |
| `TRACE_DB_PATH` | 是 | - | SQLite 文件路径 |
| `DEFAULT_TOP_K` | 否 | `8` | 默认候选数量 |
| `MAX_TOP_K` | 否 | `10` | 允许请求的最大候选数量 |

```bash
export KNOWLEDGE_ROOT=/absolute/path/to/wiki
export TRACE_DB_PATH=/absolute/path/to/data/trace.db
npm run start
```

开发模式可使用 `npm run dev`。stdio 的 stdout 专用于 MCP 协议，运行日志只写
stderr。

## Codex MCP 配置

```toml
[mcp_servers.knowledge]
command = "node"
args = ["/absolute/path/to/mcp-development/dist/index.js"]

[mcp_servers.knowledge.env]
KNOWLEDGE_ROOT = "/absolute/path/to/wiki"
TRACE_DB_PATH = "/absolute/path/to/mcp-development/data/trace.db"
DEFAULT_TOP_K = "8"
MAX_TOP_K = "10"
```

也可用 MCP Inspector 检查 Tool 发现与调用：

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Tool 定义

### `search_knowledge`

输入：

```json
{"query":"退款超过 24 小时如何处理","top_k":8}
```

输出正文：

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

查询去除首尾空白后必须为 1-512 个字符。`top_k` 必须位于
`1..MAX_TOP_K`。纯标点等不可分词查询会成功返回空结果。

### `read_knowledge`

输入：

```json
{"candidate_id":"c_..."}
```

输出正文：

```json
{
  "knowledge_id": "payment/refund-timeout",
  "title": "退款超时处理",
  "content": "...",
  "version": "sha256:..."
}
```

只能读取 `search_knowledge` 返回的 `candidate_id`，不能传文件路径或
`knowledge_id`。若检索后文件发生变化，返回 `warning`；若文件已删除，返回
`KNOWLEDGE_GONE`，两种情况均写入 Read Trace。

## 检索行为

- 标题、标题层级、摘要、正文权重分别为 `3.0 / 2.5 / 2.0 / 1.0`
- 支持英文单词与中文 CJK bigram
- 标题、标题层级、摘要和正文包含完整查询短语时额外加分
- 只返回分数大于 0 的候选
- 同分时按 `knowledge_id` 排序，保证结果稳定
- 摘要硬上限为 600 字符

Retrieval score is strategy-specific and should only be interpreted as a
ranking signal. 它不是概率，也不能跨检索策略直接比较。

## 数据库

`knowledge_document` 保存当前及软删除的知识元数据；`retrieval_query` 保存
查询状态与会话；`retrieval_candidate` 保存排名及检索时版本；
`knowledge_read` 保存实际读取版本。

```text
retrieval_query 1 --- N retrieval_candidate 1 --- N knowledge_read
                             |
                             N
                             |
                     knowledge_document
```

服务启动时会把遗留的 `RUNNING` 查询标记为 `CRASHED`，并将本次扫描未发现的
知识标记为软删除。数据库定义见
[src/storage/schema.sql](./src/storage/schema.sql)。

## 测试

```bash
npm test
npm run typecheck
npm run build
```

测试覆盖 Markdown 字段优先级、ID 冲突、中英文检索、TopK、无命中、
Query/Candidate/Read 关联、失败留痕、版本变化、软删除、崩溃恢复和根目录边界。

## 当前限制

- 仅支持启动时全量扫描，知识变化后需重启服务才能更新索引
- 仅支持加权词法检索，不包含向量、Embedding、Reranker 或 LLM Judge
- stdio 场景没有客户端会话标识时，`session_id` 为 NULL；客户端可通过请求
  `_meta.session_id` 注入
- 不提供知识写入、文件监听、Dashboard 或复杂权限系统
