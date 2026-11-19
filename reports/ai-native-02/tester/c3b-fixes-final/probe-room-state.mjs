// quick state explorer (test build): what does room 3 look like after a portal transition?
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5303/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.waitForTimeout(600);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(800);
const r = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  w.player.reset(w.portal.wx, w.portal.wy);
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral);
  w.tryInteract(w.player);
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral);
  return { start: { room: w.sim.roomId, x: w.player.wx, y: w.player.wy, portal: w.portal } };
});
await page.waitForTimeout(2000);
const s = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const view = w.observationView();
  return {
    roomId: w.sim.roomId, player: { x: w.sim.player.x, y: w.sim.player.y }, hp: w.sim.player.data.hp,
    enemies: w.enemies.map((e) => ({ kind: e.kind, x: e.wx ?? e.sprite?.x, y: e.wy ?? e.sprite?.y })),
    drones: w.sim.drones.map((d) => ({ id: d.id, kind: d.data?.kind, x: d.x, y: d.y, hp: d.hp })),
    perceived: view.perceivedActors.map((a) => ({ id: a.id, kind: a.kind, x: a.x, y: a.y })),
    portal: w.portal, rooms: undefined
  };
});
console.log(JSON.stringify({ r, s }, null, 2));
await browser.close();
