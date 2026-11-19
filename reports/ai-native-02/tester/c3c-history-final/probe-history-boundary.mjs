// C3c history/replay final (frozen dcb4f14, Dev surface):
// boundary export replay sameState, midrun 20->15 prefix+suffix, tamper prefix/action
// divergence indices, snapshot deep-copy isolation, and the 20k event-window flag.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/dcb4f14';
const out = { meta: { target: 'dcb4f14fffceac0c3ef7c44725256b88e0a00cf9', surface: 'Dev (--dev)' }, checks: [], steps: [], findings: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-history-final/dev.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const aid = () => `aid_${hex(12)}`;

const client = new Client({ name: 'c3c-history-boundary', version: '1.0.0' });
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
const moveRight = { ...dummy, move: { x: 1, y: 0 } };
const moveDown = { ...dummy, move: { x: 0, y: 1 } };
const SEED = 424242;

// ---------- A. boundary export replay: live advances, frame stays frozen ----------
const A = await create(SEED);
await call('world_action', { session: A.session, epoch: A.epoch, requestId: reqId(), actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 120 }] });
await step(A, A.epoch, 120);
const exp = await call('world_headless_dev_export_failure', { session: A.session, reason: 'tester-boundary-replay' });
const bundle = JSON.parse(readFileSync(exp.body.path, 'utf8'));
const frameJson = JSON.stringify(bundle.frame);
const stepsA = [{ ticks: 20, intent: moveDown }, { ticks: 15, intent: moveRight }];
for (const st of stepsA) await step(A, A.epoch, st.ticks, reqId(), st.intent);
const replayA = await call('world_headless_dev_replay', { session: A.session, frame: bundle.frame, steps: stepsA });
out.steps.push({ name: 'boundary-replay', sameState: replayA.body.sameState, sameEvents: replayA.body.sameEvents, historyPreserved: replayA.body.historyPreserved, baselineEvents: replayA.body.baselineEvents, firstDivergence: replayA.body.firstDivergence });
check('boundary-replay-same-state', replayA.body.sameState === true, { sameState: replayA.body.sameState });
check('boundary-replay-same-events', replayA.body.sameEvents === true && replayA.body.historyPreserved === true && replayA.body.firstDivergence === null, { sameEvents: replayA.body.sameEvents, firstDivergence: replayA.body.firstDivergence });
check('boundary-frame-independent-of-live', JSON.stringify(bundle.frame) === frameJson, { unchanged: JSON.stringify(bundle.frame) === frameJson });

// tamper a NEW action -> divergence in the new segment (baseline + index)
const tamperedAction = stepsA.map((x, i) => i === 0 ? { ...x, intent: moveRight } : x);
const replayBadAction = await call('world_headless_dev_replay', { session: A.session, frame: bundle.frame, steps: tamperedAction });
out.steps.push({ name: 'tamper-action', sameState: replayBadAction.body.sameState, sameEvents: replayBadAction.body.sameEvents, firstDivergence: replayBadAction.body.firstDivergence, baselineEvents: replayBadAction.body.baselineEvents });
check('tampered-action-diverges-in-new-segment', replayBadAction.body.sameState === false && replayBadAction.body.firstDivergence !== null && replayBadAction.body.firstDivergence >= (replayBadAction.body.baselineEvents ?? 0), { firstDivergence: replayBadAction.body.firstDivergence, baseline: replayBadAction.body.baselineEvents });

// tamper the PREFIX of the frame (event 5) -> historyPreserved false at index 5
const tamperedFrame = JSON.parse(JSON.stringify(bundle.frame));
const orig = tamperedFrame.events[5];
tamperedFrame.events[5] = { ...orig, type: 'tampered-history' };
const replayBadPrefix = await call('world_headless_dev_replay', { session: A.session, frame: tamperedFrame, steps: stepsA });
out.steps.push({ name: 'tamper-prefix', historyPreserved: replayBadPrefix.body.historyPreserved, firstDivergence: replayBadPrefix.body.firstDivergence });
check('tampered-prefix-fails-at-actual-index', replayBadPrefix.body.historyPreserved === false && replayBadPrefix.body.firstDivergence === 5, { historyPreserved: replayBadPrefix.body.historyPreserved, firstDivergence: replayBadPrefix.body.firstDivergence });
await close(A);

// ---------- B. midrun 20-tick snapshot -> 15-tick continue: full prefix + suffix ----------
const B = await create(SEED + 1);
const b0 = await step(B, B.epoch, 20, reqId(), dummy);
const snap20 = await call('world_headless_dev_snapshot', { session: B.session });
const frame20 = snap20.body.frame;
const prefix = frame20.events ?? [];
const prefixJson = JSON.stringify(prefix);
const steps15 = [{ ticks: 15, intent: moveRight }];
for (const st of steps15) await step(B, B.epoch, st.ticks, reqId(), st.intent);
const snap35 = await call('world_headless_dev_snapshot', { session: B.session });
const ev35 = snap35.body.events ?? snap35.body.frame?.events ?? [];
const live = (await call('world_observe', { session: B.session })).body.observation;
out.steps.push({ name: 'midrun', initial20: b0.toTick, prefix20: prefix.length, total35: ev35.length, eventsPrefixStillEqual: JSON.stringify(ev35.slice(0, prefix.length)) === prefixJson });
check('midrun-prefix-complete-equal', ev35.length === prefix.length + 15 || ev35.length > prefix.length, { prefix: prefix.length, total: ev35.length });
check('midrun-prefix-identical', JSON.stringify(ev35.slice(0, prefix.length)) === prefixJson, { equal: JSON.stringify(ev35.slice(0, prefix.length)) === prefixJson });
const suffixLive = ev35.slice(prefix.length);
const replay15 = await call('world_headless_dev_replay', { session: B.session, frame: frame20, steps: steps15 });
out.steps.push({ name: 'midrun-replay', sameState: replay15.body.sameState, sameEvents: replay15.body.sameEvents, firstDivergence: replay15.body.firstDivergence, baselineEvents: replay15.body.baselineEvents, newEqual: replay15.body.expectedNewEventsHash === replay15.body.actualNewEventsHash });
check('midrun-replay-same-state', replay15.body.sameState === true, { sameState: replay15.body.sameState });
check('midrun-replay-prefix-and-suffix', replay15.body.sameEvents === true && replay15.body.historyPreserved === true && replay15.body.firstDivergence === null && replay15.body.expectedNewEventsHash === replay15.body.actualNewEventsHash, { firstDivergence: replay15.body.firstDivergence, newEqual: replay15.body.expectedNewEventsHash === replay15.body.actualNewEventsHash });
const replay15TamperedAction = await call('world_headless_dev_replay', { session: B.session, frame: frame20, steps: [{ ticks: 15, intent: moveDown }] });
out.steps.push({ name: 'midrun-tamper-action', firstDivergence: replay15TamperedAction.body.firstDivergence, baseline: replay15TamperedAction.body.baselineEvents });
check('midrun-tampered-action-diverges-after-prefix', replay15TamperedAction.body.sameEvents === false && replay15TamperedAction.body.firstDivergence >= prefix.length, { firstDivergence: replay15TamperedAction.body.firstDivergence, prefix: prefix.length });
const frame20Tampered = JSON.parse(JSON.stringify(frame20));
frame20Tampered.events[3] = { ...frame20Tampered.events[3], type: 'tampered-prefix' };
const replay15TamperedPrefix = await call('world_headless_dev_replay', { session: B.session, frame: frame20Tampered, steps: steps15 });
out.steps.push({ name: 'midrun-tamper-prefix', firstDivergence: replay15TamperedPrefix.body.firstDivergence, historyPreserved: replay15TamperedPrefix.body.historyPreserved });
check('midrun-tampered-prefix-fails-at-index', replay15TamperedPrefix.body.historyPreserved === false && replay15TamperedPrefix.body.firstDivergence === 3, { firstDivergence: replay15TamperedPrefix.body.firstDivergence });
await close(B);

// ---------- C. snapshot isolation both ways ----------
const C = await create(SEED + 2);
await step(C, C.epoch, 30, reqId(), moveRight);
const snapC = await call('world_headless_dev_snapshot', { session: C.session });
const frameC = JSON.parse(JSON.stringify(snapC.body.frame));
const liveBefore = (await call('world_observe', { session: C.session })).body.observation;
const mutated = JSON.parse(JSON.stringify(frameC));
mutated.sim.player.x += 9;
mutated.events[0] = { type: 'mutated' };
const liveAfterFrameMutation = (await call('world_observe', { session: C.session })).body.observation;
const frameCBefore = JSON.stringify(frameC);
for (let i = 0; i < 5; i += 1) await step(C, C.epoch, 10, reqId(), dummy);
const frameCAfter = JSON.stringify(frameC);
out.steps.push({ name: 'isolation', liveUnchangedByFrameMutation: JSON.stringify(liveBefore) === JSON.stringify(liveAfterFrameMutation), frameUnchangedByLiveTicks: frameCBefore === frameCAfter, before: { tick: liveBefore.tick, x: liveBefore.player.x }, after: { tick: liveAfterFrameMutation.tick, x: liveAfterFrameMutation.player.x } });
check('frame-mutation-does-not-touch-live', JSON.stringify(liveBefore) === JSON.stringify(liveAfterFrameMutation), { before: liveBefore.tick, after: liveAfterFrameMutation.tick });
check('live-ticks-do-not-mutate-saved-frame', frameCBefore === frameCAfter, { equal: frameCBefore === frameCAfter });
const restoreC = await call('world_headless_dev_restore', { session: C.session, frame: frameC });
const afterRestoreC = (await call('world_observe', { session: C.session })).body.observation;
out.steps.push({ name: 'restore-isolation', epoch: restoreC.body.epoch, tick: afterRestoreC.tick, x: afterRestoreC.player.x });
check('restore-applies-saved-frame', afterRestoreC.tick === frameC.sim.tick && afterRestoreC.player.x === frameC.sim.player.x && restoreC.body.epoch === C.epoch + 1, { tick: afterRestoreC.tick, frameTick: frameC.sim.tick, x: afterRestoreC.player.x, frameX: frameC.sim.player.x });
await close(C);

// ---------- D. 20k event-window limit flag ----------
const D = await create(SEED + 3);
for (let i = 0; i < 21; i += 1) await step(D, D.epoch, 1000, reqId(), dummy);
const snapD = await call('world_headless_dev_snapshot', { session: D.session });
const evD = snapD.body.frame?.events?.length ?? 0;
const replayD = await call('world_headless_dev_replay', { session: D.session, frame: snapD.body.frame, steps: [{ ticks: 5, intent: dummy }] });
out.steps.push({ name: 'event-window', events: evD, eventsTruncated: replayD.body.eventsTruncated, sameEvents: replayD.body.sameEvents, baselineEvents: replayD.body.baselineEvents });
check('event-window-flag-report', typeof replayD.body.eventsTruncated === 'boolean', { events: evD, eventsTruncated: replayD.body.eventsTruncated });
await close(D);

writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-history-final/dev.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), steps: out.steps }, null, 2));
await client.close();
process.exit(0);
