// Probe: a25f140 dirty patch — failed save must keep checkpointDirty=true.
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5402);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1000);
await page.evaluate(() => window.__game.scene.start('GameScene', { seed: 424242 }));
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const gsAny = gs;
  gs.markCheckpointDirty();
  const dirtyBefore = gsAny.checkpointDirty;
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('probe storage fail'); };
  let saveReturn; let threw = null;
  try { saveReturn = gs.saveCheckpoint(); } catch (e) { threw = String(e); }
  const dirtyAfterFail = gsAny.checkpointDirty;
  Storage.prototype.setItem = orig;
  const recovered = gs.saveCheckpoint();
  const dirtyAfterOk = gsAny.checkpointDirty;
  return { dirtyBefore, saveReturn, threw, dirtyAfterFail, recovered, dirtyAfterOk };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
