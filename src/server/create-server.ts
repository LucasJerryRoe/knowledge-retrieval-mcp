import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { searchKnowledgeTool, handleSearchKnowledge } from "../tools/search-knowledge.js";
import { readKnowledgeTool, handleReadKnowledge } from "../tools/read-knowledge.js";
import type { KnowledgeRuntime } from "./runtime.js";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function createServer(runtime: KnowledgeRuntime): Server {
  const server = new Server(
    {
      name: "knowledge-retrieval-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [searchKnowledgeTool, readKnowledgeTool],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case searchKnowledgeTool.name: {
          const rawSessionId = request.params._meta?.session_id;
          const sessionId =
            typeof rawSessionId === "string" ? rawSessionId : undefined;
          return await handleSearchKnowledge(args ?? {}, runtime, sessionId);
        }
        case readKnowledgeTool.name:
          return await handleReadKnowledge(args ?? {}, runtime);
        default:
          return errorResponse(new Error(`Unknown tool: ${name}`));
      }
    } catch (error) {
      return errorResponse(error);
    }
  });

  return server;
}
