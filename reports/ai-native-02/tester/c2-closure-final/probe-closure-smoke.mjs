// Closure smoke + Reviewer onResume forced-tick evidence (dev 5294, target ae72a67).
// Real menu/keys; fixtures declared where used (none for the pause/resume timing part).
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5294/';
const out = { meta: { url: BASE, target: 'ae72a67' }, checks: [], steps: [], findings: [], errors: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') out.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => out.errors.push(`pageerror: ${e.message}`));
const live = () => page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world, s = w.simFixture;
  return { tick: s.tick, pending: s.pendingCommands.map((c) => c.type), owner: w.player.control.owner, aiEnabled: w.player.control.aiEnabled, mode: w.player.control.snapshot().mode, hp: w.player.data.hp, currency: w.player.data.currency, upgrades: w.player.data.upgrades.map((u) => ({ key: u.key, level: u.level })), loot: s.loot.length, lootViews: w.loot.length, paused: gs.paused, active: g.scene.getScenes(true).map((x) => x.sys.settings.key) };
});
const clickLabel = async (needle) => {
  const pos = await page.evaluate((n) => { const g = window.__game; for (const s of g.scene.getScenes(true)) { const t = s.children.list.find((c) => c.type === 'Text' && (c.text || '').trim().startsWith(n)); if (t) return { x: t.x, y: t.y }; } return null; }, needle);
  if (!pos) return false; await page.mouse.click(pos.x, pos.y); return true;
};
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await clickLabel('NEW RUN');
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'), { timeout: 10000 });
await page.waitForTimeout(1200);
out.steps.push({ name: 'new-run', detail: await live() });

// --- forced-tick on pause resume (two different pause durations) ---
for (const pauseMs of [300, 1500]) {
  const t0 = await live();
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const frozen = await live();
  await page.waitForTimeout(pauseMs - 300);
  const frozen2 = await live();
  await page.keyboard.press('Escape');
  const immediate = await live();       // sampled with ~0 wait after resume
  await page.waitForTimeout(300);
  const after = await live();
  out.steps.push({ name: `resume-${pauseMs}ms`, detail: { t0tick: t0.tick, frozenTick: frozen.tick, frozenDelta: frozen2.tick - frozen.tick, resumeImmediateTick: immediate.tick, resumeImmediateDelta: immediate.tick - frozen2.tick, after300Tick: after.tick, after300Delta: after.tick - immediate.tick, pauseMs } });
  check(`pause-frozen-${pauseMs}`, frozen.tick === frozen2.tick, { pauseMs });
  check(`resume-forces-exactly-one-tick-${pauseMs}`, immediate.tick - frozen2.tick === 1, { pauseMs, delta: immediate.tick - frozen2.tick });
}
// pending command queued while paused commits on the forced resume tick, once
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const beforePending = await page.evaluate(() => {
  const gs = (window).__game.scene.getScene('GameScene'), w = gs.world, s = w.simFixture;
  const b = { currency: w.player.data.currency, tick: s.tick, pending: s.pendingCommands.length };
  w.enqueueCurrency(50);
  return { b, afterEnqueue: { currency: w.player.data.currency, pending: s.pendingCommands.length } };
});
await page.keyboard.press('Escape');
const afterResume = await page.evaluate(() => { const gs = (window).__game.scene.getScene('GameScene'), w = gs.world, s = w.simFixture; return { currency: w.player.data.currency, tick: s.tick, pending: s.pendingCommands.length }; });
await page.waitForTimeout(400);
const afterResume2 = await page.evaluate(() => { const gs = (window).__game.scene.getScene('GameScene'), w = gs.world, s = w.simFixture; return { currency: w.player.data.currency, tick: s.tick, pending: s.pendingCommands.length }; });
out.steps.push({ name: 'paused-pending-commit', detail: { beforePending, afterResume, afterResume2 } });
check('paused-pending-commits-once-on-resume', beforePending.afterEnqueue.pending === 1 && beforePending.afterEnqueue.currency === beforePending.b.currency && afterResume.currency === beforePending.b.currency + 50 && afterResume.pending === 0 && afterResume2.currency === afterResume.currency, { beforePending, afterResume, afterResume2 });

// --- real AI takeover ---
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
const aiOn = await clickLabel('AI CONTROL'); await page.waitForTimeout(400);
await page.keyboard.press('Escape'); await page.waitForTimeout(900);
const aiState = await live();
await page.keyboard.down('KeyD'); await page.waitForTimeout(250); await page.keyboard.up('KeyD'); await page.waitForTimeout(300);
const takenOver = await live();
out.steps.push({ name: 'ai-takeover', detail: { aiOn, aiState, takenOver } });
check('ai-takeover-real-keys', aiState.owner === 'ai' && takenOver.owner === 'human' && takenOver.aiEnabled === false, { aiState, takenOver });
// ensure the game is running (not paused) before the loot/upgrade probes
if ((await live()).paused) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
out.steps.push({ name: 'resumed-before-loot', detail: { paused: (await live()).paused } });

// --- far loot 20/40/85 no magnet, near 5 collected ---
for (const dist of [20, 40, 85, 5]) {
  const r = await page.evaluate(async (dist) => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    const gs = (window).__game.scene.getScene('GameScene'), w = gs.world, s = w.simFixture;
    const c0 = w.player.data.currency;
    w.enqueueSpawnLoot(s.player.x + dist, s.player.y, 'currency', 'currency', 10);
    await sleep(900);
    return { c0, currency: w.player.data.currency, loot: s.loot.length, dist: s.loot[0] ? Number(Math.hypot(s.player.x - s.loot[0].x, s.player.y - s.loot[0].y).toFixed(2)) : null, collected: w.player.data.currency > c0 };
  }, dist);
  out.steps.push({ name: `loot-${dist}`, detail: r });
  if (dist === 5) check('near-5-collected', r.collected === true, r);
  else check(`far-${dist}-not-collected`, r.collected === false && r.loot > 0, r);
}
// --- upgrade persisted to live data + save ---
await page.evaluate(() => { const gs = (window).__game.scene.getScene('GameScene'), pl = gs.world.player; pl.world.playerDataFixture.xp = 0; pl.world.playerDataFixture.xpToNext = 30; pl.addXp(30); });
await page.waitForTimeout(900);
const btn = await page.evaluate(() => { const ls = (window).__game.scene.getScene('LevelUpScene'); return ls?.buttons?.[0] ? { x: ls.buttons[0].x, y: ls.buttons[0].y } : null; });
const choice = await page.evaluate(() => (window).__game.scene.getScene('LevelUpScene')?.choices?.[0] ?? null);
if (!btn) {
  out.steps.push({ name: 'upgrade-persist', detail: { overlayOpened: false, choice } });
  check('upgrade-overlay-opened', false, { choice });
} else {
  await page.mouse.click(Math.round(btn.x), Math.round(btn.y));
  await page.waitForTimeout(900);
  const upLive = await live();
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}'));
  out.steps.push({ name: 'upgrade-persist', detail: { overlayOpened: true, choice, liveUpgrades: upLive.upgrades, saveUpgrades: save.run?.player?.upgrades ?? null } });
  check('upgrade-recorded-live-and-saved', upLive.upgrades.length >= 1 && (save.run?.player?.upgrades ?? []).length >= 1, { upLive, save: save.run?.player?.upgrades });
}
out.errors.length === 0 && check('no-console-error', true);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-closure-final/closure-smoke-log.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
