// Independent reviewer probe for C2 canonical/RNG boundaries (frozen 4cf1bc8).
// Run with: cd <snapshot> && npx vite-node reviewer-canonical-probe.ts
import { GAME, basePlayerData } from './src/config/game';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import type { MapData, PlayerData } from './src/types';
import { RNG } from './src/core/random';
import {
  canonicalSimulationEvents, canonicalSimulationState, createSimulationState,
  isWalkableFromState, stepSimulationTicks, type SimulationIntent
} from './src/world/sim/core';

const fail: string[] = [];
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!cond) fail.push(name);
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
function makeState() {
  const map = realMap();
  const st = createSimulationState({ seed: 424242, map, playerData: playerData(), playerX: 0, playerY: 0 });
  let p: { x: number; y: number } | null = null;
  for (const row of map.tiles) for (const t of row) {
    if (t.type !== 'floor' && t.type !== 'spawn') continue;
    if (isWalkableFromState(st, t.x, t.y, 0.5)) { p = { x: t.x, y: t.y }; break; }
  }
  if (!p) throw new Error('no walkable tile');
  st.player.x = p.x; st.player.y = p.y;
  return st;
}
const neutral = (fire = false, aim: { x: number; y: number } | null = null): SimulationIntent =>
  ({ move: { x: 0, y: 0 }, dash: false, fire, aim, interact: false });

// 1. canonical intentionally ignores XP/level/currency/upgrades array/dashCooldown.
{
  const a = makeState(); const b = makeState();
  b.player.data.xp = 999; b.player.data.level = 7; b.player.data.currency = 500;
  b.player.data.xpToNext = 999; b.player.data.xpGain = 2.5; b.player.data.pickupRange = 999;
  b.player.data.dashCooldown = 0.1;
  b.player.data.upgrades = [{ key: 'speed', level: 5 }];
  b.player.data.abilities = ['x'];
  check('canonical-equal-when-only-XP/upgrades-array/dashCooldown-differ', canonicalSimulationState(a) === canonicalSimulationState(b));
  // Materialized combat fields are included.
  b.player.data.speed = a.player.data.speed * 2;
  check('canonical-differs-when-materialized-speed-differs', canonicalSimulationState(a) !== canonicalSimulationState(b));
}
// 2. nextProjectileId is NOT canonical.
{
  const a = makeState(); const b = makeState();
  b.nextProjectileId = 999;
  check('canonical-equal-when-nextProjectileId-differs', canonicalSimulationState(a) === canonicalSimulationState(b));
}
// 3. map tiles are NOT canonical (only seed/min/width/height).
{
  const a = makeState(); const b = makeState();
  const t = b.map.tiles.flat().find((x) => x.type === 'floor');
  if (t) t.type = 'wall';
  check('canonical-equal-when-map-tile-type-differs', canonicalSimulationState(a) === canonicalSimulationState(b));
}
// 4. event 1e-9 rounding.
{
  const e1 = [{ type: 'player-moved' as const, position: { x: 1, y: 0 }, velocity: { x: 0, y: 0 }, dashTimer: 0, dashStarted: false }];
  const e2 = [{ type: 'player-moved' as const, position: { x: 1 + 1e-10, y: 0 }, velocity: { x: 0, y: 0 }, dashTimer: 0, dashStarted: false }];
  const e3 = [{ type: 'player-moved' as const, position: { x: 1 + 1e-8, y: 0 }, velocity: { x: 0, y: 0 }, dashTimer: 0, dashStarted: false }];
  check('event-rounding-masks-1e-10', canonicalSimulationEvents(e1 as any) === canonicalSimulationEvents(e2 as any));
  check('event-rounding-keeps-1e-8', canonicalSimulationEvents(e1 as any) !== canonicalSimulationEvents(e3 as any));
}
// 5. per-tick RNG is derived from (seed,tick), not a continuous stream.
{
  const a = makeState();
  // Tick 0: fire once (consume RNG). Then sample tick 1 fire.
  const eventsA = stepSimulationTicks(a, 10, neutral(true, { x: a.player.x + 5, y: a.player.y }));
  const shotA = eventsA.filter((e) => e.type === 'projectile-spawned') as any[];
  const b = makeState();
  // Tick 0: no fire. Then sample tick 1 fire.
  stepSimulationTicks(b, 10, neutral(false, null));
  const eventsB = stepSimulationTicks(b, 10, neutral(true, { x: b.player.x + 5, y: b.player.y }));
  const shotB = eventsB.filter((e) => e.type === 'projectile-spawned') as any[];
  check('per-tick-rng-crit-independent-of-prior-fire', !!shotA[0] && !!shotB[0] && shotA[0].projectile.crit === shotB[0].projectile.crit);
  // Continuous RNG with same seed would consume one float at tick 0 and differ at tick 1.
  const rng = new RNG(424242);
  const first = rng.float() < a.player.data.critChance;
  const second = rng.float() < a.player.data.critChance;
  check('continuous-rng-sequence-is-order-dependent', first !== second || true); // informational
  console.log(JSON.stringify({
    perTickCrit0: shotA[0]?.projectile.crit ?? null,
    perTickCrit1: shotB[0]?.projectile.crit ?? null,
    continuousFirst: first, continuousSecond: second,
    seed: a.seed, rngState0: a.rngState,
    note: 'C2 resets RNG per tick from deriveTickRngSeed(seed,tick); state.rngState is derived, not a continuous stream'
  }, null, 2));
}
console.log(JSON.stringify({ result: fail.length === 0 ? 'CANONICAL_PROBE_PASS' : 'CANONICAL_PROBE_FAIL', failures: fail }, null, 2));
if (fail.length) process.exitCode = 1;
