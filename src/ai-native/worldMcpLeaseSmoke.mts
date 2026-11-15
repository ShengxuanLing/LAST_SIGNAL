/**
 * AI-NATIVE-02 C3-b fix — official MCP lease + stale-list integration.
 *
 * Proves that `world_list_sessions` reports the REMOTE truth:
 *  - attached:true while the independent Agent lease is live;
 *  - after the session is closed remotely (or the lease expires) it MUST
 *    return ok:false and clear the local attached cache — never attached:true.
 *
 * Interface-level only. No LLM, no strategy.
 */
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorldGateway } from './worldGateway';
import { startWorldBridge } from './worldBridgeServer';
import { TEST_OWNER_KEY_HASH } from './ownerAuthFixture';
import { WORLD_PROTOCOL_VERSION } from './worldProtocol';

const REPO = process.cwd();
const WORLD_SERVER = resolve(REPO, 'dist-mcp/worldMcpServer.mjs');
const ORIGIN = 'http://localhost:5335';
const TOKEN = randomBytes(24).toString('hex');

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

async function main(): Promise<void> {
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN] });
  const client = new Client({ name: 'world-lease-smoke', version: '0.0.0' });
  let transport: StdioClientTransport | null = null;
  try {
    // Owner bootstrap: use the test Owner pairing key (matches TEST_OWNER_KEY_HASH).
    const { TEST_OWNER_KEY } = await import('./ownerAuthFixture');
    const humanKey = TEST_OWNER_KEY;
    const hs = await fetch(`${bridge.url}/world-link/handshake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
      body: JSON.stringify({ authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: humanKey })
    });
    assert(hs.ok, 'human handshake created the session');
    const handshake = (await hs.json()) as { session: string; epoch: number; ownerCap?: string };
    assert(handshake.session && handshake.ownerCap, 'human handshake created session + ownerCap');
    const ownerCap = handshake.ownerCap;

    // Close needs ownerCap too.
    const closed = await fetch(`${bridge.url}/world-link/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
      body: JSON.stringify({ session: handshake.session, ownerCap })
    });

    console.error('[DEBUG] TOKEN:', TOKEN, 'bridge.url:', bridge.url);
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [WORLD_SERVER],
      env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: bridge.url, LAST_SIGNAL_WORLD_TOKEN: TOKEN } as never,
      stderr: 'pipe'
    });
    await client.connect(transport);

    const listed = await client.callTool({ name: 'world_list_sessions', arguments: {} });
    const listedBody = listed.structuredContent as { ok?: boolean; attached?: boolean; leaseStatus?: string };
    assert(listedBody.ok === true && listedBody.attached === true, 'attached while the lease is live', listedBody);
    log('PASS list_attached_while_live', listedBody);

    // Remote death WITHOUT agent cooperation (browser closes the session).
    const closed2 = await fetch(`${bridge.url}/world-link/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
      body: JSON.stringify({ session: handshake.session })
    });
    assert(closed2.ok, 'session closed remotely');

    const relisted = await client.callTool({ name: 'world_list_sessions', arguments: {} });
    const relistedBody = relisted.structuredContent as { ok?: boolean; attached?: boolean; code?: string };
    assert(relistedBody.ok === false, 'dead session is NOT reported ok', relistedBody);
    assert(relistedBody.attached !== true, 'dead session is NEVER attached:true', relistedBody);
    log('PASS list_dead_not_attached', relistedBody);

    const observed = await client.callTool({ name: 'world_observe', arguments: {} });
    const observedBody = observed.structuredContent as { ok?: boolean; code?: string };
    assert(observedBody.ok === false, 'observe on the dead session fails', observedBody);
    log('PASS observe_dead_fails', observedBody);

    await client.close();
    log('WORLD_LEASE_SMOKE_PASS');
  } finally {
    try { await client.close(); } catch { /* ignore */ }
    await bridge.close();
    // No ownerFile cleanup - TEST_OWNER_KEY is a test fixture
  }
}

main().catch((error) => fail('world lease smoke', error instanceof Error ? error.message : String(error)));
