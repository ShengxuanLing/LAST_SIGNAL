// AI-NATIVE-02 C3-b — bridge permission / idempotency / TTL / disconnect.
//
// These tests use the REAL loopback HTTP bridge with a token, exact origin,
// the gateway's hard quota and its monotonic observation tickets. No LLM, no
// rendered game, no simulation core.

import { describe, expect, it } from 'vitest';
import { startWorldBridge, type RunningWorldBridge } from './worldBridgeServer';
import { WorldGateway } from './worldGateway';
import { WORLD_LIMITS, WORLD_PROTOCOL_VERSION, WORLD_SCHEMA_V1 } from './worldProtocol';

const TOKEN = 'test-token-0123456789abcdef';
const ORIGIN = 'http://localhost:5335';
const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;

function observation(epoch: number, tick: number) {
  return {
    schema: WORLD_SCHEMA_V1,
    protocolVersion: WORLD_PROTOCOL_VERSION,
    epoch, tick, roomId: 0,
    player: { x: 5, y: 5, hp: 100, maxHp: 100, aimYaw: 0, weaponKey: 'pulse', ammo: -1, magazine: -1 },
    drones: [], projectiles: [],
    availableActions: ['move', 'stop', 'aim', 'fire', 'interact']
  };
}

interface Envelope { status: number; body: any }
async function req(server: RunningWorldBridge, path: string, options: {
  method?: string; body?: unknown; token?: string | null; origin?: string | null;
} = {}): Promise<Envelope> {
  const headers: Record<string, string> = {};
  if (options.token !== null) headers.authorization = `Bearer ${options.token ?? TOKEN}`;
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${server.url}${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function withServer(run: (server: RunningWorldBridge, gateway: WorldGateway) => Promise<void>): Promise<void> {
  const gateway = new WorldGateway();
  const server = await startWorldBridge({ gateway, token: TOKEN, allowedOrigins: [ORIGIN] });
  try { await run(server, gateway); } finally { await server.close(); }
}

/** A HUMAN authorized the link on the rendered side (browser origin). */
async function authorize(server: RunningWorldBridge): Promise<{ session: string; epoch: number }> {
  const r = await req(server, '/world-link/handshake', {
    body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION }, origin: ORIGIN
  });
  expect(r.status).toBe(200);
  return { session: r.body.session, epoch: r.body.epoch };
}

describe('C3-b bridge agent surface', () => {
  it('an agent cannot self-authorize: attach with no human-authorized session is rejected', async () => {
    await withServer(async (server) => {
      const r = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null
      });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('E_PERMISSION');
      expect(r.body.messageKey).toBe('world.authorization_required');
    });
  });

  it('the token is mandatory, and a different origin is refused even for agent routes', async () => {
    await withServer(async (server) => {
      await authorize(server);
      const noToken = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, token: null, origin: null
      });
      expect(noToken.status).toBe(401);
      const wrongToken = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, token: 'definitely-wrong-token-value', origin: null
      });
      expect(wrongToken.status).toBe(401);
      const badOrigin = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: 'http://evil.example'
      });
      expect(badOrigin.status).toBe(403);
      expect(badOrigin.body.messageKey).toBe('world.origin_denied');
    });
  });

  it('after a HUMAN handshake the agent attaches to the same session/epoch', async () => {
    await withServer(async (server) => {
      const human = await authorize(server);
      const r = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null
      });
      expect(r.status).toBe(200);
      expect(r.body.session).toBe(human.session);
      expect(r.body.epoch).toBe(human.epoch);
      // A second handshake from the renderer is still refused (C3-a contract).
      const duplicate = await req(server, '/world-link/handshake', {
        body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION }, origin: ORIGIN
      });
      expect(duplicate.status).toBe(409);
    });
  });

  it('observation is perception-cropped protocol data and is unavailable before the first push', async () => {
    await withServer(async (server) => {
      const human = await authorize(server);
      const before = await req(server, `/world-link/observation?session=${human.session}&epoch=${human.epoch}`, {
        method: 'GET', origin: null
      });
      expect(before.status).toBe(404);
      expect(before.body.code).toBe('E_LINK_UNAVAILABLE');

      const pushed = await req(server, '/world-link/observation', {
        body: { session: human.session, epoch: human.epoch, observation: observation(human.epoch, 7) },
        origin: ORIGIN
      });
      expect(pushed.status).toBe(200);
      const read = await req(server, `/world-link/observation?session=${human.session}&epoch=${human.epoch}`, {
        method: 'GET', origin: null
      });
      expect(read.status).toBe(200);
      expect(read.body.observation.tick).toBe(7);
      expect(read.body.observation.schema).toBe(WORLD_SCHEMA_V1);
      // No full map, seed, RNG state or hidden goal in the payload.
      const serialized = JSON.stringify(read.body.observation);
      for (const forbidden of ['seed', 'rng', 'fullMap', 'hiddenGoal', 'mapGrid', 'rooms']) {
        expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    });
  });

  it('submit is queue-only and idempotent; a same-id different payload is rejected', async () => {
    await withServer(async (server, gateway) => {
      const human = await authorize(server);
      await req(server, '/world-link/observation', {
        body: { session: human.session, epoch: human.epoch, observation: observation(human.epoch, 3) },
        origin: ORIGIN
      });
      const batch = {
        session: human.session, epoch: human.epoch, requestId: rid(1),
        actions: [{ type: 'move', actionId: aid(1), dir: { x: 1, y: 0 }, ticks: 5 }]
      };
      const first = await req(server, '/world-link/action-submit', { body: batch, origin: null });
      expect(first.status).toBe(200);
      expect(first.body.actions[0].status).toBe('queued');
      expect(first.body.acceptedTick).toBe(3);
      expect(first.body.applyByTick).toBe(3 + WORLD_LIMITS.DEFAULT_TTL_TICKS);

      const replay = await req(server, '/world-link/action-submit', { body: batch, origin: null });
      expect(replay.status).toBe(200);
      expect(replay.body.replayed).toBe(true);
      expect(replay.body.actions[0].status).toBe('queued');

      const mismatch = await req(server, '/world-link/action-submit', {
        body: { ...batch, actions: [{ type: 'stop', actionId: aid(1) }] }, origin: null
      });
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.code).toBe('E_ID_PAYLOAD_MISMATCH');

      // The queue is still exactly one action: no duplicate execution.
      expect(gateway.listSessions()[0].status).toBe('connected');
      const next = await req(server, `/world-link/next-action?session=${human.session}&epoch=${human.epoch}`, {
        method: 'GET', origin: ORIGIN
      });
      expect(next.body.action.actionId).toBe(aid(1));
    });
  });

  it('a stale epoch is rejected and cannot enqueue leftovers', async () => {
    await withServer(async (server, gateway) => {
      const human = await authorize(server);
      await req(server, '/world-link/observation', {
        body: { session: human.session, epoch: human.epoch, observation: observation(human.epoch, 4) },
        origin: ORIGIN
      });
      // Human takeover: yield bumps the epoch.
      const yielded = await req(server, '/world-link/yield', {
        body: { session: human.session, epoch: human.epoch, reason: 'takeover' }, origin: ORIGIN
      });
      expect(yielded.status).toBe(200);
      const bumped = gateway.listSessions()[0].epoch;
      expect(bumped).toBeGreaterThan(human.epoch);

      const stale = await req(server, '/world-link/action-submit', {
        body: {
          session: human.session, epoch: human.epoch, requestId: rid(2),
          actions: [{ type: 'stop', actionId: aid(2) }]
        }, origin: null
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('E_STALE_EPOCH');
      const staleObservation = await req(server, `/world-link/observation?session=${human.session}&epoch=${human.epoch}`, {
        method: 'GET', origin: null
      });
      expect(staleObservation.body.code).toBe('E_STALE_EPOCH');
    });
  });

  it('disconnect / yield cancels pending intents; the agent cannot re-attach to a closed session', async () => {
    await withServer(async (server) => {
      const human = await authorize(server);
      await req(server, '/world-link/observation', {
        body: { session: human.session, epoch: human.epoch, observation: observation(human.epoch, 2) },
        origin: ORIGIN
      });
      await req(server, '/world-link/action-submit', {
        body: {
          session: human.session, epoch: human.epoch, requestId: rid(3),
          actions: [{ type: 'stop', actionId: aid(3) }]
        }, origin: null
      });
      const closed = await req(server, '/world-link/close', {
        body: { session: human.session, epoch: human.epoch }, origin: ORIGIN
      });
      expect(closed.status).toBe(200);
      const attach = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION, session: human.session }, origin: null
      });
      expect(attach.body.ok).toBe(false);
      expect([403, 404]).toContain(attach.status);
      const observationAfterClose = await req(server, `/world-link/observation?session=${human.session}&epoch=${human.epoch}`, {
        method: 'GET', origin: null
      });
      expect(observationAfterClose.body.ok).toBe(false);
    });
  });

  it('the exact origin is enforced on renderer routes', async () => {
    await withServer(async (server) => {
      const noOrigin = await req(server, '/world-link/handshake', {
        body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null
      });
      expect(noOrigin.status).toBe(403);
      const wrongOrigin = await req(server, '/world-link/handshake', {
        body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION }, origin: 'http://not-allowed.example'
      });
      expect(wrongOrigin.status).toBe(403);
      expect(wrongOrigin.body.messageKey).toBe('world.origin_denied');
    });
  });

  it('TTL expiry drops an overdue intent', async () => {
    await withServer(async (server, gateway) => {
      const human = await authorize(server);
      await req(server, '/world-link/observation', {
        body: { session: human.session, epoch: human.epoch, observation: observation(human.epoch, 100) },
        origin: ORIGIN
      });
      const submitted = await req(server, '/world-link/action-submit', {
        body: {
          session: human.session, epoch: human.epoch, requestId: rid(4),
          actions: [{ type: 'stop', actionId: aid(4) }], ttlTicks: 1
        }, origin: null
      });
      expect(submitted.body.applyByTick).toBe(101);
      // A post-commit observation past applyByTick expires the overdue intent.
      await req(server, '/world-link/observation', {
        body: { session: human.session, epoch: human.epoch, observation: observation(human.epoch, 102) },
        origin: ORIGIN
      });
      const next = await req(server, `/world-link/next-action?session=${human.session}&epoch=${human.epoch}`, {
        method: 'GET', origin: ORIGIN
      });
      expect(next.body.action).toBeNull();
      expect(gateway.listSessions()[0].status).toBe('connected');
    });
  });
});
