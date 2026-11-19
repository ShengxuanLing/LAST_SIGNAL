// REVIEWER PROBE — c233e5c bridge route classification (agent vs Owner).
import { expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { WorldGateway } from '../ai-native/worldGateway';
import { startWorldBridge } from '../ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../ai-native/ownerAuthFixture';

const ORIGIN = 'http://localhost:5311';
const TOKEN = randomBytes(24).toString('hex');
async function post(url: string, path: string, body: unknown, origin?: string) {
  const r = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(origin ? { origin } : {}) },
    body: JSON.stringify(body)
  });
  return { status: r.status, json: await r.json() as any };
}

it('agent shape is refused by the OUTER Origin gate; Owner path reaches the handler', async () => {
  const bridge = await startWorldBridge({
    gateway: new WorldGateway(), token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH,
    allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
  });
  try {
    const hs = await post(bridge.url, '/world-link/handshake',
      { authorized: true, protocolVersion: 1, ownerKey: TEST_OWNER_KEY }, ORIGIN);
    expect(hs.status).toBe(200);
    const { session, epoch, ownerCap } = hs.json;

    const agentRoom = await post(bridge.url, '/world-link/companion-room', { session, epoch, roomId: 5, tick: 1 });
    const agentDecision = await post(bridge.url, '/world-link/companion-decision',
      { session, epoch, suggestionId: 'sug_' + 'a'.repeat(24), decision: 'confirm', tick: 1 });
    const ownerRoom = await post(bridge.url, '/world-link/companion-room',
      { session, epoch, ownerCap, roomId: 5, tick: 1 }, ORIGIN);
    console.log('BRIDGE_CLASS ' + JSON.stringify({
      agentRoom, agentDecision, ownerRoom: { status: ownerRoom.status, ok: ownerRoom.json?.ok }
    }));
    expect(agentRoom.status, JSON.stringify(agentRoom)).toBe(403);
    expect(agentRoom.json.messageKey, 'outer Origin gate, not the inner one').toBe('world.origin_denied');
    expect(agentDecision.status).toBe(403);
    expect(agentDecision.json.messageKey).toBe('world.origin_denied');
    expect(ownerRoom.status, JSON.stringify(ownerRoom)).toBe(200);
    expect(ownerRoom.json.ok).toBe(true);
  } finally { await bridge.close(); }
});
