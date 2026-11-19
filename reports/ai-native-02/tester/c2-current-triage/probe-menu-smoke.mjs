// No-fixture menu takeover smoke on 59aa852: real menu -> NEW RUN -> pause menu -> AI CONTROL
// ON -> real keyboard takeover, plus paused/zero-dt and 20-grid loot checks.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5293/';
const out = { meta: { url: BASE, target: '59aa852', fixture: 'none (real menu + real keys only)' }, steps: [], checks: [], errors: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') out.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => out.errors.push(`pageerror: ${e.message}`));
const live = () => page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world, s = w.simFixture;
  return {
    tick: s.tick, pending: s.pendingCommands.map((c) => c.type), uncommitted: w.hasUncommittedCommands(),
    owner: w.player.control.owner, aiEnabled: w.player.control.aiEnabled, mode: w.player.control.snapshot().mode,
    action: w.player.control.snapshot().lastAiAction, hp: w.player.data.hp, currency: w.player.data.currency,
    loot: s.loot.length, lootViews: w.loot.length, paused: gs.paused,
    active: g.scene.getScenes(true).map((x) => x.sys.settings.key)
  };
});
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1200);
// Real menu: NEW RUN by button label
const clickLabel = async (needle) => {
  const pos = await page.evaluate((n) => {
    const g = window.__game;
    for (const s of g.scene.getScenes(true)) {
      const t = s.children.list.find((c) => c.type === 'Text' && (c.text || '').trim().startsWith(n));
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  }, needle);
  if (!pos) return false;
  await page.mouse.click(pos.x, pos.y);
  return true;
};
const started = await clickLabel('NEW RUN');
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'), { timeout: 10000 });
await page.waitForTimeout(1200);
out.steps.push({ name: 'new-run-from-menu', detail: { started, ...(await live()) } });
// Real pause menu -> AI CONTROL ON
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const aiOn = await clickLabel('AI CONTROL');
await page.waitForTimeout(500);
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
const aiState = await live();
out.steps.push({ name: 'ai-enabled', detail: { aiOn, ...aiState } });
check('ai-enabled-via-real-menu', aiState.owner === 'ai' && aiState.aiEnabled === true, aiState);
// real keyboard takeover
await page.keyboard.down('KeyD');
await page.waitForTimeout(300);
await page.keyboard.up('KeyD');
await page.waitForTimeout(400);
const afterTakeover = await live();
out.steps.push({ name: 'takeover', detail: afterTakeover });
check('real-key-takeover', afterTakeover.owner === 'human' && afterTakeover.aiEnabled === false, afterTakeover);
// paused enqueue + stepFrame(0) + one tick
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const paused = await page.evaluate(() => {
  const gs = (window).__game.scene.getScene('GameScene'), w = gs.world, s = w.simFixture;
  const before = { hp: w.player.data.hp, currency: w.player.data.currency, tick: s.tick, pending: s.pendingCommands.length };
  w.enqueueHeal(10); w.enqueueCurrency(50);
  const afterEnqueue = { hp: w.player.data.hp, currency: w.player.data.currency, tick: s.tick, pending: s.pendingCommands.length };
  const ev0 = w.stepFrame(0, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  const afterZero = { hp: w.player.data.hp, currency: w.player.data.currency, tick: s.tick, pending: s.pendingCommands.length, events: ev0.length };
  const ev1 = w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  const afterOne = { hp: w.player.data.hp, currency: w.player.data.currency, tick: s.tick, pending: s.pendingCommands.length, events: [...new Set(ev1.map((e) => e.type))] };
  return { before, afterEnqueue, afterZero, afterOne };
});
out.steps.push({ name: 'paused-zero-dt', detail: paused });
check('paused-enqueue-only', paused.afterEnqueue.hp === paused.before.hp && paused.afterEnqueue.currency === paused.before.currency && paused.afterEnqueue.pending > paused.before.pending, paused);
check('step0-no-commit', paused.afterZero.events === 0 && paused.afterZero.hp === paused.before.hp && paused.afterZero.currency === paused.before.currency, paused.afterZero);
check('one-tick-commits', paused.afterOne.events.includes('player-healed') && paused.afterOne.events.includes('currency-gained'), paused.afterOne);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
// 20-grid loot must stay on the ground
const farLoot = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gs = (window).__game.scene.getScene('GameScene'), w = gs.world, s = w.simFixture;
  const c0 = w.player.data.currency;
  w.enqueueSpawnLoot(s.player.x + 20, s.player.y, 'currency', 'currency', 10);
  await sleep(1200);
  return { c0, currency: w.player.data.currency, loot: s.loot.length, lootViews: w.loot.length, dist: s.loot[0] ? Number(Math.hypot(s.player.x - s.loot[0].x, s.player.y - s.loot[0].y).toFixed(2)) : null };
});
out.steps.push({ name: 'far-loot-20', detail: farLoot });
check('far-loot-20-not-auto-picked', farLoot.loot > 0 && farLoot.currency === farLoot.c0, farLoot);
out.errors && (check('no-console-error', out.errors.length === 0, out.errors));
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-current-triage/menu-takeover-smoke.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
