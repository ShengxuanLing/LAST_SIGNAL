// C3c final boundary — Dev snapshot/restore action boundary, incomplete vs replayable
// export, and historical-event mutation probe (frozen 4cb59e9).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/4cb59e9';
const out = { meta: { target: '4cb59e9', surface: 'Dev (--dev)' }, checks: [], steps: [], findings: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-final-boundary/dev.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const aid = () => `aid_${hex(12)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new Client({ name: 'c3c-boundary-dev', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [SNAP + '/dist-mcp/worldHeadlessMcpServer.mjs', '--dev'], cwd: SNAP, env: { ...process.env }, stderr: 'pipe' }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text ?? '';
  let b; try { b = JSON.parse(t); } catch { b = { __raw: t }; }
  return { isError: !!r.isError, body: b };
};
const create = async (seed) => (await call('world_headless_create_session', { seed })).body;
const close = async (s) => { if (s) await call('world_close', { session: s.session }).catch(() => {}); };
const step = async (s, ep, ticks, requestId = reqId(), intent) => (await call('world_headless_step', { session: s.session, epoch: ep, requestId, ticks, ...(intent ? { intent } : {}) })).body;
const dummy = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
const move = { ...dummy, move: { x: 1, y: 0 } };
const SEED = 424242;

// ---------- boundary: mid-execution snapshot refused, queue survives, then restore ----------
const A = await create(SEED);
await call('world_action', { session: A.session, epoch: A.epoch, requestId: reqId(), actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 120 }] });
const a10 = await step(A, A.epoch, 10);
const midSnap = await call('world_headless_dev_snapshot', { session: A.session });
const a110 = await step(A, A.epoch, 110);
const okSnap = await call('world_headless_dev_snapshot', { session: A.session });
const restored = await call('world_headless_dev_restore', { session: A.session, frame: okSnap.body.frame });
out.steps.push({
  name: 'boundary',
  step10: a10.executing,
  midSnap: { isError: midSnap.isError, code: midSnap.body.code },
  step110: a110.applied,
  okSnap: { ok: okSnap.body.ok, boundary: okSnap.body.boundary, hasFrame: !!okSnap.body.frame },
  restore: { ok: restored.body.ok, epoch: restored.body.epoch, oldEpoch: A.epoch }
});
check('mid-execution-snapshot-refused', midSnap.isError === true && midSnap.body.code === 'E_NOT_APPLICABLE', { code: midSnap.body.code });
check('snapshot-refusal-does-not-cancel-action', a110.applied?.length === 1 && a110.applied[0].executedTicks === 120, a110.applied);
check('boundary-snapshot-ok', okSnap.body.ok === true && okSnap.body.boundary === 'action' && !!okSnap.body.frame, { boundary: okSnap.body.boundary });
check('boundary-restore-epoch-plus-one', restored.body.ok === true && restored.body.epoch === A.epoch + 1, { old: A.epoch, new: restored.body.epoch });
const epochA = restored.body.epoch;
check('restore-at-same-boundary-tick', (await call('world_observe', { session: A.session })).body.observation.tick === 120, {});

// control session B: same seed, same steps, no restore
const B = await create(SEED);
await call('world_action', { session: B.session, epoch: B.epoch, requestId: reqId(), actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 120 }] });
await step(B, B.epoch, 120);
// next identical action after restore vs without restore
const nextAction = async (s, ep) => {
  await call('world_action', { session: s.session, epoch: ep, requestId: reqId(), actions: [{ type: 'move', actionId: aid(), dir: { x: 0, y: 1 }, ticks: 30 }] });
  return step(s, ep, 30);
};
const aNext = await nextAction(A, epochA);
const bNext = await nextAction(B, B.epoch);
out.steps.push({ name: 'next-action', aTick: aNext.toTick, bTick: bNext.toTick, aApplied: aNext.applied, bApplied: bNext.applied });
check('next-action-same-state-as-no-restore', aNext.canonicalState === bNext.canonicalState, { equal: aNext.canonicalState === bNext.canonicalState });
check('next-action-same-events-as-no-restore', aNext.canonicalEvents === bNext.canonicalEvents, { equal: aNext.canonicalEvents === bNext.canonicalEvents });

// ---------- incomplete export is explicitly not restorable ----------
await call('world_action', { session: A.session, epoch: epochA, requestId: reqId(), actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 120 }] });
await step(A, epochA, 10);
const incomplete = await call('world_headless_dev_export_failure', { session: A.session, reason: 'tester-incomplete-mid-execution' });
const incBundle = JSON.parse(readFileSync(incomplete.body.path, 'utf8'));
const incompleteFrame = incBundle.frame;
copyFileSync(incomplete.body.path, 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-final-boundary/incomplete-failure-bundle.json');
out.findings.push({ id: 'export-incomplete', boundary: incomplete.body.boundary, replayable: incomplete.body.replayable, diagnostics: incomplete.body.diagnostics, hasFrameBoundary: incompleteFrame ? (incompleteFrame.boundary ?? null) : null, path: incomplete.body.path });
check('incomplete-export-marked-not-replayable', incomplete.body.boundary === 'mid_execution' && incomplete.body.replayable === false && (incompleteFrame?.boundary ?? null) === null, { boundary: incomplete.body.boundary, replayable: incomplete.body.replayable });
// a different BOUNDARY session must refuse the incomplete frame
const C = await create(SEED + 1);
const refuseIncomplete = await call('world_headless_dev_restore', { session: C.session, frame: incompleteFrame });
check('incomplete-frame-restore-refused', refuseIncomplete.isError === true && refuseIncomplete.body.code === 'E_NOT_APPLICABLE', { code: refuseIncomplete.body.code });
// the incomplete export did not cancel the still-running action
const aDone = await step(A, epochA, 110);
check('incomplete-export-did-not-cancel-action', aDone.applied?.length === 1 && aDone.applied[0].executedTicks === 120, aDone.applied);
// boundary export is replayable + restorable
const boundaryExp = await call('world_headless_dev_export_failure', { session: A.session, reason: 'tester-boundary' });
const bndBundle = JSON.parse(readFileSync(boundaryExp.body.path, 'utf8'));
const boundaryFrame = bndBundle.frame;
copyFileSync(boundaryExp.body.path, 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-final-boundary/boundary-failure-bundle.json');
check('boundary-export-marked-replayable', boundaryExp.body.boundary === 'action' && boundaryExp.body.replayable === true && boundaryFrame?.boundary === 'action', { boundary: boundaryExp.body.boundary, replayable: boundaryExp.body.replayable, frameBoundary: boundaryFrame?.boundary ?? null });
const stepsForReplay = [{ ticks: 20, intent: move }, { ticks: 20, intent: { ...dummy, move: { x: 0, y: 1 } } }];
// make the live session legitimately reach that state
for (const st of stepsForReplay) await step(A, epochA, st.ticks, reqId(), st.intent);
const replayOk = await call('world_headless_dev_replay', { session: A.session, frame: boundaryFrame, steps: stepsForReplay });
const tamperedSteps = stepsForReplay.map((x, i) => i === 1 ? { ...x, intent: { ...dummy, fire: true } } : x);
const replayBad = await call('world_headless_dev_replay', { session: A.session, frame: boundaryFrame, steps: tamperedSteps });
out.steps.push({ name: 'boundary-replay', same: [replayOk.body.sameState, replayOk.body.sameEvents, replayOk.body.firstDivergence], tampered: [replayBad.body.sameState, replayBad.body.sameEvents, replayBad.body.firstDivergence] });
check('boundary-export-replay-same', replayOk.body.sameState === true && replayOk.body.sameEvents === true && replayOk.body.firstDivergence === null, { sameState: replayOk.body.sameState, firstDivergence: replayOk.body.firstDivergence });
check('boundary-export-tamper-diverges', replayBad.body.sameState === false && replayBad.body.firstDivergence !== null, { sameState: replayBad.body.sameState, firstDivergence: replayBad.body.firstDivergence });
const restoreBoundary = await call('world_headless_dev_restore', { session: C.session, frame: boundaryFrame });
check('boundary-frame-restore-ok', restoreBoundary.body.ok === true && restoreBoundary.body.epoch === C.epoch + 1, { epoch: restoreBoundary.body.epoch, old: C.epoch });

// ---------- historical events must not mutate after later ticks ----------
for (const s of [A, B, C]) await close(s);
const H = await create(SEED + 7);
// real shot so projectile-spawned events exist
const hObs = (await call('world_observe', { session: H.session })).body.observation;
const target = hObs.drones?.[0] ?? { x: hObs.player.x + 2, y: hObs.player.y };
await call('world_action', { session: H.session, epoch: H.epoch, requestId: reqId(), actions: [{ type: 'fire', actionId: aid(), target: { x: target.x, y: target.y }, ticks: 120 }] });
const hStep = await step(H, H.epoch, 120);
const stepEventsJson = JSON.stringify(hStep.events ?? []);
const snap1 = await call('world_headless_dev_snapshot', { session: H.session });
const ev1 = snap1.body.frame.events ?? [];
const ev1Json = JSON.stringify(ev1);
const projEvents1 = ev1.filter((e) => e.type === 'projectile-spawned').map((e) => ({ id: e.projectile?.id, pos: e.projectile?.pos, lifetime: e.projectile?.lifetime }));
// continue real ticks: projectiles move/expire, drones act
for (let i = 0; i < 4; i += 1) await step(H, H.epoch, 200);
const snap2 = await call('world_headless_dev_snapshot', { session: H.session });
const ev2 = snap2.body.frame.events ?? [];
let firstEventDiff = null;
for (let i = 0; i < Math.min(ev1.length, ev2.length); i += 1) {
  if (JSON.stringify(ev1[i]) !== JSON.stringify(ev2[i])) { firstEventDiff = i; break; }
}
const projEvents2 = ev2.filter((e) => e.type === 'projectile-spawned').slice(0, projEvents1.length).map((e) => ({ id: e.projectile?.id, pos: e.projectile?.pos, lifetime: e.projectile?.lifetime }));
out.steps.push({
  name: 'event-history',
  stepEventsCount: (hStep.events ?? []).length,
  snap1Events: ev1.length,
  snap2Events: ev2.length,
  firstEventDiff,
  stepEventsUnchangedInSnap1: stepEventsJson === JSON.stringify(ev1.slice(-(hStep.events ?? []).length)),
  projEvents1,
  projEvents2,
  projMutated: JSON.stringify(projEvents1) !== JSON.stringify(projEvents2)
});
out.findings.push({ id: 'event-history-mutation', text: 'recorded history in a later snapshot differs from the earlier snapshot', firstEventDiff, projMutated: JSON.stringify(projEvents1) !== JSON.stringify(projEvents2), projEvents1, projEvents2, snap1Events: ev1.length, snap2Events: ev2.length });
check('history-events-immutable', firstEventDiff === null && JSON.stringify(projEvents1) === JSON.stringify(projEvents2), { firstEventDiff, projEvents1, projEvents2 });

await close(H);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-final-boundary/dev.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), findings: out.findings.map((f) => f.id) }, null, 2));
await client.close();
process.exit(0);
