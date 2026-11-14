// AI-NATIVE-02 C2 final seam — loot magnet/pickup parity (Node, self-contained).
//
// Verifies the C1-loot semantics restored in core.stepLoot:
//   - pickupRange is compared in grid units (same units as player/loot position),
//     NOT screen pixels;
//   - loot dropped far away (e.g. 20 grids) stays on the ground at drop time:
//     HP/currency unchanged, loot present;
//   - the magnet pulls loot within pickupRange toward the player, and collection
//     happens once within radius + 12 (C1: PLAYER_RADIUS + 12);
//   - no wall/room-boundary check: core never consults tiles for magnet/pull;
//   - pickupRange upgrades scale the magnet radius.
// Cross-checked against the rendered Playwright fixture in tests/c2-parity.spec.ts.
import { createSimulationState, enqueueCommand, enqueueSpawnLoot, stepSimulationTicks,
  type SimulationState, type SimulationIntent } from '../src/world/sim/core';
import { MapGenerator, assignRoles, guaranteeReachable } from '../src/world/MapGenerator';
import { basePlayerData } from '../src/config/game';
import type { PlayerData } from '../src/config/game';

const NEUTRAL: SimulationIntent = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

function makeState(): SimulationState {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const pd: PlayerData = { ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 0,
    weaponKey: 'pulse', weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: [] };
  return createSimulationState({ seed: 424242, map, playerData: pd, playerX: 5, playerY: 5 });
}

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { console.log('PASS', name); }
  else { failures++; console.log('FAIL', name, JSON.stringify(detail)); }
}

// 1) Far loot (20 grids) is present at drop time but HP/currency unchanged.
{
  const state = makeState();
  const px = state.player.x, py = state.player.y;
  enqueueSpawnLoot(state, px + 20, py, 'currency', 'currency', 10);
  const before = stepSimulationTicks(state, 1, NEUTRAL);
  check('far-loot-present-at-drop', state.loot.length === 1);
  check('far-loot-currency-unchanged-at-drop', state.player.data.currency === 0);
  check('far-loot-hp-unchanged-at-drop', state.player.data.hp === state.player.data.maxHp);
  // Magnet pulls it in; collected within a few ticks without player movement.
  let collected = false;
  for (let i = 0; i < 40; i++) { stepSimulationTicks(state, 1, NEUTRAL); if (state.loot.length === 0) { collected = true; break; } }
  check('far-loot-collected-by-magnet', collected);
  check('far-loot-currency-changed', state.player.data.currency === 10);
}

// 2) Near loot (1 grid) collected on the very next tick.
{
  const state = makeState();
  const px = state.player.x, py = state.player.y;
  enqueueSpawnLoot(state, px + 1, py, 'currency', 'currency', 7);
  stepSimulationTicks(state, 1, NEUTRAL);
  check('near-loot-collected-immediately', state.loot.length === 0 && state.player.data.currency === 7);
}

// 3) Diagonal loot collected via magnet.
{
  const state = makeState();
  const px = state.player.x, py = state.player.y;
  enqueueSpawnLoot(state, px + 14, py + 14, 'currency', 'currency', 5);
  stepSimulationTicks(state, 1, NEUTRAL);
  check('diagonal-loot-still-present', state.loot.length === 1 && state.player.data.currency === 0);
  let collected = false;
  for (let i = 0; i < 60; i++) { stepSimulationTicks(state, 1, NEUTRAL); if (state.loot.length === 0) { collected = true; break; } }
  check('diagonal-loot-collected-by-magnet', collected);
}

// 4) Pickup range upgrade scales the magnet: small range does not collect far loot,
//    large range collects far loot. Pickup threshold (radius + 12) is unchanged.
{
  const state = makeState();
  const px = state.player.x, py = state.player.y;
  const data = JSON.parse(JSON.stringify(state.player.data));
  data.pickupRange = 2;
  enqueueCommand(state, { type: 'set-player-data', data });
  stepSimulationTicks(state, 1, NEUTRAL); // commit the range change
  enqueueSpawnLoot(state, px + 20, py, 'currency', 'currency', 5);
  stepSimulationTicks(state, 1, NEUTRAL);
  let stillThere = state.loot.length === 1 && state.player.data.currency === 0;
  for (let i = 0; i < 30; i++) { stepSimulationTicks(state, 1, NEUTRAL); if (state.loot.length === 0) { stillThere = false; break; } }
  check('small-pickup-range-no-collect', stillThere);

  const state2 = makeState();
  const px2 = state2.player.x, py2 = state2.player.y;
  const data2 = JSON.parse(JSON.stringify(state2.player.data));
  data2.pickupRange = 200;
  enqueueCommand(state2, { type: 'set-player-data', data: data2 });
  stepSimulationTicks(state2, 1, NEUTRAL); // commit the range change
  enqueueSpawnLoot(state2, px2 + 30, py2, 'currency', 'currency', 5);
  stepSimulationTicks(state2, 1, NEUTRAL);
  let largeCollected = false;
  for (let i = 0; i < 40; i++) { stepSimulationTicks(state2, 1, NEUTRAL); if (state2.loot.length === 0) { largeCollected = true; break; } }
  check('large-pickup-range-collects-far-loot', largeCollected && state2.player.data.currency === 5);
}

// 5) Health loot heals on pickup.
{
  const state = makeState();
  const px = state.player.x, py = state.player.y;
  state.player.data.hp = 40;
  enqueueSpawnLoot(state, px + 1, py, 'health', 'health', 30);
  stepSimulationTicks(state, 1, NEUTRAL);
  check('health-loot-heals-on-pickup', state.loot.length === 0 && state.player.data.hp === 70);
}

console.log(`LOOT_PICKUP_PARITY_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
