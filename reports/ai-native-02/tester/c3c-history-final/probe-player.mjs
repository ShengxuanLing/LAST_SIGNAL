// C3c final boundary — Player channel guard (frozen 4cb59e9).
// Official SDK, no browser: direct intent rejected BEFORE tick/quota/queue work,
// action+step still work, cached replay text/structured still cropped.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/dcb4f14';
const out = { meta: { target: 'dcb4f14fffceac0c3ef7c44725256b88e0a00cf9', surface: 'Player (no --dev)' }, checks: [], steps: [], findings: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-history-final/player.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const aid = () => `aid_${hex(12)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new Client({ name: 'c3c-boundary-player', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [SNAP + '/dist-mcp/worldHeadlessMcpServer.mjs'], cwd: SNAP, env: { ...process.env }, stderr: 'pipe' }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text ?? '';
  let b; try { b = JSON.parse(t); } catch { b = { __raw: t }; }
  return { isError: !!r.isError, body: b, text: t, structured: r.structuredContent ?? null };
};
const banned = ['canonicalState', 'canonicalEvents', 'seed', 'map', 'rngState', 'pendingCommands', 'purchaseTransactions'];
const scan = (v, path = '$', hits = []) => {
  if (!v || typeof v !== 'object') return hits;
  if (Array.isArray(v)) { v.forEach((x, i) => scan(x, `${path}[${i}]`, hits)); return hits; }
  for (const [k, val] of Object.entries(v)) { if (banned.includes(k)) hits.push(`${path}.${k}`); scan(val, `${path}.${k}`, hits); }
  return hits;
};
const tool = (await client.listTools()).tools.find((t) => t.name === 'world_headless_step');
out.steps.push({ name: 'schema', stepInputKeys: Object.keys(tool.inputSchema?.properties ?? {}) });
check('player-step-schema-has-no-intent', !('intent' in (tool.inputSchema?.properties ?? {})), tool.inputSchema?.properties);

const created = await call('world_headless_create_session', {});
const s = created.body;
check('create-ok', created.body.ok === true, { session: s.session });
const obs = async () => (await call('world_observe', { session: s.session })).body.observation;

// queue a real action first; a rejected direct intent must not consume it
await call('world_action', { session: s.session, epoch: s.epoch, requestId: reqId(), actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 120 }] });
const before = await obs();
const rejected = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 10, intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false } });
const afterReject = await obs();
out.steps.push({ name: 'reject-intent', isError: rejected.isError, raw: rejected.text.slice(0, 180), tickBefore: before.tick, tickAfter: afterReject.tick, xBefore: before.player.x, xAfter: afterReject.player.x });
check('player-direct-intent-rejected', rejected.isError === true && /intent|Unrecognized key|validation/i.test(rejected.text), rejected.text.slice(0, 160));
check('rejected-intent-no-tick-no-move', afterReject.tick === before.tick && afterReject.player.x === before.player.x, { before: { tick: before.tick, x: before.player.x }, after: { tick: afterReject.tick, x: afterReject.player.x } });

// many rejected calls must not consume the request quota or clear the queued action
for (let i = 0; i < 300; i += 1) {
  await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 1, intent: { move: { x: 0, y: 1 }, dash: false, fire: false, aim: null, interact: false } });
}
const complete = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 120 });
const finalObs = await obs();
out.steps.push({ name: 'queue-intact', applied: complete.body.applied, executing: complete.body.executing, tick: complete.body.toTick, moved: +(finalObs.player.x - before.player.x).toFixed(4) });
check('queue-intact-after-300-rejections', complete.isError === false && complete.body.applied?.length === 1 && complete.body.applied[0].executedTicks === 120, { applied: complete.body.applied, code: complete.body.code });
check('rejected-calls-do-not-charge-quota', complete.isError === false, { code: complete.body.code ?? null });

// cached replay raw text/structured: still no canonical / owner state
const R = reqId();
const first = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: R, ticks: 1 });
const replay = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: R, ticks: 1 });
const hits = [...new Set([...scan(first.structured ?? {}, 'structured'), ...scan(replay.structured ?? {}, 'structured/replay')])];
const replayKeys = Object.keys(replay.body ?? {});
out.steps.push({ name: 'cached-replay', replayed: replay.body.replayed, keys: replayKeys, hits });
check('cached-replay-no-canonical', replay.body.replayed === true && !replayKeys.includes('canonicalState') && !replayKeys.includes('canonicalEvents') && hits.length === 0, { keys: replayKeys, hits });
check('cached-replay-no-double-advance', replay.body.toTick === first.body.toTick, { first: first.body.toTick, replay: replay.body.toTick });

await call('world_close', { session: s.session });
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-history-final/player.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]) }, null, 2));
await client.close();
process.exit(0);
