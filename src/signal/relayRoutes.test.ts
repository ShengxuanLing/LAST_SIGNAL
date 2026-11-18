import { describe, expect, it } from 'vitest';
import {
  routeMatches, routeTargetFor, relayOutput, exitOpen, type RelayState, type RouteWhen
} from './relay';
import { P1_DEMO_SEED, buildP1Scenario, p1RouteFor, type P1BuildContext } from '../config/p1Scenario';
import { isWalkableFromState, createSimulationState } from '../world/sim/core';
import { basePlayerData } from '../config/game';
import type { MapData, PlayerData } from '../types';
import { generateRealMap } from '../ai-native/worldHeadless';

// GAMEPLAY-01 P1 — the authored route condition is exact:
// ACTIVE matches RELAY_ACTIVE, INACTIVE matches RELAY_INACTIVE, and JAMMED /
// DISABLED match NEITHER (temporary suppression is not a manual state).
describe('authored relay route condition', () => {
  it('ACTIVE selects only the ACTIVE route', () => {
    expect(routeMatches('ACTIVE', 'RELAY_ACTIVE')).toBe(true);
    expect(routeMatches('ACTIVE', 'RELAY_INACTIVE')).toBe(false);
  });
  it('INACTIVE selects only the INACTIVE route', () => {
    expect(routeMatches('INACTIVE', 'RELAY_ACTIVE')).toBe(false);
    expect(routeMatches('INACTIVE', 'RELAY_INACTIVE')).toBe(true);
  });
  it('JAMMED matches neither route', () => {
    expect(routeMatches('JAMMED', 'RELAY_ACTIVE')).toBe(false);
    expect(routeMatches('JAMMED', 'RELAY_INACTIVE')).toBe(false);
  });
  it('DISABLED matches neither route', () => {
    expect(routeMatches('DISABLED', 'RELAY_ACTIVE')).toBe(false);
    expect(routeMatches('DISABLED', 'RELAY_INACTIVE')).toBe(false);
  });
  it('the legacy output/exit gate is unchanged', () => {
    const states: RelayState[] = ['ACTIVE', 'INACTIVE', 'JAMMED', 'DISABLED'];
    for (const state of states) {
      expect(relayOutput(state)).toBe(state === 'ACTIVE');
      expect(exitOpen(state)).toBe(state === 'ACTIVE');
    }
  });
});

const ROUTES: Array<{ target: number; when: RouteWhen }> = [
  { target: 7, when: 'RELAY_ACTIVE' },
  { target: 9, when: 'RELAY_INACTIVE' }
];

const ALL_STATES: RelayState[] = ['ACTIVE', 'INACTIVE', 'JAMMED', 'DISABLED'];

// GAMEPLAY-01 P4 — ONE pure route rule consumed by the formal World AND the
// formal Headless. Before P4 only the Rendered presenter had a route rule.
describe('P4 shared routeTargetFor (one rule, two presenters)', () => {
  it('maps every committed relay state to exactly one authored route', () => {
    expect(routeTargetFor('ACTIVE', ROUTES)).toBe(7);
    expect(routeTargetFor('INACTIVE', ROUTES)).toBe(9);
    // JAMMED is a temporary suppression, not a third manual state.
    expect(routeTargetFor('JAMMED', ROUTES)).toBeNull();
    expect(routeTargetFor('DISABLED', ROUTES)).toBeNull();
    expect(routeTargetFor(null, ROUTES)).toBeNull();
  });

  it('keeps routeMatches and routeTargetFor on ONE predicate', () => {
    for (const relay of ALL_STATES) {
      for (const route of ROUTES) {
        const byTarget = routeTargetFor(relay, ROUTES) === route.target;
        expect(routeMatches(relay, route.when)).toBe(byTarget);
      }
    }
  });

  it('has no route when the authored table is empty', () => {
    for (const relay of ALL_STATES) expect(routeTargetFor(relay, [])).toBeNull();
  });

  it('p1RouteFor (presenter wrapper) agrees with routeTargetFor', () => {
    const built = buildAuthored(P1_DEMO_SEED);
    expect(built).not.toBeNull();
    const scenario = built!.scenario;
    for (const relay of ALL_STATES) {
      const route = p1RouteFor(relay, scenario.routes);
      expect(route?.target ?? null).toBe(routeTargetFor(relay, scenario.routes));
    }
  });

  // The three authored seeds the P4 plan names must all expose both routes, so
  // neither HumanOnly nor HumanEcho is forced onto one branch.
  for (const seed of [20261117, 20261118, 20261119]) {
    it(`authored seed ${seed} exposes two legal, distinct route cells`, () => {
      const built = buildAuthored(seed);
      expect(built).not.toBeNull();
      const { scenario, map } = built!;
      expect(scenario.routes).toHaveLength(2);
      expect(scenario.routes[0].target).not.toBe(scenario.routes[1].target);
      const a = scenario.routes[0].portal!;
      const b = scenario.routes[1].portal!;
      expect(a).toBeTruthy();
      expect(b).toBeTruthy();
      // Distinct cells: two routes on one cell would be an unreachable choice.
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(1.5);
      // The authored room is the run's start room and it became a combat room.
      expect(map.rooms[scenario.roomId].kind).toBe('combat');
      expect(scenario.startRoomId).toBe(scenario.roomId);
      expect(map.rooms.find((r) => r.kind === 'start')).toBeUndefined();
    });
  }
});

/** Full PlayerData for a simulation state (the same shape the Headless builds). */
function fullPlayerData(): PlayerData {
  return {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as PlayerData;
}

/** Independent of the presenter: build on the REAL map generator with the
 *  documented walkability contract (4 corners, wall/lava/water blocked). */
function buildAuthored(seed: number): { scenario: NonNullable<ReturnType<typeof buildP1Scenario>>; map: MapData } | null {
  const map = generateRealMap(seed);
  const ctx: P1BuildContext = {
    map,
    isWalkable: (x, y, radius) => isWalkableFromState(simFor(map), x, y, radius)
  };
  const scenario = buildP1Scenario(ctx);
  return scenario ? { scenario, map } : null;
}

const simCache = new WeakMap<MapData, ReturnType<typeof createSimulationState>>();
function simFor(map: MapData) {
  let sim = simCache.get(map);
  if (!sim) {
    sim = createSimulationState({ seed: map.seed, map, playerData: fullPlayerData(), playerX: 0, playerY: 0 });
    simCache.set(map, sim);
  }
  return sim;
}

// P4/M3 — the shared builder must FAIL VISIBLY instead of silently degrading
// into a same-cell device, stacked sentries or wall pseudo-success.
describe('P4 authored builder fails visibly (M3)', () => {
  it('returns null when the map cannot offer two routes', () => {
    const map = syntheticMap(2, () => 'floor');
    map.rooms = [room(0, 'start', 0, 0, 3, 3, [])];
    expect(buildP1Scenario({ map, isWalkable: () => true })).toBeNull();
  });

  it('returns null when the authored room has no walkable cell (no wall pseudo-success)', () => {
    const map = syntheticMap(6, () => 'floor');
    map.rooms = [
      room(0, 'start', 0, 0, 3, 3, [1]),
      room(1, 'combat', 3, 0, 2, 2, [0])
    ];
    expect(buildP1Scenario({ map, isWalkable: () => false })).toBeNull();
  });

  it('returns null when both routes collapse onto one walkable cell', () => {
    const map = syntheticMap(6, () => 'wall');
    map.rooms = [
      room(0, 'start', 0, 0, 3, 3, [1]),
      room(1, 'combat', 3, 0, 2, 2, [0])
    ];
    // Exactly one walkable cell in the authored room: one portal cell only.
    const only = { x: 1.5, y: 1.5 };
    const isWalkable = (x: number, y: number): boolean => x === only.x && y === only.y;
    expect(buildP1Scenario({ map, isWalkable })).toBeNull();
  });

  it('never places the device on the player start and never stacks the sentries', () => {
    for (const seed of [20261117, 20261118, 20261119, 1, 42]) {
      const built = buildAuthored(seed);
      expect(built, `seed ${seed}`).not.toBeNull();
      const s = built!.scenario;
      expect(Math.hypot(s.relay.x - s.playerStart!.x, s.relay.y - s.playerStart!.y))
        .toBeGreaterThanOrEqual(1.5);
      expect(s.drones).toHaveLength(2);
      expect(Math.hypot(s.drones[0].x - s.drones[1].x, s.drones[0].y - s.drones[1].y))
        .toBeGreaterThanOrEqual(2);
      for (const drone of s.drones) {
        expect(Math.hypot(drone.x - s.relay.x, drone.y - s.relay.y)).toBeGreaterThanOrEqual(1.5);
      }
    }
  });
});

function syntheticMap(size: number, kind: () => 'floor' | 'wall'): MapData {
  const tiles: MapData['tiles'] = [];
  for (let y = 0; y < size; y += 1) {
    const row: MapData['tiles'][number] = [];
    for (let x = 0; x < size; x += 1) row.push({ x, y, type: kind(), height: 0 });
    tiles.push(row);
  }
  return { seed: 1, width: size, height: size, tiles, rooms: [], doorways: [], roomsOrder: [] };
}

function room(id: number, kind: MapData['rooms'][number]['kind'], gx: number, gy: number, w: number, h: number, connectedTo: number[]) {
  return { id, kind, gx, gy, w, h, connectedTo, cleared: false, spawned: false };
}
