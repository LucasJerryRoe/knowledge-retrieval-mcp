# Knowledge Retrieval MCP

让 AI 助手真正用好你的本地知识库：在 Markdown 文档中检索相关内容、读取原文、引用准确证据，并留下完整可追溯的检索链路。

这是一个 local-first 的 MCP 工具，不上传你的知识库，也不依赖外部数据库。它适合个人笔记、团队 Wiki、产品文档、技术方案和任何希望被 Agent 稳定使用的 Markdown 内容。

## 目录结构

```text
knowledge-retrieval-mcp/         # repository root
└── knowledge-retrieval-mcp/     # Markdown 知识检索与证据链 MCP
```

## MCP 列表

| MCP | 说明 |
| --- | --- |
| [knowledge-retrieval-mcp](./knowledge-retrieval-mcp/) | 在本地 Markdown 知识库上完成检索 → 阅读 → 引用，并记录可审计的证据链 |

## 环境要求

- Node.js >= 20

详细安装、配置与使用方式见 [knowledge-retrieval-mcp/README.md](./knowledge-retrieval-mcp/README.md)。

本项目使用 [MIT License](./LICENSE)。
