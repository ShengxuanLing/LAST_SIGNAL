import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const SERVER = resolve(process.cwd(), 'dist-mcp/worldHeadlessMcpServer.mjs');
const rid = () => `req_${randomBytes(12).toString('hex')}`;
const aid = () => `aid_${randomBytes(12).toString('hex')}`;
let failures = 0; const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
async function withClient(args: string[], run: (client: Client) => Promise<void>) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER, ...args], env: { ...process.env } as never, stderr: 'pipe' });
  const client = new Client({ name: 'reviewer-history', version: '1' });
  await client.connect(transport);
  try { await run(client); } finally { await client.close().catch(() => undefined); }
}
const call = async (client: Client, name: string, args: any = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  return r.structuredContent ?? { ok: false, code: 'E_SCHEMA_PROTOCOL' };
};
const move = (ticks: number) => ({ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks });
await withClient(['--dev'], async (client) => {
  const c = await call(client, 'world_headless_create_session', {});
  const s = c.session, e = c.epoch;
  await call(client, 'world_action', { session: s, epoch: e, requestId: rid(), actions: [move(10)], ttlTicks: 600 });
  await call(client, 'world_headless_step', { session: s, epoch: e, requestId: rid(), ticks: 10 });
  const snap = await call(client, 'world_headless_dev_snapshot', { session: s });
  check('Dev boundary snapshot ok', snap.ok === true && snap.boundary === 'action' && snap.frame?.boundary === 'action', { ok: snap.ok, boundary: snap.boundary });
  const epochBefore = (await call(client, 'world_observe', { session: s })).epoch;
  await call(client, 'world_action', { session: s, epoch: e, requestId: rid(), actions: [move(10)], ttlTicks: 600 });
  await call(client, 'world_headless_step', { session: s, epoch: e, requestId: rid(), ticks: 10 });
  const rep = await call(client, 'world_headless_dev_replay', { session: s, frame: snap.frame, steps: [{ ticks: 10, intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false } }] });
  check('Dev mid-run replay sameState', rep.sameState === true, { sameState: rep.sameState });
  check('Dev mid-run replay sameEvents/history', rep.sameEvents === true && rep.historyPreserved === true && rep.firstDivergence === null, { sameEvents: rep.sameEvents, historyPreserved: rep.historyPreserved, firstDivergence: rep.firstDivergence });
  const exp = await call(client, 'world_headless_dev_export_failure', { session: s, reason: 'probe-sdk-boundary' });
  check('Dev boundary export replayable', exp.replayable === true && exp.boundary === 'action', { replayable: exp.replayable, boundary: exp.boundary });
  const saved = JSON.parse(readFileSync(exp.path as string, 'utf8'));
  check('exported bundle frame is action-boundary', saved.frame?.boundary === 'action', { frameBoundary: saved.frame?.boundary });
  const restored = await call(client, 'world_headless_dev_restore', { session: s, frame: saved.frame });
  check('restore exported boundary frame ok and epoch++', restored.ok === true && restored.epoch > epochBefore, { epochBefore, restored });
  // Run the SAME action on the restored world, then replay the start frame.
  await call(client, 'world_action', { session: s, epoch: restored.epoch, requestId: rid(), actions: [move(10)], ttlTicks: 600 });
  await call(client, 'world_headless_step', { session: s, epoch: restored.epoch, requestId: rid(), ticks: 10 });
  const rep2 = await call(client, 'world_headless_dev_replay', { session: s, frame: saved.frame, steps: [{ ticks: 10, intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false } }] });
  check('replay from exported boundary frame ok', rep2.sameState === true && rep2.sameEvents === true, { sameState: rep2.sameState, sameEvents: rep2.sameEvents, firstDivergence: rep2.firstDivergence });
  await call(client, 'world_close', { session: s });
});
await withClient([], async (client) => {
  const c = await call(client, 'world_headless_create_session', {});
  const s = c.session, e = c.epoch;
  const st = await call(client, 'world_headless_step', { session: s, epoch: e, requestId: rid(), ticks: 5 });
  check('Player step still has no canonical', st.ok === true && st.canonicalState === undefined && st.canonicalEvents === undefined, { keys: Object.keys(st) });
  const obs = await call(client, 'world_observe', { session: s });
  check('Player observe still has no canonical', obs.ok === true && obs.canonicalState === undefined && obs.canonicalEvents === undefined);
  await call(client, 'world_close', { session: s });
});
console.log(`C3C_SDK_HISTORY_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
