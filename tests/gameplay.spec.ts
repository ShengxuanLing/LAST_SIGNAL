import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const PORT = 5173;
const ERRORS: string[] = [];

test.beforeEach(async ({ page }) => {
  page.on('console', (m) => { if (m.type() === 'error') ERRORS.push(m.text()); });
  page.on('pageerror', (e) => ERRORS.push(`pageerror: ${e.message}`));
});

test('menu + gameplay render', async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => {
    const l = document.getElementById('loader');
    return !l || l.style.display === 'none';
  }, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/screens/main-menu.png' });

  // Click NEW RUN button (center 640, 340)
  await page.mouse.click(640, 340);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tests/screens/gameplay.png' });

  // Movement + firing + dash
  await page.keyboard.press('KeyW');
  await page.mouse.move(820, 400);
  await page.mouse.down();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tests/screens/combat.png' });
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await page.keyboard.up('Space');

  writeFileSync('tests/screens/errors.json', JSON.stringify(ERRORS, null, 2));
  console.log('CONSOLE ERRORS:', ERRORS.length);
  for (const e of ERRORS.slice(0, 30)) console.log('  ERROR:', e);

  expect(ERRORS).toHaveLength(0);
});
