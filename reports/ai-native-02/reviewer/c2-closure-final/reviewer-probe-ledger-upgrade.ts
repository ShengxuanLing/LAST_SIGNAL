// Independent probe: C2 closure ledger + upgrade + canonical (ae72a67).
import { createSimulationState, enqueueCommand, stepSimulationTicks, canonicalSimulationState,
  type SimulationState, type SimulationIntent } from './src/world/sim/core';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { terminalRooms, PURCHASE_LEDGER_CAP } from './src/config/supplies';
import { basePlayerData, type PlayerData } from './src/config/game';

const NEUTRAL: SimulationIntent = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

function makeState(opts: { currency?: number; hp?: number } = {}): SimulationState {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const pd: PlayerData = { ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: opts.currency ?? 500,
    hp: opts.hp ?? 40, weaponKey: 'pulse',
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
function roomOf(state: SimulationState) {
  const terminals = terminalRooms(state.map.rooms);
  return state.map.rooms.find((r) => terminals.has(r.id))!;
}
let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log('PASS', name);
  else { failures++; console.log('FAIL', name, JSON.stringify(detail)); }
}

// L1: cap 64, no eviction; at-cap old tx stays rejected, new tx rejected full.
{
  const state = makeState();
  const room = roomOf(state);
  state.purchaseTransactions = Array.from({ length: PURCHASE_LEDGER_CAP }, (_, i) => `t${i}`);
  const before = state.player.data.currency;
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 't0', offerKey: 'repair', roomId: room.id });
  let ev = stepSimulationTicks(state, 1, NEUTRAL);
  let res = ev.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('cap: existing old tx still duplicate-rejected (not re-charged)', res?.ok === false && /Duplicate/.test(res?.reason), { res });
  check('cap: old tx not re-charged', state.player.data.currency === before, { actual: state.player.data.currency });

  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'new-at-cap', offerKey: 'repair', roomId: room.id });
  ev = stepSimulationTicks(state, 1, NEUTRAL);
  res = ev.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('cap: new tx rejected with ledger full', res?.ok === false && /ledger full/i.test(res?.reason), { res });
  check('cap: ledger length stays 64 (no eviction)', state.purchaseTransactions.length === PURCHASE_LEDGER_CAP, { len: state.purchaseTransactions.length });
  check('cap: t0 still present (not evicted)', state.purchaseTransactions.includes('t0'));
  check('cap: new-at-cap not recorded', !state.purchaseTransactions.includes('new-at-cap'));
}

// L2: success and blocker-rejection each bill exactly once; structural rejects don't.
{
  const state = makeState({ hp: 40, currency: 500 });
  const room = roomOf(state);
  const run = (tx: string, offerKey: string) => {
    enqueueCommand(state, { type: 'purchase-supply', transactionId: tx, offerKey, roomId: room.id });
    const ev = stepSimulationTicks(state, 1, NEUTRAL);
    return ev.find((e: any) => e.type === 'supply-purchase-result') as any;
  };
  const r1 = run('s1', 'repair'); // success
  check('billing: success ok', r1?.ok === true, { r1 });
  check('billing: success recorded once', state.purchaseTransactions.filter((t) => t === 's1').length === 1);
  const r2 = run('s2', 'repair'); // success (hp 75)
  check('billing: second success ok', r2?.ok === true, { r2 });
  const r3 = run('s3', 'repair'); // hp 100 -> blocker 'Health full', still bills once
  check('billing: blocker rejection ok=false', r3?.ok === false, { r3 });
  check('billing: blocker rejection billed once', state.purchaseTransactions.filter((t) => t === 's3').length === 1);
  const r4 = run('s3', 'repair'); // duplicate -> no extra bill
  check('billing: duplicate rejection no extra bill', state.purchaseTransactions.filter((t) => t === 's3').length === 1, { r4 });
  const ledgerBefore = state.purchaseTransactions.length;
  const r5 = run('u1', 'unknown-offer'); // structural reject before billing
  check('billing: unknown offer rejected', r5?.ok === false && /Unknown/.test(r5?.reason), { r5 });
  check('billing: structural reject does not consume ledger', state.purchaseTransactions.length === ledgerBefore, { before: ledgerBefore, after: state.purchaseTransactions.length });
}

// L3: duplicate tx with DIFFERENT payload is rejected; original not overwritten.
{
  const state = makeState({ hp: 40, currency: 500 });
  const room = roomOf(state);
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'dup', offerKey: 'repair', roomId: room.id });
  stepSimulationTicks(state, 1, NEUTRAL);
  const currencyAfter1 = state.player.data.currency;
  const weaponsAfter1 = state.player.data.weapons.length;
  enqueueCommand(state, { type: 'purchase-supply', transactionId: 'dup', offerKey: 'weapon', roomId: room.id });
  const ev = stepSimulationTicks(state, 1, NEUTRAL);
  const res = ev.find((e: any) => e.type === 'supply-purchase-result') as any;
  check('dup-different-payload: rejected duplicate', res?.ok === false && /Duplicate/.test(res?.reason), { res });
  check('dup-different-payload: no extra charge', state.player.data.currency === currencyAfter1, { actual: state.player.data.currency });
  check('dup-different-payload: no weapon added', state.player.data.weapons.length === weaponsAfter1, { len: state.player.data.weapons.length });
}

// L4: canonical includes the ledger; differing ledger => differing canonical.
{
  const a = makeState(); const b = makeState();
  a.purchaseTransactions = ['x1']; b.purchaseTransactions = [];
  const ca = canonicalSimulationState(a), cb = canonicalSimulationState(b);
  check('canonical includes purchaseTransactions field', ca.includes('purchaseTransactions'));
  check('canonical differs when ledger differs', ca !== cb);
}

// L5: new run starts with an empty ledger.
{
  const state = makeState();
  check('new run ledger empty', Array.isArray(state.purchaseTransactions) && state.purchaseTransactions.length === 0);
}

// U1: upgrade record not duplicated; level updates in place.
{
  const state = makeState();
  const beforeSpeed = state.player.data.speed;
  enqueueCommand(state, { type: 'apply-upgrade', key: 'speed', level: 1 });
  stepSimulationTicks(state, 1, NEUTRAL);
  enqueueCommand(state, { type: 'apply-upgrade', key: 'speed', level: 2 });
  stepSimulationTicks(state, 1, NEUTRAL);
  const recs = state.player.data.upgrades.filter((u) => u.key === 'speed');
  check('upgrade: single record for repeated key', recs.length === 1, { recs });
  check('upgrade: record level updated to 2', recs[0]?.level === 2, { recs });
  check('upgrade: effect applied twice (1.08^2)', Math.abs(state.player.data.speed - beforeSpeed * 1.08 * 1.08) < 1e-9, { beforeSpeed, actual: state.player.data.speed });
}

console.log(`LEDGER_UPGRADE_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
