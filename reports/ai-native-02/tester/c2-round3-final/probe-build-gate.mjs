// Production vs dev build gate: dev/test-only fixture helpers and public Owner setter.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const PROD = process.argv[2] ?? 'http://localhost:5290/';
const DEV = process.argv[3] ?? 'http://localhost:5289/';
const out = { meta: { prod: PROD, dev: DEV, target: '6ac60b2' }, checks: [], prod: null, dev: null, errors: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
async function boot(base) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => out.errors.push(`${base} pageerror: ${e.message}`));
  await page.goto(base);
  await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const g = window.__game, m = g.scene.getScene('MainMenuScene'); const o = m.scene.start.bind(m.scene); m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...(d || {}), seed: 424242 }) : o(k, d); });
  const b = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(b.x + (640 * b.w) / 1280, b.y + (340 * b.h) / 720);
  await page.waitForTimeout(1300);
  const res = await page.evaluate(() => {
    const w = window.__game.scene.getScene('GameScene').world;
    const r = {};
    const grab = (name, fn) => { try { r[name] = fn(); } catch (e) { r[name] = String(e && e.message ? e.message : e); } };
    grab('simFixture', () => (w.simFixture ? 'ok' : 'missing'));
    grab('playerDataFixture', () => (w.playerDataFixture ? 'ok' : 'missing'));
    grab('clearEnemiesForTest', () => { w.clearEnemiesForTest(); return 'ok'; });
    grab('resetProjectilesForTest', () => { w.resetProjectilesForTest(); return 'ok'; });
    grab('stepSimulationTicksForTest', () => { w.stepSimulationTicksForTest(1, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); return 'ok'; });
    grab('ownerSetPlayerData', () => { const clone = JSON.parse(JSON.stringify(w.sim.player.data)); clone.hp = Math.max(1, clone.hp - 3); w.ownerSetPlayerData(clone); return w.sim.player.data.hp; });
    return r;
  });
  await page.close();
  return res;
}
out.prod = await boot(PROD);
out.dev = await boot(DEV);
check('prod-simFixture-dev-only', String(out.prod.simFixture).includes('dev/test only'), out.prod.simFixture);
check('prod-playerDataFixture-dev-only', String(out.prod.playerDataFixture).includes('dev/test only'), out.prod.playerDataFixture);
check('prod-clearEnemies-dev-only', String(out.prod.clearEnemiesForTest).includes('dev/test only'), out.prod.clearEnemiesForTest);
check('prod-resetProjectiles-dev-only', String(out.prod.resetProjectilesForTest).includes('dev/test only'), out.prod.resetProjectilesForTest);
check('prod-stepTicksForTest-dev-only', String(out.prod.stepSimulationTicksForTest).includes('dev/test only'), out.prod.stepSimulationTicksForTest);
check('dev-simFixture-ok', out.dev.simFixture === 'ok', out.dev.simFixture);
check('dev-playerDataFixture-ok', out.dev.playerDataFixture === 'ok', out.dev.playerDataFixture);
check('dev-clearEnemies-ok', out.dev.clearEnemiesForTest === 'ok', out.dev.clearEnemiesForTest);
check('prod-ownerSetPlayerData-public-write', typeof out.prod.ownerSetPlayerData === 'number' && out.prod.ownerSetPlayerData <= 100, out.prod.ownerSetPlayerData);
check('dev-ownerSetPlayerData-public-write', typeof out.dev.ownerSetPlayerData === 'number', out.dev.ownerSetPlayerData);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-round3-final/build-gate-log.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
