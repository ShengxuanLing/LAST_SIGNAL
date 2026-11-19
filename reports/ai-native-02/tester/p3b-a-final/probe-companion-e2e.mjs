// P3-b A: Independent acceptance of Companion / Owner confirmation wiring (frozen a1e23cd)
// Real browser UI → Companion authorize → official MCP SDK agent → observe/suggest → confirm → core echo action
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/a1e23dd';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3b-a-final';
const DEV = 'http://localhost:5392/';
const BRIDGE_URL = 'http://127.0.0.1:8904';
const TOKEN_FILE = `${OUT}/.bridge-token`;
mkdirSync(OUT, { recursive: true });
mkdirSync(`${OUT}/evidence`, { recursive: true });
const TOKEN = randomBytes(24).toString('hex');
writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });

const out = {
  meta: { target: 'a1e23dd17ab5ba79795472aae5ad37000aff4151' },
  checks: [], steps: [], findings: []
};
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { writeFileSync(OUT + '/companion-e2e.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const reqId = () => `req_${hex(12)}`;
const sugId = () => `sug_${hex(12)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: `${OUT}/evidence/${n}.png` });

const state = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const e = w.echoActor;
  return {
    tick: w.sim.tick, paused: gs.paused, companion: gs.companionStatus,
    echo: e ? { x: e.x, y: e.y, hp: e.data.hp } : null,
    echoShots: w.echoShotsFired, pending: w.hasPendingCompanionIntent,
    drones: w.sim.drones.map((d) => ({ id: d.id, hp: d.hp, x: d.x, y: d.y })),
    targets: w.sim.targets.map((t) => ({ id: t.id, hp: t.hp, x: t.x, y: t.y }))
  };
});

const client = new Client({ name: 'p3b-a-tester', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: 'node', args: [SNAP + '/dist-mcp/companionMcpServer.mjs'],
  cwd: SNAP, env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: BRIDGE_URL, LAST_SIGNAL_WORLD_TOKEN_FILE: TOKEN_FILE },
  stderr: 'pipe'
}));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  let body; try { body = JSON.parse(r.content[0].text); } catch { body = { raw: r.content[0].text }; }
  return { ok: !!r.isError === false, body };
};

try {
  await page.goto(DEV, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.mouse.click(640, 340);
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), null, { timeout: 15000 });
  await page.waitForTimeout(400);

  // Enable echo via UI
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), null, { timeout: 5000 });
  await clickText('ECHO COMPANION >'); await sleep(300);
  await clickText('ENABLE ECHO'); await sleep(400);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.echoActor, null, { timeout: 10000 });
  const e0 = await state();
  check('echo-enabled', !!e0.echo && e0.echo.hp > 0, e0.echo);

  // Authorize companion via MCP client
  const obsRes = await client.callTool({ name: 'echo_observe', arguments: {} });
  const obsBody = JSON.parse(obsRes.content[0].text);
  check('mcp-observe-ok', obsBody.ok === true && !!obsBody.observation, obsBody);
  const epoch = obsBody.observation.epoch;
  const session = obsBody.observation.session;

  const drone0 = obsBody.observation.drones?.[0];
  const target = drone0 ? { x: drone0.x, y: drone0.y } : { x: e0.echo.x + 2, y: e0.echo.y };
  const sugId = `sug_${hex(12)}`;
  const reqId = `req_${hex(12)}`;
  const sug = await c.callTool({ name: 'echo_suggest', arguments: {
    session, epoch, requestId: reqId, suggestionId: sugId,
    kind: 'fire', reason: 'perceived_hostile', target, confidence: 0.8, ttlTicks: 600
  }});
  const sugBody = JSON.parse(sug.content[0].text);
  check('agent-suggest-proposed', sugBody.ok === true && sugBody.suggestion?.status === 'proposed', sugBody);

  // Confirm via UI
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), null, { timeout: 5000 });
  await clickText('CONFIRM FIRST PROPOSAL'); await sleep(300);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__game?.scene.isActive('PauseScene'), null, { timeout: 5000 });
  await sleep(400);

  const s1 = await state();
  const echoFired = e0.echo && s1.echo && s1.echoShots > e0.echoShots;
  const echoMoved = e0.echo && s1.echo && (s1.echo.x !== e0.echo.x || s1.echo.y !== e0.echo.y);
  out.steps.push({ name: 'confirm-then-fire', before: e0, after: s1 });
  check('confirm-triggers-real-tick-action', echoFired || echoMoved, { before: e0, after: s1 });
  await shot('01-confirm-fire');

  await page.close();
  await browser.close();
  await client.close();

  console.log(JSON.stringify({ checks: out.checks.map(c => [c.n, c.ok]) }, null, 2));
  process.exit(0);
} catch (e) {
  console.error('PROBE ERROR:', e);
  process.exit(1);
}

async function clickText(text, scene = 'PauseScene') {
  const pos = await page.evaluate((label) => {
    const s = window.__game.scene.getScene(scene);
    const t = s.children.list.find((c) => c.type === 'Text' && (c.text || '').includes(label));
    return t ? { x: t.x + (t.width || 0) / 2, y: t.y + (t.height || 0) / 2 } : null;
  }, text);
  if (!pos) return false;
  await page.mouse.click(Math.round(pos.x), Math.round(pos.y));
  return true;
}
