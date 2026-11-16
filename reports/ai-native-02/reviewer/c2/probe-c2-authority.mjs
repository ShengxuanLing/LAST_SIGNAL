// Independent reviewer probe for C2 authority/compatibility paths (frozen 4cf1bc8).
// Browser-only: uses __game to inspect real World behavior. Diagnostic, not acceptance.
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
await page.evaluate(() => {
  const g = window.__game;
  g.scene.start('GameScene', { seed: 424242 });
});
await page.waitForTimeout(1200);
// Pause so the normal RAF loop cannot advance the core while we drive it.
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

const result = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const fire = { move: { x: 0, y: 0 }, dash: false, fire: true, aim: { x: w.player.wx + 5, y: w.player.wy }, interact: false };

  // 1) stepSimulationTicksForTest advances the core while GameScene is paused.
  const tickBefore = w.sim.tick;
  const ev = w.stepSimulationTicksForTest(2, fire);
  const tickAfter = w.sim.tick;
  const coreProjectiles = w.sim.projectiles.length;

  // 2) Combined projectiles view order: legacy first, core second.
  const legacyData = w.spawnEnemyProjectile(999, w.player.wx + 0.5, w.player.wy, 8, { x: 0, y: 0 });
  const combined = w.projectiles;
  const last = combined[combined.length - 1];
  const lastIsCore = w.sim.projectiles.includes(last.data);

  // 3) Boss.fireLaser uses world.projectiles[last] and mutates its data.vel.
  const room = w.currentRoom();
  w.spawnBoss(w.map.rooms[room.id]);
  const boss = w.boss;
  const coreBefore = w.sim.projectiles.map((p) => ({ id: p.id, vel: { ...p.vel } }));
  boss.fireLaser(w.player);
  const coreAfter = w.sim.projectiles.map((p) => ({ id: p.id, vel: { ...p.vel } }));
  const coreVelChanged = coreBefore.some((p, i) => {
    const a = coreAfter[i];
    return a && (Math.abs(a.vel.x - p.vel.x) > 1e-12 || Math.abs(a.vel.y - p.vel.y) > 1e-12);
  });

  // 4) Writing the compatibility view clears the authoritative core projectiles.
  const coreBeforeClear = w.sim.projectiles.length;
  w.projectiles = [];
  const coreAfterClear = w.sim.projectiles.length;

  // 5) Legacy Player.hurt writes the core state outside any core tick/event.
  w.player.data.hp = 100;
  const beforeHurt = { hp: w.player.data.hp, x: w.player.wx, y: w.player.wy, invuln: w.player.invuln };
  const hurtReturned = w.player.hurt(10, w.player.wx + 1, w.player.wy);
  const afterHurt = { hp: w.player.data.hp, x: w.player.wx, y: w.player.wy, invuln: w.player.invuln };

  return {
    paused: gs.paused,
    stepForTest: { tickBefore, tickAfter, coreProjectiles, events: ev.map((e) => e.type) },
    compatibilityOrder: {
      combinedLength: combined.length,
      simProjectiles: w.sim.projectiles.length,
      lastIsCore,
      legacyDataIsLast: last.data === legacyData,
      legacyId: legacyData.id,
      lastId: last.data.id,
      lastDataKeys: Object.keys(last.data),
    },
    bossFireLaser: { coreBefore, coreAfter, coreVelChanged, coreProjectilesAfter: w.sim.projectiles.length },
    projectilesSetter: { coreBeforeClear, coreAfterClear },
    playerHurt: { beforeHurt, afterHurt, hurtReturned },
  };
});
console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
await browser.close();
