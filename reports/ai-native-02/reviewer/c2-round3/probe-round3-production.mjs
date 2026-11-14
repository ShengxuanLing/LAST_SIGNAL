// Independent round-3 production-boundary probe (frozen production preview).
// No dev/test fixtures are used in this probe.
import { chromium } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 5373);
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
await page.waitForTimeout(350);

const result = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const snapshot = () => {
    const s = w.sim;
    return {
      hp: s.player.data.hp, currency: s.player.data.currency, xp: s.player.data.xp,
      level: s.player.data.level, speed: s.player.data.speed, weaponKey: s.player.data.weaponKey,
      x: s.player.x, y: s.player.y,
      pendingCommands: s.pendingCommands.length,
      pendingPlayerHits: s.pendingPlayerHits.length,
      drones: s.drones.length, targets: s.targets.length,
      projectiles: s.projectiles.length, loot: s.loot.length
    };
  };
  const strictAssign = (fn) => { try { fn(); return 'no-throw'; } catch (e) { return String(e); } };

  // 1) Frozen read-only snapshots and mutation attempts.
  const frozen = {
    sim: Object.isFrozen(w.sim),
    simPlayerData: Object.isFrozen(w.sim.player.data),
    simTargets: Object.isFrozen(w.sim.targets),
    playerDataSnapshot: Object.isFrozen(w.player.data),
    playerDataSnapshotSameAsPlayer: w.player.data === w.playerDataSnapshot
  };
  const beforeMutation = snapshot();
  const assignSimHp = strictAssign(() => { w.sim.player.data.hp = 1; });
  const assignPlayerHp = strictAssign(() => { w.player.data.hp = 1; });
  const assignSimTick = strictAssign(() => { w.sim.tick = 9999; });
  const afterMutation = snapshot();
  // `_sim` is a TS private field; runtime reflection is outside the "ordinary public API" bar, but record it.
  const runtimePrivateExposed = !!w._sim;
  const runtimePrivateWrite = strictAssign(() => { if (w._sim) w._sim.player.data.hp = 2; });
  const afterPrivateWrite = snapshot();

  // 2) Dev/test-only fixture gates in production.
  const helperErrors = {};
  for (const key of ['simFixture', 'playerDataFixture']) {
    try { void w[key]; helperErrors[key] = null; } catch (e) { helperErrors[key] = String(e); }
  }
  const devHelpers = {};
  for (const name of ['setPlayerPositionForTest', 'clearLootForTest', 'clearEnemiesForTest', 'resetProjectilesForTest', 'stepSimulationTicksForTest']) {
    try { w[name](1, 1); devHelpers[name] = 'no-throw'; } catch (e) { devHelpers[name] = String(e); }
  }

  // 3) enqueue-only commands, paused + stepFrame(0) must not commit canonical state.
  // First reset any incidental pending commands by letting one tick run via direct stepFrame (paused flag is on GameScene).
  w.resetSimulationAccumulator();
  w.stepFrame(1000 / 60 + 1e-6, neutral);
  const beforeEnqueue = snapshot();
  w.enqueueHeal(50); w.enqueueCurrency(10); w.enqueueApplyUpgrade('speed', 1);
  w.enqueueAddXp(1); w.spawnLoot(w.playerX + 20, w.playerY, 'currency', 'currency', 7);
  w.spawnEnemyProjectile(999, w.playerX + 5, w.playerY, 8, { x: 0, y: 0 });
  const afterEnqueue = snapshot();
  const eventsStep0 = w.stepFrame(0, neutral);
  const afterStep0 = snapshot();
  const step0PendingCommands = w.sim.pendingCommands.map((c) => c.type);

  // stepFrame with a tick still commits even if GameScene is paused; record this boundary.
  const eventsStep1 = w.stepFrame(1000 / 60 + 1e-6, neutral);
  const afterStep1 = snapshot();
  const step1Events = eventsStep1.map((e) => e.type);

  // 4) Public "owner"/direct write methods in production (no dev gate).
  const beforeDirect = snapshot();
  const data = JSON.parse(JSON.stringify(w.player.data));
  data.hp = 1; data.currency = 999; data.upgrades = [];
  w.ownerSetPlayerData(data);
  const afterOwnerSet = snapshot();
  w.healPlayer(5); const afterHeal = snapshot();
  w.addCurrency(10); const afterCurrency = snapshot();
  w.equipWeapon(data.weaponKey); const afterEquip = w.sim.player.data.weaponKey;
  const beforeEnemySpawn = w.enemies.length;
  const e = w.spawnEnemy('drone', w.playerX + 2, w.playerY, w.currentRoom()?.id ?? 0, 1);
  const afterEnemySpawn = { enemies: w.enemies.length, drones: w.sim.drones.length, snapshotDroneStale: w.sim.drones.length };
  void e;

  // 5) enqueuePlayerHit missing bumpSimVersion -> snapshot staleness check.
  const hitBefore = w.sim.pendingPlayerHits.length;
  w.enqueuePlayerHit(3, w.playerX + 1, w.playerY);
  const hitAfter = w.sim.pendingPlayerHits.length;
  w.enqueueCurrency(0); // force bump to get a fresh snapshot
  const hitFresh = w.sim.pendingPlayerHits.length;

  return {
    paused: gs.paused,
    frozen, beforeMutation, assignSimHp, assignPlayerHp, assignSimTick, afterMutation,
    runtimePrivateExposed, runtimePrivateWrite, afterPrivateWrite,
    helperErrors, devHelpers,
    beforeEnqueue, afterEnqueue, eventsStep0, afterStep0, step0PendingCommands,
    eventsStep1Types: step1Events, afterStep1,
    beforeDirect, afterOwnerSet, afterHeal, afterCurrency, afterEquip,
    beforeEnemySpawn, afterEnemySpawn,
    hitBefore, hitAfter, hitFresh
  };
});
console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
await browser.close();
