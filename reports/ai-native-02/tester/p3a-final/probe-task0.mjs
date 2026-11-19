// Task0 Owner file independent checks (frozen b3930c5): ACL, junction escape,
// oversized file preflight, full MCP envelope budget, legal path restore.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/b3930c5';
const FRAME_DIR = path.join(SNAP, 'reports/ai-native-02/c3c/frames');
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-final';
const out = { checks: [], steps: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync(OUT + '/task0.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;

const client = new Client({ name: 'task0-owner-file', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [SNAP + '/dist-mcp/worldHeadlessMcpServer.mjs', '--dev'], cwd: SNAP, env: { ...process.env }, stderr: 'pipe' }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text ?? '';
  let b; try { b = JSON.parse(t); } catch { b = { __raw: t }; }
  return { isError: !!r.isError, body: b, text: t, structured: r.structuredContent ?? null };
};
const create = async (seed) => (await call('world_headless_create_session', { seed })).body;

const A = await create(424242);
await call('world_headless_step', { session: A.session, epoch: A.epoch, requestId: reqId(), ticks: 20 });
const snap = await call('world_headless_dev_snapshot', { session: A.session });
const frameExp = await call('world_headless_dev_frame_export', { session: A.session, ref: snap.body.ref });
const framePath = frameExp.body.path;
out.steps.push({ name: 'frame', path: framePath, bytes: frameExp.body.bytes, ref: snap.body.ref });

// A. ACL current-user only
const icacls = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe');
const acl = execFileSync(icacls, [framePath], { encoding: 'utf8' });
out.steps.push({ name: 'acl', acl: acl.slice(0, 400) });
check('frame-file-current-user-only', /\(F\)/.test(acl) && !/\(I\)/.test(acl) && !/BUILTIN\\Users|Authenticated Users|Everyone/i.test(acl), acl.slice(0, 300));

// B. junction escape under frames is rejected
mkdirSync(FRAME_DIR, { recursive: true });
const outside = path.join(SNAP, 'reports/ai-native-02/c3c/frames-outside');
mkdirSync(outside, { recursive: true });
writeFileSync(path.join(outside, 'frame.json'), JSON.stringify({ schema: 'x' }));
const junction = path.join(FRAME_DIR, 'tester-outside-junction');
try { spawnSync('cmd', ['/c', 'rmdir', junction], { stdio: 'ignore' }); } catch {}
const mk = spawnSync('cmd', ['/c', 'mklink', '/J', junction, outside], { encoding: 'utf8' });
const junctionFile = path.join(junction, 'frame.json');
const junctionCall = await call('world_headless_dev_restore_file', { session: A.session, path: junctionFile });
out.steps.push({ name: 'junction', created: mk.status === 0, status: mk.status, junctionFile, code: junctionCall.body.code });
check('junction-escape-rejected', junctionCall.isError === true && junctionCall.body.code === 'E_PERMISSION', { code: junctionCall.body.code });

// C. >16MiB file rejected before parse
const big = path.join(FRAME_DIR, 'tester-oversize.frame.json');
writeFileSync(big, 'x'.repeat(17 * 1024 * 1024));
const bigCall = await call('world_headless_dev_restore_file', { session: A.session, path: big });
out.steps.push({ name: 'oversize', bytes: statSync(big).size, code: bigCall.body.code });
check('oversize-frame-rejected-before-parse', bigCall.isError === true && /E_RESOURCE_LIMIT|E_PAYLOAD_TOO_LARGE/.test(bigCall.body.code ?? ''), { code: bigCall.body.code });

// D. full MCP result envelope: text + structured are both bounded
const events = await call('world_headless_dev_events', { session: A.session, offset: 0, limit: 256 });
const envBytes = Buffer.byteLength(events.text, 'utf8') + Buffer.byteLength(JSON.stringify(events.structured ?? {}), 'utf8');
out.steps.push({ name: 'envelope', textBytes: Buffer.byteLength(events.text, 'utf8'), structuredBytes: Buffer.byteLength(JSON.stringify(events.structured ?? {}), 'utf8'), total: envBytes, hasBoth: !!events.text && !!events.structured });
check('full-result-envelope-bounded', events.isError === false && !!events.text && !!events.structured && envBytes <= 512 * 1024 + 4096, { envBytes });

// E. legal path still restores
const B = await create(7);
const legal = await call('world_headless_dev_restore_file', { session: B.session, path: framePath });
out.steps.push({ name: 'legal', ok: legal.body.ok, epoch: legal.body.epoch });
check('legal-frame-file-restore-works', legal.body.ok === true, { ok: legal.body.ok, code: legal.body.code ?? null });

// F. Player face has no owner-only tools; Dev face does
const player = new Client({ name: 'task0-player', version: '1.0.0' });
await player.connect(new StdioClientTransport({ command: 'node', args: [SNAP + '/dist-mcp/worldHeadlessMcpServer.mjs'], cwd: SNAP, env: { ...process.env }, stderr: 'pipe' }));
const playerTools = (await player.listTools()).tools.map((t) => t.name).sort();
const devTools = (await client.listTools()).tools.map((t) => t.name).sort();
out.steps.push({ name: 'tool-isolation', playerTools, devTools: devTools.filter((t) => t.includes('dev_')) });
check('player-has-no-dev-file-ref-tools', !playerTools.some((t) => t.includes('dev_') || t.includes('file') || t.includes('ref')), playerTools);
check('dev-has-owner-file-tools', devTools.includes('world_headless_dev_frame_export') && devTools.includes('world_headless_dev_restore_file'), devTools.filter((t) => t.includes('file')));
await player.close();

writeFileSync(OUT + '/task0.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]) }, null, 2));
await client.close();
process.exit(0);
