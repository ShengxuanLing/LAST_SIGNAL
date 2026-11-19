// Independent probe for C2 atomic purchase-supply (59aa852 / code 3f97990).
// Covers: delta purchase preserves queued reward/heal/xp; duplicate tx rejected;
// bounded-ledger eviction replay (C3a-class); canonical excludes ledger; forgery
// rejection; commit-time live validation.
import { createSimulationState, enqueueCommand, stepSimulationTicks, canonicalSimulationState,
  type SimulationState, type SimulationIntent } from './src/world/sim/core';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { terminalRooms, supplyPrice } from './src/config/supplies';
import { basePlayerData, type PlayerData } from './src/config/game';

const NEUTRAL: SimulationIntent = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

function makeState(opts: { currency?: number; hp?: number } = {}): SimulationState {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const pd: PlayerData = { ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: opts.currency ?? 200,
    hp: opts.hp ?? 40, weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: [] };
  const state = createSimulationState({ seed: 424242, map, playerData: pd, playerX: 5, playerY: 5 });
  // Place player inside a terminal room, clear all rooms/spawns for a safe terminal.
  const terminals = terminalRooms(map.rooms);
  const room = map.rooms.find((r) => terminals.has(r.id))!;
  state.player.x = room.gx + room.w / 2;
  state.player.y = room.gy + room.h / 2;
  for (const r of map.rooms) { r.cleared = true; r.spawned = true; }
  state.drones = []; state.targets = [];
  return state;
}

function findRoom(state: SimulationState) {
  const terminals = terminalRooms(state.map.rooms);
  return state.map.rooms.find((r) => terminals.has(r.id))!;
}

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log('PASS', name);
  else { failures++; console.log('FAIL', name, JSON.stringify(detail)); }
}

// 1) Delta purchase preserves queued reward + heal + xp (previous blocker).
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
  check('reward+heal+xp+buy: currency = 100+20-16', state.player.data.currency === 100 + 20 - price, { actual: state.player.data.currency });
  check('reward+heal+xp+buy: hp = 40+10+35', state.player.data.hp === 85, { actual: state.player.data.hp });
  check('reward+heal+xp+buy: xp = 20', state.player.data.xp === 20, { actual: state.player.data.xp });
  const res = ev.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('reward+heal+xp+buy: receipt ok', res?.ok === true, { res });
}

// 2) Duplicate tx: same id second time is rejected, not re-executed.
{
  const state = makeState();
  const room = findRoom(state);
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-dup', offerKey: 'repair', roomId: room.id });
  stepSimulationTicks(state, 1, NEUTRAL);
  const after1 = state.player.data.currency;
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-dup', offerKey: 'repair', roomId: room.id });
  const ev2 = stepSimulationTicks(state, 1, NEUTRAL);
  const res2 = ev2.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('duplicate tx rejected', res2?.ok === false && /Duplicate/.test(res2?.reason ?? ''), { res2 });
  check('duplicate tx not re-executed', state.player.data.currency === after1, { actual: state.player.data.currency });
}

// 3) Bounded ledger eviction reproduces C3a-class replay after 256 entries.
{
  const state = makeState();
  const room = findRoom(state);
  // Seed a full ledger; 'old-0' is oldest and will be evicted on the next success.
  state.purchaseTransactions = Array.from({ length: 256 }, (_, i) => `old-${i}`);
  // 'old-0' currently deduped.
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'old-0', offerKey: 'repair', roomId: room.id });
  const evA = stepSimulationTicks(state, 1, NEUTRAL);
  const resA = evA.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('pooled tx old-0 initially rejected (duplicate)', resA?.ok === false, { resA });

  // One new success pushes length to 257 -> splice keeps latest 256 -> evicts old-0.
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'fresh-1', offerKey: 'repair', roomId: room.id });
  const evB = stepSimulationTicks(state, 1, NEUTRAL);
  const resB = evB.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('bounded ledger: fresh purchase ok', resB?.ok === true, { resB });
  check('bounded ledger: old-0 evicted', !state.purchaseTransactions.includes('old-0'), { ledgerLen: state.purchaseTransactions.length });

  // Replay the evicted tx: now it executes again (same transaction id re-run).
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'old-0', offerKey: 'repair', roomId: room.id });
  const evC = stepSimulationTicks(state, 1, NEUTRAL);
  const resC = evC.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('C3a-CLASS: evicted tx old-0 re-executes after eviction', resC?.ok === true, { resC });
}

// 4) Canonical excludes purchaseTransactions -> canonical equality can hide a
//    behavior-affecting dedup difference (replay fork).
{
  const a = makeState();
  const b = makeState();
  a.purchaseTransactions = ['tx-ledger'];
  b.purchaseTransactions = [];
  const canonEqual = canonicalSimulationState(a) === canonicalSimulationState(b);
  check('canonical equal despite different purchaseTransactions ledger', canonEqual, { canonEqual });

  const roomA = findRoom(a);
  enqueueCommand(a, { type: 'purchase-supply', transactionId: 'tx-ledger', offerKey: 'repair', roomId: roomA.id });
  const evA = stepSimulationTicks(a, 1, NEUTRAL);
  const resA = evA.find((e: any) => e.type === 'supply-purchase-result') as any;
  const roomB = findRoom(b);
  enqueueCommand(b, { type: 'purchase-supply', transactionId: 'tx-ledger', offerKey: 'repair', roomId: roomB.id });
  const evB = stepSimulationTicks(b, 1, NEUTRAL);
  const resB = evB.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('same tx: deduped state rejects, empty-ledger state executes (behavioral fork)',
    resA?.ok === false && resB?.ok === true, { resA, resB });
}

// 5) Forgery: unknown offer and wrong room are rejected; price follows offer key.
{
  const state = makeState();
  const room = findRoom(state);
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-fake', offerKey: 'free-item', roomId: room.id });
  const ev1 = stepSimulationTicks(state, 1, NEUTRAL);
  const res1 = ev1.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('unknown offer rejected', res1?.ok === false && /Unknown offer/.test(res1?.reason ?? ''), { res1 });

  const other = state.map.rooms.find((r) => r.id !== room.id)!;
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-wrongroom', offerKey: 'repair', roomId: other.id });
  const ev2 = stepSimulationTicks(state, 1, NEUTRAL);
  const res2 = ev2.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('wrong room rejected', res2?.ok === false && /terminal/i.test(res2?.reason ?? ''), { res2 });

  const before = state.player.data.currency;
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-repair', offerKey: 'repair', roomId: room.id });
  const ev3 = stepSimulationTicks(state, 1, NEUTRAL);
  check('price resolved from key (repair=16), not adapter', state.player.data.currency === before - 16, { actual: state.player.data.currency });
}

// 6) Commit-time live validation: balance/enemies/room re-checked at tick.
{
  const state = makeState();
  const room = findRoom(state);
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-broke', offerKey: 'repair', roomId: room.id });
  state.player.data.currency = 0; // spent between enqueue and tick
  const ev = stepSimulationTicks(state, 1, NEUTRAL);
  const res = ev.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('commit-time balance re-validation rejects', res?.ok === false && /credits/i.test(res?.reason ?? ''), { res });

  const state2 = makeState();
  const room2 = findRoom(state2);
  enqueueCommand(state2, { type: 'purchase-supply', transactionId: 'tx-enemy', offerKey: 'repair', roomId: room2.id });
  state2.drones.push({
    id: 999, x: 1, y: 1, hp: 10, attackTimer: 0, wanderTimer: 0,
    data: { kind: 'drone', state: 'idle', stateTimer: 0, targetId: null, patrolPoints: [], patrolIndex: 0,
      hitFlash: 0, stunTimer: 0, spawnRoom: 0,
      stats: { maxHp: 10, damage: 1, speed: 0.1, aggroRange: 1, attackRange: 1, armor: 0, xpValue: 1, currencyValue: 1 } }
  } as any);
  const ev2 = stepSimulationTicks(state2, 1, NEUTRAL);
  const res2 = ev2.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('commit-time threat re-validation rejects', res2?.ok === false && /threat/i.test(res2?.reason ?? ''), { res2 });
}

console.log(`PURCHASE_TX_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
