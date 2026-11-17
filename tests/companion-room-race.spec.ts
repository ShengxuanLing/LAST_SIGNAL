// Task C fix #3 — the notify-in-flight race (Tester probe 13/14).
//
// Field defect: the room cancel is an async HTTP POST. With that POST delayed
// (Tester used 4000 ms) the browser could still Owner-confirm the previous
// room's suggestion inside the window, enqueue it and produce an `applied`
// receipt — the cancel "arriving later" is not a guarantee.
//
// Contract proven here (deterministic, no timing luck):
//   T1  room POST delayed 4000 ms: the old confirm is refused SYNCHRONOUSLY by
//       the local room barrier (no shot, no cost, no queue), and after the late
//       notification lands the receipt is `cancelled` (never `applied`).
//   T2  the decision request REACHES the server but its RESPONSE is delayed 6 s
//       while the room changes: the renderer still refuses to apply (post-await
//       authority re-validation) and the ledger is cancelled, never applied.
//   T3  A -> B -> C with the FIRST room notification delayed 5 s: the late
//       A->B report cannot roll the session back to B; the newest room stays
//       usable with its own fresh proposal.
//
// Fixture (disclosed): the protagonist is placed on its own portal; the
// transitions themselves are the real product path.

import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../src/ai-native/ownerAuthFixture';
import { WorldGateway } from '../src/ai-native/worldGateway';
import { openLlm, resumeGame } from './uiNav';

const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;
const COMPANION_SERVER = resolve(process.cwd(), 'dist-mcp/companionMcpServer.mjs');
const TOKEN = randomBytes(24).toString('hex');
const sugId = () => `sug_${randomBytes(12).toString('hex')}`;
const reqId = () => `req_${randomBytes(12).toString('hex')}`;

async function bootRun(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('lastSignal.save.v1'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  const newRun = await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const t = s.children.list.find((c: any) =>
        c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  });
  expect(newRun).not.toBeNull();
  await page.mouse.click(newRun!.x, newRun!.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
}

async function clickText(page: Page, text: string): Promise<void> {
  const p = await page.evaluate((label) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    if (!s) return null;
    function findText(list: any[]): { x: number; y: number } | null {
      for (const c of list) {
        if (!c) continue;
        if (c.type === 'Text' && (c.text || '').includes(label)) {
          const b = c.getBounds();
          return { x: b.centerX, y: b.centerY };
        }
        if (c.list && Array.isArray(c.list)) {
          const found = findText(c.list);
          if (found) return found;
        }
      }
      return null;
    }
    return findText(s.children.list);
  }, text);
  expect(p, `text ${text}`).not.toBeNull();
  await page.mouse.click(p!.x, p!.y);
}

async function setup(page: Page, bridgeUrl: string): Promise<{ client: Client; transport: StdioClientTransport }> {
  await bootRun(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
  await openLlm(page);
  await page.waitForTimeout(300);
  await clickText(page, 'ENABLE / RE-AUTHORIZE');
  await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 15000 });
  await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]', bridgeUrl);
  await page.fill('[data-testid="external-link-form"] input[name="token"]', TOKEN);
  await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]', TEST_OWNER_KEY);
  await page.click('[data-testid="external-link-form"] button[type="submit"]');
  await page.waitForFunction(
    () => (window as any).__game.scene.getScene('GameScene').companionStatus === 'CONNECTED',
    undefined, { timeout: 20000 }
  );
  await resumeGame(page);
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    if (!w.sim.echo) w.enableEcho();
  });
  await page.waitForFunction(
    () => !!((window as any).__game.scene.getScene('GameScene').world.sim.echo),
    undefined, { timeout: 20000 }
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [COMPANION_SERVER],
    env: {
      PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '',
      TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '',
      LAST_SIGNAL_WORLD_BRIDGE_URL: bridgeUrl, LAST_SIGNAL_WORLD_TOKEN: TOKEN
    } as never,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'companion-room-race', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}

async function holdPending(page: Page, id: string): Promise<any> {
  const held = await page.evaluate((sid: string) =>
    (window as any).__game.scene.getScene('GameScene').companionLink.pending()
      .then((list: any[]) => list.find((p: any) => p.suggestionId === sid) ?? null), id);
  expect(held, 'the Owner link holds the proposal object').not.toBeNull();
  return held;
}

/** A `fire` proposal needs a perceived real hostile in the CURRENT room. */
async function seedHostileSuggestion(page: Page, client: Client, prefix: string): Promise<{ id: string; held: any }> {
  await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    const echo = w.echoActor;
    if ((w.sim.drones ?? []).length === 0) w.spawnEnemy('drone', echo.x + 1, echo.y, w.currentRoom()?.id ?? 0, 1);
    void gs.companionLink.pushObservation();
  });
  await page.waitForTimeout(600);
  const obs = (await client.callTool({ name: 'echo_observe', arguments: {} })).structuredContent as any;
  expect(obs.ok, `observe: ${JSON.stringify(obs)}`).toBe(true);
  const drone = obs.observation.drones[0];
  expect(drone, `a real drone is perceived (${prefix})`).toBeTruthy();
  const id = sugId();
  const proposed = (await client.callTool({
    name: 'echo_suggest',
    arguments: {
      requestId: reqId(), suggestionId: id, kind: 'fire', reason: 'perceived_hostile',
      target: { x: drone.x, y: drone.y }, ttlTicks: 600
    }
  })).structuredContent as any;
  expect(proposed.ok, `seed ${prefix}: ${JSON.stringify(proposed)}`).toBe(true);
  return { id, held: await holdPending(page, id) };
}

/** A `move` proposal needs no hostile (works in a freshly entered room). */
async function seedMoveSuggestion(page: Page, client: Client, prefix: string): Promise<{ id: string; held: any }> {
  const obs = (await client.callTool({ name: 'echo_observe', arguments: {} })).structuredContent as any;
  expect(obs.ok, `observe: ${JSON.stringify(obs)}`).toBe(true);
  const id = sugId();
  const proposed = (await client.callTool({
    name: 'echo_suggest',
    arguments: {
      requestId: reqId(), suggestionId: id, kind: 'move', reason: 'no_perceived_target',
      target: { x: obs.observation.echo.x + 1, y: obs.observation.echo.y }, ttlTicks: 600
    }
  })).structuredContent as any;
  expect(proposed.ok, `seed ${prefix}: ${JSON.stringify(proposed)}`).toBe(true);
  return { id, held: await holdPending(page, id) };
}

async function snapshot(page: Page): Promise<any> {
  return page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    return {
      tick: w.sim.tick,
      roomId: w.currentRoomId,
      echoShots: w.echoShotsFired,
      echoProjectiles: w.sim.projectiles.filter((p: any) => p.source === 'echo').length,
      pendingIntent: w.hasPendingCompanionIntent,
      pendingCommands: (w.sim.pendingCommands || []).map((c: any) => c.type),
      echoEnergy: w.sim.signal ? w.sim.signal.actors.echo.energy.energy : null,
      linkRoom: gs.companionLink ? gs.companionLink.roomId : null,
      linkGeneration: gs.companionLink ? gs.companionLink.roomGeneration : null
    };
  });
}

async function portalTo(page: Page, expectedPrev: number): Promise<number> {
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    w.player.reset(w.portal.wx, w.portal.wy);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    (window as any).__game.scene.getScene('GameScene').world.player.requestInteract();
  });
  await page.waitForFunction((prev: number) => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return w.currentRoomId !== prev && w.currentRoomId >= 0;
  }, expectedPrev, { timeout: 25000 });
  return page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.currentRoomId);
}

test('T1 delayed room notification 4000ms: old confirm refused synchronously; receipt never applied', async ({ page }) => {
  test.setTimeout(180000);
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({
    gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 1000
  });
  let sdk: { client: Client; transport: StdioClientTransport } | null = null;
  try {
    sdk = await setup(page, bridge.url);
    const seeded = await seedHostileSuggestion(page, sdk.client, 'T1');

    // Delay ONLY the room-cancel notification, exactly like the Tester probe.
    const roomResponses: number[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/world-link/companion-room')) roomResponses.push(r.status());
    });
    let notifySent = 0;
    await page.route('**/world-link/companion-room', async (route) => {
      notifySent += 1;
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue();
    });

    const roomA = (await snapshot(page)).roomId;
    const roomB = await portalTo(page, roomA);
    expect(roomB).not.toBe(roomA);
    expect(notifySent, 'the room notification really went out (still in flight)').toBeGreaterThan(0);

    // INSIDE the 4000 ms window: the local barrier must already refuse.
    const diag = await page.evaluate((old: any) => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return {
        linkRoom: gs.companionLink ? gs.companionLink.roomId : 'no-link',
        worldRoom: gs.world.currentRoomId,
        heldRoom: old ? old.roomId : null
      };
    }, seeded.held);
    expect(diag.linkRoom, 'the local barrier follows the committed room').toBe(roomB);
    expect(diag.heldRoom, 'the held proposal belongs to the old room').toBe(roomA);

    const inWindow = await page.evaluate(async (old: any) => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const ok = await gs.companionLink.decide(old, 'confirm');
      return { ok, error: gs.companionLink.error, pending: gs.world.hasPendingCompanionIntent };
    }, seeded.held);
    expect(inWindow.ok, 'stale confirm inside the window must be refused').toBe(false);
    expect(String(inWindow.error)).toContain('E_STALE_GENERATION');
    expect(inWindow.pending, 'nothing was enqueued').toBe(false);

    await page.waitForTimeout(600);
    const snap = await snapshot(page);
    expect(snap.pendingIntent).toBe(false);
    expect(snap.pendingCommands.filter((c: string) => c.includes('echo'))).toHaveLength(0);
    expect(snap.echoProjectiles, 'no echo projectile').toBe(0);
    expect(snap.echoShots, 'the echo never fired').toBe(0);

    // After the delayed notification lands: explicit cancellation, never applied.
    await expect.poll(async () => {
      const body = (await sdk!.client.callTool({ name: 'echo_status', arguments: {} })).structuredContent as any;
      return JSON.stringify(body.receipts);
    }, { timeout: 20000 }).toContain('"status":"cancelled"');
    const status = (await sdk!.client.callTool({ name: 'echo_status', arguments: {} })).structuredContent as any;
    expect(status.receipts.find((r: any) => r.suggestionId === seeded.id))
      .toMatchObject({ status: 'cancelled', reason: 'room_changed' });
    expect(status.receipts.some((r: any) => r.suggestionId === seeded.id && r.status === 'applied')).toBe(false);
    expect(status.status.roomId).toBe(roomB);
    expect(roomResponses, 'the real Owner-shaped notification reached the handler').toContain(200);

    // Agent shape cannot reach the Owner cancel route: refused at the OUTER
    // browser-only Origin gate (route classification).
    const agentCancel = await fetch(`${bridge.url}/world-link/companion-room`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ session: status.status.session, epoch: status.status.epoch, roomId: roomA, tick: snap.tick, roomSeq: 1 })
    });
    expect(agentCancel.status).toBe(403);
    const denied = (await agentCancel.json()) as any;
    expect(denied.ok).toBe(false);
    expect(denied.messageKey).toBe('world.origin_denied');

    // The NEW room still works exactly once.
    const fresh = await seedMoveSuggestion(page, sdk.client, 'T1-new-room');
    expect(fresh.held.roomId, 'the new proposal belongs to the new room').toBe(roomB);
    expect(await page.evaluate(async (s: any) =>
      (window as any).__game.scene.getScene('GameScene').companionLink.decide(s, 'confirm'), fresh.held)).toBe(true);
    await page.waitForFunction(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return w.hasPendingCompanionIntent === false;
    }, undefined, { timeout: 15000 });
  } finally {
    await sdk?.client.close().catch(() => undefined);
    await bridge.close();
  }
});

test('T2 decision response delayed 6s while the room changes: server ok, renderer refuses to apply', async ({ page }) => {
  test.setTimeout(180000);
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({
    gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 1000
  });
  let sdk: { client: Client; transport: StdioClientTransport } | null = null;
  try {
    sdk = await setup(page, bridge.url);
    const seeded = await seedHostileSuggestion(page, sdk.client, 'T2');

    // The request REACHES the server (it really records the decision); only the
    // response is delayed — the dangerous in-flight window.
    let decisionSent = 0;
    await page.route('**/world-link/companion-decision', async (route) => {
      decisionSent += 1;
      const response = await route.fetch();
      await new Promise((r) => setTimeout(r, 6000));
      await route.fulfill({ response });
    });

    const roomA = (await snapshot(page)).roomId;
    await page.evaluate((old: any) => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      (window as any).__raceDecide = gs.companionLink.decide(old, 'confirm')
        .then((ok: boolean) => ({ ok, error: gs.companionLink.error }));
    }, seeded.held);
    await expect.poll(() => decisionSent, { timeout: 5000 }).toBeGreaterThan(0);

    // Change the room while the decision response is still in flight.
    const roomB = await portalTo(page, roomA);
    expect(roomB).not.toBe(roomA);

    const decision = await page.evaluate(() => (window as any).__raceDecide);
    expect(decision.ok, 'the late decision response must not be applied').toBe(false);
    expect(String(decision.error)).toContain('E_STALE_GENERATION');

    await page.waitForTimeout(700);
    const snap = await snapshot(page);
    expect(snap.pendingIntent, 'no intent enqueued after the await').toBe(false);
    expect(snap.pendingCommands.filter((c: string) => c.includes('echo'))).toHaveLength(0);
    expect(snap.echoProjectiles).toBe(0);
    expect(snap.echoShots).toBe(0);

    // The ledger must be cancelled, never applied.
    const status = (await sdk.client.callTool({ name: 'echo_status', arguments: {} })).structuredContent as any;
    const receipt = status.receipts.find((r: any) => r.suggestionId === seeded.id);
    expect(receipt).toMatchObject({ status: 'cancelled', reason: 'room_changed' });
    expect(status.receipts.some((r: any) => r.suggestionId === seeded.id && r.status === 'applied')).toBe(false);
  } finally {
    await sdk?.client.close().catch(() => undefined);
    await bridge.close();
  }
});

test('T3 A->B->C with the first notification delayed: no rollback, newest room usable', async ({ page }) => {
  test.setTimeout(180000);
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({
    gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 1000
  });
  let sdk: { client: Client; transport: StdioClientTransport } | null = null;
  try {
    sdk = await setup(page, bridge.url);
    const roomA = (await snapshot(page)).roomId;

    let roomPosts = 0;
    await page.route('**/world-link/companion-room', async (route) => {
      roomPosts += 1;
      if (roomPosts === 1) await new Promise((r) => setTimeout(r, 5000));
      await route.continue();
    });

    const roomB = await portalTo(page, roomA);
    expect(roomB).not.toBe(roomA);
    // B -> C immediately, while the A->B notification is still delayed 5 s.
    const roomC = await portalTo(page, roomB);
    expect(roomC).not.toBe(roomB);
    const local = await snapshot(page);
    expect(local.linkRoom, 'the LOCAL barrier follows the newest room').toBe(roomC);
    expect(local.linkGeneration, 'generation bumps per room').toBeGreaterThanOrEqual(2);

    await page.waitForTimeout(6000);
    const after = (await sdk.client.callTool({ name: 'echo_status', arguments: {} })).structuredContent as any;
    expect(after.status.roomId, 'a late notification never rolls the session back').toBe(roomC);
    expect((await snapshot(page)).linkRoom).toBe(roomC);

    // The newest room stays usable (fresh proposal bound to the newest room).
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      void gs.companionLink.pushObservation();
    });
    await page.waitForTimeout(400);
    const fresh = await seedMoveSuggestion(page, sdk.client, 'T3-newest-room');
    expect(fresh.held.roomId).toBe(roomC);
    expect(roomPosts).toBeGreaterThanOrEqual(2);
  } finally {
    await sdk?.client.close().catch(() => undefined);
    await bridge.close();
  }
});
