/**
 * AI-NATIVE-02 C3-b — official MCP `--world` tools against a REAL bridge.
 *
 * Starts the loopback bridge, simulates the HUMAN authorization (the rendered
 * side creates the session) and the post-commit observation, then calls the
 * official MCP tools through real stdio protocol frames:
 *   world_list_sessions -> world_observe -> world_action -> world_close.
 *
 * This validates the interface and the queue-only commit contract. It is NOT
 * an LLM playthrough; no strategy is pre-written and no core copy exists.
 */
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorldGateway } from './worldGateway';
import { startWorldBridge } from './worldBridgeServer';
import { TEST_OWNER_KEY_HASH } from './ownerAuthFixture';
import { WORLD_PROTOCOL_VERSION, WORLD_SCHEMA_V1 } from './worldProtocol';

const REPO = process.cwd();
// Run the same interface check against either official WORLD entry:
//   WORLD_MCP_BINARY=dist-mcp/worldMcpServer.mjs   (core-free, default)
//   WORLD_MCP_BINARY=dist-mcp/mcpServer.mjs WORLD_MCP_FLAG=--world
const SERVER = resolve(REPO, process.env.WORLD_MCP_BINARY ?? 'dist-mcp/worldMcpServer.mjs');
const EXTRA_ARGS = process.env.WORLD_MCP_FLAG ? [process.env.WORLD_MCP_FLAG] : [];
const ORIGIN = 'http://localhost:5335';
const TOKEN = randomBytes(24).toString('hex');
const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;

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
function observation(epoch: number, tick: number) {
  return {
    schema: WORLD_SCHEMA_V1, protocolVersion: WORLD_PROTOCOL_VERSION,
    epoch, tick, roomId: 0,
    player: { x: 5, y: 5, hp: 100, maxHp: 100, aimYaw: 0, weaponKey: 'pulse', ammo: -1, magazine: -1 },
    drones: [{ id: 1, kind: 'drone', x: 7, y: 5, hp: 24, state: 'idle' }],
    projectiles: [], availableActions: ['move', 'stop', 'aim', 'fire', 'interact']
  };
}

async function main(): Promise<void> {
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN] });
  const client = new Client({ name: 'world-integration-smoke', version: '0.0.0' });
  let transport: StdioClientTransport | null = null;
  try {
    // HUMAN authorization on the rendered side creates the only session.
    const handshakeResponse = await fetch(`${bridge.url}/world-link/handshake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
      body: JSON.stringify({ authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION })
    });
    const handshake = (await handshakeResponse.json()) as { session: string; epoch: number };
    assert(handshake.session, 'human handshake created the session');

    // The rendered game pushes a post-commit observation.
    const pushed = await fetch(`${bridge.url}/world-link/observation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
      body: JSON.stringify({ session: handshake.session, epoch: handshake.epoch, observation: observation(handshake.epoch, 12) })
    });
    assert(pushed.ok, 'post-commit observation pushed');

    transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER, ...EXTRA_ARGS],
      env: {
        ...process.env,
        LAST_SIGNAL_WORLD_BRIDGE_URL: bridge.url,
        LAST_SIGNAL_WORLD_TOKEN: TOKEN
      } as never,
      stderr: 'pipe'
    });
    await client.connect(transport);

    // 1) list
    const listed = await client.callTool({ name: 'world_list_sessions', arguments: {} });
    const listedPayload = listed.structuredContent as { ok?: boolean; session?: string; epoch?: number };
    assert(listedPayload.ok === true, 'MCP world_list_sessions succeeds', listedPayload);
    assert(listedPayload.session === handshake.session, 'MCP attaches to the human session', listedPayload);
    log('PASS mcp_world_list_sessions', { session: listedPayload.session, epoch: listedPayload.epoch });

    // 2) observe (perception-cropped post-commit data)
    const observed = await client.callTool({ name: 'world_observe', arguments: {} });
    const observedPayload = observed.structuredContent as { ok?: boolean; observation?: { tick: number; drones: unknown[] } };
    assert(observedPayload.ok === true, 'MCP world_observe succeeds', observedPayload);
    assert(observedPayload.observation?.tick === 12, 'MCP sees the real post-commit tick', observedPayload.observation);
    const serialized = JSON.stringify(observedPayload.observation);
    for (const forbidden of ['seed', 'rngState', 'fullMap', 'hiddenGoal']) {
      assert(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `no ${forbidden} in observation`);
    }
    log('PASS mcp_world_observe', { tick: observedPayload.observation?.tick, drones: observedPayload.observation?.drones.length });

    // 3) action: queue-only, never "applied" at submit time
    const action = await client.callTool({
      name: 'world_action',
      arguments: {
        requestId: rid(1),
        actions: [{ type: 'move', actionId: aid(1), dir: { x: 1, y: 0 }, ticks: 8 }],
        ttlTicks: 120
      }
    });
    const actionPayload = action.structuredContent as {
      ok?: boolean; replayed?: boolean; actions?: Array<{ status: string; actionId: string }>; acceptedTick?: number;
    };
    assert(actionPayload.ok === true, 'MCP world_action succeeds', actionPayload);
    assert(actionPayload.replayed === false, 'first submit is not a replay', actionPayload);
    assert(actionPayload.actions?.[0]?.status === 'queued', 'queued != applied', actionPayload);
    assert(actionPayload.acceptedTick === 12, 'acceptedTick is the post-commit tick', actionPayload);
    log('PASS mcp_world_action', { status: actionPayload.actions?.[0]?.status, acceptedTick: actionPayload.acceptedTick });

    // 4) same requestId is idempotent (no double execution)
    const replay = await client.callTool({
      name: 'world_action',
      arguments: {
        requestId: rid(1),
        actions: [{ type: 'move', actionId: aid(1), dir: { x: 1, y: 0 }, ticks: 8 }],
        ttlTicks: 120
      }
    });
    const replayPayload = replay.structuredContent as { ok?: boolean; replayed?: boolean };
    assert(replayPayload.ok === true && replayPayload.replayed === true, 'same requestId replays', replayPayload);
    log('PASS mcp_world_action_idempotent');

    // 5) a same-id / different-payload retry is rejected
    const mismatch = await client.callTool({
      name: 'world_action',
      arguments: { requestId: rid(1), actions: [{ type: 'stop', actionId: aid(1) }] }
    });
    const mismatchPayload = mismatch.structuredContent as { ok?: boolean; code?: string };
    assert(mismatchPayload.ok === false, 'mismatched retry rejected', mismatchPayload);
    assert(mismatchPayload.code === 'E_ID_PAYLOAD_MISMATCH', 'correct rejection code', mismatchPayload);
    log('PASS mcp_world_action_mismatch_rejected');

    // 6) close
    const closed = await client.callTool({ name: 'world_close', arguments: {} });
    const closedPayload = closed.structuredContent as { ok?: boolean; closed?: boolean };
    assert(closedPayload.ok === true && closedPayload.closed === true, 'MCP world_close succeeds', closedPayload);
    log('PASS mcp_world_close');

    log(`WORLD_MCP_INTEGRATION_PASS list->observe->action->close binary=${process.env.WORLD_MCP_BINARY ?? 'dist-mcp/worldMcpServer.mjs'} ${EXTRA_ARGS.join(' ')}`);
  } finally {
    await client.close().catch(() => undefined);
    await bridge.close();
  }
}

main().catch((error) => fail('world mcp integration', error instanceof Error ? error.message : String(error)));
