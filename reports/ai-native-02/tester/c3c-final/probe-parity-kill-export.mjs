// Regenerate Rendered parity data that includes a REAL kill and REAL loot pickup,
// then export initial/sequence/rendered for the same-core headless replay.
// Fixture disclosure: a single real drone is spawned through World.spawnEnemy so the
// fixed intent sequence has a deterministic encounter (same approach as the shipped
// parity spec). Combat itself runs through the rendered World's real core ticks.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3c-final/parity-kill';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5312/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.evaluate(() => localStorage.removeItem('lastSignal.save.v1'));
await page.waitForTimeout(500);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(500);

const result = await page.evaluate(async () => {
  const mod = await import('/src/world/sim/core.ts');
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const p = { x: w.player.wx, y: w.player.wy };
  let target = null;
  for (const dx of [2, 2.5, 3]) {
    const x = p.x + dx, y = p.y;
    if (w.isWalkable(x, y, 0.5)) { target = { x, y }; break; }
  }
  if (!target) target = { x: p.x + 2, y: p.y };
  w.spawnEnemy('drone', target.x, target.y, w.currentRoom()?.id ?? 0, 1);
  const initial = JSON.parse(JSON.stringify(w.sim));
  const drone = initial.drones[0];
  const aim = drone ? { x: drone.x, y: drone.y } : target;
  const dummy = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const sequence = [
    { ticks: 8, intent: { ...dummy, move: { x: 1, y: 0 } } },
    { ticks: 1, intent: { ...dummy, fire: true, aim } },
    { ticks: 90, intent: { ...dummy, fire: true, aim } },
    { ticks: 30, intent: dummy },
    { ticks: 16, intent: { ...dummy, move: { x: 1, y: 0 } } },
    { ticks: 20, intent: dummy }
  ];
  const events = [];
  w.resetSimulationAccumulator();
  for (const step of sequence) {
    for (let i = 0; i < step.ticks; i += 1) events.push(...w.stepFrame(1000 / 60 + 1e-6, step.intent));
  }
  return {
    initial, sequence,
    canonical: mod.canonicalSimulationState(w.sim),
    events: mod.canonicalSimulationEvents(events),
    eventTypes: [...new Set(events.map((e) => e.type))],
    finalTick: w.sim.tick,
    dronesLeft: w.sim.drones.length,
    projectilesLeft: w.sim.projectiles.length,
    lootLeft: w.sim.loot.length,
    kills: events.filter((e) => e.type === 'enemy-died').length,
    lootCollected: events.filter((e) => e.type === 'loot-collected').length
  };
});
writeFileSync(OUT + '/initial.json', JSON.stringify(result.initial, null, 2));
writeFileSync(OUT + '/sequence.json', JSON.stringify(result.sequence, null, 2));
writeFileSync(OUT + '/rendered.json', JSON.stringify({ canonical: result.canonical, events: result.events, eventTypes: result.eventTypes, finalTick: result.finalTick, dronesLeft: result.dronesLeft, projectilesLeft: result.projectilesLeft }, null, 2));
console.log(JSON.stringify({ eventTypes: result.eventTypes, finalTick: result.finalTick, dronesLeft: result.dronesLeft, lootLeft: result.lootLeft, kills: result.kills, lootCollected: result.lootCollected, pageErrors: errors }, null, 2));
await browser.close();
if (result.kills < 1 || result.lootCollected < 1) process.exit(2);
