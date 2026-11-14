// AI-NATIVE-02 C3-b fix — REAL subprocess hard-disconnect E2E.
//
// A separate official MCP server process holds the independent Agent lease.
// It is SIGKILLed (no cleanup possible). Within a bounded deadline the bridge
// must expire the lease, cancel pending/executing actions, bump the epoch and
// force the rendered game to HUMAN / LOST. No automatic re-attach. A fresh
// HUMAN authorization must then create a usable new session.
//
// This is an interface/lifecycle test, NOT an LLM playthrough and NOT a claim
// that a real Agent fight happened.

import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { WorldGateway } from '../src/ai-native/worldGateway';
import { WorldClient } from '../src/ai-native/worldClient';
import { writeSecureTokenFile, deleteSecureTokenFile } from '../src/ai-native/secureTokenFile';

const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;
const WORLD_SERVER = resolve(process.cwd(), 'dist-mcp/worldMcpServer.mjs');
const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;

async function bootAndAuthorize(page: Page, bridgeUrl: string, token: string): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  await page.evaluate(({ bridgeUrl: url, token: t }) => {
    (window as any).__externalLinkConfig = { bridgeUrl: url, token: t };
  }, { bridgeUrl, token });
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
  await authorizeViaMenu(page, bridgeUrl, token);
}

async function authorizeViaMenu(page: Page, bridgeUrl?: string, token?: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
  if (bridgeUrl && token) {
    // The page-level config is cleared whenever the link degrades (incl. the
    // pause that opens this menu). Inject AFTER the menu is open.
    await page.evaluate(({ bridgeUrl: url, token: t }) => {
      (window as any).__externalLinkConfig = { bridgeUrl: url, token: t };
    }, { bridgeUrl, token });
  }
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

async function linkState(page: Page): Promise<any> {
  return page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return {
      owner: w.player.control.owner,
      status: w.externalLink.snapshot().status,
      session: w.externalLink.snapshot().session,
      epoch: w.externalLink.snapshot().epoch,
      hasActive: w.externalLink.hasActive,
      pending: w.externalLink.pendingCount
    };
  });
}

function hardKill(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
    return;
  } catch { /* fall through */ }
  if (process.platform === 'win32') {
    try {
      execFileSync(process.env.SystemRoot + '\\System32\\taskkill.exe', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    } catch { /* already gone */ }
  }
}

test('SIGKILL of the agent process expires the lease, yields the link and forbids auto re-attach', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const token = randomBytes(24).toString('hex');
  const tokenFile = await writeSecureTokenFile(token);
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token, allowedOrigins: [ORIGIN] });
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;
  try {
    await bootAndAuthorize(page, bridge.url, token);

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
    client = new Client({ name: 'c3b-hard-disconnect', version: '0.0.0' });
    await client.connect(transport);
    const listed = await client.callTool({ name: 'world_list_sessions', arguments: {} });
    const listedPayload = listed.structuredContent as { ok?: boolean; session?: string; epoch?: number; attached?: boolean };
    expect(listedPayload.ok, 'agent attached').toBe(true);
    expect(listedPayload.attached).toBe(true);
    const session = listedPayload.session as string;

    // A long-tick action is running when the process is hard-killed.
    const action = await client.callTool({
      name: 'world_action',
      arguments: {
        requestId: rid(1),
        actions: [{ type: 'move', actionId: aid(1), dir: { x: 1, y: 0 }, ticks: 120 }],
        ttlTicks: 600
      }
    });
    const actionPayload = action.structuredContent as { ok?: boolean; actions?: Array<{ status: string }> };
    expect(actionPayload.ok, 'action accepted').toBe(true);
    await expect.poll(async () => linkState(page), { timeout: 20000 })
      .toMatchObject({ owner: 'external' });
    await expect.poll(async () => page.evaluate((id) =>
      (window as any).__game.scene.getScene('GameScene').world.externalLink.receipt(id)?.status ?? 'none', aid(1)),
      { timeout: 20000 }).toBe('executing');

    const before = await linkState(page);
    const pid = (transport as unknown as { pid?: number }).pid;
    expect(pid, 'child process pid is known').toBeGreaterThan(0);
    hardKill(pid!);

    // Bounded deadline: the independent Agent lease must expire without any
    // cleanup from the killed process.
    await expect.poll(async () => linkState(page), { timeout: 15000 }).toMatchObject({ owner: 'human' });
    const after = await linkState(page);
    expect(after.status, 'link is no longer CONNECTED').not.toBe('CONNECTED');
    expect(after.hasActive, 'no executing action left').toBe(false);
    expect(after.pending, 'no pending actions left').toBe(0);

    // Old epoch / session is rejected by the bridge.
    const stale = await fetch(`${bridge.url}/world-link/action-submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        session, epoch: before.epoch, requestId: rid(2),
        actions: [{ type: 'stop', actionId: aid(2) }]
      })
    });
    expect(stale.ok, 'old epoch must be rejected').toBe(false);
    expect(stale.status).toBeGreaterThanOrEqual(400);

    // No automatic re-attach.
    await page.waitForTimeout(1500);
    expect((await linkState(page)).owner).toBe('human');

    // A fresh HUMAN authorization creates a usable new session.
    await authorizeViaMenu(page, bridge.url, token);
    const renewed = await linkState(page);
    expect(renewed.owner).toBe('external');
    expect(renewed.session).toBeTruthy();
    expect(renewed.session).not.toBe(session);
    const fresh = new WorldClient({ bridgeUrl: bridge.url, token });
    expect((await fresh.handshake()).ok, 'new session is attachable').toBe(true);
    await fresh.close();
    expect(errors).toEqual([]);
  } finally {
    try { await client?.close(); } catch { /* the child may already be dead */ }
    await bridge.close();
    await deleteSecureTokenFile(tokenFile);
  }
});
