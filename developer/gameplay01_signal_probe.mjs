// GAMEPLAY-01 P0 — read-only Signal mechanism probe (NOT human acceptance).
// It drives the REAL rendered World through its production commands
// (opt-in save flag -> device spawn -> player scan/jam/toggle -> relay/exit)
// and reads only public state. Fixture: the save flag is pre-seeded and the
// probe waits on the live game loop; no src/tests are modified.
//
// Evidence: reports/gameplay-01/developer/signal-probe.{log,json,png}
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5188';
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve('reports/gameplay-01/developer');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const signal = () => page.evaluate(() => {
  const g = window.__game;
  const w = g.scene.getScene('GameScene').world;
  const s = w.signalView();
  return { exists: !!s, ...(s ?? {}) };
});

try {
  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('last_signal_save_v1', JSON.stringify({ version: 2, permanent: { signalCollaborationOptIn: true } }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(500);
  const newRun = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MainMenuScene');
    const t = s.children.list.find((c) => c.type === 'Text' && String(c.text || '').trim().startsWith('NEW RUN'));
    return t ? { x: t.x, y: t.y } : null;
  });
  if (!newRun) throw new Error('NEW RUN not found');
  await page.mouse.click(newRun.x, newRun.y);
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(1200);

  const s0 = await signal();
  say(`STEP 1 device spawned from the real opt-in save: ${s0.exists ? 'YES' : 'NO'} relay=${s0.relay} exitOpen=${s0.exitOpen} energy=${s0.playerEnergy} evidence=${s0.evidence}`);

  // SCAN (player's own finite account; empty scan still costs 10).
  const scanned = await page.evaluate(() => window.__game.scene.getScene('GameScene').world.playerSignalScan());
  await page.waitForFunction(() => {
    const s = window.__game.scene.getScene('GameScene').world.signalView();
    return s && s.playerEnergy === 90;
  }, undefined, { timeout: 8000 });
  const s1 = await signal();
  say(`STEP 2 scan committed: enqueued=${scanned} energy=${s1.playerEnergy} cooldown=${s1.playerScanCD} evidence=${s1.evidence}`);

  // JAM (player) — suppresses the relay; never a manual toggle.
  const jammed = await page.evaluate(() => window.__game.scene.getScene('GameScene').world.playerSignalJam());
  await page.waitForFunction(() => {
    const s = window.__game.scene.getScene('GameScene').world.signalView();
    return s && s.relay === 'JAMMED';
  }, undefined, { timeout: 8000 });
  const s2 = await signal();
  say(`STEP 3 jam committed: enqueued=${jammed} energy=${s2.playerEnergy} relay=${s2.relay} exitOpen=${s2.exitOpen} manual=${s2.manualEnabled}`);

  // OWNER manual toggle while JAMMED: manual becomes true, relay stays JAMMED.
  const toggled = await page.evaluate(() => window.__game.scene.getScene('GameScene').world.toggleRelay(true));
  await page.waitForFunction(() => {
    const s = window.__game.scene.getScene('GameScene').world.signalView();
    return s && s.manualEnabled === true && s.relay === 'JAMMED';
  }, undefined, { timeout: 8000 });
  const s3 = await signal();
  say(`STEP 4 manual toggle while jammed: enqueued=${toggled} relay=${s3.relay} manual=${s3.manualEnabled} exitOpen=${s3.exitOpen}`);

  // JAM expiry (360 ticks) -> manual+powered => ACTIVE -> exit gate open.
  await page.waitForFunction(() => {
    const s = window.__game.scene.getScene('GameScene').world.signalView();
    return s && s.relay === 'ACTIVE' && s.exitOpen === true;
  }, undefined, { timeout: 15000 });
  const s4 = await signal();
  say(`STEP 5 jam expired -> ACTIVE: relay=${s4.relay} manual=${s4.manualEnabled} powered=${s4.powered} exitOpen=${s4.exitOpen}`);

  // The human/echo accounts are independent (echo untouched by the player's spend).
  say(`STEP 6 independent accounts: playerEnergy=${s4.playerEnergy} echoEnergy=${s4.echoEnergy} playerJamCD=${s4.playerJamCD}`);
  say(`ERRORS: ${errors.length === 0 ? 'none' : errors.slice(0, 3).join(' | ')}`);
  await page.screenshot({ path: path.join(OUT, 'signal-probe.png') });

  const ok = s0.exists && s0.exitOpen === false && s1.playerEnergy === 90 && s1.evidence > 0 &&
    s2.relay === 'JAMMED' && s2.exitOpen === false && s3.relay === 'JAMMED' && s3.manualEnabled === true &&
    s4.relay === 'ACTIVE' && s4.exitOpen === true && errors.length === 0;
  say(`RESULT: ${ok ? 'PASS' : 'FAIL'} (scripted fixture, not human acceptance)`);
  fs.writeFileSync(path.join(OUT, 'signal-probe.json'), JSON.stringify({ ok, s0, s1, s2, s3, s4, errors }, null, 2));
  fs.writeFileSync(path.join(OUT, 'signal-probe.log'), lines.join('\n') + '\n');
  process.exit(ok ? 0 : 1);
} catch (e) {
  say(`ERROR: ${String(e).split('\n')[0]}`);
  say(`ERRORS: ${errors.slice(0, 3).join(' | ')}`);
  fs.writeFileSync(path.join(OUT, 'signal-probe.log'), lines.join('\n') + '\n');
  await browser.close();
  process.exit(1);
}
await browser.close();
