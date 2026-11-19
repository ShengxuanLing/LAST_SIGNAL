// Independent C3c history/replay probe (dcb4f14).
import { HeadlessWorld } from './src/ai-native/worldHeadless';
import { HeadlessWorldManager } from './src/ai-native/worldHeadlessMcpTools';
import { randomBytes } from 'node:crypto';

const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
const hex = (n: number) => randomBytes(n).toString('hex');
const rid = () => `req_${hex(12)}`;
const aid = () => `aid_${hex(12)}`;
let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const sc = (r: any) => r?.structuredContent ?? {};

// ---------- A) snapshot frame/events/actionLog immutable after 40 / 900 ticks ----------
{
  const w = new HeadlessWorld({ seed: 424242 });
  const d = w.observation().drones?.[0];
  if (d) w.runSteps([{ ticks: 10, intent: { move: { x: 0, y: 0 }, dash: false, fire: true, aim: { x: d.x, y: d.y }, interact: false } }], 10);
  w.runSteps([{ ticks: 5, intent: neutral }], 5);
  const frame = w.snapshot();
  const snap40 = JSON.stringify(frame);
  const proj = frame.events.find((e: any) => e.type === 'projectile-spawned') as any;
  const proj40 = proj ? JSON.stringify(proj.projectile) : '';
  w.runSteps([{ ticks: 40, intent: neutral }], 40);
  check('frame (events/actionLog/sim) unchanged after 40 ticks', JSON.stringify(frame) === snap40);
  check('saved projectile-spawned DTO unchanged after 40 ticks', !proj || JSON.stringify(proj.projectile) === proj40);
  w.runSteps([{ ticks: 860, intent: neutral }], 860);
  check('frame unchanged after 900 total ticks', JSON.stringify(frame) === snap40);
  check('saved projectile-spawned DTO unchanged after 900 ticks', !proj || JSON.stringify(proj.projectile) === proj40);
}

// ---------- B) restore / fromFrame input-output isolation ----------
{
  const w = new HeadlessWorld({ seed: 424242 });
  w.runSteps([{ ticks: 20, intent: neutral }], 20);
  const frame = w.snapshot();
  const frameJson = JSON.stringify(frame);
  const restored = w.restore(frame);
  check('restore accepted', restored.ok === true);
  // Mutate the INPUT frame after restore; the world must not change.
  (frame.events[0] as any).type = 'MUTATED_INPUT';
  check('mutating input frame after restore does not change world', !JSON.stringify(w.snapshot().events[0]).includes('MUTATED_INPUT'));
  // Mutate the world after snapshot; the saved frame must not change.
  const frame2 = w.snapshot();
  const frame2Json = JSON.stringify(frame2);
  (w as any).sim.player.x += 3;
  check('mutating live world after snapshot does not change saved frame', JSON.stringify(frame2) === frame2Json);
  // fromFrame isolation: input mutation must not change the copy.
  const source = w.snapshot();
  const copy = HeadlessWorld.fromFrame(source, false);
  (source.events[0] as any).type = 'MUTATED_SOURCE';
  check('fromFrame input mutation does not change the copy', !JSON.stringify(copy.snapshot().events[0]).includes('MUTATED_SOURCE'));
  // Copy mutation must not change a fresh source frame.
  const source2 = w.snapshot();
  const src2Json = JSON.stringify(source2);
  const copy2 = HeadlessWorld.fromFrame(source2, false);
  (copy2 as any).sim.player.x += 5;
  check('copy mutation does not change the source frame', JSON.stringify(source2) === src2Json);
}

// ---------- C) unlisted event nesting: drone-step / hit ----------
{
  const w = new HeadlessWorld({ seed: 424242 });
  w.runSteps([{ ticks: 1, intent: neutral }], 1);
  const droneStep: any = w.snapshot().events.find((e: any) => e.type === 'drone-step');
  check('drone-step event exists', !!droneStep);
  const before = droneStep ? JSON.stringify(droneStep) : '';
  const drone: any = (w as any).sim.drones[0];
  if (drone) drone.data.patrolPoints.push({ x: 999, y: 999 });
  const after = droneStep ? JSON.stringify(droneStep) : '';
  check('drone-step DTO has NO live patrolPoints nesting', before === after, { beforeLen: before.length, afterLen: after.length });
  // hit DTOs: player-hurt / enemy-hit are fresh value objects.
  const w2 = new HeadlessWorld({ seed: 424242 });
  const d2 = w2.observation().drones?.[0];
  if (d2) w2.runSteps([{ ticks: 30, intent: { move: { x: 0, y: 0 }, dash: false, fire: true, aim: { x: d2.x, y: d2.y }, interact: false } }], 30);
  const hitEv: any = w2.snapshot().events.find((e: any) => e.type === 'enemy-hit' || e.type === 'player-hurt');
  if (hitEv?.hit) {
    const hb = JSON.stringify(hitEv);
    (w2 as any).sim.player.x += 1;
    check('hit DTO has NO live player nesting', JSON.stringify(hitEv) === hb);
  } else {
    console.log('SKIP hit DTO (none in this seed/step)');
  }
}

// ---------- D) mid-run replay 20+15: positive + tampered baseline/subsequent ----------
{
  const w = new HeadlessWorld({ seed: 424242 });
  w.runSteps([{ ticks: 20, intent: neutral }], 20);
  const frame = w.snapshot();
  const steps = [{ ticks: 10, intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false } }, { ticks: 5, intent: neutral }];
  w.runSteps(steps, 15);
  const pos = w.replay(frame, steps);
  check('mid-run replay sameState', pos.sameState === true, { sameState: pos.sameState });
  check('mid-run replay sameEvents (full history)', pos.sameEvents === true, { sameEvents: pos.sameEvents, firstDivergence: pos.firstDivergence });
  check('mid-run replay historyPreserved', pos.historyPreserved === true, { historyPreserved: pos.historyPreserved, baseline: pos.baselineEvents });
  check('mid-run replay firstDivergence null', pos.firstDivergence === null, { firstDivergence: pos.firstDivergence });
  // Tamper the baseline (frame history).
  const badFrame = w.snapshot();
  if (badFrame.events.length > 0) (badFrame.events[0] as any).type = 'TAMPERED_BASELINE';
  const negBase = w.replay(badFrame, steps);
  check('tampered baseline -> historyPreserved=false', negBase.historyPreserved === false, { historyPreserved: negBase.historyPreserved });
  check('tampered baseline -> firstDivergence at exact index 0', negBase.firstDivergence === 0, { firstDivergence: negBase.firstDivergence });
  // Tamper a subsequent action (different move dir).
  const badSteps = [{ ticks: 10, intent: { move: { x: -1, y: 0 }, dash: false, fire: false, aim: null, interact: false } }, { ticks: 5, intent: neutral }];
  const negNew = w.replay(frame, badSteps);
  check('tampered subsequent action -> sameEvents=false', negNew.sameEvents === false, { sameEvents: negNew.sameEvents });
  check('tampered subsequent action -> firstDivergence at baseline+', negNew.firstDivergence !== null && negNew.firstDivergence >= negNew.baselineEvents, { firstDivergence: negNew.firstDivergence, baseline: negNew.baselineEvents });
}

// ---------- E) 20k truncation: must not be replayable:true fake-consistent ----------
{
  const m = new HeadlessWorldManager(true, () => 424242);
  const c = sc(m.createSession());
  const s = c.session, e = c.epoch;
  // Run real ticks until the retained event window is full (20k).
  for (let i = 0; i < 30; i++) {
    const r = sc(m.step(s, e, rid(), 1000, neutral));
    if (r.ok === false) break;
    if ((m as any).sessions.get(s)?.world?.eventsCount >= 20000) break;
  }
  const eventsCount = (m as any).sessions.get(s)?.world?.eventsCount ?? 0;
  check('reached the 20k event window', eventsCount >= 20000, { eventsCount });
  const snap = sc(m.snapshot(s));
  check('20k boundary snapshot is still marked boundary', snap.ok === true && snap.boundary === 'action', { ok: snap.ok, code: snap.code, boundary: snap.boundary });
  const exp = sc(await m.exportFailure(s, 'probe-20k'));
  check('20k export marks eventsTruncated', exp.diagnostics?.eventsTruncated === true, { diag: exp.diagnostics });
  check('20k export does NOT claim replayable:true', exp.replayable !== true, { replayable: exp.replayable, diag: exp.diagnostics });
  const rep = w20kReplay(m, s, e, neutral);
  check('20k replay reports eventsTruncated', rep.eventsTruncated === true, { eventsTruncated: rep.eventsTruncated, baseline: rep.baselineEvents });
  check('20k replay does NOT claim sameEvents:true', rep.sameEvents !== true, { sameEvents: rep.sameEvents, firstDivergence: rep.firstDivergence });
  m.close(s);
}
function w20kReplay(m: HeadlessWorldManager, s: string, e: number, intent: any) {
  const rec: any = (m as any).sessions.get(s);
  const frame = rec.world.snapshot();
  // Advance the ORIGINAL world past the snapshot so truncation actually drops
  // the oldest events, then replay the same 5 steps from the frame.
  rec.world.runSteps([{ ticks: 5, intent }], 5);
  return rec.world.replay(frame, [{ ticks: 5, intent }]);
}

console.log(`C3C_HISTORY_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
