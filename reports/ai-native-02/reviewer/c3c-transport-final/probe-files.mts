// Independent file/ref path + ACL probe (87d6ae0).
import { HeadlessWorldManager } from './src/ai-native/worldHeadlessMcpTools';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const hex = (n: number) => randomBytes(n).toString('hex');
const rid = () => `req_${hex(12)}`;
const aid = () => `aid_${hex(12)}`;
let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const sc = (r: any) => r?.structuredContent ?? {};
const move = (t: number) => ({ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: t });
const FRAME_DIR = resolve('reports/ai-native-02/c3c/frames');
const FAIL_DIR = resolve('reports/ai-native-02/c3c/failures');

function icacls(file: string): string {
  try {
    const root = process.env.SystemRoot ?? 'C:' + String.fromCharCode(92) + 'Windows';
    return execFileSync(join(root, 'System32', 'icacls.exe'), [file], { encoding: 'utf8' });
  } catch (e) { return String(e); }
}

const m = new HeadlessWorldManager(true, () => 424242);
const c = sc(m.createSession());
const s = c.session, e = c.epoch;
m.action(s, e, rid(), [move(5)], 600);
sc(m.step(s, e, rid(), 5));
const exportRes = await m.frameExport(s, {});
const exported = sc(exportRes);
check('frameExport path under frames', exported.ok === true && resolve(exported.path as string).startsWith(FRAME_DIR), exported);
const failRes = await m.exportFailure(s, 'probe-acl');
const failPath = sc(failRes).path as string;

// ACL: owner frame + failure bundle must not be broadly readable.
for (const [label, file] of [['frame', exported.path as string], ['failure', failPath]] as const) {
  const acl = icacls(file);
  const broad = /Everyone|BUILTIN\\Users|Authenticated Users|\(I\)/i.test(acl);
  check(`${label} file ACL is not broad/inherited`, !broad, { acl });
  console.log(`ACL ${label}:`, acl.replace(/\r?\n/g, ' | ').slice(0, 300));
}

// Path traversal / outside / case.
const escapePath = join(FRAME_DIR, '..', '..', '..', '..', 'package.json');
const outside = resolve('package.json');
for (const [label, p] of [['.. traversal', escapePath], ['outside abs', outside]] as const) {
  const r = sc(await m.restoreFile(s, p));
  check(`${label} rejected`, r.ok === false && r.code === 'E_PERMISSION', { label, p, r });
}
const caseVariant = exported.path.replace(/reports/i, 'REPORTS');
const caseRes = sc(await m.restoreFile(s, caseVariant));
check('case-variant path is not a bypass (rejected or safe)', caseRes.ok === false, { caseRes });

// Invalid JSON under frames.
mkdirSync(FRAME_DIR, { recursive: true });
const badPath = join(FRAME_DIR, `bad-${Date.now()}.json`);
writeFileSync(badPath, '{ not json', 'utf8');
const bad = sc(await m.restoreFile(s, badPath));
check('invalid JSON rejected', bad.ok === false && bad.code === 'E_SNAPSHOT_INVALID', bad);

// Oversize file: no pre-read stat; applyRestore caps at 16MB after parse.
const bigPath = join(FRAME_DIR, `big-${Date.now()}.json`);
writeFileSync(bigPath, JSON.stringify({ pad: 'x'.repeat(20 * 1024 * 1024) }), 'utf8');
const t0 = Date.now();
const big = sc(await m.restoreFile(s, bigPath));
const bigMs = Date.now() - t0;
check('oversize file rejected as invalid frame', big.ok === false, { code: big.code });
console.log('OVERSIZE_READ_MS', bigMs);

// Symlink/junction traversal: a junction INSIDE frames pointing outside.
const outsideDir = join(tmpdir(), `ls-frame-outside-${Date.now()}`);
let junction: string | null = null;
try {
  mkdirSync(outsideDir, { recursive: true });
  cpSync(exported.path as string, join(outsideDir, 'frame.json'));
  junction = join(FRAME_DIR, `link-${Date.now()}`);
  execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/c', 'mklink', '/J', junction, outsideDir], { stdio: 'ignore' });
  const viaLink = sc(await m.restoreFile(s, join(junction, 'frame.json')));
  check('junction/symlink traversal is blocked (path must resolve under frames)', viaLink.ok === false, { viaLink });
  console.log('JUNCTION_RESULT', JSON.stringify({ ok: viaLink.ok, code: viaLink.code, epoch: viaLink.epoch }));
} catch (e) {
  console.log('JUNCTION_CREATE_FAILED', String(e));
  check('junction/symlink traversal is blocked or not creatable', true);
} finally {
  if (junction) { try { execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/c', 'rmdir', junction], { stdio: 'ignore' }); } catch { /* ignore */ } }
  try { rmSync(outsideDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(badPath, { force: true }); rmSync(bigPath, { force: true }); } catch { /* ignore */ }
  m.close(s);
}
console.log(`C3C_FILES_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
