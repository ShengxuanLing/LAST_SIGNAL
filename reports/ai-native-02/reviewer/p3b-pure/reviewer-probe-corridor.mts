/** Corridor / guard-jam old-vs-new parity + scan charge-order honesty. */
import { SliceModel as NewModel } from './src/slice/rules';
import { SliceModel as OldModel } from './reviewer-old-src/src/slice/rules';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));

type M = InstanceType<typeof NewModel>;

function corridorRun(m: M) {
  const log: Array<Record<string, unknown>> = [];
  const rec = (step: string, r: any) => log.push({ step, code: r?.code, cost: r?.cost,
    snap: JSON.parse(JSON.stringify(m.snapshot())), ev: JSON.parse(JSON.stringify(m.evidenceSnapshot)) });
  // Enter the corridor through the real gate (markPassed + position at exit).
  m.markPassed();
  m.setPlayerPos(12.5, 5.5);
  rec('enterCorridor', { code: m.enterCorridor() ? 'OK' : 'E_FAIL' });
  rec('corridorScan', m.scan({ sourceActionId: 'c1', observerActorId: 'echo' }));
  m.advanceTicks(121);
  rec('after121', { code: 'TICK' });
  // Guard jam (relay countdown must stay 0) vs relay jam.
  rec('jamGuard', m.jam('guard'));
  m.advanceTicks(480);
  rec('after480', { code: 'TICK' });
  rec('jamRelay', m.jam('relay'));
  m.advanceTicks(360);
  rec('jamExpire', { code: 'TICK' });
  rec('interact', m.interact());
  rec('shootGuard', m.shootGuard());
  // A corridor with a live guard / unstable bridge is INTENTIONALLY unsafe to
  // serialize; both models must throw the same error. Record it explicitly.
  let serialized: unknown;
  try { serialized = m.serialize(); } catch (err) { serialized = { unsafeError: String(err) }; }
  return { log, serialized };
}

const oldR = corridorRun(new OldModel(null) as unknown as M);
const newR = corridorRun(new NewModel(null) as unknown as M);
check('same corridor step count', oldR.log.length === newR.log.length, { old: oldR.log.length, new: newR.log.length });
for (let i = 0; i < Math.min(oldR.log.length, newR.log.length); i++) {
  const a = JSON.stringify(oldR.log[i]), b = JSON.stringify(newR.log[i]);
  check(`corridor step[${i}] ${String(oldR.log[i].step)} identical`, a === b, a === b ? undefined : { old: a.slice(0, 500), new: b.slice(0, 500) });
}
check('corridor serialize() identical', JSON.stringify(oldR.serialized) === JSON.stringify(newR.serialized));

// Guard-jam keeps relay countdown at 0 in BOTH (shared chargeJam(false))
for (const [label, Model] of [['OLD', OldModel], ['NEW', NewModel]] as const) {
  const m = new Model(null) as unknown as M;
  m.markPassed(); m.setPlayerPos(12.5, 5.5); m.enterCorridor();
  const r = m.jam('guard');
  check(`${label} guard jam result preserved`, typeof r.code === 'string');
  check(`${label} guard jam does NOT set jamRemainingTicks (relay countdown)`, m.snapshot().jamRemainingTicks === 0, { jam: m.snapshot().jamRemainingTicks });
}

// scanFrom in corridor charges 10 energy BEFORE returning E_PERMISSION (pre-existing, both)
for (const [label, Model] of [['OLD', OldModel], ['NEW', NewModel]] as const) {
  const m = new Model(null) as unknown as M;
  m.markPassed(); m.setPlayerPos(12.5, 5.5); m.enterCorridor();
  const e0 = m.energy;
  const r = m.scanFrom(3, 5, undefined, 12);
  info(`${label} scanFrom in corridor`, { code: r.result.code, energyBefore: e0, energyAfter: m.energy, charged: e0 - m.energy, evidence: r.evidence.length });
  check(`${label} scanFrom corridor charge order identical (10 charged, E_PERMISSION, no evidence)`,
    r.result.code === 'E_PERMISSION' && e0 - m.energy === 10 && r.evidence.length === 0);
}

console.log(`CORRIDOR_PARITY_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
