// Historical-event immutability probe (frozen 4cb59e9, Dev surface).
// Record event JSON + a boundary frame; run more REAL ticks; verify the already
// recorded history did not change (esp. projectile-spawned pos/lifetime).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/dcb4f14';
const out = { meta: { target: '4cb59e9', probe: 'history-event-immutability' }, checks: [], findings: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-history-final/history.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const aid = () => `aid_${hex(12)}`;

const client = new Client({ name: 'c3c-history-probe', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [SNAP + '/dist-mcp/worldHeadlessMcpServer.mjs', '--dev'], cwd: SNAP, env: { ...process.env }, stderr: 'pipe' }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text ?? '';
  let b; try { b = JSON.parse(t); } catch { b = { __raw: t }; }
  return { isError: !!r.isError, body: b };
};
const step = (s, ticks) => call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks });

const created = await call('world_headless_create_session', { seed: 20260301 });
const s = created.body;
const obs = (await call('world_observe', { session: s.session })).body.observation;
const target = obs.drones?.[0] ?? { x: obs.player.x + 2, y: obs.player.y };
await call('world_action', { session: s.session, epoch: s.epoch, requestId: reqId(), actions: [{ type: 'fire', actionId: aid(), target: { x: target.x, y: target.y }, ticks: 120 }] });
const fireStep = await step(s, 120);
const snap1 = await call('world_headless_dev_snapshot', { session: s.session });
const ev1 = snap1.body.frame.events ?? [];
const stepEvents = fireStep.body.events ?? [];
const recorded = JSON.stringify(ev1);
out.checks.push({ n: 'step-events-equal-snapshot1', ok: JSON.stringify(stepEvents) === JSON.stringify(ev1.slice(-stepEvents.length)) });
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-history-final/events-snapshot1.json', JSON.stringify(ev1));

// more REAL ticks: projectiles travel / expire; drone acts; new events append
for (let i = 0; i < 3; i += 1) await step(s, 300);
const snap2 = await call('world_headless_dev_snapshot', { session: s.session });
const ev2 = snap2.body.frame.events ?? [];
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-history-final/events-snapshot2-prefix.json', JSON.stringify(ev2.slice(0, ev1.length)));

let firstDiff = null;
const diffs = [];
for (let i = 0; i < Math.min(ev1.length, ev2.length); i += 1) {
  if (JSON.stringify(ev1[i]) !== JSON.stringify(ev2[i])) {
    if (firstDiff === null) firstDiff = i;
    if (diffs.length < 5) diffs.push({ index: i, type: ev1[i]?.type, before: ev1[i], after: ev2[i] });
  }
}
const proj1 = ev1.filter((e) => e.type === 'projectile-spawned').map((e) => ({ id: e.projectile?.id, pos: e.projectile?.pos, lifetime: e.projectile?.lifetime }));
const proj2 = ev2.slice(0, ev1.length).filter((e) => e.type === 'projectile-spawned').map((e) => ({ id: e.projectile?.id, pos: e.projectile?.pos, lifetime: e.projectile?.lifetime }));
const projDiff = proj1.map((p, i) => ({ id: p.id, before: p, after: proj2[i] })).filter((x) => JSON.stringify(x.before) !== JSON.stringify(x.after));
out.findings.push({
  id: 'F-history-mutates',
  recordedPrefix: recorded.length,
  events1: ev1.length,
  events2: ev2.length,
  firstDiff,
  diffCount: diffs.length,
  diffs,
  projectileEvents: proj1.length,
  projectileMutations: projDiff.slice(0, 5),
  projectileMutationCount: projDiff.length
});
check('history-prefix-unchanged', firstDiff === null, { firstDiff, diffs });
check('projectile-events-unchanged', projDiff.length === 0, { mutated: projDiff.length, sample: projDiff.slice(0, 3) });

await call('world_close', { session: s.session });
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-history-final/history.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), finding: { firstDiff, diffCount: out.findings[0]?.diffCount, projectileMutationCount: out.findings[0]?.projectileMutationCount, sample: out.findings[0]?.projectileMutations?.[0] } }, null, 2));
await client.close();
process.exit(0);
