// Production vs dev distinction for the 5f49b24 seam: dev/test-only fixtures, paused
// zero-dt no-write via the public frozen snapshot, and 20-grid loot staying on the ground.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const PROD = process.argv[2] ?? 'http://localhost:5292/';
const DEV = process.argv[3] ?? 'http://localhost:5291/';
const out = { meta: { prod: PROD, dev: DEV, target: '5f49b24' }, checks: [], prod: {}, dev: {}, errors: [] };
const check = (n, ok, d) => { out.checks.push({ n: ok, name: n, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
async function boot(base) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${base} console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${base} pageerror: ${e.message}`));
  await page.goto(base);
  await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const g = window.__game, m = g.scene.getScene('MainMenuScene');
    const o = m.scene.start.bind(m.scene);
    m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...(d || {}), seed: 424242 }) : o(k, d);
  });
  await page.mouse.click(640, 340);
  await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
  await page.waitForTimeout(1200);
  return { page, errors };
}
// --- production ---
{
  const { page, errors } = await boot(PROD);
  out.errors.push(...errors);
  out.prod = await page.evaluate(() => {
    const gs = (window).__game.scene.getScene('GameScene'), w = gs.world;
    const r = {};
    try { r.simFixture = w.simFixture ? 'ok' : 'missing'; } catch (e) { r.simFixture = String(e.message || e); }
    try { r.playerDataFixture = w.playerDataFixture ? 'ok' : 'missing'; } catch (e) { r.playerDataFixture = String(e.message || e); }
    try { r.clearEnemies = (w.clearEnemiesForTest(), 'ok'); } catch (e) { r.clearEnemies = String(e.message || e); }
    const s0 = w.sim;
    r.frozen = Object.isFrozen(s0);
    r.before = { hp: s0.player.data.hp, currency: s0.player.data.currency, tick: s0.tick, pending: s0.pendingCommands.length, loot: s0.loot.length };
    w.enqueueHeal(10); w.enqueueCurrency(50); w.enqueueSpawnLoot(s0.player.x + 20, s0.player.y, 'currency', 'currency', 10);
    const s1 = w.sim;
    r.afterEnqueue = { hp: s1.player.data.hp, currency: s1.player.data.currency, tick: s1.tick, pending: s1.pendingCommands.length };
    const ev0 = w.stepFrame(0, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    const s2 = w.sim;
    r.afterZero = { hp: s2.player.data.hp, currency: s2.player.data.currency, tick: s2.tick, pending: s2.pendingCommands.length, events: ev0.length, loot: s2.loot.length };
    return r;
  });
  await page.waitForTimeout(1200);
  out.prod.afterTicks = await page.evaluate(() => {
    const gs = (window).__game.scene.getScene('GameScene'), w = gs.world, s = w.sim;
    return { hp: s.player.data.hp, currency: s.player.data.currency, tick: s.tick, pending: s.pendingCommands.length, loot: s.loot.length, lootViews: w.loot.length };
  });
  await page.close();
}
// --- dev ---
{
  const { page, errors } = await boot(DEV);
  out.errors.push(...errors);
  out.dev = await page.evaluate(() => {
    const gs = (window).__game.scene.getScene('GameScene'), w = gs.world;
    const r = {};
    try { r.simFixture = w.simFixture ? 'ok' : 'missing'; } catch (e) { r.simFixture = String(e.message || e); }
    try { r.playerDataFixture = w.playerDataFixture ? 'ok' : 'missing'; } catch (e) { r.playerDataFixture = String(e.message || e); }
    try { r.clearEnemies = (w.clearEnemiesForTest(), 'ok'); } catch (e) { r.clearEnemies = String(e.message || e); }
    return r;
  });
  await page.close();
}
check('prod-simFixture-dev-only', String(out.prod.simFixture).includes('dev/test only'), out.prod.simFixture);
check('prod-playerDataFixture-dev-only', String(out.prod.playerDataFixture).includes('dev/test only'), out.prod.playerDataFixture);
check('prod-clearEnemies-dev-only', String(out.prod.clearEnemies).includes('dev/test only'), out.prod.clearEnemies);
check('dev-fixtures-ok', out.dev.simFixture === 'ok' && out.dev.playerDataFixture === 'ok' && out.dev.clearEnemies === 'ok', out.dev);
check('prod-sim-frozen', out.prod.frozen === true);
check('prod-paused-enqueue-no-write', out.prod.afterEnqueue.hp === out.prod.before.hp && out.prod.afterEnqueue.currency === out.prod.before.currency && out.prod.afterEnqueue.pending > out.prod.before.pending, { before: out.prod.before, after: out.prod.afterEnqueue });
check('prod-step0-no-commit', out.prod.afterZero.hp === out.prod.before.hp && out.prod.afterZero.currency === out.prod.before.currency && out.prod.afterZero.events === 0 && out.prod.afterZero.pending === out.prod.afterEnqueue.pending, out.prod.afterZero);
check('prod-far-loot-20-not-picked', out.prod.afterTicks.loot > 0 && out.prod.afterTicks.currency === out.prod.afterZero.currency, out.prod.afterTicks);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-seam-triage/triage-build-distinction.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
