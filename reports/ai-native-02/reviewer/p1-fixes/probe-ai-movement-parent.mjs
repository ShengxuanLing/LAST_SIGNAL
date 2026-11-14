// Independent reviewer diagnostic probe for P1 fixes (frozen snapshot 1aadd2e).
// Diagnostic only: fixed seed + a single invuln write (no HP/coord writes), no addXp/spawnEnemy.
// Measures AI action mix / moving intents / BLOCKED rate / bounded canWalk behavior.
import { chromium } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 5323);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await page.evaluate(() => {
  const g = window.__game;
  const menu = g.scene.getScene('MainMenuScene');
  const orig = menu.scene.start.bind(menu.scene);
  menu.scene.start = (key, data) => (key === 'GameScene' ? orig(key, { seed: 424242 }) : orig(key, data));
});
const box = await page.evaluate(() => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const click = async (lx, ly) => page.mouse.click(box.x + lx * box.w / 1280, box.y + ly * box.h / 720);
await click(640, 340);
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  gs.world.player.invuln = 1e9; // diagnostic: avoid combat death during sampling
});
await page.keyboard.press('Escape');
await page.waitForTimeout(550);
await click(640, 540);
await page.waitForTimeout(550);
await page.keyboard.press('Escape');
await page.waitForTimeout(900);

const samples = [];
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => {
    const g = window.__game;
    const gs = g.scene.getScene('GameScene');
    const w = gs.world;
    const pl = w.player;
    const snap = pl.control.snapshot();
    const intent = pl.lastIntent;
    const view = w.intentView();
    const obs = w.observationView();
    const active = g.scene.getScenes(true).map((s) => s.sys.settings.key);
    return {
      active,
      owner: snap.owner,
      action: snap.lastAiAction,
      move: intent.move,
      grid: { x: pl.wx, y: pl.wy },
      roomId: w.currentRoom()?.id ?? null,
      perceived: obs.visibleActors.length,
      nearProbe: view.canWalk(pl.wx + 0.4, pl.wy),
      farProbe: view.canWalk(pl.wx + 100, pl.wy + 100),
      walkable: w.isWalkable(pl.wx, pl.wy, 0.5),
      visibilityBasis: obs.visibilityBasis,
    };
  });
  samples.push(s);
}
const moving = samples.filter((s) => s.move.x !== 0 || s.move.y !== 0).length;
const blocked = samples.filter((s) => s.action === 'BLOCKED').length;
const actions = samples.reduce((acc, s) => { acc[s.action ?? 'null'] = (acc[s.action ?? 'null'] ?? 0) + 1; return acc; }, {});
let path = 0;
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1].grid, b = samples[i].grid;
  const step = Math.hypot(b.x - a.x, b.y - a.y);
  if (step < 3.2) path += step;
}
console.log(JSON.stringify({
  port: PORT, samples: samples.length, movingSamples: moving, blockedSamples: blocked,
  actions, pathLength: path, errors,
  first: samples[0], last: samples[samples.length - 1],
  allWalkable: samples.every((s) => s.walkable),
  allFarProbeRejected: samples.every((s) => s.farProbe === false),
  nearProbeTrueCount: samples.filter((s) => s.nearProbe).length,
  visibilityBasis: samples[0].visibilityBasis,
  actionTimeline: samples.map((s) => s.action),
}, null, 2));
await browser.close();
