// C3c canonical stability: canonical state/events must be independent of object
// key insertion order (e.g. after a JSON transport), preserve exact numbers, and
// keep array order. A value tamper must be detectable.

import { describe, expect, it } from 'vitest';
import { basePlayerData } from '../config/game';
import { assignRoles, guaranteeReachable, MapGenerator } from '../world/MapGenerator';
import {
  canonicalSimulationEvents, canonicalSimulationState, createSimulationState,
  registerDrone, stepSimulationTicks, type SimulationIntent, type SimulationState
} from '../world/sim/core';
import { buildEnemyData } from '../config/enemies';
import { canonicalJson } from './protocol';
import { HeadlessWorld } from './worldHeadless';

function neutral(): SimulationIntent {
  return { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
}

function realState(): SimulationState {
  const seed = 424242;
  const gen = new MapGenerator(seed);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const base = basePlayerData();
  const data = {
    ...base, level: 1, xp: 0, xpToNext: 30, currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as any;
  const state = createSimulationState({ seed, map, playerData: data, playerX: 8.5, playerY: 45.5 });
  return state;
}

/** Rebuild every object with recursively sorted keys (a transport that sorts). */
function sortKeys<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

describe('C3c canonical — key order independence', () => {
  it('a key-sorted rebuild of the same state has the same canonical string', () => {
    const state = realState();
    stepSimulationTicks(state, 10, neutral());
    const live = canonicalSimulationState(state);
    const sorted = canonicalSimulationState(sortKeys(state));
    expect(sorted).toBe(live);
  });

  it('player data constructed in a different key order still hashes identically', () => {
    const a = realState();
    const b = realState();
    // Rebuild b.player.data with reversed insertion order (same values).
    const entries = Object.entries(b.player.data as unknown as Record<string, unknown>).reverse();
    (b as any).player.data = Object.fromEntries(entries);
    expect(canonicalSimulationState(b)).toBe(canonicalSimulationState(a));
  });
});

describe('C3c canonical — precision and array order', () => {
  it('preserves full numeric precision (a tiny change is NOT rounded away)', () => {
    const a = realState();
    const b = realState();
    stepSimulationTicks(a, 5, neutral());
    stepSimulationTicks(b, 5, neutral());
    const before = canonicalSimulationState(a);
    const pos = b.player.x;
    b.player.x = pos + 1e-9;
    expect(canonicalSimulationState(b)).not.toBe(before);
  });

  it('does not reorder arrays (array order is part of the projection)', () => {
    const state = realState();
    // Give the projection two drones so reversal is observable.
    const map = state.map;
    const room = map.rooms.find((r) => r.kind === 'combat') ?? map.rooms[0];
    const data = buildEnemyData('drone', room.id, 0, { gx: room.gx, gy: room.gy, w: room.w, h: room.h });
    registerDrone(state, { id: 1, x: room.gx + 2.5, y: room.gy + 2.5, hp: data.stats.maxHp, data, attackTimer: 0, wanderTimer: 1000 });
    registerDrone(state, { id: 2, x: room.gx + 4.5, y: room.gy + 2.5, hp: data.stats.maxHp, data: { ...data }, attackTimer: 0, wanderTimer: 1000 });
    const before = canonicalSimulationState(state);
    const reversed = { ...state, drones: [...state.drones].reverse() } as SimulationState;
    expect(canonicalSimulationState(reversed)).not.toBe(before);
  });
});

describe('C3c canonical — transport → restore round trip', () => {
  it('a boundary frame sorted on the wire restores to the same state/events for the same actions', () => {
    const world = new HeadlessWorld({ seed: 424242 });
    const obs = world.observation();
    const drone = obs.drones.find((d) => d.hp > 0)!;
    world.runSteps([{ ticks: 10, intent: { ...neutral(), fire: true, aim: { x: drone.x, y: drone.y } } }], 200);
    world.runSteps([{ ticks: 5, intent: neutral() }], 200);
    const frame = world.snapshot();
    const continuation = [{ ticks: 15, intent: { ...neutral(), move: { x: 1, y: 0 } } }];

    // The live continuation.
    world.runSteps(continuation, 200);
    const liveState = world.canonicalState();
    const liveEvents = world.canonicalEvents();

    // The wire frame (sorted keys), restored in a NEW world, then the same action.
    const wire = sortKeys(frame);
    const restored = new HeadlessWorld({ seed: 1 });
    expect(restored.restore(wire).ok).toBe(true);
    restored.runSteps(continuation, 200);
    expect(restored.canonicalState()).toBe(liveState);
    expect(restored.canonicalEvents()).toBe(liveEvents);
    const replay = restored.replay(wire, continuation);
    expect(replay.sameState).toBe(true);
    expect(replay.sameEvents).toBe(true);
  });

  it('a numeric tamper in the frame is detected (no rounded/ignored diff)', () => {
    const world = new HeadlessWorld({ seed: 424242 });
    const obs = world.observation();
    const drone = obs.drones.find((d) => d.hp > 0)!;
    world.runSteps([{ ticks: 10, intent: { ...neutral(), fire: true, aim: { x: drone.x, y: drone.y } } }], 200);
    const frame = world.snapshot();
    const tampered = sortKeys(frame);
    (tampered as any).sim.player.x += 1e-9;
    const replay = world.replay(tampered, [{ ticks: 5, intent: neutral() }]);
    expect(replay.sameState).toBe(false);
  });
});
