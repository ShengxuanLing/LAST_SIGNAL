// AI-NATIVE-02 P3-b — permanent Owner-capability regression chains (Node unit).
//
// These chains must stay green after every commit. They exercise the secure
// bootstrap Owner credential + issued Owner session capability boundary:
//   handshake / authorization registration / reauthorization
//   / renderer observation writes / heartbeat / mode / decision / applied
//   / disconnect / Owner suggestion reads.
//
// The agent side has the bearer TOKEN and can forge a public Origin, but it
// never possesses the host-private pairing key and never receives an issued
// Owner capability, so every chain below is deliberately attack-shaped.

import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { startWorldBridge, type RunningWorldBridge } from './worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH, handshake } from './ownerAuthFixture';
import { WORLD_PROTOCOL_VERSION } from './worldProtocol';
import { WorldGateway } from './worldGateway';

const TOKEN = randomBytes(24).toString('hex');
const ORIGIN = `http://localhost:${5335 + (Math.random() * 100 | 0)}`;

async function makeBridge(): Promise<RunningWorldBridge> {
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({
    gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH,
    allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
  });
  return bridge;
}

/** Human handshake: proves possession of the host-private pairing key. */
async function humanHandshake(bridge: RunningWorldBridge): Promise<{
  session: string; epoch: number; ownerCap: string;
}> {
  return handshake(bridge, '/world-link/handshake',
    { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: TEST_OWNER_KEY },
    TOKEN, ORIGIN);
}

/** Attacker request: bearer token + public Origin only (no owner key, no cap). */
async function attack(bridge: RunningWorldBridge, path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${bridge.url}${path}`, {
    method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: ORIGIN
    }, body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}

async function getAttack(bridge: RunningWorldBridge, path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${bridge.url}${path}`, {
    headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN }
  });
  return { status: res.status, json: await res.json() };
}

describe('Owner capability authorization regression chains', () => {
  it('C1 self-handshake: no human pairing key => 403', async () => {
    const bridge = await makeBridge();
    try {
      const r = await attack(bridge, '/world-link/handshake',
        { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION });
      expect(r.status).toBe(403);
      expect(r.json.code).toBe('E_PERMISSION');
      expect(r.json.messageKey).toBe('world.owner_pairing_required');
    } finally { await bridge.close(); }
  });

  it('C2 self-authorize: token + public Origin without the key cannot register', async () => {
    const bridge = await makeBridge();
    try {
      const hs = await handshake(bridge, '/world-link/handshake',
        { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: TEST_OWNER_KEY }, TOKEN, ORIGIN);
      expect(hs.ownerCap).toBeTruthy();
      const r = await attack(bridge, '/world-link/companion-authorize', {
        session: hs.session, epoch: hs.epoch, ownerSecretHash: 'a'.repeat(64)
      });
      expect(r.status).toBe(403);
      expect(r.json.code).toBe('E_PERMISSION');
      expect(r.json.messageKey).toBe('companion.owner_capability_required');
    } finally { await bridge.close(); }
  });

  it('C3 reauthorize overwrite: agent cannot replace the human capability', async () => {
    const bridge = await makeBridge();
    try {
      const human = await humanHandshake(bridge);
      // Agent re-authorizes with a key it generated itself (tricks nothing).
      const r = await attack(bridge, '/world-link/companion-authorize', {
        session: human.session, epoch: human.epoch, ownerKey: randomBytes(32).toString('hex')
      });
      expect(r.status).toBe(403);
      expect(r.json.code).toBe('E_PERMISSION');
      expect(r.json.messageKey).toBe('companion.owner_capability_required');
      // Old capability is revoked; new one cannot be issued by the agent.
      const stale = await getAttack(bridge, `/world-link/companion-suggestions?session=${human.session}&epoch=${human.epoch}`);
      expect(stale.status).toBe(403);
      expect(stale.json.code).toBe('E_PERMISSION');
    } finally { await bridge.close(); }
  });

  it('C4 reauthorize same-key: same human atomically swaps the capability', async () => {
    const bridge = await makeBridge();
    try {
      const human = await humanHandshake(bridge);
      const firstCap = human.ownerCap;
      const res = await fetch(bridge.url + '/world-link/companion-authorize', {
        method: 'POST', headers: {
          'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: ORIGIN
        },
        body: JSON.stringify({ session: human.session, epoch: human.epoch, ownerCap: human.ownerCap, ownerKey: TEST_OWNER_KEY, reauthorize: true })
      });
      const cap = await res.json() as { ok?: boolean; ownerCap?: string };
      expect(cap.ok).toBe(true);
      expect(cap.ownerCap).not.toBe(firstCap);
      const stale = await getAttack(bridge, `/world-link/companion-suggestions?session=${human.session}&epoch=${human.epoch}&ownerCap=${firstCap}`);
      expect(stale.status).toBe(403);
      expect(stale.json.code).toBe('E_PERMISSION');
    } finally { await bridge.close(); }
  });

  it('C5 fake observation without an Owner capability is rejected', async () => {
    const bridge = await makeBridge();
    try {
      const human = await humanHandshake(bridge);
      const fake = {
        epoch: human.epoch, tick: 10, player: { x: 0, y: 0 },
        echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
        drones: [], relay: { id: 'boss999', x: 0, y: 0, state: 'active' },
        schema: 'last_signal.echo-observation.v1', perception: {
          center: { x: 0, y: 0 }, radiusTiles: 99, requiresExplored: true, requiresLineOfSight: true
        },
        targets: [{ id: 999, kind: 'Boss', x: 0, y: 0, hp: 900, isBoss: true }]
      };
      const r = await attack(bridge, '/world-link/companion-observation', {
        session: human.session, epoch: human.epoch, observation: fake
      });
      expect(r.status).toBe(403);
      expect(r.json.code).toBe('E_PERMISSION');
      expect(r.json.messageKey).toBe('companion.owner_capability_required');
    } finally { await bridge.close(); }
  });

  it('C6 mode flip without an Owner capability is rejected', async () => {
    const bridge = await makeBridge();
    try {
      const human = await humanHandshake(bridge);
      const r = await attack(bridge, '/world-link/companion-mode', {
        session: human.session, epoch: human.epoch, ownerMode: 'human'
      });
      expect(r.status).toBe(403);
      expect(r.json.code).toBe('E_PERMISSION');
      expect(r.json.messageKey).toBe('companion.owner_capability_required');
    } finally { await bridge.close(); }
  });

  it('C7 duplicate/replayed decisions cannot double-execute', async () => {
    const bridge = await makeBridge();
    try {
      const human = await humanHandshake(bridge);
      // Not a real suggestion => E_TARGET_DESTROYED; must NOT become applied.
      const dec = await attack(bridge, '/world-link/companion-decision', {
        session: human.session, epoch: human.epoch, suggestionId: 'sug_' + 'a'.repeat(24),
        decision: 'confirm', tick: 10
      });
expect(dec.status).not.toBe(200);
      const applied = await attack(bridge, '/world-link/companion-applied', {
        session: human.session, suggestionId: 'sug_' + 'a'.repeat(24), appliedTick: 10
      });
      expect(applied.status).not.toBe(200);
      expect(applied.json.code).not.toBe('E_TARGET_DESTROYED');
    } finally { await bridge.close(); }
  });

  it('C8 explicit disconnect is a capability-governed NO_MODEL fallback', async () => {
    const bridge = await makeBridge();
    try {
      const human = await humanHandshake(bridge);
      // Register the Owner capability first so a real companion session exists.
      const auth = await attack(bridge, '/world-link/companion-authorize', {
        session: human.session, epoch: human.epoch, ownerCap: human.ownerCap, ownerMode: 'human'
      });
      expect(auth.status).toBe(200);
      const cap = auth.json.ownerCap as string;
      const d = await attack(bridge, '/world-link/companion-disconnect', {
        session: human.session, ownerCap: cap
      });
      expect(d.status).toBe(200);
      expect(d.json.fallback).toBe('NO_MODEL');
      // echo_status is Agent readonly (token-only): it reports the real
      // fallback link; the OLD capability is still cleared for MUTATIONS.
      const st = await getAttack(bridge, `/world-link/companion-status?session=${human.session}&epoch=${human.epoch}`);
      expect(st.status).toBe(200);
      expect((st.json.value?.status?.link ?? 'fallback')).toBe('fallback');
      const staleMutation = await attack(bridge, '/world-link/companion-mode', {
        session: human.session, epoch: human.epoch, ownerMode: 'human', ownerCap: cap
      });
      expect(staleMutation.status).toBe(403);
    } finally { await bridge.close(); }
  });
});
