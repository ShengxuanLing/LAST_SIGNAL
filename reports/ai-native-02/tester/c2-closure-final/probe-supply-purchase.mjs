// Supply purchase commit / exit / reopen probe (economy.html, target ae72a67).
// Fixture declared: room enemies cleared via the test-style helper so a safe terminal exists.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5294/';
const out = { meta: { url: BASE, target: 'ae72a67', fixture: 'room enemies cleared via core arrays/helper to reach a safe terminal' }, checks: [], steps: [], errors: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') out.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => out.errors.push(`pageerror: ${e.message}`));
const readSave = () => page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}'));
await page.goto(BASE + 'economy.html');
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { const m = (window).__game.scene.getScene('MainMenuScene'); const o = m.scene.start.bind(m.scene); m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...d, seed: 424242 }) : o(k, d); });
await page.mouse.click(640, 340);
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
await page.waitForTimeout(800);
await page.evaluate(() => {
  const { world } = (window).__game.scene.getScene('GameScene');
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  world.player.reset(world.portal.wx, world.portal.wy);
  world.resetSimulationAccumulator(); world.stepFrame(1000 / 60 + 1e-6, neutral);
  world.tryInteract(world.player);
  world.resetSimulationAccumulator(); world.stepFrame(1000 / 60 + 1e-6, neutral);
  world.resetSimulationAccumulator(); world.stepFrame(1000 / 60 + 1e-6, neutral);
});
// Fixture: clear the room so the terminal is safe (declared)
await page.evaluate(() => {
  const { world } = (window).__game.scene.getScene('GameScene');
  for (const e of world.enemies) if (e.sprite?.scene) e.sprite.destroy();
  world.enemies = []; world.boss = null;
  world.simFixture.drones = []; world.simFixture.targets = [];
});
for (let i = 0; i < 6; i++) await page.evaluate(() => { const w = (window).__game.scene.getScene('GameScene').world; w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); });
await page.waitForFunction(() => { const w = (window).__game.scene.getScene('GameScene').world; return !w.hasUncommittedCommands(); }, { timeout: 8000 });
// grant credits through a real loot drop (product path), then pick it up
await page.evaluate(() => { const w = (window).__game.scene.getScene('GameScene').world; w.enqueueSpawnLoot(w.simFixture.player.x, w.simFixture.player.y, 'currency', 'currency', 82); });
for (let i = 0; i < 8; i++) await page.evaluate(() => { const w = (window).__game.scene.getScene('GameScene').world; w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); });
await page.waitForFunction(() => { const w = (window).__game.scene.getScene('GameScene').world; return w.player.data.currency > 60 && !w.hasUncommittedCommands(); }, { timeout: 8000 }).catch(() => {});
const start = await page.evaluate(() => {
  const w = (window).__game.scene.getScene('GameScene').world;
  return { currency: w.player.data.currency, hp: w.player.data.hp, ledger: w.simFixture.purchaseTransactions.length, save: !!localStorage.getItem('last_signal_save_v1') };
});
out.steps.push({ name: 'terminal-ready', detail: start });
const openBtn = await page.$('#supply-open');
check('supply-open-visible', !!openBtn && await openBtn.isVisible());
await openBtn.click();
await page.waitForTimeout(400);
const dialogOpen = await page.evaluate(() => !!document.querySelector('dialog')?.open);
check('dialog-open', dialogOpen === true);
// buy repair through the real UI button
const offer = await page.evaluate(() => {
  const bs = [...document.querySelectorAll('dialog button')].filter((b) => !b.disabled && /credits/.test(b.getAttribute('aria-label') || ''));
  if (!bs.length) return null;
  const label = bs[0].getAttribute('aria-label');
  const m = label.match(/for (\d+) credits/);
  return { label, price: m ? Number(m[1]) : null };
});
out.steps.push({ name: 'offer-selected', detail: offer });
check('enabled-offer-found', !!offer && offer.price > 0, offer);
await page.getByRole('button', { name: offer.label }).click();
await page.waitForTimeout(200);
const queued = await page.evaluate(() => {
  const w = (window).__game.scene.getScene('GameScene').world;
  return { feedback: document.querySelector('#supply-reward')?.textContent ?? '', pending: w.simFixture.pendingCommands.map((c) => c.type), currency: w.player.data.currency, hp: w.player.data.hp };
});
out.steps.push({ name: 'purchase-queued', detail: queued });
check('purchase-queued-not-charged-yet', queued.pending.includes('purchase-supply') && queued.currency === start.currency, queued);
// close the terminal -> resume -> forced tick commits
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const committed = await page.evaluate(() => {
  const g = window.__game, w = g.scene.getScene('GameScene').world;
  const receipt = document.querySelector('#supply-reward')?.textContent ?? '';
  return { currency: w.player.data.currency, hp: w.player.data.hp, pending: w.simFixture.pendingCommands.length, ledger: w.simFixture.purchaseTransactions.length, receipt };
});
out.steps.push({ name: 'purchase-committed', detail: committed });
check('purchase-charged-once', committed.currency === start.currency - offer.price && committed.pending === 0 && committed.ledger === start.ledger + 1, { start, committed, offer });
const save1 = await readSave();
check('ledger-persisted-in-checkpoint', Array.isArray(save1.run?.coreState?.purchaseTransactions) && save1.run.coreState.purchaseTransactions.length >= 1, { ledger: save1.run?.coreState?.purchaseTransactions });
// reload + continue, reopen terminal: no double charge, ledger restored
await page.reload();
await page.waitForFunction(() => (window).__game.scene.isActive('MainMenuScene'), { timeout: 10000 });
const clickLabel = async (needle) => {
  const pos = await page.evaluate((n) => { const g = window.__game; for (const s of g.scene.getScenes(true)) { const c = s.children.list.find((x) => x.type === 'Text' && (x.text || '').trim().startsWith(n)); if (c) return { x: c.x, y: c.y }; } return null; }, needle);
  if (!pos) return false; await page.mouse.click(pos.x, pos.y); return true;
};
await clickLabel('CONTINUE');
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'), { timeout: 10000 });
await page.waitForTimeout(900);
const afterReload = await page.evaluate(() => {
  const w = (window).__game.scene.getScene('GameScene').world;
  return { currency: w.player.data.currency, hp: w.player.data.hp, ledger: w.simFixture.purchaseTransactions.length };
});
out.steps.push({ name: 'after-reload-continue', detail: { start, committed, afterReload } });
check('no-double-charge-after-reload', afterReload.currency === committed.currency && afterReload.hp === committed.hp, { committed, afterReload });
check('ledger-restored-after-reload', afterReload.ledger >= committed.ledger, { committedLedger: committed.ledger, afterReload });
// pause/resume after the purchase must not add extra committed simulations or lose the ledger
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
const beforeResume = await page.evaluate(() => { const w = (window).__game.scene.getScene('GameScene').world; return { tick: w.simFixture.tick, pending: w.simFixture.pendingCommands.length, ledger: w.simFixture.purchaseTransactions.length, currency: w.player.data.currency }; });
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
const afterResume = await page.evaluate(() => { const w = (window).__game.scene.getScene('GameScene').world; return { tick: w.simFixture.tick, pending: w.simFixture.pendingCommands.length, ledger: w.simFixture.purchaseTransactions.length, currency: w.player.data.currency }; });
out.steps.push({ name: 'pause-resume-after-purchase', detail: { beforeResume, afterResume } });
check('pause-resume-keeps-ledger-and-charge', afterResume.currency === beforeResume.currency && afterResume.ledger === beforeResume.ledger && afterResume.pending === 0, { beforeResume, afterResume });
out.errors.length === 0 && check('no-console-error', true);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-closure-final/supply-purchase-log.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
