// GAMEPLAY-01 — deterministic core counterexample for the "count every projectile
// created in this step == the boss volley" assumption used by tests/audit.spec.ts
// around the P2 boss-bullets block.
//
// Real core only: the 15 boss commands + ONE already-pending command from a
// DIFFERENT owner (a legacy enemy shot queued on the previous frame) commit in the
// same tick. The step therefore reports 16 `projectile-spawned` events while the
// boss itself contributed exactly 15 — the same shape as the run9 red (16 vs 15).
//
// Run: npx vite-node <this file>

import {
  createSimulationState, enqueueCommand, stepSimulationTicks, isWalkableFromState,
  type SimulationState
} from '../../../../../src/world/sim/core';
import { generateRealMap } from '../../../../../src/ai-native/worldHeadless';
import { basePlayerData } from '../../../../../src/config/game';
import type { PlayerData } from '../../../../../src/types';

function fullPlayerData(): PlayerData {
  return {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as PlayerData;
}

const map = generateRealMap(424242);
const sim: SimulationState = createSimulationState({
  seed: 424242, map, playerData: fullPlayerData(), playerX: 0, playerY: 0
});

const start = map.rooms.find((r) => r.kind === 'start') ?? map.rooms[0];
let spot: { x: number; y: number } | null = null;
for (let y = start.gy; y < start.gy + start.h && !spot; y += 1) {
  for (let x = start.gx; x < start.gx + start.w && !spot; x += 1) {
    const c = { x: x + 0.5, y: y + 0.5 };
    if (isWalkableFromState(sim, c.x, c.y, 0.5)) spot = c;
  }
}
if (!spot) throw new Error('no walkable start cell');
sim.player.x = spot.x;
sim.player.y = spot.y;

const BOSS_ID = 4;
const ENEMY_ID = 1;
const bossAt = { x: spot.x + 3, y: spot.y };
const enemyAt = { x: spot.x, y: spot.y + 3 };

// ONE already-pending shot from a different owner (queued on the previous frame).
enqueueCommand(sim, {
  type: 'spawn-enemy-projectile', ownerId: ENEMY_ID,
  x: enemyAt.x, y: enemyAt.y, damage: 8, vel: { x: 2.5, y: 0 }
});
const pendingBefore = sim.pendingCommands.length;

// The 15 explicit volley commands (3 laser at 2.5 + 12 shockwave at 1.875).
for (let i = -1; i <= 1; i += 1) {
  enqueueCommand(sim, {
    type: 'spawn-enemy-projectile', ownerId: BOSS_ID,
    x: bossAt.x, y: bossAt.y, damage: 8,
    vel: { x: Math.cos(i * 0.25) * 2.5, y: Math.sin(i * 0.25) * 2.5 }
  });
}
for (let i = 0; i < 12; i += 1) {
  const a = (i / 12) * Math.PI * 2;
  enqueueCommand(sim, {
    type: 'spawn-enemy-projectile', ownerId: BOSS_ID,
    x: bossAt.x, y: bossAt.y, damage: 8,
    vel: { x: Math.cos(a) * 1.875, y: Math.sin(a) * 1.875 }, lifetime: 3
  });
}

const events = stepSimulationTicks(sim, 1, {
  move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false
});
const spawned = events.filter((e) => e.type === 'projectile-spawned') as Array<any>;
const byOwner: Record<string, number> = {};
for (const e of spawned) byOwner[e.projectile.ownerId] = (byOwner[e.projectile.ownerId] ?? 0) + 1;

const result = {
  rule: 'enqueueCommand(spawn-enemy-projectile) x16 from two owners + one real core tick',
  pendingBeforeTick: pendingBefore,
  spawnedEvents: spawned.length,
  byOwner,
  bossEvents: byOwner[BOSS_ID] ?? 0,
  otherOwnerEvents: spawned.length - (byOwner[BOSS_ID] ?? 0),
  coreProjectiles: sim.projectiles.length,
  verdict: spawned.length === 16 && (byOwner[BOSS_ID] ?? 0) === 15
    ? 'COUNTEREXAMPLE: 16 spawn events while the boss itself contributed exactly 15'
    : 'unexpected'
};
console.log(JSON.stringify(result, null, 2));
if (!(result.spawnedEvents === 16 && result.bossEvents === 15)) process.exitCode = 1;
