// Independent probe for C3c Player fixes (8f1ce6c).
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
const txt = (r: any) => r?.content?.[0]?.text ?? '';
const playerManager = () => new HeadlessWorldManager(false, () => 123456789);

function create(m: HeadlessWorldManager) {
  const c = sc(m.createSession());
  return { session: c.session as string, epoch: c.epoch as number, obs: c.observation as any };
}

// 1) Non-Dev step output whitelist: no canonical, public events only.
{
  const m = playerManager();
  const { session, epoch } = create(m);
  const r = m.step(session, epoch, rid(), 5);
  const body = sc(r);
  check('non-Dev step has NO canonicalState', body.canonicalState === undefined, { keys: Object.keys(body) });
  check('non-Dev step has NO canonicalEvents', body.canonicalEvents === undefined, { keys: Object.keys(body) });
  check('non-Dev step MCP text has NO canonical', !txt(r).includes('canonicalState') && !txt(r).includes('canonicalEvents'));
  const evTypes = (body.events as any[])?.map((e) => e.type) ?? [];
  check('non-Dev events are public allowlist only', evTypes.every((t) => !['drone-step', 'room-generated', 'player-reset'].includes(t)), { evTypes });
  m.close(session);
}

// 2) Player step(intent) bypass: non-Dev still accepts an arbitrary intent.
{
  const m = playerManager();
  const { session, epoch, obs } = create(m);
  const x0 = obs.player.x;
  const r = m.step(session, epoch, rid(), 10, { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  const body = sc(r);
  const x1 = body.observation?.player?.x;
  check('non-Dev step STILL accepts intent (bypass action/TTL)', body.ok === true && typeof x1 === 'number' && x1 !== x0, { x0, x1, status: body.ok, code: body.code });
  m.close(session);
}

// 3) 10+110 == 120 (receipts/state/events), and no premature applied.
{
  const mA = new HeadlessWorldManager(true, () => 123456789);
  const cA = create(mA);
  const droneA = cA.obs.drones[0];
  mA.action(cA.session, cA.epoch, rid(), [{ type: 'fire', actionId: aid(), target: { x: droneA.x, y: droneA.y }, ticks: 120 }], 600);
  const a10 = sc(mA.step(cA.session, cA.epoch, rid(), 10));
  check('step10 reports executing, no applied', (a10.applied ?? []).length === 0 && !!a10.executing, { applied: a10.applied, executing: a10.executing });
  const a110 = sc(mA.step(cA.session, cA.epoch, rid(), 110));
  check('step110 completes with executedTicks=120', (a110.applied ?? [])[0]?.executedTicks === 120, { applied: a110.applied });

  const mB = new HeadlessWorldManager(true, () => 123456789);
  const cB = create(mB);
  const droneB = cB.obs.drones[0];
  mB.action(cB.session, cB.epoch, rid(), [{ type: 'fire', actionId: aid(), target: { x: droneB.x, y: droneB.y }, ticks: 120 }], 600);
  const b120 = sc(mB.step(cB.session, cB.epoch, rid(), 120));
  check('10+110 canonical == 120 canonical', a110.canonicalState === b120.canonicalState, { same: a110.canonicalState === b120.canonicalState });
  check('10+110 canonicalEvents == 120 canonicalEvents', a110.canonicalEvents === b120.canonicalEvents);
  check('10+110 observation == 120 observation', JSON.stringify(a110.observation) === JSON.stringify(b120.observation));
  mA.close(cA.session); mB.close(cB.session);
}

// 4) Ledger: cross-domain/different payload mismatch; hard cap rejects without advance; eviction tombstone no replay.
{
  const m = playerManager();
  const { session, epoch } = create(m);
  const shared = rid();
  m.action(session, epoch, shared, [{ type: 'stop', actionId: aid() }], 600);
  const diffDomain = sc(m.step(session, epoch, shared, 1));
  check('action→step same id rejected (payload/domain mismatch)', diffDomain.ok === false && diffDomain.code === 'E_ID_PAYLOAD_MISMATCH', diffDomain);

  const firstReq = rid();
  const first = sc(m.step(session, epoch, firstReq, 1));
  const tickAfterFirst = first.toTick;
  // Fill 128 responses so firstReq's cache entry is evicted/tombstoned.
  for (let i = 0; i < 128; i++) m.step(session, epoch, rid(), 1);
  const replayEvicted = sc(m.step(session, epoch, firstReq, 1));
  check('evicted response is NOT re-executed', replayEvicted.ok === false && replayEvicted.code === 'E_RETRY_AFTER_EVICTION', replayEvicted);

  // Fill the 256 request hard cap; the next NEW request is rejected without advance.
  for (let i = 0; i < 256; i++) m.step(session, epoch, rid(), 1);
  const tickBeforeCap = sc(m.observe(session)).tick as number;
  const cap = sc(m.step(session, epoch, rid(), 1));
  const tickAfterCap = sc(m.observe(session)).tick as number;
  check('hard cap rejects new request (E_RESOURCE_LIMIT)', cap.ok === false && cap.code === 'E_RESOURCE_LIMIT', cap);
  check('hard cap rejection does not advance', tickAfterCap === tickBeforeCap, { tickBeforeCap, tickAfterCap });
  m.close(session);
}

// 5) Snapshot mid-active: does the frame persist the active execution?
{
  const m = new HeadlessWorldManager(true, () => 123456789);
  const c = create(m);
  const x0 = c.obs.player.x;
  // A 120-tick move action, then 10 real ticks (110 still owed).
  m.action(c.session, c.epoch, rid(), [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 120 }], 600);
  const s10 = sc(m.step(c.session, c.epoch, rid(), 10));
  const frame = sc(m.snapshot(c.session)).frame as any;
  check('snapshot frame does NOT include active execution', frame?.active === undefined && frame?.execution === undefined, { frameKeys: Object.keys(frame ?? {}) });
  const restored = sc(m.restore(c.session, frame));
  const newEpoch = restored.epoch as number;
  // After restore, the 110 remaining ticks are not owed: a neutral 110 must not move further.
  const after = sc(m.step(c.session, newEpoch, rid(), 110));
  const xAfterRestore = after.observation?.player?.x;
  check('step10 had an executing action before snapshot', !!s10.executing, { executing: s10.executing });
  check('restore mid-active LOSES the remaining 110 ticks (player does not finish the move)',
    typeof xAfterRestore === 'number' && Math.abs(xAfterRestore - x0) < 5, { x0, xAfterRestore, afterMoved: xAfterRestore !== x0 });
  // Compare: no-restore 10+110 completes the move.
  const m2 = new HeadlessWorldManager(true, () => 123456789);
  const c2 = create(m2);
  m2.action(c2.session, c2.epoch, rid(), [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 120 }], 600);
  m2.step(c2.session, c2.epoch, rid(), 10);
  const completed = sc(m2.step(c2.session, c2.epoch, rid(), 110));
  check('no-restore 10+110 completes the move', (completed.applied ?? [])[0]?.executedTicks === 120, { applied: completed.applied });
  m.close(c.session); m2.close(c2.session);
}

console.log(`C3C_PLAYER_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
