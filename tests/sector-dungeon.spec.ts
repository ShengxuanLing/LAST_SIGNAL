import { expect, test, type Page } from '@playwright/test';
import { SAVE_KEY } from '../src/config/game';
import { TOTAL_DECKS } from '../src/config/dungeon';
import type { RunCheckpoint } from '../src/types';

const readRun = (page: Page): Promise<RunCheckpoint | undefined> => page.evaluate((key) =>
  JSON.parse(localStorage.getItem(key) ?? '{}').run, SAVE_KEY);

const waitForDeck = (page: Page, deck: number) => page.waitForFunction((index) => {
  const game = (window as any).__game;
  return game?.scene.isActive('GameScene') && game.scene.getScene('GameScene').world?.map.deck === index;
}, deck);

async function clearLevelUp(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const active = await page.evaluate(() =>
      (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
    if (!active.includes('LevelUpScene')) return;
    await page.keyboard.press('1');
    await page.waitForTimeout(300);
  }
}

async function usePortal(page: Page) {
  await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    if (!world.portal) throw new Error('Room has no active portal');
    world.player.reset(world.portal.wx, world.portal.wy, false);
  });
  await clearLevelUp(page);
  await page.waitForFunction(() => !(window as any).__game.scene.getScene('GameScene').paused, { timeout: 5000 });
  const before = await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('GameScene');
    return { deck: scene.world.map.deck, room: scene.world.currentRoom().id, paused: scene.paused };
  });
  expect(before.paused, JSON.stringify(before)).toBe(false);
  await page.keyboard.press('f');
  await page.waitForFunction(({ deck, room }) => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    return world.map.deck !== deck || world.currentRoom()?.id !== room;
  }, before, { timeout: 8000 });
}

const worldState = (page: Page) => page.evaluate(() => {
  const scene = (window as any).__game.scene.getScene('GameScene');
  const { world } = scene;
  const room = world.currentRoom();
  return {
    deck: world.map.deck, roomId: room.id, kind: room.kind, objective: world.roomObjective,
    portal: world.portal ? { target: world.portal.targetRoom } : null,
    enemies: world.enemies.length, boss: world.boss?.name,
    hp: world.player.data.hp, credits: world.player.data.currency
  };
});

// 每进入一个 sector 后，先清掉除 boss 房以外的所有房间的敌人，使终点房（exit）解锁。
async function prepareSector(page: Page) {
  await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    for (const r of world.map.rooms) {
      if (r.kind === 'boss') continue;
      for (const e of world.enemies) if (e.data.spawnRoom === r.id) { if (e.sprite?.scene) e.sprite.destroy(); }
      world.enemies = world.enemies.filter((e) => e.data.spawnRoom !== r.id);
      r.cleared = true;
      r.spawned = true;
    }
    const end = world.map.rooms.find((r) => r.kind === 'boss' || r.kind === 'extraction');
    if (!end) throw new Error('no end room in map');
    const p = world.findWalkableInRoom(end);
    world.player.reset(p.x, p.y, false);
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    world.updateRoom();
  });
}

test('sector run locks encounters, descends all six decks and resumes from the same deck', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  await page.evaluate(() => {
    const plugin = (window as any).__game.scene.getScene('MainMenuScene').scene;
    const start = plugin.start.bind(plugin);
    plugin.start = (name: string, data: object) => start(name, { ...data, seed: 424242 });
  });
  await page.mouse.click(640, 580);
  await waitForDeck(page, 0);
  const initial = (await readRun(page))!;
  expect(initial).toMatchObject({ deck: 0, seed: 424242, roomId: 0 });

  const bosses: string[] = [];
  for (let deck = 0; deck < TOTAL_DECKS; deck++) {
    await waitForDeck(page, deck);
    const st0 = await worldState(page);
    expect(st0.deck).toBe(deck);

    await prepareSector(page);
    const st = await worldState(page);
    expect(st.deck).toBe(deck);

    if (st.kind === 'boss') {
      expect(st.boss).toBeTruthy();
      await page.evaluate(() => {
        const { world } = (window as any).__game.scene.getScene('GameScene');
        const boss = world.boss;
        world.boss._hp = 0;
        world.killBoss();
      });
      await page.waitForTimeout(600);
      const afterKill = await worldState(page);
      expect(afterKill.boss).toBeFalsy();

      bosses.push(st.boss!);

      if (deck === TOTAL_DECKS - 1) {
        await page.waitForFunction(() => (window as any).__game.scene.isActive('GameOverScene'), { timeout: 10000 });
        break;
      }

      expect(afterKill.objective).toContain('DESCEND TO');
      expect(afterKill.portal).toEqual({ target: null });

      await usePortal(page);
      await expect.poll(async () => (await worldState(page)).deck !== deck, { timeout: 8000 });
      const next = await worldState(page);
      expect(next.deck).toBe(deck + 1);
      expect(next.kind).not.toBe('boss');
    } else {
      expect(st.portal).toEqual({ target: null });
      await usePortal(page);
      await expect.poll(async () => (await worldState(page)).deck !== deck, { timeout: 8000 });
      const next = await worldState(page);
      expect(next.deck).toBe(deck + 1);
      expect(next.kind).not.toBe('extraction');
    }
  }

  expect(bosses.length).toBe(Math.ceil(TOTAL_DECKS / 2));
  expect(errors).toEqual([]);
});
