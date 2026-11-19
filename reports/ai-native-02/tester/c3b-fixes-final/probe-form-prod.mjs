// C3-b fix (8b9705d) — REAL IN-GAME FORM on the PRODUCTION build (no __game):
// NEW RUN -> ESC -> SETTINGS -> EXTERNAL LINK SETUP -> type bridge URL + masked token
// -> AUTHORIZE -> official MCP SDK client attaches/observes/acts.
// Token is typed into a password input, never logged, cleared from the DOM on submit.
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:5302';
const BRIDGE = 'http://127.0.0.1:8893';
const TOKEN_FILE = process.env.TOKEN_FILE;
const MCP = 'D:/Project/AI-NATIVE-02-snapshots/8b9705d/dist-mcp/worldMcpServer.mjs';
const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/8b9705d';
const TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();
const ev = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-fixes-final/evidence-form-prod';
mkdirSync(ev, { recursive: true });
const out = { meta: { base: BASE, bridge: BRIDGE, target: '8b9705d6bce1894b08717c0180e127f26de8e2f5', build: 'production (no __game)' }, checks: [], steps: [], toolLog: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-fixes-final/form-prod.json', JSON.stringify(out, null, 2)); } catch {} });
const hex = (n) => randomBytes(n).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mk = async () => {
  const client = new Client({ name: 'c3b-fix-form-tester', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: 'node', args: [MCP], cwd: SNAP, env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: BRIDGE, LAST_SIGNAL_WORLD_TOKEN_FILE: TOKEN_FILE }, stderr: 'pipe' });
  await client.connect(transport);
  return { client, transport };
};
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const body = JSON.parse(r.content[0].text);
  out.toolLog.push({ tool: name, ok: body.ok ?? null, code: body.code ?? null, statuses: Array.isArray(body.actions) ? body.actions.map((a) => a.status) : undefined, tick: body.observation?.tick ?? body.acceptedTick ?? null });
  return { isError: !!r.isError, body };
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: ev + '/video', size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2300);
check('prod-no-game-handle', (await page.evaluate(() => typeof window.__game === 'undefined')) === true);
await page.mouse.click(640, 340); // NEW RUN
await page.waitForTimeout(1600);
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
await page.mouse.click(640, 420); // SETTINGS
await page.waitForTimeout(500);
await page.screenshot({ path: `${ev}/01-settings.png` });
await page.mouse.click(640, 510); // EXTERNAL LINK SETUP
await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 5000 });
await page.waitForTimeout(250);
check('in-game-form-opens', true, {});
check('form-token-input-masked', (await page.getAttribute('input[name="token"]', 'type')) === 'password');
await page.screenshot({ path: `${ev}/02-form-empty.png` }); // no credential typed yet
await page.fill('input[name="bridgeUrl"]', BRIDGE);
await page.fill('input[name="token"]', TOKEN);
await page.screenshot({ path: `${ev}/03-form-token-masked.png` }); // password dots only
out.steps.push({ name: 'typed', tokenInputType: await page.getAttribute('input[name="token"]', 'type'), tokenInDomBeforeSubmit: await page.evaluate((t) => document.documentElement.outerHTML.includes(t), TOKEN) });
await page.click('form button[type="submit"]');
const settle = await page.waitForFunction(() => {
  const f = document.querySelector('[data-testid="external-link-form"]');
  if (!f) return 'closed';
  return (document.querySelector('[data-testid="external-link-status"]')?.textContent ?? '').includes('FAILED') ? 'failed' : null;
}, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => 'timeout');
await page.screenshot({ path: `${ev}/04-connected.png` });
check('form-authorize-closes-on-success', settle === 'closed', { settle });
check('token-cleared-from-dom', (await page.evaluate((t) => !document.documentElement.outerHTML.includes(t) && document.querySelector('input[name="token"]') === null, TOKEN)) === true);
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
await page.screenshot({ path: `${ev}/05-hud-connected.png` });

const { client } = await mk();
const list = await call(client, 'world_list_sessions');
check('mcp-attaches-after-form-authorize', list.isError === false && list.body.attached === true, list.body);
let obs = await call(client, 'world_observe');
for (let i = 0; i < 25 && !(obs.body.observation?.tick > 0); i += 1) { await sleep(250); obs = await call(client, 'world_observe'); }
check('mcp-observes-real-tick', obs.body.ok === true && obs.body.observation.tick > 0, { tick: obs.body.observation?.tick });
const start = obs.body.observation;
const req = `req_${hex(12)}`;
const sub = await call(client, 'world_action', { requestId: req, actions: [{ type: 'move', actionId: `aid_${hex(12)}`, dir: { x: 1, y: 0 }, ticks: 8 }] });
check('mcp-action-accepted', sub.body.ok === true && sub.body.actions?.[0]?.status === 'queued', sub.body);
let moved = null;
for (let i = 0; i < 40; i += 1) {
  await sleep(150);
  const o = await call(client, 'world_observe');
  if (o.body.ok && o.body.observation.player.x > start.player.x + 0.2) { moved = o.body.observation; break; }
}
check('mcp-action-really-moves', !!moved, moved ? { from: start.player.x, to: moved.player.x, tick: moved.tick } : { from: start.player.x });
await page.screenshot({ path: `${ev}/06-after-move.png` });
out.pageErrors = errs;
check('no-page-errors', errs.length === 0, errs);
out.video = page.video() ? await page.video().path() : null;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-fixes-final/form-prod.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), steps: out.steps }, null, 2));
await client.close().catch(() => {});
await ctx.close();
await browser.close();
