// P3-b A — real Owner UI confirmation -> core echo action; agent cannot confirm.

import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { WorldGateway } from '../src/ai-native/worldGateway';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';

const ORIGIN = 'http://localhost:5176';
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

test('Owner UI confirms a companion suggestion into a real echo core action', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
  await page.addInitScript(({ bridgeUrl, token }) => {
    (window as any).__externalLinkConfig = { bridgeUrl, token };
  }, { bridgeUrl: bridge.url, token: TOKEN });
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
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.companionStatus === 'CONNECTED';
    }, undefined, { timeout: 15000 });

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

    const { session, target } = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const e = gs.world.echoActor;
      return { session: gs.companionLink.session, target: { x: e.x + 1, y: e.y } };
    });
    // Agent-side REAL HTTP suggest (token-only, no Origin). No confirm tool exists.
    const suggestionId = 'sug_' + 'a'.repeat(24);
    const suggest = await fetch(`${bridge.url}/world-link/companion-suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        session, epoch: 1, requestId: 'req_' + 'a'.repeat(24), suggestionId,
        kind: 'fire', reason: 'perceived_hostile', target, ttlTicks: 600
      })
    }).then((r) => r.json());
    expect(suggest.ok, `agent suggestion accepted: ${JSON.stringify(suggest)}`).toBe(true);

    // Agent confirmation attempt: no Origin => bridge denies before any decision.
    const forged = await fetch(`${bridge.url}/world-link/companion-decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ session, epoch: 1, suggestionId, decision: 'confirm', tick: 2, ownerSecret: 'x' })
    }).then((r) => r.json());
    expect(forged.ok).toBe(false);

    // Human Owner clicks CONFIRM in the real Pause UI -> core echo intent.
    await clickText(page, 'CONFIRM FIRST PROPOSAL');
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.sim.projectiles.some((p: any) => p.source === 'echo')
        || gs.world.hasPendingCompanionIntent;
    }, undefined, { timeout: 15000 });
    const applied = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return { status: gs.companionStatus, pending: gs.world.hasPendingCompanionIntent };
    });
    expect(applied.status).toBe('CONNECTED');

    // Disconnect is an explicit NO_MODEL fallback (never a fake connected state).
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
