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

async function usePortal(page: Page) {
  await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    if (!world.portal) throw new Error('Room has no active portal');
    world.player.reset(world.portal.wx, world.portal.wy, false);
  });
  const before = await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('GameScene');
    return { deck: scene.world.map.deck, room: scene.world.currentRoom().id, paused: scene.paused };
  });
  expect(before.paused, JSON.stringify(before)).toBe(false);
  await page.keyboard.press('f');
  await page.waitForFunction(({ deck, room }) => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    return world.map.deck !== deck || world.currentRoom()?.id !== room;
  }, before, { timeout: 5000 });
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

  const worldState = () => page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('GameScene');
    const { world } = scene;
    const room = world.currentRoom();
    return {
      deck: world.map.deck, roomId: room.id, kind: room.kind, objective: world.roomObjective,
      portal: world.portal ? { target: world.portal.targetRoom } : null,
      canLeave: world.canMovePlayer(room.gx - 1, room.gy),
      enemies: world.enemies.length, boss: world.boss?.name,
      hp: world.player.data.hp, credits: world.player.data.currency
    };
  });
  await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    world.player.data.hp = 65;
    world.player.data.currency = 13;
    // Put the player inside the still-locked exit to exercise entry via a corridor.
    const exit = world.map.rooms.find((room: { kind: string }) => room.kind === 'extraction');
    const point = world.findWalkableInRoom(exit);
    world.player.reset(point.x, point.y, false);
    world.updateRoom();
  });
  expect((await worldState()).objective).toContain('EXIT LOCKED');
  await usePortal(page);
  await expect.poll(async () => (await worldState()).kind).not.toBe('extraction');

  let witnessedSecondWave = false;
  const bosses: string[] = [];
  for (let deck = 0; deck < TOTAL_DECKS; deck++) {
    const route: unknown[] = [];
    for (let step = 0; step < 25; step++) {
      const state = await worldState();
      route.push(state);
      if (state.deck !== deck || state.portal?.target === null) break;
      if (state.boss) {
        bosses.push(state.boss);
        // Feed a lethal piercing shot into the real collision and boss-defeat paths.
        await page.evaluate(() => {
          const { world } = (window as any).__game.scene.getScene('GameScene');
          const boss = world.boss;
          world.spawnProjectile(0, boss.x, boss.y, 0, {
            damage: 10000, speed: 0, critBase: 0, critChance: 0, critDamage: 1,
            pierce: 2, lifetime: 1, kind: 'pulse', magazine: -1, shots: 1, spread: 0
          }, 'player');
        });
        if (deck === TOTAL_DECKS - 1) {
          await page.waitForFunction(() => (window as any).__game.scene.isActive('GameOverScene'));
          break;
        }
        await expect.poll(async () => (await worldState()).portal).toEqual({ target: null });
        break;
      }
      if (state.enemies) {
        expect(state.portal).toBeNull();
        expect(state.canLeave).toBe(false);
        await page.evaluate(() => {
          const { world } = (window as any).__game.scene.getScene('GameScene');
          for (const enemy of world.enemies) enemy.sprite.destroy();
          world.enemies = [];
          world.updateRoom();
        });
        if ((await worldState()).objective === 'WAVE 2/2') witnessedSecondWave = true;
        continue;
      }
      expect(state.portal, JSON.stringify(state)).not.toBeNull();
      await usePortal(page);
      await expect.poll(async () => (await worldState()).roomId).not.toBe(state.roomId);
    }
    if (deck === TOTAL_DECKS - 1) break;
    expect((await worldState()).portal, JSON.stringify(route)).toEqual({ target: null });
    for (let i = 0; i < 5; i++) {
      await page.waitForFunction(() => {
        const game = (window as any).__game;
        return !game.scene.getScene('GameScene').paused || game.scene.isActive('LevelUpScene');
      });
      const level = await page.evaluate(() => {
        const game = (window as any).__game;
        if (!game.scene.isActive('LevelUpScene')) return null;
        return game.scene.getScene('LevelUpScene').children.list.find((child: any) => child.text?.startsWith('LEVEL ')).text;
      });
      if (!level) break;
      await page.keyboard.press('1');
      await page.waitForFunction((previous) => {
        const game = (window as any).__game;
        return !game.scene.isActive('LevelUpScene') ||
          !game.scene.getScene('LevelUpScene').children.list.some((child: any) => child.text === previous);
      }, level);
    }
    const before = await worldState();
    await usePortal(page);
    await waitForDeck(page, deck + 1);
    expect(await readRun(page)).toMatchObject({ id: initial.id, seed: initial.seed, deck: deck + 1 });

    if (deck === 0) {
      expect(await worldState()).toMatchObject({ hp: before.hp, credits: before.credits });
      await page.reload();
      await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
      await page.mouse.click(640, 460);
      await waitForDeck(page, 1);
      expect(await worldState()).toMatchObject({ hp: before.hp, credits: before.credits, kind: 'start' });
    }
  }
  expect(witnessedSecondWave).toBe(true);
  expect(bosses).toEqual(['GATEKEEPER', 'CRYO ARRAY', 'THE WARDEN']);
  expect(await readRun(page)).toBeUndefined();
  expect(errors).toEqual([]);
});
