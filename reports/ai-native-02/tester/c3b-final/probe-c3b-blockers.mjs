// C3-b independent blocker evidence (frozen 8ec8758, test-mode build + __game for
// VERIFICATION ONLY; all agent actions go through the real bridge and official MCP
// stdio server). Focus: ticks ignored, async degrade/afterFrame race, projectile
// observation leak, plus hard-disconnect behavior.
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:5298';
const BRIDGE = 'http://127.0.0.1:8788';
const TOKEN = readFileSync('D:/Project/AI-NATIVE-02-snapshots/.tokens/c3b-token-test', 'utf8').trim();
const MCP = 'D:/Project/AI-NATIVE-02-snapshots/8ec8758/dist-mcp/worldMcpServer.mjs';
const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/8ec8758';
const ev = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-final/evidence-blockers';
mkdirSync(ev, { recursive: true });
const out = { meta: { base: BASE, bridge: BRIDGE, target: '8ec87587b0b4dba3146016e53bd6592ccb41be96', build: 'test mode, __game verification only' }, checks: [], findings: [], steps: [], toolLog: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-final/blockers.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const actId = () => `aid_${hex(12)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mk = async () => {
  const client = new Client({ name: 'c3b-blocker-tester', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: 'node', args: [MCP], cwd: SNAP, env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: BRIDGE, LAST_SIGNAL_WORLD_TOKEN_FILE: 'D:/Project/AI-NATIVE-02-snapshots/.tokens/c3b-token-test' }, stderr: 'pipe' });
  await client.connect(transport);
  return { client, transport };
};
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '{}';
  let body;
  try { body = JSON.parse(text); } catch { body = { ok: false, code: 'E_CLIENT_TEXT', text: text.slice(0, 200) }; }
  out.toolLog.push({ tool: name, n: Array.isArray(args.actions) ? args.actions.length : undefined, args: name === 'world_action' ? args.actions?.map((a) => ({ type: a.type, ticks: a.ticks })) : undefined, ok: body.ok ?? null, code: body.code ?? null, statuses: Array.isArray(body.actions) ? body.actions.map((a) => a.status) : undefined, tick: body.observation?.tick ?? body.acceptedTick ?? null });
  return { isError: !!r.isError, body };
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: ev + '/video', size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push('console: ' + m.text()); });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.waitForTimeout(600);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(800);

const state = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  return { tick: w.sim.tick, x: w.sim.player.x, y: w.sim.player.y, owner: w.player.control.owner, link: w.externalLink.snapshot().status, paused: gs.paused, projectiles: w.sim.projectiles.length, hp: w.sim.player.data.hp };
});
const ensureAuthorized = async () => {
  const st = await state();
  if (st.owner === 'external') return true;
  if (!(await page.evaluate(() => window.__game.scene.isActive('PauseScene')))) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), null, { timeout: 5000 });
  }
  await page.evaluate(({ bridgeUrl, token }) => { window.__externalLinkConfig = { bridgeUrl, token }; }, { bridgeUrl: BRIDGE, token: TOKEN });
  const p = await page.evaluate(() => { const ps = window.__game.scene.getScene('PauseScene'); const t = ps.children.list.find((c) => c.type === 'Text' && (c.text || '').startsWith('AUTHORIZE EXTERNAL AGENT')); return t ? { x: t.x, y: t.y } : null; });
  if (!p) return false;
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  try {
    await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.player.control.owner === 'external', null, { timeout: 12000 });
  } catch { return false; }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__game.scene.isActive('PauseScene'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
  return true;
};
const waitReceipt = async (aid) => {
  for (let i = 0; i < 80; i += 1) {
    await sleep(100);
    const r = await page.evaluate((a) => { const w = window.__game.scene.getScene('GameScene').world; const x = w.externalLink.receipt(a); return x ? { status: x.status, appliedTick: x.appliedTick ?? null } : null; }, aid);
    if (r && r.status !== 'queued') return r;
  }
  return null;
};

// ---------- setup: authorize + agent attach ----------
check('authorized', await ensureAuthorized(), await state());
const { client } = await mk();
const at = await call(client, 'world_list_sessions');
check('agent-attached', !at.isError, at.body);

// ---------- BLOCKER 1: ticks is ignored ----------
const measureMove = async (dir, ticks) => {
  const before = await state();
  const aid = actId();
  const sub = await call(client, 'world_action', { requestId: reqId(), actions: [{ type: 'move', actionId: aid, dir, ticks }] });
  const rec = await waitReceipt(aid);
  await sleep(250);
  const after = await state();
  return { ticks, queued: sub.body.actions?.[0]?.status, receipt: rec, before: { x: before.x, y: before.y, tick: before.tick }, after: { x: after.x, y: after.y, tick: after.tick }, dx: +(after.x - before.x).toFixed(6), dy: +(after.y - before.y).toFixed(6), dist: +Math.hypot(after.x - before.x, after.y - before.y).toFixed(6), tickDelta: after.tick - before.tick };
};
const m1 = await measureMove({ x: 1, y: 0 }, 1);
const m120 = await measureMove({ x: -1, y: 0 }, 120);
// reference: 24 actions x 1 tick each = 24 real ticks of movement (8 per batch)
const refBefore = await state();
const refAids = Array.from({ length: 24 }, () => actId());
for (let i = 0; i < refAids.length; i += 8) {
  await call(client, 'world_action', { requestId: reqId(), actions: refAids.slice(i, i + 8).map((a) => ({ type: 'move', actionId: a, dir: { x: 1, y: 0 }, ticks: 1 })) });
}
for (const a of refAids) await waitReceipt(a);
await sleep(250);
const refAfter = await state();
const m20x1 = { dist: +Math.hypot(refAfter.x - refBefore.x, refAfter.y - refBefore.y).toFixed(6), tickDelta: refAfter.tick - refBefore.tick, before: { x: refBefore.x, y: refBefore.y }, after: { x: refAfter.x, y: refAfter.y } };
out.steps.push({ name: 'ticks', m1, m120, m20x1 });
check('ticks-120-is-not-120-ticks-of-movement', m120.dist < m20x1.dist / 3, { oneActionTicks120: m120.dist, twentyRealTicks: m20x1.dist, ticks1: m1.dist });

// wall block: walk until stuck, then request 120 ticks into the same wall
let stuck = null;
let before = await state();
for (let i = 0; i < 14; i += 1) {
  const aids = Array.from({ length: 8 }, () => actId());
  await call(client, 'world_action', { requestId: reqId(), actions: aids.map((a) => ({ type: 'move', actionId: a, dir: { x: 0, y: 1 }, ticks: 4 })) });
  for (const a of aids) await waitReceipt(a);
  await sleep(200);
  const now = await state();
  if (Math.hypot(now.x - before.x, now.y - before.y) < 1e-6) { stuck = now; break; }
  before = now;
}
if (stuck) {
  const b = await state();
  const aid = actId();
  await call(client, 'world_action', { requestId: reqId(), actions: [{ type: 'move', actionId: aid, dir: { x: 0, y: 1 }, ticks: 120 }] });
  const rec = await waitReceipt(aid);
  await sleep(250);
  const a = await state();
  out.steps.push({ name: 'wall-block', rec, delta: { dx: a.x - b.x, dy: a.y - b.y } });
  check('blocked-move-still-reported-applied', rec?.status === 'applied' && Math.hypot(a.x - b.x, a.y - b.y) < 1e-6, { rec, delta: { dx: a.x - b.x, dy: a.y - b.y } });
} else {
  check('blocked-move-still-reported-applied', false, { note: 'no wall reached' });
}

// fire ticks: 1 vs 120 -> same single shot?
const fireCompare = async (ticks) => {
  const beforeF = await state();
  const aid = actId();
  await call(client, 'world_action', { requestId: reqId(), actions: [{ type: 'fire', actionId: aid, target: { x: beforeF.x + 3, y: beforeF.y }, ticks }] });
  const rec = await waitReceipt(aid);
  let maxP = 0;
  for (let i = 0; i < 20; i += 1) { await sleep(80); const s = await state(); maxP = Math.max(maxP, s.projectiles); }
  return { ticks, receipt: rec, maxProjectiles: maxP };
};
const f1 = await fireCompare(1);
await sleep(600);
const f120 = await fireCompare(120);
out.steps.push({ name: 'fire-ticks', f1, f120 });
check('fire-ticks-not-honoured-as-duration', f1.maxProjectiles <= 2 && f120.maxProjectiles <= 2, { f1, f120 });

// ---------- BLOCKER 2: degrade during afterFrame await -> null heartbeat ----------
const raceRuns = [];
for (let i = 0; i < 3; i += 1) {
  const ok = await ensureAuthorized();
  if (!ok) { raceRuns.push({ i, authorized: false }); continue; }
  const errBefore = pageErrors.length;
  const run = await page.evaluate(async () => {
    const gs = window.__game.scene.getScene('GameScene');
    const link = gs.externalLink;
    const client = link.client;
    if (!client) return { started: false };
    link.lastHeartbeatMs = 0; // force the heartbeat branch after the await
    link.heartbeatMs = 0;
    const orig = client.pushObservation.bind(client);
    client.pushObservation = (obs) => new Promise((resolve) => setTimeout(() => resolve(orig(obs)), 180));
    const promise = link.afterFrame(); // same unawaited call as the game loop
    setTimeout(() => link.degrade('takeover'), 25); // human takeover inside the await window
    let caught = null;
    try { await promise; } catch (e) { caught = String(e); }
    await new Promise((r) => setTimeout(r, 250));
    return { started: true, caught, owner: gs.world.player.control.owner, status: gs.world.externalLink.snapshot().status };
  });
  await sleep(300);
  raceRuns.push({ i, run, newErrors: pageErrors.slice(errBefore) });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
out.steps.push({ name: 'race', raceRuns });
const heartbeatErrors = raceRuns.filter((r) => (r.newErrors || []).some((e) => /heartbeat/i.test(e)) || /heartbeat/i.test(r.run?.caught || ''));
check('async-degrade-race-reproduced', heartbeatErrors.length >= 3, raceRuns.map((r) => ({ caught: r.run?.caught, errs: r.newErrors })));

// ---------- extra: hard disconnect does not degrade (own finding) ----------
const ok4 = await ensureAuthorized();
let hard = null;
if (ok4) {
  const { client: c4, transport: t4 } = await mk();
  await call(c4, 'world_list_sessions');
  const pid = t4.pid;
  try { process.kill(pid, 'SIGKILL'); } catch {}
  const t0 = Date.now();
  let humanAt = null;
  for (let i = 0; i < 32; i += 1) { await sleep(250); const s = await state(); if (s.owner === 'human') { humanAt = { ms: Date.now() - t0, status: s.link }; break; } }
  const { client: c5 } = await mk();
  const reattach = await call(c5, 'world_list_sessions');
  hard = { pid, humanAt, stillExternal: humanAt === null, reattachOk: !reattach.isError };
  out.findings.push({ id: 'F-hard-disconnect', summary: 'SIGKILL of the agent process leaves the rendered link CONNECTED/owner=external; a token holder can attach to the still-authorized session', ...hard });
  check('hard-disconnect-does-not-degrade (finding)', hard.stillExternal === true, hard);
  await c5.close().catch(() => {});
}

out.pageErrors = pageErrors.filter((e) => !/Failed to load resource/.test(e));
out.video = page.video() ? await page.video().path() : null;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-final/blockers.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), findings: out.findings, steps: out.steps, errors: out.pageErrors }, null, 2));
await client.close().catch(() => {});
await ctx.close();
await browser.close();
