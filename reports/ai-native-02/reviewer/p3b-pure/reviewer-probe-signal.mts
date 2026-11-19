import { SIGNAL_TUNING } from './src/signal/signalTuning';
import { SLICE } from './src/slice/tuning';
import {
  createSignalResources, chargeScan, chargeJam, scanBlocker, jamBlocker, tickEnergyAccount,
  tickCooldowns, withinScanRange, withinJamRange, evidenceExpiry,
  expireEvidence, scanDiscover, validSignalResources
} from './src/signal/signalCore';
import { SliceModel } from './src/slice/rules';
import { ROOM } from './src/slice/room';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));

// 1. ONE tuning source; frozen; slice values are literally the shared ones
for (const k of ['TICK_HZ','TICK_MS','ENERGY_MAX','REGEN_PER_SEC','REGEN_TICKS','SCAN_COST','SCAN_CD_TICKS','SCAN_REVEAL_TICKS','SCAN_RADIUS','JAM_COST','JAM_CD_TICKS','JAM_DURATION_TICKS','JAM_RANGE'] as const)
  check(`SLICE.${k} === SIGNAL_TUNING.${k}`, (SLICE as any)[k] === (SIGNAL_TUNING as any)[k]);
check('SIGNAL_TUNING frozen', Object.isFrozen(SIGNAL_TUNING));
check('SLICE frozen', Object.isFrozen(SLICE));

// 2. scan/jam range uses STRICT '<' (not '<='), matching the frozen slice
const los = () => true;
check('scan dist=11.999 within 12', withinScanRange({ x: 0, y: 0 }, { x: 11.999, y: 0 }, los));
check('scan dist=12 EXCLUDED (strict <)', !withinScanRange({ x: 0, y: 0 }, { x: 12, y: 0 }, los));
check('jam dist=5.999 within 6', withinJamRange({ x: 0, y: 0 }, { x: 5.999, y: 0 }, los));
check('jam dist=6 EXCLUDED (strict <)', !withinJamRange({ x: 0, y: 0 }, { x: 6, y: 0 }, los));
check('LOS false excludes', !withinScanRange({ x: 0, y: 0 }, { x: 1, y: 0 }, () => false));

const atBoundary = (dist: number) => {
  const m = new SliceModel();
  m.setPlayerPos(ROOM.receiver.x - dist, ROOM.receiver.y);
  return m;
};
const j6 = atBoundary(SIGNAL_TUNING.JAM_RANGE);
check('frozen-slice jam at EXACT 6 tiles is illegal (strict <)', j6.jam().code === 'E_ILLEGAL_TARGET', { code: j6.jam().code });
const j599 = atBoundary(5.99);
check('frozen-slice jam inside 6 is not E_ILLEGAL_TARGET', j599.jam().code !== 'E_ILLEGAL_TARGET', { code: j599.jam().code });

// 3. tick-quantized regen / cooldown; paused freezes; no infinite energy
let acc = { energy: 90, regenAcc: 0 };
for (let i = 0; i < 11; i++) acc = tickEnergyAccount(acc, false);
check('11 ticks -> still 90 / regenAcc=11', acc.energy === 90 && acc.regenAcc === 11, acc);
acc = tickEnergyAccount(acc, false);
check('12th tick -> +1 energy / regenAcc=0', acc.energy === 91 && acc.regenAcc === 0, acc);
check('full energy resets regenAcc', tickEnergyAccount({ energy: 100, regenAcc: 7 }, false).regenAcc === 0);
const pausedAcc = { energy: 90, regenAcc: 3 };
check('paused tick does not regen or accumulate', JSON.stringify(tickEnergyAccount(pausedAcc, true)) === JSON.stringify(pausedAcc));
const cd = { scanCooldownTicks: 2, scanRevealTicks: 1, jamCooldownTicks: 1, jamRemainingTicks: 1 };
check('paused cooldowns unchanged', JSON.stringify(tickCooldowns(cd, true)) === JSON.stringify(cd));
check('cooldowns decay exactly 1 per tick', JSON.stringify(tickCooldowns(cd, false)) === JSON.stringify({ scanCooldownTicks: 1, scanRevealTicks: 0, jamCooldownTicks: 0, jamRemainingTicks: 0 }));
let long = { energy: 0, regenAcc: 0 };
for (let i = 0; i < 10000; i++) long = tickEnergyAccount(long, false);
check('10k regen ticks cap at ENERGY_MAX (no infinite resource)', long.energy === SIGNAL_TUNING.ENERGY_MAX, long);

// 4. guard jam keeps the relay countdown but still costs energy + cooldown
const base = createSignalResources('echo');
const relayJam = chargeJam(base, true);
const guardJam = chargeJam(base, false);
check('relay jam sets jamRemainingTicks=360', relayJam.cooldowns.jamRemainingTicks === 360);
check('guard jam keeps jamRemainingTicks=0 (does not suppress relay)', guardJam.cooldowns.jamRemainingTicks === 0, guardJam.cooldowns);
check('guard jam still costs 25 + CD 480', guardJam.energy.energy === 75 && guardJam.cooldowns.jamCooldownTicks === 480);
check('jamBlocker active relay jam -> E_RETRYABLE', jamBlocker(relayJam, false, false) === 'E_RETRYABLE');
check('jamBlocker guard jam -> E_COOLDOWN', jamBlocker(guardJam, false, false) === 'E_COOLDOWN');
check('player and echo accounts independent', chargeScan(createSignalResources('player')).energy.energy === 90 && createSignalResources('echo').energy.energy === 100);

// 5. energy charge before evidence; empty scan still charges; evidence TTL from OBSERVATION tick
const m = new SliceModel();
const energy0 = m.energy;
const scan1 = m.scan({ sourceActionId: 'act_scan_1', observerActorId: 'echo', sceneEpoch: 1 });
check('scan OK and charges exactly 10', scan1.code === 'OK' && scan1.cost === 10 && m.energy === energy0 - 10, { code: scan1.code, cost: scan1.cost, energy: m.energy });
const ev = m.evidenceSnapshot;
check('evidence observedAtTick == scan tick', ev.length > 0 && ev.every((e: any) => e.observedAtTick === m.tick));
check('evidence expiresAtTick == tick+480', ev.every((e: any) => e.expiresAtTick === e.observedAtTick + SIGNAL_TUNING.SCAN_REVEAL_TICKS));
check('provenance preserved', ev.every((e: any) => e.sourceActionId === 'act_scan_1' && e.observerActorId === 'echo' && e.sceneEpoch === 1));
const scan2 = m.scan();
check('second scan blocked by CD and does NOT charge', scan2.code === 'E_COOLDOWN' && m.energy === energy0 - 10, { code: scan2.code, energy: m.energy });
const m2 = new SliceModel();
const e0 = m2.energy;
// Force a GENUINELY empty scan via scanFrom with a tiny explicit range; the
// frozen 14x10 room has no walkable cell >12 tiles from both lab devices.
const emptyRes = m2.scanFrom(3.5, 5.5, undefined, 0.001);
check('empty scan legal, still charges 10, no evidence', emptyRes.result.code === 'OK' && emptyRes.result.cost === 10 && m2.energy === e0 - 10 && emptyRes.evidence.length === 0, { code: emptyRes.result.code, cost: emptyRes.result.cost, energy: m2.energy, ev: emptyRes.evidence.length });
const mp = new SliceModel(); mp.setPaused(true); const ep = mp.energy;
check('paused scan E_PAUSED no charge', mp.scan().code === 'E_PAUSED' && mp.energy === ep);
const low = new SliceModel(null); (low as any).energyValue = 9;
check('insufficient-energy scan E_ENERGY_INSUFFICIENT no charge', low.scan().code === 'E_ENERGY_INSUFFICIENT' && low.energy === 9);
const found = scanDiscover({ x: 0, y: 0 }, [{ id: 'r', kind: 'relay', x: 1, y: 0 }], () => true, 10, 'echo');
check('expireEvidence at tick+479 keeps, tick+480 drops', expireEvidence(found, 489).length === 1 && expireEvidence(found, 490).length === 0);
check('evidenceExpiry uses 480', evidenceExpiry(10) === 490);
check('scanDiscover actor provenance', found[0].observerActorId === 'echo' && found[0].observedAtTick === 10);

// 6. validSignalResources exact bounds + no free skills
const good = chargeJam(chargeScan(createSignalResources('player')));
check('validSignalResources normal runtime spend accepted', validSignalResources(good));
const badResources = [
  { ...createSignalResources('echo'), energy: { energy: 9999, regenAcc: 0 } },
  { ...createSignalResources('echo'), energy: { energy: -1, regenAcc: 0 } },
  { ...createSignalResources('echo'), energy: { energy: 100, regenAcc: 12 } },
  { ...createSignalResources('echo'), cooldowns: { scanCooldownTicks: 121, scanRevealTicks: 0, jamCooldownTicks: 0, jamRemainingTicks: 0 } },
  { ...createSignalResources('echo'), cooldowns: { scanCooldownTicks: 0, scanRevealTicks: 481, jamCooldownTicks: 0, jamRemainingTicks: 0 } },
  { ...createSignalResources('echo'), upgrades: [{ key: 'power', level: 3 }] },
  { ...createSignalResources('echo'), abilities: ['dash'] },
  { ...createSignalResources('echo'), actor: 'boss' },
];
for (const bad of badResources) check('validSignalResources rejects over-range/free skill', !validSignalResources(bad));

// 7. INFO: pure charge functions do not clamp negative energy (caller must gate)
const unguarded = chargeScan({ ...createSignalResources('echo'), energy: { energy: 5, regenAcc: 0 } });
info('chargeScan called without blocker yields negative energy (pure fn, caller must gate)', { energy: unguarded.energy.energy });

console.log(`SIGNAL_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
