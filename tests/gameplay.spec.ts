import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('keyboard navigation starts a run, changes settings and resumes', async ({ page }) => {
  await page.goto('/');
  const start = page.getByRole('button', { name: 'NEW RUN', exact: true });
  await expect(start).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(start).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).__game.scene.isActive('GameScene'));
  await page.keyboard.press('Escape');
  const resume = page.getByRole('button', { name: 'RESUME', exact: true });
  await expect(resume).toBeVisible();
  const elapsed = () => page.evaluate(() => (window as any).__game.scene.getScene('GameScene').elapsedSeconds);
  const pausedAt = await elapsed();
  await page.keyboard.press('Tab');
  await expect(resume).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'SETTINGS' })).toBeFocused();
  await page.keyboard.press('Space');
  const shake = page.getByRole('button', { name: 'Screen shake' });
  await expect(shake).toHaveAttribute('aria-pressed', 'true');
  await shake.focus();
  await page.keyboard.press('Enter');
  await expect(shake).toHaveAttribute('aria-pressed', 'false');
  expect(await elapsed()).toBe(pausedAt);
  await page.keyboard.press('Escape');
  await expect(shake).toHaveCount(0);
  await page.waitForFunction(() => !(window as any).__game.scene.getScene('GameScene').paused);
  await expect.poll(elapsed).toBeGreaterThan(pausedAt);
});

test('holding dash leaves a vulnerable interval before it can activate again', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'NEW RUN', exact: true }).press('Enter');
  await page.waitForFunction(() => (window as any).__game.scene.isActive('GameScene'));
  await page.keyboard.down('d');
  await page.keyboard.down('Space');
  const dashActive = () => page.waitForFunction(() => {
    const p = (window as any).__game.scene.getScene('GameScene').world.player;
    return p.dashTimer > 0 && p.invuln > 0;
  });
  await dashActive();
  await page.waitForFunction(() => {
    const p = (window as any).__game.scene.getScene('GameScene').world.player;
    return p.dashCooldownRemaining > 0 && p.invuln === 0;
  });
  await dashActive();
  await page.keyboard.up('Space');
  await page.keyboard.up('d');
});

const SHOT_DIR = process.env.LS_SHOT_DIR
  ? path.resolve(process.env.LS_SHOT_DIR)
  : path.join(tmpdir(), 'last_signal_screens');
test('menu + gameplay render', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, 'main-menu.png') });

  // Click NEW RUN button (center 640, 340)
  await page.mouse.click(640, 340);
  await page.waitForFunction(() => (window as any).__game.scene.isActive('GameScene'));
  await page.screenshot({ path: path.join(SHOT_DIR, 'gameplay.png') });

  // Movement + firing + dash
  await page.keyboard.press('KeyW');
  await page.mouse.move(820, 400);
  await page.mouse.down();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'combat.png') });
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await page.keyboard.up('Space');

  writeFileSync(path.join(SHOT_DIR, 'errors.json'), JSON.stringify(errors, null, 2));
  expect(errors).toHaveLength(0);
});
