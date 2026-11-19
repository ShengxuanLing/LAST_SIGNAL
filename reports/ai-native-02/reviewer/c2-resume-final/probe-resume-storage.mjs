// Independent probe (dev): onResume/onLevelUpClosed do not step; storage failure
// does not leak an exception; checkpointDirty preservation on failed save.
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5399);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1000);
await page.evaluate(() => window.__game.scene.start('GameScene', { seed: 424242 }));
await page.waitForTimeout(1500);

const result = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const tick = () => w.sim.tick;
  const snap = () => ({ tick: tick(), currency: w.sim.player.data.currency, hp: w.sim.player.data.hp,
    enemies: w.enemies.length, projectiles: w.sim.projectiles.length });

  // --- onResume must not step ---
  gs.onPause();
  w.enqueueCurrency(10);
  w.enqueueHeal(5);
  const before = snap();
  gs.onResume();
  gs.scene.stop('PauseScene');
  const afterResume = snap();
  gs.update(0, 5);
  const afterSmall = snap();
  gs.update(0, 20);
  const afterEnough = snap();

  // --- checkpointDirty preservation on failed save ---
  gs.markCheckpointDirty();
  const dirtyBefore = gs.checkpointDirty;
  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('probe storage fail'); };
  let saveReturn;
  let threw = null;
  try { saveReturn = gs.saveCheckpoint(); } catch (e) { threw = String(e); }
  const dirtyAfterFail = gs.checkpointDirty;
  Storage.prototype.setItem = origSet;
  // Recovery save once.
  const recovered = gs.saveCheckpoint();
  const dirtyAfterRecovery = gs.checkpointDirty;

  return {
    before, afterResume, afterSmall, afterEnough,
    resumeNoAdvance: JSON.stringify(afterResume) === JSON.stringify(before),
    subTickNoCommit: JSON.stringify(afterSmall) === JSON.stringify(before),
    oneTickAfterEnough: afterEnough.tick - before.tick,
    currencyCommittedOnce: afterEnough.currency === before.currency + 10,
    dirtyBefore, saveReturn, threw, dirtyAfterFail, recovered, dirtyAfterRecovery
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
