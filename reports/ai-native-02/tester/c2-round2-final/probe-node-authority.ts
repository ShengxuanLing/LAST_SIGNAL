// Independent C2 round-2 Node probe (no Phaser): target hit/death for hunter/stalker/
// sentinel/drone/boss, deep-copy/ID/snapshot authority, same-frame lethal hits,
// blocked-hit silence, XP/currency/level timers and deterministic replay.
import { GAME, basePlayerData } from './src/config/game';
import { ENEMY_STATS } from './src/config/enemies';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import type { EnemyData, MapData, PlayerData, Vec2 } from './src/types';
import {
  canonicalSimulationEvents, canonicalSimulationState, cloneSimulationState,
  createSimulationState, enqueuePlayerHit, enqueueTargetHp, isWalkableFromState,
  registerDrone, registerTarget, stepSimulationTicks,
  type SimEvent, type SimulationIntent, type SimulationState, type SimTarget
} from './src/world/sim/core';

const out: any = { checks: [], findings: [], flows: {}, meta: { target: '0df1514', nodeOnly: true } };
const check = (name: string, ok: boolean, detail?: any) => {
  out.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
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
function neutral(move: Vec2 = { x: 0, y: 0 }, fire = false, aim: Vec2 | null = null): SimulationIntent {
  return { move, dash: false, fire, aim, interact: false };
}
function makeState(seed = 424242) {
  const map = realMap();
  const state = createSimulationState({ seed, map, playerData: playerData(), playerX: 0, playerY: 0 });
  let player: Vec2 | null = null;
  for (const row of map.tiles) {
    for (const tile of row) {
      if (tile.type !== 'floor' && tile.type !== 'spawn') continue;
      if (!isWalkableFromState(state, tile.x, tile.y, 0.5)) continue;
      if (!isWalkableFromState(state, tile.x + 2, tile.y, 0.5)) continue;
      player = { x: tile.x, y: tile.y };
      break;
    }
    if (player) break;
  }
  if (!player) throw new Error('no player tile');
  state.player.x = player.x; state.player.y = player.y;
  return state;
}
function targetAt(state: SimulationState, kind: string, isBoss = false, overrides: Partial<SimTarget> = {}): SimTarget {
  const stats: any = isBoss ? ENEMY_STATS.boss_warden : (ENEMY_STATS as any)[kind];
  return registerTarget(state, {
    id: 900 + Math.floor(Math.random() * 100),
    kind, x: state.player.x + 2, y: state.player.y,
    hp: stats.maxHp, maxHp: stats.maxHp, armor: stats.armor, radius: 0.5,
    isBoss, xpValue: stats.xpValue, currencyValue: stats.currencyValue,
    ...overrides
  } as SimTarget);
}
function killWithFire(kind: string, isBoss = false, hpOverride?: number) {
  const state = makeState();
  const t = targetAt(state, kind, isBoss, hpOverride === undefined ? {} : { hp: hpOverride, maxHp: hpOverride });
  const events: SimEvent[] = [];
  for (let i = 0; i < 240 && state.targets.length > 0; i++) {
    events.push(...stepSimulationTicks(state, 1, neutral({ x: 0, y: 0 }, true, { x: t.x, y: t.y })));
  }
  return { state, target: t, events, types: [...new Set(events.map((e) => e.type))] };
}

// 1) Every non-drone target kind: real hit, death, reward events.
for (const kind of ['hunter', 'stalker', 'sentinel']) {
  const r = killWithFire(kind);
  const reward = r.types.includes('xp-gained');
  check(`${kind}-hit-death-reward`, r.state.targets.length === 0 && r.types.includes('enemy-hit') && r.types.includes('enemy-died') && reward,
    { types: r.types, hp: r.state.player.data.hp, xp: r.state.player.data.xp });
  out.flows[kind] = { events: r.types, xp: r.state.player.data.xp, currency: r.state.player.data.currency, level: r.state.player.data.level };
}

// 2) Drone (core FSM) hit/death/reward.
{
  const state = makeState();
  const d = state.player;
  const drone = registerDrone(state, {
    id: 1, x: d.x + 2, y: d.y, hp: ENEMY_STATS.drone.maxHp,
    data: {
      kind: 'drone', stats: { ...ENEMY_STATS.drone, speed: ENEMY_STATS.drone.speed / 64, aggroRange: ENEMY_STATS.drone.aggroRange / 64, attackRange: ENEMY_STATS.drone.attackRange / 64 },
      state: 'idle', stateTimer: 1000, targetId: null, patrolPoints: [], patrolIndex: 0, hitFlash: 0, stunTimer: 0, spawnRoom: 0
    } as EnemyData, attackTimer: 0, wanderTimer: 1000
  });
  const events: SimEvent[] = [];
  for (let i = 0; i < 120 && state.drones.length > 0; i++) {
    events.push(...stepSimulationTicks(state, 1, neutral({ x: 0, y: 0 }, true, { x: drone.x, y: drone.y })));
  }
  const types = [...new Set(events.map((e) => e.type))];
  check('drone-hit-death-reward', state.drones.length === 0 && types.includes('enemy-died') && types.includes('xp-gained'), { types, xp: state.player.data.xp });
  out.flows.drone = { types, xp: state.player.data.xp, level: state.player.data.level };
}

// 3) Boss: real hit/death, deterministic boss reward (XP + 120 currency).
{
  const state = makeState();
  const boss = targetAt(state, 'boss_warden', true, { hp: 30, maxHp: ENEMY_STATS.boss_warden.maxHp, radius: ENEMY_STATS.boss_warden.maxHp > 0 ? 4 : 0.5 });
  const events: SimEvent[] = [];
  for (let i = 0; i < 240 && state.targets.length > 0; i++) {
    events.push(...stepSimulationTicks(state, 1, neutral({ x: 0, y: 0 }, true, { x: boss.x, y: boss.y })));
  }
  const types = [...new Set(events.map((e) => e.type))];
  const currencyEvents = events.filter((e) => e.type === 'currency-gained') as Array<Extract<SimEvent, { type: 'currency-gained' }>>;
  check('boss-hit-death-reward', state.targets.length === 0 && types.includes('enemy-died') && types.includes('xp-gained') &&
    currencyEvents.some((e) => e.amount === 120), { types, currency: currencyEvents.map((e) => e.amount), xp: state.player.data.xp });
  out.flows.boss = { types, currency: state.player.data.currency, xp: state.player.data.xp, level: state.player.data.level };
}

// 4) Deep-copy authority, ID uniqueness, snapshot immutability.
{
  const state = makeState();
  const input: SimTarget = {
    id: 77, kind: 'hunter', x: state.player.x + 2, y: state.player.y, hp: 20, maxHp: 20,
    armor: 0, radius: 0.5, isBoss: false, xpValue: 18, currencyValue: 6
  };
  const stored = registerTarget(state, input);
  check('registerTarget-deep-copy', stored !== input);
  stored.x = state.player.x + 1;
  check('registerTarget-input-not-authoritative', input.x === state.player.x + 2);
  const snapshot = JSON.parse(JSON.stringify(state)) as SimulationState;
  snapshot.player.data.hp = 1;
  snapshot.player.x += 100;
  snapshot.nextProjectileId = 999999;
  check('snapshot-mutation-does-not-touch-core', state.player.data.hp === 100 && Math.abs(state.player.x - (stored.x - 1)) < 1e-9 && state.nextProjectileId !== 999999, { hp: state.player.data.hp, x: state.player.x, storedX: stored.x, next: state.nextProjectileId });
  // Fire several shots; core projectile IDs must be unique and monotonic.
  const beforeNext = state.nextProjectileId;
  for (let i = 0; i < 30; i++) stepSimulationTicks(state, 1, neutral({ x: 0, y: 0 }, true, { x: stored.x, y: stored.y }));
  const ids = state.projectiles.map((p) => p.id);
  check('projectile-ids-unique', new Set(ids).size === ids.length, { ids });
  check('nextProjectileId-advanced', state.nextProjectileId > beforeNext, { beforeNext, next: state.nextProjectileId });
  const targetsIds = state.targets.map((t) => t.id);
  check('target-ids-unique', new Set(targetsIds).size === targetsIds.length, { targetsIds });
}

// 5) Same-frame multiple lethal hits: one death, one real hurt; blocked hits silent.
{
  const state = makeState();
  state.drones = [];
  state.player.data.hp = 10;
  state.player.invuln = 0;
  enqueuePlayerHit(state, 20, state.player.x + 1, state.player.y);
  enqueuePlayerHit(state, 20, state.player.x + 1, state.player.y);
  enqueuePlayerHit(state, 20, state.player.x + 1, state.player.y);
  const events = stepSimulationTicks(state, 1, neutral());
  check('same-frame-one-hurt', events.filter((e) => e.type === 'player-hurt').length === 1);
  check('same-frame-one-death', events.filter((e) => e.type === 'player-death').length === 1);
  const blocked = makeState();
  blocked.drones = [];
  blocked.player.invuln = 999;
  enqueuePlayerHit(blocked, 20, blocked.player.x + 1, blocked.player.y);
  const ev2 = stepSimulationTicks(blocked, 1, neutral());
  check('blocked-hit-silent', !ev2.some((e) => e.type === 'player-hurt') && !ev2.some((e) => e.type === 'player-death') && blocked.player.data.hp === 100,
    { events: ev2.map((e) => e.type) });
}

// 6) XP/level timers and deterministic replay after a real kill + subsequent shots.
{
  const state = makeState();
  const t = targetAt(state, 'hunter', false, { hp: 1, maxHp: 1, xpValue: 120 });
  const seq: SimulationIntent[] = [];
  for (let i = 0; i < 30; i++) seq.push(neutral({ x: 0, y: 0 }, true, { x: t.x, y: t.y }));
  for (let i = 0; i < 30; i++) seq.push(neutral({ x: 1, y: 0 }, true, { x: t.x, y: t.y }));
  const run = (s: SimulationState) => {
    const events: SimEvent[] = [];
    for (const intent of seq) events.push(...stepSimulationTicks(s, 1, intent));
    return { canonical: canonicalSimulationState(s), events: canonicalSimulationEvents(events), level: s.player.data.level, xp: s.player.data.xp, xpToNext: s.player.data.xpToNext, rng: s.rngState };
  };
  const a = run(cloneSimulationState(state));
  const b = run(cloneSimulationState(state));
  check('kill-parity-state-equal', a.canonical === b.canonical);
  check('kill-parity-events-equal', a.events === b.events);
  check('level-up-after-kill', a.level > 1 && a.xpToNext > 0, { level: a.level, xp: a.xp, xpToNext: a.xpToNext });
  check('rng-advanced-after-kill', a.rng !== state.rngState);
  out.flows.xpLevel = { level: a.level, xp: a.xp, xpToNext: a.xpToNext, rngChanged: a.rng !== state.rngState };
}

out.meta.endedUtc = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
console.log(out.checks.every((c: any) => c.ok) ? 'C2R2_NODE_PROBE_PASS' : 'C2R2_NODE_PROBE_FAIL');
