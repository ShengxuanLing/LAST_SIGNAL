import { expect, test, type Page } from '@playwright/test';
import { SAVE_KEY } from '../src/config/game';

function readSave(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), SAVE_KEY);
}

async function waitForScene(page: Page, key: string) {
  await page.waitForFunction((name) => (window as any).__game?.scene.isActive(name), key, { timeout: 10000 });
}

// Click a menu / Game-Over button by its on-screen Text label instead of
// hard-coding pixel coordinates: locate the Phaser Text object in the active
// scene, take its position, and click there. Keeps the test robust to layout.
async function clickButton(page: Page, label: string) {
  const pos = await page.evaluate((label) => {
    const g = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const t = s.children.list.find(
        (c: any) => c.type === 'Text' && (c.text || '').trim().startsWith(label) && c.visible !== false
      );
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  }, label);
  if (!pos) throw new Error(`button not found: "${label}"`);
  await page.mouse.click(pos.x, pos.y);
}

// Make NEW RUN deterministic (fixed seed) by instrumenting MainMenuScene.start.
async function fixSeed(page: Page, seed: number) {
  await page.evaluate((seed) => {
    const menu = (window as any).__game.scene.getScene('MainMenuScene');
    const plugin = menu.scene;
    const start = plugin.start.bind(plugin);
    plugin.start = (key: string, data: object) =>
      start(key, key === 'GameScene' ? { ...data, seed } : data);
  }, seed);
}

// Choose the first level-up card by its real button hit-area (no coordinates).
async function pickFirstCard(page: Page) {
  const card = await page.evaluate(() => {
    const g = (window as any).__game;
    const ls = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'LevelUpScene') as any;
    return ls && ls.buttons.length ? { x: ls.buttons[0].x, y: ls.buttons[0].y } : null;
  });
  expect(card, 'level-up card available').not.toBeNull();
  await page.mouse.click(Math.round(card!.x), Math.round(card!.y));
}

test('inventory equips an owned weapon and the safe checkpoint restores the selection', async ({ page }) => {
  await page.goto('/');
  await waitForScene(page, 'MainMenuScene');
  await fixSeed(page, 424242);
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ permanent: { unlockedWeapons: ['pulse', 'scatter', 'plasma'] } }));
  }, SAVE_KEY);
  await clickButton(page, 'NEW RUN');
  await waitForScene(page, 'GameScene');

  const inventory = () => page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game.scene.getScene('PauseScene');
    const player = game.scene.getScene('GameScene').world.player;
    const buttons = scene.children.list
      .filter((child: any) => child.type === 'Text' && ['EQUIP', 'EQUIPPED'].includes(child.text))
      .map((child: any) => ({ label: child.text, y: child.y, enabled: child.input?.enabled ?? false }));
    return { weapon: player.data.weaponKey, buttons };
  });

  await page.keyboard.press('i');
  await expect.poll(async () => (await inventory()).buttons).toEqual([
    { label: 'EQUIPPED', y: 186, enabled: false },
    { label: 'EQUIP', y: 230, enabled: true },
    { label: 'EQUIP', y: 274, enabled: true }
  ]);
  await page.mouse.click(420, 242); // Equip Scatter Gun using its on-screen button.
  await expect.poll(inventory).toEqual({
    weapon: 'scatter',
    buttons: [
      { label: 'EQUIP', y: 186, enabled: true },
      { label: 'EQUIPPED', y: 230, enabled: false },
      { label: 'EQUIP', y: 274, enabled: true }
    ]
  });
  await page.keyboard.press('e');
  expect((await inventory()).weapon).toBe('scatter');

  await clickButton(page, 'CLOSE');
  await page.waitForFunction(() => !(window as any).__game.scene.isActive('PauseScene'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__game.scene.isActive('PauseScene'));
  await clickButton(page, 'QUIT TO MENU');
  await waitForScene(page, 'MainMenuScene');
  expect((await readSave(page)).run.player.weaponKey).toBe('scatter');

  await clickButton(page, 'CONTINUE');
  await waitForScene(page, 'GameScene');
  await page.keyboard.press('i');
  await expect.poll(async () => (await inventory()).buttons[1]?.label).toBe('EQUIPPED');
  expect((await inventory()).weapon).toBe('scatter');
});

test('resume reuses the checkpoint id and restores saved HP / run-scoped progress', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForScene(page, 'MainMenuScene');
  await fixSeed(page, 424242);

  await clickButton(page, 'NEW RUN');
  await waitForScene(page, 'GameScene');
  await expect.poll(async () => (await readSave(page)).run?.clearedRooms.length).toBe(1);

  // Spawn + clear enemies, then gain a level and pick a run-scoped upgrade.
  await page.evaluate(() => {
    const game = (window as any).__game.scene.getScene('GameScene');
    const { world } = game;
    world.player.reset(world.portal.wx, world.portal.wy);
    world.tryInteract(world.player);
  });
  await page.waitForFunction(() =>
    (window as any).__game.scene.getScene('GameScene').world.enemies.length > 0);
  await page.evaluate(() => {
    const game = (window as any).__game.scene.getScene('GameScene');
    const { world } = game;
    for (const enemy of world.enemies) enemy.sprite.destroy();
    world.enemies = [];
    world.spawnLoot(world.player.x, world.player.y, 'currency', 'currency', 42);
    world.player.addXp(30);
  });
  await waitForScene(page, 'LevelUpScene');
  await pickFirstCard(page);

  await expect.poll(async () => (await readSave(page)).run?.player.upgrades.length).toBe(1);
  await expect.poll(async () => (await readSave(page)).run?.player.currency).toBeGreaterThanOrEqual(42);

  const before = await readSave(page);
  expect(before.run.clearedRooms).toHaveLength(2);
  expect(before.permanent).toMatchObject({ cores: 0, maxHpBonus: 0, armorBonus: 0, damageBonus: 0 });

  // ---- Resume via the menu (state-driven buttons, not coordinates) ----
  await page.reload();
  await waitForScene(page, 'MainMenuScene');

  // CONTINUE must be present and enabled (a checkpoint exists) — state assertion.
  const menu = await page.evaluate(() => {
    const m = (window as any).__game.scene.getScene('MainMenuScene');
    const labels = m.children.list.filter((c: any) => c.type === 'Text').map((c: any) => c.text);
    const dim = m.children.list.filter((c: any) => c.type === 'Rectangle' && c.fillAlpha === 0.16).length;
    return { hasContinue: labels.includes('CONTINUE'), dim };
  });
  expect(menu.hasContinue, 'CONTINUE button present when a checkpoint exists').toBe(true);
  expect(menu.dim, 'CONTINUE not dimmed when a checkpoint exists').toBe(0);

  await clickButton(page, 'CONTINUE');
  await waitForScene(page, 'GameScene');

  // Contract: resume reuses the checkpoint id (stable across reload).
  await expect.poll(async () => (await readSave(page)).run?.id).toBe(before.run.id);

  const resumed = await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    return { player: world.player.data, room: world.currentRoom().id, enemies: world.enemies.length };
  });
  // HP is restored from the checkpoint verbatim (World.restoreCheckpoint keeps HP).
  expect(resumed.player.hp).toBe(before.run.player.hp);
  expect(resumed.player.maxHp).toBe(before.run.player.maxHp);
  expect(resumed.player).toMatchObject({
    upgrades: before.run.player.upgrades, currency: before.run.player.currency, level: before.run.player.level
  });
  expect(resumed.room).toBe(before.run.roomId);
  expect(resumed.enemies).toBe(0);

  // Victory still awards a single core and clears the run.
  await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    world.spawnBoss(world.map.rooms.find((room: any) => room.kind === 'boss'));
    world.killBoss();
  });
  await waitForScene(page, 'GameOverScene');
  const victory = await readSave(page);
  expect(victory.run).toBeUndefined();
  expect(victory.permanent).toMatchObject({ cores: 1, bossesDefeated: 1, maxHpBonus: 0 });

  // Permanent talents remain separate from the (now cleared) run.
  await clickButton(page, 'MAIN MENU');
  await waitForScene(page, 'MainMenuScene');
  await clickButton(page, 'PERMANENT TALENTS');
  await page.waitForFunction(() =>
    (window as any).__game.scene.getScene('MainMenuScene').children.list
      .some((child: any) => child.text === 'PERMANENT CORES: 1'));
  await clickButton(page, 'VITALITY 0 · +20% BASE HP · 1 CORE');
  await expect.poll(async () => (await readSave(page)).permanent).toMatchObject({ cores: 0, maxHpBonus: 1 });
  await clickButton(page, 'BACK');
  await page.waitForFunction(() =>
    (window as any).__game.scene.getScene('MainMenuScene').children.list
      .some((child: any) => child.text === 'NEW RUN'));

  // NEW RUN on top of an already-cleared run starts a brand-new run (new id).
  await clickButton(page, 'NEW RUN');
  await waitForScene(page, 'GameScene');
  await expect.poll(async () => (await readSave(page)).run?.player).toMatchObject({
    hp: 120, maxHp: 120, currency: 0, upgrades: [], level: 1
  });
  const fresh = await readSave(page);
  expect(fresh.run.id, 'NEW RUN generates a fresh id (not the resumed one)').not.toBe(before.run.id);

  expect(errors).toEqual([]);
});

test('death routes to Game Over and clears the run checkpoint', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForScene(page, 'MainMenuScene');
  await fixSeed(page, 424242);

  await clickButton(page, 'NEW RUN');
  await waitForScene(page, 'GameScene');
  // A checkpoint must exist before death so we can prove it gets cleared.
  await expect.poll(async () => (await readSave(page)).run).toBeDefined();

  // Drive the real death path: World.onPlayerDeath -> GameScene.onDeath ->
  // finishRun(id, false) + scene.start('GameOverScene').
  await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    world.onPlayerDeath();
  });
  await waitForScene(page, 'GameOverScene');

  await expect.poll(async () => (await readSave(page)).run, 'run checkpoint cleared on death').toBeUndefined();
  const afterDeath = await readSave(page);
  expect(afterDeath.permanent, 'permanent progression untouched by death')
    .toMatchObject({ cores: 0, maxHpBonus: 0 });

  // Returning to the menu shows no checkpoint: CONTINUE is dimmed / disabled.
  await clickButton(page, 'MAIN MENU');
  await waitForScene(page, 'MainMenuScene');
  const noCheckpoint = await page.evaluate(() => {
    const m = (window as any).__game.scene.getScene('MainMenuScene');
    const labels = m.children.list.filter((c: any) => c.type === 'Text').map((c: any) => c.text);
    const dim = m.children.list.filter((c: any) => c.type === 'Rectangle' && c.fillAlpha === 0.16).length;
    return labels.includes('CONTINUE') && dim >= 1;
  });
  expect(noCheckpoint, 'CONTINUE dimmed after death (no checkpoint)').toBe(true);

  // Clicking the dimmed CONTINUE must NOT start a run.
  await clickButton(page, 'CONTINUE');
  await page.waitForTimeout(200);
  await expect.poll(async () => page.evaluate(() => {
    const g = (window as any).__game;
    return g.scene.getScenes(true).map((s: any) => s.constructor.name);
  })).not.toContain('GameScene');

  expect(errors).toEqual([]);
});
