import { expect, test, type Page } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 5173);

async function waitForScene(page: Page, name: string) {
  await page.waitForFunction((key) => (window as any).__game?.scene.isActive(key), name);
}

/** Enter the first room, clear it, and wait for a safe supply terminal. */
async function reachSafeTerminal(page: Page) {
  await page.goto(`http://localhost:${PORT}/economy.html`);
  await waitForScene(page, 'MainMenuScene');
  await page.evaluate(() => {
    const menu = (window as any).__game.scene.getScene('MainMenuScene');
    const start = menu.scene.start.bind(menu.scene);
    menu.scene.start = (key: string, data: object) => start(key, key === 'GameScene' ? { ...data, seed: 424242 } : data);
  });
  await page.mouse.click(640, 340);
  await waitForScene(page, 'GameScene');
  await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    world.player.reset(world.portal.wx, world.portal.wy);
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, neutral);
    world.tryInteract(world.player);
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, neutral);
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, neutral);
  });
  await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    for (const enemy of world.enemies) { if (enemy.sprite?.scene) enemy.sprite.destroy(); }
    world.enemies = [];
    if (world.boss) { if (world.boss.sprite?.scene) world.boss.sprite.destroy(); world.boss = null; }
    world.simFixture.drones = [];
    world.simFixture.targets = [];
  });
  for (let i = 0; i < 5; i += 1) {
    await page.evaluate(() => {
      const { world } = (window as any).__game.scene.getScene('GameScene');
      world.resetSimulationAccumulator();
      world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    });
  }
  await page.waitForFunction(() => !(window as any).__game.scene.getScene('GameScene').world.hasUncommittedCommands());
  await expect(page.locator('#supply-open')).toBeVisible();
}

test('processed purchase id is persisted and cannot be replayed (rendered + restore)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await reachSafeTerminal(page);

  await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('GameScene');
    const data = scene.world.playerDataFixture;
    data.currency = 200;
    data.hp = 40;
    scene.saveCheckpoint();
  });

  // Buy Repair kit through the real UI (queued on click, committed on close).
  await page.locator('#supply-open').click();
  const dialog = page.getByRole('dialog', { name: 'Supply terminal' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Buy Repair kit for 16 credits' }).click();
  await expect(dialog.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#supply-reward')).toContainText('Purchased Repair kit.');

  const bought = await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return { currency: w.sim.player.data.currency, ledger: [...w.sim.purchaseTransactions], roomId: w.currentRoom().id };
  });
  expect(bought.ledger).toHaveLength(1);
  const txId = bought.ledger[0] as string;

  // Replay the same transaction id (with a different offer) in the same run.
  const replay = await page.evaluate(({ txId }) => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    const before = w.sim.player.data.currency;
    w.enqueuePurchaseSupply(txId, 'weapon', w.currentRoom().id);
    w.resetSimulationAccumulator();
    w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    const receipt = w.getSupplyReceipt(txId);
    return { ok: receipt?.ok, reason: receipt?.reason, before, currency: w.sim.player.data.currency, ledgerLen: w.sim.purchaseTransactions.length };
  }, { txId });
  expect(replay.ok, 'replayed id is rejected').toBe(false);
  expect(replay.reason, 'stable duplicate reason').toBe('Duplicate transaction');
  expect(replay.currency, 'no double deduction').toBe(replay.before);
  expect(replay.ledgerLen, 'ledger does not grow on replay').toBe(bought.ledger.length);

  // Reload -> CONTINUE: the checkpoint must carry the processed id.
  await page.reload();
  await waitForScene(page, 'MainMenuScene');
  await page.mouse.click(640, 460); // CONTINUE
  await waitForScene(page, 'GameScene');
  const restored = await page.evaluate(({ txId }) => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    const ledger = [...w.sim.purchaseTransactions];
    const before = w.sim.player.data.currency;
    w.enqueuePurchaseSupply(txId, 'repair', w.currentRoom().id);
    w.resetSimulationAccumulator();
    w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    const receipt = w.getSupplyReceipt(txId);
    return { ledger, ok: receipt?.ok, reason: receipt?.reason, before, currency: w.sim.player.data.currency };
  }, { txId });
  expect(restored.ledger, 'restored checkpoint preserves processed ids').toContain(txId);
  expect(restored.ok, 'restored replay is rejected').toBe(false);
  expect(restored.reason, 'restored replay is a stable duplicate').toBe('Duplicate transaction');
  expect(restored.currency, 'restored replay does not deduct').toBe(restored.before);
  expect(errors).toEqual([]);
});
