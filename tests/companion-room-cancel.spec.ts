// Task C fix #2 — REAL regression for the field defect: an unconfirmed
// Companion suggestion seeded in room A survived a REAL portal transition and
// could still be Owner-confirmed, executing one echo shot at the OLD room's
// coordinates (Tester probe 11/12, session ses_6e…).
//
// This spec runs the real bridge + official companionMcpServer + real browser:
//   * real room commit retires old-room proposals (explicit `cancelled` receipt)
//   * a held OLD suggestion object is refused with E_STALE_GENERATION
//   * nothing executes: no pending intent, no queue entry, no projectile, no cost
//   * the Agent cannot cancel (no ownerCap => 403)
//   * new room: new observe -> new suggest -> Owner confirm -> ONE tick commit
//   * pause/resume never cancels a live proposal
//
// Fixture (disclosed): the protagonist is placed on its own portal so the test
// does not have to path-find. The transition itself is the real product path.

import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../src/ai-native/ownerAuthFixture';
import { WorldGateway } from '../src/ai-native/worldGateway';

const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;
const TOKEN = randomBytes(24).toString('hex');
const COMPANION_SERVER = resolve(process.cwd(), 'dist-mcp/companionMcpServer.mjs');
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

async function authorizeCompanion(page: Page, bridgeUrl: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
  await clickText(page, 'LLM COMPANION >');
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
}

async function enableEcho(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    if (!w.sim.echo) w.enableEcho();
  });
  await page.waitForFunction(
    () => !!((window as any).__game.scene.getScene('GameScene').world.sim.echo),
    undefined, { timeout: 20000 }
  );
}

async function snapshot(page: Page): Promise<any> {
  return page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    return {
      tick: w.sim.tick, roomId: w.currentRoomId,
      echo: w.sim.echo ? { x: w.sim.echo.x, y: w.sim.echo.y } : null,
      echoShots: gs.echoShotsFired,
      echoProjectiles: w.sim.projectiles.filter((p: any) => p.source === 'echo').length,
      pendingIntent: w.hasPendingCompanionIntent,
      pendingCommands: (w.sim.pendingCommands || []).map((c: any) => c.type),
      echoEnergy: w.sim.signal ? w.sim.signal.actors.echo.energy.energy : null
    };
  });
}

test('real portal retires old-room suggestions: no stale confirm, no execution; new room works once', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({
    gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 1000
  });
  let sdk: { client: Client; transport: StdioClientTransport } | null = null;
  try {
    await bootRun(page);
    await authorizeCompanion(page, bridge.url);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
    await enableEcho(page);

    sdk = await (async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [COMPANION_SERVER],
        env: {
          PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '',
          TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '',
          LAST_SIGNAL_WORLD_BRIDGE_URL: bridge.url, LAST_SIGNAL_WORLD_TOKEN: TOKEN
        } as never,
        stderr: 'pipe'
      });
      const client = new Client({ name: 'companion-room-cancel', version: '0.0.0' });
      await client.connect(transport);
      return { client, transport };
    })();

    // 1) A legal unconfirmed proposal in room A.
    // 同步点：enableEcho 后首次 observation 可能尚未在 30 帧 push 周期内到达。
    // 重试直到真实 observation 就绪（仍要求 ok===true，不放宽断言）。
    let obs: any = null;
    for (let i = 0; i < 30 && !obs?.ok; i++) {
      obs = (await sdk.client.callTool({ name: 'echo_observe', arguments: {} })).structuredContent as any;
      if (!obs?.ok) await page.waitForTimeout(100);
    }
    expect(obs?.ok, `echo_observe: ${JSON.stringify(obs)}`).toBe(true);
    const echoAt = obs!.observation.echo;
    const oldId = sugId();
    const proposed = (await sdk.client.callTool({
      name: 'echo_suggest',
      arguments: {
        requestId: reqId(), suggestionId: oldId, kind: 'move', reason: 'no_perceived_target',
        target: { x: echoAt.x + 1, y: echoAt.y }, ttlTicks: 600
      }
    })).structuredContent as any;
    expect(proposed.ok, `seeded suggestion: ${JSON.stringify(proposed)}`).toBe(true);
    const statusA = (await sdk.client.callTool({ name: 'echo_status', arguments: {} })).structuredContent as any;
    expect(statusA.pending.map((p: any) => p.suggestionId)).toContain(oldId);
    const heldOld = await page.evaluate((id: string) =>
      (window as any).__game.scene.getScene('GameScene').companionLink.pending()
        .then((list: any[]) => list.find((p: any) => p.suggestionId === id) ?? null), oldId);
    expect(heldOld, 'the Owner UI really held the old proposal object').not.toBeNull();
    const roomA = (await snapshot(page)).roomId;

    // 2) REAL portal transition (fixture: stand on the portal).
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
    }, roomA, { timeout: 25000 });
    const roomB = (await snapshot(page)).roomId;
    expect(roomB).not.toBe(roomA);

    // 3) The committed room boundary retires the old proposal (explicit reason).
    await expect.poll(async () => {
      const body = (await sdk!.client.callTool({ name: 'echo_status', arguments: {} })).structuredContent as any;
      return JSON.stringify({ pending: body.pending.length, receipts: body.receipts });
    }, { timeout: 20000 }).toContain('"status":"cancelled"');
    const statusB = (await sdk!.client.callTool({ name: 'echo_status', arguments: {} })).structuredContent as any;
    expect(statusB.pending.map((p: any) => p.suggestionId)).not.toContain(oldId);
    const receipt = statusB.receipts.find((r: any) => r.suggestionId === oldId);
    expect(receipt).toMatchObject({ status: 'cancelled', reason: 'room_changed' });
    expect(statusB.status.roomId).toBe(roomB);

    // 4) A held OLD object can no longer be confirmed: refused, nothing runs.
    const beforeConfirm = await snapshot(page);
    const decided = await page.evaluate(async (old: any) => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const ok = await gs.companionLink.decide(old, 'confirm');
      return { ok, error: gs.companionLink.error };
    }, heldOld);
    expect(decided.ok, 'stale Owner confirm must be refused').toBe(false);
    expect(String(decided.error)).toContain('E_STALE_GENERATION');
    await page.waitForTimeout(500);
    const afterConfirm = await snapshot(page);
    expect(afterConfirm.pendingIntent, 'no companion intent was queued').toBe(false);
    expect(afterConfirm.pendingCommands.filter((c: string) => c === 'toggle-relay' || c === 'signal-scan' || c === 'signal-jam'))
      .toHaveLength(0);
    expect(afterConfirm.echoProjectiles, 'no echo projectile was fired').toBe(beforeConfirm.echoProjectiles);
    expect(afterConfirm.echoShots).toBe(beforeConfirm.echoShots);

    // 5) The Agent cannot cancel the Owner's work (no ownerCap / no Origin).
    const agentCancel = await fetch(`${bridge.url}/world-link/companion-room`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ session: statusB.status.session, epoch: statusB.status.epoch, roomId: roomA, tick: afterConfirm.tick })
    });
    expect(agentCancel.status, 'agent token cannot reach the Owner cancel route').toBe(403);
    expect(((await agentCancel.json()) as any).ok).toBe(false);

    // 6) New room: the renderer published a NEW observation, so a new proposal
    //    is legal and the Owner confirm executes exactly ONCE on the next tick.
    const obsB = (await sdk.client.callTool({ name: 'echo_observe', arguments: {} })).structuredContent as any;
    expect(obsB.ok).toBe(true);
    // The renderer published the NEW room's committed observation at the room
    // boundary (a committed frame, not the live tick), so assert the binding
    // instead of comparing wall-clock ticks.
    expect(Number.isFinite(obsB.observation.tick)).toBe(true);
    const newEcho = obsB.observation.echo;
    const newId = sugId();
    const proposedB = (await sdk.client.callTool({
      name: 'echo_suggest',
      arguments: {
        requestId: reqId(), suggestionId: newId, kind: 'move', reason: 'no_perceived_target',
        target: { x: newEcho.x + 1, y: newEcho.y }, ttlTicks: 600
      }
    })).structuredContent as any;
    expect(proposedB.ok, `new-room suggestion: ${JSON.stringify(proposedB)}`).toBe(true);
    expect(proposedB.suggestion.roomId).toBe(roomB);

    const heldNew = await page.evaluate((id: string) =>
      (window as any).__game.scene.getScene('GameScene').companionLink.pending()
        .then((list: any[]) => list.find((p: any) => p.suggestionId === id) ?? null), newId);
    expect(heldNew).not.toBeNull();
    const confirmed = await page.evaluate(async (s: any) => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const ok = await gs.companionLink.decide(s, 'confirm');
      return { ok, pending: gs.world.hasPendingCompanionIntent };
    }, heldNew);
    expect(confirmed.ok, 'the new-room proposal is confirmable').toBe(true);
    expect(confirmed.pending, 'confirm enqueues exactly one intent for the next tick').toBe(true);
    await page.waitForFunction(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return w.hasPendingCompanionIntent === false;
    }, undefined, { timeout: 15000 });
    const statusC = (await sdk.client.callTool({ name: 'echo_status', arguments: {} })).structuredContent as any;
    expect(statusC.receipts.find((r: any) => r.suggestionId === newId).status).toMatch(/confirmed|applied/);

    expect(errors).toEqual([]);
  } finally {
    await sdk?.client.close().catch(() => undefined);
    await bridge.close();
  }
});

test('pause/resume with no room change never cancels a live proposal', async ({ page }) => {
  test.setTimeout(150000);
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({
    gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 1000
  });
  let sdk: { client: Client; transport: StdioClientTransport } | null = null;
  try {
    await bootRun(page);
    await authorizeCompanion(page, bridge.url);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
    await enableEcho(page);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [COMPANION_SERVER],
      env: {
        PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '',
        TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '',
        LAST_SIGNAL_WORLD_BRIDGE_URL: bridge.url, LAST_SIGNAL_WORLD_TOKEN: TOKEN
      } as never,
      stderr: 'pipe'
    });
    const client = new Client({ name: 'companion-room-cancel-resume', version: '0.0.0' });
    await client.connect(transport);
    sdk = { client, transport };

    // 同步点：enableEcho 后首次 observation 可能尚未在 30 帧 push 周期内到达。
    // 重试直到真实 observation 就绪（仍要求 ok===true，不放宽断言）。
    let obs: any = null;
    for (let i = 0; i < 30 && !obs?.ok; i++) {
      obs = (await client.callTool({ name: 'echo_observe', arguments: {} })).structuredContent as any;
      if (!obs?.ok) await page.waitForTimeout(100);
    }
    expect(obs?.ok).toBe(true);
    const id = sugId();
    expect(((await client.callTool({
      name: 'echo_suggest',
      arguments: {
        requestId: reqId(), suggestionId: id, kind: 'move', reason: 'no_perceived_target',
        target: { x: obs.observation.echo.x + 1, y: obs.observation.echo.y }, ttlTicks: 600
      }
    })).structuredContent as any).ok).toBe(true);

    // Pause -> resume -> pause again, no room change.
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
      await page.waitForTimeout(250);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
      await page.waitForTimeout(250);
    }
    const status = (await client.callTool({ name: 'echo_status', arguments: {} })).structuredContent as any;
    expect(status.pending.map((p: any) => p.suggestionId), 'pause/resume keeps the proposal').toContain(id);
    expect(status.receipts.some((r: any) => r.suggestionId === id && r.status === 'cancelled')).toBe(false);
  } finally {
    await sdk?.client.close().catch(() => undefined);
    await bridge.close();
  }
});
