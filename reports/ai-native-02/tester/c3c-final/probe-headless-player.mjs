// C3-c headless PLAYER surface — official MCP SDK client, no browser, no Dev tools.
// Verifies create/observe/action/step/collision/hit/finish/death, Player cannot seed,
// and the raw Player result payload (text + structuredContent) for owner leaks,
// partial-duration ACK, step-intent bypass and step-cache eviction replay.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/82734f6';
const ENTRY = SNAP + '/dist-mcp/worldHeadlessMcpServer.mjs';
const out = { meta: { target: '82734f639b5efa6683fd0ac046fa10ac93d9516a', surface: 'Player (no --dev), official MCP SDK, no browser' }, checks: [], steps: [], findings: [], calls: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-final/player.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const actId = () => `aid_${hex(12)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new Client({ name: 'c3c-player-tester', version: '1.0.0' });
const transport = new StdioClientTransport({ command: 'node', args: [ENTRY], cwd: SNAP, env: { ...process.env }, stderr: 'pipe' });
await client.connect(transport);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  let body; try { body = JSON.parse(text); } catch { body = { __raw: text }; }
  const sc = r.structuredContent ?? null;
  out.calls.push({ tool: name, isError: !!r.isError, bodyCode: body.code ?? null, keys: body && typeof body === 'object' ? Object.keys(body) : [], structuredKeys: sc && typeof sc === 'object' ? Object.keys(sc) : [] });
  return { isError: !!r.isError, body, structured: sc };
};
const observe = async (session) => (await call('world_observe', { session })).body;

// ---------- tool surface ----------
const tools = (await client.listTools()).tools;
const names = tools.map((t) => t.name).sort();
out.steps.push({ name: 'tools', names, inputKeys: Object.fromEntries(tools.map((t) => [t.name, Object.keys(t.inputSchema?.properties ?? {})])) });
const devTools = names.filter((n) => n.includes('dev_'));
check('player-surface-has-no-dev-tools', devTools.length === 0, devTools);
check('player-surface-expected-tools', ['world_action', 'world_close', 'world_headless_create_session', 'world_headless_step', 'world_list_sessions', 'world_observe', 'world_signal_status'].every((n) => names.includes(n)), names);

// ---------- Player cannot seed / fixture / HP ----------
const seedTry = await call('world_headless_create_session', { seed: 1234 });
check('player-rejects-seed', seedTry.isError === true, seedTry.body);
const fixtureTry = await call('world_headless_dev_spawn_enemies', { session: 'ses_' + '0'.repeat(24), kinds: ['drone'] });
check('player-has-no-fixture-tool', fixtureTry.isError === true, fixtureTry.body);

const created = await call('world_headless_create_session', {});
check('player-create-ok', created.isError === false && created.body.ok === true, { session: created.body.session, tick: created.body.tick, status: created.body.status });
const session = created.body.session;
const epoch = created.body.epoch;
const obs0 = await observe(session);
out.steps.push({ name: 'create', session, epoch, observationKeys: Object.keys(obs0.observation ?? {}), player: obs0.observation?.player, drones: obs0.observation?.drones });
check('player-observation-cropped', !/"(seed|map|rng|rngState|canonicalState|canonicalEvents|pendingCommands)"/.test(JSON.stringify(obs0.observation ?? {})), Object.keys(obs0.observation ?? {}));
check('player-sees-a-drone', (obs0.observation?.drones?.length ?? 0) >= 1, obs0.observation?.drones);

// ---------- step raw payload: canonical owner state to a Player? ----------
const s1 = await call('world_headless_step', { session, epoch, requestId: reqId(), ticks: 10 });
const s1keys = Object.keys(s1.body ?? {});
const s1scKeys = Object.keys(s1.structured ?? {});
out.steps.push({ name: 'step-raw', keys: s1keys, structuredKeys: s1scKeys, canonicalStateBytes: s1.body?.canonicalState ? JSON.stringify(s1.body.canonicalState).length : 0, canonicalEventsBytes: s1.body?.canonicalEvents ? JSON.stringify(s1.body.canonicalEvents).length : 0, canonicalKeys: s1.body?.canonicalState ? Object.keys(s1.body.canonicalState) : [] });
check('step-raw-has-real-ticks', s1.body.toTick > s1.body.fromTick, { from: s1.body.fromTick, to: s1.body.toTick });
// FINDING (blocker per Lead decision): Player raw result exposes owner canonical state/events.
out.findings.push({ id: 'F-player-canonical-leak', text: 'Player (non-Dev) world_headless_step result carries canonicalState & canonicalEvents in text and structuredContent', textHasCanonical: s1keys.includes('canonicalState') && s1keys.includes('canonicalEvents'), structuredHasCanonical: s1scKeys.includes('canonicalState') && s1scKeys.includes('canonicalEvents'), canonicalKeys: s1.body?.canonicalState ? Object.keys(s1.body.canonicalState) : [] });
check('player-step-raw-leaks-canonical (finding)', !(s1keys.includes('canonicalState') || s1scKeys.includes('canonicalState')), { text: s1keys, structured: s1scKeys });

// ---------- hit: fire at the perceived drone, then step ----------
let obs = await observe(session);
const drone0 = obs.observation.drones[0];
const fire = await call('world_action', { session, epoch, requestId: reqId(), actions: [{ type: 'fire', actionId: actId(), target: { x: drone0.x, y: drone0.y }, ticks: 120 }] });
const stepFire = await call('world_headless_step', { session, epoch, requestId: reqId(), ticks: 120 });
let hitResult = null;
for (let i = 0; i < 5; i += 1) {
  obs = await observe(session);
  const d = (obs.observation.drones ?? []).find((x) => x.id === drone0.id);
  if (!d || d.hp < drone0.hp) { hitResult = { before: drone0.hp, after: d ? d.hp : 0, present: !!d, tick: obs.observation.tick }; break; }
  await call('world_headless_step', { session, epoch, requestId: reqId(), ticks: 60 });
}
out.steps.push({ name: 'hit', fireQueued: fire.body.actions?.[0]?.status, stepStatus: stepFire.body.status, hit: hitResult });
check('real-hit-on-drone', hitResult !== null, hitResult);

// ---------- encounter finish: finish the drone, then non-Dev step is refused ----------
let finish = null;
for (let i = 0; i < 6; i += 1) {
  obs = await observe(session);
  if ((obs.observation.drones ?? []).length === 0) { finish = { status: obs.observation.status ?? obs.status, tick: obs.observation.tick }; break; }
  const d = obs.observation.drones[0];
  await call('world_action', { session, epoch, requestId: reqId(), actions: [{ type: 'fire', actionId: actId(), target: { x: d.x, y: d.y }, ticks: 120 }] });
  await call('world_headless_step', { session, epoch, requestId: reqId(), ticks: 120 });
}
const afterEnd = await call('world_headless_step', { session, epoch, requestId: reqId(), ticks: 10 });
const endObs = await call('world_list_sessions');
out.steps.push({ name: 'finish', finish, afterEndError: afterEnd.body.code ?? null, sessions: endObs.body.sessions });
check('encounter-finish-observed', finish !== null, finish);
check('nondev-step-after-finish-refused', afterEnd.isError === true && afterEnd.body.code === 'E_NOT_APPLICABLE', afterEnd.body);

// ---------- helper: one session per sub-test, closed immediately ----------
const newSession = async (label) => {
  const c = await call('world_headless_create_session', {});
  if (c.isError || !c.body?.ok) { check(`${label}-create`, false, c.body); return null; }
  return c.body;
};
const closeSession = async (sess) => { if (sess) await call('world_close', { session: sess.session }).catch(() => {}); };

// ---------- collision: bounded movement stops against geometry ----------
let collided = null;
{
  const cs = await newSession('collision');
  if (cs) {
    const cobs = await observe(cs.session);
    const start = { x: cobs.observation.player.x, y: cobs.observation.player.y };
    const dirs = [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }];
    for (const dir of dirs) {
      let prev = start; let blocked = false;
      for (let i = 0; i < 8; i += 1) {
        const st = await call('world_headless_step', { session: cs.session, epoch: cs.epoch, requestId: reqId(), ticks: 50, intent: { move: dir, dash: false, fire: false, aim: null, interact: false } });
        if (st.body.status && st.body.status !== 'running') break;
        const o = await observe(cs.session);
        const now = { x: o.observation.player.x, y: o.observation.player.y };
        if (Math.hypot(now.x - prev.x, now.y - prev.y) < 0.01 && i > 0) { blocked = true; prev = now; break; }
        prev = now;
      }
      if (blocked) { collided = { dir, at: prev, ticksRun: 400 }; break; }
    }
    await closeSession(cs);
  }
}
out.steps.push({ name: 'collision', collided });
check('collision-stops-movement', collided !== null, collided);

// ---------- step intent can drive the Player without world_action/TTL? ----------
let bypassMoved = null; let bypassApplied = null;
{
  const bs = await newSession('bypass');
  if (bs) {
    const b0 = (await observe(bs.session)).observation;
    const bStep = await call('world_headless_step', { session: bs.session, epoch: bs.epoch, requestId: reqId(), ticks: 30, intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false } });
    bypassApplied = bStep.body.applied ?? null;
    const b1 = (await observe(bs.session)).observation;
    bypassMoved = +Math.hypot(b1.player.x - b0.player.x, b1.player.y - b0.player.y).toFixed(4);
    await closeSession(bs);
  }
}
out.findings.push({ id: 'F-step-intent-bypass', text: 'Player world_headless_step accepts a raw intent and moves/fires without world_action, TTL or action idempotency', moved: bypassMoved, applied: bypassApplied });
check('step-intent-drives-player-without-action (finding)', bypassMoved === null || bypassMoved < 0.01, { moved: bypassMoved });

// ---------- action ticks=120 but step 10: early ACK / remaining ticks lost ----------
let partial = null;
{
  const ps = await newSession('partial');
  if (ps) {
    const p0 = (await observe(ps.session)).observation;
    const moveAid = actId();
    await call('world_action', { session: ps.session, epoch: ps.epoch, requestId: reqId(), actions: [{ type: 'move', actionId: moveAid, dir: { x: 1, y: 0 }, ticks: 120 }] });
    const pStep1 = await call('world_headless_step', { session: ps.session, epoch: ps.epoch, requestId: reqId(), ticks: 10 });
    const p1 = (await observe(ps.session)).observation;
    await call('world_headless_step', { session: ps.session, epoch: ps.epoch, requestId: reqId(), ticks: 60 });
    const p2 = (await observe(ps.session)).observation;
    partial = {
      applied: pStep1.body.applied,
      move1: +Math.hypot(p1.player.x - p0.player.x, p1.player.y - p0.player.y).toFixed(4),
      move2: +Math.hypot(p2.player.x - p1.player.x, p2.player.y - p1.player.y).toFixed(4),
      actionAckAfter10: pStep1.body.applied?.find((a) => a.actionId === moveAid) ?? null
    };
    await closeSession(ps);
  }
}
out.findings.push({ id: 'F-partial-duration-early-ack', text: 'An action requesting ticks=120 is ACKed applied after only a 10-tick step; the remaining 110 ticks do not continue', ...(partial ?? {}) });
check('partial-action-not-acked-early (finding)', !(partial?.actionAckAfter10 && partial.actionAckAfter10.executedTicks < 120), partial);

// ---------- stepCache eviction: replayed old requestId advances again? ----------
let eviction = null;
{
  const cs = await newSession('cache');
  if (cs) {
    const R = reqId();
    const c0 = await call('world_headless_step', { session: cs.session, epoch: cs.epoch, requestId: R, ticks: 1 });
    const c0b = await call('world_headless_step', { session: cs.session, epoch: cs.epoch, requestId: R, ticks: 1 });
    const replaySame = c0b.body.replayed === true && c0b.body.toTick === c0.body.toTick;
    for (let i = 0; i < 130; i += 1) {
      const st = await call('world_headless_step', { session: cs.session, epoch: cs.epoch, requestId: reqId(), ticks: 1 });
      if (st.body.status && st.body.status !== 'running') break;
    }
    const cAfter = await call('world_headless_step', { session: cs.session, epoch: cs.epoch, requestId: R, ticks: 1 });
    eviction = { replaySame, first: { from: c0.body.fromTick, to: c0.body.toTick }, afterEviction: { replayed: cAfter.body.replayed, from: cAfter.body.fromTick, to: cAfter.body.toTick }, rawKeys: Object.keys(cAfter.body) };
    await closeSession(cs);
  }
}
out.findings.push({ id: 'F-step-cache-eviction-replay', text: 'After the 128-step cache eviction, replaying the same requestId executes again (idempotency bypass)', ...(eviction ?? {}) });
check('step-cache-replay-idempotent-before-eviction', eviction?.replaySame === true, eviction);
check('step-cache-does-not-reapply-after-eviction (finding)', eviction !== null && !(eviction.afterEviction.replayed === false && eviction.afterEviction.to > eviction.afterEviction.from), eviction?.afterEviction);

// ---------- death: walk into the drone, then stand still ----------
let death = null;
{
  const ds = await newSession('death');
  if (ds) {
    const obsNow = await observe(ds.session);
    const target = obsNow.observation.drones[0];
    if (target) {
      for (let i = 0; i < 8; i += 1) {
        const o2 = await observe(ds.session);
        const p = o2.observation.player;
        const d = o2.observation.drones[0];
        if (!d || p.hp <= 0) break;
        const dir = { x: d.x - p.x, y: d.y - p.y };
        await call('world_headless_step', { session: ds.session, epoch: ds.epoch, requestId: reqId(), ticks: 60, intent: { move: dir, dash: false, fire: false, aim: null, interact: false } });
      }
    }
    let hp = null;
    for (let i = 0; i < 12; i += 1) {
      const st = await call('world_headless_step', { session: ds.session, epoch: ds.epoch, requestId: reqId(), ticks: 1000 });
      if (st.isError || st.body.__raw) { death = { error: st.body.__raw ?? st.body.code }; break; }
      const o = await observe(ds.session);
      hp = o.observation.player.hp;
      if (st.body.status === 'dead' || hp <= 0) { death = { tick: st.body.toTick, status: st.body.status, hp }; break; }
    }
    death = { ...(death ?? {}), hp };
    await closeSession(ds);
  }
}
out.steps.push({ name: 'death', death });
check('real-death-reachable', death?.status === 'dead', death);

// ---------- close ----------
const closed = await call('world_close', { session });
const afterClose = await call('world_observe', { session });
check('player-close-and-observe-refused', closed.body.ok === true && afterClose.isError === true, { closed: closed.body, after: afterClose.body });

writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-final/player.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), findings: out.findings.map((f) => f.id) }, null, 2));
await client.close();
process.exit(0);
