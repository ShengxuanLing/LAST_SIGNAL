// C3-b Task0 — STOP preemption, credential cleanup and bounded lease history.

import { describe, expect, it } from 'vitest';
import { AGENT_LEASE_CAPS, AgentLeaseRegistry } from './agentLease';
import { ExternalLinkState } from './externalLink';
import { ExternalLinkController } from './externalLinkController';
import { startWorldBridge } from './worldBridgeServer';
import { WorldGateway } from './worldGateway';
import { WORLD_PROTOCOL_VERSION } from './worldProtocol';
import type { World } from '../world/World';

const TOKEN = 'task0-token-0123456789abcdef';
const ORIGIN = 'http://localhost:5335';

function linked(): ExternalLinkState {
  const state = new ExternalLinkState();
  const a = state.authorize(true);
  if (!a.ok) throw new Error('authorize failed');
  state.connected('ses_task0', a.epoch);
  return state;
}

function move(actionId: string, durationTicks: number, applyByTick = 1000) {
  return {
    actionId, requestId: `req_${actionId}`,
    intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false },
    applyByTick, ttlTicks: 600, durationTicks
  };
}

function stop(actionId: string, applyByTick = 1000) {
  return {
    actionId, requestId: `req_${actionId}`,
    intent: { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false },
    applyByTick, ttlTicks: 600, durationTicks: 1
  };
}

describe('Task0 — STOP preemption', () => {
  it('preempts the active action, records executed ticks and applies a real neutral stop', () => {
    const state = linked();
    state.enqueueIntent(move('move120', 120), 10);
    state.enqueueIntent(stop('stop1'), 10);
    state.enqueueIntent(move('after', 20), 10);
    state.beginExecution(10, state.epoch);
    state.advanceExecution(5, 15);
    expect(state.receipt('move120')?.status).toBe('executing');
    expect(state.receipt('move120')?.executedTicks).toBe(5);

    const preempted = state.preemptActive(15, 'E_PREEMPTED');
    expect(preempted?.receipt.status).toBe('cancelled');
    expect(preempted?.receipt.code).toBe('E_PREEMPTED');
    expect(preempted?.receipt.executedTicks).toBe(5);
    expect(preempted?.receipt.startedTick).toBe(10);
    expect(preempted?.receipt.completedTick).toBe(15);
    expect(state.hasActive).toBe(false);

    // The stop is then a real 1-tick neutral commit.
    const started = state.beginExecution(15, state.epoch);
    expect(started?.actionId).toBe('stop1');
    expect(started?.intent).toEqual({ move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    const done = state.advanceExecution(1, 16);
    expect(done?.receipt.status).toBe('applied');
    expect(done?.receipt.executedTicks).toBe(1);

    // Other queued actions keep FIFO order and are NOT cancelled by the stop.
    expect(state.beginExecution(16, state.epoch)?.actionId).toBe('after');
    state.advanceExecution(20, 36);
    expect(state.receipt('after')?.status).toBe('applied');
    expect(state.receipt('after')?.executedTicks).toBe(20);
  });

  it('preempting with no active action is a no-op (no fake receipt)', () => {
    const state = linked();
    expect(state.preemptActive(10)).toBeNull();
    expect(state.drainCompleted()).toHaveLength(0);
  });

  it('human takeover still cancels immediately (stop is not required)', () => {
    const state = linked();
    state.enqueueIntent(move('m', 120), 10);
    state.beginExecution(10, state.epoch);
    state.advanceExecution(3, 13);
    const result = state.yield('takeover');
    expect(result.cancelled[0].status).toBe('cancelled');
    expect(result.cancelled[0].executedTicks).toBe(3);
    expect(state.hasActive).toBe(false);
  });
});

describe('Task0 — bounded lease history', () => {
  it('1000 issue/invalidate cycles stay within the hard caps', () => {
    const leases = new AgentLeaseRegistry(1000);
    for (let i = 0; i < 1000; i += 1) {
      const issued = leases.issue(`ses_${i}`, 1, i);
      expect(issued.ok).toBe(true);
      if (!issued.ok) continue;
      leases.invalidateSession(`ses_${i}`);
      leases.release(issued.lease.leaseId);
    }
    const stats = leases.stats();
    expect(stats.leases).toBeLessThanOrEqual(AGENT_LEASE_CAPS.MAX_LEASE_RECORDS);
    expect(stats.expiredSessions).toBeLessThanOrEqual(AGENT_LEASE_CAPS.MAX_EXPIRED_SESSIONS);
    expect(stats.versionSessions).toBeLessThanOrEqual(AGENT_LEASE_CAPS.MAX_VERSION_SESSIONS);
    expect(stats.liveLeases).toBe(0);
  });

  it('an invalidated old lease cannot renew (never a new session)', () => {
    const leases = new AgentLeaseRegistry(1000);
    const first = leases.issue('ses_a', 1, 0);
    if (!first.ok) throw new Error('issue failed');
    leases.invalidateSession('ses_a');
    const late = leases.renew(first.lease.leaseId, 'ses_a', 1, 10);
    expect(late.ok).toBe(false);
    expect(leases.status('ses_a', first.lease.leaseId, 10).ok).toBe(false);
    // A NEW authorization gets a new lease; the old one still cannot renew it.
    const next = leases.issue('ses_a', 2, 20);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(leases.renew(first.lease.leaseId, 'ses_a', 2, 30).ok).toBe(false);
    expect(leases.renew(next.lease.leaseId, 'ses_a', 2, 30).ok).toBe(true);
  });

  it('1000 gateway+lease lifecycle cycles stay bounded (same state machine the bridge uses)', () => {
    const leases = new AgentLeaseRegistry(1000);
    const gateway = new WorldGateway();
    for (let i = 0; i < 1000; i += 1) {
      const linked = gateway.linkSession({ authorized: true, origin: ORIGIN, nowMs: i });
      if (!linked.ok) throw new Error('link failed');
      const issued = leases.issue(linked.session, linked.epoch, i);
      if (!issued.ok) throw new Error('lease failed');
      gateway.closeSession(linked.session, i);
      leases.invalidateSession(linked.session);
      leases.release(issued.lease.leaseId);
    }
    expect(gateway.listSessions().length).toBe(0);
    const stats = leases.stats();
    expect(stats.leases).toBeLessThanOrEqual(AGENT_LEASE_CAPS.MAX_LEASE_RECORDS);
    expect(stats.expiredSessions).toBeLessThanOrEqual(AGENT_LEASE_CAPS.MAX_EXPIRED_SESSIONS);
    expect(stats.versionSessions).toBeLessThanOrEqual(AGENT_LEASE_CAPS.MAX_VERSION_SESSIONS);
  });

  it('real HTTP bridge routes stay bounded across many sessions', async () => {
    const gateway = new WorldGateway();
    const bridge = await startWorldBridge({ gateway, token: TOKEN, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 50 });
    try {
      for (let i = 0; i < 120; i += 1) {
        const hs = await fetch(`${bridge.url}/world-link/handshake`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
          body: JSON.stringify({ authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION })
        });
        const session = (await hs.json()) as { session: string; epoch: number };
        const attach = await fetch(`${bridge.url}/world-link/attach`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ protocolVersion: WORLD_PROTOCOL_VERSION })
        });
        const lease = (await attach.json()) as { leaseId?: string };
        await fetch(`${bridge.url}/world-link/close`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
          body: JSON.stringify({ session: session.session })
        });
        if (lease.leaseId) {
          await fetch(`${bridge.url}/world-link/agent-disconnect`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
            body: JSON.stringify({ session: session.session, epoch: session.epoch, leaseId: lease.leaseId })
          });
        }
      }
      expect(gateway.listSessions().length, 'no closed session retained').toBe(0);
      const stats = bridge.leaseStats();
      expect(stats.leases).toBeLessThanOrEqual(AGENT_LEASE_CAPS.MAX_LEASE_RECORDS);
      expect(stats.expiredSessions).toBeLessThanOrEqual(AGENT_LEASE_CAPS.MAX_EXPIRED_SESSIONS);
      expect(stats.versionSessions).toBeLessThanOrEqual(AGENT_LEASE_CAPS.MAX_VERSION_SESSIONS);
    } finally {
      await bridge.close();
    }
  }, 120000);
});

describe('Task0 — credential cleanup', () => {
  class Harness {
    readonly link = new ExternalLinkState();
    readonly sim = {
      tick: 0,
      player: { aimYaw: 0 },
      drones: [] as unknown[],
      targets: [] as unknown[],
      projectiles: [] as unknown[]
    };
    readonly control = {
      owner: 'human' as string,
      paused: false,
      enableExternal() { this.owner = 'external'; },
      disableExternal(_r?: string) { this.owner = 'human'; },
      noteExternalAction() { /* no-op */ }
    };
    readonly world: World;
    readonly fetchImpl = async (url: string): Promise<Response> => {
      if (String(url).includes('/world-link/handshake')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, session: 'ses_t0', epoch: 1 }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    };
    constructor() {
      const view = {
        protocolVersion: 1,
        visibilityBasis: 'grid-radius+explored+line-of-sight',
        perception: { basis: 'grid-radius+explored+line-of-sight', center: { x: 0, y: 0 }, radiusTiles: 12, probeRadiusTiles: 1.5, requiresExplored: true, requiresLineOfSight: true },
        player: { x: 0, y: 0, alive: true, hp: 100, maxHp: 100 },
        roomId: 0, perceivedActors: [] as unknown[], boss: null, portal: null
      };
      this.world = {
        externalLink: this.link,
        player: { control: this.control, data: { weaponKey: 'pulse', weapons: [{ key: 'pulse', ammo: -1, magazine: -1 }] } },
        sim: this.sim,
        observationView: () => view,
        isPerceivablePosition: () => true,
        enqueueExternalIntent: (c: any) => this.link.enqueueIntent(c, this.sim.tick)
      } as unknown as World;
    }
    controller(): ExternalLinkController {
      return new ExternalLinkController({
        world: this.world,
        bridgeUrl: 'http://127.0.0.1:1',
        token: TOKEN,
        authorize: () => undefined,
        fetchImpl: this.fetchImpl as unknown as typeof fetch,
        heartbeatMs: 0
      });
    }
  }

  it('the token is not left in globalThis after a successful authorization', async () => {
    const h = new Harness();
    (globalThis as any).__externalLinkConfig = { bridgeUrl: 'http://127.0.0.1:1', token: TOKEN };
    const controller = h.controller();
    expect(await controller.authorizeHuman()).toBe(true);
    // Credentials remain ONLY inside the live controller.
    expect((controller as any).token).toBe(TOKEN);
    controller.forgetCredentials();
    expect((controller as any).token).toBe('');
    expect((globalThis as any).__externalLinkConfig).toBeUndefined();
  });

  it('degrade() and dispose() drop credentials', async () => {
    const a = new Harness();
    const ca = a.controller();
    expect(await ca.authorizeHuman()).toBe(true);
    ca.degrade('takeover');
    expect((ca as any).token).toBe('');
    expect((ca as any).bridgeUrl).toBe('');
    expect((globalThis as any).__externalLinkConfig).toBeUndefined();

    const b = new Harness();
    const cb = b.controller();
    expect(await cb.authorizeHuman()).toBe(true);
    await cb.dispose('scene-exit');
    expect((cb as any).token).toBe('');
    expect((globalThis as any).__externalLinkConfig).toBeUndefined();
  });
});
