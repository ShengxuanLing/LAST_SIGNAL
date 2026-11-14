/**
 * AI-NATIVE-02 C3-b — official MCP `--world` surface smoke.
 *
 * This verifies the INTERFACE only (tool registration, protocol framing,
 * session/permission errors). It is NOT an LLM playthrough and it never
 * claims to be one.
 *
 * Run: npm run game:mcp:build && npx vite-node src/ai-native/worldMcpSmoke.mts
 */
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO = process.cwd();
// The core-free official WORLD binary; the legacy flag form is checked too.
const WORLD_SERVER = resolve(REPO, 'dist-mcp/worldMcpServer.mjs');
const FLAG_SERVER = resolve(REPO, 'dist-mcp/mcpServer.mjs');

function log(message: string, data?: unknown): void {
  process.stdout.write(`${message}${data === undefined ? '' : ` | ${JSON.stringify(data)}`}\n`);
}
function fail(message: string, data?: unknown): never {
  process.stderr.write(`FAIL ${message}${data === undefined ? '' : ` | ${JSON.stringify(data)}`}\n`);
  process.exit(1);
}
function assert(condition: unknown, message: string, data?: unknown): asserts condition {
  if (!condition) fail(message, data);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  // 1) --world without the bridge configuration must fail fast (no half-open).
  const missing = new StdioClientTransport({
    command: process.execPath,
    args: [WORLD_SERVER],
    env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: '', LAST_SIGNAL_WORLD_TOKEN: '' } as never,
    stderr: 'pipe'
  });
  const missingClient = new Client({ name: 'world-smoke-missing', version: '0.0.0' });
  let missingExit = false;
  missing.onclose = () => { missingExit = true; };
  try {
    await missingClient.connect(missing);
  } catch {
    missingExit = true;
  }
  for (let i = 0; i < 50 && !missingExit; i += 1) await sleep(50);
  assert(missingExit, 'world server without bridge config exits instead of half-opening');
  log('PASS world_requires_configuration');

  // 1b) The legacy --world flag form also fails fast without credentials.
  const flagMissing = new StdioClientTransport({
    command: process.execPath,
    args: [FLAG_SERVER, '--world'],
    env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: '', LAST_SIGNAL_WORLD_TOKEN: '' } as never,
    stderr: 'pipe'
  });
  const flagClient = new Client({ name: 'world-smoke-flag', version: '0.0.0' });
  let flagExit = false;
  flagMissing.onclose = () => { flagExit = true; };
  try { await flagClient.connect(flagMissing); } catch { flagExit = true; }
  for (let i = 0; i < 50 && !flagExit; i += 1) await sleep(50);
  assert(flagExit, 'mcpServer.mjs --world without config exits');
  log('PASS world_flag_requires_configuration');

  // 2) --world with a bridge configuration registers the official tools.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [WORLD_SERVER],
    env: {
      ...process.env,
      LAST_SIGNAL_WORLD_BRIDGE_URL: 'http://127.0.0.1:1',
      LAST_SIGNAL_WORLD_TOKEN: 'test-token-value-0123456789'
    } as never,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'world-smoke', version: '0.0.0' });
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  for (const expected of ['world_list_sessions', 'world_observe', 'world_action', 'world_close']) {
    assert(names.includes(expected), `tool ${expected} is registered`, names);
  }
  log('PASS world_tools_registered', names);

  // 3) The world surface must not leak the local player surface.
  for (const local of ['game_create_session', 'game_step', 'game_observe']) {
    assert(!names.includes(local), `world surface must not register ${local}`, names);
  }
  log('PASS world_surface_isolated');

  // 3b) The default StationZero-compatible server has NO world tools.
  const defaultTransport = new StdioClientTransport({
    command: process.execPath, args: [FLAG_SERVER], stderr: 'pipe'
  });
  const defaultClient = new Client({ name: 'default-mcp-smoke', version: '0.0.0' });
  await defaultClient.connect(defaultTransport);
  const defaultTools = (await defaultClient.listTools()).tools.map((t) => t.name);
  assert(defaultTools.length > 0, 'default server still registers its player tools', defaultTools);
  for (const worldTool of names) {
    assert(!defaultTools.includes(worldTool), `default server must not register ${worldTool}`);
  }
  await defaultClient.close();
  log('PASS default_stationzero_surface_unchanged');

  // 4) Without a live bridge the tools report a link error, not a fake success.
  const listed = await client.callTool({ name: 'world_list_sessions', arguments: {} });
  const listedPayload = listed.structuredContent as { ok?: boolean; code?: string } | undefined;
  assert(listedPayload?.ok === false, 'world_list_sessions without a bridge fails', listedPayload);
  assert(typeof listedPayload?.code === 'string', 'failure carries an error code', listedPayload);
  log('PASS world_link_error_is_explicit', listedPayload);

  const observed = await client.callTool({ name: 'world_observe', arguments: {} });
  const observedPayload = observed.structuredContent as { ok?: boolean } | undefined;
  assert(observedPayload?.ok === false, 'world_observe without a bridge fails');
  log('PASS world_observe_error_is_explicit');

  await client.close();
  log('WORLD_MCP_SMOKE_PASS tools=' + names.filter((n) => n.startsWith('world_')).join(','));
}

main().catch((error) => fail('world mcp smoke', error instanceof Error ? error.message : String(error)));
