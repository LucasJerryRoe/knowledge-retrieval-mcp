import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "./config.js";
import { searchKnowledgeTool, handleSearchKnowledge } from "../tools/search-knowledge.js";
import { readKnowledgeTool, handleReadKnowledge } from "../tools/read-knowledge.js";

export function createServer(config: Config): Server {
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
    switch (name) {
      case searchKnowledgeTool.name:
        return handleSearchKnowledge(args ?? {}, config);
      case readKnowledgeTool.name:
        return handleReadKnowledge(args ?? {}, config);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}
