// Independent reviewer probe: core player bullets vs legacy enemy kinds / Boss (frozen 4cf1bc8).
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5345);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__game.scene.start('GameScene', { seed: 424242 }));
await page.waitForTimeout(1200);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const result = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const p = w.player;
  const room = w.currentRoom();
  const findSpot = (dx) => {
    for (const d of [dx, -dx]) {
      const x = p.wx + d, y = p.wy;
      if (w.isWalkable(x, y, 0.5)) return { x, y };
    }
    return { x: p.wx, y: p.wy + dx };
  };
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const fireAt = (target) => ({ move: { x: 0, y: 0 }, dash: false, fire: true, aim: target, interact: false });

  const spot = findSpot(3);
  const drone = w.spawnEnemy('drone', spot.x, spot.y, room.id, 1);
  const hunter = w.spawnEnemy('hunter', spot.x, spot.y, room.id, 1);
  const stalker = w.spawnEnemy('stalker', spot.x, spot.y, room.id, 1);
  const droneHp0 = drone._hp, hunterHp0 = hunter._hp, stalkerHp0 = stalker._hp;
  // Run the NORMAL World.stepFrame path (one fixed tick per call) with fire intent.
  w.resetSimulationAccumulator();
  for (let i = 0; i < 180; i++) w.stepFrame(1000 / 60, fireAt(spot));
  const droneHp1 = drone._hp, hunterHp1 = hunter._hp, stalkerHp1 = stalker._hp;

  // Boss: spawn and aim at it.
  w.spawnBoss(w.map.rooms[room.id]);
  const boss = w.boss;
  boss.wx = spot.x; boss.wy = spot.y;
  boss.attackTimer = 999;
  const bossHp0 = boss._hp;
  w.resetSimulationAccumulator();
  for (let i = 0; i < 180; i++) w.stepFrame(1000 / 60, fireAt({ x: boss.wx, y: boss.wy }));
  const bossHp1 = boss._hp;

  return {
    paused: gs.paused,
    spot,
    drone: { before: droneHp0, after: droneHp1, inWorld: w.enemies.some((e) => e._id === drone._id) },
    hunter: { before: hunterHp0, after: hunterHp1, inWorld: w.enemies.some((e) => e._id === hunter._id) },
    stalker: { before: stalkerHp0, after: stalkerHp1, inWorld: w.enemies.some((e) => e._id === stalker._id) },
    boss: { before: bossHp0, after: bossHp1 },
    coreProjectilesLeft: w.sim.projectiles.length,
    coreDrones: w.sim.drones.length,
  };
});
console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
await browser.close();
