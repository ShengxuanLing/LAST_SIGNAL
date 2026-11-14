// Round-3 dev probe: Boss/non-drone spawn queue vs room-generation direct writes.
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5371);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__game.scene.start('GameScene', { seed: 424242 }));
await page.waitForTimeout(1200);
await page.keyboard.press('Escape');
await page.waitForTimeout(350);

const result = await page.evaluate(() => {
  const w = window.__game.scene.getScene('GameScene').world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const step = (i) => w.stepFrame(1000 / 60 + 1e-6, i);
  w.clearEnemiesForTest();
  w.resetSimulationAccumulator();
  const roomId = w.currentRoom().id;
  const bossRoom = w.map.rooms.find((r) => r.kind === 'boss');

  const before = {
    targets: w.simFixture.targets.length,
    drones: w.simFixture.drones.length,
    worldSpawns: w.worldSpawns.length
  };
  // Queue-based spawns (Boss + non-drone) should NOT mutate core until next tick.
  w.enqueueSpawnEnemy('hunter', w.playerX + 3, w.playerY, roomId, 1);
  w.enqueueSpawnEnemy('stalker', w.playerX - 3, w.playerY, roomId, 1);
  if (bossRoom) w.enqueueSpawnBoss(bossRoom);
  const afterEnqueue = {
    targets: w.simFixture.targets.length,
    drones: w.simFixture.drones.length,
    worldSpawns: w.worldSpawns.length,
    pendingCommands: w.sim.pendingCommands.length
  };
  const ev = step(neutral);
  const afterTick = {
    targets: w.simFixture.targets.length,
    drones: w.simFixture.drones.length,
    worldSpawns: w.worldSpawns.length
  };
  const spawnEvents = ev.filter((e) => /spawn|enemy/.test(e.type)).map((e) => e.type);
  const bossAlive = !!w.boss && w.boss.hp > 0;

  // Legacy ranged / Boss attacks enqueue commands instead of mutating core directly.
  let laserEnqueued = 'n/a';
  if (w.boss) {
    const pc0 = w.sim.pendingCommands.length;
    w.boss.fireLaser(w.playerX, w.playerY);
    laserEnqueued = w.sim.pendingCommands.length > pc0;
  }

  // Room-generation direct write (R2-2 gap): force a fresh room entry.
  const roomGen = (() => {
    const r = w.map.rooms.find((x) => x.kind !== 'start' && x.kind !== 'boss');
    if (!r) return { skipped: true };
    r.spawned = false; r.cleared = false;
    const t0 = w.simFixture.targets.length;
    w.currentRoomId = -1; // pretend we have not entered
    w.onEnterRoom(r);      // private; spawns enemies directly (off-tick)
    const t1 = w.simFixture.targets.length;
    return { roomId: r.id, targetsBefore: t0, targetsAfterDirect: t1, directWrite: t1 > t0 };
  })();

  return { before, afterEnqueue, afterTick, spawnEvents, bossExists: !!w.boss, laserEnqueued, roomGen };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
