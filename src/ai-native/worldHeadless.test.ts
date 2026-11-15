// AI-NATIVE-02 C3-c — headless same-core runtime tests.
// No Phaser / DOM / window / browser. Real MapGenerator + real sim/core +
// real config: a genuine combat room with a real drone and the real pulse.

import { describe, expect, it } from 'vitest';
import { canonicalSimulationEvents, canonicalSimulationState, tileAtFromState } from '../world/sim/core';
import {
  generateRealMap, HeadlessWorld, intentFromWorldAction, isHeadlessFrame,
  neutralIntent, type HeadlessRunStep
} from './worldHeadless';

function combatSteps(shots = 10): HeadlessRunStep[] {
  const w = new HeadlessWorld({ seed: 424242 });
  const first = w.observation();
  const aim = { x: first.drones[0]?.x ?? 0, y: first.drones[0]?.y ?? 0 };
  const steps: HeadlessRunStep[] = [];
  for (let i = 0; i < shots; i += 1) {
    steps.push({ ticks: 1, intent: { ...neutralIntent(), fire: true, aim } });
    steps.push({ ticks: 12, intent: neutralIntent() });
  }
  return steps;
}

describe('C3-c headless same-core runtime', () => {
  it('uses the REAL generated map, a REAL combat room, a REAL drone and the REAL pulse weapon', () => {
    const w = new HeadlessWorld({ seed: 424242 });
    const map = generateRealMap(424242);
    const identity = w.identity;
    expect(identity.seed).toBe(424242);
    expect(identity.roomCount).toBe(map.rooms.length);
    expect(identity.combatRoomId).not.toBeNull();
    expect(map.rooms.find((r) => r.id === identity.combatRoomId)?.kind).toBe('combat');
    const obs = w.observation();
    expect(obs.schema).toBe('last_signal.world.v1');
    expect(obs.tick).toBe(0);
    expect(obs.player.weaponKey).toBe('pulse');
    expect(obs.player.hp).toBe(100);
    expect(obs.drones.length).toBe(1);
    expect(obs.drones[0].kind).toBe('drone');
    expect(obs.availableActions).toEqual(['move', 'stop', 'aim', 'fire', 'interact']);
  });

  it('observation is perception-cropped: no seed / RNG / full map / hidden goal', () => {
    const w = new HeadlessWorld({ seed: 777 });
    const serialized = JSON.stringify(w.observation()).toLowerCase();
    // Exact field names matter: "projectiles" is a legal observation field and
    // must not be mistaken for a full-map "tiles" leak.
    for (const forbidden of ['"seed":', '"rngstate":', '"fullmap":', '"hiddengoal":', '"tiles":', '"rooms":', '"pendingcommands":', '"purchasetransactions":', '"map":']) {
      expect(serialized).not.toContain(forbidden);
    }
    // A far, unexplored target is NOT perceivable, even though it exists in core.
    const far = w.observation();
    expect(far.drones.every((d) => Math.hypot(d.x - far.player.x, d.y - far.player.y) <= 12)).toBe(true);
  });

  it('real combat: fire -> projectile -> hit -> enemy-died -> cleared; real damage taken', () => {
    const w = new HeadlessWorld({ seed: 424242 });
    const events = w.runSteps(combatSteps(10));
    const types = new Set(events.map((e) => e.type));
    expect(types.has('player-fired')).toBe(true);
    expect(types.has('projectile-spawned')).toBe(true);
    expect(types.has('enemy-hit')).toBe(true);
    expect(types.has('drone-step')).toBe(true);
    expect(types.has('enemy-died')).toBe(true);
    expect(types.has('player-hurt')).toBe(true);
    const inspect = w.inspect();
    expect(inspect.kills).toBe(1);
    expect(inspect.shots).toBe(10);
    expect(inspect.damageTaken).toBeGreaterThan(0);
    expect(inspect.status).toBe('cleared');
  });

  it('real death: the core emits player-death and the session reports dead', () => {
    const w = new HeadlessWorld({ seed: 424242 });
    w.runSteps([{ ticks: 1000, intent: neutralIntent() }], 1000);
    const second = w.runSteps([{ ticks: 600, intent: neutralIntent() }], 1000);
    expect(second.some((e) => e.type === 'player-death')).toBe(true);
    expect(w.inspect().status).toBe('dead');
    expect((w.inspect().player as { hp: number }).hp).toBe(0);
  });

  it('collision is the real core: sustained movement never enters a wall cell', () => {
    const w = new HeadlessWorld({ seed: 99 });
    w.runSteps([{ ticks: 120, intent: { ...neutralIntent(), move: { x: 1, y: 1 } } }], 1000);
    const state = w.state;
    // tileAtFromState is the same core helper the rendered World uses.
    expect(tileAtFromState(state, Math.floor(state.player.x), Math.floor(state.player.y)).type).not.toBe('wall');
  });

  it('two worlds with the same seed + same intents produce identical canonical state/events', () => {
    const steps = combatSteps(6);
    const a = new HeadlessWorld({ seed: 424242 });
    const b = new HeadlessWorld({ seed: 424242 });
    const ea = a.runSteps(steps);
    const eb = b.runSteps(steps);
    expect(canonicalSimulationState(a.state)).toBe(canonicalSimulationState(b.state));
    expect(canonicalSimulationEvents(ea)).toBe(canonicalSimulationEvents(eb));
  });

  it('an owner snapshot carries state, commands, RNG, ledger and map identity', () => {
    const w = new HeadlessWorld({ seed: 424242 });
    w.runSteps(combatSteps(2));
    const frame = w.snapshot();
    expect(isHeadlessFrame(frame)).toBe(true);
    expect(frame.schema).toBe('last_signal.world-headless.frame.v1');
    expect(frame.sim).toHaveProperty('pendingCommands');
    expect(frame.sim).toHaveProperty('purchaseTransactions');
    expect(frame.sim).toHaveProperty('rngState');
    expect(frame.sim).toHaveProperty('map');
    expect(frame.mapIdentity.mapHash).toMatch(/^fnv1a32:/);
    expect(frame.events.length).toBeGreaterThan(0);
    expect(frame.actionLog).toEqual([]);
  });

  it('restore bumps the epoch and replay reproduces the real canonical state/events', () => {
    const w = new HeadlessWorld({ seed: 424242 });
    const start = w.snapshot();
    const steps = combatSteps(6);
    w.runSteps(steps);
    const replay = w.replay(start, steps);
    expect(replay.ok).toBe(true);
    expect(replay.sameState).toBe(true);
    expect(replay.sameEvents).toBe(true);
    expect(replay.firstDivergence).toBeNull();
    const other = new HeadlessWorld({ seed: 1 });
    const restored = other.restore(start);
    expect(restored.ok).toBe(true);
    expect(other.currentEpoch).toBeGreaterThan(1);
  });

  it('restore rejects a malformed frame without mutating the session', () => {
    const w = new HeadlessWorld({ seed: 424242 });
    const before = w.inspect().canonicalStateHash;
    const rejected = w.restore({ schema: 'bogus', version: 1, sim: {} });
    expect(rejected.ok).toBe(false);
    expect(w.inspect().canonicalStateHash).toBe(before);
  });

  it('Dev room loading spawns REAL enemies from real enemy config', () => {
    const w = new HeadlessWorld({ seed: 424242 });
    const result = w.loadRoom(Number(w.identity.combatRoomId), ['drone', 'stalker']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spawned).toBe(2);
    const state = w.state;
    expect(state.drones.map((d) => d.data.kind)).toEqual(['drone', 'stalker']);
    expect(state.drones.every((d) => d.hp > 0 && d.data.stats.maxHp > 0)).toBe(true);
    expect(w.currentEpoch).toBeGreaterThan(1);
    expect(w.loadRoom(9999, ['drone']).ok).toBe(false);
  });

  it('a Dev failure export never contains credentials or a Phaser object', () => {
    const w = new HeadlessWorld({ seed: 424242 });
    w.runSteps(combatSteps(2));
    const bundle = w.exportFailure('unit-test');
    const serialized = JSON.stringify(bundle);
    expect(serialized).toContain('last_signal.world-headless.failure.v1');
    expect(serialized).toContain('frame');
    expect(serialized.toLowerCase()).not.toContain('token');
    expect(serialized.toLowerCase()).not.toContain('bearer');
    expect(() => JSON.parse(serialized)).not.toThrow();
  });

  it('WorldActionV1 converts only to legal core intents', () => {
    const move = intentFromWorldAction({ type: 'move', dir: { x: 3, y: 4 }, ticks: 5 });
    expect(move.ticks).toBe(5);
    expect(move.intent.move).toEqual({ x: 0.6, y: 0.8 });
    expect(move.intent.fire).toBe(false);
    const fire = intentFromWorldAction({ type: 'fire', target: { x: 1, y: 2 }, ticks: 3 });
    expect(fire.intent.fire).toBe(true);
    expect(fire.intent.aim).toEqual({ x: 1, y: 2 });
    expect(intentFromWorldAction({ type: 'stop' }).intent).toEqual(neutralIntent());
    expect(intentFromWorldAction({ type: 'interact' }).intent.interact).toBe(true);
    // No HP / seed / position override is expressible.
    expect(Object.keys(move.intent).sort()).toEqual(['aim', 'dash', 'fire', 'interact', 'move']);
  });
});
