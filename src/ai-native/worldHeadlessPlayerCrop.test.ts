// C3c player-crop fix — manager-level allowlist, intent audit, idempotency and
// terminal/epoch boundaries. The WIRE-level (structuredContent + text) check
// lives in `worldHeadlessPlayerCrop.mts` against the real MCP SDK binary.

import { describe, expect, it } from 'vitest';
import { HeadlessWorldManager, parsePlayerIntent } from './worldHeadlessMcpTools';

const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;

const FORBIDDEN = ['canonicalState', 'canonicalEvents', 'seed', 'rngState', 'map', 'mapHash', 'mapSeed', 'pendingCommands', 'purchaseTransactions', 'nextLootId', 'nextProjectileId', 'coreState'];

function body(result: any): any {
  return result.structuredContent ?? { ok: false, code: 'E_SCHEMA' };
}
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) { for (const v of value) allKeys(v, out); return out; }
  if (!value || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) { out.push(k); allKeys(v, out); }
  return out;
}
function expectNoOwnerKeys(value: unknown): void {
  const leaked = allKeys(value).filter((k) => FORBIDDEN.includes(k));
  expect(leaked, 'no owner-only keys').toEqual([]);
  const text = JSON.stringify(value);
  for (const needle of ['canonicalState', 'canonicalEvents', 'rngState', 'pendingCommands', 'purchaseTransactions']) {
    expect(text).not.toContain(needle);
  }
}

function player(): HeadlessWorldManager {
  let seed = 4242;
  return new HeadlessWorldManager(false, () => (seed += 1));
}
function dev(): HeadlessWorldManager {
  let seed = 424242;
  return new HeadlessWorldManager(true, () => (seed += 1));
}

describe('C3c fix — Player output allowlist', () => {
  it('create / observe / list / close expose only public data', () => {
    const manager = player();
    const created = body(manager.createSession());
    expect(created.ok).toBe(true);
    expectNoOwnerKeys(created);
    expect(Object.keys(created).sort()).toEqual(['epoch', 'observation', 'ok', 'schema', 'session', 'status', 'tick']);
    const observed = body(manager.observe(created.session));
    expectNoOwnerKeys(observed);
    expect(Object.keys(observed.observation).sort()).toEqual([
      'availableActions', 'drones', 'epoch', 'player', 'projectiles', 'protocolVersion', 'roomId', 'schema', 'tick'
    ]);
    const listed = body(manager.listSessions());
    expectNoOwnerKeys(listed);
    const closed = body(manager.close(created.session));
    expectNoOwnerKeys(closed);
  });

  it('action returns only a public receipt (no seed/map/RNG)', () => {
    const manager = player();
    const created = body(manager.createSession());
    const drone = body(manager.observe(created.session)).observation.drones[0];
    const action = body(manager.action(created.session, created.epoch, rid(1), [
      { type: 'fire', actionId: aid(1), target: { x: drone.x, y: drone.y }, ticks: 10 }
    ], 600));
    expect(action.ok).toBe(true);
    expectNoOwnerKeys(action);
    expect(Object.keys(action).sort()).toEqual(['acceptedTick', 'actions', 'applyByTick', 'epoch', 'ok', 'replayed', 'requestId', 'schema', 'session'].sort());
    expect(Object.keys(action.actions[0]).sort()).toEqual(['actionId', 'applyByTick', 'status']);
  });

  it('step exposes NO canonicalState/canonicalEvents (Player)', () => {
    const manager = player();
    const created = body(manager.createSession());
    const step = body(manager.step(created.session, created.epoch, rid(2), 5));
    expect(step.ok).toBe(true);
    expectNoOwnerKeys(step);
    expect(Object.keys(step).sort()).toEqual([
      'applied', 'blockTicks', 'epoch', 'eventCount', 'eventTotal', 'events',
      'eventsFingerprint', 'eventsRetained', 'eventsTruncated', 'executing', 'fromTick',
      'nextCursor', 'observation', 'ok', 'rejected', 'replayed', 'requestId', 'schema',
      'session', 'stateFingerprint', 'status', 'ticks', 'toTick'
    ].sort());
    expect(step.canonicalState).toBeUndefined();
    expect(step.canonicalEvents).toBeUndefined();
  });

  it('an idempotent step replay does not leak owner data', () => {
    const manager = player();
    const created = body(manager.createSession());
    body(manager.step(created.session, created.epoch, rid(3), 5));
    const replay = body(manager.step(created.session, created.epoch, rid(3), 5));
    expect(replay.replayed).toBe(true);
    expectNoOwnerKeys(replay);
    expect(replay.canonicalState).toBeUndefined();
  });

  it('Dev keeps canonical + snapshot + inspect detail', () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    expect(created.seed).toBe(424242);
    const step = body(manager.step(created.session, created.epoch, rid(1), 5));
    // Dev step returns hashes + a bounded window, never the full canonical text.
    expect(typeof step.stateFingerprint).toBe('string');
    expect(typeof step.eventsFingerprint).toBe('string');
    expect(step.canonicalState).toBeUndefined();
    expect(step.canonicalEvents).toBeUndefined();
    const snapshot = body(manager.snapshot(created.session));
    expect(typeof snapshot.ref).toBe('string');
    const stateView = body(manager.devState(created.session));
    expect(stateView.canonicalState).toContain('"seed"');
    const inspect = body(manager.inspect(created.session));
    expect(typeof inspect.inspect.rngState).toBe('number');
  });

  it('Player error paths never carry owner data', () => {
    const manager = player();
    const created = body(manager.createSession());
    const stale = body(manager.step(created.session, created.epoch - 1, rid(4), 5));
    expect(stale.ok).toBe(false);
    expectNoOwnerKeys(stale);
    expect(Object.keys(stale).sort()).toEqual(['code', 'messageKey', 'ok', 'schema']);
    // Player cannot call Dev tools at all.
    const denied = body(manager.inspect(created.session));
    expectNoOwnerKeys(denied);
    expect(denied.code).toBe('E_PERMISSION');
  });

  it('Player export/failure path never returns an owner file path', async () => {
    const manager = player();
    const created = body(manager.createSession());
    const exported = body(await manager.exportFailure(created.session, 'probe'));
    expect(exported.ok).toBe(false);
    expect(exported.code).toBe('E_PERMISSION');
    expect(exported.path).toBeUndefined();
    expectNoOwnerKeys(exported);
  });
});

describe('C3c fix — Player step boundaries', () => {
  it('after the encounter ends, a NEW Player step is rejected (replay still works)', () => {
    const manager = player();
    const created = body(manager.createSession());
    const drone = body(manager.observe(created.session)).observation.drones[0];
    body(manager.action(created.session, created.epoch, rid(1), [
      { type: 'fire', actionId: aid(1), target: { x: drone.x, y: drone.y }, ticks: 60 }
    ], 600));
    const cleared = body(manager.step(created.session, created.epoch, rid(2), 60));
    expect(cleared.status).toBe('cleared');
    const again = body(manager.step(created.session, created.epoch, rid(5), 5));
    expect(again.ok).toBe(false);
    expect(again.code).toBe('E_NOT_APPLICABLE');
    // The SAME request is still an idempotent replay (no second execution).
    const replay = body(manager.step(created.session, created.epoch, rid(2), 60));
    expect(replay.replayed).toBe(true);
    expect(replay.toTick).toBe(cleared.toTick);
  });

  it('an old epoch is rejected; a same-id different payload is rejected', () => {
    const manager = player();
    const created = body(manager.createSession());
    body(manager.step(created.session, created.epoch, rid(1), 5));
    expect(body(manager.step(created.session, created.epoch - 1, rid(2), 5)).code).toBe('E_STALE_EPOCH');
    expect(body(manager.step(created.session, created.epoch, rid(1), 6)).code).toBe('E_ID_PAYLOAD_MISMATCH');
  });
});

describe('C3c fix — cross-step execution (shared duration rule)', () => {
  function fire120(manager: HeadlessWorldManager, created: any, drone: any, base: number) {
    const action = body(manager.action(created.session, created.epoch, rid(base), [
      { type: 'fire', actionId: aid(base), target: { x: drone.x, y: drone.y }, ticks: 120 }
    ], 600));
    expect(action.ok).toBe(true);
    return aid(base) as string;
  }

  it('step10 keeps the action executing (10/110) and does NOT ACK applied', () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    const drone = body(manager.observe(created.session)).observation.drones[0];
    const actionId = fire120(manager, created, drone, 101);
    const first = body(manager.step(created.session, created.epoch, rid(102), 10));
    expect(first.ok).toBe(true);
    expect(first.applied).toEqual([]);
    expect(first.rejected).toEqual([]);
    expect(first.executing.actionId).toBe(actionId);
    expect(first.executing.executedTicks).toBe(10);
    expect(first.executing.remainingTicks).toBe(110);
    expect(first.executing.durationTicks).toBe(120);
  });

  it('step10 + step110 equals one step120 canonically and in events', () => {
    const split = dev();
    const created = body(split.createSession(424242));
    const drone = body(split.observe(created.session)).observation.drones[0];
    fire120(split, created, drone, 201);
    body(split.step(created.session, created.epoch, rid(202), 10));
    const second = body(split.step(created.session, created.epoch, rid(203), 110));

    const single = dev();
    const created2 = body(single.createSession(424242));
    const drone2 = body(single.observe(created2.session)).observation.drones[0];
    fire120(single, created2, drone2, 211);
    const one = body(single.step(created2.session, created2.epoch, rid(212), 120));

    expect(second.applied[0].executedTicks).toBe(120);
    expect(second.applied[0].appliedTick).toBe(120);
    expect(second.executing).toBeNull();
    expect(one.applied[0].executedTicks).toBe(120);
    expect(second.toTick).toBe(one.toTick);
    expect(second.stateFingerprint).toBe(one.stateFingerprint);
    expect(second.eventsFingerprint).toBe(one.eventsFingerprint);
    expect(second.status).toBe(one.status);
  });

  it('a queued stop preempts the ACTIVE action mid-flight', () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    const drone = body(manager.observe(created.session)).observation.drones[0];
    const fireId = fire120(manager, created, drone, 301);
    body(manager.step(created.session, created.epoch, rid(302), 20));
    body(manager.action(created.session, created.epoch, rid(303), [
      { type: 'stop', actionId: aid(303) }
    ], 600));
    const stopped = body(manager.step(created.session, created.epoch, rid(304), 10));
    expect(stopped.rejected[0].actionId).toBe(fireId);
    expect(stopped.rejected[0].code).toBe('E_PREEMPTED');
    expect(stopped.rejected[0].executedTicks).toBe(20);
    expect(stopped.applied[0].actionId).toBe(aid(303));
    expect(stopped.applied[0].executedTicks).toBe(1);
    expect(stopped.executing).toBeNull();
  });
});

describe('C3c fix — bounded request ledger', () => {
  it('an evicted response cannot re-advance an old requestId', () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    const first = body(manager.step(created.session, created.epoch, rid(400), 1));
    let lastTick = first.toTick;
    for (let i = 1; i <= 130; i += 1) {
      const r = body(manager.step(created.session, created.epoch, rid(1000 + i), 1));
      expect(r.ok).toBe(true);
      lastTick = r.toTick;
    }
    const replay = body(manager.step(created.session, created.epoch, rid(400), 1));
    expect(replay.ok).toBe(false);
    expect(replay.code).toBe('E_RETRY_AFTER_EVICTION');
    // The world did NOT advance on the rejected replay.
    const after = body(manager.step(created.session, created.epoch, rid(5000), 1));
    expect(after.toTick).toBe(lastTick + 1);
  });

  it('the dedup set has a hard cap: new requests are rejected atomically when full', () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    let rejectedAt = -1;
    let tickBeforeReject = 0;
    for (let i = 0; i < 300; i += 1) {
      const r = body(manager.step(created.session, created.epoch, rid(2000 + i), 1));
      if (!r.ok) { rejectedAt = i; tickBeforeReject = body(manager.observe(created.session)).tick; break; }
    }
    expect(rejectedAt).toBeGreaterThan(0);
    // It is a quota rejection, not a silent advance.
    const after = body(manager.step(created.session, created.epoch, rid(9000), 1));
    expect(after.ok).toBe(false);
    expect(after.code).toBe('E_RESOURCE_LIMIT');
    expect(body(manager.observe(created.session)).tick).toBe(tickBeforeReject);
  });

  it('step and action share one requestId namespace', () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    const drone = body(manager.observe(created.session)).observation.drones[0];
    body(manager.action(created.session, created.epoch, rid(600), [
      { type: 'fire', actionId: aid(600), target: { x: drone.x, y: drone.y }, ticks: 5 }
    ], 600));
    const cross = body(manager.step(created.session, created.epoch, rid(600), 1));
    expect(cross.ok).toBe(false);
    expect(cross.code).toBe('E_ID_PAYLOAD_MISMATCH');
  });
});

describe('C3c fix — public events are perception-cropped', () => {
  it('a Player step never returns drone-step / room-generated / hidden positions', () => {
    const manager = player();
    const created = body(manager.createSession());
    const drone = body(manager.observe(created.session)).observation.drones[0];
    body(manager.action(created.session, created.epoch, rid(700), [
      { type: 'fire', actionId: aid(700), target: { x: drone.x, y: drone.y }, ticks: 30 }
    ], 600));
    const step = body(manager.step(created.session, created.epoch, rid(701), 30));
    const types = (step.events as Array<{ type: string }>).map((e) => e.type);
    expect(types).not.toContain('drone-step');
    expect(types).not.toContain('room-generated');
    expect(types).not.toContain('player-reset');
    // No hidden map/seed/rng on any event projection.
    expectNoOwnerKeys(step.events);
    expectNoOwnerKeys(step);
  });
});

describe('C3c fix — Player intent audit', () => {
  const legal = { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false };

  it('accepts exactly the legal intent shape (and normalizes over-speed)', () => {
    expect(parsePlayerIntent(legal)).toEqual(legal);
    const fast = parsePlayerIntent({ ...legal, move: { x: 1000, y: 0 } });
    expect(fast).not.toBeNull();
    expect(Math.hypot(fast!.move.x, fast!.move.y)).toBeCloseTo(1, 6);
  });

  it('rejects unknown keys, HP writes, seed, and nested extras', () => {
    expect(parsePlayerIntent({ ...legal, hp: 9999 })).toBeNull();
    expect(parsePlayerIntent({ ...legal, seed: 1 })).toBeNull();
    expect(parsePlayerIntent({ ...legal, extra: true })).toBeNull();
    expect(parsePlayerIntent({ ...legal, move: { x: 1, y: 0, z: 1 } })).toBeNull();
    expect(parsePlayerIntent({ ...legal, aim: { x: 1, y: 2, z: 3 } })).toBeNull();
    expect(parsePlayerIntent({ move: { x: 1, y: 0 }, dash: false, fire: false, interact: false })).toBeNull();
    expect(parsePlayerIntent({ ...legal, move: { x: 1e9, y: 0 } })).toBeNull();
    expect(parsePlayerIntent({ ...legal, move: { x: Number.NaN, y: 0 } })).toBeNull();
  });

  it('a manager step rejects a bad intent without leaking owner data', () => {
    const manager = player();
    const created = body(manager.createSession());
    const bad = body(manager.step(created.session, created.epoch, rid(1), 1, { ...legal, hp: 9999 }));
    expect(bad.ok).toBe(false);
    expectNoOwnerKeys(bad);
  });
});
