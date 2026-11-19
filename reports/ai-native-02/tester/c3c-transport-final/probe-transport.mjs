// C3c transport/canonical final (frozen 87d6ae0, Dev): ref/file cross-session
// canonical equality, tamper, ref eviction, path guard, and a real >20k-event
// stdio run with bounded responses, paging, snapshot-ref/restore and export flags.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/87d6ae0';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-transport-final';
const FRAME_DIR = path.join(SNAP, 'reports/ai-native-02/c3c/frames');
const out = { meta: { target: '87d6ae026bdafa8fef0350dcc91a84d9974b9db1', functional: ['f5629ef', '3058348', 'b3b0e00'], surface: 'Dev' }, checks: [], steps: [], findings: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync(OUT + '/dev.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const aid = () => `aid_${hex(12)}`;

const client = new Client({ name: 'c3c-transport-tester', version: '1.0.0' });
const transport = new StdioClientTransport({ command: 'node', args: [SNAP + '/dist-mcp/worldHeadlessMcpServer.mjs', '--dev'], cwd: SNAP, env: { ...process.env }, stderr: 'pipe' });
await client.connect(transport);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text ?? '';
  let b; try { b = JSON.parse(t); } catch { b = { __raw: t }; }
  return { isError: !!r.isError, body: b, len: t.length };
};
const create = async (seed) => (await call('world_headless_create_session', { seed })).body;
const close = async (s) => { if (s) await call('world_close', { session: s.session }).catch(() => {}); };
const step = async (s, ep, ticks, requestId = reqId(), intent) => (await call('world_headless_step', { session: s.session, epoch: ep, requestId, ticks, ...(intent ? { intent } : {}) })).body;
const state = async (s) => (await call('world_headless_dev_state', { session: s.session })).body;
const dummy = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
const down = { ...dummy, move: { x: 0, y: 1 } };
const right = { ...dummy, move: { x: 1, y: 0 } };
const SEED = 424242;
const steps = [{ ticks: 20, intent: down }, { ticks: 15, intent: right }];

// ---------- A. canonical/ref cross-session + replay ----------
const A = await create(SEED);
await call('world_action', { session: A.session, epoch: A.epoch, requestId: reqId(), actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 120 }] });
await step(A, A.epoch, 120);
const snapA = await call('world_headless_dev_snapshot', { session: A.session });
const stateA = await state(A);
out.steps.push({ name: 'snapshot', snap: { ref: snapA.body.ref, frameBytes: snapA.body.frameBytes, truncated: snapA.body.eventsTruncated }, hasInlineFrame: 'frame' in snapA.body, stateFingerprint: stateA.stateFingerprint });
check('snapshot-returns-ref-not-inline-frame', typeof snapA.body.ref === 'string' && !('frame' in snapA.body), { keys: Object.keys(snapA.body) });
check('snapshot-hash-matches-dev-state', snapA.body.stateFingerprint === stateA.stateFingerprint, { snap: snapA.body.stateFingerprint, state: stateA.stateFingerprint });

const C = await create(SEED + 55);
const restoredC = await call('world_headless_dev_restore', { session: C.session, ref: snapA.body.ref });
const stateC = await state(C);
out.steps.push({ name: 'restore-ref', epoch: restoredC.body.epoch, old: C.epoch, hashEqual: stateC.stateFingerprint === snapA.body.stateFingerprint, stateFingerprint: stateC.stateFingerprint });
check('restore-ref-bumps-epoch', restoredC.body.ok === true && restoredC.body.epoch === C.epoch + 1, { old: C.epoch, new: restoredC.body.epoch });
check('restore-ref-cross-session-hash-equal', stateC.stateFingerprint === snapA.body.stateFingerprint, { before: snapA.body.stateFingerprint, after: stateC.stateFingerprint });

for (const st of steps) await step(A, A.epoch, st.ticks, reqId(), st.intent);
for (const st of steps) await step(C, restoredC.body.epoch, st.ticks, reqId(), st.intent);
const stateA2 = await state(A);
const stateC2 = await state(C);
const replayA = await call('world_headless_dev_replay', { session: A.session, ref: snapA.body.ref, steps });
out.steps.push({ name: 'same-actions', aState: stateA2.stateFingerprint, cState: stateC2.stateFingerprint, aEvents: stateA2.eventsFingerprint, cEvents: stateC2.eventsFingerprint, replay: { sameState: replayA.body.sameState, sameEvents: replayA.body.sameEvents, historyPreserved: replayA.body.historyPreserved, firstDivergence: replayA.body.firstDivergence } });
check('cross-session-state-equal', stateA2.stateFingerprint === stateC2.stateFingerprint, { a: stateA2.stateFingerprint, c: stateC2.stateFingerprint });
check('cross-session-events-equal', stateA2.eventsFingerprint === stateC2.eventsFingerprint, { a: stateA2.eventsFingerprint, c: stateC2.eventsFingerprint });
check('ref-replay-same-state-events', replayA.body.sameState === true && replayA.body.sameEvents === true && replayA.body.firstDivergence === null, { sameState: replayA.body.sameState, sameEvents: replayA.body.sameEvents, firstDivergence: replayA.body.firstDivergence });

// ---------- B. frame file + restore_file + replay_file ----------
const expA = await call('world_headless_dev_frame_export', { session: A.session, ref: snapA.body.ref });
const framePath = expA.body.path;
const bytes = expA.body.bytes;
out.steps.push({ name: 'frame-export', path: framePath, bytes, underFrameDir: framePath.startsWith(FRAME_DIR) });
check('frame-export-owner-path', typeof framePath === 'string' && framePath.startsWith(FRAME_DIR) && bytes > 0 && !('frame' in expA.body), { path: framePath, bytes });
const D = await create(1);
const restoreD = await call('world_headless_dev_restore_file', { session: D.session, path: framePath });
const stateD = await state(D);
check('restore-file-bumps-epoch-and-hash', restoreD.body.ok === true && restoreD.body.epoch === D.epoch + 1 && stateD.stateFingerprint === snapA.body.stateFingerprint, { epoch: restoreD.body.epoch, hashEqual: stateD.stateFingerprint === snapA.body.stateFingerprint });
const replayFileA = await call('world_headless_dev_replay_file', { session: A.session, path: framePath, steps });
out.steps.push({ name: 'replay-file', sameState: replayFileA.body.sameState, sameEvents: replayFileA.body.sameEvents });
check('replay-file-same-state-events', replayFileA.body.sameState === true && replayFileA.body.sameEvents === true, { sameState: replayFileA.body.sameState, sameEvents: replayFileA.body.sameEvents });

// tamper a REAL payload value in the event prefix -> firstDivergence at that index
mkdirSync(FRAME_DIR, { recursive: true });
const frameObj = JSON.parse(readFileSync(framePath, 'utf8'));
const tampered = JSON.parse(JSON.stringify(frameObj));
const eventIndex = 7;
if (tampered.events?.[eventIndex]) {
  const e = tampered.events[eventIndex];
  if (e.type === 'player-moved') e.position = { x: e.position.x + 3, y: e.position.y };
  else if (e.type === 'drone-step') e.step = { ...e.step, stateTimer: (e.step.stateTimer ?? 0) + 1 };
  else e.type = 'tampered-event';
}
const tamperedPath = path.join(FRAME_DIR, 'tester-tampered-prefix.frame.json');
writeFileSync(tamperedPath, JSON.stringify(tampered));
const replayTampered = await call('world_headless_dev_replay_file', { session: A.session, path: tamperedPath, steps });
out.steps.push({ name: 'tamper-prefix', eventIndex, historyPreserved: replayTampered.body.historyPreserved, firstDivergence: replayTampered.body.firstDivergence });
check('tampered-real-payload-first-divergence', replayTampered.body.historyPreserved === false && replayTampered.body.firstDivergence === eventIndex, { expect: eventIndex, got: replayTampered.body.firstDivergence });
// tamper a real STATE value -> sameState false (events unchanged)
const tamperedState = JSON.parse(JSON.stringify(frameObj));
tamperedState.sim.player.data.hp = Math.max(1, tamperedState.sim.player.data.hp - 7);
const tamperedStatePath = path.join(FRAME_DIR, 'tester-tampered-state.frame.json');
writeFileSync(tamperedStatePath, JSON.stringify(tamperedState));
const replayTamperedState = await call('world_headless_dev_replay_file', { session: A.session, path: tamperedStatePath, steps });
check('tampered-state-value-detected', replayTamperedState.body.sameState === false, { sameState: replayTamperedState.body.sameState, firstDivergence: replayTamperedState.body.firstDivergence });

// ---------- C. path traversal + ref eviction ----------
const outside = [
  path.join(SNAP, 'reports/ai-native-02/c3c/failures/x.json'),
  path.join(SNAP, 'package.json'),
  path.join(SNAP, 'reports/ai-native-02/c3c/frames/../../failures/x.json'),
  'D:/Windows/win.ini'
];
const traversal = [];
for (const p of outside) {
  const r = await call('world_headless_dev_restore_file', { session: D.session, path: p });
  traversal.push({ path: p, code: r.body.code, denied: r.isError && r.body.code === 'E_PERMISSION' });
}
out.steps.push({ name: 'path-guard', traversal, legalOk: restoreD.body.ok });
check('path-traversal-denied', traversal.every((t) => t.denied), traversal);
check('legal-path-still-works', restoreD.body.ok === true, { ok: restoreD.body.ok });

// ref cap = 2 -> creating 3 snapshots evicts the oldest ref
await step(A, A.epoch, 1, reqId(), dummy);
const refs = [];
for (let i = 0; i < 3; i += 1) {
  const s = await call('world_headless_dev_snapshot', { session: A.session });
  refs.push({ ref: s.body.ref, ok: s.body.ok });
}
const evicted = await call('world_headless_dev_restore', { session: D.session, ref: refs[0].ref });
const latest = await call('world_headless_dev_restore', { session: D.session, ref: refs[2].ref });
out.steps.push({ name: 'ref-eviction', refs, evicted: { isError: evicted.isError, code: evicted.body.code }, latestOk: latest.body.ok });
check('old-ref-evicted', evicted.isError === true && evicted.body.code === 'E_SNAPSHOT_INVALID', { code: evicted.body.code });
check('latest-ref-works', latest.body.ok === true, { ok: latest.body.ok });
await close(A); await close(C); await close(D);

// ---------- D. real >20k events over stdio ----------
const E = await create(SEED + 9);
let ep = E.epoch;
let maxLen = 0;
let eventTotal = 0;
const stepSamples = [];
for (let i = 0; i < 80 && eventTotal <= 26000; i += 1) {
  const r = await call('world_headless_step', { session: E.session, epoch: ep, requestId: reqId(), ticks: 300, intent: dummy });
  if (r.isError) { out.findings.push({ id: 'stdio-closed', at: i, code: r.body.code }); break; }
  maxLen = Math.max(maxLen, r.len);
  eventTotal = r.body.eventTotal ?? 0;
  stepSamples.push({ i, tick: r.body.toTick, eventTotal, len: r.len });
}
out.steps.push({ name: 'long-run', steps: stepSamples.length, eventTotal, maxResponseBytes: maxLen, lastTick: stepSamples.at(-1)?.tick });
check('stdio-survives-beyond-20k-events', eventTotal > 20000, { eventTotal, steps: stepSamples.length });
check('per-response-bounded', maxLen <= 512 * 1024, { maxLen });

const summary = await call('world_headless_dev_events_summary', { session: E.session });
out.steps.push({ name: 'summary', summary: summary.body });
check('summary-total-truncated-accurate', summary.body.eventTotal > 20000 && summary.body.eventsRetained === 20000 && summary.body.eventsTruncated === true && summary.body.windowStart === summary.body.eventTotal - summary.body.eventsRetained, { total: summary.body.eventTotal, retained: summary.body.eventsRetained, windowStart: summary.body.windowStart, truncated: summary.body.eventsTruncated });

const firstPage = await call('world_headless_dev_events', { session: E.session, offset: 0, limit: 512 });
out.steps.push({ name: 'page-first', offset: firstPage.body.offset, requested: firstPage.body.requestedOffset, lostPrefix: firstPage.body.lostPrefix, items: firstPage.body.items?.length, nextCursor: firstPage.body.nextCursor, len: firstPage.len });
check('paging-reports-lost-prefix', firstPage.body.requestedOffset === 0 && firstPage.body.offset === summary.body.windowStart && firstPage.body.lostPrefix === summary.body.windowStart, { offset: firstPage.body.offset, lostPrefix: firstPage.body.lostPrefix });
let cursor = firstPage.body.nextCursor;
let items = firstPage.body.items?.length ?? 0;
let maxPageLen = firstPage.len;
let pages = 1;
while (cursor !== null && pages < 200) {
  const p = await call('world_headless_dev_events', { session: E.session, offset: cursor, limit: 512 });
  if (p.isError) { out.findings.push({ id: 'page-error', cursor, code: p.body.code }); break; }
  maxPageLen = Math.max(maxPageLen, p.len);
  items += p.body.items?.length ?? 0;
  cursor = p.body.nextCursor;
  pages += 1;
}
out.steps.push({ name: 'paging', pages, items, retained: summary.body.eventsRetained, maxPageLen });
check('paging-covers-retained-window', items === summary.body.eventsRetained, { items, retained: summary.body.eventsRetained, pages });
check('page-response-bounded', maxPageLen <= 384 * 1024 + 4096, { maxPageLen });

const snapE = await call('world_headless_dev_snapshot', { session: E.session });
out.steps.push({ name: 'snapshot-20k', ref: snapE.body.ref, frameBytes: snapE.body.frameBytes, truncated: snapE.body.eventsTruncated, responseLen: snapE.len });
check('snapshot-ref-large-frame-bounded', snapE.body.ok === true && !!snapE.body.ref && snapE.body.eventsTruncated === true && snapE.len < 16 * 1024, { frameBytes: snapE.body.frameBytes, responseLen: snapE.len, truncated: snapE.body.eventsTruncated });
const F = await create(3);
const restoreF = await call('world_headless_dev_restore', { session: F.session, ref: snapE.body.ref });
out.steps.push({ name: 'restore-20k-ref', epoch: restoreF.body.epoch });
check('restore-large-ref-works', restoreF.body.ok === true, { ok: restoreF.body.ok, code: restoreF.body.code ?? null });

const expFrame = await call('world_headless_dev_frame_export', { session: E.session, ref: snapE.body.ref });
const G = await create(4);
const restoreFileG = await call('world_headless_dev_restore_file', { session: G.session, path: expFrame.body.path });
out.steps.push({ name: 'restore-20k-file', path: expFrame.body.path, bytes: expFrame.body.bytes, ok: restoreFileG.body.ok, epoch: restoreFileG.body.epoch });
check('large-frame-file-restore-works', restoreFileG.body.ok === true && expFrame.body.bytes > 0, { bytes: expFrame.body.bytes });

const failE = await call('world_headless_dev_export_failure', { session: E.session, reason: 'tester-truncated-20k' });
out.steps.push({ name: 'export-truncated', boundary: failE.body.boundary, replayable: failE.body.replayable, truncated: failE.body.eventsTruncated, note: failE.body.diagnostics?.note });
check('export-truncated-not-replayable-truthful', failE.body.replayable === false && failE.body.eventsTruncated === true && /TRUNCATED/.test(failE.body.diagnostics?.note ?? ''), { replayable: failE.body.replayable, truncated: failE.body.eventsTruncated, note: failE.body.diagnostics?.note });
await close(E); await close(F); await close(G);
const alive = await call('world_list_sessions');
check('stdio-still-alive-at-end', alive.isError === false, { sessions: alive.body.sessions?.length });

writeFileSync(OUT + '/dev.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), steps: out.steps, findings: out.findings }, null, 2));
await client.close();
process.exit(0);
