# MCP Development

面向 QA / 研发场景的 MCP 服务集合。每个 MCP 独立为一个子目录，各自安装、构建与运行，互不依赖。

## 目录结构

```text
mcp-development/
└── knowledge-retrieval-mcp/     # 只读 Markdown 知识检索 MCP
```

## MCP 列表

| MCP | 说明 |
| --- | --- |
| [knowledge-retrieval-mcp](./knowledge-retrieval-mcp/) | 在 Markdown 知识库上做加权词法检索，记录 检索 → 阅读 → 引用 全链路 Trace，并提供检索质量分析看板 |

## 环境要求

- Node.js >= 20

各 MCP 的安装、配置与使用方式见其子目录内的 README。
