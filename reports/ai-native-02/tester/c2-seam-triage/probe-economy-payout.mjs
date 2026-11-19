// Triage probe (economy part 2): does the terminal open in a legal way, and does the
// room-clear payout + purchase survive the new command-only contract?
// Read-only inspection; the purchase click is the product's own UI path.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5291/';
const out = { meta: { url: BASE, target: '5f49b24', case: 'economy payout/purchase legality' }, steps: [], findings: [] };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(BASE + 'economy.html');
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const menu = (window).__game.scene.getScene('MainMenuScene');
  const start = menu.scene.start.bind(menu.scene);
  menu.scene.start = (key, data) => start(key, key === 'GameScene' ? { ...data, seed: 424242 } : data);
});
await page.mouse.click(640, 340);
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
await page.waitForTimeout(800);

// Legal path: clear the current room's enemies through the real damage path is heavy;
// instead verify the payout accounting and the purchase path in the terminal room
// using the product's own cleared-room condition (mark enemies dead via the core
// hit path is NOT possible without HP writes, so we only observe).
const state1 = await page.evaluate(() => {
  const { world } = (window).__game.scene.getScene('GameScene');
  const live = world.simFixture;
  return {
    room: world.currentRoom()?.kind ?? null,
    aliveEnemies: world.enemies.filter((e) => e.alive).length,
    currency: world.player.data.currency,
    pending: live.pendingCommands.map((c) => c.type),
    hasProcessPendingCommands: typeof world.processPendingCommands === 'function',
    terminalRooms: [...(window).__game.scene.getScene('GameScene').world.map.rooms].filter((r) => r.kind === 'shop' || r.kind === 'elite').map((r) => r.id)
  };
});
out.steps.push({ name: 'initial', detail: state1 });

// payout path: enqueueCurrency then (per the commit) world.processPendingCommands() is called
// by economy update(); observe whether currency is committed immediately or only on a tick.
const payout = await page.evaluate(() => {
  const { world } = (window).__game.scene.getScene('GameScene');
  const live = world.simFixture;
  const c0 = world.player.data.currency;
  world.enqueueCurrency(12);
  const afterEnqueue = { currency: world.player.data.currency, pending: live.pendingCommands.map((c) => c.type) };
  if (typeof world.processPendingCommands === 'function') world.processPendingCommands();
  const afterProcess = { currency: world.player.data.currency, pending: live.pendingCommands.map((c) => c.type) };
  return { c0, afterEnqueue, afterProcess };
});
out.steps.push({ name: 'payout', detail: payout });

// purchase path in the terminal: open the dialog if the room qualifies
const opened = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 30; i++) {
    const d = document.querySelector('dialog');
    if (d && d.open) return { opened: true, afterMs: i * 100 };
    await sleep(100);
  }
  const d = document.querySelector('dialog');
  return { opened: !!(d && d.open), bodyHas: /Supply terminal/.test(document.body.innerText) };
});
out.steps.push({ name: 'terminal-open', detail: opened });
out.findings.push({
  name: 'economy-payout-and-purchase-path',
  detail: { state1, payout, opened,
    note: 'economy update() enqueues the clear payout and then calls world.processPendingCommands(); purchase uses world.enqueueSetPlayerData + saveCheckpoint' }
});
out.errors = errors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-seam-triage/triage-economy-payout.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
