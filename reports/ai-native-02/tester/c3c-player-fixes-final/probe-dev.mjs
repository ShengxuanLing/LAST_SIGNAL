// C3c Dev re-verify (frozen 8f1ce6c): split-vs-single canonical equality, restore
// during an ACTIVE action, replay + tampered divergence, short batch/perf, isolation.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/8f1ce6c';
const out = { meta: { target: '8f1ce6c', surface: 'Dev (--dev)' }, checks: [], steps: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-player-fixes-final/dev.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const aid = () => `aid_${hex(12)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new Client({ name: 'c3c-dev-reverify', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [SNAP + '/dist-mcp/worldHeadlessMcpServer.mjs', '--dev'], cwd: SNAP, env: { ...process.env }, stderr: 'pipe' }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text ?? '';
  let b; try { b = JSON.parse(t); } catch { b = { __raw: t }; }
  return { isError: !!r.isError, body: b };
};
const create = async (seed) => (await call('world_headless_create_session', { seed })).body;
const close = async (s) => { await call('world_close', { session: s.session }).catch(() => {}); };
const step = (s, ep, ticks, intent) => call('world_headless_step', { session: s.session, epoch: ep, requestId: reqId(), ticks, ...(intent ? { intent } : {}) });
const dummy = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
const moveIntent = { ...dummy, move: { x: 1, y: 0 } };

// ---------- isolation ----------
const tools = (await client.listTools()).tools.map((t) => t.name).sort();
check('dev-has-dev-tools', tools.includes('world_headless_dev_snapshot') && tools.includes('world_headless_dev_replay'), tools.filter((t) => t.includes('dev')));

// ---------- split step10+step110 == single step120 (move) ----------
const SEED = 20260214;
const A = await create(SEED);
await call('world_action', { session: A.session, epoch: A.epoch, requestId: reqId(), actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 120 }] });
const a10 = await step(A, A.epoch, 10);
const a110 = await step(A, A.epoch, 110);
const B = await create(SEED);
await call('world_action', { session: B.session, epoch: B.epoch, requestId: reqId(), actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 120 }] });
const b120 = await step(B, B.epoch, 120);
out.steps.push({ name: 'split-move', a10: { executed: a10.body.executing, applied: a10.body.applied?.length }, a110: { applied: a110.body.applied, executing: a110.body.executing }, b120: { applied: b120.body.applied, tick: b120.body.toTick, aTick: a110.body.toTick } });
check('split-step10-not-acked', (a10.body.applied ?? []).length === 0 && a10.body.executing?.executedTicks === 10, a10.body.executing);
check('split-total-applied-once', (a110.body.applied ?? []).length === 1 && a110.body.applied[0].executedTicks === 120, a110.body.applied);
check('split-equals-single-canonical-state', a110.body.canonicalState === b120.body.canonicalState, { equal: a110.body.canonicalState === b120.body.canonicalState });
check('split-equals-single-canonical-events', a110.body.canonicalEvents === b120.body.canonicalEvents, { equal: a110.body.canonicalEvents === b120.body.canonicalEvents });
check('split-equals-single-tick-status', a110.body.toTick === b120.body.toTick && a110.body.status === b120.body.status, { aTick: a110.body.toTick, bTick: b120.body.toTick, aStatus: a110.body.status, bStatus: b120.body.status });

// ---------- split step10+step110 == single step120 (fire) ----------
const C = await create(SEED + 1);
const obsC = C.observation;
const drone = obsC?.drones?.[0];
const aim = drone ? { x: drone.x, y: drone.y } : { x: obsC?.player?.x + 2, y: obsC?.player?.y };
const fireAction = { type: 'fire', actionId: aid(), target: aim, ticks: 120 };
await call('world_action', { session: C.session, epoch: C.epoch, requestId: reqId(), actions: [fireAction] });
const c10 = await step(C, C.epoch, 10);
const c110 = await step(C, C.epoch, 110);
const D = await create(SEED + 1);
const droneD = D.observation?.drones?.[0];
const aimD = droneD ? { x: droneD.x, y: droneD.y } : { x: D.observation?.player?.x + 2, y: D.observation?.player?.y };
await call('world_action', { session: D.session, epoch: D.epoch, requestId: reqId(), actions: [{ type: 'fire', actionId: aid(), target: aimD, ticks: 120 }] });
const d120 = await step(D, D.epoch, 120);
out.steps.push({ name: 'split-fire', c10: c10.body.executing, c110Applied: c110.body.applied, d120Applied: d120.body.applied });
check('split-fire-not-acked-at-10', (c10.body.applied ?? []).length === 0 && c10.body.executing?.executedTicks === 10, c10.body.executing);
check('split-fire-equals-single-state', c110.body.canonicalState === d120.body.canonicalState, { equal: c110.body.canonicalState === d120.body.canonicalState });
check('split-fire-equals-single-events', c110.body.canonicalEvents === d120.body.canonicalEvents, { equal: c110.body.canonicalEvents === d120.body.canonicalEvents });

// free session slots (MAX_SESSIONS=4) before the next phase
for (const x of [A, B, C, D]) await close(x);

// ---------- restore while an action is half-executed ----------
const R = await create(SEED + 2);
const snap = await call('world_headless_dev_snapshot', { session: R.session });
const frame = snap.body.frame;
await call('world_action', { session: R.session, epoch: R.epoch, requestId: reqId(), actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 120 }] });
const r10 = await step(R, R.epoch, 10);
const restored = await call('world_headless_dev_restore', { session: R.session, frame });
const newEpoch = restored.body.epoch;
const stale = await call('world_headless_step', { session: R.session, epoch: R.epoch, requestId: reqId(), ticks: 5 });
const afterRestore = await step(R, newEpoch, 20);
const obsAfter = await call('world_observe', { session: R.session });
const posAfter = obsAfter.body?.observation ?? null;
out.steps.push({ name: 'restore-active', snapOk: snap.body.ok, snapCode: snap.body.code ?? null, hasFrame: !!snap.body.frame, restoreOk: restored.body.ok ?? null, restoreCode: restored.body.code ?? null, half: r10.body.executing, newEpoch, stale: stale.body.code, appliedAfterRestore: afterRestore.body.applied, tick: afterRestore.body.toTick, pos: posAfter ? { x: posAfter.player.x, y: posAfter.player.y } : null, obsErr: obsAfter.body?.code ?? null, afterRestoreErr: afterRestore.body?.code ?? null, staleOk: stale.body?.ok });
check('restore-bumps-epoch-and-rejects-old', newEpoch > R.epoch && stale.isError === true && stale.body.code === 'E_STALE_EPOCH', { newEpoch, old: R.epoch, code: stale.body.code });
check('restore-clears-active-half-action', (afterRestore.body.applied ?? []).length === 0 && afterRestore.body.executing === null, { applied: afterRestore.body.applied, executing: afterRestore.body.executing });

for (const x of [R]) await close(x);

// ---------- replay: complete same state/events, tampered divergence ----------
const S = await create(SEED + 3);
const snap2 = await call('world_headless_dev_snapshot', { session: S.session });
const steps = [
  { ticks: 10, intent: moveIntent },
  { ticks: 20, intent: { ...dummy, move: { x: 0, y: 1 } } },
  { ticks: 10, intent: moveIntent }
];
for (const st of steps) await step(S, S.epoch, st.ticks, st.intent);
const rep = await call('world_headless_dev_replay', { session: S.session, frame: snap2.body.frame, steps });
const tampered = steps.map((x, i) => i === 1 ? { ...x, intent: { ...dummy, fire: true } } : x);
const rep2 = await call('world_headless_dev_replay', { session: S.session, frame: snap2.body.frame, steps: tampered });
out.steps.push({ name: 'replay', snap2Ok: snap2.body.ok, hasFrame2: !!snap2.body.frame, repCode: rep.body.code ?? null, rep2Code: rep2.body.code ?? null, same: [rep.body.sameState, rep.body.sameEvents, rep.body.firstDivergence], tampered: [rep2.body.sameState, rep2.body.sameEvents, rep2.body.firstDivergence] });
check('replay-complete-same-state-events', rep.body.sameState === true && rep.body.sameEvents === true && rep.body.firstDivergence === null, { sameState: rep.body.sameState, sameEvents: rep.body.sameEvents });
check('tampered-replay-first-divergence', rep2.body.sameState === false && rep2.body.firstDivergence !== null, { sameState: rep2.body.sameState, firstDivergence: rep2.body.firstDivergence });

// ---------- short batch / perf ----------
const batch = await call('world_headless_dev_batch', { seeds: [11, 22], maxTicks: 60 });
const perf = await call('world_headless_dev_perf', { ticks: 1000, sessions: 2 });
const p = perf.body.result;
out.steps.push({ name: 'batch-perf', batch: (batch.body.result?.runs ?? batch.body.result ?? []).map((r) => ({ seed: r.seed, status: r.status, ticks: r.ticks })), perf: { wallMs: p?.wallMs, totalEvents: p?.totalEvents, liveCombatTicks: p?.liveCombatTicks, sessions: p?.sessions } });
check('short-batch-runs', batch.body.ok === true && (batch.body.result?.runs ?? []).length === 2, (batch.body.result?.runs ?? []).length);
check('short-perf-runs', perf.body.ok === true && p?.sessions === 2 && p?.totalEvents > 0, { wallMs: p?.wallMs, events: p?.totalEvents });

// ---------- cleanup ----------
for (const s of [S]) await close(s);
const left = await call('world_list_sessions');
check('dev-cleanup', (left.body.sessions ?? []).length === 0, left.body.sessions);

writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-player-fixes-final/dev.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]) }, null, 2));
await client.close();
process.exit(0);
