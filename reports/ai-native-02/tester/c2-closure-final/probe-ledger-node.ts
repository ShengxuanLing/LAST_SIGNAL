// Independent C2 purchase-ledger probe (pure Node, real map/RNG). Hard quota, duplicate
// rejection, invalid id, canonical field, cap no-eviction.
import { basePlayerData } from './src/config/game';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { PURCHASE_LEDGER_CAP, terminalRooms } from './src/config/supplies';
import { createSimulationState, enqueueCommand, stepSimulationTicks, canonicalSimulationState } from './src/world/sim/core';

const out: any = { checks: [], flows: {}, meta: { target: 'ae72a67', cap: PURCHASE_LEDGER_CAP } };
const check = (n: string, ok: boolean, d?: any) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const gen = new MapGenerator(424242); const map = gen.generate(); assignRoles(gen, map.rooms, map.roomsOrder); guaranteeReachable(map);
const pd: any = basePlayerData(); pd.weapons = [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }]; pd.weaponKey = 'pulse'; pd.upgrades = []; pd.abilities = []; pd.currency = 1000; pd.hp = 50;
const st: any = createSimulationState({ seed: 424242, map, playerData: pd, playerX: 0, playerY: 0 });
const rid = [...terminalRooms(map.rooms)][0]; const r = map.rooms[rid];
st.player.x = r.gx + r.w / 2; st.player.y = r.gy + r.h / 2;
for (const room of map.rooms) { room.spawned = true; room.cleared = true; }
st.drones = []; st.targets = [];
const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
const buy = (tx: string, key = 'repair'): any[] => {
  enqueueCommand(st, { type: 'purchase-supply', transactionId: tx, offerKey: key, roomId: rid });
  return stepSimulationTicks(st, 1, neutral).filter((e: any) => e.type === 'supply-purchase-result');
};
const r1 = buy('tx-alpha-0001');
check('first-purchase-ok', r1[0]?.ok === true && st.player.data.currency === 984 && st.player.data.hp === 85, { r: r1[0], currency: st.player.data.currency, hp: st.player.data.hp });
check('ledger-records-id', st.purchaseTransactions.includes('tx-alpha-0001') && st.purchaseTransactions.length === 1);
const r2 = buy('tx-alpha-0001');
check('duplicate-rejected-no-double-charge', r2[0]?.ok === false && r2[0]?.reason === 'Duplicate transaction' && st.player.data.currency === 984 && st.purchaseTransactions.length === 1, { r: r2[0], currency: st.player.data.currency });
const r3 = buy('');
check('invalid-id-rejected', r3[0]?.ok === false && r3[0]?.reason === 'Invalid transaction id' && !st.purchaseTransactions.includes(''), { r: r3[0] });
st.player.data.hp = st.player.data.maxHp;
for (let i = 0; i < 200 && st.purchaseTransactions.length < PURCHASE_LEDGER_CAP; i++) buy('tx-fill-' + String(i).padStart(4, '0'));
check('reaches-hard-cap', st.purchaseTransactions.length === PURCHASE_LEDGER_CAP, { size: st.purchaseTransactions.length });
const over = buy('tx-over-cap-0001');
check('cap-rejects-new-and-never-evicts', over[0]?.ok === false && over[0]?.reason === 'Supply ledger full' && st.purchaseTransactions.length === PURCHASE_LEDGER_CAP && st.purchaseTransactions[0] === 'tx-alpha-0001', { r: over[0], size: st.purchaseTransactions.length, first: st.purchaseTransactions[0] });
const canonical = canonicalSimulationState(st);
check('canonical-includes-ledger', canonical.includes('purchaseTransactions') && canonical.includes('tx-alpha-0001'));
out.flows = { rid, roomKind: r.kind, first: r1[0], duplicate: r2[0], invalid: r3[0], over: over[0], finalCurrency: st.player.data.currency, ledgerSize: st.purchaseTransactions.length };
console.log(JSON.stringify(out, null, 2));
console.log(out.checks.every((c: any) => c.ok) ? 'LEDGER_PROBE_PASS' : 'LEDGER_PROBE_FAIL');
