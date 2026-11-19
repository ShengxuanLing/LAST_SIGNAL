// Seam-contract probe for 5f49b24: paused/zero-dt no-write, 20-grid loot not picked up,
// and the pending-command vs checkpoint gap. Run on dev (simFixture available) only.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5291/';
const out = { meta: { url: BASE, target: '5f49b24' }, steps: [], checks: [], findings: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await page.evaluate(() => {
  const g = window.__game, m = g.scene.getScene('MainMenuScene');
  const o = m.scene.start.bind(m.scene);
  m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...(d || {}), seed: 424242 }) : o(k, d);
});
await page.mouse.click(640, 340);
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
await page.waitForTimeout(1200);

// A) paused enqueue only + stepFrame(0) no-op + one tick commits
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const paused = await page.evaluate(() => {
  const gs = (window).__game.scene.getScene('GameScene'), w = gs.world, live = w.simFixture;
  const before = { hp: w.player.data.hp, currency: w.player.data.currency, xp: w.player.data.xp, tick: live.tick, pending: live.pendingCommands.length, paused: gs.paused };
  w.enqueueHeal(10); w.enqueueCurrency(50); w.enqueueAddXp(5); w.enqueueSpawnLoot(live.player.x + 20, live.player.y, 'currency', 'currency', 10);
  const afterEnqueue = { hp: w.player.data.hp, currency: w.player.data.currency, xp: w.player.data.xp, tick: live.tick, pending: live.pendingCommands.length };
  const ev0 = w.stepFrame(0, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  const afterZero = { hp: w.player.data.hp, currency: w.player.data.currency, xp: w.player.data.xp, tick: live.tick, pending: live.pendingCommands.length, events: ev0.length, loot: live.loot.length };
  const ev1 = w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  const afterOne = { hp: w.player.data.hp, currency: w.player.data.currency, xp: w.player.data.xp, tick: live.tick, pending: live.pendingCommands.length, loot: live.loot.length, events: [...new Set(ev1.map((e) => e.type))] };
  const ev2 = w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  const afterTwo = { hp: w.player.data.hp, currency: w.player.data.currency, tick: live.tick, events: [...new Set(ev2.map((e) => e.type))] };
  return { before, afterEnqueue, afterZero, afterOne, afterTwo };
});
out.steps.push({ name: 'paused-zero-dt', detail: paused });
check('paused-enqueue-only', paused.before.hp === paused.afterEnqueue.hp && paused.before.currency === paused.afterEnqueue.currency && paused.before.xp === paused.afterEnqueue.xp && paused.afterEnqueue.pending > paused.before.pending, paused);
check('step0-no-commit', paused.afterZero.hp === paused.before.hp && paused.afterZero.currency === paused.before.currency && paused.afterZero.xp === paused.before.xp && paused.afterZero.events === 0 && paused.afterZero.loot === 0, paused.afterZero);
check('one-tick-commits', paused.afterOne.events.includes('player-healed') && paused.afterOne.events.includes('currency-gained') && paused.afterOne.events.includes('xp-gained') && paused.afterOne.events.includes('loot-dropped'), paused.afterOne);
check('no-duplicate-next-tick', !paused.afterTwo.events.includes('player-healed') && !paused.afterTwo.events.includes('currency-gained'), paused.afterTwo);

// B) 20-grid loot stays on the ground (not auto-picked) until the player moves.
const farLoot = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gs = (window).__game.scene.getScene('GameScene'), w = gs.world, live = w.simFixture;
  const c0 = w.player.data.currency;
  w.enqueueSpawnLoot(live.player.x + 20, live.player.y, 'currency', 'currency', 10);
  const samples = [];
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    samples.push({ tick: live.tick, loot: live.loot.length, currency: w.player.data.currency, dist: live.loot[0] ? Number(Math.hypot(live.player.x - live.loot[0].x, live.player.y - live.loot[0].y).toFixed(2)) : null });
  }
  const last = samples[samples.length - 1];
  return { c0, samples: samples.slice(0, 5), last, stayed: last.loot > 0 && last.currency === c0, distMoved: last.dist };
});
out.steps.push({ name: 'far-loot-20', detail: farLoot });
check('far-loot-20-not-auto-picked', farLoot.stayed === true, farLoot);

// C) pending commands are NOT captured by a checkpoint (purchase/tick gap).
const ckpt = await page.evaluate(() => {
  const gs = (window).__game.scene.getScene('GameScene'), w = gs.world, live = w.simFixture;
  for (const r of w.map.rooms) { if (r.kind !== 'boss') { r.spawned = true; r.cleared = true; } }
  w.enemies = []; w.boss = null; w.won = false;
  const before = { currency: w.player.data.currency, pending: live.pendingCommands.length };
  w.enqueueCurrency(100);
  const withPending = { currency: w.player.data.currency, pending: live.pendingCommands.length };
  const frame = w.captureCheckpoint('triage-pending', 424242, { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 });
  return { before, withPending, savedCurrency: frame ? frame.player.currency : null, savedTick: frame ? frame.coreState?.tick ?? null : null, hasPendingField: frame ? ('pendingCommands' in frame.coreState) : null };
});
out.steps.push({ name: 'checkpoint-pending', detail: ckpt });
check('checkpoint-does-not-capture-pending', ckpt.withPending.pending > 0 && ckpt.savedCurrency === ckpt.before.currency, ckpt);
out.findings.push({ name: 'pending-commands-not-in-checkpoint', detail: ckpt, note: 'captureCheckpoint stores player data/coreState but no pendingCommands; a queued purchase/heal/upgrade is lost if the run is saved before the next tick commits it' });
out.errors = errors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-seam-triage/triage-seam-contract.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
