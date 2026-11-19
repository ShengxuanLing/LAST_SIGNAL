// Independent storage-failure probe (economy.html, 780cece): injected Storage.setItem failure
// must keep the purchase pending (no "Purchased"), not double-deduct, and complete exactly
// once after recovery; the on-disk checkpoint must stay unchanged while storage fails.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5296/';
const out = { meta: { url: BASE, target: '780cece', fixture: 'room cleared + known currency/hp baseline (same shape as the official spec)' }, checks: [], steps: [], errors: [] };
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
  world.simFixture.drones = []; world.simFixture.targets = [];
  for (const e of world.enemies) if (e.sprite?.scene) e.sprite.destroy();
  world.enemies = [];
  if (world.boss) { if (world.boss.sprite?.scene) world.boss.sprite.destroy(); world.boss = null; }
  for (let i = 0; i < 5; i++) { world.resetSimulationAccumulator(); world.stepFrame(1000 / 60 + 1e-6, neutral); }
  const data = world.playerDataFixture; data.currency = 200; data.hp = 40;
  (window).__game.scene.getScene('GameScene').saveCheckpoint();
});
await page.waitForFunction(() => { const w = (window).__game.scene.getScene('GameScene').world; return !w.hasUncommittedCommands(); }, { timeout: 8000 });
const base = await page.evaluate(() => {
  const w = (window).__game.scene.getScene('GameScene').world;
  const disk = JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}').run?.player?.currency;
  return { currency: w.sim.player.data.currency, hp: w.sim.player.data.hp, disk, ledger: w.sim.purchaseTransactions.length };
});
out.steps.push({ name: 'baseline', detail: base });
// inject storage failure
await page.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('Storage unavailable for the test'); }; window.addEventListener('restore-test-storage', () => { Storage.prototype.setItem = o; }, { once: true }); });
await page.locator('#supply-open').click();
const terminal = page.getByRole('dialog', { name: 'Supply terminal' });
await terminal.getByRole('button', { name: 'Buy Repair kit for 16 credits' }).click();
await terminal.getByText(/Close the terminal to complete your purchase/).isVisible().catch(() => {});
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
const failed = await page.evaluate(() => {
  const g = window.__game, w = g.scene.getScene('GameScene').world;
  return {
    reward: document.querySelector('#supply-reward')?.textContent ?? '',
    memCurrency: w.sim.player.data.currency, memHp: w.sim.player.data.hp,
    pending: w.sim.pendingCommands.map((c) => c.type), ledger: w.sim.purchaseTransactions.length
  };
});
const diskDuring = (await readSave()).run?.player?.currency;
out.steps.push({ name: 'storage-failed', detail: { failed, diskDuring, base } });
check('no-purchased-claim-while-storage-fails', !/Purchased/.test(failed.reward) && /could not be saved/i.test(failed.reward), failed);
check('memory-deducted-once', failed.memCurrency === base.currency - 16 && failed.memHp === 75, { base, failed });
check('disk-unchanged-while-failing', diskDuring === base.disk, { diskDuring, base });
// recover -> retry completes exactly once
await page.evaluate(() => window.dispatchEvent(new Event('restore-test-storage')));
await page.waitForTimeout(1200);
const recovered = await page.evaluate(() => {
  const g = window.__game, w = g.scene.getScene('GameScene').world;
  return { reward: document.querySelector('#supply-reward')?.textContent ?? '', memCurrency: w.sim.player.data.currency, memHp: w.sim.player.data.hp, ledger: w.sim.purchaseTransactions.length };
});
const saveAfter = await readSave();
out.steps.push({ name: 'recovered', detail: { recovered, save: { currency: saveAfter.run?.player?.currency, hp: saveAfter.run?.player?.hp, ledger: saveAfter.run?.coreState?.purchaseTransactions?.length } } });
check('retry-completes-once', /Purchased Repair kit/.test(recovered.reward) && saveAfter.run?.player?.currency === base.currency - 16 && saveAfter.run?.player?.hp === 75, { recovered, save: saveAfter.run?.player });
check('ledger-kept-one-record', recovered.ledger === base.ledger + 1 && (saveAfter.run?.coreState?.purchaseTransactions?.length ?? 0) === base.ledger + 1, { recovered, base });
out.errors.length === 0 && check('no-console-error', true);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-resume-final/storage-retry-log.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
