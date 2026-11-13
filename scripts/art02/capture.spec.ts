// ART-02 evidence capture (not part of the default suite).
// Run: npx playwright test -c playwright.art02.config.ts
// Every frame here is driven by REAL inputs into the real SliceModel; nothing is staged.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'docs/art/evidence';
mkdirSync(OUT, { recursive: true });

const east = ['KeyD', 'KeyS'];
const north = ['KeyW', 'KeyD'];

async function ready(page: Page, vq: string, size = { width: 1280, height: 720 }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/station-zero.html?vq=${vq}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-vs00-ready', '1');
  await expect(page.locator('body')).toHaveAttribute('data-art02-quality', vq);
  await page.waitForTimeout(400);
}

async function walk(page: Page, keys: string[], done: () => Promise<boolean>): Promise<void> {
  for (const key of keys) await page.keyboard.down(key);
  try {
    await expect.poll(done, { timeout: 8000, intervals: [16] }).toBe(true);
  } finally {
    for (const key of keys) await page.keyboard.up(key);
  }
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });
const coordinate = async (page: Page, axis: 'x' | 'y') =>
  Number(await page.getByTestId('vs00-player-position').getAttribute(`data-${axis}`));

/** Demo A: identical state, camera and resolution; only the visual tier differs. */
for (const vq of ['off', 'high']) {
  test(`Demo A lab ${vq}`, async ({ page }) => {
    await ready(page, vq);
    await page.keyboard.press('Escape'); // freeze the sim so both frames show the same tick-state
    await page.waitForTimeout(200);
    await shot(page, `demoA-lab-${vq === 'off' ? 'before' : 'after'}`);
  });

  test(`Demo A corridor ${vq}`, async ({ page }) => {
    await ready(page, vq);
    await page.keyboard.press('x');
    await expect(page.getByTestId('vs00-door-state')).toHaveAttribute('data-state', 'JAMMED_OPEN');
    await walk(page, east, async () => (await page.locator('body').getAttribute('data-slice-room')) === 'corridor');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await shot(page, `demoA-corridor-${vq === 'off' ? 'before' : 'after'}`);
  });
}

/** Demo B: Signal feedback driven by the real model. */
test('Demo B signal sequence', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page, 'high');
  const door = page.getByTestId('vs00-door-state');
  const bridge = page.getByTestId('vs01-bridge-state');
  const health = page.getByTestId('vs01-health');

  // Scan -> connections discovered.
  await page.keyboard.press('z');
  await page.waitForTimeout(260);
  await shot(page, 'demoB-01-scan-wave');
  await page.waitForTimeout(900);
  await shot(page, 'demoB-02-scan-revealed-link');
  // Jam -> receiver interfered, door state changes.
  await page.waitForTimeout(1300); // scan cooldown + let the jam be its own event
  await page.keyboard.press('x');
  await expect(door).toHaveAttribute('data-state', 'JAMMED_OPEN');
  await page.waitForTimeout(150);
  await shot(page, 'demoB-03-jam-door-open');

  await walk(page, east, async () => (await page.locator('body').getAttribute('data-slice-room')) === 'corridor');
  await page.waitForTimeout(250);
  // Guard perception: approach until it sees us.
  await page.keyboard.press('z');
  await page.waitForTimeout(1100);
  await shot(page, 'demoB-04-corridor-scan-relay-links');
  // Jam has a shared 8 s cooldown from the lab jam: wait for the real model, do not fake it.
  await expect(page.getByTestId('vs01-relay-state')).toHaveAttribute('data-cooldown-ticks', '0', { timeout: 10000 });
  await page.keyboard.press('g');
  await expect(health).toHaveAttribute('data-guard-link', 'JAMMED');
  await page.waitForTimeout(200);
  await shot(page, 'demoB-05-guard-jammed');
  // Relay -> bridge.
  await walk(page, north, async () => (await coordinate(page, 'y')) <= 9.5);
  await walk(page, east, async () => (await coordinate(page, 'x')) >= 8.0);
  await page.keyboard.press('f');
  await expect(bridge).toHaveAttribute('data-state', 'TRANSITIONING');
  await page.waitForTimeout(600);
  await shot(page, 'demoB-06-bridge-transitioning');
  await expect(bridge).toHaveAttribute('data-state', 'STABLE');
  await page.waitForTimeout(300);
  await shot(page, 'demoB-07-bridge-stable');
  await page.keyboard.press('f');
  await expect(bridge).toHaveAttribute('data-state', 'UNSTABLE');
  await page.waitForTimeout(900);
  await shot(page, 'demoB-08-bridge-unstable');
  await page.keyboard.press('f');
  await expect(bridge).toHaveAttribute('data-state', 'STABLE');
  await page.waitForTimeout(120);
  await shot(page, 'demoB-09-bridge-recovered');
  writeFileSync(`${OUT}/demoB-console-errors.json`, JSON.stringify(errors, null, 2));
  expect(errors).toEqual([]);
});

/** Guard perception states in the corridor without a jam. */
test('Demo B guard watching', async ({ page }) => {
  await ready(page, 'high');
  await page.keyboard.press('x');
  await walk(page, east, async () => (await page.locator('body').getAttribute('data-slice-room')) === 'corridor');
  const health = page.getByTestId('vs01-health');
  await walk(page, ['KeyW'], async () => (await coordinate(page, 'y')) <= 8.6);
  await page.waitForTimeout(500);
  await shot(page, 'demoB-10-guard-watching');
  await page.keyboard.press('j');
  await page.waitForTimeout(60);
  await shot(page, 'demoB-11-guard-hit');
  await expect(health).toHaveAttribute('data-guard', /\d+/);
});

/** Resolution and tier matrix for the lab after a scan. */
const SIZES = [[1920, 1080], [1366, 768], [1280, 720], [1024, 768], [800, 600]] as const;
for (const [w, h] of SIZES) {
  test(`resolution ${w}x${h}`, async ({ page }) => {
    await ready(page, 'high', { width: w, height: h });
    await page.keyboard.press('z');
    await page.waitForTimeout(1200);
    await shot(page, `res-${w}x${h}`);
  });
}
for (const vq of ['low', 'medium', 'high']) {
  test(`tier ${vq}`, async ({ page }) => {
    await ready(page, vq);
    await page.keyboard.press('z');
    await page.waitForTimeout(1200);
    await shot(page, `tier-${vq}`);
  });
}
