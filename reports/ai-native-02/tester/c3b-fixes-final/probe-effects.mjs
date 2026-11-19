// C3-b fix (8b9705d) — effects + lifecycle v4, TEST build (5303, __game for
// verification only). Agent acts only through official MCP stdio + bridge; the human
// uses the REAL in-game form. Start-room tests first (safe), then a real room.
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:5303';
const BRIDGE = 'http://127.0.0.1:8892';
const TOKEN_FILE = process.env.TOKEN_FILE;
const MCP = 'D:/Project/AI-NATIVE-02-snapshots/8b9705d/dist-mcp/worldMcpServer.mjs';
const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/8b9705d';
const TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();
const ev = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-fixes-final/evidence-effects';
mkdirSync(ev, { recursive: true });
const out = { meta: { base: BASE, bridge: BRIDGE, target: '8b9705d6bce1894b08717c0180e127f26de8e2f5', build: 'test mode (__game verification only)' }, checks: [], steps: [], findings: [], toolLog: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-fixes-final/effects.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const actId = () => `aid_${hex(12)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mk = async () => {
  const client = new Client({ name: 'c3b-fix-effects', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: 'node', args: [MCP], cwd: SNAP, env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: BRIDGE, LAST_SIGNAL_WORLD_TOKEN_FILE: TOKEN_FILE }, stderr: 'pipe' });
  await client.connect(transport);
  return { client, transport };
};
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '{}';
  let body; try { body = JSON.parse(text); } catch { body = { ok: false, code: 'E_CLIENT_TEXT', text }; }
  out.toolLog.push({ tool: name, acts: Array.isArray(args.actions) ? args.actions.map((a) => ({ t: a.type, ticks: a.ticks })) : undefined, ok: body.ok ?? null, code: body.code ?? null, status: Array.isArray(body.actions) ? body.actions.map((a) => a.status) : undefined });
  return { isError: !!r.isError, body };
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: ev + '/video', size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: `${ev}/${n}.png` });
const sceneActive = (k) => page.evaluate((key) => window.__game?.scene.isActive(key) === true, k);
const world = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const p = w.sim.player.data;
  const wp = p.weapons.find((x) => x.key === p.weaponKey) ?? {};
  return {
    active: gs.sys.isActive(), tick: w.sim.tick, roomId: w.sim.roomId, paused: gs.paused, owner: w.player.control.owner,
    link: w.externalLink.snapshot(), hp: p.hp, x: w.sim.player.x, y: w.sim.player.y,
    enemies: w.enemies.length, drones: w.sim.drones.map((d) => ({ id: d.id, hp: d.hp, x: d.x, y: d.y })), targets: w.sim.targets.map((t) => ({ id: t.id, hp: t.hp, x: t.x, y: t.y, kind: t.kind })),
    targetHp: w.sim.targets.map((t) => t.id + ':' + t.hp),
    projectiles: w.sim.projectiles.length, fireTimer: w.sim.player.fireTimer,
    ammo: wp.ammo ?? null, magazine: wp.magazine ?? null, weapon: p.weaponKey
  };
});
const receipt = (aid) => page.evaluate((a) => { const w = window.__game.scene.getScene('GameScene').world; const r = w.externalLink.receipt(a); return r ? { status: r.status, appliedTick: r.appliedTick ?? null, startedTick: r.startedTick ?? null, completedTick: r.completedTick ?? null, executedTicks: r.executedTicks ?? null, durationTicks: r.durationTicks ?? null, code: r.code ?? null } : null; }, aid);
const waitDone = async (aid, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = await receipt(aid); if (r && ['applied', 'rejected', 'expired', 'cancelled'].includes(r.status)) return r; await sleep(100); } return await receipt(aid); };
const openForm = async () => {
  if (await page.locator('[data-testid="external-link-form"]').count()) return true;
  if (!(await sceneActive('PauseScene'))) {
    if (!(await sceneActive('GameScene'))) return false;
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), null, { timeout: 5000 }).catch(() => {});
  }
  const hasSetup = await page.evaluate(() => {
    const ps = window.__game?.scene.getScene('PauseScene');
    return !!ps && ps.children.list.some((c) => c.type === 'Text' && c.text === 'EXTERNAL LINK SETUP');
  });
  if (!hasSetup) { await page.mouse.click(640, 420); await page.waitForTimeout(450); }
  await page.mouse.click(640, 510);
  await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 5000 });
  return true;
};
const authorize = async () => {
  if (!(await openForm())) return false;
  await page.fill('input[name="bridgeUrl"]', BRIDGE);
  await page.fill('input[name="token"]', TOKEN);
  await page.click('form button[type="submit"]');
  const ok = await page.waitForFunction(() => !document.querySelector('[data-testid="external-link-form"]'), null, { timeout: 15000 }).then(() => true).catch(() => false);
  if (await sceneActive('PauseScene')) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  return ok;
};

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.waitForTimeout(700);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(800);
check('form-authorize', await authorize(), {});
check('owner-external', (await world()).owner === 'external', (await world()).link);
let { client, transport } = await mk();
const list = await call(client, 'world_list_sessions');
check('mcp-attached', !list.isError && list.body.attached === true, list.body);
let obs = await call(client, 'world_observe');
for (let i = 0; i < 20 && !(obs.body.observation?.tick > 0); i += 1) { await sleep(200); obs = await call(client, 'world_observe'); }

// ---------- fire ticks=120 in the safe start room: duration/cooldown/projectiles ----------
{
  const st = await world();
  const aid = actId();
  const samples = [];
  const sampler = setInterval(() => { world().then((s) => samples.push(s)).catch(() => {}); }, 100);
  await call(client, 'world_action', { requestId: reqId(), actions: [{ type: 'fire', actionId: aid, target: { x: st.x + 2, y: st.y }, ticks: 120 }] });
  const rec = await waitDone(aid, 15000);
  clearInterval(sampler);
  await sleep(200);
  const after = await world();
  const res = { receipt: rec, maxProjectiles: Math.max(0, ...samples.map((s) => s.projectiles), after.projectiles), cooldownFrames: samples.filter((s) => s.fireTimer > 0).length, ammo: { before: st.ammo, after: after.ammo }, magazine: { before: st.magazine, after: after.magazine }, weapon: st.weapon };
  out.steps.push({ name: 'fire-120-safe', res });
  check('fire-120-delivered-120-ticks', rec?.executedTicks === 120 && rec?.durationTicks === 120, rec);
  check('fire-creates-projectiles', res.maxProjectiles > 0, { maxProjectiles: res.maxProjectiles });
  check('fire-reaches-cooldown', res.cooldownFrames > 0, { cooldownFrames: res.cooldownFrames });
  check('pulse-ammo-is-infinite', st.weapon === 'pulse' && res.ammo.before === -1 && res.ammo.after === -1, res.ammo);
}
await shot('00-fire-safe');

// ---------- ticks=1 vs 120 (safe room, legal collision clamp) ----------
const move = async (dir, ticks) => {
  const b = await world();
  const aid = actId();
  await call(client, 'world_action', { requestId: reqId(), actions: [{ type: 'move', actionId: aid, dir, ticks }] });
  const rec = await waitDone(aid, 15000);
  await sleep(200);
  const a = await world();
  const ob = (await call(client, 'world_observe')).body.observation;
  return { ticks, receipt: rec, before: { tick: b.tick, x: b.x, y: b.y }, after: { tick: a.tick, x: a.x, y: a.y }, dist: +Math.hypot(a.x - b.x, a.y - b.y).toFixed(6), obsDist: ob ? +Math.hypot(ob.player.x - b.x, ob.player.y - b.y).toFixed(6) : null };
};
const t1 = await move({ x: 1, y: 0 }, 1);
const t120 = await move({ x: 1, y: 0 }, 120);
out.steps.push({ name: 'ticks', t1, t120 });
check('ticks-1-executes-one-core-tick', t1.receipt?.executedTicks === 1 && t1.receipt?.durationTicks === 1, t1.receipt);
check('ticks-120-executes-120-core-ticks', t120.receipt?.executedTicks === 120 && t120.receipt?.durationTicks === 120, t120.receipt);
check('ticks-120-moves-much-further-than-1', t120.dist > t1.dist * 5 && t120.dist > 1, { d1: t1.dist, d120: t120.dist, obs1: t1.obsDist, obs120: t120.obsDist });
await shot('01-after-ticks');

// ---------- takeover inside afterFrame await window x3 ----------
const raceRuns = [];
for (let k = 0; k < 3; k += 1) {
  const st = await world();
  if (!st.active || st.hp <= 0) { raceRuns.push({ k, dead: true }); break; }
  if (st.owner !== 'external' && !(await authorize())) { raceRuns.push({ k, authorized: false }); break; }
  const errBefore = errs.length;
  const before = await world();
  const run = await page.evaluate(async () => {
    const gs = window.__game.scene.getScene('GameScene');
    const link = gs.externalLink;
    if (!link) return { started: false, reason: 'no-link' };
    const client = link.client;
    if (!client) return { started: false, reason: 'no-client' };
    const snap0 = gs.world.externalLink.snapshot();
    link.heartbeatMs = 0; link.lastHeartbeatMs = 0;
    const orig = client.pushObservation.bind(client);
    client.pushObservation = (obs) => new Promise((resolve) => setTimeout(() => resolve(orig(obs)), 180));
    const aid = 'aid_' + 'cd'.repeat(12);
    const r = await fetch(link.options.bridgeUrl + '/world-link/action-submit', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + link.options.token },
      body: JSON.stringify({ session: snap0.session, epoch: snap0.epoch, requestId: 'req_' + 'cd'.repeat(12), actions: [{ type: 'move', actionId: aid, dir: { x: 1, y: 1 }, ticks: 60 }] })
    });
    const accepted = await r.json();
    const p = link.afterFrame();
    setTimeout(() => link.degrade('takeover'), 25);
    let caught = null;
    try { await p; } catch (e) { caught = String(e); }
    await new Promise((res) => setTimeout(res, 600));
    const rec = gs.world.externalLink.receipt(aid);
    const snap = gs.world.externalLink.snapshot();
    const p1 = { x: gs.world.sim.player.x, y: gs.world.sim.player.y };
    await new Promise((res) => setTimeout(res, 800));
    const p2 = { x: gs.world.sim.player.x, y: gs.world.sim.player.y };
    return { started: true, accepted: accepted.actions?.[0]?.status ?? null, caught, receipt: rec ? rec.status : null, owner: gs.world.player.control.owner, status: snap.status, pending: snap.pendingCount, postCancelDelta: +Math.hypot(p2.x - p1.x, p2.y - p1.y).toFixed(4) };
  });
  await sleep(400);
  const after = await world();
  raceRuns.push({ k, run, moved: +Math.hypot(after.x - before.x, after.y - before.y).toFixed(4), newErrors: errs.slice(errBefore) });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}
out.steps.push({ name: 'race', raceRuns });
check('await-window-takeover-no-crash-3x', raceRuns.length === 3 && raceRuns.every((r) => r.run?.caught === null && r.newErrors.length === 0), raceRuns.map((r) => ({ caught: r.run?.caught, errs: r.newErrors })));
check('await-window-takeover-cancels-pending', raceRuns.every((r) => r.run?.owner === 'human' && r.run?.pending === 0 && ['cancelled', 'expired', 'rejected'].includes(r.run?.receipt)), raceRuns.map((r) => ({ owner: r.run?.owner, pending: r.run?.pending, receipt: r.run?.receipt })));
check('cancelled-intent-does-not-continue-after-cancel', raceRuns.every((r) => r.run?.postCancelDelta < 0.05), raceRuns.map((r) => ({ postCancelDelta: r.run?.postCancelDelta, preCancelMove: r.moved })));

// the takeover rounds above invalidated the agent session: attach a fresh MCP process
check('reauthorize-after-race', await authorize(), await world().then((w) => ({ owner: w.owner })));
{
  const fresh = await mk();
  client = fresh.client;
  const l2 = await call(client, 'world_list_sessions');
  check('fresh-agent-attached-after-race', !l2.isError && l2.body.attached === true, l2.body);
}

// ---------- interact: real transition by the AGENT (portal placement disclosed) ----------
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  w.player.reset(w.portal.wx, w.portal.wy);
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral);
});
await sleep(200);
const roomBefore = (await world()).roomId;
const iAid = actId();
await call(client, 'world_action', { requestId: reqId(), actions: [{ type: 'interact', actionId: iAid }] });
const iRec = await waitDone(iAid);
let roomAfter = roomBefore;
for (let i = 0; i < 40; i += 1) { await sleep(150); const o = await call(client, 'world_observe'); if (o.body.ok && o.body.observation.roomId !== roomBefore) { roomAfter = o.body.observation.roomId; break; } }
out.steps.push({ name: 'agent-interact', roomBefore, roomAfter, receipt: iRec });
check('agent-interact-real-transition', roomAfter !== roomBefore && iRec?.status === 'applied', { roomBefore, roomAfter, receipt: iRec });
await page.waitForTimeout(1200);
out.steps.push({ name: 'room-state', dump: await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const view = w.observationView();
  return { roomId: w.sim.roomId, player: { x: w.sim.player.x, y: w.sim.player.y }, hp: w.sim.player.data.hp,
    drones: w.sim.drones.map((d) => ({ id: d.id, kind: d.data?.kind, x: d.x, y: d.y, hp: d.hp })),
    enemies: w.enemies.length,
    perceived: view.perceivedActors.map((a) => ({ id: a.id, kind: a.kind, x: a.x, y: a.y })) };
}) });

// ---------- combat: agent explores legally, then short bursts + kiting ----------
let combat = null;
{
  const hpBefore = new Map();
  let firstObs = (await call(client, 'world_observe')).body.observation;
  for (let i = 0; i < 16; i += 1) { if (firstObs?.drones?.length > 0) break; await sleep(250); firstObs = (await call(client, 'world_observe')).body.observation; }
  const exploreDirs = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  for (let i = 0; i < exploreDirs.length && !(firstObs?.drones?.length > 0); i += 1) {
    const st = await world();
    if (!st.active || st.owner !== 'external' || st.hp <= 30) break;
    await call(client, 'world_action', { requestId: reqId(), actions: [{ type: 'move', actionId: actId(), dir: exploreDirs[i], ticks: 40 }] });
    await sleep(900);
    firstObs = (await call(client, 'world_observe')).body.observation;
    out.steps.push({ name: 'explore-' + i, drones: firstObs?.drones?.length ?? 0, hp: (await world()).hp });
  }
  for (const d of firstObs?.drones ?? []) hpBefore.set(d.id, d.hp);
  out.steps.push({ name: 'combat-start', observedDrones: (firstObs?.drones ?? []).map((d) => ({ id: d.id, hp: d.hp, kind: d.kind })), worldTargets: (await world()).targets });
  const drops = [];
  let projectiles = 0;
  for (let round = 0; round < 10; round += 1) {
    const st = await world();
    if (!st.active || st.owner !== 'external' || st.hp <= 0) break;
    const o = (await call(client, 'world_observe')).body;
    if (!o.ok) break;
    projectiles = Math.max(projectiles, o.observation.projectiles.length);
    const alive = o.observation.drones.filter((d) => d.hp > 0);
    if (alive.length === 0) break;
    const nearest = alive.slice().sort((a, b) => Math.hypot(a.x - o.observation.player.x, a.y - o.observation.player.y) - Math.hypot(b.x - o.observation.player.x, b.y - o.observation.player.y))[0];
    if (!hpBefore.has(nearest.id)) hpBefore.set(nearest.id, nearest.hp);
    const dir = { x: Math.sign(o.observation.player.x - nearest.x) || 0, y: Math.sign(o.observation.player.y - nearest.y) || 0 };
    await call(client, 'world_action', { requestId: reqId(), actions: [
      { type: 'fire', actionId: actId(), target: { x: nearest.x, y: nearest.y }, ticks: 16 },
      { type: 'move', actionId: actId(), dir, ticks: 10 }
    ] });
    await sleep(700);
    const nowObs = (await call(client, 'world_observe')).body.observation;
    for (const d of nowObs?.drones ?? []) if (hpBefore.has(d.id) && d.hp < hpBefore.get(d.id) && !drops.some((x) => x.id === d.id)) drops.push({ id: d.id, before: hpBefore.get(d.id), after: d.hp, tick: nowObs.tick });
    if (drops.length > 0) break;
  }
  const stEnd = await world();
  combat = { drops, projectiles, hpAfter: stEnd.hp, targetsLeft: stEnd.targets.length, targetHp: stEnd.targetHp, roomId: stEnd.roomId };
}
out.steps.push({ name: 'combat', combat });
check('fire-damages-real-drone', (combat?.drops?.length ?? 0) > 0, combat);
await shot('02-combat');

// ---------- hard kill: independent agent lease ----------
const killAuth = await authorize();
check('kill-setup-authorized', killAuth && (await world()).owner === 'external', { killAuth, owner: (await world()).owner, hp: (await world()).hp });
if (killAuth) {
  const { client: c2, transport: t2 } = await mk();
  const attach2 = await call(c2, 'world_list_sessions');
  check('reattach-for-kill', !attach2.isError && attach2.body.attached === true, attach2.body);
  const oldSession = attach2.body.session;
  await call(c2, 'world_action', { requestId: reqId(), actions: [{ type: 'move', actionId: actId(), dir: { x: 1, y: 0 }, ticks: 120 }] });
  await sleep(250);
  const posBefore = await world();
  try { process.kill(t2.pid, 'SIGKILL'); } catch { /* ignore */ }
  const t0 = Date.now();
  let degraded = null;
  for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    const s = await world();
    if (s.owner === 'human' && s.link.pendingCount === 0) { degraded = { ms: Date.now() - t0, owner: s.owner, status: s.link.status, pending: s.link.pendingCount, tick: s.tick }; break; }
  }
  const posAtDegrade = await world();
  await sleep(800);
  const posAfter = await world();
  const movedBeforeDetection = +Math.hypot(posAtDegrade.x - posBefore.x, posAtDegrade.y - posBefore.y).toFixed(4);
  const movedAfterDetection = +Math.hypot(posAfter.x - posAtDegrade.x, posAfter.y - posAtDegrade.y).toFixed(4);
  out.steps.push({ name: 'kill', oldSession, degraded, movedBeforeDetection, movedAfterDetection });
  check('kill-degrades-within-15s', degraded !== null && degraded.ms <= 15000, degraded);
  check('kill-clears-pending', degraded?.pending === 0, { pending: degraded?.pending });
  check('kill-old-action-does-not-continue', movedAfterDetection < 0.2, { movedBeforeDetection, movedAfterDetection });
  const { client: c3 } = await mk();
  const dead = await call(c3, 'world_list_sessions');
  check('dead-list-not-attached', dead.isError === true || dead.body.attached === false, dead.body);
  await shot('03-after-kill');
  const re = await authorize();
  const { client: c4 } = await mk();
  const again = await call(c4, 'world_list_sessions');
  check('human-reauthorize-new-session', re && !again.isError && again.body.attached === true && again.body.session !== oldSession, { re, session: again.body.session, oldSession, attached: again.body.attached });
  const o2 = await call(c4, 'world_observe');
  check('new-session-real-observation', o2.body.ok === true, { tick: o2.body.observation?.tick });
  await shot('04-reauthorized');
  await c4.close().catch(() => {});
  await c3.close().catch(() => {});
  await c2.close().catch(() => {});
}
out.pageErrors = errs;
check('no-page-errors', errs.length === 0, errs);
out.video = page.video() ? await page.video().path() : null;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-fixes-final/effects.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]) }, null, 2));
await client.close().catch(() => {});
await ctx.close();
await browser.close();
