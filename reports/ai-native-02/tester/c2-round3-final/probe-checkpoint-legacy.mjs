// Independent C2 round-2 checkpoint probe: coreState restore and legacy frame
// (no coreState) compatibility. Fixture: mark non-boss rooms cleared and clear enemies so a
// checkpoint can be captured, as the official spec does. Normal RAF resumes after restore.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5289/';
const report = { meta: { url: BASE, target: '0df1514', fixtures: ['rooms marked cleared', 'enemies cleared', 'fixed seed', 'dev-only simFixture live-core access'] }, checks: [], flow: {}, errors: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
const box = () => page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
async function clickLogical(lx, ly) { const b = await box(); await page.mouse.click(b.x + (lx * b.w) / 1280, b.y + (ly * b.h) / 720); }
const snap = () => page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene');
  const live = gs.world.simFixture;
  return { tick: live.tick, rng: live.rngState, pid: live.nextProjectileId, hp: live.player.data.hp, x: live.player.x, y: live.player.y };
});
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await page.evaluate(() => {
  const g = window.__game, menu = g.scene.getScene('MainMenuScene');
  const orig = menu.scene.start.bind(menu.scene);
  menu.scene.start = (key, data) => key === 'GameScene' ? orig(key, { ...(data || {}), seed: 424242 }) : orig(key, data);
});
await clickLogical(640, 340);
await page.waitForTimeout(1200);
const captured = await page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene');
  const w = gs.world;
  for (const rm of w.map.rooms) { if (rm.kind !== 'boss') { rm.spawned = true; rm.cleared = true; } }
  w.enemies = []; w.boss = null; w.won = false;
  const frame = w.captureCheckpoint('c2r2-checkpoint', w.map.seed, { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 });
  if (!frame) return { available: false };
  const legacy = JSON.parse(JSON.stringify(frame));
  delete legacy.coreState;
  const before = { tick: w.sim.tick, rng: w.sim.rngState, pid: w.sim.nextProjectileId };
  const coreOk = w.restoreCheckpoint(JSON.parse(JSON.stringify(frame)));
  const afterCore = { tick: w.sim.tick, rng: w.sim.rngState, pid: w.sim.nextProjectileId };
  // Mutate live core, then restore the legacy frame (no coreState).
  w.sim.tick = 9999; w.sim.rngState = 1; w.sim.nextProjectileId = 1;
  const legacyOk = w.restoreCheckpoint(legacy);
  const afterLegacy = { tick: w.sim.tick, rng: w.sim.rngState, pid: w.sim.nextProjectileId };
  return { available: true, hasCoreState: !!frame.coreState, before, coreOk, afterCore, legacyOk, afterLegacy };
});
check('checkpoint-available', captured.available === true, captured);
check('coreState-captured', captured.hasCoreState === true);
check('coreState-restore-ok', captured.coreOk === true);
check('coreState-tick-restored', captured.afterCore?.tick === captured.before?.tick, { before: captured.before, after: captured.afterCore });
check('coreState-rng-restored', captured.afterCore?.rng === captured.before?.rng);
check('coreState-pid-restored', captured.afterCore?.pid === captured.before?.pid);
check('legacy-frame-accepted', captured.legacyOk === true);
check('legacy-frame-resets-tick', captured.afterLegacy?.tick === 0);
report.flow = captured;
// Normal frames must resume after legacy restore (no crash, deterministic RNG re-derived).
const t0 = await snap();
await page.waitForTimeout(600);
const t1 = await snap();
check('legacy-restore-run-resumes', t1.tick > t0.tick, { t0, t1 });
check('legacy-restore-no-console-error', report.errors.length === 0, report.errors);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-round3-final/checkpoint-legacy-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
