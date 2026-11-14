// AI-NATIVE-02 C3-b — real browser <-> bridge <-> agent integration.
//
// Starts the loopback bridge, opens the rendered game in a browser, lets the
// HUMAN authorize the link through the real Pause menu, then drives the agent
// side through the official client: observe -> action -> real core commit.
//
// It verifies the INTERFACE and the real commit path. It is not an LLM
// playthrough and never claims to be one.

import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { WorldGateway } from '../src/ai-native/worldGateway';
import { WorldClient } from '../src/ai-native/worldClient';

const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;
const TOKEN = randomBytes(24).toString('hex');

test('human authorization links the rendered world to the bridge; actions commit on a real tick', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({
    gateway,
    token: TOKEN,
    allowedOrigins: [ORIGIN]
  });
  try {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
    // The host page provides the bridge configuration (never hard-coded in the game).
    await page.evaluate(({ bridgeUrl, token }) => {
      (window as any).__externalLinkConfig = { bridgeUrl, token };
    }, { bridgeUrl: bridge.url, token: TOKEN });

    const newRun = await page.evaluate(() => {
      const g: any = (window as any).__game;
      for (const s of Object.values(g.scene.scenes) as any[]) {
        if (!g.scene.isActive(s.sys.settings.key)) continue;
        const t = s.children.list.find((c: any) => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
        if (t) return { x: t.x, y: t.y };
      }
      return null;
    });
    expect(newRun, 'NEW RUN button').not.toBeNull();
    await page.mouse.click(newRun!.x, newRun!.y);
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));

    // HUMAN authorization through the real Pause menu.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
    // The pause menu is rendered in the Phaser canvas: locate the label object.
    const authorizePos = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const ps = g.scene.getScene('PauseScene');
      const t = ps.children.list.find((c: any) => c.type === 'Text' && (c.text || '').startsWith('AUTHORIZE EXTERNAL AGENT'));
      return t ? { x: t.x, y: t.y } : null;
    });
    expect(authorizePos, 'authorization control is present').not.toBeNull();
    await page.mouse.click(Math.round(authorizePos!.x), Math.round(authorizePos!.y));
    await expect.poll(async () => page.evaluate(() => {
      const gs = (window as any).__game.scene.getScene('GameScene');
      return gs.world.player.control.owner;
    }), { timeout: 15000 }).toBe('external');

    // RESUME is also a human action: it grants the freshly authorized link
    // control of the running game (no automatic re-take ever happens).
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));

    // The rendered world owns the session; the agent attaches to it.
    const client = new WorldClient({ bridgeUrl: bridge.url, token: TOKEN });
    const handshake = await client.handshake();
    expect(handshake.ok, 'agent handshake').toBe(true);

    // The rendered game pushes a post-commit observation; the agent reads it.
    let observation = null as Awaited<ReturnType<typeof client.observe>> | null;
    for (let i = 0; i < 60; i += 1) {
      observation = await client.observe();
      if (observation.ok && observation.observation.tick > 0) break;
      await page.waitForTimeout(100);
    }
    expect(observation?.ok, 'agent observation').toBe(true);
    const obs = (observation as { observation: { tick: number; player: { x: number; y: number } } }).observation;
    expect(obs.tick, 'observation carries a real post-commit tick').toBeGreaterThan(0);

    // The agent submits an intent; the browser executes it on a real core tick
    // and ACKs with the post-commit tick.
    const tickBefore = obs.tick;
    const submit = await client.submit('req_c3b000000000000000000001', [{
      type: 'move', actionId: 'aid_c3b000000000000000000001', dir: { x: 1, y: 0 }, ticks: 10
    }]);
    expect(submit.ok, 'agent action accepted').toBe(true);
    expect(submit.actions?.[0]?.status, 'queued, not applied').toBe('queued');

    // Wait for the REAL post-commit ACK, not merely for a tick to pass.
    await expect.poll(async () => page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return w.externalLink.receipt('aid_c3b000000000000000000001')?.status ?? 'none';
    }), { timeout: 15000 }).toBe('applied');

    // The movement intent was executed by the core (player moved) and the HUD
    // reports the external owner.
    const after = await page.evaluate(() => {
      const gs = (window as any).__game.scene.getScene('GameScene');
      const w = gs.world;
      const r = w.externalLink.receipt('aid_c3b000000000000000000001');
      return {
        owner: w.player.control.owner,
        pending: w.hasUncommittedCommands(),
        linkLabel: gs.txtAgentLink?.text ?? '',
        receipt: r ? { status: r.status, appliedTick: r.appliedTick } : null,
        lastAppliedTick: w.externalLink.snapshot().lastAppliedTick
      };
    });
    expect(after.owner, 'external agent owns control').toBe('external');
    expect(after.pending, 'no pending commands left').toBe(false);
    expect(after.linkLabel, 'HUD shows the real link state').toContain('EXTERNAL AGENT CONNECTED');
    // The ACK is produced from the REAL post-commit tick, not from the queue.
    expect(after.receipt?.status, 'intent applied by the core').toBe('applied');
    expect(after.receipt?.appliedTick, 'real applied tick recorded').toBeGreaterThan(tickBefore);
    expect(after.lastAppliedTick, 'HUD last action from the real commit').toBe(after.receipt?.appliedTick);

    // A human takeover cancels the link and returns control.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
    await page.keyboard.press('d');
    await page.waitForTimeout(200);
    const takenOver = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return { owner: w.player.control.owner, external: w.externalLink.snapshot().status };
    });
    expect(takenOver.owner, 'human input takes control back').toBe('human');
    expect(takenOver.external, 'external link yielded').not.toBe('CONNECTED');

    expect(errors).toEqual([]);
  } finally {
    await bridge.close();
  }
});

test('takeover / overlay / agent disconnect yield the link; no automatic re-take', async ({ page }) => {
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, allowedOrigins: [ORIGIN] });
  try {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
    await page.evaluate(({ bridgeUrl, token }) => {
      (window as any).__externalLinkConfig = { bridgeUrl, token };
    }, { bridgeUrl: bridge.url, token: TOKEN });
    const newRun = await page.evaluate(() => {
      const g: any = (window as any).__game;
      for (const s of Object.values(g.scene.scenes) as any[]) {
        if (!g.scene.isActive(s.sys.settings.key)) continue;
        const t = s.children.list.find((c: any) => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
        if (t) return { x: t.x, y: t.y };
      }
      return null;
    });
    await page.mouse.click(newRun!.x, newRun!.y);
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));

    const authorize = async (): Promise<void> => {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
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
    };

    await authorize();
    const sessionAfterFirstAuthorize = await page.evaluate(() =>
      (window as any).__game.scene.getScene('GameScene').world.externalLink.snapshot().session
    );

    // Human takeover yields and does NOT auto re-take after the overlay closes.
    await page.keyboard.press('d');
    await expect.poll(async () => page.evaluate(() =>
      (window as any).__game.scene.getScene('GameScene').world.externalLink.snapshot().status
    )).toBe('YIELDED');
    expect(await page.evaluate(() =>
      (window as any).__game.scene.getScene('GameScene').world.player.control.owner
    )).toBe('human');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
    expect(await page.evaluate(() =>
      (window as any).__game.scene.getScene('GameScene').world.player.control.owner
    ), 'no automatic re-take').toBe('human');

    // A fresh HUMAN authorize is required, and it creates a NEW session
    // (the old, yielded session cannot be reused).
    await authorize();
    const sessionAfterSecondAuthorize = await page.evaluate(() =>
      (window as any).__game.scene.getScene('GameScene').world.externalLink.snapshot().session
    );
    expect(sessionAfterSecondAuthorize).not.toBe(sessionAfterFirstAuthorize);

    // An agent-side disconnect closes the bridge session; the rendered game
    // degrades to HUMAN control when its heartbeat fails.
    const client = new WorldClient({ bridgeUrl: bridge.url, token: TOKEN });
    expect((await client.handshake()).ok).toBe(true);
    expect(await client.close()).toBe(true);
    await expect.poll(async () => page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return { status: w.externalLink.snapshot().status, owner: w.player.control.owner };
    }), { timeout: 15000 }).toMatchObject({ owner: 'human' });
    const afterDisconnect = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return { status: w.externalLink.snapshot().status, owner: w.player.control.owner };
    });
    expect(afterDisconnect.status).not.toBe('CONNECTED');
  } finally {
    await bridge.close();
  }
});
