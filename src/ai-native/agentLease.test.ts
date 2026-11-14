// C3-b fix — independent AGENT lease: hard disconnect, identity/version,
// stale-list prevention and closed/dead session handling.

import { describe, expect, it } from 'vitest';
import { AgentLeaseRegistry } from './agentLease';
import { startWorldBridge, type RunningWorldBridge } from './worldBridgeServer';
import { WorldGateway } from './worldGateway';
import { WorldClient } from './worldClient';
import { WORLD_LIMITS, WORLD_PROTOCOL_VERSION } from './worldProtocol';

const TOKEN = 'test-token-0123456789abcdef';
const ORIGIN = 'http://localhost:5335';

async function req(server: RunningWorldBridge, path: string, options: {
  method?: string; body?: unknown; token?: string | null; origin?: string | null;
} = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.token !== null) headers.authorization = `Bearer ${options.token ?? TOKEN}`;
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
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
    gateway, token: TOKEN, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 50
  });
  try { await run(server, gateway); } finally { await server.close(); }
}

async function authorize(server: RunningWorldBridge): Promise<string> {
  const r = await req(server, '/world-link/handshake', {
    body: { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION }, origin: ORIGIN
  });
  expect(r.status).toBe(200);
  return r.body.session as string;
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
      await authorize(server);
      const attached = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null
      });
      expect(attached.status).toBe(200);
      expect(attached.body.leaseId).toMatch(/^les_[0-9a-f]{24}$/);
      expect(attached.body.leaseMs).toBe(WORLD_LIMITS.AGENT_LEASE_MS);
      const status = await req(server,
        `/world-link/agent-status?session=${encodeURIComponent(attached.body.session)}&leaseId=${encodeURIComponent(attached.body.leaseId)}`,
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
      await authorize(server);
      const client = new WorldClient({ bridgeUrl: server.url, token: TOKEN });
      const handshake = await client.handshake();
      expect('ok' in handshake && handshake.ok).toBe(true);
      const before = await client.status();
      expect(before.attached).toBe(true);
      expect(client.sessionId).not.toBeNull();
      // Simulate a remote session death WITHOUT the agent's cooperation.
      const closed = await req(server, '/world-link/close', {
        body: { session: client.sessionId }, origin: ORIGIN
      });
      expect(closed.status).toBe(200);
      const after = await client.status();
      expect(after.attached, 'closed session must not be attached').toBe(false);
      expect(after.ok).toBe(false);
      expect(client.sessionId, 'local attached cache cleared immediately').toBeNull();
      expect(client.detached, 'no automatic re-attach').toBe(true);
      const observe = await client.observe();
      expect(observe.ok).toBe(false);
      await client.close();
    });
  });

  it('a browser heartbeat does NOT renew the Agent lease; expiry closes the session', async () => {
    await withServer(async (server, gateway) => {
      const session = await authorize(server);
      const attached = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null
      });
      const leaseId = attached.body.leaseId as string;
      // The browser heartbeats repeatedly. This must NOT extend the lease.
      for (let i = 0; i < 3; i += 1) {
        const hb = await req(server, '/world-link/heartbeat', {
          body: { session, epoch: attached.body.epoch }, origin: ORIGIN
        });
        expect(hb.status).toBe(200);
      }
      const before = await req(server,
        `/world-link/agent-status?session=${encodeURIComponent(session)}&leaseId=${encodeURIComponent(leaseId)}`,
        { method: 'GET', origin: null });
      expect(before.body.attached).toBe(true);
      // Wait for the independent deadline (no agent renew at all).
      await new Promise<void>((r) => setTimeout(r, WORLD_LIMITS.AGENT_LEASE_MS + 500));
      const after = await req(server,
        `/world-link/agent-status?session=${encodeURIComponent(session)}&leaseId=${encodeURIComponent(leaseId)}`,
        { method: 'GET', origin: null });
      expect(after.body.attached, 'hard disconnect expires the Agent lease').toBe(false);
      expect(gateway.listSessions().some((s) => s.session === session), 'session closed').toBe(false);
      const lateHb = await req(server, '/world-link/heartbeat', {
        body: { session, epoch: attached.body.epoch }, origin: ORIGIN
      });
      expect(lateHb.status, 'browser is told the link is gone').toBeGreaterThanOrEqual(400);
      expect(lateHb.body.messageKey).toBe('world.agent_lease_expired');
    });
  });

  it('a late renew from an old lease cannot extend a newer lease', async () => {
    await withServer(async (server) => {
      const first = await authorize(server);
      const a1 = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null
      });
      // Human takeover/close, then a NEW human authorization (new session).
      await req(server, '/world-link/close', { body: { session: first }, origin: ORIGIN });
      const second = await authorize(server);
      const a2 = await req(server, '/world-link/attach', {
        body: { protocolVersion: WORLD_PROTOCOL_VERSION }, origin: null
      });
      expect(second).not.toBe(first);
      expect(a2.body.leaseId).not.toBe(a1.body.leaseId);
      const late = await req(server, '/world-link/agent-renew', {
        body: { session: first, epoch: a1.body.epoch, leaseId: a1.body.leaseId }, origin: null
      });
      expect(late.status).toBeGreaterThanOrEqual(400);
      const fresh = await req(server, '/world-link/agent-renew', {
        body: { session: second, epoch: a2.body.epoch, leaseId: a2.body.leaseId }, origin: null
      });
      expect(fresh.status, 'the new lease is still renewable').toBe(200);
    });
  });
});
