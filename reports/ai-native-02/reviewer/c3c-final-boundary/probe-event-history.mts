// Does a saved headless frame / historical projectile-spawned event stay immutable
// after later ticks? (snapshot/replay contract)
import { HeadlessWorld } from './src/ai-native/worldHeadless';
const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
const fire = { move: { x: 0, y: 0 }, dash: false, fire: true, aim: { x: 30, y: 42 }, interact: false };
let failures = 0; const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const w = new HeadlessWorld({ seed: 424242 });
w.runSteps([{ ticks: 1, intent: fire }], 1);
const frame = w.snapshot();
const savedSpawn: any = frame.events.find((e: any) => e.type === 'projectile-spawned');
check('frame has projectile-spawned', !!savedSpawn, { types: frame.events.map((e: any) => e.type).slice(0, 10) });
const beforeProj = savedSpawn ? JSON.stringify(savedSpawn.projectile) : '';
const beforeCanon = w.canonicalEvents();
const beforeFrameEvents = JSON.stringify(frame.events);
// Continue 40 ticks so the spawned projectile moves/expires.
w.runSteps([{ ticks: 40, intent: neutral }], 40);
const afterProj = savedSpawn ? JSON.stringify(savedSpawn.projectile) : '';
const afterFrameEvents = JSON.stringify(frame.events);
const afterCanon = w.canonicalEvents();
check('saved frame projectile-spawned payload is IMMUTABLE after later ticks', beforeProj === afterProj, { beforeProj, afterProj });
check('saved frame.events JSON is IMMUTABLE after later ticks', beforeFrameEvents === afterFrameEvents);
check('canonicalEvents historical prefix is a prefix of the later projection', afterCanon.startsWith(beforeCanon), {
  beforeLen: beforeCanon.length, afterLen: afterCanon.length
});
// Restore the saved boundary frame and inspect its historical event again.
const r = w.restore(frame);
const restoredProj = JSON.stringify((w.snapshot().events.find((e: any) => e.type === 'projectile-spawned') as any)?.projectile ?? null);
check('restore accepted', r.ok === true, r);
check('restored historical projectile equals the saved frame', restoredProj === (beforeProj || 'null'), { beforeProj, restoredProj });
console.log(`C3C_EVENT_HISTORY_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
