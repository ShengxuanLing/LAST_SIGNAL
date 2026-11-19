// Independent seam probe: prove that committing a room-enter command via the
// throwaway `new RNG(0)` path (World.processPendingCommands) diverges from the
// canonical core RNG used by stepSimulationTicks. Run with vite-node from the
// frozen snapshot root so `./src` imports resolve.
import { createSimulationState, enqueueCommand, processCommands, stepSimulationTicks,
  type SimulationState, type SimulationIntent } from './src/world/sim/core';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { RoomDepth } from './src/world/roomdepth';
import { RNG } from './src/core/random';
import { basePlayerData, type PlayerData } from './src/config/game';

const NEUTRAL: SimulationIntent = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

function makeState(seed: number): { state: SimulationState; room: any; neighbors: number[] } {
  const gen = new MapGenerator(seed);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const depth = new RoomDepth(); depth.build(map);
  const pd: PlayerData = { ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 0,
    weaponKey: 'pulse', weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: [] };
  const state = createSimulationState({ seed, map, playerData: pd, playerX: 5, playerY: 5 });
  const room = map.rooms.find((r: any) => r.kind !== 'start' && r.connectedTo.filter((n: number) => n !== r.id).length > 1)!;
  const neighbors = room.connectedTo.filter((n: number) => n !== room.id);
  return { state, room, neighbors };
}

function roomEnterCmd(room: any, depth: number) {
  const eCount = room.kind === 'elite' ? 4 + depth : room.kind === 'shop' ? 1 : 2 + depth;
  const rCount = room.kind === 'shop' ? 3 : 2 + (depth % 3);
  const ePos = []; for (let i = 0; i < eCount; i++) ePos.push({ x: room.gx + 3 + (i % 3) * (room.w - 6) / 3, y: room.gy + 3 + Math.floor(i / 3) * (room.h - 6) });
  const rPos = []; for (let i = 0; i < rCount; i++) rPos.push({ x: room.gx + 2 + (i + 1) * 2, y: room.gy + 2 + (i % 2) * 2 });
  return { type: 'room-enter', roomId: room.id, roomKind: room.kind, gx: room.gx, gy: room.gy, w: room.w, h: room.h, depth,
    savedPortalTarget: null, neighbors: room.connectedTo.filter((n: number) => n !== room.id), enemyCount: eCount,
    enemyPositions: ePos, resourceCount: rCount, resourcePositions: rPos, firstEnemyId: 1 };
}

// Path A: canonical — committed by the tick (core RNG restored from rngState).
const a = makeState(424242);
const da = new RoomDepth(); da.build(a.state.map);
enqueueCommand(a.state, roomEnterCmd(a.room, da.of(a.room.id)));
const evA = stepSimulationTicks(a.state, 1, NEUTRAL);
const portalA = (evA.find((e: any) => e.type === 'room-generated') as any)?.portalTarget;
const resA = evA.filter((e: any) => e.type === 'loot-dropped').map((e: any) => e.loot.kind);
const rngA = a.state.rngState;

// Path B: the World.processPendingCommands path — processCommands(state, events, new RNG(0)).
const b = makeState(424242);
const db = new RoomDepth(); db.build(b.state.map);
enqueueCommand(b.state, roomEnterCmd(b.room, db.of(b.room.id)));
const evB: any[] = [];
processCommands(b.state, evB, new RNG(0));
const portalB = evB.find((e: any) => e.type === 'room-generated')?.portalTarget;
const resB = b.state.loot.map((l: any) => l.kind);
const rngB = b.state.rngState; // processCommands(new RNG(0)) does NOT persist rngState

console.log(JSON.stringify({
  neighbors: a.neighbors,
  portalA, portalB, resA, resB, rngA, rngB,
  portalDiverges: portalA !== portalB,
  resourceDiverges: JSON.stringify(resA) !== JSON.stringify(resB),
  rngStateUntouchedByThrowawayPath: rngA !== rngB
}, null, 2));
