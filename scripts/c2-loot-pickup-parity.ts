// AI-NATIVE-02 C2 final seam — loot magnet/pickup parity (Node, self-contained).
//
// Verifies the corrected C1-loot semantics in core.stepLoot:
//   - `pickupRange` is configured in PIXELS and converted to grid tiles with
//     GAME.PIXEL_TO_TILE before the magnet comparison (positions are tiles);
//   - base pickupRange 90 => 1.4-tile magnet, so far loot at 20/40/85 tiles is
//     NOT dragged or collected during normal running (120+ ticks);
//   - collection happens within PLAYER_RADIUS + 12 tiles (C1);
//   - a larger pickupRange (upgrade) reaches and collects far loot;
//   - health loot heals when collected.
// Cross-checked against the rendered Playwright fixture in tests/c2-parity.spec.ts.
import { createSimulationState, enqueueCommand, enqueueSpawnLoot, stepSimulationTicks,
  type SimulationState, type SimulationIntent } from '../src/world/sim/core';
import { MapGenerator, assignRoles, guaranteeReachable } from '../src/world/MapGenerator';
import { basePlayerData, GAME } from '../src/config/game';
import type { PlayerData } from '../src/types';

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

// 1) Far loot at 20/40/85 tiles stays on the ground during normal running.
for (const offset of [20, 40, 85]) {
  const state = makeState();
  const px = state.player.x, py = state.player.y;
  enqueueSpawnLoot(state, px + offset, py, 'currency', 'currency', 10);
  stepSimulationTicks(state, 1, NEUTRAL);
  check(`far-${offset}-present-at-drop`, state.loot.length === 1);
  const currencyAtDrop = state.player.data.currency;
  stepSimulationTicks(state, 120, NEUTRAL);
  check(`far-${offset}-still-present-after-120-ticks`, state.loot.length === 1);
  check(`far-${offset}-currency-unchanged`, state.player.data.currency === currencyAtDrop);
}

// 2) Near loot (1 tile) collected on the next tick.
{
  const state = makeState();
  const px = state.player.x, py = state.player.y;
  enqueueSpawnLoot(state, px + 1, py, 'currency', 'currency', 7);
  stepSimulationTicks(state, 5, NEUTRAL);
  check('near-loot-collected', state.loot.length === 0 && state.player.data.currency === 7);
}

// 3) Diagonal ~19.8 tiles stays put.
{
  const state = makeState();
  const px = state.player.x, py = state.player.y;
  enqueueSpawnLoot(state, px + 14, py + 14, 'currency', 'currency', 5);
  stepSimulationTicks(state, 1, NEUTRAL);
  check('diagonal-loot-still-present', state.loot.length === 1 && state.player.data.currency === 0);
  stepSimulationTicks(state, 120, NEUTRAL);
  check('diagonal-loot-not-collected', state.loot.length === 1 && state.player.data.currency === 0);
}

// 4) Pickup-range upgrade direction, in pixels.
{
  const state = makeState();
  const px = state.player.x, py = state.player.y;
  const data = JSON.parse(JSON.stringify(state.player.data));
  data.pickupRange = 2;
  enqueueCommand(state, { type: 'set-player-data', data });
  stepSimulationTicks(state, 1, NEUTRAL);
  enqueueSpawnLoot(state, px + 20, py, 'currency', 'currency', 5);
  stepSimulationTicks(state, 31, NEUTRAL);
  check('small-pickup-range-no-collect', state.loot.length === 1 && state.player.data.currency === 0);

  const state2 = makeState();
  const px2 = state2.player.x, py2 = state2.player.y;
  const data2 = JSON.parse(JSON.stringify(state2.player.data));
  data2.pickupRange = 40 * GAME.PIXEL_TO_TILE;
  enqueueCommand(state2, { type: 'set-player-data', data: data2 });
  stepSimulationTicks(state2, 1, NEUTRAL);
  enqueueSpawnLoot(state2, px2 + 30, py2, 'currency', 'currency', 5);
  let largeCollected = false;
  for (let i = 0; i < 300; i++) { stepSimulationTicks(state2, 1, NEUTRAL); if (state2.loot.length === 0) { largeCollected = true; break; } }
  check('large-pickup-range-collects-far-loot', largeCollected && state2.player.data.currency === 5);
}

// 5) Health loot heals on pickup.
{
  const state = makeState();
  const px = state.player.x, py = state.player.y;
  state.player.data.hp = 40;
  enqueueSpawnLoot(state, px + 1, py, 'health', 'health', 30);
  stepSimulationTicks(state, 5, NEUTRAL);
  check('health-loot-heals-on-pickup', state.loot.length === 0 && state.player.data.hp === 70);
}

console.log(`LOOT_PICKUP_PARITY_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
