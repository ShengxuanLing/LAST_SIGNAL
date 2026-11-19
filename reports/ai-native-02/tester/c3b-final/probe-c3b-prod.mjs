// C3-b real chain v2, PRODUCTION build (no __game).
// Rendered browser <-> loopback bridge <-> official MCP SDK client -> dist-mcp/worldMcpServer.mjs
// A FRESH MCP server process is used per phase, because one process caches its
// session id and (finding) keeps reporting attached after the session died.
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const BASE = 'http://localhost:5297';
const BRIDGE = process.env.LAST_SIGNAL_WORLD_BRIDGE_URL ?? 'http://127.0.0.1:8787';
const TOKEN_FILE = process.env.LAST_SIGNAL_WORLD_TOKEN_FILE;
const MCP_ENTRY = process.env.LS_WORLD_MCP;
const SNAP = process.env.LS_SNAP;
const TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();
const TOKEN_TAG = createHash('sha256').update(TOKEN).digest('hex').slice(0, 12);
const out = { meta: { base: BASE, bridge: BRIDGE, target: '8ec87587b0b4dba3146016e53bd6592ccb41be96', build: 'production (no __game)', tokenTag: TOKEN_TAG, tokenLen: TOKEN.length }, checks: [], findings: [], steps: [], toolLog: [], errors: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { const fs = process.getBuiltinModule('node:fs'); fs.writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-final/prod-chain.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const actId = () => `aid_${hex(12)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-final/evidence-prod';
mkdirSync(ev, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: ev + '/video', size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
const shot = async (name) => page.screenshot({ path: `${ev}/${name}.png` });

const clients = [];
const mkClient = async () => {
  const client = new Client({ name: 'c3b-independent-tester', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: 'node', args: [MCP_ENTRY], cwd: SNAP,
    env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: BRIDGE, LAST_SIGNAL_WORLD_TOKEN_FILE: TOKEN_FILE },
    stderr: 'pipe'
  });
  await client.connect(transport);
  clients.push(client);
  return client;
};
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const body = JSON.parse(r.content[0].text);
  out.toolLog.push({
    tool: name, req: args.requestId ?? null, aid: args.actions?.[0]?.actionId ?? null,
    n: Array.isArray(args.actions) ? args.actions.length : undefined,
    isError: !!r.isError, ok: body.ok ?? null, code: body.code ?? null,
    statuses: Array.isArray(body.actions) ? body.actions.map((a) => a.status) : undefined,
    tick: body.observation?.tick ?? body.acceptedTick ?? null
  });
  return { isError: !!r.isError, body };
};
const obs = async (client) => { const r = await call(client, 'world_observe'); return r.body.ok ? r.body.observation : null; };
const attachNew = async () => {
  const c = await mkClient();
  const r = await call(c, 'world_list_sessions');
  return { client: c, attached: !r.isError, body: r.body };
};
const waitAttach = async (label) => {
  for (let i = 0; i < 45; i += 1) {
    const c = await mkClient();
    const r = await call(c, 'world_list_sessions');
    if (!r.isError) return c;
    await c.close().catch(() => {});
    await sleep(400);
  }
  return null;
};
const clickAuthorize = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(650);
  await page.evaluate(({ bridgeUrl, token }) => { window.__externalLinkConfig = { bridgeUrl, token }; }, { bridgeUrl: BRIDGE, token: TOKEN });
  await page.mouse.click(640, 622);
};
const submitMoves = async (client, dir, n, ticks = 2) => {
  const actions = Array.from({ length: n }, () => ({ type: 'move', actionId: actId(), dir, ticks }));
  return call(client, 'world_action', { requestId: reqId(), actions });
};

// ---------- pre-authorization ----------
const pre = await attachNew();
const preAct = await call(pre.client, 'world_action', { requestId: reqId(), actions: [{ type: 'move', actionId: actId(), dir: { x: 1, y: 0 }, ticks: 2 }] });
const selfAuth = await fetch(`${BRIDGE}/world-link/handshake`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ authorized: true, protocolVersion: 1 }) });
check('pre-auth-attach-denied', pre.attached === false && pre.body.code === 'E_PERMISSION', pre.body);
check('pre-auth-action-denied', preAct.isError && preAct.body.code === 'E_PERMISSION', preAct.body);
check('agent-cannot-self-authorize', selfAuth.status === 403, { status: selfAuth.status });
await pre.client.close().catch(() => {});

// ---------- human starts a run, authorizes ----------
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2200);
check('prod-no-game-handle', (await page.evaluate(() => typeof window.__game === 'undefined')) === true);
check('prod-token-not-in-dom', !(await page.evaluate((t) => document.documentElement.outerHTML.includes(t), TOKEN)));
await shot('00-menu');
await page.mouse.click(640, 340);
await page.waitForTimeout(1600);
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
await page.evaluate(({ bridgeUrl, token }) => { window.__externalLinkConfig = { bridgeUrl, token }; }, { bridgeUrl: BRIDGE, token: TOKEN });
await shot('01-pause-authorize');
await page.mouse.click(640, 622);
const c1 = await waitAttach('authorize');
check('human-authorize-creates-attachable-session', c1 !== null, c1 ? {} : {});
if (!c1) throw new Error('no attach after authorize');
await shot('02-pause-connected');
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);
await shot('03-hud-external');

// ---------- observe: real post-commit tick, perception-only ----------
let o = await obs(c1);
for (let i = 0; i < 30 && !(o && o.tick > 0); i += 1) { await sleep(250); o = await obs(c1); }
check('post-commit-observation', !!o && o.tick > 0, o ? { tick: o.tick, roomId: o.roomId, keys: Object.keys(o) } : null);
const obsText = JSON.stringify(o ?? {});
check('observation-no-seed-map-rng', !/"(seed|map|rooms|rng|rngState|fullMap|roomGraph)"/.test(obsText), Object.keys(o ?? {}));
const start = o;

// ---------- move: queued -> real commit (batch of legal PlayerIntents) ----------
const mv = await submitMoves(c1, { x: 1, y: 0 }, 8, 2);
check('move-batch-accepted-queued', mv.body.ok === true && mv.body.actions.every((a) => a.status === 'queued'), mv.body.actions?.slice(0, 2));
let moved = null;
for (let i = 0; i < 35; i += 1) {
  await sleep(150);
  const cur = await obs(c1);
  if (cur && cur.player.x > start.player.x + 0.3) { moved = cur; break; }
}
check('move-actually-committed', !!moved && moved.tick > start.tick, moved ? { from: { x: start.player.x, y: start.player.y, tick: start.tick }, to: { x: moved.player.x, y: moved.player.y, tick: moved.tick } } : { from: start.player });
await shot('04-moved');

// ---------- aim / fire / damage through the same core tick ----------
let cur = moved ?? start;
const aim = await call(c1, 'world_action', { requestId: reqId(), actions: [{ type: 'aim', actionId: actId(), target: { x: cur.player.x + 3, y: cur.player.y } }] });
let aimApplied = null;
for (let i = 0; i < 10; i += 1) { await sleep(120); const n = await obs(c1); if (n && Math.abs(n.player.aimYaw - cur.player.aimYaw) > 1e-3) { aimApplied = n.player.aimYaw; break; } }
check('aim-actually-committed', aim.body.ok === true && aimApplied !== null, { queued: aim.body.actions?.[0]?.status, yaw: aimApplied });

// walk right until a hostile is perceived (up to ~12 batches)
let combat = null;
for (let b = 0; b < 12; b += 1) {
  const n = await obs(c1);
  if (n && n.drones.length > 0) { combat = n; break; }
  await submitMoves(c1, { x: 1, y: 0 }, 6, 2);
  await sleep(700);
}
if (combat) {
  const target = combat.drones[0];
  const beforeHp = combat.drones.map((d) => ({ id: d.id, hp: d.hp }));
  const fire = await call(c1, 'world_action', { requestId: reqId(), actions: [{ type: 'fire', actionId: actId(), target: { x: target.x, y: target.y }, ticks: 12 }] });
  let projectiles = 0;
  let damage = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(110);
    const n = await obs(c1);
    if (!n) continue;
    projectiles = Math.max(projectiles, n.projectiles.length);
    const hurt = n.drones.find((d) => beforeHp.some((b) => b.id === d.id && d.hp < b.hp));
    if (hurt) { damage = { id: hurt.id, kind: hurt.kind, before: beforeHp.find((b) => b.id === hurt.id).hp, after: hurt.hp, tick: n.tick }; break; }
  }
  check('fire-creates-real-projectiles', projectiles > 0, { projectiles, queued: fire.body.actions?.[0]?.status });
  check('fire-deals-real-damage', !!damage, damage);
  await shot('05-combat');
} else {
  check('fire-creates-real-projectiles', false, { note: 'no hostile perceived after walking right 12 batches' });
}
const it = await call(c1, 'world_action', { requestId: reqId(), actions: [{ type: 'interact', actionId: actId() }] });
check('interact-accepted', it.body.ok === true && it.body.actions?.[0]?.status === 'queued', it.body.actions?.[0]);

// ---------- pause voids the queued intent, link yields ----------
await submitMoves(c1, { x: -1, y: 0 }, 8, 2);
await page.keyboard.press('Escape');
await page.waitForTimeout(1800);
await shot('06-paused');
const pauseObs = await call(c1, 'world_observe');
check('pause-voids-rendered-session', pauseObs.isError === true && pauseObs.body.code === 'E_SESSION_NOT_FOUND', pauseObs.body);
const afterPauseAttach = await attachNew();
check('pause-blocks-new-agent-attach', afterPauseAttach.attached === false, afterPauseAttach.body);
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);
const afterResumeAttach = await attachNew();
check('resume-no-auto-retake', afterResumeAttach.attached === false, afterResumeAttach.body);
await shot('07-resumed-human');

// ---------- fresh authorize; human takeover (key) voids the link ----------
await clickAuthorize();
const c2 = await waitAttach('takeover-phase');
check('fresh-authorize-after-yield', c2 !== null, {});
if (c2) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const preT = await obs(c2);
  await submitMoves(c2, { x: 1, y: 1 }, 8, 2);
  await page.keyboard.press('d');
  await page.waitForTimeout(1500);
  const tObs = await call(c2, 'world_observe');
  check('takeover-voids-link', tObs.isError === true, tObs.body);
  await shot('08-takeover');
}

// ---------- fresh authorize; agent close degrades to HUMAN ----------
await clickAuthorize();
const c3 = await waitAttach('close-phase');
check('fresh-authorize-for-close', c3 !== null, {});
if (c3) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const beforeClose = await obs(c3);
  const closed = await call(c3, 'world_close');
  check('agent-close-ok', closed.body.ok === true, closed.body);
  await page.waitForTimeout(1800);
  const after = await call(c3, 'world_observe');
  check('close-ends-agent-control', after.isError === true, after.body);
  const attachAfterClose = await attachNew();
  check('close-blocks-attach', attachAfterClose.attached === false, attachAfterClose.body);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await shot('09-after-close-pause');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

// ---------- fresh authorize; hard disconnect (SIGKILL) degrades to HUMAN ----------
await clickAuthorize();
const c4 = await waitAttach('disconnect-phase');
check('fresh-authorize-for-disconnect', c4 !== null, {});
if (c4) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const beforeD = await obs(c4);
  const transport = c4.transport;
  const pid = transport?.process?.pid;
  out.steps.push({ name: 'disconnect', pid: pid ?? null, tickBefore: beforeD?.tick ?? null });
  try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
  const t0 = Date.now();
  let attachFailedAt = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(400);
    const c = await mkClient();
    const r = await call(c, 'world_list_sessions');
    await c.close().catch(() => {});
    if (r.isError) { attachFailedAt = Date.now() - t0; break; }
  }
  check('disconnect-voids-agent', attachFailedAt !== null, { ms: attachFailedAt });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await shot('10-after-disconnect-pause');
}

check('no-page-errors', pageErrors.length === 0, pageErrors);
out.video = page.video() ? await page.video().path() : null;
out.pageErrors = pageErrors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-final/prod-chain.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), video: out.video, pageErrors }, null, 2));
for (const c of clients) await c.close().catch(() => {});
await ctx.close();
await browser.close();
