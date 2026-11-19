import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const SERVER = resolve(process.cwd(), 'dist-mcp/worldHeadlessMcpServer.mjs');
const rid = () => `req_${randomBytes(12).toString('hex')}`;
const aid = () => `aid_${randomBytes(12).toString('hex')}`;
let failures = 0; const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
async function withClient(args: string[], run: (client: Client) => Promise<void>) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER, ...args], env: { ...process.env } as never, stderr: 'pipe' });
  const client = new Client({ name: 'reviewer-schema', version: '1' });
  await client.connect(transport);
  try { await run(client); } finally { await client.close().catch(() => undefined); }
}
const call = async (client: Client, name: string, args: any = {}) => {
  try { const r: any = await client.callTool({ name, arguments: args }); return r.structuredContent ?? { ok: false, code: 'E_SCHEMA_PROTOCOL', isError: r.isError }; }
  catch (e) { return { ok: false, code: 'E_SCHEMA_THROW', message: String(e) }; }
};
const stepSchema = async (client: Client) => {
  const tools = (await client.listTools()).tools;
  const t: any = tools.find((x: any) => x.name === 'world_headless_step');
  return t?.inputSchema ?? null;
};
await withClient([], async (client) => {
  const schema = await stepSchema(client);
  const hasIntent = !!(schema?.properties && (schema.properties as any).intent);
  check('Player SDK step schema does NOT expose intent', !hasIntent, { schema });
  const c = await call(client, 'world_headless_create_session', {});
  const s = c.session, e = c.epoch, x0 = c.observation?.player?.x;
  const r = await call(client, 'world_headless_step', { session: s, epoch: e, requestId: rid(), ticks: 5, intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false } });
  check('Player SDK step WITH intent is rejected at schema/protocol layer', r.ok === false, { r });
  const neutral = await call(client, 'world_headless_step', { session: s, epoch: e, requestId: rid(), ticks: 5 });
  check('Player SDK neutral step works and does not move', neutral.ok === true && neutral.observation?.player?.x === x0, { x0, after: neutral.observation?.player?.x });
  await call(client, 'world_action', { session: s, epoch: e, requestId: rid(), actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 10 }], ttlTicks: 600 });
  const acted = await call(client, 'world_headless_step', { session: s, epoch: e, requestId: rid(), ticks: 10 });
  check('Player SDK action+step moves the player', acted.ok === true && acted.observation?.player?.x !== x0, { x0, after: acted.observation?.player?.x, applied: acted.applied });
  await call(client, 'world_close', { session: s });
});
await withClient(['--dev'], async (client) => {
  const schema = await stepSchema(client);
  const hasIntent = !!(schema?.properties && (schema.properties as any).intent);
  check('Dev SDK step schema DOES expose intent', hasIntent, { schema });
  const c = await call(client, 'world_headless_create_session', {});
  const s = c.session, e = c.epoch, x0 = c.observation?.player?.x;
  const r = await call(client, 'world_headless_step', { session: s, epoch: e, requestId: rid(), ticks: 5, intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false } });
  check('Dev SDK step(intent) still accepted and moves', r.ok === true && r.observation?.player?.x !== x0, { x0, after: r.observation?.player?.x });
  await call(client, 'world_close', { session: s });
});
console.log(`C3C_SDK_SCHEMA_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
