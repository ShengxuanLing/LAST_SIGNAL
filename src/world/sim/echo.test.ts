// P3-a — independent echo actor on the authoritative core.
//
// Same pure combat rules, its own actor identity/HP/cooldown/facing; no shared
// player data and no free upgrades. With no echo the core is unchanged.

import { describe, expect, it } from 'vitest';
import { GAME, basePlayerData } from '../../config/game';
import { ENEMY_STATS } from '../../config/enemies';
import { MapGenerator, assignRoles, guaranteeReachable } from '../MapGenerator';
import type { EnemyData, MapData, PlayerData, Vec2 } from '../../types';
import {
  canonicalSimulationState, createSimulationState, ECHO_ACTOR_ID, echoPlayerData,
  enqueueCommand, isWalkableFromState, registerDrone, registerEcho, stepSimulationTicks,
  type SimulationIntent, type SimulationState
} from './core';

function realMap(): MapData {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  return map;
}

function playerData(): PlayerData {
  const base = basePlayerData();
  return {
    ...base, level: 1, xp: 0, xpToNext: 30, currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as PlayerData;
}

function droneData(): EnemyData {
  const d = ENEMY_STATS.drone;
  return {
    kind: 'drone',
    stats: { ...d, speed: d.speed / 64, aggroRange: d.aggroRange / 64, attackRange: d.attackRange / 64 },
    state: 'attack', stateTimer: 1000, targetId: null,
    patrolPoints: [], patrolIndex: 0, hitFlash: 0, stunTimer: 0, spawnRoom: 0
  };
}

function neutral(move: Vec2 = { x: 0, y: 0 }, fire = false, aim: Vec2 | null = null): SimulationIntent {
  return { move, dash: false, fire, aim, interact: false };
}

/** Find N walkable positions with distinct tiles on the real map. */
function walkableSpots(state: SimulationState, count: number): Vec2[] {
  const spots: Vec2[] = [];
  for (const row of state.map.tiles) {
    for (const tile of row) {
      if (!isWalkableFromState(state, tile.x, tile.y, 0.5)) continue;
      if (spots.some((s) => Math.abs(s.x - tile.x) < 2 && Math.abs(s.y - tile.y) < 2)) continue;
      spots.push({ x: tile.x, y: tile.y });
      if (spots.length >= count) return spots;
    }
  }
  throw new Error('not enough walkable spots');
}

function makeState(): { state: SimulationState; spots: Vec2[] } {
  const state = createSimulationState({
    seed: 424242, map: realMap(), playerData: playerData(), playerX: 0, playerY: 0
  });
  const spots = walkableSpots(state, 3);
  state.player.x = spots[0].x;
  state.player.y = spots[0].y;
  return { state, spots };
}

/** The walkable tile farthest from `at` (to keep the player out of the fight). */
function farthestWalkable(state: SimulationState, at: Vec2): Vec2 {
  let best: Vec2 = { x: at.x, y: at.y };
  let bestD = -1;
  for (const row of state.map.tiles) {
    for (const tile of row) {
      if (!isWalkableFromState(state, tile.x, tile.y, 0.5)) continue;
      const d = (tile.x - at.x) ** 2 + (tile.y - at.y) ** 2;
      if (d > bestD) { best = { x: tile.x, y: tile.y }; bestD = d; }
    }
  }
  return best;
}

/** A walkable tile within 2 tiles of `at` (to put a drone next to the echo). */
function nearbyWalkable(state: SimulationState, at: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const row of state.map.tiles) {
    for (const tile of row) {
      if (tile.x === at.x && tile.y === at.y) continue;
      if (!isWalkableFromState(state, tile.x, tile.y, 0.5)) continue;
      const d = Math.abs(tile.x - at.x) + Math.abs(tile.y - at.y);
      if (d <= 2 && d < bestD) { best = { x: tile.x, y: tile.y }; bestD = d; }
    }
  }
  return best;
}

function spawnDrone(state: SimulationState, at: Vec2, id = 1): void {
  const data = droneData();
  registerDrone(state, { id, x: at.x, y: at.y, hp: data.stats.maxHp, data, attackTimer: 0, wanderTimer: 1000 });
}

describe('P3-a echo actor core', () => {
  it('with no echo the canonical state has no echo key and 3-arg stepping is unchanged', () => {
    const a = makeState().state;
    const b = makeState().state;
    expect(canonicalSimulationState(a)).not.toContain('"echo"');
    stepSimulationTicks(a, 30, neutral());
    stepSimulationTicks(b, 30, neutral(), undefined);
    expect(canonicalSimulationState(a)).toBe(canonicalSimulationState(b));
  });

  it('echo has an independent identity and base-only stats (no upgrades, pulse only)', () => {
    const { state, spots } = makeState();
    state.player.data.upgrades.push({ key: 'damage', level: 5 } as never);
    const echo = registerEcho(state, spots[1].x, spots[1].y);
    expect(echo.actorId).toBe(ECHO_ACTOR_ID);
    expect(echo.actorId).not.toBe(0);
    expect(echo.data).not.toBe(state.player.data);
    expect(echo.data.upgrades).toEqual([]);
    expect(echo.data.abilities).toEqual([]);
    expect(echo.data.weaponKey).toBe('pulse');
    expect(echo.data.weapons).toHaveLength(1);
    expect(echo.data.weapons[0].magazine).toBe(-1);
    expect(echo.data.damage).toBe(basePlayerData().damage);
    expect(echo.data.hp).toBe(echo.data.maxHp);
    expect(echoPlayerData().upgrades).toEqual([]);
  });

  it('moves independently from the player and emits echo-moved', () => {
    const { state, spots } = makeState();
    const echo = registerEcho(state, spots[1].x, spots[1].y);
    const start = { x: echo.x, y: echo.y };
    const playerStart = { x: state.player.x, y: state.player.y };
    const events = stepSimulationTicks(state, 10, neutral(), neutral({ x: 1, y: 0 }));
    expect(echo.x).toBeGreaterThan(start.x);
    expect(state.player.x).toBe(playerStart.x);
    expect(state.player.y).toBe(playerStart.y);
    expect(events.some((e) => e.type === 'echo-moved')).toBe(true);
  });

  it('fires with its own cooldown/ammo and hits a drone (projectile source=echo)', () => {
    const { state, spots } = makeState();
    const echo = registerEcho(state, spots[1].x, spots[1].y);
    spawnDrone(state, spots[2], 7);
    const drone = state.drones[0];
    const startHp = drone.hp;
    const aim = { x: drone.x, y: drone.y };
    const events = stepSimulationTicks(state, 1, neutral(), neutral({ x: 0, y: 0 }, true, aim));
    const fired = events.find((e) => e.type === 'echo-fired');
    expect(fired).toBeTruthy();
    const shot = state.projectiles.find((p) => p.source === 'echo');
    expect(shot).toBeTruthy();
    expect(shot?.ownerId).toBe(ECHO_ACTOR_ID);
    expect(shot?.side).toBe('player');
    expect(echo.fireTimer).toBeGreaterThan(0);
    // Travel to the drone and damage it.
    const later = stepSimulationTicks(state, 60, neutral(), neutral());
    expect(later.some((e) => e.type === 'enemy-hit')).toBe(true);
    expect(drone.hp).toBeLessThan(startHp);
    // The player never fired.
    expect(state.player.data.weapons[0].ammo).toBe(-1);
  });

  it('enemy legally selects the closer echo and damages it, not the player', () => {
    const { state, spots } = makeState();
    const echo = registerEcho(state, spots[1].x, spots[1].y);
    // Player far away; echo right next to the drone.
    const far = farthestWalkable(state, echo);
    state.player.x = far.x;
    state.player.y = far.y;
    const near = nearbyWalkable(state, echo) ?? spots[2];
    spawnDrone(state, near, 1);
    const startHp = echo.data.hp;
    const playerHp = state.player.data.hp;
    const events = stepSimulationTicks(state, 120, neutral(), neutral());
    const steps = events.filter((e) => e.type === 'drone-step');
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.some((e) => (e as { step: { targetId: number | null } }).step.targetId === ECHO_ACTOR_ID)).toBe(true);
    expect(events.some((e) => e.type === 'echo-hurt')).toBe(true);
    expect(events.some((e) => e.type === 'player-hurt')).toBe(false);
    expect(echo.data.hp).toBeLessThan(startHp);
    expect(state.player.data.hp).toBe(playerHp);
  });

  it('echo death is independent: it stops acting and the player is still alive', () => {
    const { state, spots } = makeState();
    const echo = registerEcho(state, spots[1].x, spots[1].y);
    echo.data.hp = 1;
    spawnDrone(state, spots[2], 1);
    const events = stepSimulationTicks(state, 180, neutral(), neutral());
    expect(events.some((e) => e.type === 'echo-death')).toBe(true);
    expect(echo.data.hp).toBeLessThanOrEqual(0);
    expect(state.player.data.hp).toBeGreaterThan(0);
    const pos = { x: echo.x, y: echo.y };
    const after = stepSimulationTicks(state, 30, neutral(), neutral({ x: 1, y: 1 }, true, { x: 999, y: 999 }));
    expect(echo.x).toBe(pos.x);
    expect(echo.y).toBe(pos.y);
    expect(after.some((e) => e.type === 'echo-moved' || e.type === 'echo-fired')).toBe(false);
  });

  it('spawn-echo / remove-echo commit at the tick boundary and keep canonical shape', () => {
    const { state, spots } = makeState();
    enqueueCommand(state, { type: 'spawn-echo', x: spots[1].x, y: spots[1].y });
    const spawned = stepSimulationTicks(state, 1, neutral(), neutral());
    expect(spawned.some((e) => e.type === 'echo-spawned')).toBe(true);
    expect(state.echo).toBeTruthy();
    expect(canonicalSimulationState(state)).toContain('"echo"');
    enqueueCommand(state, { type: 'remove-echo' });
    const removed = stepSimulationTicks(state, 1, neutral(), neutral());
    expect(removed.some((e) => e.type === 'echo-despawned')).toBe(true);
    expect(state.echo).toBeUndefined();
    expect(canonicalSimulationState(state)).not.toContain('"echo"');
  });

  it('echo speed/damage cannot be upgraded through player upgrade commands', () => {
    const { state, spots } = makeState();
    const echo = registerEcho(state, spots[1].x, spots[1].y);
    const before = { speed: echo.data.speed, damage: echo.data.damage, crit: echo.data.critChance };
    enqueueCommand(state, { type: 'apply-upgrade', key: 'speed', level: 3 });
    enqueueCommand(state, { type: 'apply-upgrade', key: 'damage', level: 3 });
    stepSimulationTicks(state, 1, neutral(), neutral());
    expect(state.player.data.speed).toBeGreaterThan(before.speed);
    expect(echo.data.speed).toBe(before.speed);
    expect(echo.data.damage).toBe(before.damage);
    expect(echo.data.critChance).toBe(before.crit);
  });

  it('GAME pixel/tile contract is used by the echo projectile too', () => {
    expect(GAME.PIXEL_TO_TILE).toBe(64);
  });
});

describe('P3-a echo damage commands', () => {
  it('legacy melee damage is committed by the core tick, never by the adapter', () => {
    const { state, spots } = makeState();
    const echo = registerEcho(state, spots[1].x, spots[1].y);
    const hp = echo.data.hp;
    enqueueCommand(state, { type: 'echo-hit', damage: 7, fromX: spots[2].x, fromY: spots[2].y });
    // Enqueue only: no state write before the tick.
    expect(echo.data.hp).toBe(hp);
    const events = stepSimulationTicks(state, 1, neutral(), neutral());
    const hurt = events.find((e) => e.type === 'echo-hurt') as { actorId?: number; damage: number } | undefined;
    expect(hurt).toBeTruthy();
    expect(hurt!.damage).toBe(7);
    expect(hurt!.actorId).toBe(ECHO_ACTOR_ID);
    expect(echo.data.hp).toBe(hp - 7);
  });

  it('a dead echo ignores further queued hits and never emits twice', () => {
    const { state, spots } = makeState();
    const echo = registerEcho(state, spots[1].x, spots[1].y);
    echo.data.hp = 1;
    enqueueCommand(state, { type: 'echo-hit', damage: 50, fromX: 0, fromY: 0 });
    const first = stepSimulationTicks(state, 1, neutral(), neutral());
    expect(first.some((e) => e.type === 'echo-death')).toBe(true);
    enqueueCommand(state, { type: 'echo-hit', damage: 50, fromX: 0, fromY: 0 });
    const second = stepSimulationTicks(state, 1, neutral(), neutral());
    expect(second.some((e) => e.type === 'echo-hurt' || e.type === 'echo-death')).toBe(false);
    expect(echo.data.hp).toBeLessThanOrEqual(0);
  });
});
