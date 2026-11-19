import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const SERVER = resolve(process.cwd(), 'dist-mcp/worldHeadlessMcpServer.mjs');
let failures = 0; const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
async function withClient(args: string[], run: (c: Client) => Promise<void>) {
  const t = new StdioClientTransport({ command: process.execPath, args: [SERVER, ...args], env: { ...process.env } as never, stderr: 'pipe' });
  const c = new Client({ name: 'reviewer-tools', version: '1' }); await c.connect(t);
  try { await run(c); } finally { await c.close().catch(() => undefined); }
}
await withClient([], async (client) => {
  const tools = (await client.listTools()).tools as any[];
  const names = tools.map((t) => t.name);
  check('Player has no Dev tools', !names.some((n) => n.includes('_dev_')), { names });
  check('Player has no ref/path tools', !names.some((n) => /restore_file|replay_file|frame_export|dev_events/.test(n)), { names });
  const step = tools.find((t) => t.name === 'world_headless_step');
  const props = step?.inputSchema?.properties ?? {};
  check('Player step schema has no intent', !('intent' in props), { props });
  const anyRefPath = tools.some((t) => { const p = t.inputSchema?.properties ?? {}; return 'ref' in p || 'path' in p; });
  check('Player tool schemas have no ref/path', !anyRefPath);
  console.log('PLAYER_TOOLS', names.join(','));
});
await withClient(['--dev'], async (client) => {
  const tools = (await client.listTools()).tools as any[];
  const names = tools.map((t) => t.name);
  for (const n of ['world_headless_dev_snapshot','world_headless_dev_restore','world_headless_dev_replay','world_headless_dev_frame_export','world_headless_dev_restore_file','world_headless_dev_replay_file','world_headless_dev_events']) {
    check(`Dev has ${n}`, names.includes(n), { names });
  }
  const restore = tools.find((t) => t.name === 'world_headless_dev_restore');
  check('Dev restore schema has ref/frame', 'ref' in (restore?.inputSchema?.properties ?? {}) && 'frame' in (restore?.inputSchema?.properties ?? {}));
  const replayFile = tools.find((t) => t.name === 'world_headless_dev_replay_file');
  check('Dev replay_file schema has path', 'path' in (replayFile?.inputSchema?.properties ?? {}));
  console.log('DEV_TOOLS', names.filter((n) => n.includes('_dev_')).join(','));
});
console.log(`C3C_SDK_TOOLS_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
