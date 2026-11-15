// C3-b fix — async lifecycle / generation-token regressions.
// Reproduces the reviewer's `afterFrame await pushObservation -> degrade ->
// this.client.heartbeat() on null` race, plus late callbacks, overlap and
// repeated EOF/heartbeat loss. No Phaser, no browser, no real network.

import { describe, expect, it } from 'vitest';
import { ExternalLinkState } from './externalLink';
import { ExternalLinkController } from './externalLinkController';
import type { World } from '../world/World';

interface Gate { promise: Promise<void>; release: () => void; }

function gate(): Gate {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function response(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body
  } as unknown as Response;
}

class Harness {
  readonly link = new ExternalLinkState();
  readonly calls: string[] = [];
  heartbeats = 0;
  pushes = 0;
  acks = 0;
  yields = 0;
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
    disableExternal(_reason?: string) { this.owner = 'human'; },
    noteExternalAction() { /* no-op */ }
  };
  readonly world: World;
  readonly pushGate = gate();
  readonly nextGate = gate();
  readonly ackGate = gate();
  private gated = false;
  private nextGated = false;
  private ackGated = false;

  constructor(private readonly held: { push?: boolean; next?: boolean; ack?: boolean } = {}) {
    const self = this;
    const view = {
      protocolVersion: 1,
      visibilityBasis: 'grid-radius+explored+line-of-sight',
      perception: {
        basis: 'grid-radius+explored+line-of-sight',
        center: { x: 10, y: 10 }, radiusTiles: 12, probeRadiusTiles: 1.5,
        requiresExplored: true, requiresLineOfSight: true
      },
      player: { x: 10, y: 10, alive: true, hp: 100, maxHp: 100 },
      roomId: 0,
      perceivedActors: [] as unknown[],
      boss: null,
      portal: null
    };
    this.world = {
      externalLink: this.link,
      player: {
        control: this.control,
        data: { weaponKey: 'pulse', weapons: [{ key: 'pulse', ammo: -1, magazine: -1 }] }
      },
      sim: this.sim,
      observationView: () => view,
      isPerceivablePosition: () => true,
      enqueueExternalIntent: (command: any) => this.link.enqueueIntent(command, this.sim.tick)
    } as unknown as World;

    void self;
  }

  fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const path = String(url);
    this.calls.push(path);
    if (path.includes('/world-link/handshake')) {
      return response({ ok: true, session: 'ses_lifecycle_1', epoch: 1, ownerCap: 'c'.repeat(64), heartbeatMs: 1000 });
    }
    if (path.includes('/world-link/next-action')) {
      if (this.held.next && !this.nextGated) {
        this.nextGated = true;
        await this.awaitOrAbort(this.nextGate.promise, init?.signal);
      }
      return response({ ok: true, action: null });
    }
    if (path.includes('/world-link/observation') && init?.method === 'POST') {
      this.pushes += 1;
      if (this.held.push && !this.gated) {
        this.gated = true;
        await this.awaitOrAbort(this.pushGate.promise, init?.signal);
      }
      return response({ ok: true, tick: this.sim.tick });
    }
    if (path.includes('/world-link/action-ack')) {
      this.acks += 1;
      if (this.held.ack && !this.ackGated) {
        this.ackGated = true;
        await this.awaitOrAbort(this.ackGate.promise, init?.signal);
      }
      return response({ ok: true });
    }
    if (path.includes('/world-link/heartbeat')) {
      this.heartbeats += 1;
      return response({ ok: true });
    }
    if (path.includes('/world-link/yield')) { this.yields += 1; return response({ ok: true }); }
    if (path.includes('/world-link/close')) return response({ ok: true });
    return response({ ok: true });
  };

  private awaitOrAbort(promise: Promise<void>, signal?: AbortSignal | null): Promise<void> {
    if (!signal) return promise;
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new Error('aborted'));
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(() => { signal.removeEventListener('abort', onAbort); resolve(); }, reject);
    });
  }

  controller(): ExternalLinkController {
    return new ExternalLinkController({
      world: this.world,
      bridgeUrl: 'http://127.0.0.1:1',
      token: 'test-token-not-a-secret',
      ownerKey: 'a'.repeat(64),
      authorize: () => undefined,
      fetchImpl: this.fetchImpl as unknown as typeof fetch,
      heartbeatMs: 0 // force a heartbeat attempt on every afterFrame
    });
  }

  async tick(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
}

describe('C3-b fix — async lifecycle / generation tokens', () => {
  it('degrade DURING the pushObservation await never heartbeats / ACKs or throws', async () => {
    const h = new Harness({ push: true });
    const controller = h.controller();
    expect(await controller.authorizeHuman()).toBe(true);
    const inFlight = controller.afterFrame();
    await h.tick();
    expect(h.pushes).toBe(1);
    controller.degrade('takeover');
    h.pushGate.release();
    await expect(inFlight).resolves.toBeUndefined();
    expect(h.heartbeats).toBe(0);
    expect(h.acks).toBe(0);
    expect(h.link.status).toBe('YIELDED');
    expect(h.control.owner).toBe('human');
    // No follow-up frame may re-attach or heartbeat in the yielded epoch.
    await controller.afterFrame();
    expect(h.heartbeats).toBe(0);
    expect(h.pushes).toBe(1);
  });

  it('a late beforeFrame continuation cannot start an action in the new epoch', async () => {
    const h = new Harness({ next: true });
    const controller = h.controller();
    expect(await controller.authorizeHuman()).toBe(true);
    const inFlight = controller.beforeFrame();
    await h.tick();
    controller.degrade('human-input' as any);
    h.nextGate.release();
    await expect(inFlight).resolves.toBeUndefined();
    expect(h.link.hasActive).toBe(false);
    expect(h.link.pendingCount).toBe(0);
  });

  it('a late ACK continuation cannot heartbeat, push or re-attach after degrade', async () => {
    const h = new Harness({ ack: true });
    const controller = h.controller();
    expect(await controller.authorizeHuman()).toBe(true);
    // Produce a REAL post-commit completion.
    h.link.enqueueIntent({
      actionId: 'act_1', requestId: 'req_1',
      intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false },
      applyByTick: 1000, ttlTicks: 600, durationTicks: 1
    }, h.sim.tick);
    h.link.beginExecution(h.sim.tick, h.link.epoch);
    h.link.advanceExecution(1, 1);
    const inFlight = controller.afterFrame();
    await h.tick();
    controller.degrade('takeover');
    h.ackGate.release();
    await expect(inFlight).resolves.toBeUndefined();
    expect(h.heartbeats).toBe(0);
    expect(h.pushes).toBe(0);
    expect(h.link.status).toBe('YIELDED');
    expect(h.link.drainCompleted()).toHaveLength(0);
  });

  it('repeated EOF / heartbeat loss degrades once per reason and never auto re-attaches', async () => {
    const h = new Harness();
    const controller = h.controller();
    expect(await controller.authorizeHuman()).toBe(true);
    const epochs: number[] = [];
    for (const reason of ['heartbeat-loss', 'disconnect', 'scene-exit'] as const) {
      epochs.push(h.link.epoch);
      controller.degrade(reason);
    }
    expect(new Set(epochs).size).toBe(3);
    expect(h.link.status === 'LOST' || h.link.status === 'YIELDED').toBe(true);
    const callsBefore = h.calls.length;
    await controller.beforeFrame();
    await controller.afterFrame();
    expect(h.calls.length).toBe(callsBefore);
    expect(h.link.session).toBeNull();
  });

  it('beforeFrame / afterFrame do not overlap a commit/read', async () => {
    const h = new Harness({ push: true });
    const controller = h.controller();
    expect(await controller.authorizeHuman()).toBe(true);
    const a = controller.afterFrame();
    const b = controller.afterFrame();
    await h.tick();
    expect(h.pushes).toBe(1);
    h.pushGate.release();
    await Promise.all([a, b]);
    const c = controller.beforeFrame();
    const d = controller.beforeFrame();
    await h.tick();
    expect(h.calls.filter((x) => x.includes('/world-link/next-action')).length).toBe(1);
    await Promise.all([c, d]);
  });

  it('a duplicate actionId is enqueued once and produces one completion', async () => {
    const h = new Harness();
    const controller = h.controller();
    expect(await controller.authorizeHuman()).toBe(true);
    const base = {
      actionId: 'act_dup', requestId: 'req_dup',
      intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false },
      applyByTick: 1000, ttlTicks: 600, durationTicks: 3
    };
    const first = h.world.enqueueExternalIntent(base as never);
    const second = h.world.enqueueExternalIntent(base as never);
    expect(first).toBe(second);
    expect(h.link.pendingCount).toBe(1);
    h.link.beginExecution(h.sim.tick, h.link.epoch);
    h.link.advanceExecution(3, 3);
    expect(h.link.drainCompleted()).toHaveLength(1);
    expect(h.link.drainCompleted()).toHaveLength(0);
  });
});
