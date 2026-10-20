import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import "../env";
import { buildMcpServer } from "./server";

// For MCP clients that launch servers as a subprocess (e.g. Claude Desktop):
//   { "command": "npm", "args": ["run", "mcp:stdio", "--prefix", "<repo>/apps/api"] }
// stdout carries the protocol, so all logging goes to stderr.
console.log = (...args: unknown[]) => console.error(...args);

const server = buildMcpServer();
await server.connect(new StdioServerTransport());
console.error("AgentGuard MCP server running on stdio");
