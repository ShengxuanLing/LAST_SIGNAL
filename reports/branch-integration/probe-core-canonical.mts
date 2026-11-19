import { basePlayerData } from '../../src/config/game';
import { ENEMY_STATS } from '../../src/config/enemies';
import { MapGenerator, assignRoles, guaranteeReachable } from '../../src/world/MapGenerator';
import { canonicalSimulationEvents, canonicalSimulationState, createSimulationState, isWalkableFromState, registerDrone, stepSimulationTicks, type SimulationIntent } from '../../src/world/sim/core';

const gen = new MapGenerator(424242);
const map = gen.generate();
assignRoles(gen, map.rooms, map.roomsOrder);
guaranteeReachable(map);
const base = basePlayerData();
const playerData: any = { ...base, level: 1, xp: 0, xpToNext: 30, currency: 0, weaponKey: 'pulse', weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }], upgrades: [], abilities: [] };
const state = createSimulationState({ seed: 424242, map, playerData, playerX: 0, playerY: 0 });
let player: any = null, dronePos: any = null;
for (const row of map.tiles) for (const tile of row) {
  if (tile.type !== 'floor' && tile.type !== 'spawn') continue;
  if (!isWalkableFromState(state, tile.x, tile.y, 0.5)) continue;
  if (!player) player = { x: tile.x, y: tile.y };
  else if (!dronePos && Math.hypot(tile.x - player.x, tile.y - player.y) > 0) dronePos = { x: tile.x, y: tile.y };
}
const d = ENEMY_STATS.drone;
const drone = registerDrone(state, {
  id: 1, x: dronePos.x, y: dronePos.y, hp: d.maxHp,
  data: { kind: 'drone', stats: { ...d, speed: d.speed / 64, aggroRange: d.aggroRange / 64, attackRange: d.attackRange / 64 }, state: 'idle', stateTimer: 1000, targetId: null, patrolPoints: [], patrolIndex: 0, hitFlash: 0, stunTimer: 0, spawnRoom: 0 },
  attackTimer: 0, wanderTimer: 0
});
state.player.x = player.x; state.player.y = player.y;
const neutral = (move: any = { x: 0, y: 0 }, fire = false, aim: any = null): SimulationIntent => ({ move, dash: false, fire, aim, interact: false });
const events = stepSimulationTicks(state, 40, neutral({ x: 0, y: 0 }, true, { x: drone.x, y: drone.y }));
const canonical = canonicalSimulationState(state);
console.log('has mapHash', canonical.includes('"mapHash"'));
console.log('has targets', canonical.includes('"targets"'));
console.log('has pendingPlayerHits', canonical.includes('"pendingPlayerHits"'));
console.log('has nextProjectileId', canonical.includes('"nextProjectileId"'));
console.log('has weaponKey', canonical.includes('"weaponKey"'));
const parsed = JSON.parse(canonical);
console.log('nextProjectileId', parsed.nextProjectileId, Number.isInteger(parsed.nextProjectileId));
console.log('mapHash type', typeof parsed.mapHash);
console.log('targets array', Array.isArray(parsed.targets));
const ce = canonicalSimulationEvents(events);
console.log('faceAngle in events', ce.includes('faceAngle'));
const evt = JSON.parse(ce);
const hasFloat = evt.some((e: any) => (e.position && !Number.isInteger(e.position.x)) || (e.projectile && !Number.isInteger(e.projectile.pos.x)));
console.log('hasFloat', hasFloat, 'events', evt.length);
