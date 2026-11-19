/**
 * Independent old-vs-new frozen SliceModel behavioural parity.
 * Both modules are loaded from the SAME frozen review snapshot:
 *   - NEW = ab59fe6 src/slice/rules.ts (shared signalCore adoption)
 *   - OLD = 212cd56 src/slice/rules.ts (git archive of that commit's src/)
 * Identical deterministic command sequences must yield identical snapshots,
 * results, energy/cooldown/evidence/regen state. No WIP/stash.
 */
import { SliceModel as NewModel } from './src/slice/rules';
import { SliceModel as OldModel } from './reviewer-old-src/src/slice/rules';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };

type M = InstanceType<typeof NewModel>;

function run(m: M, label: string) {
  const log: Array<Record<string, unknown>> = [];
  const rec = (step: string, r: any) => {
    log.push({ step, code: r?.code, cost: r?.cost, msg: r?.message,
      snap: JSON.parse(JSON.stringify(m.snapshot())),
      ev: JSON.parse(JSON.stringify(m.evidenceSnapshot)),
      avail: JSON.parse(JSON.stringify(m.actionAvailability())) });
  };
  rec('init', { code: 'INIT' });
  rec('scan@spawn', m.scan({ sourceActionId: 'a1', observerActorId: 'echo', sceneEpoch: 3 }));
  m.advanceTicks(11);
  rec('regen11', { code: 'TICK' });
  m.advanceTicks(1);
  rec('regen12', { code: 'TICK' });
  m.advanceTicks(120);
  rec('cd120', { code: 'TICK' });
  rec('scanAgain', m.scan({ sourceActionId: 'a2' }));
  m.setPlayerPos(6.5, 5.0);
  rec('moveToReceiver', { code: 'MOVE' });
  rec('jamNear', m.jam('relay'));
  m.advanceTicks(360);
  rec('jamExpire', { code: 'TICK' });
  rec('interact', m.interact());
  m.setPlayerPos(3.5, 5.5);
  m.setPaused(true);
  const beforePause = m.energy;
  m.advanceTicks(100);
  rec('paused100', { code: 'TICK', pausedEnergy: beforePause });
  m.setPaused(false);
  rec('scanFromEcho', m.scanFrom(4, 5, { observerActorId: 'echo' }, 12));
  rec('jamExact6', (() => { m.setPlayerPos(1.5, 5.0); return m.jam('relay'); })());
  const serialized = m.serialize();
  return { log, serialized };
}

const oldRun = run(new OldModel(null) as unknown as M, 'OLD');
const newRun = run(new NewModel(null) as unknown as M, 'NEW');
check('same number of recorded steps', oldRun.log.length === newRun.log.length, { old: oldRun.log.length, new: newRun.log.length });
for (let i = 0; i < Math.min(oldRun.log.length, newRun.log.length); i++) {
  const a = JSON.stringify(oldRun.log[i]);
  const b = JSON.stringify(newRun.log[i]);
  check(`step[${i}] ${String(oldRun.log[i].step)} identical snapshot/result/availability/evidence`, a === b,
    a === b ? undefined : { old: a.slice(0, 600), new: b.slice(0, 600) });
}
check('serialize() identical', JSON.stringify(oldRun.serialized) === JSON.stringify(newRun.serialized),
  { old: JSON.stringify(oldRun.serialized).slice(0, 500), new: JSON.stringify(newRun.serialized).slice(0, 500) });

// Explicit boundary probes on both
for (const [label, Model] of [['OLD', OldModel], ['NEW', NewModel]] as const) {
  const m = new Model(null) as unknown as M;
  m.setPlayerPos(1.5, 5.0); // exactly 6 tiles from receiver
  check(`${label} jam@exact6 == E_ILLEGAL_TARGET`, m.jam('relay').code === 'E_ILLEGAL_TARGET', { code: m.jam('relay').code });
}
console.log(`OLD_VS_NEW_SLICE_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
