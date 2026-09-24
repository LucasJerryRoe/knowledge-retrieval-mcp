#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./server/config.js";
import { createServer } from "./server/create-server.js";

async function main() {
  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("knowledge-retrieval-mcp started");
}

main().catch((err) => {
  console.error("knowledge-retrieval-mcp failed to start:", err);
  process.exit(1);
});
