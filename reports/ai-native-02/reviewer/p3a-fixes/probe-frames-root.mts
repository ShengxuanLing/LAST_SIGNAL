import { HeadlessWorldManager, isSafeFramesRoot } from './src/ai-native/worldHeadlessMcpTools';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, renameSync, readFileSync, existsSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const FRAMES = resolve('reports/ai-native-02/c3c/frames');
const OUTSIDE = resolve('reports/ai-native-02/c3c/frames-root-outside-reviewer');
const JUNCTION = resolve('reports/ai-native-02/c3c/frames-root-junction-reviewer');
const SAVE = resolve('reports/ai-native-02/c3c/frames-saved-reviewer');

const rm = (p: string) => { try { rmSync(p, { recursive: true, force: true }); } catch {} };
const rmdirJ = (p: string) => { try { execFileSync('cmd', ['/c', 'rmdir', p], { stdio: 'ignore' }); } catch {} };

// clean slate (only my own artifacts)
rmdirJ(JUNCTION); rm(OUTSIDE); rm(SAVE);
mkdirSync(FRAMES, { recursive: true });
check('plain frames root is accepted', await isSafeFramesRoot(FRAMES));
check('a regular file is not a frames root', !(await isSafeFramesRoot(resolve('package.json'))));

const m = new HeadlessWorldManager(true, () => 424242);
const created = m.createSession();
const sc = created.structuredContent as any;
check('dev session created', !!sc?.session, { sc });
const session = sc.session as string;
const exp = await m.frameExport(session, {});
const expSc = exp.structuredContent as any;
check('frameExport produced an owner file', !!expSc?.path, { expSc });
const framePath = expSc.path as string;
const frameText = readFileSync(framePath, 'utf8');

// Control: restoreFile through the plain root succeeds.
const control = await m.restoreFile(session, framePath);
check('restoreFile through a plain frames root is allowed', !(control.isError ?? false), { code: (control.structuredContent as any)?.code, text: (control.content as any)?.[0]?.text?.slice(0, 120) });

// Now replace the REAL FRAME_DIR with a junction to an outside directory holding the same frame.
mkdirSync(OUTSIDE, { recursive: true });
writeFileSync(join(OUTSIDE, 'escape-frame.json'), frameText, 'utf8');
renameSync(FRAMES, SAVE);
let junctionCreated = false;
try {
  execFileSync('cmd', ['/c', 'mklink', '/J', JUNCTION, OUTSIDE], { stdio: 'ignore' });
  // FRAME_DIR is fixed; alias it by creating the junction AT the fixed path.
  // (rename can't overlap; instead point the fixed path to outside via a junction)
  junctionCreated = true;
} catch (e) { console.log('JUNCTION_CREATE_ERROR', String(e).slice(0, 200)); }
// Move junction to the exact FRAME_DIR path.
if (junctionCreated) {
  rmdirJ(JUNCTION);
  try {
    execFileSync('cmd', ['/c', 'mklink', '/J', FRAMES, OUTSIDE], { stdio: 'ignore' });
  } catch (e) { console.log('JUNCTION_AT_ROOT_ERROR', String(e).slice(0, 200)); }
}
const lstat = (() => { try { const s = lstatSync(FRAMES); return { isDir: s.isDirectory(), isLink: s.isSymbolicLink() }; } catch (e) { return { err: String(e) }; } })();
console.log('ROOT_LSTAT', JSON.stringify(lstat));
check('isSafeFramesRoot rejects the junction at the real FRAME_DIR', !(await isSafeFramesRoot(FRAMES)));
const escaped = await m.restoreFile(session, join(FRAMES, 'escape-frame.json'));
const escapedErr = escaped.isError === true || (escaped.structuredContent as any)?.code === 'E_PERMISSION';
check('restoreFile rejects a junction ROOT escape with E_PERMISSION', escapedErr, { code: (escaped.structuredContent as any)?.code, text: (escaped.content as any)?.[0]?.text?.slice(0, 160) });

// cleanup: remove junction at fixed path, restore the original plain dir
rmdirJ(FRAMES);
if (existsSync(SAVE)) renameSync(SAVE, FRAMES);
rm(OUTSIDE);
check('plain frames root restored', await isSafeFramesRoot(FRAMES));
m.close(session);
console.log(`FRAMES_ROOT_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
