// Independent C2 round-3 Node probe: visible kill loot (far drop), pickup transaction,
// pending commands + zero-tick no-op, normal-tick commit once, snapshot/ID authority, RNG replay.
import { GAME, basePlayerData } from './src/config/game';
import { ENEMY_STATS } from './src/config/enemies';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import type { EnemyData, MapData, PlayerData, Vec2 } from './src/types';
import {
  canonicalSimulationEvents, canonicalSimulationState, cloneSimulationState,
  createSimulationState, enqueueCommand, enqueuePlayerHit, enqueueSpawnLoot, isWalkableFromState,
  registerTarget, stepSimulationTicks,
  type SimEvent, type SimulationIntent, type SimulationState, type SimTarget, type SimLootKind
} from './src/world/sim/core';

const out: any = { checks: [], findings: [], flows: {}, meta: { target: '6ac60b2', nodeOnly: true } };
const check = (name: string, ok: boolean, detail?: any) => {
  out.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) process.exitCode = 1;
};
function realMap(): MapData {
  const gen = new MapGenerator(424242);
  const map = gen.generate(); assignRoles(gen, map.rooms, map.roomsOrder); guaranteeReachable(map);
  return map;
}
function playerData(): PlayerData {
  const base = basePlayerData();
  return { ...base, level: 1, xp: 0, xpToNext: 30, currency: 0, weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: [] } as PlayerData;
}
function neutral(move: Vec2 = { x: 0, y: 0 }, fire = false, aim: Vec2 | null = null): SimulationIntent {
  return { move, dash: false, fire, aim, interact: false };
}
function makeState(seed = 424242) {
  const map = realMap();
  const state = createSimulationState({ seed, map, playerData: playerData(), playerX: 0, playerY: 0 });
  let p: Vec2 | null = null;
  for (const row of map.tiles) {
    for (const t of row) {
      if (t.type !== 'floor' && t.type !== 'spawn') continue;
      if (!isWalkableFromState(state, t.x, t.y, 0.5)) continue;
      p = { x: t.x, y: t.y }; break;
    }
    if (p) break;
  }
  if (!p) throw new Error('no player tile');
  state.player.x = p.x; state.player.y = p.y;
  return state;
}
function farFloor(state: SimulationState, minDist = 16): Vec2 {
  let best: Vec2 | null = null;
  for (const row of state.map.tiles) {
    for (const t of row) {
      if (t.type !== 'floor' && t.type !== 'spawn') continue;
      if (!isWalkableFromState(state, t.x, t.y, 0.5)) continue;
      const d = Math.hypot(t.x - state.player.x, t.y - state.player.y);
      if (d > minDist) { best = { x: t.x, y: t.y }; break; }
    }
    if (best) break;
  }
  return best ?? { x: state.player.x + minDist + 4, y: state.player.y };
}
function targetAt(state: SimulationState, x: number, y: number, kind = 'hunter', hp = 1): SimTarget {
  const stats: any = ENEMY_STATS[kind];
  return registerTarget(state, {
    id: 77, kind, x, y, hp, maxHp: stats.maxHp, armor: stats.armor, radius: 0.5,
    isBoss: false, xpValue: stats.xpValue, currencyValue: stats.currencyValue
  } as SimTarget);
}

// 1) Real kill at a distance: loot is a visible core item, currency/HP unchanged until pickup.
{
  const state = makeState();
  const far = farFloor(state, 16);
  const t = targetAt(state, far.x, far.y, 'hunter', 1);
  // Inject one real player-side core projectile at the target (declared fixture).
  state.projectiles.push({
    id: state.nextProjectileId++, ownerId: 0, side: 'player', source: 'player', kind: 'pulse',
    pos: { x: t.x, y: t.y }, vel: { x: 0, y: 0 }, damage: 999, lifetime: 1, radius: 0.2,
    crit: false, pierce: 0, hitIds: []
  } as any);
  const tick0 = state.tick;
  const currency0 = state.player.data.currency, hp0 = state.player.data.hp, xp0 = state.player.data.xp;
  const events = stepSimulationTicks(state, 1, neutral());
  const types = [...new Set(events.map((e) => e.type))];
  const dropped = events.filter((e) => e.type === 'loot-dropped') as Array<Extract<SimEvent, { type: 'loot-dropped' }>>;
  const collected = events.filter((e) => e.type === 'loot-collected');
  const currencyGainEvents = events.filter((e) => e.type === 'currency-gained');
  check('far-kill-emits-loot-dropped', dropped.length >= 1 && types.includes('enemy-died') && types.includes('xp-gained'), { types, far });
  check('far-kill-loot-not-auto-collected', collected.length === 0 && state.loot.length >= 1 && state.player.data.currency === currency0,
    { loot: state.loot.length, collected: collected.length, currency: state.player.data.currency });
  check('far-kill-xp-but-no-currency-yet', state.player.data.xp > xp0 && currencyGainEvents.length === 0,
    { xp: state.player.data.xp, currencyEvents: currencyGainEvents.length });
  const beforeCollect = { currency: state.player.data.currency, hp: state.player.data.hp, loot: state.loot.length };
  // Move the player onto/next to the drop via a legal core teleport command (declared
  // fixture), then let stepLoot settle it on the next normal tick.
  let pick = { x: far.x, y: far.y };
  for (const row of state.map.tiles) {
    for (const t of row) {
      if (t.type !== 'floor' && t.type !== 'spawn') continue;
      if (!isWalkableFromState(state, t.x, t.y, 0.5)) continue;
      if (Math.hypot(t.x - far.x, t.y - far.y) < 10) { pick = { x: t.x, y: t.y }; break; }
    }
    if (pick.x !== far.x || pick.y !== far.y) break;
  }
  enqueueCommand(state, { type: 'teleport-player', x: pick.x, y: pick.y, healToFull: false });
  const ev2 = stepSimulationTicks(state, 1, neutral());
  const collected2 = ev2.filter((e) => e.type === 'loot-collected');
  check('moving-picks-up-drop', collected2.length >= 1 || state.player.data.currency > beforeCollect.currency || state.player.data.hp > beforeCollect.hp,
    { before: beforeCollect, after: { currency: state.player.data.currency, hp: state.player.data.hp, loot: state.loot.length }, ev2: ev2.map((e) => e.type) });
  out.flows.farKill = { far, events: types, dropped: dropped.length, beforeCollect, after: { currency: state.player.data.currency, hp: state.player.data.hp, loot: state.loot.length }, tick0 };
}

// 2) Pending commands: 0 ticks no-op, 1 tick commit once, next tick no duplicate.
{
  const state = makeState();
  const c0 = state.player.data.currency, hp0 = state.player.data.hp, up0 = state.player.data.upgrades.length;
  enqueueCommand(state, { type: 'heal-player', amount: 10 });
  enqueueCommand(state, { type: 'add-currency', amount: 50 });
  enqueueCommand(state, { type: 'apply-upgrade', key: 'speed', level: 1 });
  enqueueCommand(state, { type: 'add-xp', base: 5 });
  enqueueSpawnLoot(state, state.player.x + 20, state.player.y, 'currency', 'currency', 10);
  const pending0 = state.pendingCommands.length;
  const ev0 = stepSimulationTicks(state, 0, neutral());
  check('zero-ticks-no-events', ev0.length === 0, { events: ev0.map((e) => e.type) });
  check('zero-ticks-no-commit', state.pendingCommands.length === pending0 && state.player.data.currency === c0 && state.player.data.hp === hp0 && state.loot.length === 0,
    { pending: state.pendingCommands.length, pending0, currency: state.player.data.currency, hp: state.player.data.hp });
  const ev1 = stepSimulationTicks(state, 1, neutral());
  const t1 = [...new Set(ev1.map((e) => e.type))];
  check('one-tick-commits-all', t1.includes('player-healed') && t1.includes('currency-gained') && t1.includes('player-upgraded') && t1.includes('loot-dropped') && t1.includes('xp-gained'), { t1 });
  check('one-tick-consumes-pending', state.pendingCommands.length === 0, { pending: state.pendingCommands.length });
  const c1 = state.player.data.currency, hp1 = state.player.data.hp, up1 = state.player.data.upgrades.length;
  const ev2 = stepSimulationTicks(state, 1, neutral());
  const t2 = [...new Set(ev2.map((e) => e.type))];
  check('no-duplicate-reward-next-tick', !t2.includes('player-healed') && !t2.includes('currency-gained') && !t2.includes('player-upgraded') && state.player.data.currency === c1 && state.player.data.hp === hp1 && state.player.data.upgrades.length === up1, { t2, c1, hp1, up1 });
  out.flows.pending = { pending0, t1, t2, c0, c1, hp0, hp1, up0, up1 };
}

// 3) Snapshot nested writes / IDs / canonical includes loot+pending.
{
  const state = makeState();
  enqueueSpawnLoot(state, state.player.x + 20, state.player.y, 'health', 'health', 30);
  stepSimulationTicks(state, 1, neutral());
  const snapshot = JSON.parse(JSON.stringify(state)) as SimulationState;
  snapshot.player.data.hp = 1;
  snapshot.player.x += 100;
  if (snapshot.loot.length) snapshot.loot[0].x += 100;
  snapshot.pendingCommands.push({ type: 'add-currency', amount: 999 });
  snapshot.nextLootId = 999999;
  check('snapshot-nested-write-no-core-change', state.player.data.hp === 100 && Math.abs(state.player.x - (snapshot.player.x - 100)) < 1e-9 &&
    state.loot[0]?.x !== snapshot.loot[0]?.x && state.pendingCommands.length === 0 && state.nextLootId !== 999999,
    { hp: state.player.data.hp, x: state.player.x, lootX: state.loot[0]?.x, snapshotLootX: snapshot.loot[0]?.x, nextLootId: state.nextLootId });
  const canonical = canonicalSimulationState(state);
  check('canonical-includes-loot-pending', canonical.includes('"loot"') && canonical.includes('"pendingCommands"') && canonical.includes('"nextLootId"'));
  const ids = state.loot.map((l) => l.id);
  check('loot-ids-unique', new Set(ids).size === ids.length, { ids });
}

// 3b) Magnet radius behavior: a drop within pickupRange (90 grid units) is pulled and
// auto-collected without player movement. Recorded as a finding/limitation.
{
  const state = makeState();
  const c0 = state.player.data.currency;
  enqueueSpawnLoot(state, state.player.x + 20, state.player.y, 'currency', 'currency', 10);
  const ev1 = stepSimulationTicks(state, 1, neutral());
  const beforeMove = state.player.data.currency;
  let collected = false;
  for (let i = 0; i < 40 && !collected; i++) {
    const ev = stepSimulationTicks(state, 1, neutral());
    if (ev.some((e) => e.type === 'loot-collected')) collected = true;
  }
  out.flows.magnet = { c0, beforeMove, currency: state.player.data.currency, collected, loot: state.loot.length, firstTypes: ev1.map((e) => e.type) };
  if (collected && state.player.data.currency > beforeMove) {
    out.findings.push({ name: 'magnet-radius-auto-collect', detail: { note: 'a loot drop 20 grid units away is auto-collected while the player never moves; core treats pickupRange=90 as grid units, so drops within 90 units are not left visible for manual pickup', detail: out.flows.magnet } });
  } else {
    check('magnet-radius-auto-collect-unexpected', false, out.flows.magnet);
  }
}

// 4) Same-seed replay including loot/RNG after a kill and subsequent shots.
{
  const make = () => {
    const s = makeState();
    const far = farFloor(s, 16);
    const t = targetAt(s, far.x, far.y, 'hunter', 1);
    s.projectiles.push({ id: s.nextProjectileId++, ownerId: 0, side: 'player', source: 'player', kind: 'pulse',
      pos: { x: t.x, y: t.y }, vel: { x: 0, y: 0 }, damage: 999, lifetime: 1, radius: 0.2,
      crit: false, pierce: 0, hitIds: [] } as any);
    return s;
  };
  const seq: SimulationIntent[] = [neutral(), neutral({ x: 1, y: 0 }), neutral({ x: 0, y: 0 }, true, { x: 1, y: 0 }), neutral()];
  const run = (s: SimulationState) => { const ev: SimEvent[] = []; for (const i of seq) ev.push(...stepSimulationTicks(s, 1, i)); return { canonical: canonicalSimulationState(s), events: canonicalSimulationEvents(ev), rng: s.rngState }; };
  const a = run(cloneSimulationState(make()));
  const b = run(cloneSimulationState(make()));
  check('kill-loot-replay-state-equal', a.canonical === b.canonical);
  check('kill-loot-replay-events-equal', a.events === b.events);
  check('kill-loot-replay-rng-equal', a.rng === b.rng);
  out.flows.replay = { stateEqual: a.canonical === b.canonical, eventsEqual: a.events === b.events, rngEqual: a.rng === b.rng };
}

out.meta.endedUtc = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
console.log(out.checks.every((c: any) => c.ok) ? 'C2R3_NODE_PROBE_PASS' : 'C2R3_NODE_PROBE_FAIL');
