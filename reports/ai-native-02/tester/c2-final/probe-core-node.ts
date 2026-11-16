// Independent C2 Node-only probe (no Phaser / DOM): real damage/death, seed replay,
// fixed-tick framing equivalence. Run with vite-node from the frozen snapshot root.
import { basePlayerData } from './src/config/game';
import { ENEMY_STATS } from './src/config/enemies';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import type { EnemyData, MapData, PlayerData, Vec2 } from './src/types';
import {
  canonicalSimulationEvents, canonicalSimulationState, createSimulationState,
  isWalkableFromState, registerDrone, stepSimulationTicks, SIM_TUNING,
  type SimEvent, type SimulationIntent, type SimulationState
} from './src/world/sim/core';

const out: any = { checks: [], evidence: {} };
const check = (name: string, ok: boolean, detail?: any) => {
  out.checks.push({ name, ok, detail });
  if (!ok) process.exitCode = 1;
};

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
    ...base, level: 1, xp: 0, xpToNext: 30, currency: 0, weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as PlayerData;
}
function droneData(): EnemyData {
  const d = ENEMY_STATS.drone;
  return {
    kind: 'drone',
    stats: { ...d, speed: d.speed / 64, aggroRange: d.aggroRange / 64, attackRange: d.attackRange / 64 },
    state: 'idle', stateTimer: 1000, targetId: null, patrolPoints: [], patrolIndex: 0,
    hitFlash: 0, stunTimer: 0, spawnRoom: 0
  };
}
function neutral(move: Vec2 = { x: 0, y: 0 }, fire = false, aim: Vec2 | null = null): SimulationIntent {
  return { move, dash: false, fire, aim, interact: false };
}
function makeState(seed = 424242, aggressive = false) {
  const map = realMap();
  const state = createSimulationState({ seed, map, playerData: playerData(), playerX: 0, playerY: 0 });
  let player: Vec2 | null = null;
  let drone: Vec2 | null = null;
  for (const row of map.tiles) {
    for (const tile of row) {
      if (tile.type !== 'floor' && tile.type !== 'spawn') continue;
      if (!isWalkableFromState(state, tile.x, tile.y, 0.5)) continue;
      const candidate = { x: tile.x + 2, y: tile.y };
      if (!isWalkableFromState(state, candidate.x, candidate.y, 0.5)) continue;
      player = { x: tile.x, y: tile.y }; drone = candidate; break;
    }
    if (player) break;
  }
  if (!player || !drone) throw new Error('no walkable pair');
  state.player.x = player.x; state.player.y = player.y;
  const data = droneData();
  if (aggressive) { data.state = 'chase' as any; data.stateTimer = 0; }
  registerDrone(state, { id: 1, x: drone.x, y: drone.y, hp: data.stats.maxHp, data, attackTimer: 0, wanderTimer: aggressive ? 0 : 1000 });
  return { state, player, drone };
}

// 1) Real combat: player fires pulse and kills a real drone.
{
  const { state, drone } = makeState();
  const events: SimEvent[] = [];
  for (let i = 0; i < 240 && state.drones.length > 0; i++) {
    events.push(...stepSimulationTicks(state, 1, neutral({ x: 0, y: 0 }, true, drone)));
  }
  const types = [...new Set(events.map((e) => e.type))];
  check('drone-damaged-and-killed', state.drones.length === 0 && types.includes('enemy-hit') && types.includes('enemy-died'),
    { dronesLeft: state.drones.length, types });
  out.evidence.combat = { tick: state.tick, types, dronesLeft: state.drones.length, playerHp: state.player.data.hp };
}

// 2) Real damage and death of the player by a real drone (no scripted HP writes).
{
  const { state } = makeState(424242, true);
  const events: SimEvent[] = [];
  let deathTick = -1;
  for (let i = 0; i < 4000; i++) {
    events.push(...stepSimulationTicks(state, 1, neutral()));
    if (events.some((e) => e.type === 'player-death')) { deathTick = state.tick; break; }
  }
  const hurtCount = events.filter((e) => e.type === 'player-hurt').length;
  check('player-real-damage-and-death', deathTick > 0 && state.player.data.hp === 0 && hurtCount > 0,
    { deathTick, hurtCount, hp: state.player.data.hp });
  out.evidence.playerDeath = { deathTick, hurtCount, hp: state.player.data.hp, finalTick: state.tick };
}

// 3) Seed replay: identical seed+sequence => identical canonical state/events; different seed differs.
{
  const seq: SimulationIntent[] = [];
  for (let i = 0; i < 30; i++) seq.push(neutral({ x: 1, y: 0 }));
  for (let i = 0; i < 90; i++) seq.push(neutral({ x: 0, y: 0 }, true, { x: 10, y: 45 }));
  const run = (seed: number) => {
    const { state } = makeState(seed);
    const events: SimEvent[] = [];
    for (const intent of seq) events.push(...stepSimulationTicks(state, 1, intent));
    return { canonical: canonicalSimulationState(state), events: canonicalSimulationEvents(events), rngState: state.rngState, seed: state.seed };
  };
  const a = run(424242);
  const b = run(424242);
  const c = run(777);
  check('seed-replay-state-equal', a.canonical === b.canonical);
  check('seed-replay-events-equal', a.events === b.events);
  check('different-seed-differs', a.canonical !== c.canonical && a.rngState !== c.rngState);
  out.evidence.seedReplay = { equalState: a.canonical === b.canonical, equalEvents: a.events === b.events, seedDiff: a.seed !== c.seed, rngDiff: a.rngState !== c.rngState };
}

// 4) Fixed-tick framing equivalence: one 120-tick call == 120 single-tick calls; and 15 vs 3x5.
{
  const make = () => makeState().state;
  const intent = neutral({ x: 1, y: 1 });
  const one = make();
  const e1 = stepSimulationTicks(one, 120, intent);
  const many = make();
  const e2: SimEvent[] = [];
  for (let i = 0; i < 120; i++) e2.push(...stepSimulationTicks(many, 1, intent));
  check('framing-120-vs-120x1-state', canonicalSimulationState(one) === canonicalSimulationState(many));
  check('framing-120-vs-120x1-events', canonicalSimulationEvents(e1) === canonicalSimulationEvents(e2));

  const a = make();
  const ea = stepSimulationTicks(a, 15, intent);
  const b = make();
  const eb: SimEvent[] = [];
  for (let i = 0; i < 3; i++) eb.push(...stepSimulationTicks(b, 5, intent));
  check('framing-15-vs-3x5-state', canonicalSimulationState(a) === canonicalSimulationState(b));
  check('framing-15-vs-3x5-events', canonicalSimulationEvents(ea) === canonicalSimulationEvents(eb));
  out.evidence.framing = { tickHz: SIM_TUNING.TICK_HZ, maxTicksPerFrame: SIM_TUNING.MAX_TICKS_PER_FRAME, maxFrameDeltaMs: SIM_TUNING.MAX_FRAME_DELTA_MS };
}

console.log(JSON.stringify(out, null, 2));
console.log(out.checks.every((c: any) => c.ok) ? 'CORE_PROBE_PASS' : 'CORE_PROBE_FAIL');
