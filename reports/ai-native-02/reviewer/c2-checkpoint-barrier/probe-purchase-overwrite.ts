// Independent probe: does `enqueueSetPlayerData` (full-object overwrite) lose
// queued reward/heal/xp, and is it re-validated / idempotent at commit?
// Uses the real economy buySupply (Phaser-free) against the authoritative core.
import { createSimulationState, enqueueCommand, stepSimulationTicks,
  type SimulationState, type SimulationIntent } from './src/world/sim/core';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { basePlayerData, type PlayerData } from './src/config/game';
import { buySupply, type Supply } from './src/economy/supplies';

const NEUTRAL: SimulationIntent = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

function makeState(currency = 100): SimulationState {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const pd: PlayerData = { ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency,
    weaponKey: 'pulse', weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: [] };
  const state = createSimulationState({ seed: 424242, map, playerData: pd, playerX: 5, playerY: 5 });
  return state;
}

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log('PASS', name);
  else { failures++; console.log('FAIL', name, JSON.stringify(detail)); }
}

// A synthetic but faithful supply: costs 10, grants a marker upgrade.
const supply: Supply = {
  name: 'Test supply', description: '', price: 10,
  apply: (p) => { p.upgrades.push({ key: 'test-marker' } as any); }
};

// --- Scenario A: reward enqueued BEFORE purchase set-player-data ---
{
  const state = makeState(100);
  const before = structuredClone(state.player.data);
  const purchased = buySupply(before, supply)!;
  check('A buySupply deducted price', purchased.currency === 90);

  // Economy enqueues room-clear reward first, then the purchase (as happens if the
  // dialog opens while a reward is still pending).
  enqueueCommand(state, { type: 'add-currency', amount: 20 });
  enqueueCommand(state, { type: 'set-player-data', data: purchased });
  stepSimulationTicks(state, 1, NEUTRAL);
  // Expected correct accounting: 100 - 10 + 20 = 110. Actual full overwrite: 90.
  check('A reward-before-purchase is preserved (expect 110)', state.player.data.currency === 110,
    { actual: state.player.data.currency });
  check('A purchase marker applied', state.player.data.upgrades.some((u) => u.key === 'test-marker'));
}

// --- Scenario B: purchase set-player-data BEFORE reward ---
{
  const state = makeState(100);
  const before = structuredClone(state.player.data);
  const purchased = buySupply(before, supply)!;
  enqueueCommand(state, { type: 'set-player-data', data: purchased });
  enqueueCommand(state, { type: 'add-currency', amount: 20 });
  stepSimulationTicks(state, 1, NEUTRAL);
  check('B purchase-before-reward keeps reward (expect 110)', state.player.data.currency === 110,
    { actual: state.player.data.currency });
}

// --- Scenario C: heal / xp enqueued BEFORE purchase are overwritten by stale snapshot ---
{
  const state = makeState(100);
  state.player.data.hp = 40;
  const before = structuredClone(state.player.data);
  const purchased = buySupply(before, supply)!; // hp stays 40 in snapshot
  enqueueCommand(state, { type: 'heal-player', amount: 25 }); // -> 65
  enqueueCommand(state, { type: 'add-xp', base: 20 });        // xp 20
  enqueueCommand(state, { type: 'set-player-data', data: purchased });
  stepSimulationTicks(state, 1, NEUTRAL);
  check('C heal-before-purchase is preserved (expect hp 65)', state.player.data.hp === 65,
    { actual: state.player.data.hp });
  check('C xp-before-purchase is preserved (expect xp 20)', state.player.data.xp === 20,
    { actual: state.player.data.xp });
}

// --- Scenario D: no re-validation at commit (balance check only at enqueue) ---
{
  const state = makeState(100);
  const before = structuredClone(state.player.data);
  const purchased = buySupply(before, supply)!; // currency 90
  // Simulate currency being spent/overwritten before the tick (e.g., another command).
  enqueueCommand(state, { type: 'set-player-data', data: { ...structuredClone(before), currency: 0 } });
  enqueueCommand(state, { type: 'set-player-data', data: purchased }); // still commits
  stepSimulationTicks(state, 1, NEUTRAL);
  check('D stale purchase not re-validated against balance (creates 90 from 0)',
    state.player.data.currency === 90, { actual: state.player.data.currency });
}

// --- Scenario E: UI double-click guard is not core idempotency ---
{
  const state = makeState(100);
  const before = structuredClone(state.player.data);
  const p1 = buySupply(before, supply)!;
  // Two purchases from the SAME stale snapshot (e.g., double click before UI disables).
  const p2 = buySupply(before, supply)!;
  enqueueCommand(state, { type: 'set-player-data', data: p1 });
  enqueueCommand(state, { type: 'set-player-data', data: p2 });
  stepSimulationTicks(state, 1, NEUTRAL);
  check('E two set-player-data from same snapshot pay once, keep only last (90)',
    state.player.data.currency === 90, { actual: state.player.data.currency });
  check('E only one marker (second overwrote first)',
    state.player.data.upgrades.filter((u) => u.key === 'test-marker').length === 1,
    { upgrades: state.player.data.upgrades });
}

console.log(`PURCHASE_OVERWRITE_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
