// Independent transport/canonical/ref probe (87d6ae0).
import { HeadlessWorldManager } from './src/ai-native/worldHeadlessMcpTools';
import { canonicalJson } from './src/ai-native/protocol';
import { isHistoryTruncated } from './src/ai-native/worldHeadless';
import { randomBytes } from 'node:crypto';
const hex = (n: number) => randomBytes(n).toString('hex');
const rid = () => `req_${hex(12)}`;
const aid = () => `aid_${hex(12)}`;
let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const sc = (r: any) => r?.structuredContent ?? {};
const envelopeBytes = (r: any) => Buffer.byteLength(JSON.stringify(r), 'utf8');
const bodyBytes = (r: any) => Buffer.byteLength(canonicalJson(sc(r)), 'utf8');
const move = (t: number) => ({ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: t });
const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

// ---------- canonical stability ----------
{
  check('key order independent', canonicalJson({ b: 1, a: 2 }) === canonicalJson({ a: 2, b: 1 }));
  check('nested key order independent', canonicalJson({ x: { d: 1, c: 2 } }) === canonicalJson({ x: { c: 2, d: 1 } }));
  check('array order preserved (different)', canonicalJson([1, 2]) !== canonicalJson([2, 1]));
  check('tiny numeric difference preserved', canonicalJson({ x: 1e-15 }) !== canonicalJson({ x: 2e-15 }));
  check('same tiny number equal', canonicalJson({ x: 1e-15 }) === canonicalJson({ x: 1e-15 }));
}
// ---------- exact truncation predicate ----------
{
  check('exactly 20k retained is NOT truncated', isHistoryTruncated(20_000, 20_000) === false);
  check('20,001 total > 20k retained IS truncated', isHistoryTruncated(20_001, 20_000) === true);
  check('fewer total than retained NOT truncated', isHistoryTruncated(19_999, 20_000) === false);
}

// ---------- ref LRU2 / cross-session / unknown ----------
{
  const m = new HeadlessWorldManager(true, () => 424242);
  const c = sc(m.createSession());
  const s = c.session, e = c.epoch;
  const boundary = () => {
    m.action(s, e, rid(), [move(1)], 600); sc(m.step(s, e, rid(), 1));
  };
  boundary(); const r1 = sc(m.snapshot(s));
  boundary(); const r2 = sc(m.snapshot(s));
  boundary(); const r3 = sc(m.snapshot(s));
  const refs: Map<string, any> = (m as any).frameRefs;
  check('frame ref LRU size <= 2', refs.size <= 2, { size: refs.size });
  check('oldest ref evicted', refs.has(r1.ref) === false, { refs: [...refs.keys()] });
  const unknown = sc(m.restore(s, { ref: 'frameref_' + '0'.repeat(24) }));
  check('unknown ref rejected', unknown.ok === false && unknown.code === 'E_SNAPSHOT_INVALID', unknown);
  // Cross-session restore from an in-process ref (new session), then same action.
  m.action(s, e, rid(), [move(10)], 600); const a = sc(m.step(s, e, rid(), 10));
  const c2 = sc(m.createSession()); const s2 = c2.session;
  const restored = sc(m.restore(s2, { ref: r3.ref }));
  check('cross-session ref restore succeeds', restored.ok === true && restored.epoch > 0, restored);
  m.action(s2, restored.epoch, rid(), [move(10)], 600); const b = sc(m.step(s2, restored.epoch, rid(), 10));
  check('cross-session restore same canonical state', a.canonicalState === b.canonicalState, { same: a.canonicalState === b.canonicalState });
  check('cross-session restore same canonical events', a.canonicalEvents === b.canonicalEvents);
  m.close(s); m.close(s2);
}

// ---------- 20k transport: paging / envelope budget ----------
{
  const m = new HeadlessWorldManager(true, () => 424242);
  const c = sc(m.createSession());
  const s = c.session;
  const spawned = sc(m.spawnEnemies(s, Array(8).fill('drone')));
  const e = spawned.epoch as number;
  for (let i = 0; i < 11; i++) { const r = sc(m.step(s, e, rid(), 1000, neutral)); if (r.ok === false) break; }
  const summary = sc(m.devEventsSummary(s));
  check('20k window reached', summary.eventsRetained === 20_000 && summary.eventsTruncated === true, summary);
  const page = m.devEvents(s, 0, 512);
  const pb = bodyBytes(page), pe = envelopeBytes(page);
  console.log('PAGE_BYTES', JSON.stringify({ bodyBytes: pb, envelopeBytes: pe, ratio: (pe/pb).toFixed(2) }));
  check('events page body within 512KiB', pb <= 512 * 1024, { bodyBytes: pb });
  check('events page lostPrefix explicit for offset 0', sc(page).lostPrefix > 0 && sc(page).truncated === true, sc(page).lostPrefix);
  check('events page nextCursor consistent', sc(page).nextCursor === sc(page).offset + sc(page).items.length || sc(page).nextCursor === null, sc(page).nextCursor);
  // The 512KiB budget is applied to the body; the SDK envelope duplicates it.
  check('512KiB budget covers text+structured envelope (body+text)', pe <= 512 * 1024, { bodyBytes: pb, envelopeBytes: pe, overBy: pe - 512 * 1024 });
  // Exact truncated export / snapshot flags.
  const exp = sc(await m.exportFailure(s, 'probe-20k'));
  check('truncated export replayable=false', exp.replayable === false && exp.eventsTruncated === true, { replayable: exp.replayable, truncated: exp.eventsTruncated });
  const snap = sc(m.snapshot(s));
  check('truncated snapshot has ref + truncated flag', typeof snap.ref === 'string' && snap.eventsTruncated === true && snap.frame === undefined, { ref: snap.ref, truncated: snap.eventsTruncated });
  check('truncated snapshot response within budget', envelopeBytes(snap) <= 512 * 1024, { envelopeBytes: envelopeBytes(snap) });
  m.close(s);
}
console.log(`C3C_TRANSPORT_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
