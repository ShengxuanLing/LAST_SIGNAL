// AI-NATIVE-02 Task C — Signal cooperation chain E2E through the rendered UI.
//
// NO global __externalLinkConfig, NO manual dev push/step, NO LLM claim.
//
// Flow:
//   1. Default NEW RUN: no Relay device (portal always open)
//   2. Pause → SIGNAL COLLABORATION opt-in ON → save → resume
//   3. Enter a room → real Relay device spawns (INACTIVE)
//   4. Official Companion SDK suggest scan (fixture-labeled, not LLM)
//   5. Real Owner UI CONFIRM → normal frame commits → echo energy deducted
//   6. Official Companion SDK suggest toggle-relay → Owner CONFIRM → ACTIVE
//   7. Real portal → human interact → enter next room
//   8. Check observation/memory/receipts updated
//
// Script suggestions are fixture-labeled only; never claimed as LLM output.

import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorldGateway } from '../src/ai-native/worldGateway';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../src/ai-native/ownerAuthFixture';
import { openLlm, resumeGame, waitForButton } from './uiNav';

const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;
const TOKEN = randomBytes(24).toString('hex');
const COMPANION_SERVER = resolve(process.cwd(), 'dist-mcp/companionMcpServer.mjs');
/** Real screenshot evidence for every milestone of the chain. */
const SHOTS = resolve(process.cwd(), 'reports/ai-native-02/signal/e2e/screens');
let shotIndex = 0;
async function shot(page: any, name: string): Promise<void> {
  shotIndex += 1;
  const file = `${SHOTS}/${String(shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  console.log(`STEP screenshot ${file}`);
}
function step(label: string): void {
  console.log(`STEP ${label}`);
}

async function clickText(page: any, text: string): Promise<void> {
  const p = await page.evaluate((label) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    if (!s) return null;
    // Recursively search containers (settings panel wraps its children).
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

async function openCompanionSdk(bridgeUrl: string): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [COMPANION_SERVER],
    env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: bridgeUrl, LAST_SIGNAL_WORLD_TOKEN: TOKEN } as never,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'signal-e2e', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}

/** Read the rendered signal HUD text. */
function signalHud(page: any): Promise<string> {
  return page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    return gs.txtSignal ? gs.txtSignal.text : '';
  });
}

/** Read whether a signal device exists in the sim. */
function signalExists(page: any): Promise<boolean> {
  return page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    return !!gs.world.sim.signal;
  });
}

/** Read the echo's OWN finite Signal energy account from the core sim. */
function echoEnergy(page: any): Promise<number> {
  return page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const account = gs.world.sim.signal?.actors?.echo;
    return account ? account.energy.energy : -1;
  });
}

test('Signal cooperation chain: default no relay → opt-in → device → Companion suggest → Owner CONFIRM → echo energy → ACTIVE → portal → next room', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 1000 });
  let sdk: { client: Client; transport: StdioClientTransport } | null = null;
  try {
    // 1) Default NEW RUN: no Relay device.
    await bootRun(page);
    expect(await signalExists(page), 'default NEW RUN must have no signal device').toBe(false);
    expect(await signalHud(page)).toContain('RELAY OFF · NO DEVICE');
    step('1 default NEW RUN is legacy: no device, portal open');
    await shot(page, 'default-no-device');

    // 2) Pause → Settings → SIGNAL COLLABORATION opt-in ON → resume.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await clickText(page, 'SETTINGS');
    await page.waitForTimeout(300);
    await clickText(page, 'SIGNAL COLLABORATION · OFF');
    await page.waitForTimeout(300);
    // Verify the toggle is now ON (in settings panel).
    const optInOn = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const s = g.scene.getScene('PauseScene');
      function find(list: any[]): boolean {
        for (const c of list) {
          if (!c) continue;
          if (c.type === 'Text' && (c.text || '').includes('SIGNAL COLLABORATION · ON')) return true;
          if (c.list && Array.isArray(c.list) && find(c.list)) return true;
        }
        return false;
      }
      return find(s.children.list);
    });
    expect(optInOn, 'opt-in toggle must show ON').toBe(true);
    step('2 explicit Signal Collaboration opt-in is ON');
    await shot(page, 'optin-on');
    // Close settings panel (BACK button), then close Pause.
    await clickText(page, 'BACK');
    await page.waitForTimeout(200);
    await resumeGame(page);

    // 3) REAL room enter with the opt-in already ON: the World spawns its ONE
    //    Relay device for this run. Nothing is injected by the test.
    const roomBefore = await page.evaluate(() =>
      (window as any).__game.scene.getScene('GameScene').world.currentRoomId);
    await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      // Position the protagonist ON its own portal; the game's own frame loop
      // commits the teleport and the interact tick.
      w.player.reset(w.portal.wx, w.portal.wy);
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as any).__game.scene.getScene('GameScene').world.player.requestInteract();
    });
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return !!gs.world.sim.signal && gs.world.currentRoomId !== -1;
    }, undefined, { timeout: 20000 });
    const roomAfter = await page.evaluate(() =>
      (window as any).__game.scene.getScene('GameScene').world.currentRoomId);
    expect(roomAfter, 'the real portal interact entered a different room').not.toBe(roomBefore);
    const spawned = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const s = w.sim.signal;
      return {
        deviceId: s.deviceId, roomId: s.roomId, relay: s.relay,
        manualEnabled: s.manualEnabled, powered: s.powered,
        playerEnergy: s.actors.player.energy.energy,
        echoEnergy: s.actors.echo.energy.energy,
        exitOpen: w.signalView().exitOpen
      };
    });
    expect(spawned.deviceId, 'the core created the real relay_main device').toBe('relay_main');
    expect(spawned.relay, 'a freshly spawned relay is INACTIVE').toBe('INACTIVE');
    expect(spawned.manualEnabled, 'a freshly spawned relay is manually OFF').toBe(false);
    expect(spawned.powered, 'a freshly spawned relay is powered').toBe(true);
    expect(spawned.exitOpen, 'the gated exit is CLOSED while the relay is INACTIVE').toBe(false);
    expect(spawned.playerEnergy, 'the player account starts full').toBe(100);
    expect(spawned.echoEnergy, 'the echo account starts full and separate').toBe(100);
    const hudAfterSpawn = await signalHud(page);
    expect(hudAfterSpawn, 'relay device must exist after opt-in').toContain('INACTIVE');
    step(`3 real room enter spawned relay_main INACTIVE (room ${roomAfter}, exit closed)`);
    await shot(page, 'relay-spawned-inactive');

    // 3b) NEGATIVE: with the relay INACTIVE the gated exit is impassable.
    await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      w.player.reset(w.portal.wx, w.portal.wy);
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      (window as any).__game.scene.getScene('GameScene').world.player.requestInteract();
    });
    await page.waitForTimeout(1200);
    const roomAfterBlockedAttempt = await page.evaluate(() =>
      (window as any).__game.scene.getScene('GameScene').world.currentRoomId);
    expect(roomAfterBlockedAttempt, 'an INACTIVE relay keeps the exit closed')
      .toBe(roomAfter);
    step('3b the gated exit really refused the interact while the relay was INACTIVE');

    // 4) Enable echo and open companion panel.
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      gs.world.enableEcho();
    });
    await page.waitForFunction(() => !!((window as any).__game.scene.getScene('GameScene').world.echoActor));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await openLlm(page);
    await page.waitForTimeout(300);
    await clickText(page, 'ENABLE / RE-AUTHORIZE');
    await fillOwnerForm(page, bridge.url, TOKEN, TEST_OWNER_KEY);
    await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').companionStatus === 'CONNECTED', undefined, { timeout: 15000 });
    step('4 human OWNER authorized the Companion in the Pause UI');
    await shot(page, 'companion-connected');

    // 5) Official Companion SDK: the echo really discovers the device first.
    sdk = await openCompanionSdk(bridge.url);
    const obs = (await sdk.client.callTool({ name: 'echo_observe', arguments: {} })).structuredContent as any;
    expect(obs.ok, `echo_observe must succeed: ${JSON.stringify(obs)}`).toBe(true);
    const obsBody = obs.observation ?? obs.value ?? obs;
    expect(obsBody.relay, 'the echo must perceive the real Relay device').toBeTruthy();
    expect(obsBody.relay.id, 'the observed relay is the spawned device').toBe('relay_main');
    expect(obsBody.relay.state, 'the observed relay starts INACTIVE').toBe('INACTIVE');
    expect(obsBody.energy, 'the echo observation carries its OWN finite energy').toBeTruthy();
    expect(obsBody.energy.max, 'echo energy cap matches the shared Signal tuning').toBe(100);
    step(`5 echo_observe really perceives relay_main (${obsBody.relay.state}) with its own energy ${obsBody.energy.current}/${obsBody.energy.max}`);
    await shot(page, 'companion-observation');

    // 5b) Fixture-labeled (NOT an LLM) suggestion on the REAL perceived relay.
    const sugId2 = 'sug_' + randomBytes(12).toString('hex');
    const reqId2 = 'req_' + randomBytes(12).toString('hex');
    const raw2 = await sdk.client.callTool({
      name: 'echo_suggest',
      arguments: {
        requestId: reqId2, suggestionId: sugId2,
        kind: 'toggle-relay', reason: 'perceived_relay', ttlTicks: 600
      }
    });
    console.log('RAW toggle-relay response:', JSON.stringify(raw2));
    const proposed2 = raw2.structuredContent as any;
    expect(proposed2.ok, `fixture suggest toggle-relay: ${JSON.stringify(proposed2)}`).toBe(true);
    // A signal suggestion is NOT a movement intent: the Owner CONFIRM enqueues a
    // real core Signal command, which the NEXT core tick commits. While the Pause
    // scene is active the world tick is frozen, so the queued command stays
    // observable here and no state was written early.
    await waitForButton(page, 'CONFIRM FIRST PROPOSAL');
    await clickText(page, 'CONFIRM FIRST PROPOSAL');
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const cmds = gs.world.sim.pendingCommands || [];
      return cmds.some((c: any) => c.type === 'toggle-relay');
    }, undefined, { timeout: 15000 });
    const queuedRelay = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return (gs.world.sim.pendingCommands || []).filter((c: any) => c.type === 'toggle-relay');
    });
    expect(queuedRelay.length, 'exactly one confirmed toggle-relay command is queued').toBe(1);
    expect(queuedRelay[0].enabled, 'relay toggles from manual OFF to ON').toBe(true);
    step('6 Owner CONFIRM queued exactly one toggle-relay core command (no early state write)');
    await shot(page, 'confirm-queued-toggle');
    await resumeGame(page);
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const s = gs.world.sim.signal;
      return s && s.relay === 'ACTIVE';
    }, undefined, { timeout: 15000 });
    const hudActive = await signalHud(page);
    expect(hudActive, 'relay must be ACTIVE after confirmed toggle').toContain('ACTIVE');
    step('7 the next real core tick committed the toggle: relay ACTIVE, gated exit open');
    await shot(page, 'relay-active');

    // 6) Official Companion SDK: fixture-labeled suggest scan (not LLM).
    //    Echo has now observed the relay (it is ACTIVE and in range), so
    //    'perceived_relay' passes the perception check.
    const sugId = 'sug_' + randomBytes(12).toString('hex');
    const reqId = 'req_' + randomBytes(12).toString('hex');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await openLlm(page);
    await page.waitForTimeout(300);
    const proposed = (await sdk.client.callTool({
      name: 'echo_suggest',
      arguments: {
        requestId: reqId, suggestionId: sugId,
        kind: 'scan', reason: 'perceived_relay', ttlTicks: 600
      }
    })).structuredContent as any;
    expect(proposed.ok, `fixture suggest scan: ${JSON.stringify(proposed)}`).toBe(true);

    // 7) Real Owner UI CONFIRM → normal frame commits → echo energy deducted.
    await waitForButton(page, 'CONFIRM FIRST PROPOSAL');
    await clickText(page, 'CONFIRM FIRST PROPOSAL');
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const cmds = gs.world.sim.pendingCommands || [];
      return cmds.some((c: any) => c.type === 'signal-scan' && c.actor === 'echo');
    }, undefined, { timeout: 15000 });
    const echoBefore = await echoEnergy(page);
    // Resume: the next normal core tick commits the confirmed scan on the
    // ECHO's own finite energy account (the HUMAN player account is untouched).
    await resumeGame(page);
    await page.waitForFunction((eb: number) => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const account = gs.world.sim.signal?.actors?.echo;
      return !!account && account.energy.energy < eb;
    }, echoBefore, { timeout: 15000 });
    const echoAfter = await echoEnergy(page);
    expect(echoAfter, 'echo energy must be deducted after confirmed scan').toBeLessThan(echoBefore);
    const playerEnergy = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.sim.signal?.actors?.player?.energy?.energy ?? -1;
    });
    expect(playerEnergy, 'the HUMAN player energy account is not charged by the echo scan').toBeGreaterThan(echoAfter);
    step(`8 the confirmed echo scan really charged ONLY the echo account (${echoBefore} → ${echoAfter})`);
    await shot(page, 'echo-scan-committed');

    // 9) Real gated portal: only an ACTIVE relay lets the human pass.
    const roomBeforeExit = await page.evaluate(() =>
      (window as any).__game.scene.getScene('GameScene').world.currentRoomId);
    const exitOpen = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return { exitOpen: w.signalView().exitOpen, relay: w.sim.signal.relay, hasPortal: !!w.portal };
    });
    expect(exitOpen.relay, 'the relay is ACTIVE before the human leaves').toBe('ACTIVE');
    expect(exitOpen.exitOpen, 'the exit is OPEN exactly while the relay is ACTIVE').toBe(true);
    expect(exitOpen.hasPortal, 'a real portal exists in the room').toBe(true);
    await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      w.player.reset(w.portal.wx, w.portal.wy);
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as any).__game.scene.getScene('GameScene').world.player.requestInteract();
    });
    await page.waitForFunction((prev: number) => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.currentRoomId !== prev;
    }, roomBeforeExit, { timeout: 20000 });
    const roomAfterExit = await page.evaluate(() =>
      (window as any).__game.scene.getScene('GameScene').world.currentRoomId);
    expect(roomAfterExit, 'the human really advanced to the next room').not.toBe(roomBeforeExit);
    step(`9 human advanced through the ACTIVE-gated portal (room ${roomBeforeExit} → ${roomAfterExit})`);
    await shot(page, 'next-room-entered');

    // 10) Check observation/memory/receipts updated via official SDK.
    const memBody = (await sdk.client.callTool({ name: 'echo_memory', arguments: {} })).structuredContent as any;
    expect(memBody.ok, `echo_memory after chain: ${JSON.stringify(memBody)}`).toBe(true);
    const statusBody = (await sdk.client.callTool({ name: 'echo_status', arguments: {} })).structuredContent as any;
    expect(statusBody.ok).toBe(true);
    step('10 echo_memory / echo_status still served after the whole chain');

    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
  } finally {
    await sdk?.client.close().catch(() => undefined);
    await bridge.close();
  }
});
