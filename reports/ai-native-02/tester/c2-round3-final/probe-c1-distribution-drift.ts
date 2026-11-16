// Independent C2 round-3 supplement: C1 gameplay distribution drift (enemy kind / resource
// loot kind / portal target) between the C1 baseline (0df1514) and the round-3 target (6ac60b2).
// Pure Node: real MapGenerator + real RNG, no Phaser. No fixture beyond the real seed.
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { RNG } from './src/core/random';

const out: any = { checks: [], drift: [], meta: { target: '6ac60b2', baseline: '0df1514', note: 'C1 rules reproduced inline from the 0df1514 source; round-3 rules read from the 6ac60b2 source' } };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };

const KINDS = ['drone', 'stalker', 'hunter', 'sentinel'];

// --- C1 baseline rules (verbatim from 0df1514 src/world/World.ts) ---
function c1PickEnemy(rng: RNG, r: any, depth: number): string {
  const pool: string[] = [];
  if (r.kind === 'elite') pool.push('sentinel', 'hunter', 'stalker', 'drone');
  else {
    const roll = (r.id * 53 + depth * 11) % 4;
    pool.push(KINDS[roll], KINDS[(roll + 1) % 4]);
  }
  return rng.pick(pool);
}
function c1ResourceKind(rng: RNG, r: any, i: number): string {
  return rng.int(0, 1) === 0 ? 'currency' : 'health';
}
function c1PortalTarget(rng: RNG, neighbors: number[]): number {
  return rng.pick(neighbors);
}

// --- round-3 rules (verbatim from 6ac60b2 src/world/World.ts) ---
function r3PickEnemy(r: any, depth: number): string {
  if (r.kind === 'elite') {
    const elite = ['sentinel', 'hunter', 'stalker'] as const;
    return elite[r.id % elite.length];
  }
  return KINDS[(r.id * 53 + depth * 11) % 4];
}
function r3ResourceKind(r: any, i: number): string {
  return (r.id + i) % 2 === 0 ? 'currency' : 'health';
}
function r3PortalTarget(neighbors: number[]): number {
  return neighbors[0];
}

function build(seed: number) {
  const gen = new MapGenerator(seed);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  return map;
}

let mismatchRooms = 0, totalRooms = 0, c1Kinds = new Map<string, number>(), r3Kinds = new Map<string, number>();
let lootMismatch = 0, lootTotal = 0, portalMismatch = 0, portalTotal = 0;
const examples: any[] = [];
for (let seed = 1; seed <= 60; seed++) {
  const map = build(seed);
  const rngC1 = new RNG(seed * 7919 + 1);
  const rngR3 = new RNG(seed * 7919 + 1);
  for (const r of map.rooms) {
    if (r.kind === 'start') continue;
    totalRooms++;
    const depth = 1 + (r.id % 3);
    const count = r.kind === 'elite' ? 4 + depth : r.kind === 'shop' ? 1 : 2 + depth;
    const c1Set: string[] = [];
    const r3Set: string[] = [];
    for (let i = 0; i < count; i++) {
      const c1 = c1PickEnemy(rngC1, r, depth);
      const r3 = r3PickEnemy(r, depth);
      c1Set.push(c1); r3Set.push(r3);
      c1Kinds.set(c1, (c1Kinds.get(c1) ?? 0) + 1);
      r3Kinds.set(r3, (r3Kinds.get(r3) ?? 0) + 1);
    }
    const roomMismatch = c1Set.join(',') !== r3Set.join(',');
    if (roomMismatch) {
      mismatchRooms++;
      if (examples.length < 5) examples.push({ seed, roomId: r.id, kind: r.kind, c1: c1Set, r3: r3Set });
    }
    if (r.kind === 'resource' || r.kind === 'shop') {
      const n = r.kind === 'shop' ? 3 : 2 + (depth % 3);
      for (let i = 0; i < n; i++) {
        lootTotal++;
        if (c1ResourceKind(rngC1, r, i) !== r3ResourceKind(r, i)) lootMismatch++;
      }
    }
    const neighbors = (r.connectedTo || []).filter((n: number) => n !== r.id);
    if (neighbors.length > 0) {
      portalTotal++;
      if (c1PortalTarget(rngC1, neighbors) !== r3PortalTarget(neighbors)) portalMismatch++;
    }
  }
}
out.drift = {
  seeds: 60, totalRooms, roomsWithDifferentEnemySet: mismatchRooms,
  lootChecks: lootTotal, lootKindMismatch: lootMismatch,
  portalChecks: portalTotal, portalTargetMismatch: portalMismatch,
  c1KindHistogram: Object.fromEntries(c1Kinds), r3KindHistogram: Object.fromEntries(r3Kinds),
  examples
};
check('enemy-kind-distribution-drift', mismatchRooms > 0, { mismatchRooms, totalRooms, examples });
check('resource-loot-kind-drift', lootMismatch > 0, { lootMismatch, lootTotal });
check('portal-target-drift', portalMismatch > 0, { portalMismatch, portalTotal });
check('elite-pool-lost-drone-or-sentinel', r3Kinds.get('sentinel') === undefined || r3Kinds.get('drone') === undefined, { r3: Object.fromEntries(r3Kinds) });
console.log(JSON.stringify(out, null, 2));
console.log(out.checks.every((c: any) => c.ok) ? 'DRIFT_PROBE_CONFIRMED' : 'DRIFT_PROBE_NOT_CONFIRMED');
