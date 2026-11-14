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
import { RNG } from '../../core/random';
import type { EnemyData, MapData, PlayerData, Vec2 } from '../../types';
import {
  canonicalSimulationEvents, canonicalSimulationState, cloneSimulationState,
  createSimulationState, enqueuePlayerHit, enqueueSpawnLoot, enqueueTargetHp, enqueueTargetMove,
  isWalkableFromState, registerDrone, registerTarget, stepSimulationTicks,
  SIM_TUNING, type SimEvent, type SimulationIntent, type SimTarget, type SimulationState
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

  it('H1/H6: canonical state is authoritative and events are not rounded', () => {
    const { state, drone } = makeState();
    const events = stepSimulationTicks(state, 40, neutral({ x: 0, y: 0 }, true, { x: drone.x, y: drone.y }));
    const canonical = canonicalSimulationState(state);
    expect(canonical).toContain('"mapHash"');
    expect(canonical).toContain('"targets"');
    expect(canonical).toContain('"pendingPlayerHits"');
    expect(canonical).toContain('"nextProjectileId"');
    expect(canonical).toContain('"weaponKey"');
    const parsed = JSON.parse(canonical);
    expect(Number.isInteger(parsed.nextProjectileId)).toBe(true);
    expect(typeof parsed.mapHash).toBe('string');
    expect(Array.isArray(parsed.targets)).toBe(true);
    const canonicalEvents = canonicalSimulationEvents(events);
    expect(canonicalEvents).not.toContain('faceAngle');
    const evt = JSON.parse(canonicalEvents);
    const hasFloat = evt.some((e: any) =>
      (e.position && !Number.isInteger(e.position.x)) ||
      (e.projectile && !Number.isInteger(e.projectile.pos.x)));
    expect(hasFloat, 'events preserve sub-tile float positions').toBe(true);
  });

  it('H2: core RNG is a continuous stream seeded from the map seed', () => {
    const mk = () => createSimulationState({ seed: 123, map: realMap(), playerData: playerData(), playerX: 0, playerY: 0 });
    const s1 = mk();
    expect(s1.rngState).toBe(new RNG(123 * 7919 + 1).snapshot());
    const run = (s: SimulationState) => {
      const ev = stepSimulationTicks(s, 30, neutral({ x: 0, y: 0 }, true, { x: s.player.x + 1, y: s.player.y }));
      return { rng: s.rngState, crits: ev.filter((e) => e.type === 'projectile-spawned' && e.projectile.crit).length };
    };
    const a = run(cloneSimulationState(s1));
    const b = run(cloneSimulationState(mk()));
    expect(a.rng).toBe(b.rng);
    expect(a.crits).toBe(b.crits);
  });

  it('B4: two lethal queued hits produce one death; blocked hits are not hurt facts', () => {
    const { state } = makeState();
    state.drones = [];
    state.player.data.hp = 10;
    state.player.invuln = 0;
    enqueuePlayerHit(state, 20, state.player.x + 1, state.player.y);
    enqueuePlayerHit(state, 20, state.player.x + 1, state.player.y);
    const events = stepSimulationTicks(state, 1, neutral({ x: 0, y: 0 }));
    expect(events.filter((e) => e.type === 'player-hurt')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'player-death')).toHaveLength(1);
    expect(state.player.data.hp).toBeLessThanOrEqual(0);

    const blocked = makeState().state;
    blocked.drones = [];
    blocked.player.invuln = 999;
    enqueuePlayerHit(blocked, 20, blocked.player.x + 1, blocked.player.y);
    const ev2 = stepSimulationTicks(blocked, 1, neutral({ x: 0, y: 0 }));
    expect(ev2.some((e) => e.type === 'player-hurt')).toBe(false);
    expect(ev2.some((e) => e.type === 'player-death')).toBe(false);
    expect(blocked.player.data.hp).toBe(100);
  });

  it('B7: registerTarget deep-copies and target moves are committed by the tick', () => {
    const { state } = makeState();
    const input: SimTarget = {
      id: 99, kind: 'hunter', x: 1, y: 1, hp: 20, maxHp: 20,
      armor: 0, radius: 0.5, isBoss: false, xpValue: 18, currencyValue: 6
    };
    const stored = registerTarget(state, input);
    expect(stored).not.toBe(input);
    stored.x = 5;
    expect(input.x).toBe(1);
    enqueueTargetMove(state, 99, 7, 8);
    expect(stored.x).toBe(5);
    stepSimulationTicks(state, 1, neutral({ x: 0, y: 0 }));
    expect({ x: stored.x, y: stored.y }).toEqual({ x: 7, y: 8 });
    enqueueTargetHp(state, 99, 3);
    stepSimulationTicks(state, 1, neutral({ x: 0, y: 0 }));
    expect(stored.hp).toBe(3);
  });

  it('B11: core loot is visible, unpicked loot does not settle, pickup commits currency', () => {
    const { state, drone } = makeState();
    state.drones = [];
    const neutralIntent = neutral({ x: 0, y: 0 });
    // Spawn loot far outside the pickup threshold: it must remain unsettled.
    enqueueSpawnLoot(state, state.player.x + 20, state.player.y, 'currency', 'currency', 7);
    const ev1 = stepSimulationTicks(state, 1, neutralIntent);
    expect(state.loot.length).toBe(1);
    expect(state.player.data.currency).toBe(0);
    expect(ev1.some((e) => e.type === 'loot-collected')).toBe(false);
    // Move the player onto the loot through the core state; next tick settles it.
    state.player.x = state.loot[0].x;
    state.player.y = state.loot[0].y;
    const ev2 = stepSimulationTicks(state, 1, neutralIntent);
    expect(ev2.some((e) => e.type === 'loot-collected')).toBe(true);
    expect(state.player.data.currency).toBe(7);
    expect(state.loot.length).toBe(0);
    void drone;
  });



  it('B12: paused/zero-dt does not commit any state (command queue only)', () => {
    const { state } = makeState();
    const neutralIntent = neutral({ x: 0, y: 0 });
    const hpBefore = state.player.data.hp;
    const currencyBefore = state.player.data.currency;
    const xBefore = state.player.x;
    const yBefore = state.player.y;
    const lootBefore = state.loot.length;
    const targetsBefore = state.targets.length;
    const dronesBefore = state.drones.length;
    const tickBefore = state.tick;

    // Queue commands but do not tick.
    enqueueSpawnLoot(state, state.player.x + 1, state.player.y, 'currency', 'currency', 7);
    enqueuePlayerHit(state, 5, 0, 0);

    // Zero-tick frame: commands stay pending, no state mutation.
    const ev0 = stepSimulationTicks(state, 0, neutralIntent);
    expect(state.player.data.hp).toBe(hpBefore);
    expect(state.player.data.currency).toBe(currencyBefore);
    expect(state.player.x).toBe(xBefore);
    expect(state.player.y).toBe(yBefore);
    expect(state.loot.length).toBe(lootBefore);
    expect(state.targets.length).toBe(targetsBefore);
    expect(state.drones.length).toBe(dronesBefore);
    expect(state.tick).toBe(tickBefore);
    expect(ev0.length).toBe(0);

    // One tick commits the queued commands.
    const ev1 = stepSimulationTicks(state, 1, neutralIntent);
    expect(state.tick).toBe(tickBefore + 1);
  });

  it('H2: kill loot rolls and the next shot share the controlled C1 RNG order', () => {
    const { state, drone } = makeState();
    state.player.x = drone.x - 0.5;
    state.player.y = drone.y;
    const d = state.drones[0];
    d.hp = 1;
    d.data.state = 'idle';
    d.data.stateTimer = 1000;
    d.attackTimer = 1000;
    d.wanderTimer = 1000;
    const aim = { x: d.x, y: d.y };
    const events = stepSimulationTicks(state, 40, neutral({ x: 0, y: 0 }, true, aim));
    const crits = events
      .filter((e): e is Extract<SimEvent, { type: 'projectile-spawned' }> =>
        e.type === 'projectile-spawned' && e.projectile.side === 'player')
      .map((e) => e.projectile.crit);
    expect(crits.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.type === 'enemy-died')).toBe(true);
    expect(events.some((e) => e.type === 'xp-gained')).toBe(true);
    const ref = new RNG(state.seed * 7919 + 1);
    const shot1 = ref.float() < state.player.data.critChance;
    ref.float(); ref.float(); // C1 kill loot rolls consume the same stream
    const shot2 = ref.float() < state.player.data.critChance;
    expect(crits[0]).toBe(shot1);
    expect(crits[1]).toBe(shot2);
    // XP is a core transaction, not an adapter addXp side effect.
    expect(state.player.data.xp).toBeGreaterThan(0);
  });
});
