/**
 * AI-NATIVE-02 C3-b — start the loopback bridge for a HUMAN-authorized link.
 *
 * Credential safety: the token is generated locally and written to a
 * restricted file; it is NEVER printed to stdout/stderr, never put in a URL
 * and never shown in a screenshot. Consumers read it from the same file via
 * LAST_SIGNAL_WORLD_TOKEN_FILE.
 *
 * Usage:
 *   npx vite-node scripts/c3b-bridge.mts
 *   # prints BRIDGE_URL and TOKEN_FILE only
 *   # in the rendered game, the HUMAN injects the config and clicks
 *   # AUTHORIZE EXTERNAL AGENT in the Pause menu; then start the MCP --world
 *   # server with LAST_SIGNAL_WORLD_BRIDGE_URL / LAST_SIGNAL_WORLD_TOKEN_FILE.
 */
import { randomBytes } from 'node:crypto';
import { writeFile, chmod, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { WorldGateway } from '../src/ai-native/worldGateway';

const PORT = Number(process.env.LAST_SIGNAL_WORLD_PORT ?? 0);
const ORIGIN = process.env.LAST_SIGNAL_WORLD_ORIGIN ?? 'http://localhost:5173';
const TOKEN_FILE = resolve(
  process.env.LAST_SIGNAL_WORLD_TOKEN_FILE ?? 'reports/ai-native-02/c3b/.bridge-token'
);
const existingToken = process.env.LAST_SIGNAL_WORLD_TOKEN ?? '';

async function main(): Promise<void> {
  const token = existingToken || randomBytes(32).toString('hex');
  await mkdir(dirname(TOKEN_FILE), { recursive: true });
  await writeFile(TOKEN_FILE, token, { mode: 0o600 });
  try { await chmod(TOKEN_FILE, 0o600); } catch { /* Windows: best effort */ }

  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({
    gateway,
    token,
    allowedOrigins: [ORIGIN],
    ...(PORT > 0 ? { port: PORT } : {})
  });

  // Only non-secret values are logged.
  process.stdout.write(`BRIDGE_URL=${bridge.url}\n`);
  process.stdout.write(`ORIGIN=${ORIGIN}\n`);
  process.stdout.write(`TOKEN_FILE=${TOKEN_FILE}\n`);
  process.stdout.write('TOKEN=<redacted; read from TOKEN_FILE; never logged>\n');
  process.stdout.write('HUMAN_ACTION_REQUIRED=click AUTHORIZE EXTERNAL AGENT in the Pause menu\n');

  const stop = async (): Promise<void> => {
    await bridge.close();
    process.exit(0);
  };
  process.on('SIGINT', () => { void stop(); });
  process.on('SIGTERM', () => { void stop(); });
  process.stdin.on('end', () => { void stop(); });
  // Keep the process alive.
  await new Promise<void>(() => undefined);
}

main().catch((error) => {
  process.stderr.write(`FAIL bridge: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
