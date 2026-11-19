// Browser probe: purchase flow while paused -> close -> commit -> visible feedback.
// Also: no tick stolen while the dialog is open, checkpoint saved once,
// and production gating of enqueueSetPlayerData (checked separately on preview).
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5393);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/economy.html`);
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 15000 });
await page.evaluate(() => {
  const menu = window.__game.scene.getScene('MainMenuScene');
  const start = menu.scene.start.bind(menu.scene);
  menu.scene.start = (key, data) => start(key, key === 'GameScene' ? { ...data, seed: 424242 } : data);
});
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 15000 });

// Reach a safe supply terminal (dev fixture use is legitimate on the dev server).
await page.evaluate(() => {
  const { world } = window.__game.scene.getScene('GameScene');
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  world.player.reset(world.portal.wx, world.portal.wy);
  world.resetSimulationAccumulator();
  world.stepFrame(1000 / 60 + 1e-6, neutral);
  world.tryInteract(world.player);
  world.resetSimulationAccumulator();
  world.stepFrame(1000 / 60 + 1e-6, neutral);
  world.resetSimulationAccumulator();
  world.stepFrame(1000 / 60 + 1e-6, neutral);
  for (const enemy of world.enemies) { if (enemy.sprite?.scene) enemy.sprite.destroy(); }
  world.enemies = [];
  if (world.boss) { if (world.boss.sprite?.scene) world.boss.sprite.destroy(); world.boss = null; }
  world.simFixture.drones = [];
  world.simFixture.targets = [];
});
for (let i = 0; i < 5; i += 1) {
  await page.evaluate(() => {
    const { world } = window.__game.scene.getScene('GameScene');
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  });
}
await page.waitForFunction(() => {
  const w = window.__game.scene.getScene('GameScene').world;
  return !w.hasUncommittedCommands();
});
const terminalVisible = await page.locator('#supply-open').isVisible();

// Seed an affordable, injured player and persist the baseline checkpoint.
await page.evaluate(() => {
  const scene = window.__game.scene.getScene('GameScene');
  const data = scene.world.playerDataFixture;
  data.currency = 200;
  data.hp = 40;
  scene.saveCheckpoint();
});
const beforeCp = await page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}'));

await page.locator('#supply-open').click();
const dialog = page.getByRole('dialog', { name: 'Supply terminal' });
await dialog.waitFor({ state: 'visible' });

const repair = dialog.getByRole('button', { name: 'Buy Repair kit for 16 credits' });
const repairEnabled = await repair.isEnabled();
await repair.click();
const feedbackText = await dialog.getByText(/Close the terminal to complete your purchase/).textContent().catch(() => null);
const repairDisabledAfterClick = await repair.isDisabled();

// While paused: no tick, currency unchanged, commands pending.
const pausedState = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  return {
    scenePaused: gs.paused,
    pending: w.hasUncommittedCommands(),
    pendingTypes: w.sim.pendingCommands.map((c) => c.type),
    currency: w.sim.player.data.currency,
    tick: w.sim.tick
  };
});

// Close the dialog -> scene resumes -> next tick commits -> receipt -> save -> feedback.
await page.locator('#supply-close').click();
await page.waitForFunction(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  return gs && !gs.paused && !gs.world.hasUncommittedCommands();
});
await page.waitForTimeout(400);
const bannerText = await page.locator('#supply-reward').textContent().catch(() => null);
const bannerVisible = await page.locator('#supply-reward').isVisible();
const afterCp = await page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}'));
const liveState = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  return { currency: gs.world.sim.player.data.currency, hp: gs.world.sim.player.data.hp, tick: gs.world.sim.tick };
});

console.log(JSON.stringify({
  terminalVisible, repairEnabled, feedbackText, repairDisabledAfterClick,
  pausedState, bannerText, bannerVisible,
  cpBefore: { currency: beforeCp?.run?.player?.currency, hp: beforeCp?.run?.player?.hp },
  cpAfter: { currency: afterCp?.run?.player?.currency, hp: afterCp?.run?.player?.hp },
  liveState,
  tickAdvancedWhilePaused: pausedState.tick,
  pageErrors: errors
}, null, 2));
await browser.close();
