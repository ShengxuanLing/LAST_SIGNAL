// P3-b A — real HTTP bridge: agent token / forged Origin can NEVER confirm.
//
// The human handshake issues an Owner capability; every renderer mutation
// requires it. Agent routes stay token-only read/suggest.

import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { WorldGateway } from './worldGateway';
import { startWorldBridge } from './worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from './ownerAuthFixture';

const ORIGIN = 'http://localhost:5335';
const TOKEN = randomBytes(24).toString('hex');

async function call(url: string, path: string, body: unknown, origin?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(origin ? { origin } : {}) },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}
async function get(url: string, path: string, origin?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${TOKEN}`, ...(origin ? { origin } : {}) } });
  return { status: res.status, json: await res.json() };
}

const obs = (epoch: number) => ({
  epoch, tick: 10, player: { x: 0, y: 0 },
  echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
  drones: [{ id: 1, x: 1, y: 0, hp: 5 }],
  schema: 'last_signal.echo-observation.v1',
  perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true },
  targets: []
});

describe('Companion bridge Owner isolation', () => {
  it('requires the issued Owner capability for every renderer mutation', async () => {
    const bridge = await startWorldBridge({
      gateway: new WorldGateway(), token: TOKEN,
      ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
    });
    try {
      const hs = await call(bridge.url, '/world-link/handshake', { authorized: true, protocolVersion: 1, ownerKey: TEST_OWNER_KEY }, ORIGIN);
      expect(hs.status).toBe(200);
      const session = hs.json.session as string;
      const epoch = hs.json.epoch as number;
      const ownerCap = hs.json.ownerCap as string;
      expect(typeof ownerCap === 'string').toBe(true);

      // No Origin + token alone cannot register authority.
      const noCap = await call(bridge.url, '/world-link/companion-authorize', { session, epoch, ownerMode: 'human' }, ORIGIN);
      expect(noCap.status).toBe(403);
      expect(noCap.json.code).toBe('E_PERMISSION');
      expect(noCap.json.messageKey).toBe('companion.owner_capability_required');

      const ok = await call(bridge.url, '/world-link/companion-authorize', { session, epoch, ownerCap, ownerMode: 'human' }, ORIGIN);
      expect(ok.status).toBe(200);
      const cap = ok.json.ownerCap as string;

      // Renderer pushes a legal observation before any suggestion.
      const pushedObs = await call(bridge.url, '/world-link/companion-observation', { session, epoch, observation: obs(epoch), ownerCap: cap }, ORIGIN);
      expect(pushedObs.status).toBe(200);
      const noCapObs = await call(bridge.url, '/world-link/companion-observation', { session, epoch, observation: obs(epoch) }, ORIGIN);
      expect(noCapObs.status).toBe(403);

      // Agent-driven suggestion (token-only) into the human-authorized session.
      const suggestionId = 'sug_' + 'a'.repeat(24);
      const proposed = await call(bridge.url, '/world-link/companion-suggest', {
        session, epoch, requestId: 'req_' + 'a'.repeat(24), suggestionId,
        kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120
      });
      expect(proposed.status).toBe(200);
      expect(proposed.json.ok).toBe(true);
      // Agent can read status (read-only) but still needs the Owner capability.
      expect((await get(bridge.url, `/world-link/companion-status?session=${session}&epoch=${epoch}&ownerCap=${cap}`)).status).toBe(200);

      // Agent confirm with a forged capability is rejected.
      const agentConfirm = await call(bridge.url, '/world-link/companion-decision', {
        session, epoch, suggestionId, decision: 'confirm', tick: 11, ownerCap: 'c'.repeat(64)
      });
      expect(agentConfirm.status).toBe(403);

      // Human Owner confirms with the issued capability.
      const confirmed = await call(bridge.url, '/world-link/companion-decision', {
        session, epoch, suggestionId, decision: 'confirm', tick: 11, ownerCap: cap
      }, ORIGIN);
      expect(confirmed.status).toBe(200);
      expect(confirmed.json.value.decision).toBe('confirm');

      // Receipt requires ownerCap + appliedTick.
      const receipt = await call(bridge.url, '/world-link/companion-applied', { session, suggestionId, ownerCap: cap, appliedTick: 12 }, ORIGIN);
      expect(receipt.status).toBe(200);
      expect(receipt.json.value.applied).toBe(true);

      // Duplicate decision rejected.
      const dupe = await call(bridge.url, '/world-link/companion-decision', { session, epoch, suggestionId, decision: 'reject', tick: 12, ownerCap: cap }, ORIGIN);
      expect(dupe.status).toBe(400);
      expect(dupe.json.code).toBe('E_RETRYABLE');

      // Disconnect needs the capability; disconnects to NO_MODEL.
      const disc = await call(bridge.url, '/world-link/companion-disconnect', { session, ownerCap: cap }, ORIGIN);
      expect(disc.json.fallback).toBe('NO_MODEL');
      // echo_status is Agent readonly (token-only): reports real fallback link.
      const st = await get(bridge.url, `/world-link/companion-status?session=${session}&epoch=${epoch}`);
      expect(st.status).toBe(200);
      expect(st.json.value?.status?.link).toBe('fallback');
      // The old capability is cleared; an Owner MUTATION with it is rejected.
      const staleMode = await call(bridge.url, '/world-link/companion-mode', { session, epoch, ownerMode: 'human', ownerCap: cap }, ORIGIN);
      expect(staleMode.status).toBe(403);
    } finally { await bridge.close(); }
  }, 60_000);
});
