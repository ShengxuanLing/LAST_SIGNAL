// Headless probe: command-queue -> commit boundary (core only, no Phaser).
// Confirms enqueued commands do NOT mutate canonical state until a tick runs
// processCommands, and that a tick commits exactly once with a stable RNG.
// This underlies why World.captureCheckpoint (which excludes pendingCommands)
// must not be called while commands are pending.
import { createSimulationState, enqueueCommand, enqueueSpawnLoot, stepSimulationTicks,
  type SimulationState, type SimulationIntent } from './src/world/sim/core';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { basePlayerData, type PlayerData } from './src/config/game';

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

const state = makeState();
const currencyBefore = state.player.data.currency;
const tickBefore = state.tick;
const rngBefore = state.rngState;
const lootBefore = state.loot.length;

// Enqueue a currency reward (simulates economy.enqueueCurrency).
enqueueSpawnLoot(state, state.player.x + 1, state.player.y, 'currency', 'currency', 7);
check('pendingCommands non-empty after enqueue', state.pendingCommands.length === 1);

// Zero-tick: canonical state MUST NOT change; no events; pendingCommands retained.
const ev0 = stepSimulationTicks(state, 0, NEUTRAL);
check('zero-dt currency unchanged', state.player.data.currency === currencyBefore);
check('zero-dt tick unchanged', state.tick === tickBefore);
check('zero-dt rngState unchanged', state.rngState === rngBefore);
check('zero-dt loot unchanged', state.loot.length === lootBefore);
check('zero-dt no currency-gained event', !ev0.some((e: any) => e.type === 'currency-gained'));
check('zero-dt pendingCommands retained', state.pendingCommands.length === 1);

// One tick: commits exactly once, emits currency-gained, advances tick.
const ev1 = stepSimulationTicks(state, 1, NEUTRAL);
check('one-tick currency committed once', state.player.data.currency === currencyBefore + 7);
check('one-tick tick advanced', state.tick === tickBefore + 1);
check('one-tick loot collected', state.loot.length === 0);
check('one-tick currency-gained event', ev1.some((e: any) => e.type === 'currency-gained'));
check('one-tick pendingCommands drained', state.pendingCommands.length === 0);

// Second tick with no new commands: no double commit, no new events.
const ev2 = stepSimulationTicks(state, 1, NEUTRAL);
check('second-tick no double commit', state.player.data.currency === currencyBefore + 7);
check('second-tick no new currency-gained event', !ev2.some((e: any) => e.type === 'currency-gained'));

// RNG is a single continuous stream: snapshot after commit is stable across idle ticks.
const rngAfter1 = state.rngState;
const ev3 = stepSimulationTicks(state, 1, NEUTRAL);
check('rngState stable across idle ticks', state.rngState === rngAfter1);

console.log(`COMMIT_BOUNDARY_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
