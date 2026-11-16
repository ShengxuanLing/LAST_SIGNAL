// Independent probe for the corrected C2 purchase ledger contract.
// Rewritten from the Reviewer 3f97990/59aa852 probe (reports/.../reviewer/c2-purchase-final)
// to assert the NEW contract: hard quota (no eviction), ledger in canonical and
// checkpoint, deterministic replay, bounded receipts.
import {
  canonicalSimulationState, createSimulationState, enqueueCommand, stepSimulationTicks,
  type SimulationState, type SimulationIntent
} from '../../../src/world/sim/core';
import { MapGenerator, assignRoles, guaranteeReachable } from '../../../src/world/MapGenerator';
import { terminalRooms, supplyPrice, PURCHASE_LEDGER_CAP } from '../../../src/config/supplies';
import { basePlayerData, type PlayerData } from '../../../src/config/game';
import { validateCheckpoint } from '../../../src/systems/RunCheckpoint';

const NEUTRAL: SimulationIntent = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

function makeState(opts: { currency?: number; hp?: number } = {}): SimulationState {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const pd: PlayerData = {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: opts.currency ?? 200,
    hp: opts.hp ?? 40, weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  };
  const state = createSimulationState({ seed: 424242, map, playerData: pd, playerX: 5, playerY: 5 });
  const terminals = terminalRooms(map.rooms);
  const room = map.rooms.find((r) => terminals.has(r.id))!;
  state.player.x = room.gx + room.w / 2;
  state.player.y = room.gy + room.h / 2;
  for (const r of map.rooms) { r.cleared = true; r.spawned = true; }
  state.drones = [];
  state.targets = [];
  return state;
}
function findRoom(state: SimulationState) {
  const terminals = terminalRooms(state.map.rooms);
  return state.map.rooms.find((r) => terminals.has(r.id))!;
}
function result(events: ReturnType<typeof stepSimulationTicks>) {
  return events.find((e: any) => e.type === 'supply-purchase-result') as any;
}

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log('PASS', name);
  else { failures++; console.log('FAIL', name, JSON.stringify(detail)); }
}

// 1) Delta purchase preserves queued reward + heal + xp.
{
  const state = makeState({ currency: 100, hp: 40 });
  const room = findRoom(state);
  const price = supplyPrice('repair');
  state.player.data.xp = 0;
  enqueueCommand(state, { type: 'add-currency', amount: 20 });
  enqueueCommand(state, { type: 'heal-player', amount: 10 });
  enqueueCommand(state, { type: 'add-xp', base: 20 });
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-A', offerKey: 'repair', roomId: room.id });
  const ev = stepSimulationTicks(state, 1, NEUTRAL);
  check('reward+heal+xp+buy currency', state.player.data.currency === 100 + 20 - price, { actual: state.player.data.currency });
  check('reward+heal+xp+buy hp', state.player.data.hp === 85, { actual: state.player.data.hp });
  check('reward+heal+xp+buy xp', state.player.data.xp === 20, { actual: state.player.data.xp });
  check('reward+heal+xp+buy receipt ok', result(ev)?.ok === true);
}

// 2) Duplicate id rejected, not re-executed.
{
  const state = makeState();
  const room = findRoom(state);
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-dup', offerKey: 'repair', roomId: room.id });
  stepSimulationTicks(state, 1, NEUTRAL);
  const after1 = state.player.data.currency;
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-dup', offerKey: 'repair', roomId: room.id });
  const ev2 = stepSimulationTicks(state, 1, NEUTRAL);
  check('duplicate rejected', result(ev2)?.ok === false && /Duplicate/.test(result(ev2)?.reason ?? ''));
  check('duplicate not re-executed', state.player.data.currency === after1);
}

// 3) Hard quota: at cap new tx rejected, no eviction, oldest still rejected.
{
  const state = makeState();
  const room = findRoom(state);
  state.purchaseTransactions = Array.from({ length: PURCHASE_LEDGER_CAP }, (_, i) => `old-${i}`);
  const before = state.player.data.currency;
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'fresh-1', offerKey: 'repair', roomId: room.id });
  const evB = stepSimulationTicks(state, 1, NEUTRAL);
  check('cap: new tx rejected', result(evB)?.ok === false && /ledger full/.test(result(evB)?.reason ?? ''));
  check('cap: ledger size unchanged', state.purchaseTransactions.length === PURCHASE_LEDGER_CAP);
  check('cap: no deduction', state.player.data.currency === before);
  check('cap: oldest not evicted', state.purchaseTransactions.includes('old-0'));
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'old-0', offerKey: 'repair', roomId: room.id });
  const evC = stepSimulationTicks(state, 1, NEUTRAL);
  check('cap: oldest still duplicate (no replay)', /Duplicate/.test(result(evC)?.reason ?? ''));
  check('cap: oldest still no deduction', state.player.data.currency === before);
}

// 4) Ledger is canonical.
{
  const a = makeState();
  const b = makeState();
  a.purchaseTransactions = ['tx-x'];
  b.purchaseTransactions = ['tx-x'];
  check('canonical: same ledger => equal', canonicalSimulationState(a) === canonicalSimulationState(b));
  b.purchaseTransactions = ['tx-y'];
  check('canonical: different ledger => different', canonicalSimulationState(a) !== canonicalSimulationState(b));
}

// 5) Restore/clone keeps processed ids; retry no double deduction.
{
  const state = makeState({ currency: 100 });
  const room = findRoom(state);
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-ok', offerKey: 'repair', roomId: room.id });
  stepSimulationTicks(state, 1, NEUTRAL);
  const saved = state.player.data.currency;
  const restored = JSON.parse(JSON.stringify(state)) as SimulationState;
  enqueueCommand(restored, { type: 'purchase-supply', transactionId: 'tx-ok', offerKey: 'repair', roomId: room.id });
  const ev = stepSimulationTicks(restored, 1, NEUTRAL);
  check('restore: processed id retained', restored.purchaseTransactions.includes('tx-ok'));
  check('restore: retry duplicate rejected', /Duplicate/.test(result(ev)?.reason ?? ''));
  check('restore: retry no deduct', restored.player.data.currency === saved);
}

// 6) Checkpoint validation: old/valid accepted; tampered/oversized rejected.
function cp(ledger?: string[]) {
  const player: PlayerData = { ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 10, hp: 50,
    weaponKey: 'pulse', weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: [] };
  return {
    id: 'r', seed: 1, stats: { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 }, roomId: 0,
    position: { x: 5, y: 5 }, clearedRooms: [0], portalTarget: null, rngState: 1, player, loot: [],
    coreState: { tick: 1, rngState: 1, playerTimers: { dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0, aimYaw: 0 },
      nextProjectileId: 1, ...(ledger === undefined ? {} : { purchaseTransactions: ledger }) }
  } as any;
}
check('checkpoint: old (no ledger) accepted', validateCheckpoint(cp(undefined)) === true);
check('checkpoint: valid ledger accepted', validateCheckpoint(cp(['a', 'b'])) === true);
check('checkpoint: oversized rejected', validateCheckpoint(cp(Array.from({ length: PURCHASE_LEDGER_CAP + 1 }, (_, i) => `t${i}`))) === false);
check('checkpoint: duplicate rejected', validateCheckpoint(cp(['d', 'd'])) === false);
check('checkpoint: non-string rejected', validateCheckpoint(cp(['ok', 5 as any])) === false);

// 7) Commit-time live validation and stable id conflict.
{
  const state = makeState({ currency: 5 });
  const room = findRoom(state);
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-poor', offerKey: 'weapon', roomId: room.id });
  const ev = stepSimulationTicks(state, 1, NEUTRAL);
  check('insufficient rejected', result(ev)?.reason === 'Not enough credits');
  state.player.data.currency = 500;
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-poor', offerKey: 'repair', roomId: room.id });
  const ev2 = stepSimulationTicks(state, 1, NEUTRAL);
  check('id conflict stable duplicate', result(ev2)?.reason === 'Duplicate transaction');
  check('id conflict no change', state.player.data.currency === 500);

  const state2 = makeState();
  const room2 = findRoom(state2);
  state2.player.x = 0; state2.player.y = 0; // outside the terminal room
  enqueueCommand(state2, { type: 'purchase-supply', transactionId: 'tx-out', offerKey: 'repair', roomId: room2.id });
  const ev3 = stepSimulationTicks(state2, 1, NEUTRAL);
  check('not in terminal rejected', /Not in this terminal|Not a supply terminal/.test(result(ev3)?.reason ?? ''));
}

console.log(`PURCHASE_LEDGER_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
