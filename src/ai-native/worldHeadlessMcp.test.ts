// C3-c — headless MCP manager: Player/Dev isolation, epoch, idempotency,
// real damage/death and close. No stdio transport; the SAME manager the
// official server registers.

import { describe, expect, it } from 'vitest';
import { HeadlessWorldManager } from './worldHeadlessMcpTools';

const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;

function body(result: any): any {
  return result.structuredContent ?? { ok: false, code: 'E_SCHEMA' };
}

function devManager(): HeadlessWorldManager {
  let seed = 424242;
  return new HeadlessWorldManager(true, () => (seed += 1));
}

function playerManager(): HeadlessWorldManager {
  let seed = 1234;
  return new HeadlessWorldManager(false, () => (seed += 1));
}

describe('C3-c headless MCP manager — Player surface', () => {
  it('creates a session without a seed; a seed is rejected for Player', () => {
    const manager = playerManager();
    const created = body(manager.createSession());
    expect(created.ok).toBe(true);
    expect(created.seed).toBeUndefined();
    const withSeed = body(manager.createSession(11));
    expect(withSeed.ok).toBe(false);
    expect(withSeed.code).toBe('E_PERMISSION');
  });

  it('observation is perception-cropped and never carries hidden state', () => {
    const manager = playerManager();
    const created = body(manager.createSession());
    const observed = body(manager.observe(created.session));
    expect(observed.ok).toBe(true);
    const serialized = JSON.stringify(observed.observation).toLowerCase();
    for (const hidden of ['"seed":', '"rngstate":', '"map":', '"tiles":', '"pendingcommands":', '"purchasetransactions":']) {
      expect(serialized).not.toContain(hidden);
    }
    expect(observed.observation.drones[0].kind).toBe('drone');
  });

  it('real fire damage + encounter end through legal core ticks', () => {
    const manager = playerManager();
    const created = body(manager.createSession());
    const drone = body(manager.observe(created.session)).observation.drones[0];
    const queued = body(manager.action(created.session, created.epoch, rid(1), [
      { type: 'fire', actionId: aid(1), target: { x: drone.x, y: drone.y }, ticks: 60 }
    ], 600));
    expect(queued.ok).toBe(true);
    expect(queued.actions[0].status).toBe('queued');
    const stepped = body(manager.step(created.session, created.epoch, rid(2), 60));
    expect(stepped.ok).toBe(true);
    expect(stepped.ticks).toBe(60);
    expect(stepped.applied[0].executedTicks).toBe(60);
    expect(stepped.status).toBe('cleared');
    expect(stepped.eventCount).toBeGreaterThan(0);
  });

  it('step request is idempotent; a different payload is rejected', () => {
    const manager = playerManager();
    const created = body(manager.createSession());
    const first = body(manager.step(created.session, created.epoch, rid(1), 10));
    const replay = body(manager.step(created.session, created.epoch, rid(1), 10));
    expect(replay.replayed).toBe(true);
    expect(replay.toTick).toBe(first.toTick);
    const mismatch = body(manager.step(created.session, created.epoch, rid(1), 5));
    expect(mismatch.ok).toBe(false);
    expect(mismatch.code).toBe('E_ID_PAYLOAD_MISMATCH');
  });

  it('a stale epoch is rejected', () => {
    const manager = playerManager();
    const created = body(manager.createSession());
    const stale = body(manager.step(created.session, created.epoch - 1, rid(1), 5));
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe('E_STALE_EPOCH');
  });

  it('Player cannot use any Dev tool', () => {
    const manager = playerManager();
    const created = body(manager.createSession());
    expect(body(manager.inspect(created.session)).code).toBe('E_PERMISSION');
    expect(body(manager.snapshot(created.session)).code).toBe('E_PERMISSION');
    expect(body(manager.loadRoom(created.session, 0, ['drone'])).code).toBe('E_PERMISSION');
    expect(body(manager.batch([1], 10, 'seek-and-fire')).code).toBe('E_PERMISSION');
    expect(body(manager.perf(1000, 1)).code).toBe('E_PERMISSION');
  });

  it('close releases the session; old epoch / closed session is not observable', () => {
    const manager = playerManager();
    const created = body(manager.createSession());
    expect(body(manager.close(created.session)).ok).toBe(true);
    expect(body(manager.observe(created.session)).ok).toBe(false);
    expect(body(manager.step(created.session, created.epoch, rid(1), 5)).ok).toBe(false);
  });
});

describe('C3-c headless MCP manager — Dev surface', () => {
  it('Dev can create with an explicit seed and inspect RNG/ledger/map identity', () => {
    const manager = devManager();
    const created = body(manager.createSession(424242));
    expect(created.ok).toBe(true);
    expect(created.seed).toBe(424242);
    const inspect = body(manager.inspect(created.session)).inspect;
    expect(typeof inspect.rngState).toBe('number');
    expect(inspect.purchaseLedger).toBe(0);
    expect(String(inspect.mapHash)).toMatch(/^fnv1a32:/);
  });

  it('Dev load_room / spawn_enemies use REAL enemies and bump the epoch', () => {
    const manager = devManager();
    const created = body(manager.createSession(424242));
    const inspect = body(manager.inspect(created.session)).inspect;
    const loaded = body(manager.loadRoom(created.session, inspect.roomId, ['drone']));
    expect(loaded.ok).toBe(true);
    expect(loaded.spawned).toBe(1);
    expect(loaded.epoch).toBeGreaterThan(created.epoch);
    const spawned = body(manager.spawnEnemies(created.session, ['stalker', 'drone']));
    expect(spawned.ok).toBe(true);
    expect(spawned.spawned).toBe(2);
    const inspected = body(manager.inspect(created.session)).inspect;
    expect(inspected.liveDrones).toBe(3);
  });

  it('Dev snapshot/restore bumps the epoch and rejects the old one', () => {
    const manager = devManager();
    const created = body(manager.createSession(424242));
    const snapshot = body(manager.snapshot(created.session));
    expect(snapshot.frame.schema).toBe('last_signal.world-headless.frame.v1');
    expect(snapshot.frame.sim.rngState).toBeDefined();
    const expectedTick = snapshot.frame.sim.tick;
    body(manager.step(created.session, created.epoch, rid(1), 20));
    const restored = body(manager.restore(created.session, snapshot.frame));
    expect(restored.ok).toBe(true);
    expect(restored.epoch).toBeGreaterThan(created.epoch);
    expect(restored.observation.tick).toBe(expectedTick);
    const stale = body(manager.step(created.session, created.epoch, rid(2), 5));
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe('E_STALE_EPOCH');
  });

  it('Dev batch/compare/perf produce REAL results; Signal stays unsupported', () => {
    const manager = devManager();
    const batch = body(manager.batch([424242, 777], 600, 'seek-and-fire')).result;
    expect(batch.runs).toHaveLength(2);
    expect(batch.aggregate.totalShots).toBeGreaterThan(0);
    const compare = body(manager.compare([424242], 300)).result;
    expect(compare.results).toHaveLength(2);
    const perf = body(manager.perf(1000, 2)).result;
    expect(perf.sessions).toBe(2);
    expect(perf.liveCombatTicks).toBeGreaterThan(0);
    const signal = body(manager.signalStatus());
    expect(signal.ok).toBe(false);
    expect(signal.code).toBe('E_NOT_APPLICABLE');
    // Only 1000/10000 ticks are accepted for perf.
    expect(body(manager.perf(500, 2)).code).toBe('E_SCHEMA');
  }, 120_000);
});
