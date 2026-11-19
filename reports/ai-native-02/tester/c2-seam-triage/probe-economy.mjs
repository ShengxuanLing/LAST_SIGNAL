// Triage probe: economy.spec.ts:11 — supply terminal visibility / cleared-room condition,
// and whether the room-clear payout survives when the payout is queued (not committed).
// Read-only observation; no state writes beyond the test's own flow.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5291/';
const out = { meta: { url: BASE, target: '5f49b24', case: 'economy.spec.ts:11' }, steps: [], findings: [] };
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
const afterFlow = await page.evaluate(() => {
  const { world } = (window).__game.scene.getScene('GameScene');
  const live = world.simFixture;
  const before = { currency: world.player.data.currency, pending: live.pendingCommands.map((c) => c.type), tick: live.tick, paused: world.scene.paused };
  world.player.reset(world.portal.wx, world.portal.wy);
  world.resetSimulationAccumulator();
  world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  world.tryInteract(world.player);
  world.resetSimulationAccumulator();
  world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  world.resetSimulationAccumulator();
  world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  const live2 = world.simFixture;
  const rooms = world.map.rooms.map((r) => ({ id: r.id, kind: r.kind, spawned: r.spawned, cleared: r.cleared }));
  const aliveEnemies = world.enemies.filter((e) => e.alive).length;
  return {
    before,
    after: { currency: world.player.data.currency, pending: live2.pendingCommands.map((c) => c.type), tick: live2.tick, paused: world.scene.paused },
    room: world.currentRoom()?.kind ?? null, rooms, aliveEnemies,
    hasProcessPendingCommands: typeof world.processPendingCommands === 'function'
  };
});
out.steps.push({ name: 'after-test-flow', detail: afterFlow });
const hintText = await page.textContent('body');
const dialogVisible = await page.evaluate(() => {
  const d = document.querySelector('dialog');
  return !!d && d.open;
});
out.steps.push({ name: 'ui-state', detail: { dialogVisible, hasSupplyHint: /Supply terminal/.test(hintText || '') } });
// wait for the hint / terminal to become available
const wait = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) {
    const d = document.querySelector('dialog');
    const body = document.body.innerText;
    if (d && d.open) return { opened: true, afterMs: i * 100 };
    if (/Supply terminal/.test(body)) return { hintVisible: true, afterMs: i * 100 };
    await sleep(100);
  }
  return { opened: false, hintVisible: /Supply terminal/.test(document.body.innerText), afterMs: 4000 };
});
out.steps.push({ name: 'wait-4s', detail: wait });
out.findings.push({
  name: 'economy-supply-terminal-requires-cleared-room-and-no-alive-enemies',
  detail: {
    afterFlow,
    note: 'economy safeRoom() requires: room cleared, no alive enemies, and NO spawned-but-uncleared room in the whole map. The test flow only advances the player through the portal and commits room-enter; remaining rooms stay spawned&&!cleared, so the terminal never opens.'
  }
});
out.errors = errors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-seam-triage/triage-economy.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
