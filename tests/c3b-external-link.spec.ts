// AI-NATIVE-02 C3-b — real browser <-> bridge <-> agent integration.
//
// Starts the loopback bridge, opens the rendered game in a browser, lets the
// HUMAN authorize the link through the real Pause menu, then drives the agent
// side through the official client: observe -> action -> real core commit.
//
// It verifies the INTERFACE and the real commit path. It is not an LLM
// playthrough and never claims to be one.

import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { startWorldBridge, type RunningWorldBridge } from '../src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY_HASH } from '../src/ai-native/ownerAuthFixture';
import { WorldGateway } from '../src/ai-native/worldGateway';
import { WorldClient } from '../src/ai-native/worldClient';

const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;
const TOKEN = randomBytes(24).toString('hex');


/** Shared setup: real game -> HUMAN AUTHORIZE -> resume -> agent attach. */
async function setupLinkedRun(page: Page, bridge: RunningWorldBridge): Promise<WorldClient> {
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
  expect(newRun, 'NEW RUN button').not.toBeNull();
  await page.mouse.click(newRun!.x, newRun!.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
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
  const client = new WorldClient({ bridgeUrl: bridge.url, token: TOKEN });
  expect((await client.handshake()).ok).toBe(true);
  await expect.poll(async () => (await client.observe()).ok, { timeout: 15000 }).toBe(true);
  return client;
}

async function worldState(page: Page): Promise<any> {
  return page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return {
      tick: w.sim.tick,
      x: w.sim.player.x,
      y: w.sim.player.y,
      hp: w.sim.player.data.hp,
      owner: w.player.control.owner,
      link: w.externalLink.snapshot(),
      projectiles: w.sim.projectiles.length,
      pending: w.hasUncommittedCommands()
    };
  });
}

async function receipt(page: Page, actionId: string): Promise<any> {
  return page.evaluate((id) =>
    (window as any).__game.scene.getScene('GameScene').world.externalLink.receipt(id), actionId);
}

async function waitApplied(page: Page, actionId: string): Promise<void> {
  await expect.poll(async () => (await receipt(page, actionId))?.status ?? 'none', { timeout: 20000 }).toBe('applied');
}

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
    // The one-shot page config is cleared; only the live link held credentials.
    expect(await page.evaluate(() => typeof (window as any).__externalLinkConfig)).toBe('undefined');

    expect(errors).toEqual([]);
  } finally {
    await bridge.close();
  }
});

test('takeover / overlay / agent disconnect yield the link; no automatic re-take', async ({ page }) => {
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN] });
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
      // The page-level config is cleared whenever the link degrades (including
      // on pause). Re-inject AFTER the pause menu is open, exactly like the
      // in-game form entering credentials while paused.
      await page.evaluate(({ bridgeUrl, token }) => {
        (window as any).__externalLinkConfig = { bridgeUrl, token };
      }, { bridgeUrl: bridge.url, token: TOKEN });
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

test('ticks=1 vs ticks=120 differ in REAL core ticks and real displacement', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN] });
  try {
    const client = await setupLinkedRun(page, bridge);

    // A legal screen-space direction. Use a fresh OWNER (dev/test) placement
    // before each run so both see the same real collision environment.
    const place = async (): Promise<void> => {
      await page.evaluate(() => {
        const w: any = (window as any).__game.scene.getScene('GameScene').world;
        for (const row of w.map.tiles) {
          let done = false;
          for (const tile of row) {
            if (tile.type !== 'floor' && tile.type !== 'spawn') continue;
            if (!w.isWalkable(tile.x, tile.y, 0.5)) continue;
            let clear = true;
            for (let d = 0; d <= 12; d += 1) {
              if (!w.isWalkable(tile.x + d * 0.25, tile.y + d * 0.25, 0.5)) { clear = false; break; }
            }
            if (!clear) continue;
            w.setPlayerPositionForTest(tile.x + 0.5, tile.y + 0.5);
            done = true;
            break;
          }
          if (done) break;
        }
      });
    };

    await place();
    const before1 = await worldState(page);
    const s1 = await client.submit('req_c3b000000000000000000010', [
      { type: 'move', actionId: 'aid_c3b000000000000000000010', dir: { x: 1, y: 0 }, ticks: 1 }
    ], 600);
    expect(s1.ok, 'ticks=1 accepted').toBe(true);
    await waitApplied(page, 'aid_c3b000000000000000000010');
    const r1 = await receipt(page, 'aid_c3b000000000000000000010');
    const after1 = await worldState(page);

    await place();
    const before120 = await worldState(page);
    const s120 = await client.submit('req_c3b000000000000000000011', [
      { type: 'move', actionId: 'aid_c3b000000000000000000011', dir: { x: 1, y: 0 }, ticks: 120 }
    ], 600);
    expect(s120.ok, 'ticks=120 accepted').toBe(true);
    await waitApplied(page, 'aid_c3b000000000000000000011');
    const r120 = await receipt(page, 'aid_c3b000000000000000000011');
    const after120 = await worldState(page);

    // Receipts carry real started/completed/executed core ticks.
    expect(r1.executedTicks, 'ticks=1 executed exactly one core tick').toBe(1);
    expect(r120.executedTicks, 'ticks=120 executed exactly 120 core ticks').toBe(120);
    expect(r1.completedTick - r1.startedTick).toBe(1);
    expect(r120.completedTick - r120.startedTick).toBe(120);
    expect(r120.completedTick).toBeGreaterThan(r1.completedTick);

    const d1 = Math.hypot(after1.x - before1.x, after1.y - before1.y);
    const d120 = Math.hypot(after120.x - before120.x, after120.y - before120.y);
    expect(d1, 'short move moved').toBeGreaterThan(0);
    expect(d120, 'long move moved much farther in the real core').toBeGreaterThan(d1 * 2);
    console.log('C3B_EFFECT ticks', JSON.stringify({
      d1, d120, executed1: r1.executedTicks, executed120: r120.executedTicks,
      started1: r1.startedTick, completed1: r1.completedTick,
      started120: r120.startedTick, completed120: r120.completedTick
    }));
    expect(errors).toEqual([]);
  } finally {
    await bridge.close();
  }
});

test('fire honours real cooldown / ammo / real projectiles; interact is one legal commit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN] });
  try {
    const client = await setupLinkedRun(page, bridge);
    // Give the player a finite magazine so ammo is a real observable resource.
    await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      const data = JSON.parse(JSON.stringify(w.player.data));
      data.weaponKey = 'scatter';
      data.weapons = [{ key: 'scatter', level: 1, ammo: 6, magazine: 6, reloading: false, reloadTimer: 0 }];
      w.enqueueSetPlayerData(data);
    });
    const before = await worldState(page);
    const aim = { x: before.x + 4, y: before.y };
    const submitted = await client.submit('req_c3b000000000000000000020', [
      { type: 'fire', actionId: 'aid_c3b000000000000000000020', target: aim, ticks: 60 }
    ], 600);
    expect(submitted.ok, 'fire accepted').toBe(true);
    // Sample the REAL core while the action is executing: projectiles are
    // short-lived, so a single read after completion can legitimately be 0.
    let maxProjectiles = 0;
    let sawExecuting = false;
    for (let i = 0; i < 200; i += 1) {
      const sample = await page.evaluate(() => {
        const w: any = (window as any).__game.scene.getScene('GameScene').world;
        return w.sim.projectiles.length;
      });
      maxProjectiles = Math.max(maxProjectiles, sample);
      const r = await receipt(page, 'aid_c3b000000000000000000020');
      if (r?.status === 'executing') sawExecuting = true;
      if (r?.status === 'applied') break;
      await page.waitForTimeout(20);
    }
    const fireReceipt = await receipt(page, 'aid_c3b000000000000000000020');
    expect(fireReceipt.executedTicks, 'fire held for 60 real core ticks').toBe(60);
    expect(sawExecuting, 'action visibly passed through executing').toBe(true);
    const afterFire = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      return {
        ammo: w.player.data.weapons.find((x: any) => x.key === w.player.data.weaponKey)?.ammo,
        weaponKey: w.player.data.weaponKey
      };
    });
    // The core's own cooldown decides shots: never one projectile per tick.
    expect(maxProjectiles, 'real projectiles were spawned').toBeGreaterThan(0);
    expect(maxProjectiles, 'cooldown limits shots, not one per tick').toBeLessThan(60);
    // REAL finite ammo is consumed by legal shots, never bypassed.
    expect(afterFire.weaponKey).toBe('scatter');
    expect(afterFire.ammo, 'ammo consumed by real shots').toBeLessThan(6);
    expect(afterFire.ammo).toBeGreaterThanOrEqual(0);
    expect(afterFire.ammo).toBeLessThanOrEqual(6);

    // interact is a SINGLE legal commit by definition, never a repeated one.
    const sInteract = await client.submit('req_c3b000000000000000000021', [
      { type: 'interact', actionId: 'aid_c3b000000000000000000021' }
    ], 600);
    expect(sInteract.ok, 'interact accepted').toBe(true);
    await waitApplied(page, 'aid_c3b000000000000000000021');
    const interactReceipt = await receipt(page, 'aid_c3b000000000000000000021');
    expect(interactReceipt.executedTicks, 'interact committed once').toBe(1);
    expect((await worldState(page)).pending, 'no uncommitted commands left').toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await bridge.close();
  }
});

test('blocked legal move still gets a receipt but cannot fake displacement', async ({ page }) => {
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN] });
  try {
    const client = await setupLinkedRun(page, bridge);
    // Place the player on a real walkable cell that is adjacent to a real wall.
    const placed = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      for (const row of w.map.tiles) {
        for (const tile of row) {
          if (tile.type !== 'floor' && tile.type !== 'spawn') continue;
          const px = tile.x + 0.5, py = tile.y + 0.5;
          if (!w.isWalkable(px, py, 0.5)) continue;
          // A real wall within one tile: the core will clamp movement there.
          const wallNear = !w.isWalkable(tile.x - 1, tile.y, 0.5)
            || !w.isWalkable(tile.x, tile.y - 1, 0.5)
            || !w.isWalkable(tile.x + 1, tile.y, 0.5);
          if (!wallNear) continue;
          w.setPlayerPositionForTest(px, py);
          return { x: px, y: py };
        }
      }
      return null;
    });
    expect(placed, 'a walkable cell adjacent to a real wall exists').not.toBeNull();
    const before = await worldState(page);
    const submitted = await client.submit('req_c3b000000000000000000030', [
      { type: 'move', actionId: 'aid_c3b000000000000000000030', dir: { x: -1, y: -1 }, ticks: 40 }
    ], 600);
    expect(submitted.ok).toBe(true);
    await waitApplied(page, 'aid_c3b000000000000000000030');
    const r = await receipt(page, 'aid_c3b000000000000000000030');
    const after = await worldState(page);
    // ACK = legal intent committed, NOT a guaranteed displacement.
    expect(r.status).toBe('applied');
    expect(r.executedTicks).toBe(40);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(20);
  } finally {
    await bridge.close();
  }
});

test('Rendered probe: hidden / far / other-room enemy projectiles are NOT in the observation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN] });
  try {
    const client = await setupLinkedRun(page, bridge);
    // Inject REAL core projectiles through the dev/test OWNER fixture (never an
    // Agent capability). Positions are verified non-wall by the core itself.
    const injected = await page.evaluate(async () => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      const mod: any = await import('/src/world/sim/core.ts');
      const sim = w.simFixture;
      const p = { x: w.player.wx, y: w.player.wy };
      // ~2 tiles away: still legally perceivable, but far enough that a
      // stationary enemy projectile does not instantly hit the player.
      let near: { x: number; y: number } | null = null;
      for (const d of [[2, 0], [0, 2], [-2, 0], [0, -2], [1.5, 1.5], [-1.5, -1.5]]) {
        const x = p.x + d[0], y = p.y + d[1];
        if (mod.tileAtFromState(sim, x, y).type === 'wall') continue;
        if (!mod.isWalkableFromState(sim, x, y, 0.2)) continue;
        if (!w.isPerceivablePosition(x, y)) continue;
        near = { x, y };
        break;
      }
      if (!near) return null;
      let far: { x: number; y: number } | null = null;
      for (const r of w.map.rooms) {
        if (Math.hypot(r.gx - p.x, r.gy - p.y) < 20) continue;
        const x = r.gx + Math.floor(r.w / 2) + 0.5;
        const y = r.gy + Math.floor(r.h / 2) + 0.5;
        if (mod.tileAtFromState(sim, x, y).type === 'wall') continue;
        if (!mod.isWalkableFromState(sim, x, y, 0.2)) continue;
        far = { x, y };
        break;
      }
      if (!far) return null;
      mod.spawnEnemyProjectile(sim, 1, near.x, near.y, 6, { x: 0, y: 0 }, 600);
      mod.spawnEnemyProjectile(sim, 2, far.x, far.y, 6, { x: 0, y: 0 }, 600);
      return {
        near, far,
        nearPerceivable: w.isPerceivablePosition(near.x, near.y),
        farPerceivable: w.isPerceivablePosition(far.x, far.y),
        coreCount: sim.projectiles.length
      };
    });
    expect(injected, 'a far hidden room exists').not.toBeNull();
    expect(injected!.coreCount, 'real projectiles injected into the core').toBe(2);
    expect(injected!.nearPerceivable, 'near position is legally perceivable').toBe(true);
    expect(injected!.farPerceivable, 'far room is NOT legally perceivable').toBe(false);

    let seen: any = null;
    for (let i = 0; i < 80; i += 1) {
      const o = await client.observe();
      if (o.ok && o.observation.projectiles.some((p: any) =>
        Math.abs(p.x - injected!.near.x) < 0.01 && Math.abs(p.y - injected!.near.y) < 0.01)) {
        seen = o.observation;
        break;
      }
      await page.waitForTimeout(40);
    }
    expect(seen, 'the legal near projectile reached the agent').not.toBeNull();
    const far = injected!.far;
    const hiddenPresent = seen.projectiles.some((p: any) =>
      Math.abs(p.x - far.x) < 0.01 && Math.abs(p.y - far.y) < 0.01);
    expect(hiddenPresent, 'hidden far/other-room projectile NOT in observation').toBe(false);
    const serialized = JSON.stringify(seen).toLowerCase();
    for (const forbidden of ['"seed":', '"rngstate":', '"map":', '"tiles":', '"pendingcommands":']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(errors).toEqual([]);
  } finally {
    await bridge.close();
  }
});

test('takeover while a long action is in flight: no pageerror, no ACK after the new epoch', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN] });
  try {
    const client = await setupLinkedRun(page, bridge);
    const submitted = await client.submit('req_c3b000000000000000000040', [
      { type: 'move', actionId: 'aid_c3b000000000000000000040', dir: { x: 1, y: 0 }, ticks: 120 }
    ], 600);
    expect(submitted.ok).toBe(true);
    // Wait until the action has actually STARTED, then take over mid-flight.
    await expect.poll(async () => (await receipt(page, 'aid_c3b000000000000000000040'))?.status ?? 'none',
      { timeout: 20000 }).toBe('executing');
    await page.keyboard.press('d');
    await expect.poll(async () => (await worldState(page)).owner, { timeout: 10000 }).toBe('human');
    const final = await receipt(page, 'aid_c3b000000000000000000040');
    expect(final.status, 'in-flight action cancelled, never applied').toBe('cancelled');
    expect((await worldState(page)).link.status, 'link yielded').toBe('YIELDED');
    // Repeated frames must not resurrect the link or heartbeat in the new epoch.
    await page.waitForTimeout(600);
    expect((await worldState(page)).owner).toBe('human');
    expect(errors).toEqual([]);
  } finally {
    await bridge.close();
  }
});

test('Rendered effects: a real drone takes REAL damage from a ticks-long fire action', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN] });
  try {
    const client = await setupLinkedRun(page, bridge);
    // Give the player a durable HP pool so the drone cannot end the run first.
    const spawned = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      const data = JSON.parse(JSON.stringify(w.player.data));
      data.maxHp = 9999; data.hp = 9999;
      w.enqueueSetPlayerData(data);
      const p = { x: w.player.wx, y: w.player.wy };
      for (const d of [[3, 0], [0, 3], [-3, 0], [0, -3], [2.5, 2.5], [-2.5, -2.5]]) {
        const x = p.x + d[0], y = p.y + d[1];
        if (!w.isWalkable(x, y, 0.4)) continue;
        w.spawnEnemy('drone', x, y, w.currentRoom()?.id ?? 0, 1);
        return { x, y };
      }
      return null;
    });
    expect(spawned, 'a real drone spawn position exists').not.toBeNull();
    await expect.poll(async () => page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      return w.sim.drones.length;
    }), { timeout: 10000 }).toBeGreaterThan(0);
    const hpBefore = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      const d = w.sim.drones.find((x: any) => x.hp > 0);
      return d ? { id: d.id, hp: d.hp, x: d.x, y: d.y } : null;
    });
    expect(hpBefore, 'a live real drone exists in the core').not.toBeNull();

    const submitted = await client.submit('req_c3b000000000000000000050', [
      { type: 'fire', actionId: 'aid_c3b000000000000000000050', target: { x: hpBefore!.x, y: hpBefore!.y }, ticks: 120 }
    ], 600);
    expect(submitted.ok, 'fire accepted').toBe(true);

    // Poll the REAL core HP; the drone may die (hp <= 0) which is also damage.
    let lowest = hpBefore!.hp;
    for (let i = 0; i < 300; i += 1) {
      const sample = await page.evaluate((id) => {
        const w: any = (window as any).__game.scene.getScene('GameScene').world;
        const d = w.sim.drones.find((x: any) => x.id === id);
        return d ? d.hp : 0;
      }, hpBefore!.id);
      lowest = Math.min(lowest, sample);
      const r = await receipt(page, 'aid_c3b000000000000000000050');
      if (r?.status === 'applied') break;
      await page.waitForTimeout(20);
    }
    const fireReceipt = await receipt(page, 'aid_c3b000000000000000000050');
    expect(fireReceipt.executedTicks, 'the fire action ran for 120 real core ticks').toBe(120);
    expect(lowest, 'the real drone took REAL damage').toBeLessThan(hpBefore!.hp);
    console.log('C3B_EFFECT damage', JSON.stringify({
      droneId: hpBefore!.id, hpBefore: hpBefore!.hp, lowestHp: lowest,
      executedTicks: fireReceipt.executedTicks
    }));
    expect(errors).toEqual([]);
  } finally {
    await bridge.close();
  }
});

test('a queued stop preempts the ACTIVE long action; other actions keep FIFO', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN] });
  try {
    const client = await setupLinkedRun(page, bridge);
    const move120 = await client.submit('req_c3b000000000000000000060', [
      { type: 'move', actionId: 'aid_c3b000000000000000000060', dir: { x: 1, y: 0 }, ticks: 120 }
    ], 600);
    expect(move120.ok).toBe(true);
    await expect.poll(async () => (await receipt(page, 'aid_c3b000000000000000000060'))?.status ?? 'none',
      { timeout: 20000 }).toBe('executing');
    // STOP is queued while the 120-tick move is still running, followed by a
    // normal FIFO action that must survive the preemption.
    const queued = await client.submit('req_c3b000000000000000000061', [
      { type: 'stop', actionId: 'aid_c3b000000000000000000061' },
      { type: 'move', actionId: 'aid_c3b000000000000000000062', dir: { x: 0, y: 1 }, ticks: 20 }
    ], 600);
    expect(queued.ok, 'stop + fifo action accepted').toBe(true);

    await expect.poll(async () => (await receipt(page, 'aid_c3b000000000000000000060'))?.status ?? 'none',
      { timeout: 15000 }).toBe('cancelled');
    const cancelled = await receipt(page, 'aid_c3b000000000000000000060');
    expect(cancelled.executedTicks, 'preempted before 120 ticks').toBeLessThan(120);
    expect(cancelled.completedTick - cancelled.startedTick).toBe(cancelled.executedTicks);

    await expect.poll(async () => (await receipt(page, 'aid_c3b000000000000000000061'))?.status ?? 'none',
      { timeout: 15000 }).toBe('applied');
    const stopReceipt = await receipt(page, 'aid_c3b000000000000000000061');
    expect(stopReceipt.executedTicks, 'stop is one real neutral tick').toBe(1);

    await expect.poll(async () => (await receipt(page, 'aid_c3b000000000000000000062'))?.status ?? 'none',
      { timeout: 20000 }).toBe('applied');
    const after = await receipt(page, 'aid_c3b000000000000000000062');
    expect(after.executedTicks, 'FIFO action after the stop is preserved').toBe(20);
    expect(errors).toEqual([]);
  } finally {
    await bridge.close();
  }
});
