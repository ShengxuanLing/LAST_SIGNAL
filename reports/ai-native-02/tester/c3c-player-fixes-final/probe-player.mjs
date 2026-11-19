// C3c Player re-verify (frozen 8f1ce6c): official MCP SDK, no browser.
// F1 raw output allowlist, F2 step-intent channel, F3 cross-step duration,
// F4 ledger/cache/epoch/idempotency, public-event cropping, Player/Dev isolation.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/8f1ce6c';
const ENTRY = SNAP + '/dist-mcp/worldHeadlessMcpServer.mjs';
const out = { meta: { target: '8f1ce6c06eaf95d03a2c6e7c9fc1e3f8c7a1c8f3', code: '593786bb31ba6ed5af69774d77ded9b682e0f186', surface: 'Player (no --dev)' }, checks: [], steps: [], findings: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-player-fixes-final/player.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const aid = () => `aid_${hex(12)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new Client({ name: 'c3c-player-reverify', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [ENTRY], cwd: SNAP, env: { ...process.env }, stderr: 'pipe' }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  let body; try { body = JSON.parse(text); } catch { body = { __raw: text }; }
  return { isError: !!r.isError, body, structured: r.structuredContent ?? null, text };
};
const BANNED = ['canonicalState', 'canonicalEvents', 'seed', 'map', 'rngState', 'pendingCommands', 'purchaseTransactions', 'nextProjectileId', 'nextLootId', 'roomGraph'];
const bannedHits = (value) => {
  const hits = new Set();
  const walk = (v, path) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path + '[' + i + ']')); return; }
    for (const [k, val] of Object.entries(v)) {
      if (BANNED.includes(k)) hits.add(path + '.' + k);
      walk(val, path + '.' + k);
    }
  };
  walk(value, '$');
  return [...hits];
};
const newSession = async () => {
  const c = await call('world_headless_create_session', {});
  return c.body?.ok ? c.body : null;
};
const closeSession = async (s) => { if (s) await call('world_close', { session: s.session }).catch(() => {}); };
const obs = async (s) => (await call('world_observe', { session: s.session })).body.observation;
const intent = (over = {}) => ({ move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false, ...over });

// ---------- tool isolation ----------
const tools = (await client.listTools()).tools.map((t) => t.name).sort();
check('player-tools-exact', ['world_action', 'world_close', 'world_headless_create_session', 'world_headless_step', 'world_list_sessions', 'world_observe', 'world_signal_status'].every((n) => tools.includes(n)) && !tools.some((n) => n.includes('dev_')), tools);
const devCall = await call('world_headless_dev_snapshot', { session: 'ses_' + '0'.repeat(24) });
check('player-dev-tool-denied', devCall.isError === true, devCall.text.slice(0, 100));

// ---------- F1: raw Player output allowlist ----------
{
  const s = await newSession();
  check('create-ok', !!s, {});
  const createHits = bannedHits({ body: (await call('world_headless_create_session', {})).body });
  const created = await call('world_list_sessions');
  const o = await call('world_observe', { session: s.session });
  const a = await call('world_action', { session: s.session, epoch: s.epoch, requestId: reqId(), actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 4 }] });
  const st = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 4 });
  const stepKeys = Object.keys(st.body ?? {});
  const stepStructKeys = Object.keys(st.structured ?? {});
  const hits = [
    ...bannedHits(st.body).map((h) => 'text' + h),
    ...bannedHits(st.structured).map((h) => 'structured' + h),
    ...bannedHits(o.body).map((h) => 'observe' + h),
    ...bannedHits(a.body).map((h) => 'action' + h),
    ...bannedHits(created.body).map((h) => 'list' + h)
  ];
  out.steps.push({ name: 'f1', stepKeys, stepStructKeys, hits, createHits, observationKeys: Object.keys(o.body.observation ?? {}), eventSample: (st.body.events ?? []).slice(0, 6) });
  check('player-step-no-canonical', !stepKeys.includes('canonicalState') && !stepKeys.includes('canonicalEvents') && !stepStructKeys.includes('canonicalState') && !stepStructKeys.includes('canonicalEvents'), { stepKeys, stepStructKeys });
  check('player-raw-recursively-clean', hits.length === 0 && createHits.length === 0, hits);
  check('player-events-allowlisted', Array.isArray(st.body.events) && st.body.events.every((e) => !['drone-step', 'room-generated', 'player-reset'].includes(e.type)), (st.body.events ?? []).slice(0, 5));
  await closeSession(s);
}

// ---------- F2: step intent WITHOUT world_action ----------
{
  const s = await newSession();
  const p0 = await obs(s);
  const st = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 30, intent: intent({ move: { x: 1, y: 0 } }) });
  const p1 = await obs(s);
  const moved = +Math.hypot(p1.player.x - p0.player.x, p1.player.y - p0.player.y).toFixed(4);
  out.findings.push({ id: 'F2-step-intent-channel', text: 'step intent still drives the player without world_action/TTL/idempotency', moved, applied: st.body.applied });
  check('step-intent-without-action-does-not-move', moved < 0.01, { moved, applied: st.body.applied });
  await closeSession(s);
}

// ---------- F3: cross-step duration (Player ACK semantics) ----------
{
  const s = await newSession();
  await call('world_action', { session: s.session, epoch: s.epoch, requestId: reqId(), actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 120 }] });
  const st10 = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 10 });
  const st110 = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 110 });
  out.steps.push({ name: 'f3-split', executing: st10.body.executing, applied10: st10.body.applied, applied110: st110.body.applied, executing110: st110.body.executing });
  check('step10-reports-executing-not-applied', st10.body.applied?.length === 0 && st10.body.executing?.executedTicks === 10 && st10.body.executing?.remainingTicks === 110, { executing: st10.body.executing, applied: st10.body.applied });
  check('step110-completes-once', st110.body.applied?.length === 1 && st110.body.applied[0].executedTicks === 120 && st110.body.executing === null, { applied: st110.body.applied, executing: st110.body.executing });
  await closeSession(s);
}

// ---------- F4: ledger, eviction tombstone, quota, epoch, cross-domain ids ----------
{
  const s = await newSession();
  const R = reqId();
  const a0 = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: R, ticks: 1 });
  const a1 = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: R, ticks: 1 });
  check('same-step-id-no-double-advance', a1.body.replayed === true && a1.body.toTick === a0.body.toTick, { first: a0.body.toTick, replay: a1.body.toTick, replayed: a1.body.replayed });
  const sameIdDiff = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: R, ticks: 2 });
  check('same-id-different-payload-rejected', sameIdDiff.isError === true && sameIdDiff.body.code === 'E_ID_PAYLOAD_MISMATCH', sameIdDiff.body);
  for (let i = 0; i < 130; i += 1) await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 1 });
  const before = await obs(s);
  const evicted = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: R, ticks: 1 });
  const after = await obs(s);
  out.steps.push({ name: 'f4-eviction', evicted: evicted.body, tickBefore: before.tick, tickAfter: after.tick });
  check('evicted-id-tombstoned-no-advance', evicted.isError === true && evicted.body.code === 'E_RETRY_AFTER_EVICTION' && after.tick === before.tick, { code: evicted.body.code, before: before.tick, after: after.tick });

  // quota: fill until the ledger's hard cap rejects a NEW request without advancing
  let quotaError = null; let quotaAt = 0; let quotaTick = null;
  for (let i = 0; i < 200; i += 1) {
    const b = await obs(s);
    const r = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 1 });
    if (r.isError) { quotaError = r.body.code; quotaAt = i; quotaTick = { before: b.tick, after: (await obs(s)).tick }; break; }
  }
  out.steps.push({ name: 'f4-quota', quotaError, quotaAt, quotaTick });
  check('dedup-quota-rejects-without-advance', quotaError === 'E_RESOURCE_LIMIT' && quotaTick?.before === quotaTick?.after, { quotaError, quotaAt, quotaTick });
  await closeSession(s);
}

// ---------- cross-domain requestId + same action id replay ----------
{
  const s = await newSession();
  const shared = reqId();
  const stA = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: shared, ticks: 1 });
  const actB = await call('world_action', { session: s.session, epoch: s.epoch, requestId: shared, actions: [{ type: 'move', actionId: aid(), dir: { x: 1, y: 0 }, ticks: 2 }] });
  check('step-and-action-share-request-namespace', actB.isError === true && actB.body.code === 'E_ID_PAYLOAD_MISMATCH', { step: stA.body.ok, action: actB.body });

  const actionId = aid();
  const first = await call('world_action', { session: s.session, epoch: s.epoch, requestId: reqId(), actions: [{ type: 'fire', actionId, target: { x: 0, y: 0 }, ticks: 3 }] });
  const same = await call('world_action', { session: s.session, epoch: s.epoch, requestId: reqId(), actions: [{ type: 'fire', actionId, target: { x: 0, y: 0 }, ticks: 3 }] });
  const diff = await call('world_action', { session: s.session, epoch: s.epoch, requestId: reqId(), actions: [{ type: 'fire', actionId, target: { x: 1, y: 1 }, ticks: 3 }] });
  out.steps.push({ name: 'action-id', first: first.body.actions, same: same.body, diff: diff.body });
  const stAction = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 6 });
  const appliedOnce = (stAction.body.applied ?? []).filter((x) => x.actionId === actionId);
  out.steps.push({ name: 'action-double-exec', applied: appliedOnce, allApplied: stAction.body.applied });
  check('same-action-id-same-payload-executes-once', same.body.ok === true && JSON.stringify(same.body.actions) === JSON.stringify(first.body.actions) && appliedOnce.length === 1 && appliedOnce[0].executedTicks === 3, { first: first.body.actions, same: same.body.actions, replayed: same.body.replayed, appliedOnce });
  check('same-action-id-different-payload-rejected', diff.isError === true && diff.body.code === 'E_ID_PAYLOAD_MISMATCH', diff.body);
  await closeSession(s);
}

// ---------- public events: hidden targets never leak positions/HP ----------
{
  const s = await newSession();
  // walk away until the drone leaves perception, then step while it would act
  for (let i = 0; i < 12; i += 1) {
    const o = await obs(s);
    if ((o.drones ?? []).length === 0) break;
    const d = o.drones[0];
    const dir = { x: o.player.x - d.x, y: o.player.y - d.y };
    await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 50, intent: intent({ move: dir }) });
  }
  let o = await obs(s);
  const dirs = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  for (const dir of dirs) {
    if ((o.drones ?? []).length === 0) break;
    await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 60, intent: intent({ move: dir }) });
    o = await obs(s);
  }
  const st = await call('world_headless_step', { session: s.session, epoch: s.epoch, requestId: reqId(), ticks: 120 });
  const evs = st.body.events ?? [];
  const posEvents = evs.filter((e) => e.x !== undefined || e.y !== undefined || e.projectile?.x !== undefined);
  out.steps.push({ name: 'f5-events', hiddenDrones: (o.drones ?? []).length, types: [...new Set(evs.map((e) => e.type))], posEvents: posEvents.slice(0, 6), eventCount: st.body.eventCount });
  check('hidden-drone-not-in-observation', (o.drones ?? []).length === 0, { drones: o.drones });
  check('public-events-have-no-hidden-fsm', !evs.some((e) => ['drone-step', 'room-generated', 'player-reset'].includes(e.type)), [...new Set(evs.map((e) => e.type))]);
  check('public-events-have-no-unperceived-position', posEvents.length === 0, posEvents.slice(0, 3));
  await closeSession(s);
}

writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-player-fixes-final/player.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), findings: out.findings }, null, 2));
await client.close();
process.exit(0);
