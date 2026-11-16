/**
 * AI-NATIVE-02 C3-c — official HEADLESS same-core WORLD MCP server.
 *
 *   node dist-mcp/worldHeadlessMcpServer.mjs           # Player surface
 *   node dist-mcp/worldHeadlessMcpServer.mjs --dev     # + Dev/OWNER surface
 *
 * It owns REAL `SimulationState` instances built from `src/world/sim/core.ts`
 * + the real `MapGenerator` + real config. No Phaser, no DOM, no browser.
 * Player tools never accept a seed / fixture / HP write; those exist only on
 * the `--dev` surface.
 */
import { startWorldHeadlessMcpServer } from './worldHeadlessMcpTools';

startWorldHeadlessMcpServer(process.argv.slice(2).includes('--dev')).catch((error) => {
  process.stderr.write(`[world-headless-mcp] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
