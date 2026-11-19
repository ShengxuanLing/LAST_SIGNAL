// Independent probe: Player step-intent channel + snapshot action boundary + failure export.
import { HeadlessWorldManager } from './src/ai-native/worldHeadlessMcpTools';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const hex = (n: number) => randomBytes(n).toString('hex');
const aid = () => `aid_${hex(12)}`;
const rid = () => `req_${hex(12)}`;
let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const sc = (r: any) => r?.structuredContent ?? {};
const intent = (mx: number) => ({ move: { x: mx, y: 0 }, dash: false, fire: false, aim: null, interact: false });

// ---------- 1) Player step(intent) channel ----------
{
  const m = new HeadlessWorldManager(false, () => 123456789);
  const c = sc(m.createSession());
  const s = c.session, e = c.epoch, x0 = c.observation.player.x;
  const beforeStats = sc(m.inspect ? { structuredContent: {} } : {}) ;
  const before = sc(m.observe(s)).tick;
  const badIntent = m.step(s, e, rid(), 5, intent(1));
  const b = sc(badIntent);
  check('Player step(intent) rejected with E_PERMISSION', b.ok === false && b.code === 'E_PERMISSION', b);
  check('rejected intent does not advance tick', sc(m.observe(s)).tick === before, { before, after: sc(m.observe(s)).tick });
  const neutral = sc(m.step(s, e, rid(), 5));
  check('Player neutral step (no action) does not move', neutral.ok === true && neutral.observation.player.x === x0, { x0, after: neutral.observation.player.x });
  // Normal action then step works.
  m.action(s, e, rid(), [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 10 }], 600);
  const acted = sc(m.step(s, e, rid(), 10));
  check('normal world_action + step moves the player', acted.ok === true && acted.observation.player.x !== x0, { x0, after: acted.observation.player.x, applied: acted.applied });
  m.close(s);
}

// ---------- 2) Snapshot/restore only at action boundary ----------
{
  const m = new HeadlessWorldManager(true, () => 123456789);
  const c = sc(m.createSession());
  const s = c.session, e = c.epoch;
  // Active 10/110: snapshot/restore must be refused and must not change state/quota.
  m.action(s, e, rid(), [{ type: 'fire', actionId: aid(), target: { x: c.observation.drones[0].x, y: c.observation.drones[0].y }, ticks: 120 }], 600);
  const a10 = sc(m.step(s, e, rid(), 10));
  check('step10 leaves an active execution', !!a10.executing, { executing: a10.executing });
  const tickBefore = sc(m.observe(s)).tick;
  const snapMid = sc(m.snapshot(s));
  check('snapshot mid-execution refused', snapMid.ok === false && snapMid.code === 'E_NOT_APPLICABLE', snapMid);
  check('refused snapshot does not advance', sc(m.observe(s)).tick === tickBefore);
  const a110 = sc(m.step(s, e, rid(), 110));
  check('step110 completes executedTicks=120', (a110.applied ?? [])[0]?.executedTicks === 120, { applied: a110.applied });

  // Queue two actions; consume exactly the first -> active=null but one queued.
  m.action(s, e, rid(), [
    { type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 2 },
    { type: 'move', actionId: aid(), dir: { x: -1, y: 0 }, ticks: 2 }
  ], 600);
  sc(m.step(s, e, rid(), 2));
  const insp = sc(m.inspect(s));
  check('after first action, one queued remains', insp.manager?.queuedActions === 1, { manager: insp.manager });
  const snapQueued = sc(m.snapshot(s));
  check('snapshot with queued-unconsumed action refused', snapQueued.ok === false && snapQueued.code === 'E_NOT_APPLICABLE', snapQueued);
  sc(m.step(s, e, rid(), 2)); // consume the second

  // Boundary frame now succeeds.
  const snap = sc(m.snapshot(s));
  check('snapshot at boundary succeeds with boundary=action', snap.ok === true && snap.boundary === 'action' && snap.frame?.boundary === 'action', { snap });
  const frame = snap.frame;
  const epochBefore = sc(m.observe(s)).epoch;

  // Continue the same action from the boundary, record canonical/events.
  m.action(s, e, rid(), [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 10 }], 600);
  const cont = sc(m.step(s, e, rid(), 10));
  const canonA = cont.canonicalState, eventsA = cont.canonicalEvents;

  // Restore the boundary frame (epoch++) and repeat the same action.
  const restored = sc(m.restore(s, frame));
  check('restore boundary frame succeeds and bumps epoch', restored.ok === true && restored.epoch > epochBefore, { epochBefore, restored });
  const oldEpoch = m.step(s, epochBefore, rid(), 5);
  check('old epoch rejected after restore', sc(oldEpoch).ok === false && sc(oldEpoch).code === 'E_STALE_EPOCH', oldEpoch);
  m.action(s, restored.epoch, rid(), [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 10 }], 600);
  const cont2 = sc(m.step(s, restored.epoch, rid(), 10));
  check('post-restore same action canonical matches', cont2.canonicalState === canonA, { same: cont2.canonicalState === canonA });
  check('post-restore same action events matches', cont2.canonicalEvents === eventsA);

  // ---------- 3) Failure export boundary semantics ----------
  m.action(s, restored.epoch, rid(), [{ type: 'fire', actionId: aid(), target: { x: sc(m.observe(s)).observation.player.x + 5, y: sc(m.observe(s)).observation.player.y }, ticks: 120 }], 600);
  sc(m.step(s, restored.epoch, rid(), 10));
  const midExport = sc(await m.exportFailure(s, 'probe-mid'));
  check('mid-execution failure export marked non-replayable', midExport.replayable === false && midExport.boundary === 'mid_execution', midExport.diagnostics);
  sc(m.step(s, restored.epoch, rid(), 110)); // complete
  const boundaryExport = sc(await m.exportFailure(s, 'probe-boundary'));
  check('boundary failure export marked replayable', boundaryExport.replayable === true && boundaryExport.boundary === 'action', boundaryExport.diagnostics);
  const saved = JSON.parse(readFileSync(boundaryExport.path as string, 'utf8'));
  check('boundary exported frame has boundary=action marker', saved.frame?.boundary === 'action', { frameBoundary: saved.frame?.boundary });
  m.close(s);
}

// ---------- 4) Dev still accepts a strict intent ----------
{
  const d = new HeadlessWorldManager(true, () => 123456789);
  const c = sc(d.createSession());
  const x0 = c.observation.player.x;
  const r = sc(d.step(c.session, c.epoch, rid(), 5, intent(1)));
  check('Dev step(intent) still accepted', r.ok === true && r.observation.player.x !== x0, { x0, after: r.observation.player.x });
  d.close(c.session);
}

console.log(`C3C_STEP_BOUNDARY_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
