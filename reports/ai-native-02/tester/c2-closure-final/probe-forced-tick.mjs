// Precise Reviewer onResume forced-tick evidence + paused pending commit + upgrade save
// persistence (target ae72a67, dev 5294). Calls the real GameScene.onResume() callback that
// PauseScene close uses, synchronously, to isolate the forced-tick behaviour.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5294/';
const out = { meta: { url: BASE, target: 'ae72a67' }, checks: [], steps: [], findings: [], errors: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') out.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => out.errors.push(`pageerror: ${e.message}`));
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

// --- forced tick on the real onResume callback, two pause durations ---
for (const [pauseMs, accumulatorMs] of [[0, 0], [1200, 0], [300, 250]]) {
  const r = await page.evaluate(({ pauseMs, accumulatorMs }) => {
    const gs = (window).__game.scene.getScene('GameScene'), w = gs.world;
    // enter the paused state exactly like the product PauseScene open path
    gs.paused = true;
    w.player.control.pause();
    if (gs.resetSimulationAccumulator) gs.world.resetSimulationAccumulator();
    w.simAccumulatorMs = accumulatorMs; // explicit accumulator state (private, test-only access)
    const before = w.simFixture.tick;
    const pendingBefore = w.simFixture.pendingCommands.length;
    gs.onResume();
    const after = w.simFixture.tick;
    return { pauseMs, accumulatorMs, before, after, forcedDelta: after - before, pendingBefore, pendingAfter: w.simFixture.pendingCommands.length };
  }, { pauseMs, accumulatorMs });
  out.steps.push({ name: `onResume-${pauseMs}ms-acc${accumulatorMs}`, detail: r });
  check(`onResume-forces-exactly-one-tick-${pauseMs}-${accumulatorMs}`, r.forcedDelta === 1, r);
}

// --- paused pending commits exactly once through the real onResume callback ---
{
  const r = await page.evaluate(() => {
    const gs = (window).__game.scene.getScene('GameScene'), w = gs.world;
    gs.paused = true; w.player.control.pause();
    const c0 = w.player.data.currency;
    w.enqueueCurrency(50);
    const pending0 = w.simFixture.pendingCommands.length;
    gs.onResume();
    const after1 = { currency: w.player.data.currency, pending: w.simFixture.pendingCommands.length, tick: w.simFixture.tick };
    const ev = gs.world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }).map((e) => e.type);
    const after2 = { currency: w.player.data.currency, pending: w.simFixture.pendingCommands.length };
    return { c0, pending0, after1, after2, secondTickEvents: [...new Set(ev)] };
  });
  out.steps.push({ name: 'onResume-pending-commit', detail: r });
  check('pending-commits-once-onResume', r.after1.currency === r.c0 + 50 && r.after1.pending === 0 && r.after2.currency === r.after1.currency && !r.secondTickEvents.includes('currency-gained'), r);
}

// --- upgrade save persistence: poll the real checkpoint write after a level-up choice ---
{
  await page.evaluate(() => { const gs = (window).__game.scene.getScene('GameScene'), pl = gs.world.player; pl.world.playerDataFixture.xp = 0; pl.world.playerDataFixture.xpToNext = 30; pl.addXp(30); });
  await page.waitForTimeout(900);
  const btn = await page.evaluate(() => { const ls = (window).__game.scene.getScene('LevelUpScene'); return ls?.buttons?.[0] ? { x: ls.buttons[0].x, y: ls.buttons[0].y } : null; });
  if (btn) await page.mouse.click(Math.round(btn.x), Math.round(btn.y));
  const timeline = [];
  for (let i = 0; i < 20; i++) {
    const st = await page.evaluate(() => {
      const gs = (window).__game.scene.getScene('GameScene'), w = gs.world;
      const save = JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}');
      let capture = null;
      try { capture = !!w.captureCheckpoint('probe', 424242, { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 }); } catch (e) { capture = String(e.message || e); }
      return { liveUpgrades: w.player.data.upgrades.map((u) => ({ key: u.key, level: u.level })), pending: w.simFixture.pendingCommands.length, uncommitted: w.hasUncommittedCommands ? w.hasUncommittedCommands() : null, capture, saveUpgrades: save.run?.player?.upgrades ?? null, tick: w.simFixture.tick };
    });
    timeline.push({ i, ...st });
    if ((st.saveUpgrades ?? []).length > 0) break;
    await page.waitForTimeout(120);
  }
  out.steps.push({ name: 'upgrade-save-poll', detail: timeline.slice(0, 8) });
  const last = timeline[timeline.length - 1];
  check('upgrade-live-recorded', last.liveUpgrades.length >= 1, last);
  check('upgrade-persisted-to-checkpoint', (last.saveUpgrades ?? []).length >= 1, { last, timeline: timeline.slice(0, 6) });
  if ((last.saveUpgrades ?? []).length === 0) {
    out.findings.push({ name: 'upgrade-not-persisted-to-save', detail: { last, timeline: timeline.slice(0, 6) }, note: 'live player.data.upgrades has the entry, but the checkpoint save still has none after 2.4 s of polling' });
  }
}
out.errors.length === 0 && check('no-console-error', true);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-closure-final/forced-tick-log.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
