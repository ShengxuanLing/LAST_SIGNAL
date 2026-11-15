// P3-b A — real HTTP bridge: agent token / forged Origin can NEVER confirm.

import { describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { WorldGateway } from './worldGateway';
import { startWorldBridge } from './worldBridgeServer';

const ORIGIN = 'http://localhost:5335';
const TOKEN = randomBytes(24).toString('hex');

async function call(url: string, path: string, body: unknown, origin?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(origin ? { origin } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}

async function get(url: string, path: string, origin?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${url}${path}`, {
    headers: { authorization: `Bearer ${TOKEN}`, ...(origin ? { origin } : {}) }
  });
  return { status: res.status, json: await res.json() };
}

describe('Companion bridge Owner isolation', () => {
  it('requires the browser-held owner secret for CONFIRM; token/Origin/JSON are not enough', async () => {
    const bridge = await startWorldBridge({
      gateway: new WorldGateway(), token: TOKEN,
      allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
    });
    try {
      const hs = await call(bridge.url, '/world-link/handshake', { authorized: true, protocolVersion: 1 }, ORIGIN);
      expect(hs.status).toBe(200);
      const session = hs.json.session as string;
      const epoch = hs.json.epoch as number;
      const secret = randomBytes(24).toString('hex');
      const hash = createHash('sha256').update(secret).digest('hex');
      expect((await call(bridge.url, '/world-link/companion-authorize',
        { session, epoch, ownerSecretHash: hash, ownerMode: 'human' }, ORIGIN)).status).toBe(200);

      // Agent attaches with its independent lease (token-only, no Origin).
      const attach = await call(bridge.url, '/world-link/attach', { session }, undefined);
      expect(attach.status).toBe(200);
      expect(attach.json.leaseId).toBeTruthy();

      const obs = {
        epoch, tick: 10, player: { x: 0, y: 0 },
        echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
        drones: [{ id: 1, x: 1, y: 0, hp: 5 }],
        schema: 'last_signal.echo-observation.v1',
        perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true },
        targets: []
      };
      expect((await call(bridge.url, '/world-link/companion-observation', { session, epoch, observation: obs }, ORIGIN)).status).toBe(200);
      const suggestionId = 'sug_' + 'a'.repeat(24);
      const proposed = await call(bridge.url, '/world-link/companion-suggest', {
        session, epoch, requestId: 'req_' + 'a'.repeat(24), suggestionId,
        kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120
      });
      expect(proposed.status).toBe(200);
      expect(proposed.json.ok).toBe(true);
      // Agent can observe/status but never confirm.
      expect((await get(bridge.url, `/world-link/companion-status?session=${session}&epoch=${epoch}`)).status).toBe(200);
      const agentConfirm = await call(bridge.url, '/world-link/companion-decision', {
        session, epoch, suggestionId, decision: 'confirm', tick: 11, ownerSecret: secret
      });
      expect(agentConfirm.status, 'agent route has no Origin => denied').toBe(403);

      // A forged Origin + token without the browser secret is rejected.
      const forged = await call(bridge.url, '/world-link/companion-decision', {
        session, epoch, suggestionId, decision: 'confirm', tick: 11
      }, ORIGIN);
      expect(forged.status).toBe(403);
      expect(forged.json.messageKey).toBe('companion.owner_capability_required');
      const wrongSecret = await call(bridge.url, '/world-link/companion-decision', {
        session, epoch, suggestionId, decision: 'confirm', tick: 11, ownerSecret: 'not-the-secret'
      }, ORIGIN);
      expect(wrongSecret.status).toBe(403);
      // A JSON object / spread / Object.create cannot masquerade as the
      // browser-only WeakSet owner identity.
      for (const forgedSecret of [
        { kind: 'OWNER', session },
        { ...{ ownerSecret: secret } },
        Object.assign(Object.create(null), { ownerSecret: secret })
      ]) {
        const r = await call(bridge.url, '/world-link/companion-decision', {
          session, epoch, suggestionId, decision: 'confirm', tick: 11,
          ownerSecret: forgedSecret
        }, ORIGIN);
        expect(r.status, 'forged owner proof rejected').toBe(403);
      }

      // The real browser Owner UI (same origin + its own secret) can confirm.
      const confirmed = await call(bridge.url, '/world-link/companion-decision', {
        session, epoch, suggestionId, decision: 'confirm', tick: 11, ownerSecret: secret
      }, ORIGIN);
      expect(confirmed.status).toBe(200);
      expect(confirmed.json.value.decision).toBe('confirm');
      expect((await call(bridge.url, '/world-link/companion-applied', {
        session, suggestionId, ownerSecret: secret
      }, ORIGIN)).json.value.applied).toBe(true);

      // Disconnect is an explicit NO_MODEL fallback and cancels pending work.
      expect((await call(bridge.url, '/world-link/companion-disconnect', { session }, ORIGIN)).json.fallback).toBe('NO_MODEL');
      const status = await get(bridge.url, `/world-link/companion-status?session=${session}&epoch=${epoch}`);
      expect(status.json.value.status.link).toBe('fallback');
      expect(status.json.value.status.pendingSuggestions).toBe(0);
    } finally {
      await bridge.close();
    }
  }, 60_000);
});
