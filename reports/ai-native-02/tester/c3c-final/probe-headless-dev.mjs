// C3-c headless DEV harness — official MCP SDK client, no browser.
// snapshot/restore/replay, own failure bundle, tampered replay divergence, batch/
// compare/perf (1000 & 10000 ticks x 10 sessions), load_room/spawn, epoch bump.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/82734f6';
const ENTRY = SNAP + '/dist-mcp/worldHeadlessMcpServer.mjs';
const out = { meta: { target: '82734f639b5efa6683fd0ac046fa10ac93d9516a', surface: 'Dev (--dev), official MCP SDK, no browser' }, checks: [], steps: [], findings: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-final/dev.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const actId = () => `aid_${hex(12)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new Client({ name: 'c3c-dev-tester', version: '1.0.0' });
const transport = new StdioClientTransport({ command: 'node', args: [ENTRY, '--dev'], cwd: SNAP, env: { ...process.env }, stderr: 'pipe' });
await client.connect(transport);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  let body; try { body = JSON.parse(text); } catch { body = { __raw: text }; }
  return { isError: !!r.isError, body, structured: r.structuredContent ?? null };
};
const intent = { move: { x: 1, y: 0 }, dash: false, fire: true, aim: null, interact: false };

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
out.steps.push({ name: 'dev-tools', tools });
check('dev-tools-registered', tools.includes('world_headless_dev_snapshot') && tools.includes('world_headless_dev_export_failure') && tools.includes('world_headless_dev_perf'), tools);

// ---------- create with seed (dev only), snapshot/step/restore ----------
const created = await call('world_headless_create_session', { seed: 424242 });
check('dev-create-with-seed', created.body.ok === true && created.body.seed === 424242, { seed: created.body.seed, session: created.body.session });
const s = created.body.session;
let ep = created.body.epoch;
const snap = await call('world_headless_dev_snapshot', { session: s });
check('dev-snapshot-frame', snap.body.ok === true && typeof snap.body.frame === 'object', { bytes: snap.body.frameBytes });
const frame = snap.body.frame;
const stepA = await call('world_headless_step', { session: s, epoch: ep, requestId: reqId(), ticks: 20, intent });
const tickAfter = stepA.body.toTick;
const restored = await call('world_headless_dev_restore', { session: s, frame });
ep = restored.body.epoch;
const obsAfterRestore = await call('world_observe', { session: s });
out.steps.push({ name: 'restore', tickAfter, restoreEpoch: ep, restoredTick: obsAfterRestore.body.observation?.tick, status: restored.body.status });
check('dev-restore-bumps-epoch', ep > created.body.epoch, { before: created.body.epoch, after: ep });
check('dev-restore-rewinds-tick', obsAfterRestore.body.observation?.tick === 0, { tick: obsAfterRestore.body.observation?.tick });

// ---------- replay: same state/events, then tampered divergence ----------
const steps = [
  { ticks: 20, intent },
  { ticks: 20, intent: { move: { x: 0, y: 1 }, dash: false, fire: false, aim: null, interact: false } },
  { ticks: 20, intent }
];
// the live session must legitimately reach the same state/events first
for (const st of steps) {
  const r = await call('world_headless_step', { session: s, epoch: ep, requestId: reqId(), ticks: st.ticks, intent: st.intent });
  if (r.body.epoch) ep = r.body.epoch;
}
const replay = await call('world_headless_dev_replay', { session: s, frame, steps });
const rp = replay.body.replay ?? replay.body;
out.steps.push({ name: 'replay', sameState: rp.sameState, sameEvents: rp.sameEvents, firstDivergence: rp.firstDivergence ?? null });
check('dev-replay-same-state-events', rp.sameState === true && rp.sameEvents === true, { sameState: rp.sameState, sameEvents: rp.sameEvents });
check('dev-replay-no-divergence', rp.firstDivergence == null, rp.firstDivergence ?? null);
const tampered = steps.map((x, i) => i === 1 ? { ticks: 20, intent: { move: { x: 1, y: 1 }, dash: false, fire: true, aim: null, interact: false } } : x);
const replay2 = await call('world_headless_dev_replay', { session: s, frame, steps: tampered });
const rp2 = replay2.body.replay ?? replay2.body;
out.steps.push({ name: 'replay-tampered', sameState: rp2.sameState, sameEvents: rp2.sameEvents, firstDivergence: rp2.firstDivergence ?? null });
check('dev-tampered-replay-diverges', rp2.sameState === false && rp2.firstDivergence != null, { sameState: rp2.sameState, firstDivergence: rp2.firstDivergence });

// ---------- own failure bundle ----------
const fail = await call('world_headless_dev_export_failure', { session: s, reason: 'tester-self-repro' });
out.steps.push({ name: 'export-failure', path: fail.body.path, bytes: fail.body.bytes });
check('dev-export-failure', fail.body.ok === true && typeof fail.body.path === 'string' && existsSync(fail.body.path), { path: fail.body.path, bytes: fail.body.bytes });

// ---------- load real room + spawn real enemies ----------
const lr = await call('world_headless_dev_load_room', { session: s, roomId: 2, kinds: ['drone', 'hunter'] });
check('dev-load-room', lr.body.ok === true, lr.body.code ?? null);
const sp = await call('world_headless_dev_spawn_enemies', { session: s, kinds: ['hunter', 'sentinel'] });
check('dev-spawn-enemies', sp.body.ok === true, sp.body.code ?? null);

// ---------- batch / compare ----------
const batch = await call('world_headless_dev_batch', { seeds: [11, 22, 33], maxTicks: 60, policy: 'seek-and-fire' });
const batchRuns = Array.isArray(batch.body.result) ? batch.body.result : batch.body.result?.runs;
out.steps.push({ name: 'batch', runs: (batchRuns ?? []).map((r) => ({ seed: r.seed, status: r.status, ticks: r.ticks, kills: r.kills })) });
check('dev-batch', batch.body.ok === true && Array.isArray(batchRuns) && batchRuns.length === 3, out.steps.find((x) => x.name === 'batch').runs);
const cmp = await call('world_headless_dev_compare', { seeds: [11, 22], maxTicks: 120 });
const cmpRes = cmp.body.result;
out.steps.push({ name: 'compare', result: cmpRes });
check('dev-compare-baselines', cmp.body.ok === true && Array.isArray(cmpRes?.results) && cmpRes.results.length === 2, cmpRes?.results?.map((r) => r.policy));

// ---------- perf 1000 x 10 and 10000 x 10 ----------
const perf1 = await call('world_headless_dev_perf', { ticks: 1000, sessions: 10 });
const p1 = perf1.body.result ?? perf1.body.perf ?? perf1.body;
check('dev-perf-1000x10', perf1.body.ok === true && p1.wallMs > 0 && p1.totalEvents > 0 && p1.runs?.length === 10, { wallMs: p1.wallMs, cpuUserMs: p1.cpuUserMs, heapUsedBytes: p1.heapUsedBytes, totalEvents: p1.totalEvents, liveCombatTicks: p1.liveCombatTicks, sessions: p1.sessions });
out.steps.push({ name: 'perf-1000-10', perf: { wallMs: p1.wallMs, cpuUserMs: p1.cpuUserMs, cpuSystemMs: p1.cpuSystemMs, heapUsedBytes: p1.heapUsedBytes, heapUsedTotalBytes: p1.heapUsedTotalBytes, totalEvents: p1.totalEvents, totalKills: p1.totalKills, totalShots: p1.totalShots, liveCombatTicks: p1.liveCombatTicks, sessions: p1.sessions, ticksPerSession: p1.ticksPerSession, runCount: p1.runs?.length } });
const perf2 = await call('world_headless_dev_perf', { ticks: 10000, sessions: 10 });
const p2 = perf2.body.result ?? perf2.body.perf ?? perf2.body;
check('dev-perf-10000x10', perf2.body.ok === true && p2.wallMs > 0 && p2.totalEvents > 0 && p2.runs?.length === 10, { wallMs: p2.wallMs, cpuUserMs: p2.cpuUserMs, heapUsedBytes: p2.heapUsedBytes, totalEvents: p2.totalEvents, liveCombatTicks: p2.liveCombatTicks, sessions: p2.sessions });
out.steps.push({ name: 'perf-10000-10', perf: { wallMs: p2.wallMs, cpuUserMs: p2.cpuUserMs, cpuSystemMs: p2.cpuSystemMs, heapUsedBytes: p2.heapUsedBytes, heapUsedTotalBytes: p2.heapUsedTotalBytes, totalEvents: p2.totalEvents, totalKills: p2.totalKills, totalShots: p2.totalShots, liveCombatTicks: p2.liveCombatTicks, sessions: p2.sessions, ticksPerSession: p2.ticksPerSession, runCount: p2.runs?.length } });

// ---------- cleanup: close every live session, verify list is empty ----------
const list = await call('world_list_sessions');
for (const sess of list.body.sessions ?? []) await call('world_close', { session: sess.session }).catch(() => {});
const listAfter = await call('world_list_sessions');
const cleaned = await call('world_headless_dev_inspect', { session: s });
check('dev-cleanup-all-closed', (listAfter.body.sessions ?? []).length === 0, listAfter.body.sessions);
check('dev-session-gone-after-close', cleaned.isError === true, cleaned.body);

out.steps.push({ name: 'signal', status: await call('world_signal_status', {}) });
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-final/dev.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), perf: out.steps.filter((x) => x.name.startsWith('perf')) }, null, 2));
await client.close();
process.exit(0);
