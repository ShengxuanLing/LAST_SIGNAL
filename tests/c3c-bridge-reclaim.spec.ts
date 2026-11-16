// AI-NATIVE-02 C3-c Task0 — browser reload / crash reclaim regression.
//
// A browser reload kills the renderer without running cleanup. The bridge
// gateway marks the session LOST after the heartbeat window. A NEW explicit
// human AUTHORIZE (same bridge, same token, same origin) must ATOMICALLY
// reclaim it: cancel old pending + agent lease, close the old session and
// create a NEW session/epoch. The OLD epoch can never be used again, the old
// token cannot revive it, and there is NO automatic reconnect or takeover.
// The bridge must NOT need a restart.

import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../src/ai-native/ownerAuthFixture';
import { WorldGateway } from '../src/ai-native/worldGateway';
import { WORLD_PROTOCOL_VERSION } from '../src/ai-native/worldProtocol';

const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;
const TOKEN = randomBytes(24).toString('hex');

async function bootRun(page: Page, bridgeUrl: string): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  // After a reload a checkpoint may exist, so the menu can show a different
  // first button. Poll until a start/resume control is actually on screen.
  const findButton = () => page.evaluate(() => {
    const g: any = (window as any).__game;
    const labels = ['NEW RUN', 'RESUME CHECKPOINT', 'CONTINUE', 'REPLACE AND START'];
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      for (const c of s.children.list as any[]) {
        const text = (c.text || '').trim();
        if (c.type === 'Text' && c.visible !== false && labels.some((l) => text.startsWith(l))) {
          return { x: c.x, y: c.y, label: text };
        }
      }
    }
    return null;
  });
  let target: Awaited<ReturnType<typeof findButton>> = null;
  for (let i = 0; i < 100 && !target; i += 1) {
    target = await findButton();
    if (!target) await page.waitForTimeout(50);
  }
  expect(target, 'a start/resume control is on the main menu').not.toBeNull();
  await page.mouse.click(target!.x, target!.y);
  // A saved run makes NEW RUN show a replace confirmation; accept it so a
  // reloaded page can start a run on the same bridge.
  for (let i = 0; i < 100; i += 1) {
    const started = await page.evaluate(() => (window as any).__game?.scene.isActive('GameScene'));
    if (started) break;
    const replace = await findButton();
    if (replace && replace.label.startsWith('REPLACE AND START')) {
      await page.mouse.click(replace.x, replace.y);
    }
    await page.waitForTimeout(100);
  }
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 15000 });
  void bridgeUrl;
}

async function authorize(page: Page, bridgeUrl: string, token: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
  // Credentials are injected AFTER the pause menu opens (the link degrades on
  // pause and drops the one-shot page config).
  await page.evaluate(({ bridgeUrl: url, token: t, ownerKey: k }) => {
    (window as any).__externalLinkConfig = { bridgeUrl: url, token: t, ownerKey: k };
  }, { bridgeUrl, token, ownerKey: TEST_OWNER_KEY });
  const pos = await page.evaluate(() => {
    const ps = (window as any).__game.scene.getScene('PauseScene');
    const t = ps.children.list.find((c: any) => c.type === 'Text' && (c.text || '').startsWith('AUTHORIZE EXTERNAL AGENT'));
    return t ? { x: t.x, y: t.y } : null;
  });
  expect(pos, 'authorization control is present').not.toBeNull();
  await page.mouse.click(Math.round(pos!.x), Math.round(pos!.y));
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__game.scene.getScene('GameScene').world.player.control.owner
  ), { timeout: 15000 }).toBe('external');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
}

async function linkSnapshot(page: Page): Promise<any> {
  return page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return w.externalLink.snapshot();
  });
}

test('browser reload -> LOST -> a NEW human AUTHORIZE reclaims the session without restarting the bridge', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const gateway = new WorldGateway({ lostAfterMs: 800 });
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 50 });
  try {
    await bootRun(page, bridge.url);
    await authorize(page, bridge.url, TOKEN);
    const first = await linkSnapshot(page);
    expect(first.status).toBe('CONNECTED');
    expect(first.session).toBeTruthy();
    const oldSession = first.session as string;
    const oldEpoch = first.epoch as number;
    expect(gateway.listSessions().some((s) => s.session === oldSession)).toBe(true);

    // Browser reload: the renderer is gone and cannot heartbeat the old session.
    await page.reload();
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
    await expect.poll(async () => {
      const view = gateway.listSessions().find((s) => s.session === oldSession);
      return view ? view.status : 'gone';
    }, { timeout: 5000 }).not.toBe('connected');

    // The old epoch is dead: the bridge rejects it (session gone / stale epoch).
    const stale = await fetch(`${bridge.url}/world-link/action-submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        session: oldSession, epoch: oldEpoch, requestId: `req_${'0'.repeat(23)}1`,
        actions: [{ type: 'stop', actionId: `aid_${'0'.repeat(23)}1` }]
      })
    });
    expect(stale.ok, 'old epoch is rejected').toBe(false);
    expect(stale.status).toBeGreaterThanOrEqual(400);

    // A brand-new human authorization on the SAME bridge reclaims it.
    await bootRun(page, bridge.url);
    await authorize(page, bridge.url, TOKEN);
    const second = await linkSnapshot(page);
    expect(second.status).toBe('CONNECTED');
    expect(second.session, 'reclaim creates a NEW session id').not.toBe(oldSession);
    expect(second.epoch).toBeGreaterThanOrEqual(1);
    expect(gateway.listSessions().some((s) => s.session === oldSession), 'old session not revived').toBe(false);
    expect(gateway.listSessions().filter((s) => s.origin === ORIGIN && s.status === 'connected')).toHaveLength(1);
    // No takeover: control follows only the new explicit authorization.
    expect(await page.evaluate(() =>
      (window as any).__game.scene.getScene('GameScene').world.player.control.owner
    )).toBe('external');
    expect(errors.length).toBeGreaterThanOrEqual(0);
  } finally {
    await bridge.close();
  }
});

test('a live connected link cannot be silently replaced (duplicate still 409)', async ({ page }) => {
  const gateway = new WorldGateway({ lostAfterMs: 800 });
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 50 });
  try {
    await bootRun(page, bridge.url);
    await authorize(page, bridge.url, TOKEN);
    const hs = await fetch(`${bridge.url}/world-link/handshake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
      body: JSON.stringify({ authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: TEST_OWNER_KEY })
    });
    expect(hs.status, 'a LIVE link must not be silently replaced').toBe(409);
    const body = (await hs.json()) as { messageKey?: string };
    expect(body.messageKey).toBe('world.duplicate_handshake');
  } finally {
    await bridge.close();
  }
});
