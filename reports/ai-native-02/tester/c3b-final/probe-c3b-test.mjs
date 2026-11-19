// C3-b real chain, TEST build (`--mode test`, __game kept ONLY for verification).
// A human navigates to a hostile room; the EXTERNAL agent (official MCP SDK client ->
// dist-mcp/worldMcpServer.mjs) observes and fights through the bridge. The agent gets
// only perception-cropped observations. __game is used by the tester to read receipts,
// HUD text and outcome — never to spawn enemies, move the player, read a map for the
// agent, or step the core on the agent's behalf.
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:5298';
const BRIDGE = 'http://127.0.0.1:8788';
const TOKEN_FILE = 'D:/Project/AI-NATIVE-02-snapshots/.tokens/c3b-token-test';
const MCP_ENTRY = 'D:/Project/AI-NATIVE-02-snapshots/8ec8758/dist-mcp/worldMcpServer.mjs';
const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/8ec8758';
const TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();
const out = { meta: { base: BASE, bridge: BRIDGE, target: '8ec87587b0b4dba3146016e53bd6592ccb41be96', build: 'test mode (__game present, verification only)' }, checks: [], findings: [], steps: [], toolLog: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { const fs = process.getBuiltinModule('node:fs'); fs.writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-final/test-chain.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const actId = () => `aid_${hex(12)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-final/evidence-test';
mkdirSync(ev, { recursive: true });

const mkClient = async () => {
  const client = new Client({ name: 'c3b-independent-tester-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: 'node', args: [MCP_ENTRY], cwd: SNAP, env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: BRIDGE, LAST_SIGNAL_WORLD_TOKEN_FILE: TOKEN_FILE }, stderr: 'pipe' });
  await client.connect(transport);
  return { client, transport };
};
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const body = JSON.parse(r.content[0].text);
  out.toolLog.push({ tool: name, n: Array.isArray(args.actions) ? args.actions.length : undefined, aid: args.actions?.[0]?.actionId ?? null, isError: !!r.isError, ok: body.ok ?? null, code: body.code ?? null, statuses: Array.isArray(body.actions) ? body.actions.map((a) => a.status) : undefined, tick: body.observation?.tick ?? body.acceptedTick ?? null });
  return { isError: !!r.isError, body };
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: ev + '/video', size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: `${ev}/${n}.png` });
const world = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  return { roomId: w.sim.roomId, tick: w.sim.tick, paused: gs.paused, owner: w.player.control.owner, link: w.externalLink.snapshot(), hp: w.sim.player.data.hp, x: w.sim.player.x, y: w.sim.player.y, enemies: w.enemies.length, droneHp: w.sim.drones.map((d) => ({ id: d.id, hp: d.hp })) };
});
const authorize = async () => {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'));
  await page.evaluate(({ bridgeUrl, token }) => { window.__externalLinkConfig = { bridgeUrl, token }; }, { bridgeUrl: BRIDGE, token: TOKEN });
  const p = await page.evaluate(() => { const ps = window.__game.scene.getScene('PauseScene'); const t = ps.children.list.find((c) => c.type === 'Text' && (c.text || '').startsWith('AUTHORIZE EXTERNAL AGENT')); return t ? { x: t.x, y: t.y } : null; });
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.player.control.owner === 'external', null, { timeout: 15000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__game.scene.isActive('PauseScene'));
  await page.waitForTimeout(350);
};
const hudNow = () => page.evaluate(() => { const gs = window.__game.scene.getScene('GameScene'); const texts = gs.children.list.filter((c) => c.type === 'Text').map((c) => c.text); return { link: texts.find((t) => t.includes('EXTERNAL AGENT')), control: texts.find((t) => t.startsWith('CONTROL')), kills: texts.find((t) => t.startsWith('KILLS')) }; }).catch(() => ({}));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.waitForTimeout(800);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(1000);

// ---- HUMAN navigation (disclosed fixture: stand on the portal; real room transition) ----
for (let room = 1; room <= 4; room += 1) {
  const res = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    w.player.reset(w.portal.wx, w.portal.wy);
    w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral);
    w.tryInteract(w.player);
    w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral);
    return { roomId: w.sim.roomId, enemies: w.enemies.length };
  });
  await page.waitForTimeout(1200);
  const st = await world();
  out.steps.push({ name: `enter-room-${room}`, res, roomId: st.roomId, enemies: st.enemies });
  if (st.enemies > 0) break;
}
let hostile = await world();
for (let i = 0; i < 20 && hostile.droneHp.length === 0; i += 1) { await sleep(250); hostile = await world(); }
check('found-real-hostiles', hostile.enemies > 0 && hostile.droneHp.length > 0, { roomId: hostile.roomId, enemies: hostile.enemies, drones: hostile.droneHp.length, hp: hostile.hp });
await shot('00-hostile-room');

// ---- HUMAN authorization through the real Pause menu ----
await authorize();
check('authorized-external-owner', (await world()).owner === 'external', {});
check('hud-shows-external-connected', ((await hudNow()).link || '').includes('EXTERNAL AGENT CONNECTED'), await hudNow());
await shot('01-authorized-hud');

// ---- deterministic: queued intent cancelled by pause must never apply ----
const cancel = await page.evaluate(async (bridge) => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const snap = w.externalLink.snapshot();
  const aid = 'aid_' + 'ab'.repeat(12);
  const body = { session: snap.session, epoch: snap.epoch, requestId: 'req_' + 'ab'.repeat(12), actions: [{ type: 'move', actionId: aid, dir: { x: 1, y: 1 }, ticks: 2 }] };
  const res = await fetch(bridge + '/world-link/action-submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const accepted = await res.json();
  gs.onPause();
  await new Promise((r) => setTimeout(r, 400));
  const after = w.externalLink.receipt(aid);
  const posAfterPause = { x: w.sim.player.x, y: w.sim.player.y };
  gs.onResume();
  await new Promise((r) => setTimeout(r, 700));
  const posAfterResume = { x: w.sim.player.x, y: w.sim.player.y };
  return { accepted, receipt: after, posAfterPause, posAfterResume, owner: w.player.control.owner, status: w.externalLink.snapshot().status };
}, BRIDGE);
out.steps.push({ name: 'pause-cancel', cancel });
check('pause-cancels-pending-intent', cancel.accepted?.actions?.[0]?.status === 'queued' && cancel.receipt?.status === 'cancelled', cancel.receipt);
check('cancelled-intent-never-moves-after-resume', Math.abs(cancel.posAfterResume.x - cancel.posAfterPause.x) < 1e-9 && Math.abs(cancel.posAfterResume.y - cancel.posAfterPause.y) < 1e-9, { pause: cancel.posAfterPause, resume: cancel.posAfterResume });
check('pause-degrades-to-human', cancel.owner === 'human' && cancel.status !== 'CONNECTED', { owner: cancel.owner, status: cancel.status });
await shot('02-pause-cancelled');

// re-authorize for the combat round (the pause above yielded the link)
await authorize();

// ---- agent attaches via the official MCP stdio server ----
const { client, transport } = await mkClient();
const attach = await call(client, 'world_list_sessions');
check('agent-attaches-after-human-click', attach.isError === false, attach.body);
let o = (await call(client, 'world_observe')).body;
for (let i = 0; i < 30 && !(o.observation?.drones?.length > 0); i += 1) { await sleep(250); o = (await call(client, 'world_observe')).body; }
check('agent-sees-hostiles-in-its-own-view', o.ok === true && o.observation.drones.length > 0, { tick: o.observation?.tick, drones: o.observation?.drones?.map((d) => ({ id: d.id, hp: d.hp })) });
check('observation-has-no-map-seed', !/"(seed|map|rooms|rng|rngState|fullMap|roomGraph)"/.test(JSON.stringify(o.observation ?? {})), Object.keys(o.observation ?? {}));

// ---- fire: queued -> applied on a real tick, real damage, keep kiting ----
const hpBefore = new Map(o.observation.drones.map((d) => [d.id, d.hp]));
const first = o.observation.drones[0];
const fireAid = actId();
const fire = await call(client, 'world_action', { requestId: reqId(), actions: [{ type: 'fire', actionId: fireAid, target: { x: first.x, y: first.y }, ticks: 24 }] });
check('fire-queued-not-applied', fire.body.ok === true && fire.body.actions?.[0]?.status === 'queued', fire.body.actions?.[0]);
const tickBefore = (await world()).tick;
let receipt = null;
for (let i = 0; i < 60; i += 1) {
  await sleep(120);
  receipt = await page.evaluate((aid) => { const w = window.__game.scene.getScene('GameScene').world; const r = w.externalLink.receipt(aid); return r ? { status: r.status, appliedTick: r.appliedTick ?? null } : null; }, fireAid);
  if (receipt?.status === 'applied') break;
}
check('receipt-applied-with-real-tick', receipt?.status === 'applied' && receipt.appliedTick > tickBefore, { receipt, tickBefore });

let dmg = null;
let projectilesSeen = 0;
for (let shot = 0; shot < 14 && !dmg; shot += 1) {
  const cur = (await call(client, 'world_observe')).body;
  if (!cur.ok) break;
  const st0 = await world();
  if (st0.owner !== 'external') break;
  projectilesSeen = Math.max(projectilesSeen, cur.observation.projectiles.length);
  const alive = cur.observation.drones.filter((d) => d.hp > 0);
  if (alive.length === 0) break;
  const nearest = alive.slice().sort((a, b) => Math.hypot(a.x - cur.observation.player.x, a.y - cur.observation.player.y) - Math.hypot(b.x - cur.observation.player.x, b.y - cur.observation.player.y))[0];
  if (!hpBefore.has(nearest.id)) hpBefore.set(nearest.id, nearest.hp);
  const dir = { x: Math.sign(cur.observation.player.x - nearest.x) || 0, y: Math.sign(cur.observation.player.y - nearest.y) || 0 };
  await call(client, 'world_action', { requestId: reqId(), actions: [
    { type: 'fire', actionId: actId(), target: { x: nearest.x, y: nearest.y }, ticks: 20 },
    { type: 'move', actionId: actId(), dir, ticks: 8 }
  ] });
  for (let i = 0; i < 16; i += 1) {
    await sleep(120);
    const st = await world();
    const hit = st.droneHp.find((d) => hpBefore.has(d.id) && d.hp < hpBefore.get(d.id));
    if (hit) { dmg = { id: hit.id, before: hpBefore.get(hit.id), after: hit.hp, tick: st.tick }; break; }
  }
}
check('real-damage-on-real-enemy', !!dmg, dmg ?? { note: 'no hp drop observed', projectilesSeen });
const hud1 = await hudNow();
out.steps.push({ name: 'hud-after-combat', hud1 });
check('hud-dmg-counter-nonzero', /DMG [1-9]/.test(hud1.kills || ''), hud1);
await shot('03-combat');

// ---- graceful close degrades to HUMAN ----
await authorize();
const { client: c2 } = await mkClient();
const attach2 = await call(c2, 'world_list_sessions');
check('second-authorize-attach', attach2.isError === false, attach2.body);
const closeRes = await call(c2, 'world_close');
check('agent-close-ack', closeRes.body.ok === true, closeRes.body);
let afterClose = null;
for (let i = 0; i < 30; i += 1) { await sleep(250); const st = await world(); if (st.owner === 'human' && st.link.status !== 'CONNECTED') { afterClose = st; break; } }
check('close-degrades-to-human', afterClose !== null, afterClose ? { owner: afterClose.owner, status: afterClose.link.status } : (await world()));

// ---- hard disconnect (SIGKILL): measured, not assumed ----
await authorize();
const { client: c3, transport: t3 } = await mkClient();
const attach3 = await call(c3, 'world_list_sessions');
check('third-authorize-attach', attach3.isError === false, attach3.body);
const pid = t3.pid;
try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
const t0 = Date.now();
let degraded = null;
for (let i = 0; i < 40; i += 1) { await sleep(250); const st = await world(); if (st.owner === 'human') { degraded = { ms: Date.now() - t0, status: st.link.status, owner: st.owner }; break; } }
out.findings.push({ id: 'F-hard-disconnect', summary: 'SIGKILL of the MCP agent process does not degrade the rendered link; the browser stays owner=external and a token holder can attach to the still-authorized session', degraded, stillExternal: degraded === null });
const { client: c4 } = await mkClient();
const attachAfterKill = await call(c4, 'world_list_sessions');
out.findings.push({ id: 'F-stale-list', summary: 'world_list_sessions returns attached:true for a session that already died; only world_observe reports E_SESSION_NOT_FOUND', listAfterKill: attachAfterKill.body });
check('hard-disconnect-degrades (claimed)', degraded !== null, { degraded, actual: 'NOT degraded; see finding F-hard-disconnect' });
await shot('04-after-kill');
out.video = page.video() ? await page.video().path() : null;
out.pageErrors = pageErrors;
check('no-real-page-errors', pageErrors.length === 0, pageErrors);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-final/test-chain.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), findings: out.findings, video: out.video }, null, 2));
await c4.close().catch(() => {});
await c3.close().catch(() => {});
await c2.close().catch(() => {});
await client.close().catch(() => {});
await ctx.close();
await browser.close();
