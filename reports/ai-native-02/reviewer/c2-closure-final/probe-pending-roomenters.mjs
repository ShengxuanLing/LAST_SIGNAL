// Focused browser probe: pendingRoomEnters prevents premature clear/reward.
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5397);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1000);
await page.evaluate(() => window.__game.scene.start('GameScene', { seed: 424242 }));
await page.waitForTimeout(1200);

const result = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const step = () => { w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral); };

  // Move to the portal, then trigger the transition.
  w.player.reset(w.portal.wx, w.portal.wy);
  step(); // commit teleport to portal
  const target = w.portal?.targetRoom;
  w.tryInteract(w.player); // enqueue teleport into target room, currentRoomId=-1
  step(); // commit teleport; updateRoom enters destination -> queues room-enter + pendingRoomEnters
  const targetRoom = w.map.rooms[target];
  const afterEnterTick = {
    pendingSize: w.pendingRoomEnters.size,
    spawned: targetRoom?.spawned,
    cleared: targetRoom?.cleared,
    hasUncommitted: w.hasUncommittedCommands(),
    enemies: w.enemies.filter((e) => e.data.spawnRoom === targetRoom?.id && e.alive).length
  };
  // updateRoom must NOT clear while generation is pending.
  w.updateRoom();
  const afterManualUpdate = { cleared: targetRoom?.cleared };
  // Next tick commits the room-enter (room-generated) -> spawned, enemies exist.
  step();
  const afterCommit = {
    pendingSize: w.pendingRoomEnters.size,
    spawned: targetRoom?.spawned,
    cleared: targetRoom?.cleared,
    enemies: w.enemies.filter((e) => e.data.spawnRoom === targetRoom?.id && e.alive).length,
    hasUncommitted: w.hasUncommittedCommands()
  };
  // Clear the room in the authoritative core, then let updateRoom mark it cleared.
  for (const e of w.enemies) { if (e.sprite?.scene) e.sprite.destroy(); }
  w.enemies = [];
  w.simFixture.drones = []; w.simFixture.targets = [];
  step();
  const afterClear = { cleared: targetRoom?.cleared };

  return { target, afterEnterTick, afterManualUpdate, afterCommit, afterClear };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
