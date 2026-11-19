// Independent C2 resume/no-step probe for 780cece: real onResume/onLevelUpClosed/inventory
// close must NOT advance a tick or change state; a sub-tick update commits nothing; a real
// full tick commits the queued command exactly once; real RAF still runs after resume.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5296/';
const out = { meta: { url: BASE, target: '780cece' }, checks: [], steps: [], errors: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') out.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => out.errors.push(`pageerror: ${e.message}`));
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { const m = (window).__game.scene.getScene('MainMenuScene'); const o = m.scene.start.bind(m.scene); m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...(d || {}), seed: 424242 }) : o(k, d); });
const b = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(b.x + (640 * b.w) / 1280, b.y + (340 * b.h) / 720);
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
await page.waitForTimeout(1300);

// A) real pause -> enqueue -> real onResume; sub-tick vs full tick
{
  const r = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    const snap = () => {
      const s = w.sim;
      return { tick: s.tick, hp: s.player.data.hp, currency: s.player.data.currency, loot: s.loot.length, projectiles: s.projectiles.length, enemies: w.enemies.length, pending: s.pendingCommands.length, paused: w.player.control.paused, mode: w.player.control.snapshot().mode, timers: { dash: s.player.dashTimer, invuln: s.player.invuln, hurt: s.player.hurtTimer, fire: s.player.fireTimer } };
    };
    gs.onPause();
    w.enqueueHeal(5); w.enqueueCurrency(10);
    const before = snap();
    gs.onResume();
    const afterResume = snap();
    gs.update(0, 5);
    const afterSubTick = snap();
    gs.update(0, 20);
    const afterFullTick = snap();
    gs.update(0, 20);
    const afterSecondFull = snap();
    return { before, afterResume, afterSubTick, afterFullTick, afterSecondFull };
  });
  out.steps.push({ name: 'onResume', detail: r });
  check('onResume-no-tick', r.afterResume.tick === r.before.tick && r.afterResume.hp === r.before.hp && r.afterResume.currency === r.before.currency && JSON.stringify(r.afterResume.timers) === JSON.stringify(r.before.timers), r);
  check('sub-tick-commits-nothing', r.afterSubTick.tick === r.before.tick && r.afterSubTick.currency === r.before.currency, r.afterSubTick);
  check('full-tick-commits-once', r.afterFullTick.tick === r.before.tick + 1 && r.afterFullTick.currency === r.before.currency + 10 && r.afterFullTick.hp === Math.min(r.before.hp + 5, 100), r);
  check('next-tick-no-duplicate', r.afterSecondFull.currency === r.afterFullTick.currency && r.afterSecondFull.hp === r.afterFullTick.hp, r.afterSecondFull);
  // real RAF after resume
  await page.waitForTimeout(120);
  const later = await page.evaluate(() => { const w = window.__game.scene.getScene('GameScene').world; return w.sim.tick; });
  check('real-raf-advances', later > r.afterSecondFull.tick, { later, base: r.afterSecondFull.tick });
}

// B) level-up close path: measure INSIDE one evaluate so the live RAF cannot add ticks
{
  const r = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    const snap = () => { const s = w.sim; return { tick: s.tick, pending: s.pendingCommands.length, upgrades: w.player.data.upgrades.length, hp: s.player.data.hp, currency: s.player.data.currency, paused: gs.paused, loot: s.loot.length, projectiles: s.projectiles.length, timers: { dash: s.player.dashTimer, invuln: s.player.invuln, hurt: s.player.hurtTimer, fire: s.player.fireTimer } }; };
    // queue an upgrade exactly like LevelUpScene.choose() does
    w.enqueueApplyUpgrade('vitality', 1);
    const before = snap();
    gs.onLevelUpClosed();   // the real close callback
    const afterClose = snap();
    gs.update(0, 5);       // sub-tick frame
    const afterSubTick = snap();
    gs.update(0, 20);      // exactly one full tick
    const afterFullTick = snap();
    return { before, afterClose, afterSubTick, afterFullTick };
  });
  out.steps.push({ name: 'levelupClose-isolated', detail: r });
  check('levelup-close-no-forced-tick', r.afterClose.tick === r.before.tick && r.afterClose.pending === r.before.pending && r.afterClose.upgrades === r.before.upgrades, r);
  check('levelup-sub-tick-commits-nothing', r.afterSubTick.tick === r.before.tick && r.afterSubTick.upgrades === r.before.upgrades, r.afterSubTick);
  check('levelup-one-real-tick-commits-once', r.afterFullTick.tick === r.before.tick + 1 && r.afterFullTick.upgrades === r.before.upgrades + 1 && r.afterFullTick.pending === 0, r);
}

// C) inventory close path: measure INSIDE one evaluate
{
  const r = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    const snap = () => { const s = w.sim; return { tick: s.tick, pending: s.pendingCommands.length, weapon: w.player.data.weaponKey, paused: gs.paused, projectiles: s.projectiles.length, loot: s.loot.length }; };
    gs.onPause();
    w.enqueueEquipWeapon('pulse'); // queue like Player.equipWeapon() does
    const before = snap();
    gs.onResume();             // the real resume callback
    const afterResume = snap();
    gs.update(0, 5);
    const afterSubTick = snap();
    gs.update(0, 20);
    const afterFullTick = snap();
    return { before, afterResume, afterSubTick, afterFullTick };
  });
  out.steps.push({ name: 'inventoryClose-isolated', detail: r });
  check('inventory-close-no-forced-tick', r.afterResume.tick === r.before.tick && r.afterResume.pending === r.before.pending, r);
  check('inventory-sub-tick-commits-nothing', r.afterSubTick.tick === r.before.tick, r.afterSubTick);
  check('inventory-one-real-tick-commits-once', r.afterFullTick.tick === r.before.tick + 1 && r.afterFullTick.pending === 0, r);
}
out.errors.length === 0 && check('no-console-error', true);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-resume-final/resume-probe-log.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
