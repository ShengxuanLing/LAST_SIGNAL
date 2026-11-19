// Independent probe for C3-c headless Player surface:
// 1) non-Dev step raw result leaks canonicalState/canonicalEvents;
// 2) step10 of a fire120 marks "applied executedTicks=10" and drops the remaining 110;
// 3) stepCache 128 FIFO eviction lets an old requestId advance the world again.
import { HeadlessWorldManager } from './src/ai-native/worldHeadlessMcpTools';
import { randomBytes } from 'node:crypto';

const hex = (n: number) => randomBytes(n).toString('hex');
const aid = () => `aid_${hex(12)}`;
const rid = () => `req_${hex(12)}`;
let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log('PASS', name);
  else { failures++; console.log('FAIL', name, JSON.stringify(detail)); }
};
const sc = (r: any) => r?.structuredContent ?? {};

// Non-Dev manager == official Player surface.
const m = new HeadlessWorldManager(false, () => 123456789);
const created = m.createSession();
const c = sc(created);
const session = c.session as string, epoch = c.epoch as number;
const drone = (c.observation?.drones ?? [])[0];
console.log('create:', JSON.stringify({ session, epoch, tick: c.tick, drones: c.observation?.drones ?? [] }));

// ---- 1) canonical leak in non-Dev step ----
const stepReq = rid();
const s10 = m.step(session, epoch, stepReq, 10);
const s10c = sc(s10);
check('non-Dev step returns canonicalState (LEAK)', typeof s10c.canonicalState === 'string' && s10c.canonicalState.length > 0, {
  keys: Object.keys(s10c)
});
check('non-Dev step returns canonicalEvents (LEAK)', typeof s10c.canonicalEvents === 'string' && s10c.canonicalEvents.length > 0, {
  canonicalEventsLen: typeof s10c.canonicalEvents === 'string' ? s10c.canonicalEvents.length : null
});
const text = (s10 as any)?.content?.[0]?.text ?? '';
check('MCP content text also contains canonicalState (LEAK)', text.includes('canonicalState'), { textHead: text.slice(0, 120) });

// ---- 2) fire120 split into step10 + step110: premature applied, duration lost ----
const fireM = new HeadlessWorldManager(false, () => 123456789);
const fCreated = sc(fireM.createSession());
const fSession = fCreated.session as string, fEpoch = fCreated.epoch as number;
const fDrone = (fCreated.observation?.drones ?? [])[0];
const target = { x: fDrone.x, y: fDrone.y };
fireM.action(fSession, fEpoch, rid(), [{ type: 'fire', actionId: aid(), target, ticks: 120 }], 600);
const part1 = sc(fireM.step(fSession, fEpoch, rid(), 10));
const applied1 = (part1.applied ?? [])[0];
check('step10 ACKs fire120 as applied with executedTicks=10', applied1?.executedTicks === 10, { applied: part1.applied });
const dronesAfter10 = part1.observation?.drones?.length ?? -1;
const part2 = sc(fireM.step(fSession, fEpoch, rid(), 110));
const dronesAfter110 = part2.observation?.drones?.length ?? -1;
const applied2 = (part2.applied ?? [])[0];
check('step110 after premature ACK has no continued action', applied2 === undefined, { applied2 });
check('split 10+110 does NOT kill the fire120 target (duration lost)', dronesAfter110 > 0, {
  dronesAfter10, dronesAfter110, hp: part2.observation?.drones?.[0]?.hp
});

// Single 120-tick step in a fresh identical session should kill it.
const singleM = new HeadlessWorldManager(false, () => 123456789);
const sCreated = sc(singleM.createSession());
const sSession = sCreated.session as string, sEpoch = sCreated.epoch as number;
const sDrone = (sCreated.observation?.drones ?? [])[0];
singleM.action(sSession, sEpoch, rid(), [{ type: 'fire', actionId: aid(), target: { x: sDrone.x, y: sDrone.y }, ticks: 120 }], 600);
const single = sc(singleM.step(sSession, sEpoch, rid(), 120));
check('single step120 kills the target (real full duration)', (single.observation?.drones?.length ?? -1) === 0, {
  drones: single.observation?.drones, applied: single.applied, status: single.status
});

// ---- 3) stepCache 128 FIFO eviction: old requestId can advance again ----
const cacheM = new HeadlessWorldManager(false, () => 123456789);
const cc = sc(cacheM.createSession());
const cSession = cc.session as string, cEpoch = cc.epoch as number;
const oldReq = rid();
const r1 = sc(cacheM.step(cSession, cEpoch, oldReq, 1));
const tickAfterFirst = r1.toTick as number;
check('first step with old req applied', r1.replayed === false, { r1: { from: r1.fromTick, to: r1.toTick } });
for (let i = 0; i < 128; i++) cacheM.step(cSession, cEpoch, rid(), 1);
const beforeReplay = cacheM.listSessions();
const r2 = sc(cacheM.step(cSession, cEpoch, oldReq, 1));
check('old request after 128 evictions is NOT recognized as replay', r2.replayed === false, { replayed: r2.replayed });
check('old request after eviction ADVANCES the world again (re-execution)',
  (r2.toTick as number) > (r1.toTick as number), { tickAfterFirst, replayTo: r2.toTick, beforeReplay });

m.close(session);
fireM.close(fSession);
singleM.close(sSession);
cacheM.close(cSession);
console.log(`C3C_HEADLESS_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
