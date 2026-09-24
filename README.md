# Knowledge Retrieval MCP

Knowledge Retrieval MCP Server (v1). Provides `search_knowledge` and `read_knowledge` tools over a Markdown knowledge base, and records the full query → candidate → read trace into SQLite.

The design goal is **stable and verifiable recording of an Agent's knowledge retrieval behavior**, not maximum retrieval quality. v1 uses weighted lexical retrieval and relies on Agent-side query rewriting for recall.

Design doc: see `docs/knowledge_retrieval_mcp_v1.md` in the qa_skill_repo, or copy that file into this repo's `docs/` if working stand-alone.

## Status

Skeleton only. Steps 1-3 of the implementation plan (TS project init, MCP server boot, tool discovery via Inspector) are in place. Retrieval, storage, and trace layers are TODO.

## Requirements

- Node.js >= 20

## Getting Started

```bash
npm install

export KNOWLEDGE_ROOT=/absolute/path/to/wiki
export TRACE_DB_PATH=/absolute/path/to/data/trace.db
export DEFAULT_TOP_K=8
export MAX_TOP_K=10

npm run dev    # tsx runs src/index.ts directly
```

## Verify with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

You should see two tools: `search_knowledge` and `read_knowledge`.

## Scripts

- `npm run build` - compile TS to `dist/`
- `npm run dev` - run with tsx (no build step)
- `npm run start` - run compiled output
- `npm run typecheck` - typecheck only
- `npm test` - vitest

## Layout

```
src/
  index.ts                # MCP entry (stdio)
  server/
    config.ts             # env-var config
    create-server.ts      # MCP Server + tool wiring
  tools/
    search-knowledge.ts
    read-knowledge.ts
  knowledge/              # scanner / parser / repository (TODO)
  retrieval/              # retriever + lexical impl (TODO)
  trace/                  # recorder + models + repository (TODO)
  storage/                # sqlite + schema + migrations (TODO)
  common/                 # id / hash / errors (TODO)
tests/                    # vitest
fixtures/wiki/            # sample markdown fixtures
data/                     # runtime sqlite (gitignored)
```

## Notes

- stdio transport: all logs must go to `stderr`, not `stdout`.
- v1 retrieval is intentionally simple. Recall quality relies on Agent-side multi-turn query rewriting; the tool description in `search_knowledge` explicitly encourages it.

## Future Work

Vector DB, embeddings, hybrid search, LLM judge, evidence binding, real-time file watching, and dashboards are explicitly out of scope for v1.
