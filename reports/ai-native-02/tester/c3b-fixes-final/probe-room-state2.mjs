import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5303/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.waitForTimeout(700);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(900);
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  w.player.reset(w.portal.wx, w.portal.wy);
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral);
  w.tryInteract(w.player);
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral);
});
await page.waitForTimeout(2500);
const dump = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const sim = w.sim;
  return {
    roomId: sim.roomId, tick: sim.tick, hp: sim.player.data.hp,
    simKeys: Object.keys(sim),
    drones: (sim.drones || []).map((d) => ({ id: d.id, hp: d.hp, x: d.x, y: d.y, kind: d.data?.kind })),
    targets: (sim.targets || []).map((t) => ({ id: t.id, kind: t.kind, hp: t.hp, x: t.x, y: t.y })),
    enemies: (w.enemies || []).map((e) => ({ kind: e.kind, wx: e.wx, wy: e.wy, hp: e.hp ?? e.data?.hp })),
    perceived: w.observationView().perceivedActors.map((a) => ({ id: a.id, kind: a.kind, x: a.x, y: a.y }))
  };
});
console.log(JSON.stringify(dump, null, 2));
await browser.close();
