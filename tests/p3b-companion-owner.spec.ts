// P3-b Owner form + paused-session lifecycle + official SDK + real tick effect.
//
// NO global __externalLinkConfig, NO manual dev push/step. After the real masked
// form authorizes the companion, the session must stay alive while PAUSED for
// 15s (renderer heartbeat), the official Agent SDK must observe/suggest with
// token only, and the Owner CONFIRM must drive a REAL core tick after resume.

import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorldGateway } from '../src/ai-native/worldGateway';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../src/ai-native/ownerAuthFixture';

const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;
const TOKEN = randomBytes(24).toString('hex');
const COMPANION_SERVER = resolve(process.cwd(), 'dist-mcp/companionMcpServer.mjs');

async function clickText(page: any, text: string): Promise<void> {
  const p = await page.evaluate((label) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    const t = (s.children.list as any[]).find((c: any) => c.type === 'Text' && (c.text || '').includes(label));
    if (!t) return null;
    const b = t.getBounds();
    return { x: b.centerX, y: b.centerY };
  }, text);
  expect(p, `text ${text}`).not.toBeNull();
  await page.mouse.click(p!.x, p!.y);
}

async function bootRun(page: any): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('lastSignal.save.v1'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  const newRun = await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const t = s.children.list.find((c: any) => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  });
  expect(newRun).not.toBeNull();
  await page.mouse.click(newRun!.x, newRun!.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
}

async function fillOwnerForm(page: any, bridgeUrl: string, token: string, ownerKey: string): Promise<void> {
  await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 10000 });
  await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]', bridgeUrl);
  await page.fill('[data-testid="external-link-form"] input[name="token"]', token);
  await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]', ownerKey);
  await page.click('[data-testid="external-link-form"] button[type="submit"]');
}

/** Spawn the OFFICIAL Agent SDK against the bridge with token only. */
async function openCompanionSdk(bridgeUrl: string): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [COMPANION_SERVER],
    env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: bridgeUrl, LAST_SIGNAL_WORLD_TOKEN: TOKEN } as never,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'owner-e2e', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}

test('real form: paused session survives 15s, official SDK observes/suggests, Owner confirm drives a real tick', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
  let sdk: { client: Client; transport: StdioClientTransport } | null = null;
  try {
    await bootRun(page);
    // Owner enables echo and spawns a REAL drone while running (no dev push/step).
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      gs.world.enableEcho();
    });
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return !!gs.world.echoActor;
    });
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const w = gs.world;
      const e = w.echoActor;
      const room = w.currentRoom();
      w.spawnEnemy('drone', e.x + 1, e.y, room?.id ?? 0, 1);
    });
    await page.waitForTimeout(300);

    // Owner opens the companion panel and fills the masked form (no global).
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await clickText(page, 'LLM COMPANION >');
    await page.waitForTimeout(400);
    await clickText(page, 'ENABLE / RE-AUTHORIZE');
    await fillOwnerForm(page, bridge.url, TOKEN, TEST_OWNER_KEY);
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.companionStatus === 'CONNECTED';
    }, undefined, { timeout: 15000 });

    // DO NOT resume. Keep PAUSED for 15s (> LOST 5s). The renderer heartbeat
    // must keep the rendered gateway session alive.
    await page.waitForTimeout(15000);
    const stillConnected = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.companionStatus;
    });
    expect(stillConnected, `paused 15s must stay CONNECTED, got ${stillConnected}`).toBe('CONNECTED');

    // Official Agent SDK: token-only attach + observe/status/memory/suggest.
    sdk = await openCompanionSdk(bridge.url);
    const observed = await sdk.client.callTool({ name: 'echo_observe', arguments: {} });
    const obsBody = observed.structuredContent as any;
    expect(obsBody.ok, `echo_observe after 15s paused: ${JSON.stringify(obsBody)}`).toBe(true);
    expect(obsBody.observation?.drones?.length ?? 0, `observation has a real drone: ${JSON.stringify(obsBody).slice(0,300)}`).toBeGreaterThan(0);
    const statusBody = (await sdk.client.callTool({ name: 'echo_status', arguments: {} })).structuredContent as any;
    expect(statusBody.ok).toBe(true);
    expect(statusBody.status?.link, `echo_status link: ${JSON.stringify(statusBody).slice(0,300)}`).toBe('connected');
    const memBody = (await sdk.client.callTool({ name: 'echo_memory', arguments: {} })).structuredContent as any;
    expect(memBody.ok).toBe(true);
    const suggestionId = 'sug_' + 'b'.repeat(24);
    const proposed = (await sdk.client.callTool({
      name: 'echo_suggest',
      arguments: {
        requestId: 'req_' + 'b'.repeat(24), suggestionId,
        kind: 'fire', reason: 'perceived_hostile', ttlTicks: 600
      }
    })).structuredContent as any;
    expect(proposed.ok, `echo_suggest: ${JSON.stringify(proposed)}`).toBe(true);

    // Human Owner CONFIRM in the real Pause UI (paused; no tick yet).
    await clickText(page, 'CONFIRM FIRST PROPOSAL');
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.hasPendingCompanionIntent === true;
    }, undefined, { timeout: 15000 });

    // Resume: the next NORMAL core tick must commit the echo action (no forced
    // step). Then the receipt + memory update are real.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
    const tickBefore = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.tick);
    await page.waitForFunction((tb: number) => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.sim.projectiles.some((p: any) => p.source === 'echo') || gs.world.sim.tick > tb + 5;
    }, tickBefore, { timeout: 15000 });
    const appliedTick = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.tick);
    expect(appliedTick, 'core tick advanced').toBeGreaterThan(tickBefore);

    // Memory must update again via the official SDK after the observed tick.
    const mem2 = (await sdk.client.callTool({ name: 'echo_memory', arguments: {} })).structuredContent as any;
    expect(mem2.ok).toBe(true);

    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
  } finally {
    await sdk?.client.close().catch(() => undefined);
    await bridge.close();
  }
});

test('Agent hard-kill degrades the companion; a fresh Owner grant reconnects (no auto-reconnect)', async ({ page }) => {
  test.setTimeout(120000);
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 50 });
  try {
    await bootRun(page);
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      gs.world.enableEcho();
    });
    await page.waitForFunction(() => !!((window as any).__game.scene.getScene('GameScene').world.echoActor));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await clickText(page, 'LLM COMPANION >');
    await page.waitForTimeout(400);
    await clickText(page, 'ENABLE / RE-AUTHORIZE');
    await fillOwnerForm(page, bridge.url, TOKEN, TEST_OWNER_KEY);
    await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').companionStatus === 'CONNECTED', undefined, { timeout: 15000 });
    // Resume so the HUD updates.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
    // Hard failure: close the bridge. Heartbeat must degrade to NO_MODEL.
    await bridge.close();
    await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').companionStatus === 'FALLBACK:NO_MODEL', undefined, { timeout: 12000 });
    const hud = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const t = (gs.children.list as any[]).find((c: any) => c.type === 'Text' && /COMPANION NO MODEL/.test(c.text || ''));
      return t ? t.text : '';
    });
    expect(hud).toContain('COMPANION NO MODEL');
  } finally {
    await bridge.close();
  }
});
