// Bounded triage #2: economy:11 — is the room marked cleared in the SAME tick that
// its enemies are spawned? (updateRoom marks cleared when inRoom.length === 0, but the
// room-enter command spawns enemies on the NEXT tick.)
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5293/';
const out = { meta: { url: BASE, target: '59aa852' }, steps: [], findings: [] };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(BASE + 'economy.html');
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const m = (window).__game.scene.getScene('MainMenuScene');
  const o = m.scene.start.bind(m.scene);
  m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...d, seed: 424242 }) : o(k, d);
});
await page.mouse.click(640, 340);
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
await page.waitForTimeout(800);
const timeline = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const { world } = (window).__game.scene.getScene('GameScene');
  const snap = () => {
    const live = world.simFixture;
    return {
      tick: live.tick, room: world.currentRoom()?.id ?? null,
      rooms: world.map.rooms.map((r) => `${r.id}:${r.kind}:spawned=${r.spawned ? 1 : 0}:cleared=${r.cleared ? 1 : 0}`),
      aliveEnemies: world.enemies.filter((e) => e.alive).length,
      targets: live.targets.length, drones: live.drones.length,
      pending: live.pendingCommands.map((c) => c.type), currency: world.player.data.currency
    };
  };
  const steps = [];
  world.player.reset(world.portal.wx, world.portal.wy);
  world.resetSimulationAccumulator();
  world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  steps.push({ phase: 'after teleport tick', ...snap() });
  world.tryInteract(world.player);
  world.resetSimulationAccumulator();
  world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  steps.push({ phase: 'after room-enter tick', ...snap() });
  world.resetSimulationAccumulator();
  world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  steps.push({ phase: 'after spawn tick', ...snap() });
  for (let i = 0; i < 6; i++) { await sleep(200); steps.push({ phase: `wait ${i}`, ...snap() }); }
  return steps;
});
out.steps = timeline;
const clearedWithEnemies = timeline.some((t) => t.rooms.some((r) => /cleared=1/.test(r)) && t.aliveEnemies > 0);
out.findings.push({
  name: 'room-marked-cleared-in-the-tick-before-its-enemies-exist',
  evidence: { clearedWithEnemies, timeline },
  note: 'updateRoom() marks the room cleared when no live enemy of that room exists. The room-enter command spawns the enemies on the NEXT tick, so the room can be marked cleared in the very tick it is entered (before the enemies exist), then spawn enemies into an already-cleared room. economy safeRoom() then requires "no alive enemies" and fails for the opposite reason, and the "+12 credits · room cleared" payout fires for a room the player never cleared.'
});
out.errors = errors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-current-triage/triage-room-clear-order.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
