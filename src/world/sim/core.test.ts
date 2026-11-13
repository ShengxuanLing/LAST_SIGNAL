// AI-NATIVE-02 C2 — Node-only authoritative core tests (no Phaser / DOM).
//
// Real generated room + real WEAPONS.pulse / ENEMY_STATS.drone config. Proves
// fixed integer ticks, movement/collision, fire/swept hit/damage/death,
// serializable seed snapshot replay and canonical state/event determinism.

import { describe, expect, it } from 'vitest';
import { GAME, basePlayerData } from '../../config/game';
import { WEAPONS } from '../../config/weapons';
import { ENEMY_STATS } from '../../config/enemies';
import { MapGenerator, assignRoles, guaranteeReachable } from '../MapGenerator';
import type { EnemyData, MapData, PlayerData, Vec2 } from '../../types';
import {
  canonicalSimulationEvents, canonicalSimulationState, cloneSimulationState,
  createSimulationState, isWalkableFromState, registerDrone, stepSimulationTicks,
  SIM_TUNING, type SimEvent, type SimulationIntent, type SimulationState
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
    ...base,
    level: 1, xp: 0, xpToNext: 30, currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as PlayerData;
}

function droneData(): EnemyData {
  const d = ENEMY_STATS.drone;
  return {
    kind: 'drone',
    stats: {
      ...d,
      speed: d.speed / 64,
      aggroRange: d.aggroRange / 64,
      attackRange: d.attackRange / 64
    },
    state: 'idle',
    stateTimer: 1000,
    targetId: null,
    patrolPoints: [],
    patrolIndex: 0,
    hitFlash: 0,
    stunTimer: 0,
    spawnRoom: 0
  };
}

function neutral(move: Vec2 = { x: 0, y: 0 }, fire = false, aim: Vec2 | null = null): SimulationIntent {
  return { move, dash: false, fire, aim, interact: false };
}

function makeState(): { state: SimulationState; player: Vec2; drone: Vec2 } {
  const map = realMap();
  const state = createSimulationState({
    seed: 424242,
    map,
    playerData: playerData(),
    playerX: 0,
    playerY: 0
  });
  let player: Vec2 | null = null;
  let drone: Vec2 | null = null;
  for (const row of map.tiles) {
    for (const tile of row) {
      if (tile.type !== 'floor' && tile.type !== 'spawn') continue;
      if (!isWalkableFromState(state, tile.x, tile.y, 0.5)) continue;
      const candidate = { x: tile.x + 2, y: tile.y };
      if (!isWalkableFromState(state, candidate.x, candidate.y, 0.5)) continue;
      player = { x: tile.x, y: tile.y };
      drone = candidate;
      break;
    }
    if (player) break;
  }
  if (!player || !drone) throw new Error('no walkable player/drone pair in real map');
  state.player.x = player.x;
  state.player.y = player.y;
  const data = droneData();
  registerDrone(state, {
    id: 1, x: drone.x, y: drone.y, hp: data.stats.maxHp, data,
    attackTimer: 0, wanderTimer: 1000
  });
  return { state, player, drone };
}

describe('C2 fixed-tick authoritative core', () => {
  it('runs integer ticks only, with no wall clock or sub-tick partial state', () => {
    const { state } = makeState();
    expect(SIM_TUNING.TICK_HZ).toBe(60);
    expect(SIM_TUNING.MAX_FRAME_DELTA_MS).toBe(250);
    expect(SIM_TUNING.MAX_TICKS_PER_FRAME).toBe(15);
    stepSimulationTicks(state, 0, neutral());
    expect(state.tick).toBe(0);
    stepSimulationTicks(state, 10, neutral());
    expect(state.tick).toBe(10);
    expect(Number.isInteger(state.tick)).toBe(true);
  });

  it('moves through the real room with collision and explicit seed/tick RNG', () => {
    const { state, player } = makeState();
    const before = { x: state.player.x, y: state.player.y };
    stepSimulationTicks(state, 30, neutral({ x: 1, y: 0 }));
    expect(state.tick).toBe(30);
    expect(isWalkableFromState(state, state.player.x, state.player.y, 0.5)).toBe(true);
    expect(Math.hypot(state.player.x - before.x, state.player.y - before.y)).toBeGreaterThan(0);
    expect(state.seed).toBe(424242);
    expect(Number.isFinite(state.rngState)).toBe(true);
  });

  it('fires pulse, sweeps hits, damages and kills a real stationary drone', () => {
    const { state, drone } = makeState();
    const aim = { x: drone.x, y: drone.y };
    const events = stepSimulationTicks(state, 180, neutral({ x: 0, y: 0 }, true, aim));
    const types = new Set(events.map((e) => e.type));
    expect(types.has('projectile-spawned')).toBe(true);
    expect(types.has('enemy-hit')).toBe(true);
    expect(types.has('enemy-died')).toBe(true);
    expect(state.drones.length).toBe(0);
    const died = events.find((e) => e.type === 'enemy-died');
    expect(died && died.type === 'enemy-died' && died.enemyId).toBe(1);
  });

  it('is reproducible from a serializable snapshot (same seed + intents + ticks)', () => {
    const { state, drone } = makeState();
    const initial = cloneSimulationState(state);
    const sequence: Array<{ ticks: number; intent: SimulationIntent }> = [
      { ticks: 12, intent: neutral({ x: 1, y: 0 }) },
      { ticks: 90, intent: neutral({ x: 0, y: 0 }, true, { x: drone.x, y: drone.y }) },
      { ticks: 18, intent: neutral({ x: -1, y: 0 }) }
    ];
    const run = (s: SimulationState) => {
      const allEvents: SimEvent[] = [];
      for (const step of sequence) allEvents.push(...stepSimulationTicks(s, step.ticks, step.intent));
      return { state: canonicalSimulationState(s), events: canonicalSimulationEvents(allEvents) };
    };
    const a = run(cloneSimulationState(initial));
    const b = run(cloneSimulationState(initial));
    expect(a.state).toBe(b.state);
    expect(a.events).toBe(b.events);
    expect(a.state).toContain('"tick":120');
    expect(WEAPONS.pulse.baseDamage).toBe(12);
    expect(GAME.PIXEL_TO_TILE).toBe(64);
  });
});
