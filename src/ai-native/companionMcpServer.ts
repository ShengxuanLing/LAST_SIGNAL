/** Official COMPANION MCP stdio binary: node dist-mcp/companionMcpServer.mjs */
import { startCompanionMcpServer } from './companionMcpTools';

startCompanionMcpServer().catch((error) => {
  process.stderr.write(`[companion-mcp] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
