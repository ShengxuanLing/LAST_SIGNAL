// AI-NATIVE-02 C3-a — loopback bridge tests: auth, origin/CORS, duplicate
// handshake, queue/ack, yield, close, heartbeat loss. No World/Scene/core.
//
// The bridge now requires a HOST-ONLY Owner pairing key at handshake and an
// issued Owner session capability on every renderer route. Agent routes stay
// token-only.

import { describe, expect, it } from 'vitest';
import { startWorldBridge, type RunningWorldBridge } from './worldBridgeServer';
import { TEST_OWNER_KEY_HASH } from './ownerAuthFixture';
import { WorldGateway } from './worldGateway';
import { WORLD_PROTOCOL_VERSION, WORLD_SCHEMA_V1 } from './worldProtocol';

const TOKEN = 'test-token-0123456789abcdef';
const ORIGIN = 'http://localhost:5335';
const OWNER_KEY = 'a'.repeat(64);
const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;

function observation(epoch: number, tick: number) {
  return {
    schema: WORLD_SCHEMA_V1,
    protocolVersion: WORLD_PROTOCOL_VERSION,
    epoch,
    tick,
    roomId: 0,
    player: { x: 5, y: 5, hp: 100, maxHp: 100, aimYaw: 0, weaponKey: 'pulse', ammo: -1, magazine: -1 },
    drones: [{ id: 1, kind: 'drone', x: 7, y: 5, hp: 24, state: 'idle' }],
    projectiles: [],
    availableActions: ['move', 'stop', 'aim', 'fire', 'interact']
  };
}

interface Envelope { status: number; body: any; cors: string | null; }

async function request(server: RunningWorldBridge, path: string, options: {
  method?: string;
  body?: unknown;
  token?: string | null;
  origin?: string | null;
  contentType?: string;
  ownerCap?: string;
} = {}): Promise<Envelope> {
  const headers: Record<string, string> = {};
  if (options.token !== null) headers.authorization = `Bearer ${options.token ?? TOKEN}`;
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.ownerCap) headers['x-owner-cap'] = options.ownerCap;
  if (options.body !== undefined) headers['content-type'] = options.contentType ?? 'application/json';
  const response = await fetch(`${server.url}${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cors: response.headers.get('access-control-allow-origin')
  };
}

async function withServer<T>(
  fn: (server: RunningWorldBridge, gateway: WorldGateway) => Promise<T>,
  options: { lostAfterMs?: number } = {}
): Promise<T> {
  const gateway = new WorldGateway({ lostAfterMs: options.lostAfterMs ?? 1000 });
  const server = await startWorldBridge({
    gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
  });
  try {
    return await fn(server, gateway);
  } finally {
    await server.close();
  }
}

describe('C3-a loopback bridge auth / origin / lifecycle', () => {
  it('rejects missing/wrong credentials and wrong origins without wildcard CORS', async () => {
    await withServer(async (server) => {
      const noToken = await request(server, '/world-link/handshake', { token: null, body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION } });
      expect(noToken.status).toBe(401);
      const wrong = await request(server, '/world-link/handshake', { token: 'wrong-token-0123456789', body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION } });
      expect(wrong.status).toBe(401);
      const badOrigin = await request(server, '/world-link/handshake', { origin: 'http://evil.example', body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION } });
      expect(badOrigin.status).toBe(403);
      expect(badOrigin.cors).toBeNull();
      const preflight = await request(server, '/world-link/handshake', { method: 'OPTIONS', body: undefined, token: null });
      expect(preflight.status).toBe(204);
      expect(preflight.cors).toBe(ORIGIN);
      expect(preflight.cors).not.toBe('*');
    });
  });

  it('requires explicit authorized=true and rejects duplicate handshake', async () => {
    await withServer(async (server) => {
      const denied = await request(server, '/world-link/handshake', { body: { authorized: false, protocolVersion: WORLD_PROTOCOL_VERSION } });
      expect(denied.status).toBe(403);
      const first = await request(server, '/world-link/handshake', { body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: OWNER_KEY } });
      expect(first.status).toBe(200);
      expect(first.body.session).toMatch(/^ses_[0-9a-f]{24}$/);
      expect(first.body.token).toBeUndefined();
      expect(JSON.stringify(first.body)).not.toContain(TOKEN);
      expect(server.url).not.toContain(TOKEN);
      const duplicate = await request(server, '/world-link/handshake', { body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: OWNER_KEY } });
      expect(duplicate.status).toBe(409);
    });
  });

  it('queues, fetches and ACKs through the bridge without claiming applied early', async () => {
    await withServer(async (server, gateway) => {
      const linked = await request(server, '/world-link/handshake', { body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: OWNER_KEY } });
      expect(linked.status).toBe(200);
      const session = linked.body.session as string;
      const epoch = linked.body.epoch as number;
      const cap = linked.body.ownerCap;
      const pushed = await request(server, '/world-link/observation', {
        body: { session, epoch, observation: observation(epoch, 10), ownerCap: cap }, ownerCap: cap
      });
      expect(pushed.status).toBe(200);
      const queued = gateway.submitActions({
        sessionId: session, epoch, requestId: rid(1),
        actions: { actions: [{ type: 'stop', actionId: aid(1) }] }, nowMs: Date.now()
      });
      expect('ok' in queued).toBe(false);
      const next = await request(server, `/world-link/next-action?session=${session}&epoch=${epoch}&ownerCap=${cap}`, { ownerCap: cap });
      expect(next.status).toBe(200);
      expect(next.body.action.actionId).toBe(aid(1));
      const ack = await request(server, '/world-link/action-ack', {
        body: {
          session, epoch, requestId: rid(1), actionId: aid(1),
          result: 'applied', appliedTick: 11, ownerCap: cap
        }, ownerCap: cap
      });
      expect(ack.status).toBe(200);
      expect(ack.body.ack.status).toBe('applied');
      const duplicateAck = await request(server, '/world-link/action-ack', {
        body: { session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 11, ownerCap: cap }, ownerCap: cap
      });
      expect(duplicateAck.status).toBe(200);
      expect(duplicateAck.body.ack.status).toBe('applied');
    });
  });

  it('yield cancels pending + invalidates old epoch; close releases', async () => {
    await withServer(async (server, gateway) => {
      const linked = await request(server, '/world-link/handshake', { body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: OWNER_KEY } });
      expect(linked.status).toBe(200);
      const cap = linked.body.ownerCap;
      const session = linked.body.session as string;
      const epoch = linked.body.epoch as number;
      await request(server, '/world-link/observation', {
        body: { session, epoch, observation: observation(epoch, 10), ownerCap: cap }, ownerCap: cap
      });
      const queued = gateway.submitActions({
        sessionId: session, epoch, requestId: rid(1),
        actions: { actions: [{ type: 'stop', actionId: aid(1) }] }, nowMs: Date.now()
      });
      expect('ok' in queued).toBe(false);
      const yielded = await request(server, '/world-link/yield', {
        body: { session, epoch, reason: 'human-input', ownerCap: cap }, ownerCap: cap
      });
      expect(yielded.status).toBe(200);
      expect(yielded.body.epoch).toBe(epoch + 1);
      const next = await request(server, `/world-link/next-action?session=${session}&epoch=${epoch}&ownerCap=${cap}`, { ownerCap: cap });
      expect(next.status).toBe(409); // old epoch is stale
      const ack = await request(server, '/world-link/action-ack', {
        body: { session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 11, ownerCap: cap }, ownerCap: cap
      });
      expect(ack.status).toBe(409);
      const closed = await request(server, '/world-link/close', { body: { session, ownerCap: cap }, ownerCap: cap });
      expect(closed.status).toBe(200);
      const afterClose = await request(server, `/world-link/next-action?session=${session}&epoch=${epoch + 1}`, { ownerCap: cap });
      expect([403, 404]).toContain(afterClose.status);
    });
  });

  it('heartbeat loss degrades to LOST and does not auto-reconnect', async () => {
    await withServer(async (server, gateway) => {
      const linked = await request(server, '/world-link/handshake', { body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: OWNER_KEY } });
      expect(linked.status).toBe(200);
      const cap = linked.body.ownerCap;
      const session = linked.body.session as string;
      const epoch = linked.body.epoch as number;
      await request(server, '/world-link/observation', {
        body: { session, epoch, observation: observation(epoch, 10), ownerCap: cap }, ownerCap: cap
      });
      await new Promise((resolve) => setTimeout(resolve, 140));
      const view = gateway.listSessions().find((s) => s.session === session);
      expect(view?.status).toBe('lost');
      const next = await request(server, `/world-link/next-action?session=${session}&epoch=${epoch}&ownerCap=${cap}`, { ownerCap: cap });
      expect(next.status).toBe(409); // old epoch is stale
      // A LOST session (browser reload/crash) is reclaimed by a NEW explicit
      // human authorization: no bridge restart, no automatic reconnect. The
      // old session id/epoch is gone and cannot be revived by the same token.
      const reclaimed = await request(server, '/world-link/handshake', { body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: OWNER_KEY } });
      expect(reclaimed.status).toBe(200);
      expect(reclaimed.body.session).not.toBe(session);
      expect(gateway.listSessions().some((s) => s.session === session)).toBe(false);
      const staleAfterReclaim = await request(server, `/world-link/next-action?session=${session}&epoch=${epoch}`, { ownerCap: cap });
      expect(staleAfterReclaim.status).toBeGreaterThanOrEqual(400);
      // A duplicate handshake for the LIVE new session is still refused.
      const duplicate = await request(server, '/world-link/handshake', { body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: OWNER_KEY } });
      expect(duplicate.status).toBe(409); // live link must not be silently replaced
    }, { lostAfterMs: 60 });
  });
  it('server close releases the authorized session (normal close)', async () => {
    const gateway = new WorldGateway({ lostAfterMs: 60 });
    const server = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
    const linked = await request(server, '/world-link/handshake', { body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: OWNER_KEY } });
    expect(linked.status).toBe(200);
    expect(gateway.listSessions()).toHaveLength(1);
    await server.close();
    expect(gateway.listSessions()).toHaveLength(0);
  });

});

describe('C3-a bridge F3: per-operation origin binding', () => {
  it('rejects observe/ACK/yield from an origin other than the handshake origin', async () => {
    const gateway = new WorldGateway({ sessionIdFactory: () => 'ses_' + 'a'.repeat(24) });
    const OTHER = 'http://localhost:5199';
    const server = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN, OTHER], heartbeatIntervalMs: 20 });
    try {
      const linked = await request(server, '/world-link/handshake', { origin: ORIGIN, body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: OWNER_KEY } });
      expect(linked.status).toBe(200);
      const cap = linked.body.ownerCap;
      const { session, epoch } = linked.body;
      const pushed = await request(server, '/world-link/observation', { origin: ORIGIN, body: { session, epoch, observation: observation(epoch, 10), ownerCap: cap }, ownerCap: cap });
      expect(pushed.status).toBe(200);
      // Same tick with different content is a conflict, not a silent overwrite.
      const changed = observation(epoch, 10);
      changed.player.hp = 99;
      const conflict = await request(server, '/world-link/observation', { origin: ORIGIN, body: { session, epoch, observation: changed, ownerCap: cap }, ownerCap: cap });
      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe('E_TICK_CONFLICT');
      // An allowed but non-handshake origin cannot update this session.
      const cross = await request(server, '/world-link/observation', { origin: OTHER, body: { session, epoch, observation: observation(epoch, 11) } });
      expect(cross.status).toBe(403);
      expect(cross.body.code).toBe('E_PERMISSION');
      // Queue an action directly (no action-submit HTTP route by design), then
      // an ACK from the wrong origin must be rejected, correct origin works.
      const sub = gateway.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: { actions: [{ type: 'move', actionId: aid(1), dir: { x: 1, y: 0 }, ticks: 10 }], ttlTicks: 60 }, nowMs: Date.now() });
      expect((sub as any).acceptedTick).toBe(10);
      const ackCross = await request(server, '/world-link/action-ack', { origin: OTHER, body: { session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 12 } });
      expect(ackCross.status).toBe(403);
      const ackOk = await request(server, '/world-link/action-ack', { origin: ORIGIN, body: { session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 12, ownerCap: cap }, ownerCap: cap });
      expect(ackOk.status).toBe(200);
      // Yield from the wrong origin is rejected; correct origin works.
      const yieldCross = await request(server, '/world-link/yield', { origin: OTHER, body: { session, epoch, reason: 'test' } });
      expect(yieldCross.status).toBe(403);
      const yieldOk = await request(server, '/world-link/yield', { origin: ORIGIN, body: { session, epoch, reason: 'test', ownerCap: cap }, ownerCap: cap });
      expect(yieldOk.status).toBe(200);
      expect(gateway.sessionOrigin(session)).toBe(ORIGIN);
      // Close is an authorized op too: a different allowed origin cannot
      // force-close this session; the handshake origin can.
      const closeCross = await request(server, '/world-link/close', { origin: OTHER, body: { session } });
      expect(closeCross.status).toBe(403);
      expect(closeCross.body.code).toBe('E_PERMISSION');
      expect(gateway.listSessions()).toHaveLength(1);
      const closeOk = await request(server, '/world-link/close', { origin: ORIGIN, body: { session, ownerCap: cap }, ownerCap: cap });
      expect(closeOk.status).toBe(200);
      expect(gateway.listSessions()).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
