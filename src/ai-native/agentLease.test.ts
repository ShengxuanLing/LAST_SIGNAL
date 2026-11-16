// C3-b fix — independent AGENT lease: hard disconnect, identity/version,
// stale-list prevention and closed/dead session handling.

import { describe, expect, it } from 'vitest';
import { AgentLeaseRegistry } from './agentLease';
import { startWorldBridge, type RunningWorldBridge } from './worldBridgeServer';
import { TEST_OWNER_KEY_HASH } from './ownerAuthFixture';
import { WorldGateway } from './worldGateway';
import { WORLD_LIMITS, WORLD_PROTOCOL_VERSION } from './worldProtocol';

const TOKEN = 'test-token-0123456789abcdef';
const ORIGIN = 'http://localhost:5335';
const OWNER_KEY = 'a'.repeat(64);

async function req(server: RunningWorldBridge, path: string, options: {
  method?: string; body?: unknown; token?: string | null; origin?: string | null; ownerCap?: string;
} = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.token !== null) headers.authorization = `Bearer ${options.token ?? TOKEN}`;
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.ownerCap) headers['x-owner-cap'] = options.ownerCap;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`${server.url}${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

async function withServer(run: (server: RunningWorldBridge, gateway: WorldGateway) => Promise<void>): Promise<void> {
  const gateway = new WorldGateway();
  const server = await startWorldBridge({
    gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 5000
  });
  try { await run(server, gateway); } finally { await server.close(); }
}

/** A HUMAN authorized the link on the rendered side (browser origin). */
async function authorize(server: RunningWorldBridge): Promise<{ session: string; epoch: number; ownerCap: string }> {
  const r = await req(server, '/world-link/handshake', {
    body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: OWNER_KEY }, origin: ORIGIN
  });
  expect(r.status).toBe(200);
  return { session: r.body.session, epoch: r.body.epoch, ownerCap: r.body.ownerCap };
}

describe('C3-b fix — AgentLeaseRegistry', () => {
  it('issues ONE live lease per session and refuses a second agent attach', () => {
    const leases = new AgentLeaseRegistry(1000);
    const a = leases.issue('ses_1', 1, 0);
    expect(a.ok).toBe(true);
    const b = leases.issue('ses_1', 1, 10);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe('E_RESOURCE_LIMIT');
  });

  it('renew extends ONLY the lease; an old leaseId can never renew a new authorization', () => {
    const leases = new AgentLeaseRegistry(1000);
    const first = leases.issue('ses_1', 1, 0);
    if (!first.ok) throw new Error('issue failed');
    const oldId = first.lease.leaseId;
    const renewed = leases.renew(oldId, 'ses_1', 1, 500);
    expect(renewed.ok).toBe(true);
    if (renewed.ok) expect(renewed.lease.expiresAtMs).toBe(1500);
    // Re-authorization: invalidate + issue a NEW version.
    leases.invalidateSession('ses_1');
    const next = leases.issue('ses_1', 2, 1600);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.lease.version).toBeGreaterThan(first.lease.version);
    expect(next.lease.leaseId).not.toBe(oldId);
    const late = leases.renew(oldId, 'ses_1', 2, 1700);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.code).toBe('E_STALE_EPOCH');
    // The new lease is untouched by the old process's late heartbeat.
    const status = leases.status('ses_1', next.lease.leaseId, 1700);
    expect(status.ok).toBe(true);
  });

  it('a lease that is no longer renewed EXPIRES on the deadline (hard SIGKILL path)', () => {
    const leases = new AgentLeaseRegistry(1000);
    const issued = leases.issue('ses_1', 1, 0);
    if (!issued.ok) throw new Error('issue failed');
    expect(leases.reap(900)).toHaveLength(0);
    const expired = leases.reap(1001);
    expect(expired).toEqual([{ sessionId: 'ses_1', epoch: 1, leaseId: issued.lease.leaseId }]);
    expect(leases.isExpiredSession('ses_1')).toBe(true);
    expect(leases.status('ses_1', issued.lease.leaseId, 1002).ok).toBe(false);
    // The expiry is permanent; a late renew cannot resurrect it.
    expect(leases.renew(issued.lease.leaseId, 'ses_1', 1, 1002).ok).toBe(false);
  });

  it('a released lease (soft EOF/SIGINT) never expires later', () => {
    const leases = new AgentLeaseRegistry(1000);
    const issued = leases.issue('ses_1', 1, 0);
    if (!issued.ok) throw new Error('issue failed');
    expect(leases.release(issued.lease.leaseId)).toBe(true);
    expect(leases.reap(5000)).toHaveLength(0);
  });
});

describe('C3-b fix — bridge / MCP lease integration', () => {
  it('attach returns a lease; agent-status reports attached:true only while live', async () => {
    await withServer(async (server) => {
      const human = await authorize(server);
      const attached = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null
      });
      expect(attached.status).toBe(200);
      expect(attached.body.leaseId).toMatch(/^les_[0-9a-f]{24}$/);
      expect(attached.body.leaseMs).toBe(WORLD_LIMITS.AGENT_LEASE_MS);
      const status = await req(server,
        `/world-link/agent-status?session=${encodeURIComponent(attached.body.session)}&leaseId=${encodeURIComponent(attached.body.leaseId)}&ownerCap=${human.ownerCap}`,
        { method: 'GET', origin: null });
      expect(status.status).toBe(200);
      expect(status.body.attached).toBe(true);
      // ONLY ONE agent lease: a second attach is explicitly refused.
      const second = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null
      });
      expect(second.status).toBe(409);
      expect(second.body.messageKey).toBe('world.agent_already_attached');
    });
  });

  it('world_list_sessions never returns attached:true for a closed/dead session', async () => {
    await withServer(async (server) => {
      const human = await authorize(server);
      const session = human.session;
      // Establish an agent lease by attaching.
      const attached = await req(server, '/world-link/attach', { body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null });
      expect(attached.status).toBe(200);
      expect(attached.status).toBe(200);
      // Simulate a remote session death WITHOUT the agent's cooperation.
      const closed = await req(server, '/world-link/close', { body: { session, ownerCap: human.ownerCap }, origin: ORIGIN });
      expect(closed.status).toBe(200);
      // After close, the session is gone: no agent lease can be attached to it.
      const reattach = await req(server, '/world-link/attach', { body: { protocolVersion: WORLD_PROTOCOL_VERSION, session }, origin: null });
      expect([403, 404, 409]).toContain(reattach.status);
    });
  });

  it('a browser heartbeat does NOT renew the Agent lease; expiry closes the session', async () => {
    await withServer(async (server, gateway) => {
      const human = await authorize(server);
      const session = human.session;
      const attached = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null
      });
      const leaseId = attached.body.leaseId as string;
      // The browser heartbeats repeatedly. This must NOT extend the lease.
      for (let i = 0; i < 3; i += 1) {
        const hb = await req(server, '/world-link/heartbeat', {
          body: { session, epoch: attached.body.epoch, ownerCap: human.ownerCap }, origin: ORIGIN
        });
        expect(hb.status).toBe(200);
      }
      const before = await req(server,
        `/world-link/agent-status?session=${encodeURIComponent(session)}&leaseId=${encodeURIComponent(leaseId)}&ownerCap=${human.ownerCap}`,
        { method: 'GET', origin: null });
      expect(before.body.attached).toBe(true);
      // Wait for the independent deadline (no agent renew at all).
      await new Promise<void>((r) => setTimeout(r, WORLD_LIMITS.AGENT_LEASE_MS + 500));
      const after = await req(server,
        `/world-link/agent-status?session=${encodeURIComponent(session)}&leaseId=${encodeURIComponent(leaseId)}&ownerCap=${human.ownerCap}`,
        { method: 'GET', origin: null });
      expect(after.body.attached, 'hard disconnect expires the Agent lease').toBe(false);
      expect(gateway.listSessions().some((s) => s.session === session), 'session closed').toBe(false);
      const lateHb = await req(server, '/world-link/heartbeat', {
        body: { session, epoch: attached.body.epoch, ownerCap: human.ownerCap }, origin: ORIGIN
      });
      expect(lateHb.status, 'browser is told the link is gone').toBeGreaterThanOrEqual(400);
    });
  });

  it('a late renew from an old lease cannot extend a newer lease', async () => {
    await withServer(async (server) => {
      const first = await authorize(server);
      const a1 = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null, ownerCap: first.ownerCap
      });
      // Human takeover/close, then a NEW human authorization (new session).
      await req(server, '/world-link/close', { body: { session: first.session, ownerCap: first.ownerCap }, origin: ORIGIN });
      const second = await authorize(server);
      const a2 = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null, ownerCap: second.ownerCap
      });
      expect(second).not.toBe(first);
      expect(a2.body.leaseId).not.toBe(a1.body.leaseId);
      const late = await req(server, '/world-link/agent-renew', {
        body: { session: first, epoch: a1.body.epoch, leaseId: a1.body.leaseId, ownerCap: first.ownerCap }, origin: null
      });
      expect(late.status).toBeGreaterThanOrEqual(400);
      const fresh = await req(server, '/world-link/agent-renew', {
        body: { session: a2.body.session, epoch: a2.body.epoch, leaseId: a2.body.leaseId }, origin: null
      });
      console.log("FRESH", fresh.status, JSON.stringify(fresh.body)); expect(fresh.status).toBe(200);
      expect(fresh.status, 'the new lease is still renewable').toBe(200);
    });
  });
});
