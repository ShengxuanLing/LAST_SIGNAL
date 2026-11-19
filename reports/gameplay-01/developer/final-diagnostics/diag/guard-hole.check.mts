// GAMEPLAY-01 — deterministic counterexample for the "HP equal ⇒ player did not move"
// assumption used by tests/ai-native-world.spec.ts around the manual-disable window.
//
// It uses the REAL core only (no Phaser, no rewrite of the rule): a player under a
// NEUTRAL intent is hit once (real knockback from resolvePlayerHit, the same rule the
// drone path uses), then the real `heal-player` core command restores the HP. The two
// "samples" therefore have EQUAL HP while the position moved by the knockback.
//
// Run: npx vite-node <this file>

import {
  createSimulationState, enqueueCommand, enqueuePlayerHit, isWalkableFromState,
  stepSimulationTicks, type SimulationState
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

// Place the player on the CENTRE-most walkable cell of the start room, so a hit
// from any direction has room to knock the player back.
const start = map.rooms.find((r) => r.kind === 'start') ?? map.rooms[0];
const cx = start.gx + start.w / 2, cy = start.gy + start.h / 2;
let spot: { x: number; y: number } | null = null;
let bestD = Infinity;
for (let y = start.gy; y < start.gy + start.h; y += 1) {
  for (let x = start.gx; x < start.gx + start.w; x += 1) {
    const c = { x: x + 0.5, y: y + 0.5 };
    if (!isWalkableFromState(sim, c.x, c.y, 0.5)) continue;
    const d = (c.x - cx) ** 2 + (c.y - cy) ** 2;
    if (d < bestD) { bestD = d; spot = c; }
  }
}
if (!spot) throw new Error('no walkable start cell');
sim.player.x = spot.x;
sim.player.y = spot.y;

const neutralIntent = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

// Sample 1 (the test's `stationaryStart`).
const sample1 = { hp: sim.player.data.hp, x: sim.player.x, y: sim.player.y };

// A drone shot lands: real hit rule (damage + knockback), then a REAL heal command
// (what a health pickup / the harness top-up does) restores the HP before sample 2.
// Pick a hit direction whose knockback target is walkable (the rule only moves
// on a walkable axis), exactly like a shot from a real adjacent drone.
const dirs = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }
];
const kb = 24 / 64;
const usable = dirs.find((d) => {
  const nx = sim.player.x + d.x * kb;
  const ny = sim.player.y + d.y * kb;
  return isWalkableFromState(sim, nx, sim.player.y, 0.5) || isWalkableFromState(sim, sim.player.x, ny, 0.5);
});
if (!usable) throw new Error('no usable knockback direction');
enqueuePlayerHit(sim, 6, sim.player.x - usable.x, sim.player.y - usable.y);
stepSimulationTicks(sim, 1, neutralIntent);
const afterHit = { hp: sim.player.data.hp, x: sim.player.x, y: sim.player.y };
enqueueCommand(sim, { type: 'heal-player', amount: 6 });
stepSimulationTicks(sim, 1, neutralIntent);

// Sample 2 (the test's `stationary`).
const sample2 = { hp: sim.player.data.hp, x: sim.player.x, y: sim.player.y };

const moved = Math.hypot(sample2.x - sample1.x, sample2.y - sample1.y);
const result = {
  rule: 'resolvePlayerHit knockback (24 px / PIXEL_TO_TILE 64 = 0.375 tiles), real heal-player command',
  moveIntent: neutralIntent.move,
  keysHeld: 'none (neutral intent only)',
  sample1, sample2, afterHit,
  hpEqual: sample1.hp === sample2.hp,
  movedDistanceTiles: moved,
  guardWouldSkip: sample1.hp !== sample2.hp,
  verdict: sample1.hp === sample2.hp && moved > 0.1
    ? 'COUNTEREXAMPLE: equal HP at both samples while the player was knocked back'
    : 'unexpected'
};
console.log(JSON.stringify(result, null, 2));
if (!(result.hpEqual && moved > 0.1)) process.exitCode = 1;
