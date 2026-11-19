// Independent probe: restore / replay boundary for the purchase ledger.
// Question: after restoring a checkpoint (which resets purchaseTransactions),
// can the same offer be bought again, and is the "Already owned" guard the
// only thing preventing a duplicate weapon purchase?
import { createSimulationState, enqueueCommand, stepSimulationTicks,
  type SimulationState, type SimulationIntent } from './src/world/sim/core';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { terminalRooms, supplyPrice, loanWeaponFor } from './src/config/supplies';
import { basePlayerData, type PlayerData } from './src/config/game';

const NEUTRAL: SimulationIntent = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

function makeState(currency = 200): SimulationState {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const pd: PlayerData = { ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency,
    hp: 40, weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: [] };
  const state = createSimulationState({ seed: 424242, map, playerData: pd, playerX: 5, playerY: 5 });
  const terminals = terminalRooms(map.rooms);
  const room = map.rooms.find((r) => terminals.has(r.id))!;
  state.player.x = room.gx + room.w / 2;
  state.player.y = room.gy + room.h / 2;
  for (const r of map.rooms) { r.cleared = true; r.spawned = true; }
  state.drones = []; state.targets = [];
  return state;
}

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log('PASS', name);
  else { failures++; console.log('FAIL', name, JSON.stringify(detail)); }
}

const state = makeState();
const room = state.map.rooms.find((r) => terminalRooms(state.map.rooms).has(r.id))!;

// 1) Buy the loan weapon (offer key 'weapon', price 40). It is auto-equipped.
enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-w1', offerKey: 'weapon', roomId: room.id });
const ev1 = stepSimulationTicks(state, 1, NEUTRAL);
const res1 = ev1.find((e: any) => e.type === 'supply-purchase-result') as any;
check('weapon purchase ok', res1?.ok === true, { res1 });
const loan = loanWeaponFor(state.seed, room.id);
check('loan weapon owned', state.player.data.weapons.some((w) => w.key === loan), { weapons: state.player.data.weapons.map((w) => w.key) });
const currencyAfterBuy = state.player.data.currency;
check('weapon price 40 deducted', currencyAfterBuy === 200 - 40, { actual: currencyAfterBuy });

// 2) Same offer again with a NEW tx id, same session: "Already owned" guard blocks it.
enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-w2', offerKey: 'weapon', roomId: room.id });
const ev2 = stepSimulationTicks(state, 1, NEUTRAL);
const res2 = ev2.find((e: any) => e.type === 'supply-purchase-result') as any;
check('second weapon purchase rejected (Already owned)', res2?.ok === false && /Already owned/.test(res2?.reason ?? ''), { res2 });
check('no second deduction', state.player.data.currency === currencyAfterBuy, { actual: state.player.data.currency });

// 3) Calibration (28) on the equipped weapon -> level up.
enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-c1', offerKey: 'calibration', roomId: room.id });
const ev3 = stepSimulationTicks(state, 1, NEUTRAL);
const res3 = ev3.find((e: any) => e.type === 'supply-purchase-result') as any;
check('calibration purchase ok', res3?.ok === true, { res3 });
const loanLevel = state.player.data.weapons.find((w) => w.key === loan)?.level;
check('loan weapon level 2', loanLevel === 2, { loanLevel });

// 4) Restore boundary: simulate what World.restoreCheckpoint does to the ledger
//    (purchaseTransactions = []) and replay the same transaction ids.
const restored = makeState();
// restoreCheckpoint resets the ledger (World.ts: restoreCheckpoint)
restored.purchaseTransactions = [];
const beforeRestoreCurrency = restored.player.data.currency;
enqueueCommand(restored, { type: 'purchase-supply', transactionId: 'tx-w1', offerKey: 'weapon', roomId: room.id });
const ev4 = stepSimulationTicks(restored, 1, NEUTRAL);
const res4 = ev4.find((e: any) => e.type === 'supply-purchase-result') as any;
check('after ledger reset, same tx id executes again (session dedup is session-only)', res4?.ok === true, { res4 });
check('after ledger reset, currency deducted again', restored.player.data.currency === beforeRestoreCurrency - 40, { actual: restored.player.data.currency });

// 5) Does a checkpoint restore (player data restored from save) allow buying the
//    SAME weapon again (duplicate weapon in arsenal)?
const restored2 = makeState();
// Simulate checkpoint player data that already owns the loan weapon.
const loan2 = loanWeaponFor(restored2.seed, room.id);
restored2.player.data.weapons.push({ key: loan2, level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 });
restored2.player.data.currency = 200;
restored2.purchaseTransactions = [];
enqueueCommand(restored2, { type: 'purchase-supply', transactionId: 'tx-after-restore', offerKey: 'weapon', roomId: room.id });
const ev5 = stepSimulationTicks(restored2, 1, NEUTRAL);
const res5 = ev5.find((e: any) => e.type === 'supply-purchase-result') as any;
check('restored save that already owns loan weapon: duplicate blocked by offer guard',
  res5?.ok === false && /Already owned/.test(res5?.reason ?? ''), { res5 });
check('no duplicate weapon in arsenal',
  restored2.player.data.weapons.filter((w) => w.key === loan2).length === 1,
  { weapons: restored2.player.data.weapons.map((w) => w.key) });

// 6) Calibration replay after restore: max-level guard uses live data (level from save).
const restored3 = makeState();
const pulse = restored3.player.data.weapons.find((w) => w.key === 'pulse')!;
pulse.level = 10; // max level
restored3.purchaseTransactions = [];
enqueueCommand(restored3, { type: 'purchase-supply', transactionId: 'tx-cal-max', offerKey: 'calibration', roomId: room.id });
const ev6 = stepSimulationTicks(restored3, 1, NEUTRAL);
const res6 = ev6.find((e: any) => e.type === 'supply-purchase-result') as any;
check('calibration at max level rejected using restored (live) data',
  res6?.ok === false && /Max level/.test(res6?.reason ?? ''), { res6 });

console.log(`RESTORE_BOUNDARY_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
