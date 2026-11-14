// C2 final seam — 200+ seed C1 room-generation distribution reference.
//
// Replays the exact C1 room algorithms (enemy pick, resource kind, portal pick)
// with the same seeded RNG on the core `room-enter` command, and asserts the
// core consumes the identical RNG stream and makes identical choices.
import { GAME, basePlayerData } from '../src/config/game';
import { RNG } from '../src/core/random';
import { MapGenerator, assignRoles, guaranteeReachable } from '../src/world/MapGenerator';
import { RoomDepth } from '../src/world/roomdepth';
import {
  createSimulationState, enqueueCommand, stepSimulationTicks,
  type SimulationState
} from '../src/world/sim/core';

const NEUTRAL = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
let failures = 0;
const fail = (msg: string, detail: unknown) => { failures++; console.log('FAIL', msg, JSON.stringify(detail)); };

const pickEnemy = (roomKind: string, roomId: number, depth: number, rng: RNG): string => {
  if (roomKind === 'elite') return rng.pick(['sentinel', 'hunter', 'stalker', 'drone']);
  const roll = (roomId * 53 + depth * 11) % 4;
  const all = ['drone', 'stalker', 'hunter', 'sentinel'];
  return rng.pick([all[roll], all[(roll + 1) % 4]]);
};

const enemyCount = (kind: string, depth: number): number =>
  kind === 'start' ? 0 : kind === 'elite' ? 4 + depth : kind === 'shop' ? 1 : 2 + depth;

const resourceCount = (kind: string, depth: number): number => {
  // C1: resource loot exists only in resource / shop rooms.
  if (kind !== 'resource' && kind !== 'shop') return 0;
  return kind === 'shop' ? 3 : 2 + (depth % 3);
};

function main() {
const seeds: number[] = [];
for (let s = 1; s <= 220; s++) seeds.push(s * 7919 + 13);
const seenKinds = new Set<string>();

for (const seed of seeds) {
  const gen = new MapGenerator(seed);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const depth = new RoomDepth();
  depth.build(map);
  const state: SimulationState = createSimulationState({
    seed, map, playerData: { ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 0, weaponKey: 'pulse', weapons: [], upgrades: [], abilities: [] } as any,
    playerX: 0, playerY: 0
  });
  const ref = new RNG(seed * 7919 + 1);
  for (const room of map.rooms) {
    const d = depth.of(room.id);
    const enemies: string[] = [];
    const eCount = enemyCount(room.kind, d);
    const ePositions = [];
    for (let i = 0; i < eCount; i++) {
      enemies.push(pickEnemy(room.kind, room.id, d, ref));
      ePositions.push({ x: room.gx + 3 + (i % 3) * (room.w - 6) / 3, y: room.gy + 3 + Math.floor(i / 3) * (room.h - 6) });
    }
    const rCount = resourceCount(room.kind, d);
    const rKinds: string[] = [];
    const rPositions = [];
    for (let i = 0; i < rCount; i++) {
      rKinds.push(ref.int(0, 1) === 0 ? 'currency' : 'health');
      rPositions.push({ x: room.gx + 2 + (i + 1) * 2, y: room.gy + 2 + (i % 2) * 2 });
    }
    const neighbors = room.connectedTo.filter((n) => n !== room.id);
    const expectedPortal = neighbors.length > 0 ? ref.pick(neighbors) : null;

    enqueueCommand(state, {
      type: 'room-enter', roomId: room.id, roomKind: room.kind,
      gx: room.gx, gy: room.gy, w: room.w, h: room.h, depth: d,
      savedPortalTarget: null, neighbors, enemyCount: eCount, enemyPositions: ePositions,
      resourceCount: rCount, resourcePositions: rPositions, firstEnemyId: room.id * 1000 + 1
    });
    const events = stepSimulationTicks(state, 1, NEUTRAL);
    const gotKinds = events.filter((e) => e.type === 'enemy-spawned').map((e: any) => e.kind);
    for (const k of gotKinds) seenKinds.add(k);
    if (JSON.stringify(gotKinds) !== JSON.stringify(enemies)) {
      fail('enemy kinds mismatch', { seed, room: room.id, expected: enemies, got: gotKinds });
      return;
    }
    const gotLoot = events.filter((e) => e.type === 'loot-dropped').map((e: any) => e.loot.kind);
    if (JSON.stringify(gotLoot) !== JSON.stringify(rKinds)) {
      fail('resource kinds mismatch', { seed, room: room.id, expected: rKinds, got: gotLoot });
      return;
    }
    const generated = events.find((e: any) => e.type === 'room-generated') as any;
    if (!generated || generated.portalTarget !== expectedPortal) {
      fail('portal mismatch', { seed, room: room.id, expected: expectedPortal, got: generated?.portalTarget });
      return;
    }
    if (state.rngState !== ref.snapshot()) {
      fail('rng state mismatch', { seed, room: room.id, core: state.rngState, ref: ref.snapshot() });
      return;
    }
  }
}

const required = ['drone', 'stalker', 'hunter', 'sentinel'];
for (const k of required) {
  if (!seenKinds.has(k)) fail('missing enemy kind in distribution', { kind: k });
}
    console.log(`C1_ROOM_PARITY_${failures === 0 ? 'PASS' : 'FAIL'} seeds=${seeds.length} kinds=${[...seenKinds].sort().join(',')}`);
    if (failures > 0) process.exit(1);
}
main();

