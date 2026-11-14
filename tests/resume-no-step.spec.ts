import { expect, test, type Page } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 5173);

async function waitForScene(page: Page, name: string) {
  await page.waitForFunction((key) => (window as any).__game?.scene.isActive(key), name);
}

async function startRun(page: Page) {
  await page.goto(`http://localhost:${PORT}/`);
  await waitForScene(page, 'MainMenuScene');
  const pos = await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const t = s.children.list.find((c: any) => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  });
  if (!pos) throw new Error('NEW RUN button not found');
  await page.mouse.click(pos.x, pos.y);
  await waitForScene(page, 'GameScene');
}

test('pause resume does not advance: real onResume/onLevelUpClosed + sub-tick update', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startRun(page);

  // 1) Real pause -> enqueue a command -> real onResume. The callback must not
  //    advance a tick; the queued command stays pending until a real full tick.
  const outcome = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = g.scene.getScene('GameScene');
    const w = gs.world;
    const snap = () => ({
      tick: w.sim.tick, hp: w.sim.player.data.hp, maxHp: w.sim.player.data.maxHp, currency: w.sim.player.data.currency,
      enemies: w.enemies.length, projectiles: w.sim.projectiles.length,
      dashTimer: w.sim.player.dashTimer, invuln: w.sim.player.invuln,
      hurtTimer: w.sim.player.hurtTimer, fireTimer: w.sim.player.fireTimer
    });
    gs.onPause();
    w.enqueueCurrency(10);
    w.enqueueHeal(5);
    const before = snap();
    gs.onResume();
    gs.scene.stop('PauseScene');
    const afterResume = snap();
    gs.update(0, 5); // sub-tick frame: must not commit
    const afterSmall = snap();
    gs.update(0, 20); // enough for exactly one tick
    const afterEnough = snap();
    return { before, afterResume, afterSmall, afterEnough };
  });

  expect(outcome.afterResume, 'onResume does not advance any state').toEqual(outcome.before);
  expect(outcome.afterSmall, 'sub-tick frame commits nothing').toEqual(outcome.before);
  expect(outcome.afterEnough.tick, 'exactly one tick after enough delta').toBe(outcome.before.tick + 1);
  expect(outcome.afterEnough.currency, 'queued currency commits once').toBe(outcome.before.currency + 10);
  expect(outcome.afterEnough.hp, 'queued heal commits once').toBe(Math.min(outcome.before.hp + 5, outcome.before.maxHp));

  // Production RAF still runs after resume (not permanently paused).
  const tickNow = outcome.afterEnough.tick;
  await page.waitForTimeout(80);
  const later = await page.evaluate((tick: number) => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return w.sim.tick > tick;
  }, tickNow);
  expect(later, 'real RAF advances after resume').toBe(true);

  expect(errors).toEqual([]);
});

test('level-up close path does not advance; upgrade commits once on a real tick', async ({ page }) => {
  await startRun(page);
  await page.evaluate(() => {
    const gs = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    w.playerDataFixture.xp = 0;
    w.playerDataFixture.xpToNext = 30;
    w.player.addXp(30);
    w.resetSimulationAccumulator();
    w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  });
  await waitForScene(page, 'LevelUpScene');

  const outcome = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = g.scene.getScene('GameScene');
    const w = gs.world;
    const ls = g.scene.getScene('LevelUpScene');
    const snap = () => ({
      tick: w.sim.tick,
      upgrades: JSON.stringify(w.sim.player.data.upgrades),
      hp: w.sim.player.data.hp,
      enemies: w.enemies.length,
      projectiles: w.sim.projectiles.length,
      timers: [w.sim.player.dashTimer, w.sim.player.invuln, w.sim.player.hurtTimer, w.sim.player.fireTimer]
    });
    const before = snap();
    (ls as any).choose((ls as any).choices[0]);
    const afterChoose = snap();
    gs.onLevelUpClosed(); // real close callback
    gs.scene.stop('LevelUpScene');
    const afterClose = snap();
    gs.update(0, 5);
    const afterSmall = snap();
    gs.update(0, 20);
    const afterEnough = snap();
    return { before, afterChoose, afterClose, afterSmall, afterEnough, key: (ls as any).choices[0] };
  });

  expect(outcome.afterChoose.tick, 'choosing does not advance').toBe(outcome.before.tick);
  expect(outcome.afterChoose.upgrades, 'upgrade not yet committed').toBe(outcome.before.upgrades);
  expect(outcome.afterClose, 'level-up close does not advance state').toEqual(outcome.before);
  expect(outcome.afterSmall, 'sub-tick frame commits nothing').toEqual(outcome.before);
  expect(outcome.afterEnough.tick, 'one tick after enough delta').toBe(outcome.before.tick + 1);
  const upgrades = JSON.parse(outcome.afterEnough.upgrades) as Array<{ key: string; level: number }>;
  expect(upgrades.filter((u) => u.key === outcome.key), 'upgrade recorded exactly once').toHaveLength(1);
  expect(upgrades.find((u) => u.key === outcome.key)?.level).toBe(1);
});

test('inventory close path commits the equipped weapon once via normal frames', async ({ page }) => {
  await startRun(page);
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    const d = w.playerDataFixture;
    if (!d.weapons.some((x: any) => x.key === 'scatter')) {
      d.weapons.push({ key: 'scatter', level: 1, ammo: 8, magazine: 8, reloading: false, reloadTimer: 0 });
    }
  });
  await page.keyboard.press('i');
  await waitForScene(page, 'PauseScene');
  // Queue the equip through the real inventory shortcut (weapon index 1).
  await page.keyboard.press('2');
  const queued = await page.evaluate(() => {
    const gs = (window as any).__game.scene.getScene('GameScene');
    return { weapon: gs.world.sim.player.data.weaponKey, pending: gs.world.getPendingEquipWeapon() };
  });
  expect(queued.weapon, 'not equipped before close').toBe('pulse');
  expect(queued.pending, 'equip is queued (pending)').toBe('scatter');

  // Close the inventory (real onResume path). No forced tick.
  await page.keyboard.press('i');
  await page.waitForFunction(() => !(window as any).__game.scene.isActive('PauseScene'));
  // Normal production frames commit it exactly once.
  await expect.poll(async () => page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return w.sim.player.data.weaponKey;
  })).toBe('scatter');
  const weapons = await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return w.sim.player.data.weapons.map((x: any) => x.key);
  });
  expect(weapons.filter((k: string) => k === 'scatter')).toHaveLength(1);
});
