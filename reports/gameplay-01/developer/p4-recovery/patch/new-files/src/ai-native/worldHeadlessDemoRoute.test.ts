// GAMEPLAY-01 P4 — formal Headless demo/route/clear/recovery rules.
//
// Real inputs only: `runSteps` intents (move/aim/fire/interact) and core signal
// commands. Nothing here teleports, heals, clears enemies directly or writes
// `room.cleared`; the room is cleared by actual fire and the map flag is
// committed by the CORE (M1), then read by the presenter/Headless (one state).
import { describe, expect, it } from 'vitest';
import {
  HeadlessWorld, NEUTRAL_INTENT, generateRealMap, type HeadlessRunStep
} from './worldHeadless';
import type { SimulationIntent } from '../world/sim/core';
import { SIM_TUNING } from '../world/sim/core';
import { SIGNAL_TUNING } from '../signal/signalTuning';
import { buildP1Scenario } from '../config/p1Scenario';
import { createSimulationState, isWalkableFromState } from '../world/sim/core';
import { basePlayerData } from '../config/game';
import type { MapData } from '../types';

const SEED = 20261117;

/** Full PlayerData for a bare simulation state (same shape the Headless builds). */
function playerData() {
  return {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as Parameters<typeof createSimulationState>[0]['playerData'];
}

/** The authored cells a FRESH builder produces for the same map/seed. */
function authoredFor(map: MapData) {
  const sim = createSimulationState({ seed: map.seed, map, playerData: playerData(), playerX: 0, playerY: 0 });
  return buildP1Scenario({ map, isWalkable: (x, y, r) => isWalkableFromState(sim, x, y, r) });
}

function moveToward(from: { x: number; y: number }, to: { x: number; y: number }): SimulationIntent {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { move: { x: dx / len, y: dy / len }, dash: false, fire: false, aim: null, interact: false };
}

function fireAt(target: { x: number; y: number }): SimulationIntent {
  return { move: { x: 0, y: 0 }, dash: false, fire: true, aim: { x: target.x, y: target.y }, interact: false };
}

/** Play the authored fight with real intents until the room is cleared. */
function clearAuthoredRoom(world: HeadlessWorld, roomId: number, cap = 1200): void {
  for (let i = 0; i < cap; i += 1) {
    const live = world.state.drones.filter((d) => d.hp > 0 && d.data.spawnRoom === roomId);
    if (live.length === 0) return;
    const me = world.state.player;
    const target = live.reduce((best, d) =>
      Math.hypot(d.x - me.x, d.y - me.y) < Math.hypot(best.x - me.x, best.y - me.y) ? d : best, live[0]);
    const dist = Math.hypot(target.x - me.x, target.y - me.y);
    world.runSteps([{ ticks: 1, intent: dist > 5.5 ? moveToward(me, target) : fireAt(target) }]);
  }
  throw new Error('authored room was not cleared by real intents');
}

function walkTo(world: HeadlessWorld, to: { x: number; y: number }, cap = 600): void {
  for (let i = 0; i < cap; i += 1) {
    const me = world.state.player;
    if (Math.hypot(to.x - me.x, to.y - me.y) <= 0.4) return;
    world.runSteps([{ ticks: 1, intent: moveToward(me, to) }]);
  }
  throw new Error('could not walk to the authored portal');
}

describe('P4 Headless demo — same authored scene as the World', () => {
  it('consumes the shared builder (same cells as a fresh authored build)', () => {
    const world = new HeadlessWorld({ seed: SEED, demo: true });
    const map = generateRealMap(SEED);
    const expected = authoredFor(map);
    expect(expected).not.toBeNull();
    const authored = world.demoScenario;
    expect(authored).not.toBeNull();
    expect(authored!.roomId).toBe(expected!.roomId);
    expect(authored!.startRoomId).toBe(expected!.startRoomId);
    // Portals are cell CENTRES and come from the shared builder (M7).
    expect(authored!.routes.map((r) => r.portal)).toEqual(expected!.routes.map((r) => r.portal));
    // The authored sentries spawn on the authored cells.
    expect(world.state.drones.map((d) => ({ x: d.x, y: d.y })))
      .toEqual(expected!.drones.map((d) => ({ x: d.x, y: d.y })));
    // M5: the start room id survives the authored kind mutation.
    expect(world.identity.startRoomId).toBe(expected!.startRoomId);
    expect(world.identity.startRoomId).not.toBeNull();
  });

  it('starts uncleared with the ACTIVE route and no portal', () => {
    const world = new HeadlessWorld({ seed: SEED, demo: true });
    world.runSteps([{ ticks: 2, intent: NEUTRAL_INTENT }]);
    const route = world.routeState!;
    expect(route.relay).toBe('ACTIVE');
    expect(route.roomCleared).toBe(false);
    expect(route.portal).toBeNull();
    expect(route.completed).toBe(false);
    expect(route.target).toBe(world.demoScenario!.routes[0].target);
  });

  it('M1: the core clears the room exactly once and the presenter reads the same flag', () => {
    const world = new HeadlessWorld({ seed: SEED, demo: true });
    const roomId = world.demoScenario!.roomId;
    clearAuthoredRoom(world, roomId);
    world.runSteps([{ ticks: 2, intent: NEUTRAL_INTENT }]);
    // The authoritative flag the rendered gate, core `descend` and GameScene use.
    expect(world.state.map.rooms[roomId].cleared).toBe(true);
    expect(world.routeState!.roomCleared).toBe(true);
    const events = world.eventsSlice(0, world.eventTotal).filter((e) => e.type === 'room-cleared');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ roomId });
    // No divergence between the two readers at any single tick was possible:
    // routeState is derived from `map.rooms[id].cleared` only.
    expect(world.routeState!.portal).toEqual(world.demoScenario!.routes[0].portal);
  });

  it('completes a legal route by walking onto the authored portal and pressing F', () => {
    const world = new HeadlessWorld({ seed: SEED, demo: true });
    const roomId = world.demoScenario!.roomId;
    clearAuthoredRoom(world, roomId);
    const portal = world.routeState!.portal!;
    walkTo(world, portal);
    expect(world.routeState!.playerAtPortal).toBe(true);
    world.runSteps([{ ticks: 1, intent: { ...NEUTRAL_INTENT, interact: true } }]);
    expect(world.routeState!.completed).toBe(true);
  });

  it('JAMMED closes the route while the room stays cleared (safety gate intact)', () => {
    const world = new HeadlessWorld({ seed: SEED, demo: true });
    const roomId = world.demoScenario!.roomId;
    clearAuthoredRoom(world, roomId);
    const portal = world.routeState!.portal!;
    walkTo(world, portal);
    world.enqueueSignalCommand({ type: 'signal-jam', actor: 'player' });
    world.runSteps([{ ticks: 1, intent: NEUTRAL_INTENT }]);
    const jammed = world.routeState!;
    expect(jammed.relay).toBe('JAMMED');
    expect(jammed.target).toBeNull();
    expect(jammed.portal).toBeNull();
    expect(jammed.completed).toBe(false);
    expect(world.state.map.rooms[roomId].cleared).toBe(true);
    // Jam expiry RESTORES the route from the same committed relay state.
    world.runSteps([{ ticks: SIGNAL_TUNING.JAM_DURATION_TICKS + 4, intent: NEUTRAL_INTENT }]);
    const restored = world.routeState!;
    expect(restored.relay).toBe('ACTIVE');
    expect(restored.target).toBe(world.demoScenario!.routes[0].target);
    expect(restored.portal).toEqual(world.demoScenario!.routes[0].portal);
  });

  it('manual OFF also yields exactly one route (no JAMMED-style blackout)', () => {
    const world = new HeadlessWorld({ seed: SEED, demo: true });
    const roomId = world.demoScenario!.roomId;
    clearAuthoredRoom(world, roomId);
    world.enqueueSignalCommand({ type: 'toggle-relay', enabled: false });
    world.runSteps([{ ticks: 2, intent: NEUTRAL_INTENT }]);
    const route = world.routeState!;
    expect(route.relay).toBe('INACTIVE');
    expect(route.target).toBe(world.demoScenario!.routes[1].target);
    expect(route.portal).toEqual(world.demoScenario!.routes[1].portal);
  });
});

describe('P4 Headless demo — route identity survives snapshot/restore/replay (M2)', () => {
  function playedWorld(): HeadlessWorld {
    const world = new HeadlessWorld({ seed: SEED, demo: true });
    clearAuthoredRoom(world, world.demoScenario!.roomId);
    return world;
  }

  it('snapshot → restore keeps demo + route + cleared state', () => {
    const world = playedWorld();
    const frame = world.snapshot();
    expect(frame.sim.authored).toBeTruthy();
    const restored = new HeadlessWorld({ seed: SEED, demo: true });
    const result = restored.restore(frame);
    expect(result.ok).toBe(true);
    expect(restored.routeState).toEqual(world.routeState);
    expect(restored.routeState!.roomCleared).toBe(true);
    expect(restored.identity.startRoomId).toBe(world.identity.startRoomId);
  });

  it('fromFrame and fromSimulationState keep the SAME demo identity', () => {
    const world = playedWorld();
    const frame = world.snapshot();
    const fromFrame = HeadlessWorld.fromFrame(frame, false);
    expect(fromFrame.routeState).toEqual(world.routeState);
    expect(fromFrame.identity.startRoomId).toBe(world.identity.startRoomId);

    const fromState = HeadlessWorld.fromSimulationState(world.state, [world.demoScenario!.roomId]);
    expect(fromState.routeState).toEqual(world.routeState);
    expect(fromState.identity.startRoomId).toBe(world.identity.startRoomId);
  });

  it('replay reproduces the same route state after the same inputs', () => {
    const world = new HeadlessWorld({ seed: SEED, demo: true });
    const start = world.snapshot();
    const portal = world.demoScenario!.routes[0].portal!;
    const steps: HeadlessRunStep[] = [];
    const roomId = world.demoScenario!.roomId;
    for (let i = 0; i < 240; i += 1) {
      const live = world.state.drones.filter((d) => d.hp > 0 && d.data.spawnRoom === roomId);
      const me = world.state.player;
      if (live.length > 0) {
        const target = live[0];
        const dist = Math.hypot(target.x - me.x, target.y - me.y);
        steps.push({ ticks: 1, intent: dist > 5.5 ? moveToward(me, target) : fireAt(target) });
      } else {
        steps.push({ ticks: 1, intent: moveToward(me, portal) });
      }
      world.runSteps([steps[steps.length - 1]]);
    }
    const replay = world.replay(start, steps);
    expect(replay.ok).toBe(true);
    expect(replay.sameState).toBe(true);
    expect(replay.sameEvents).toBe(true);
    expect(world.routeState!.roomCleared).toBe(true);
    expect(world.routeState!.portal).toEqual(portal);
  });

  it('an ordinary (non-demo) world still has no authored identity', () => {
    const world = new HeadlessWorld({ seed: SEED });
    expect(world.demoScenario).toBeNull();
    expect(world.routeState).toBeNull();
    expect(world.state.authored).toBeUndefined();
    expect(world.snapshot().sim.authored).toBeUndefined();
    void SIM_TUNING;
  });
});
