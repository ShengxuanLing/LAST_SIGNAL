// Production preview probe: enqueueSetPlayerData must be dev/test-gated in
// production; enqueuePurchaseSupply must work; first checkpoint must exist
// (one real tick, no speculative flush); hasUncommittedCommands covers worldSpawns.
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5394);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__game.scene.start('GameScene', { seed: 424242 }));
await page.waitForTimeout(1500);

const result = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const tryCall = (fn) => { try { fn(); return 'NO-THROW'; } catch (e) { return String(e); } };

  // 1) enqueueSetPlayerData must be gated in production.
  const setPlayerData = tryCall(() => w.enqueueSetPlayerData({ ...w.sim.player.data, currency: 9999 }));

  // 2) enqueuePurchaseSupply must be callable (semantic command, not gated).
  const purchase = tryCall(() => w.enqueuePurchaseSupply('probe-tx', 'repair', 999));

  // 3) First checkpoint: after create + one real tick, capture must succeed.
  w.resetSimulationAccumulator();
  w.stepFrame(1000 / 60 + 1e-6, neutral);
  const firstCheckpoint = w.captureCheckpoint('probe-first', gs.seed, { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 });

  // 4) hasUncommittedCommands covers worldSpawns (enqueueSpawnEnemy).
  const beforeSpawn = w.hasUncommittedCommands();
  w.enqueueSpawnEnemy('drone', w.playerX + 2, w.playerY, 0, 1);
  const afterSpawn = w.hasUncommittedCommands();
  const hasPendingSpawns = w.hasPendingSpawns();

  // 5) processPendingCommands must not exist any more.
  const legacyFlush = tryCall(() => w.processPendingCommands());

  // 6) capture must be refused while commands are pending.
  const pendingCaptureNull = w.captureCheckpoint('probe-pending', gs.seed, { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 }) === null;

  return {
    setPlayerData, purchase, legacyFlush,
    firstCheckpointOk: !!firstCheckpoint,
    beforeSpawn, afterSpawn, hasPendingSpawns, pendingCaptureNull,
    pageErrors: []
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
