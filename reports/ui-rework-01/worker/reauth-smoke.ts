// UI-REWORK-01 B1 reauth smoke (worker, run with vite-node; not a tests/ file).
// Real bridge + real masked Owner form:
//  - first authorize creates a live CompanionLink
//  - a real SDK suggestion creates a pending proposal
//  - ENABLE / RE-AUTHORIZE takes the reauth path: same CompanionLink instance
//    (no new link / heartbeat leak), atomic cap swap, old proposal cancelled
//  - a wrong pairing key is rejected; the UI message matches the REAL state
import { chromium } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorldGateway } from '../../../src/ai-native/worldGateway';
import { startWorldBridge } from '../../../src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../../../src/ai-native/ownerAuthFixture';

const PORT = process.env.PORT ?? '5177';
const ORIGIN = `http://localhost:${PORT}`;
const TOKEN = randomBytes(24).toString('hex');
const COMPANION_SERVER = resolve(process.cwd(), 'dist-mcp/companionMcpServer.mjs');
const OUT = resolve('reports/ui-rework-01/worker/logs');
const results: Array<{ step: string; ok: boolean; detail: string }> = [];
const log = (step: string, ok: boolean, detail = ''): void => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail ? ` — ${detail}` : ''}`);
};

async function textBox(page: any, label: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((l: string) => {
    const g = (window as any).__game;
    const s = g.scene.getScene('PauseScene');
    if (!s || !g.scene.isActive('PauseScene')) return null;
    const t = s.children.list.find((c: any) => c.type === 'Text' && c.visible !== false && String(c.text).includes(l));
    if (!t) return null;
    const b = t.getBounds();
    return { x: b.centerX, y: b.centerY };
  }, label);
}
async function clickText(page: any, label: string): Promise<void> {
  const p = await textBox(page, label);
  if (!p) throw new Error(`text not found: ${label}`);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(350);
}
async function fillForm(page: any, ownerKey: string): Promise<void> {
  await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 10000 });
  await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]', bridgeUrl);
  await page.fill('[data-testid="external-link-form"] input[name="token"]', TOKEN);
  await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]', ownerKey);
  await page.click('[data-testid="external-link-form"] button[type="submit"]');
}
async function formStatus(page: any): Promise<string> {
  return page.evaluate(() => document.querySelector('[data-testid="external-link-status"]')?.textContent ?? '');
}
async function linkState(page: any): Promise<{ status: string; sameInstance: boolean; hasLink: boolean }> {
  return page.evaluate(() => {
    const gs = (window as any).__game.scene.getScene('GameScene');
    return { status: gs.companionStatus, sameInstance: gs.companionLink === (window as any).__linkRef, hasLink: !!gs.companionLink };
  });
}
async function pendingCount(page: any): Promise<number> {
  return page.evaluate(async () => {
    const gs = (window as any).__game.scene.getScene('GameScene');
    if (!gs.companionLink) return -1;
    const p = await gs.companionLink.pending();
    return p.length;
  });
}
async function waitPending(page: any, min: number, ms: number): Promise<number> {
  const end = Date.now() + ms;
  let n = -1;
  while (Date.now() < end) {
    n = await pendingCount(page);
    if (n >= min) return n;
    await page.waitForTimeout(200);
  }
  return n;
}
async function boot(page: any): Promise<void> {
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(600);
  const p = await page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.scene.getScene('MainMenuScene');
    const t = s.children.list.find((c: any) => c.type === 'Text' && String(c.text || '').trim().startsWith('NEW RUN'));
    return t ? { x: t.x, y: t.y } : null;
  });
  if (!p) throw new Error('NEW RUN not found on MainMenuScene');
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(800);
}

let bridgeUrl = '';
const gateway = new WorldGateway();
const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
bridgeUrl = bridge.url;
let sdk: { client: Client; transport: StdioClientTransport } | null = null;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await boot(page);
  // Enable the echo and give it a real perceived hostile while RUNNING, so the
  // authorize-time observation contains it and the SDK can suggest.
  await page.evaluate(() => { (window as any).__game.scene.getScene('GameScene').world.enableEcho(); });
  await page.waitForFunction(() => !!(window as any).__game.scene.getScene('GameScene').world.echoActor, undefined, { timeout: 15000 });
  await page.evaluate(() => {
    const gs = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    const e = w.echoActor;
    const room = w.currentRoom();
    w.spawnEnemy('drone', e.x + 1, e.y, room?.id ?? 0, 1);
  });
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(400);

  await clickText(page, 'AI & COMPANION');
  await clickText(page, 'LLM COMPANION');
  await clickText(page, 'ENABLE / RE-AUTHORIZE');
  await fillForm(page, TEST_OWNER_KEY);
  await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').companionStatus === 'CONNECTED', undefined, { timeout: 15000 });
  await page.evaluate(() => { (window as any).__linkRef = (window as any).__game.scene.getScene('GameScene').companionLink; });
  let st = await linkState(page);
  log('first authorize creates a live link', st.status === 'CONNECTED' && st.hasLink, JSON.stringify(st));

  // Real official-SDK suggestion -> a pending proposal the swap must cancel.
  sdk = await (async () => {
    const transport = new StdioClientTransport({
      command: process.execPath, args: [COMPANION_SERVER],
      env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: bridgeUrl, LAST_SIGNAL_WORLD_TOKEN: TOKEN } as never,
      stderr: 'pipe'
    });
    const client = new Client({ name: 'ui-reauth', version: '0.0.0' });
    await client.connect(transport);
    return { client, transport };
  })();
  const observed = (await sdk.client.callTool({ name: 'echo_observe', arguments: {} })).structuredContent as any;
  const suggested = (await sdk.client.callTool({
    name: 'echo_suggest',
    arguments: { requestId: 'req_' + 'c'.repeat(24), suggestionId: 'sug_' + 'c'.repeat(24), kind: 'fire', reason: 'perceived_hostile', ttlTicks: 600 }
  })).structuredContent as any;
  const before = await waitPending(page, 1, 6000);
  log('real SDK observation + suggestion creates a pending proposal', before > 0,
    `observe=${observed?.ok} suggest=${suggested?.ok} pending=${before} err=${suggested?.error?.code ?? ''}`);

  await page.waitForTimeout(1200);
  const binding = await page.evaluate(() => {
    const s = (window as any).__game.scene.getScene('PauseScene');
    return { page: s?.page ?? null, selected: s?.selectedSuggestionId ?? null, confirmEnabled: !!s?.confirmHandle?.enabled };
  });
  const firstId = await page.evaluate(async () => {
    const gs = (window as any).__game.scene.getScene('GameScene');
    const p = await gs.companionLink.pending();
    return p[0]?.suggestionId ?? null;
  });
  log('B3 rendered proposal is bound to the real suggestionId (▶)', !!binding.selected && binding.selected === firstId,
    JSON.stringify({ page: binding.page, selected: binding.selected, firstId, confirmEnabled: binding.confirmEnabled }));

  // Valid re-authorize of the LIVE link.
  await clickText(page, 'ENABLE / RE-AUTHORIZE');
  const reopened = await page.evaluate(() => !!document.querySelector('[data-testid="external-link-form"]'));
  log('reauth form opens on a live link', reopened, '');
  await fillForm(page, TEST_OWNER_KEY);
  await page.waitForFunction(() => !document.querySelector('[data-testid="external-link-form"]'), undefined, { timeout: 10000 }).catch(() => undefined);
  st = await linkState(page);
  const after = await pendingCount(page);
  log('reauth swaps capability on the SAME CompanionLink (no new instance)', st.sameInstance && st.hasLink, JSON.stringify(st));
  log('reauth keeps the link CONNECTED', st.status === 'CONNECTED', st.status);
  log('reauth closes the form on success', !(await page.evaluate(() => !!document.querySelector('[data-testid="external-link-form"]'))), '');
  if (before > 0) log('atomic swap cancels the old pending proposal', after === 0, `before=${before} after=${after}`);

  // Wrong pairing key: rejected; the UI message must match the REAL state.
  const formOpen = await page.evaluate(() => !!document.querySelector('[data-testid="external-link-form"]'));
  if (!formOpen) await clickText(page, 'ENABLE / RE-AUTHORIZE');
  await fillForm(page, 'b'.repeat(64));
  await page.waitForTimeout(1600);
  const wrongStatus = await formStatus(page);
  st = await linkState(page);
  const messageHonest = st.status === 'CONNECTED'
    ? /active connection unchanged/i.test(wrongStatus)
    : new RegExp(`link ${st.status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(wrongStatus);
  log('wrong pairing key is rejected', /RE-AUTH FAILED/i.test(wrongStatus), wrongStatus.slice(0, 90));
  log('UI message matches the real post-failure link state', messageHonest && st.sameInstance,
    `status=${st.status} sameInstance=${st.sameInstance}`);
  log('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  const pname = await page.evaluate(() => (window as any).__game?.scene.getScene('PauseScene')?.page ?? null).catch(() => null);
  log('reauth smoke aborted', false, `${String(e).split('\n')[0]} | page=${pname} errors=${errors.slice(0, 2).join(' | ')}`);
} finally {
  await sdk?.client.close().catch(() => undefined);
  await bridge.close();
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(resolve(OUT, 'reauth-smoke.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}
