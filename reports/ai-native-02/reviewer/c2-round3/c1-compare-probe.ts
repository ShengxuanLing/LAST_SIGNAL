// C1 (860a0dd) vs round-3 (6ac60b2) room-generation RNG/distribution comparison.
// Uses target's unchanged MapGenerator/RNG/RoomDepth; old C1 formulas are copied
// from git show 860a0dd:src/world/World.ts:200-212,326-357.
import { RNG } from './src/core/random';
import { basePlayerData } from './src/config/game';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { RoomDepth } from './src/world/roomdepth';
import type { EnemyKind, MapData, Room } from './src/types';

const ALL: EnemyKind[] = ['drone', 'stalker', 'hunter', 'sentinel'];
const ELITE_OLD: EnemyKind[] = ['sentinel', 'hunter', 'stalker', 'drone'];
const ELITE_NEW: EnemyKind[] = ['sentinel', 'hunter', 'stalker'];

function buildMap(seed: number) {
  const gen = new MapGenerator(seed);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const rd = new RoomDepth();
  rd.build(map);
  return { map, rd };
}

function countFor(r: Room, depth: number): number {
  if (r.kind === 'start' || r.kind === 'boss') return 0;
  return r.kind === 'elite' ? 4 + depth : r.kind === 'shop' ? 1 : 2 + depth;
}
function lootCount(r: Room, depth: number): number {
  if (r.kind !== 'resource' && r.kind !== 'shop') return 0;
  return r.kind === 'shop' ? 3 : 2 + (depth % 3);
}
function oldPick(r: Room, depth: number, rng: RNG): EnemyKind {
  const pool: EnemyKind[] = r.kind === 'elite' ? [...ELITE_OLD] : (() => {
    const roll = (r.id * 53 + depth * 11) % 4;
    return [ALL[roll], ALL[(roll + 1) % 4]];
  })();
  return rng.pick(pool);
}
function newPick(r: Room, depth: number): EnemyKind {
  if (r.kind === 'elite') return ELITE_NEW[r.id % ELITE_NEW.length];
  const roll = (r.id * 53 + depth * 11) % 4;
  return ALL[roll];
}

let oldKindCounts: Record<string, number> = {};
let newKindCounts: Record<string, number> = {};
let totalEnemyDecisions = 0;
let enemyMismatch = 0;
let resourceMismatch = 0;
let portalMismatch = 0;
let portalCases = 0;
let oldRngConsumed = 0;
let roomsCompared = 0;
let seedsWithEnemyMismatch = 0;
let firstCritMismatch = 0;
let critSequenceMismatch = 0;
let rngStateAfterRoomsMismatch = 0;
const firstCritMismatchExamples: Array<{ seed: number; c1: boolean; target: boolean }> = [];
const critSequenceExamples: Array<{ seed: number; c1: boolean[]; target: boolean[] }> = [];
const perSeedFirstCrit: Array<{ seed: number; c1: boolean; target: boolean; oldRngAfterRooms: number; targetInitialRng: number }> = [];

for (let seed = 1; seed <= 200; seed++) {
  const { map, rd } = buildMap(seed);
  const rng = new RNG(seed * 7919 + 1);
  let seedHasMismatch = false;
  for (const r of map.rooms) {
    const depth = rd.of(r.id);
    const n = countFor(r, depth);
    for (let i = 0; i < n; i++) {
      const a = oldPick(r, depth, rng); // C1 consumes one World.rng float per enemy
      oldRngConsumed++;
      const b = newPick(r, depth); // round-3 consumes none
      oldKindCounts[a] = (oldKindCounts[a] ?? 0) + 1;
      newKindCounts[b] = (newKindCounts[b] ?? 0) + 1;
      totalEnemyDecisions++;
      if (a !== b) { enemyMismatch++; seedHasMismatch = true; }
    }
    const lootN = lootCount(r, depth);
    for (let i = 0; i < lootN; i++) {
      const a = rng.int(0, 1) === 0 ? 'currency' : 'health'; // C1 consumes one float
      oldRngConsumed++;
      const b = (r.id + i) % 2 === 0 ? 'currency' : 'health'; // round-3 consumes none
      if (a !== b) resourceMismatch++;
    }
    // Portal fallback only when all rooms are visited; simulate with the same rng.
    const neighbors = r.connectedTo.filter((x) => x !== r.id);
    if (neighbors.length > 0) {
      const oldTarget = rng.pick(neighbors); // C1 consumes one float
      oldRngConsumed++;
      const newTarget = neighbors[0];
      portalCases++;
      if (oldTarget !== newTarget) portalMismatch++;
      // Do not count this as part of pre-first-crit room spawn consumption below.
    }
    roomsCompared++;
  }
  if (seedHasMismatch) seedsWithEnemyMismatch++;
  // C1 first crit after room spawns (portal picks excluded from this reference).
  const c1 = new RNG(seed * 7919 + 1);
  for (const r of map.rooms) {
    const depth = rd.of(r.id);
    for (let i = 0; i < countFor(r, depth); i++) oldPick(r, depth, c1);
    for (let i = 0; i < lootCount(r, depth); i++) c1.int(0, 1);
  }
  const target = new RNG(seed * 7919 + 1);
  const crit = basePlayerData().critChance;
  const oldRngAfterRooms = c1.snapshot();
  const targetInitialRng = target.snapshot();
  const c1Crits: boolean[] = [];
  const targetCrits: boolean[] = [];
  for (let j = 0; j < 5; j++) {
    c1Crits.push(c1.float() < crit);
    targetCrits.push(target.float() < crit);
  }
  const c1Crit = c1Crits[0];
  const targetCrit = targetCrits[0];
  if (oldRngAfterRooms !== targetInitialRng) rngStateAfterRoomsMismatch++;
  if (c1Crit !== targetCrit) {
    firstCritMismatch++;
    if (firstCritMismatchExamples.length < 8) firstCritMismatchExamples.push({ seed, c1: c1Crit, target: targetCrit });
  }
  if (JSON.stringify(c1Crits) !== JSON.stringify(targetCrits)) {
    critSequenceMismatch++;
    if (critSequenceExamples.length < 8) critSequenceExamples.push({ seed, c1: c1Crits, target: targetCrits });
  }
  if (seed <= 5 || seed === 424242) {
    perSeedFirstCrit.push({ seed, c1: c1Crit, target: targetCrit, oldRngAfterRooms, targetInitialRng });
  }
}

const ex = buildMap(424242);
const exRng = new RNG(424242 * 7919 + 1);
const example424242 = ex.map.rooms.map((r) => {
  const depth = ex.rd.of(r.id);
  const n = countFor(r, depth);
  const oldKinds: EnemyKind[] = [];
  const newKinds: EnemyKind[] = [];
  for (let i = 0; i < n; i++) { oldKinds.push(oldPick(r, depth, exRng)); newKinds.push(newPick(r, depth)); }
  const oldLoot: string[] = [];
  const newLoot: string[] = [];
  for (let i = 0; i < lootCount(r, depth); i++) {
    oldLoot.push(exRng.int(0, 1) === 0 ? 'currency' : 'health');
    newLoot.push((r.id + i) % 2 === 0 ? 'currency' : 'health');
  }
  return { id: r.id, kind: r.kind, depth, oldKinds, newKinds, oldLoot, newLoot, neighbors: r.connectedTo.filter((x) => x !== r.id), targetPortal: r.connectedTo.filter((x) => x !== r.id)[0] ?? null };
});

console.log(JSON.stringify({
  source: {
    c1: '860a0dd:src/world/World.ts:200-212,326-357',
    target: '6ac60b2:src/world/World.ts:448-460,577-607',
    note: 'MapGenerator/random/RoomDepth/enemy config unchanged between C1 and target; room order uses map.roomsOrder. Portal fallback simulated as all-rooms-visited.'
  },
  seeds: 200, roomsCompared, totalEnemyDecisions, enemyMismatch, seedsWithEnemyMismatch,
  oldKindCounts, newKindCounts, resourceMismatch, portalCases, portalMismatch,
  oldRngConsumedByRoomsAndPortal: oldRngConsumed,
  targetWorldRngConsumption: 0,
  firstCritMismatch, firstCritMismatchExamples,
  critSequenceMismatch, critSequenceExamples,
  rngStateAfterRoomsMismatch,
  perSeedFirstCrit,
  example424242,
  conclusion: 'C1 used World.rng for enemy/resource/portal decisions; round-3 removed those RNG calls and fixed selection by room id. Distribution and pre-first-crit RNG state changed.'
}, null, 2));
