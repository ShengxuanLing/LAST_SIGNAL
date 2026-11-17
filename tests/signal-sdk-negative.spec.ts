// AI-NATIVE-02 Task C — REAL official-MCP-SDK negative/positive Matrix for
// Signal actions on the rendered world.
//
// Everything here goes through the official `@modelcontextprotocol/sdk` client
// talking to the real `dist-mcp/worldMcpServer.mjs` subprocess, which talks to
// the real bridge, which talks to the REAL rendered GameScene. No direct core
// import, no hand-written HTTP shortcut, no mocked transport.
//
// Contract proven:
//   1. A v1-shaped `scan` WITHOUT an actor is rejected by the tool schema and
//      never reaches the rendered queue (no progress, no cost).
//   2. `actor:'echo'` from the external Player side is REFUSED at the rendered
//      controller with E_PERMISSION — the Player cannot borrow the Companion's
//      confirmation path. Neither energy account is charged.
//   3. `actor:'player'` really commits: the PLAYER's own finite account pays
//      SCAN_COST / JAM_COST and the relay/echo accounts are untouched.
//   4. Jam suppresses emission without enabling manual/power.
//
// This is an interface/authority test, NOT an LLM playthrough.

import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../src/ai-native/ownerAuthFixture';
import { WorldGateway } from '../src/ai-native/worldGateway';
import { writeSecureTokenFile, deleteSecureTokenFile } from '../src/ai-native/secureTokenFile';
import { openAiHub, labelCenter, resumeGame } from './uiNav';

const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;
const WORLD_SERVER = resolve(process.cwd(), 'dist-mcp/worldMcpServer.mjs');
const SCAN_COST = 10;
const JAM_COST = 25;
const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;

async function bootAndAuthorize(page: Page, bridgeUrl: string, token: string): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  await page.evaluate(({ url, t }) => {
    (window as any).__externalLinkConfig = { bridgeUrl: url, token: t };
  }, { url: bridgeUrl, t: token });
  const newRun = await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const c = s.children.list.find((o: any) =>
        o.type === 'Text' && (o.text || '').trim().startsWith('NEW RUN') && o.visible !== false);
      if (c) return { x: c.x, y: c.y };
    }
    return null;
  });
  expect(newRun).not.toBeNull();
  await page.mouse.click(newRun!.x, newRun!.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));

  await openAiHub(page);
  await page.evaluate(({ url, t, ownerKey }) => {
    (window as any).__externalLinkConfig = { bridgeUrl: url, token: t, ownerKey };
  }, { url: bridgeUrl, t: token, ownerKey: TEST_OWNER_KEY });
  const pos = await page.evaluate(() => {
    const ps = (window as any).__game.scene.getScene('PauseScene');
    const t = ps.children.list.find((c: any) => c.type === 'Text' && (c.text || '').startsWith('AUTHORIZE EXTERNAL AGENT'));
    return t ? { x: t.x, y: t.y } : null;
  });
  expect(pos, 'authorization control is present').not.toBeNull();
  await page.mouse.click(Math.round(pos!.x), Math.round(pos!.y));
  await expect.poll(() => page.evaluate(() =>
    (window as any).__game.scene.getScene('GameScene').world.player.control.owner
  ), { timeout: 15000 }).toBe('external');
  await resumeGame(page);
}

/** Inject ONE real SimSignalDevice (same shape the core creates) as a fixture. */
async function injectDevice(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    const sim = w._sim;
    const account = () => ({
      energy: { energy: 100, regenAcc: 0 },
      cooldowns: { scanCooldownTicks: 0, scanRevealTicks: 0, jamCooldownTicks: 0, jamRemainingTicks: 0 }
    });
    sim.signal = {
      deviceId: 'relay_main',
      roomId: w.currentRoom()?.id ?? 0,
      x: w.player.wx + 2,
      y: w.player.wy,
      control: { manualEnabled: false, powered: true, jammedUntilTick: 0, disposed: false },
      relay: 'INACTIVE',
      manualEnabled: false,
      powered: true,
      jammedUntilTick: 0,
      actors: {
        player: { actor: 'player', ...account() },
        echo: { actor: 'echo', ...account() }
      },
      evidence: []
    };
  });
  await page.waitForFunction(() => !!(window as any).__game.scene.getScene('GameScene').world.sim.signal);
}

async function signalState(page: Page): Promise<any> {
  return page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    const s = w.sim.signal;
    if (!s) return null;
    return {
      tick: w.sim.tick,
      relay: s.relay,
      manualEnabled: s.manualEnabled,
      powered: s.powered,
      jammedUntilTick: s.jammedUntilTick,
      playerEnergy: s.actors.player.energy.energy,
      echoEnergy: s.actors.echo.energy.energy,
      playerScanCD: s.actors.player.cooldowns.scanCooldownTicks,
      playerJamCD: s.actors.player.cooldowns.jamCooldownTicks,
      pending: (w.sim.pendingCommands || []).length
    };
  });
}

/** Energy regenerates, so a single read can miss the exact post-charge value.
 *  Sample the real PLAYER account in the page while the action commits. */
async function startEnergySampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    (window as any).__energySamples = [];
    (window as any).__energyTimer = setInterval(() => {
      const e = w.sim.signal?.actors.player.energy.energy;
      if (typeof e === 'number') (window as any).__energySamples.push(e);
    }, 16);
  });
}

async function stopEnergySampler(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    if ((window as any).__energyTimer) clearInterval((window as any).__energyTimer);
    return ((window as any).__energySamples ?? []) as number[];
  });
}

test('official MCP SDK: v1 scan is refused, actor=echo is E_PERMISSION, actor=player really commits', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const token = randomBytes(24).toString('hex');
  const tokenFile = await writeSecureTokenFile(token);
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({
    gateway, token, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 1000
  });
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;
  try {
    await bootAndAuthorize(page, bridge.url, token);
    await injectDevice(page);

    transport = new StdioClientTransport({
      command: process.execPath,
      args: [WORLD_SERVER],
      env: {
        ...process.env,
        LAST_SIGNAL_WORLD_BRIDGE_URL: bridge.url,
        LAST_SIGNAL_WORLD_TOKEN_FILE: tokenFile.path
      } as never,
      stderr: 'pipe'
    });
    client = new Client({ name: 'signal-sdk-negative', version: '0.0.0' });
    await client.connect(transport);

    const listed = (await client.callTool({ name: 'world_list_sessions', arguments: {} }))
      .structuredContent as { ok?: boolean; attached?: boolean };
    expect(listed.ok, 'agent attached to the rendered session').toBe(true);
    expect(listed.attached).toBe(true);

    const baseline = await signalState(page);
    expect(baseline.relay).toBe('INACTIVE');
    expect(baseline.playerEnergy).toBe(100);
    expect(baseline.echoEnergy).toBe(100);

    // 1) v1-shaped scan without an actor: refused by the TOOL SCHEMA.
    const v1 = await client.callTool({
      name: 'world_action',
      arguments: {
        requestId: rid(1),
        actions: [{ type: 'scan', actionId: aid(1), ticks: 1 }],
        ttlTicks: 120
      }
    });
    expect(v1.isError, 'a v1 scan without actor is a tool error').toBe(true);
    const afterV1 = await signalState(page);
    expect(afterV1.playerEnergy, 'a schema-refused scan costs nothing').toBe(100);
    expect(afterV1.echoEnergy).toBe(100);
    expect(afterV1.pending, 'a schema-refused scan is never queued').toBe(0);
    expect(await page.evaluate((id) => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return w.externalLink.receipt(id)?.status ?? 'none';
    }, aid(1))).toBe('none');

    // 2) actor:'echo' from the external Player side: REFUSED with E_PERMISSION.
    const echoBypass = await client.callTool({
      name: 'world_action',
      arguments: {
        requestId: rid(2),
        actions: [{ type: 'scan', actionId: aid(2), actor: 'echo', ticks: 1 }],
        ttlTicks: 120
      }
    });
    expect((echoBypass.structuredContent as { ok?: boolean }).ok, 'the bridge queues the batch').toBe(true);
    await expect.poll(() => page.evaluate((id) => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const r = w.externalLink.receipt(id);
      return r ? `${r.status}:${r.code ?? ''}` : 'none';
    }, aid(2)), { timeout: 20000 }).toBe('rejected:E_PERMISSION');
    const afterEcho = await signalState(page);
    expect(afterEcho.playerEnergy, 'the Player account is not charged for a refused echo action').toBe(100);
    expect(afterEcho.echoEnergy, 'the Echo account is not charged either').toBe(100);
    expect(afterEcho.pending, 'the refused action leaves no queued command').toBe(0);
    expect(afterEcho.relay, 'the refused action never touches the relay').toBe('INACTIVE');

    // 3) actor:'player': REAL commit on the PLAYER's own finite account.
    await startEnergySampler(page);
    const playerScan = await client.callTool({
      name: 'world_action',
      arguments: {
        requestId: rid(3),
        actions: [{ type: 'scan', actionId: aid(3), actor: 'player', ticks: 1 }],
        ttlTicks: 120
      }
    });
    expect((playerScan.structuredContent as { ok?: boolean }).ok).toBe(true);
    await expect.poll(() => page.evaluate((id) => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return w.externalLink.receipt(id)?.status ?? 'none';
    }, aid(3)), { timeout: 20000 }).toBe('applied');
    await expect.poll(async () => (await signalState(page)).playerScanCD, { timeout: 20000 }).toBeGreaterThan(0);
    const scanSamples = await stopEnergySampler(page);
    expect(Math.min(...scanSamples), 'the PLAYER account really paid SCAN_COST')
      .toBeLessThanOrEqual(100 - SCAN_COST);
    const afterScan = await signalState(page);
    expect(afterScan.echoEnergy, 'a player scan never spends the echo account').toBe(100);
    await expect.poll(async () => (await signalState(page)).pending, { timeout: 20000 })
      .toBe(0);

    // 4) actor:'player' jam: REAL cost, suppression only, NO manual enable.
    await startEnergySampler(page);
    const playerJam = await client.callTool({
      name: 'world_action',
      arguments: {
        requestId: rid(4),
        actions: [{ type: 'jam', actionId: aid(4), actor: 'player', ticks: 1 }],
        ttlTicks: 120
      }
    });
    expect((playerJam.structuredContent as { ok?: boolean }).ok).toBe(true);
    await expect.poll(() => page.evaluate((id) => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return w.externalLink.receipt(id)?.status ?? 'none';
    }, aid(4)), { timeout: 20000 }).toBe('applied');
    await expect.poll(async () => (await signalState(page)).jammedUntilTick, { timeout: 20000 }).toBeGreaterThan(0);
    const jamSamples = await stopEnergySampler(page);
    expect(Math.min(...jamSamples), 'the PLAYER account really paid JAM_COST')
      .toBeLessThanOrEqual(100 - JAM_COST);
    const afterJam = await signalState(page);
    expect(afterJam.jammedUntilTick, 'jam really suppresses until a future tick').toBeGreaterThan(afterJam.tick);
    expect(afterJam.manualEnabled, 'jam NEVER flips the manual switch').toBe(false);
    expect(afterJam.powered, 'jam NEVER cuts power').toBe(true);
    expect(afterJam.relay, 'a jammed relay does not emit (JAMMED, never ACTIVE)').toBe('JAMMED');
    expect(afterJam.echoEnergy, 'the echo account stayed independent the whole time').toBe(100);

    // 5) Jam EXPIRES back to the prior rule: no manual change survives it.
    await expect.poll(async () => (await signalState(page)).relay, { timeout: 40000 }).toBe('INACTIVE');
    const afterExpiry = await signalState(page);
    expect(afterExpiry.manualEnabled, 'expiry restores the prior manual rule (still OFF)').toBe(false);
    expect(afterExpiry.powered, 'expiry leaves power untouched').toBe(true);
    expect(afterExpiry.echoEnergy, 'the echo account was never charged by player actions').toBe(100);
    await expect.poll(async () => (await signalState(page)).pending, { timeout: 20000 })
      .toBe(0);

    expect(errors).toEqual([]);
  } finally {
    try { await client?.close(); } catch { /* already gone */ }
    await bridge.close();
    await deleteSecureTokenFile(tokenFile);
  }
});
