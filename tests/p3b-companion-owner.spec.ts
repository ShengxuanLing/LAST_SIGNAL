// P3-b A — REAL human Owner form (masked URL/token/owner key) -> CONNECTED ->
// Agent token-only suggest -> agent cannot confirm -> Owner CONFIRM -> real
// echo core action. This exercises the real in-game form and does NOT rely on
// any global __externalLinkConfig injection.

import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { WorldGateway } from '../src/ai-native/worldGateway';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../src/ai-native/ownerAuthFixture';

const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;
const TOKEN = randomBytes(24).toString('hex');

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

/** Real masked Owner form: fill URL/token/owner-key and submit AUTHORIZE. */
async function fillOwnerForm(page: any, bridgeUrl: string, token: string, ownerKey: string): Promise<void> {
  await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 10000 });
  await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]', bridgeUrl);
  await page.fill('[data-testid="external-link-form"] input[name="token"]', token);
  await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]', ownerKey);
  await page.click('[data-testid="external-link-form"] button[type="submit"]');
}

test('Owner form authorizes a companion; agent cannot confirm; Owner confirm drives a real echo action', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
  try {
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
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      gs.world.enableEcho();
    });
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return !!gs.world.echoActor;
    });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await clickText(page, 'LLM COMPANION >');
    await page.waitForTimeout(400);
    // Human clicks ENABLE: a masked DOM form opens with URL/token/owner-key.
    await clickText(page, 'ENABLE / RE-AUTHORIZE');
    await fillOwnerForm(page, bridge.url, TOKEN, TEST_OWNER_KEY);
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.companionStatus === 'CONNECTED';
    }, undefined, { timeout: 15000 });

    // The masked form must be gone and secrets must not linger in the DOM.
    await expect(page.locator('[data-testid="external-link-form"]')).toHaveCount(0);
    const tokenLeak = await page.evaluate((t: string) => document.body.innerHTML.includes(t), TOKEN);
    expect(tokenLeak, 'token must not remain in the DOM').toBe(false);

    // A REAL drone in the echo's legal perception makes the reason observable.
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const w = gs.world;
      const e = w.echoActor;
      const room = w.currentRoom();
      w.spawnEnemy('drone', e.x + 1, e.y, room?.id ?? 0, 1);
      void gs.companionLink.pushObservation();
    });
    await page.waitForTimeout(300);

    const { session, epoch, target } = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const e = gs.world.echoActor;
      return { session: gs.companionLink.session, epoch: gs.companionLink.epoch, target: { x: e.x + 1, y: e.y } };
    });
    // Agent-side REAL HTTP suggest (token-only, no Origin). No confirm tool exists.
    const suggestionId = 'sug_' + 'a'.repeat(24);
    const suggest = await fetch(`${bridge.url}/world-link/companion-suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        session, epoch, requestId: 'req_' + 'a'.repeat(24), suggestionId,
        kind: 'fire', reason: 'perceived_hostile', target, ttlTicks: 600
      })
    }).then((r) => r.json());
    expect(suggest.ok, `agent suggestion accepted: ${JSON.stringify(suggest)}`).toBe(true);

    // Agent confirmation attempt: no Origin/cap => denied before any decision.
    const forged = await fetch(`${bridge.url}/world-link/companion-decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ session, epoch, suggestionId, decision: 'confirm', tick: 2 })
    }).then((r) => r.json());
    expect(forged.ok).toBe(false);

    // Human Owner clicks CONFIRM in the real Pause UI -> queued core intent.
    await clickText(page, 'CONFIRM FIRST PROPOSAL');
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.hasPendingCompanionIntent === true;
    }, undefined, { timeout: 15000 });
    // Close the pause: the NEXT normal core tick must consume the intent and
    // produce a visible echo projectile (no forced step, no flush).
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
    const tickBefore = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.tick);
    await page.waitForFunction((tb: number) => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.sim.projectiles.some((p: any) => p.source === 'echo')
        || gs.world.sim.tick > tb + 5;
    }, tickBefore, { timeout: 15000 });
    const applied = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return { status: gs.companionStatus, pending: gs.world.hasPendingCompanionIntent, tick: gs.world.sim.tick };
    });
    expect(applied.status).toBe('CONNECTED');
    expect(applied.pending, 'intent consumed by the tick').toBe(false);

    // Disconnect is an explicit NO_MODEL fallback (never a fake connected state).
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
    await clickText(page, 'LLM COMPANION >');
    await page.waitForTimeout(400);
    await clickText(page, 'DISCONNECT (NO MODEL)');
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.companionStatus === 'FALLBACK:NO_MODEL';
    }, undefined, { timeout: 10000 });
    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
  } finally {
    await bridge.close();
  }
});

test('lease loss / closed bridge degrades the companion to NO_MODEL in the HUD', async ({ page }) => {
  test.setTimeout(120000);
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 50 });
  let closed = false;
  try {
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
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      gs.world.enableEcho();
    });
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return !!gs.world.echoActor;
    });
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

    // Resume so GameScene.update() refreshes the HUD each frame.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
    // Hard failure: close the bridge. The bounded heartbeat must detect it and
    // the companion must degrade to NO_MODEL (never a fake CONNECTED).
    closed = true;
    await bridge.close();
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.companionStatus === 'FALLBACK:NO_MODEL';
    }, undefined, { timeout: 12000 });
    const hud = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const t = (gs.children.list as any[]).find((c: any) => c.type === 'Text' && /ECHO .*COMPANION NO MODEL/.test(c.text || ''));
      return t ? t.text : '';
    });
    expect(hud, `HUD shows companion NO MODEL: ${hud}`).toContain('COMPANION NO MODEL');
  } finally {
    if (!closed) await bridge.close();
  }
});
