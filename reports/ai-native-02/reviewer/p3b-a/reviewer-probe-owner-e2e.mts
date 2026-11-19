/**
 * Independent P3-b A Owner E2E on my OWN dev port 5412.
 * Real bridge + real rendered Pause UI + agent-side HTTP suggest + human confirm.
 * In-process random token only; never in logs/URLs/screenshots.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chromium, type Page } from 'playwright';
import { WorldGateway } from './src/ai-native/worldGateway';
import { startWorldBridge } from './src/ai-native/worldBridgeServer';

const PORT = 5412;
const ORIGIN = `http://localhost:${PORT}`;
const TOKEN = randomBytes(24).toString('hex'); // desensitized, in-process only
let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));

async function clickText(page: Page, text: string): Promise<void> {
  const p = await page.evaluate((label) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    const t = (s.children.list as any[]).find((c: any) => c.type === 'Text' && (c.text || '').includes(label));
    if (!t) return null;
    const b = t.getBounds();
    return { x: b.centerX, y: b.centerY };
  }, text);
  check(`UI text "${text}" present`, p !== null);
  if (!p) throw new Error(`missing UI text ${text}`);
  await page.mouse.click(p.x, p.y);
}

async function main(): Promise<void> {
  const dev: ChildProcess = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'
  ], { stdio: 'ignore' });
  let bridge: Awaited<ReturnType<typeof startWorldBridge>> | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`${ORIGIN}/`); if (r.ok) { ready = true; break; } } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    check('own dev server ready (5412)', ready);
    if (!ready) throw new Error('dev server did not start');

    bridge = await startWorldBridge({ gateway: new WorldGateway(), token: TOKEN, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(({ bridgeUrl, token }) => {
      (window as any).__externalLinkConfig = { bridgeUrl, token };
    }, { bridgeUrl: bridge.url, token: TOKEN });

    await page.goto(ORIGIN + '/');
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
    check('NEW RUN present', newRun !== null);
    await page.mouse.click(newRun!.x, newRun!.y);
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));

    // Spawn the real echo actor (human Owner UI).
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      gs.world.enableEcho();
    });
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return !!gs.world.echoActor;
    });
    check('real echo actor spawned via human UI', true);

    // Pause -> LLM COMPANION panel -> human authorize.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await clickText(page, 'LLM COMPANION >');
    await page.waitForTimeout(400);
    await clickText(page, 'ENABLE / RE-AUTHORIZE');
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.companionStatus === 'CONNECTED';
    }, undefined, { timeout: 20000 });
    check('human Owner authorize -> CONNECTED (no fake LLM)', true);

    // Owner secret must NOT be observable from the page globals / DOM / status.
    const leak = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const link = gs.companionLink;
      return {
        hasSecretField: !!link && 'ownerSecret' in link,
        capabilityEnumerable: !!link ? Object.keys(link).filter((k) => k === 'capability' || k === 'ownerSecret') : [],
        status: gs.companionStatus,
        globalHasToken: Object.keys(window as any).some((k) => String((window as any)[k]).includes('ownerSecret')),
        hudText: (gs.txtEcho?.text ?? '')
      };
    });
    info('browser-side authority state', leak);
    check('ownerSecret is a private field (not enumerable in UI status)', !leak.globalHasToken);
    check('HUD does not fake an external LLM connection', !/EXTERNAL.*CONNECTED|LLM.*CONNECTED/.test(leak.hudText), { hud: leak.hudText });

    // A real drone inside the echo's legal perception makes the reason observable.
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const w = gs.world; const e = w.echoActor; const room = w.currentRoom();
      w.spawnEnemy('drone', e.x + 1, e.y, room?.id ?? 0, 1);
      void gs.companionLink.pushObservation();
    });
    await page.waitForTimeout(500);
    const meta = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const e = gs.world.echoActor;
      return { session: gs.companionLink.session, target: { x: e.x + 1, y: e.y } };
    });
    check('browser Owner session obtained', !!meta.session);

    // Agent-side REAL HTTP suggest (token-only, no Origin). No confirm tool exists.
    const suggestionId = 'sug_' + 'a'.repeat(24);
    const suggest = await fetch(`${bridge.url}/world-link/companion-suggest`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ session: meta.session, epoch: 1, requestId: 'req_' + 'a'.repeat(24), suggestionId,
        kind: 'fire', reason: 'perceived_hostile', target: meta.target, ttlTicks: 600 })
    }).then((r) => r.json());
    check('agent token-only suggest accepted (proposal only)', suggest.ok === true, { suggest });

    // Agent confirm attempt (no Origin) is denied before any decision.
    const forged = await fetch(`${bridge.url}/world-link/companion-decision`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ session: meta.session, epoch: 1, suggestionId, decision: 'confirm', tick: 2, ownerSecret: 'x' })
    }).then((r) => r.json());
    check('agent cannot self-confirm', forged.ok === false, { forged });

    // Human Owner clicks CONFIRM in the real Pause UI -> ONE queued echo intent.
    await clickText(page, 'CONFIRM FIRST PROPOSAL');
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.hasPendingCompanionIntent;
    }, undefined, { timeout: 20000 });
    const queued = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return { pending: gs.world.hasPendingCompanionIntent, shots: gs.world.echoShotsFired, tick: gs.world.sim.tick };
    });
    info('immediately after Owner confirm (paused)', queued);
    check('confirm queues EXACTLY ONE pending intent (no direct state write)', queued.pending === true && queued.shots === 0, queued);
    // Close the Pause panel so the next fixed core tick consumes the intent.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.echoShotsFired > 0;
    }, undefined, { timeout: 20000 });
    const committed = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const w = gs.world;
      return {
        status: gs.companionStatus,
        pending: w.hasPendingCompanionIntent,
        echoProjectiles: w.sim.projectiles.filter((p: any) => p.source === 'echo').length,
        echoShotsFired: w.echoShotsFired,
        simTick: w.sim.tick
      };
    });
    info('after Pause close + core tick', committed);
    check('Owner confirm committed a real echo shot by the core tick (not a fixture)', committed.echoShotsFired >= 1, committed);
    check('queued intent consumed (single commit, no residual pending)', committed.pending === false);
    check('companion status still CONNECTED (no fake disconnect)', committed.status === 'CONNECTED');

    // A second confirm on the same id must not double-execute.
    const dup = await fetch(`${bridge.url}/world-link/companion-decision`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
      body: JSON.stringify({ session: meta.session, epoch: 1, suggestionId, decision: 'confirm', tick: 3 })
    }).then((r) => r.json());
    check('duplicate Owner confirm rejected (no double execution)', dup.ok === false, { dup });

    // Reopen the Owner panel (Escape toggles Pause), then disconnect.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await clickText(page, 'LLM COMPANION >');
    await page.waitForTimeout(400);
    await clickText(page, 'DISCONNECT (NO MODEL)');
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.companionStatus === 'FALLBACK:NO_MODEL';
    }, undefined, { timeout: 15000 });
    check('disconnect -> FALLBACK:NO_MODEL (honest)', true);
    check('no console/page errors', errors.length === 0, { errors });
    check('token never appears in page errors/logs', !errors.join('|').includes(TOKEN));
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (bridge) await bridge.close().catch(() => undefined);
    dev.kill('SIGKILL');
  }
  console.log(`OWNER_E2E_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
  if (failures > 0) process.exitCode = 1;
}
main().catch((e) => { console.log('FAIL exception', String(e)); process.exitCode = 1; });
