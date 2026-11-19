// REVIEWER PROBE (not part of the frozen commit) — bridge boundary for the new
// browser-only POST /world-link/companion-room on 7c0068f.
// Questions: (a) can an AGENT (token only, no Origin, no ownerCap) cancel the
// Owner's proposals? (b) does the route's placement in the agent-route list
// change what an agent observes? (c) does the real browser path still work?
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { WorldGateway } from '../ai-native/worldGateway';
import { startWorldBridge } from '../ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../ai-native/ownerAuthFixture';

const ORIGIN = 'http://localhost:5311';
const TOKEN = randomBytes(24).toString('hex');

async function post(url: string, path: string, body: unknown, origin?: string, token = TOKEN) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(origin ? { origin } : {}) },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe('companion-room bridge boundary (reviewer probe)', () => {
  it('agent token can never cancel; the browser path still works', async () => {
    const gateway = new WorldGateway();
    const bridge = await startWorldBridge({
      gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH,
      allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
    });
    try {
      // real human handshake (browser Origin + host pairing key)
      const hs = await post(bridge.url, '/world-link/handshake',
        { authorized: true, protocolVersion: 1, ownerKey: TEST_OWNER_KEY }, ORIGIN);
      expect(hs.status).toBe(200);
      const { session, epoch, ownerCap } = hs.json as { session: string; epoch: number; ownerCap: string };

      // A real proposal exists (so a successful cancel would be observable).
      const pushed = await post(bridge.url, '/world-link/companion-observation', {
        session, epoch, ownerCap,
        observation: {
          epoch, tick: 10, player: { x: 0, y: 0 },
          echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
          drones: [], targets: [],
          relay: { id: 'relay_main', x: 1, y: 0, state: 'INACTIVE' }, objectiveBlocked: true,
          energy: { current: 100, max: 100 }, cooldowns: { scanTicks: 0, jamTicks: 0 },
          schema: 'last_signal.echo-observation.v1',
          perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true }
        }
      }, ORIGIN);
      expect(pushed.status).toBe(200);
      const sug = await post(bridge.url, '/world-link/companion-suggest', {
        session, epoch,
        requestId: 'req_' + 'a'.repeat(24), suggestionId: 'sug_' + 'b'.repeat(24),
        kind: 'scan', reason: 'perceived_relay', ttlTicks: 600
      });
      expect(sug.status).toBe(200);
      const pendingBefore = await fetch(
        `${bridge.url}/world-link/companion-suggestions?session=${session}&epoch=${epoch}`,
        { headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN, 'x-owner-cap': ownerCap } }
      ).then((r) => r.json());
      expect((pendingBefore.value as any[]).length).toBe(1);

      // (a1) AGENT shape: token only, NO Origin, NO ownerCap.
      const agentNoOrigin = await post(bridge.url, '/world-link/companion-room', { session, epoch, roomId: 5, tick: 20 });
      // (a2) AGENT shape with a forged Origin but still no ownerCap.
      const agentForgedOrigin = await post(bridge.url, '/world-link/companion-room', { session, epoch, roomId: 5, tick: 20 }, ORIGIN);
      // (a3) AGENT with an obviously wrong ownerCap.
      const agentWrongCap = await post(bridge.url, '/world-link/companion-room',
        { session, epoch, ownerCap: 'f'.repeat(64), roomId: 5, tick: 20 }, ORIGIN);

      // comparison: a strictly browser-only sibling route (companion-decision)
      const siblingNoOrigin = await post(bridge.url, '/world-link/companion-decision',
        { session, epoch, suggestionId: 'sug_' + 'b'.repeat(24), decision: 'confirm', tick: 20 });

      const pendingAfter = await fetch(
        `${bridge.url}/world-link/companion-suggestions?session=${session}&epoch=${epoch}`,
        { headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN, 'x-owner-cap': ownerCap } }
      ).then((r) => r.json());

      console.log('BRIDGE_PROBE ' + JSON.stringify({
        agentNoOrigin, agentForgedOrigin, agentWrongCap, siblingNoOrigin,
        pendingBefore: (pendingBefore.value as any[]).length,
        pendingAfter: (pendingAfter.value as any[]).length
      }));

      // Nothing an agent can do may change the Owner's pending work.
      for (const r of [agentNoOrigin, agentForgedOrigin, agentWrongCap]) {
        expect(r.status, JSON.stringify(r)).toBe(403);
      }
      expect((pendingAfter.value as any[]).length, 'agent attempts must not cancel the Owner proposal').toBe(1);

      // (c) the real browser path works and retires the proposal.
      const browserRoom = await post(bridge.url, '/world-link/companion-room',
        { session, epoch, ownerCap, roomId: 5, tick: 21 }, ORIGIN);
      expect(browserRoom.status, JSON.stringify(browserRoom)).toBe(200);
      const finalPending = await fetch(
        `${bridge.url}/world-link/companion-suggestions?session=${session}&epoch=${epoch}`,
        { headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN, 'x-owner-cap': ownerCap } }
      ).then((r) => r.json());
      expect((finalPending.value as any[]).length).toBe(0);
    } finally {
      await bridge.close();
    }
  });
});
