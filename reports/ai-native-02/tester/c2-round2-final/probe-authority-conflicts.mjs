// Independent C2 round-2 diagnostic probe: visible loot/pickup, paused/zero-dt core writes,
// legacy spawn* outside tick, and production-vs-test build helper difference.
// Read-only: only real input + read/evaluate; fixtures declared (spawn hunter/loot, seed).
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const PROD = process.argv[2] ?? 'http://localhost:5288/';
const DEV = process.argv[3] ?? 'http://localhost:5287/';
const report = { meta: { production: PROD, dev: DEV, target: '0df1514', fixtures: ['fixed seed', 'spawn hunter/loot', 'paused spawn/add* diagnostics'] }, checks: [], findings: [], prod: {}, dev: {}, errors: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) process.exitCode = 1; };
const finding = (name, detail) => report.findings.push({ name, detail });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
async function boot(base) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(base);
  await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
  await page.waitForTimeout(1300);
  await page.evaluate(() => {
    const g = window.__game, menu = g.scene.getScene('MainMenuScene');
    const orig = menu.scene.start.bind(menu.scene);
    menu.scene.start = (key, data) => key === 'GameScene' ? orig(key, { ...(data || {}), seed: 424242 }) : orig(key, data);
  });
  const b = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(b.x + (640 * b.w) / 1280, b.y + (340 * b.h) / 720);
  await page.waitForTimeout(1400);
  return { page, errors };
}
const state = (page) => page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
  return {
    tick: w.sim.tick, paused: gs.paused, hp: w.sim.player.data.hp, currency: w.sim.player.data.currency, xp: w.sim.player.data.xp,
    upgrades: w.sim.player.data.upgrades.length, speed: w.sim.player.data.speed,
    drones: w.sim.drones.length, targets: w.sim.targets.length, projectiles: w.sim.projectiles.length,
    loot: w.loot.length, lootKinds: w.loot.map((l) => l.data.kind),
    player: { x: w.sim.player.x, y: w.sim.player.y }
  };
});
const cssFor = (page, gx, gy) => page.evaluate(({ gx, gy }) => {
  const g = window.__game, gs = g.scene.getScene('GameScene'), cam = gs.cameras.main;
  const p0 = cam.getWorldPoint(0, 0), px = cam.getWorldPoint(100, 0), py = cam.getWorldPoint(0, 100);
  const ax = (px.x - p0.x) / 100, bx = p0.x, ay = (py.y - p0.y) / 100, by = p0.y;
  const d = gs.world.worldToScreen(gx, gy);
  const sx = (d.x - bx) / ax, sy = (d.y - by) / ay;
  const c = g.canvas.getBoundingClientRect(); const s = g.scale;
  return { x: c.x + sx * (c.width / s.width), y: c.y + sy * (c.height / s.height) };
}, { gx, gy });

// -------- Production page: visible loot / pickup / paused mutations --------
{
  const { page, errors } = await boot(PROD);
  report.errors.push(...errors);
  const before = await state(page);
  const kill = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world, pl = w.player, room = w.currentRoom();
    let pos = null;
    for (const d of [2, 2.5, 3, -2]) { const x = pl.wx + d, y = pl.wy; if (w.isWalkable(x, y, 0.5)) { pos = { x, y }; break; } }
    if (!pos) pos = { x: pl.wx, y: pl.wy + 2 };
    const e = w.spawnEnemy('hunter', pos.x, pos.y, room?.id ?? 0, 1);
    return { id: e._id, pos, hp: e._hp, loot: w.loot.length, currency: w.sim.player.data.currency, xp: w.sim.player.data.xp, playerHp: w.sim.player.data.hp };
  });
  const aim = await cssFor(page, kill.pos.x, kill.pos.y);
  await page.mouse.move(Math.round(aim.x), Math.round(aim.y));
  await page.mouse.down();
  const samples = [];
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(120);
    const s = await page.evaluate(() => {
      const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
      const active = g.scene.getScenes(true).map((x) => x.sys.settings.key);
      return { loot: w.loot.length, targets: w.sim.targets.length, currency: w.sim.player.data.currency, xp: w.sim.player.data.xp, hp: w.sim.player.data.hp, levelUp: active.includes('LevelUpScene') };
    });
    samples.push(s);
    if (s.levelUp) { await page.keyboard.press('1'); await page.waitForTimeout(300); }
    if (s.targets === 0 && i > 2) break;
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterKill = await state(page);
  report.prod.kill = { kill, after: afterKill, samples: samples.slice(-3), visibleLootOnKill: afterKill.loot > before.loot, currencyAutoChanged: afterKill.currency !== before.currency, xpAutoChanged: afterKill.xp !== before.xp };
  check('kill-increases-xp', afterKill.xp !== before.xp, { before: before, after: afterKill });
  if (!report.prod.kill.visibleLootOnKill) {
    finding('visible-kill-loot-removed', { note: 'a real hunter kill awarded XP/currency directly with no visible loot drop added to world.loot', beforeLoot: before.loot, afterLoot: afterKill.loot, sampleLoot: samples.map((s) => s.loot) });
  }
  // Visible loot + pickup (spawned room-style drop at the player position).
  const pickup = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world, pl = w.player;
    const before = { loot: w.loot.length, currency: w.sim.player.data.currency };
    w.spawnLoot(pl.wx, pl.wy, 'currency', 'currency', 10);
    const spawned = { loot: w.loot.length, spriteVisible: w.loot.length > 0 && !!w.loot[w.loot.length - 1].spr && w.loot[w.loot.length - 1].spr.visible };
    return { before, spawned, currencyBefore: w.sim.player.data.currency };
  });
  await page.waitForTimeout(250);
  const pickupAfter = await state(page);
  report.prod.pickup = { ...pickup, after: { loot: pickupAfter.loot, currency: pickupAfter.currency }, collected: pickupAfter.currency > pickup.currencyBefore, spriteVisible: pickup.spawned.spriteVisible };
  check('visible-loot-sprite-spawned', pickup.spawned.spriteVisible === true);
  check('loot-pickup-changes-currency', pickupAfter.currency > pickup.currencyBefore, report.prod.pickup);

  // Paused direct core writes (tick must not change if transaction authority holds).
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  const paused0 = await state(page);
  const direct = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    const tick0 = w.sim.tick;
    const c0 = w.sim.player.data.currency, hp0 = w.sim.player.data.hp, up0 = w.sim.player.data.upgrades.length, speed0 = w.sim.player.data.speed;
    w.addCurrency(123);
    w.healPlayer(10);
    const upOk = w.applyUpgradeChoice('speed', 1);
    return { tick0, tickAfter: w.sim.tick, currency0: c0, currencyAfter: w.sim.player.data.currency, hp0, hpAfter: w.sim.player.data.hp, upgrades0: up0, upgradesAfter: w.sim.player.data.upgrades.length, upgradeOk: upOk, speed0, speedAfter: w.sim.player.data.speed };
  });
  const spawn = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    const tick0 = w.sim.tick;
    const d0 = w.sim.drones.length, t0 = w.sim.targets.length, p0 = w.sim.projectiles.length;
    const room = w.currentRoom();
    w.spawnEnemy('drone', w.player.wx + 2, w.player.wy, room?.id ?? 0, 1);
    w.spawnEnemyProjectile(0, w.player.wx, w.player.wy, 5, { x: 0, y: 0 });
    return { tick0, tickAfter: w.sim.tick, drones0: d0, dronesAfter: w.sim.drones.length, targets0: t0, targetsAfter: w.sim.targets.length, projectiles0: p0, projectilesAfter: w.sim.projectiles.length };
  });
  const zeroDt = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world, pl = w.player;
    const tick0 = w.sim.tick, c0 = w.sim.player.data.currency, loot0 = w.loot.length;
    w.spawnLoot(pl.wx, pl.wy, 'currency', 'currency', 10);
    const lootSpawned = w.loot.length;
    w.stepFrame(0, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    return { tick0, tickAfter: w.sim.tick, currency0: c0, currencyAfter: w.sim.player.data.currency, loot0, lootSpawned, lootAfter: w.loot.length };
  });
  report.prod.paused = { direct, spawn, zeroDt };
  check('paused-tick-frozen', paused0.paused === true && direct.tick0 === direct.tickAfter && spawn.tick0 === spawn.tickAfter && zeroDt.tick0 === zeroDt.tickAfter);
  if (direct.currencyAfter !== direct.currency0 || direct.hpAfter !== direct.hp0 || direct.upgradesAfter !== direct.upgrades0) {
    finding('paused-direct-core-writes', { note: 'World.addCurrency/healPlayer/applyUpgradeChoice mutate authoritative core while paused and tick unchanged', detail: direct });
  }
  if (spawn.dronesAfter > spawn.drones0 || spawn.projectilesAfter > spawn.projectiles0) {
    finding('paused-spawn-mutates-core', { note: 'spawnEnemy/spawnEnemyProjectile register core entities while paused and tick unchanged, with no stepFrame/SimEvent', detail: spawn });
  }
  if (zeroDt.currencyAfter !== zeroDt.currency0 && zeroDt.lootAfter < zeroDt.lootSpawned) {
    finding('stepframe-zero-dt-settles-loot', { note: 'stepFrame(0) while paused absorbs a loot drop and writes player currency with tick unchanged', detail: zeroDt });
  }
  await page.screenshot({ path: 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-round2-final/evidence-rendered/03-paused-mutations.png' });
  await page.close();
}

// -------- Dev page: same helper gate must NOT throw; production must throw --------
{
  const { page: prodHelper } = await boot(PROD);
  const prodRes = await prodHelper.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    const res = {};
    const tryIt = (n, f) => { try { f(); res[n] = 'ok'; } catch (e) { res[n] = String(e && e.message ? e.message : e); } };
    tryIt('clearEnemiesForTest', () => w.clearEnemiesForTest());
    tryIt('resetProjectilesForTest', () => w.resetProjectilesForTest());
    tryIt('stepSimulationTicksForTest', () => w.stepSimulationTicksForTest(1, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }));
    return res;
  });
  await prodHelper.close();
  const { page: devPage } = await boot(DEV);
  const devRes = await devPage.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    const res = {};
    const tryIt = (n, f) => { try { f(); res[n] = 'ok'; } catch (e) { res[n] = String(e && e.message ? e.message : e); } };
    tryIt('clearEnemiesForTest', () => w.clearEnemiesForTest());
    tryIt('resetProjectilesForTest', () => w.resetProjectilesForTest());
    tryIt('stepSimulationTicksForTest', () => w.stepSimulationTicksForTest(1, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }));
    return res;
  });
  await devPage.close();
  report.prod.helpers = prodRes;
  report.dev.helpers = devRes;
  const allThrow = ['clearEnemiesForTest', 'resetProjectilesForTest', 'stepSimulationTicksForTest'].every((k) => String(prodRes[k]).includes('dev/test only'));
  const devOk = ['clearEnemiesForTest', 'resetProjectilesForTest', 'stepSimulationTicksForTest'].every((k) => devRes[k] === 'ok');
  check('production-helpers-dev-test-only', allThrow, prodRes);
  check('dev-helpers-work', devOk, devRes);
  finding('test-helper-build-difference', { note: 'production build throws dev/test only for clearEnemiesForTest/resetProjectilesForTest/stepSimulationTicksForTest; dev build allows them. P1 preview failure is therefore a test-environment gate, not gameplay', production: prodRes, dev: devRes });
}

writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-round2-final/diagnostic-conflicts-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
