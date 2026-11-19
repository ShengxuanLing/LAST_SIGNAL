// Official non-Dev MCP SDK: does the Player step still accept an arbitrary intent?
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const SERVER = resolve(process.cwd(), 'dist-mcp/worldHeadlessMcpServer.mjs');
const rid = () => `req_${randomBytes(12).toString('hex')}`;
let failures=0; const check=(n:string,c:boolean,d?:unknown)=>{if(c)console.log('PASS',n);else{failures++;console.log('FAIL',n,JSON.stringify(d));}};
const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env } as never, stderr: 'pipe' });
const client = new Client({ name: 'reviewer-player-intent', version: '0.0.0' });
await client.connect(transport);
const call = async (name: string, args: any = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  return r.structuredContent ?? { ok: false, code: 'E_SCHEMA_PROTOCOL' };
};
try {
  const tools = (await client.listTools()).tools.map((t: any) => t.name);
  check('non-Dev surface has no dev tools', !tools.some((t: string) => t.includes('_dev_')), { tools });
  const c = await call('world_headless_create_session', {});
  const session = c.session, epoch = c.epoch, x0 = c.observation?.player?.x;
  const r1 = await call('world_headless_step', {
    session, epoch, requestId: rid(), ticks: 10,
    intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false }
  });
  const x1 = r1.observation?.player?.x;
  check('non-Dev SDK step ACCEPTS intent (bypasses action/TTL)', r1.ok === true && typeof x1 === 'number' && x1 !== x0, { x0, x1, ok: r1.ok, code: r1.code });
  check('non-Dev SDK step still has no canonical', r1.canonicalState === undefined && r1.canonicalEvents === undefined);
  const r2 = await call('world_headless_step', { session, epoch, requestId: rid(), ticks: 10, intent: { move: { x: 0, y: 1 }, dash: false, fire: false, aim: null, interact: false } });
  check('non-Dev SDK accepts a second arbitrary intent', r2.ok === true, { ok: r2.ok, code: r2.code });
  await call('world_close', { session });
} finally { await client.close().catch(() => undefined); }
console.log(`C3C_SDK_INTENT_${failures===0?'PASS':'FAIL'} failures=${failures}`);
if (failures>0) process.exit(1);
