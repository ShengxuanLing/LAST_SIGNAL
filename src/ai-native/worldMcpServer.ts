/**
 * AI-NATIVE-02 C3-b — core-free official WORLD MCP server binary.
 *
 *   node dist-mcp/worldMcpServer.mjs
 *
 * Only the four --world tools are registered. This entry imports no
 * simulation core at all: no second SimulationState, no stepFrame, no Scene
 * writes. The rendered browser is the sole authority.
 */
import { startWorldMcpServer } from './worldMcpTools';

startWorldMcpServer().catch((error) => {
  process.stderr.write(`[world-mcp] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
