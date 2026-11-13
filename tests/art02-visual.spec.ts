// ART-02 visual regression: the art layer must load cleanly at every tier,
// stay bounded across room changes/restarts, freeze with pause, and never
// change gameplay outcomes compared with the original renderer (?vq=off).
import { expect, test, type Page } from '@playwright/test';

type Stats = { quality: string; textures: number; particles: number; effects: number; lights: number; objects: number; room: string | null };

async function open(page: Page, vq: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/station-zero.html?vq=${vq}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-vs00-ready', '1');
  await expect(page.locator('body')).toHaveAttribute('data-art02-quality', vq);
  return errors;
}

const stats = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __art02: Stats }).__art02;
  return { quality: s.quality, textures: s.textures, particles: s.particles, effects: s.effects, lights: s.lights, objects: s.objects, room: s.room };
});

async function walk(page: Page, keys: string[], done: () => Promise<boolean>) {
  for (const key of keys) await page.keyboard.down(key);
  try { await expect.poll(done, { timeout: 8000, intervals: [16] }).toBe(true); }
  finally { for (const key of keys) await page.keyboard.up(key); }
}

for (const vq of ['off', 'low', 'medium', 'high']) {
  test(`ART-02 ${vq}: loads, scans and jams without console errors`, async ({ page }) => {
    const errors = await open(page, vq);
    await page.keyboard.press('z');
    await page.waitForTimeout(300);
    await page.keyboard.press('x');
    await expect(page.getByTestId('vs00-door-state')).toHaveAttribute('data-state', 'JAMMED_OPEN');
    await page.waitForTimeout(400);
    const s = await stats(page);
    expect(s.quality).toBe(vq);
    if (vq === 'off') {
      expect(s.textures).toBe(0);
      expect(s.objects).toBe(0);
    } else {
      expect(s.room).toBe('lab');
      expect(s.textures).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
}

test('ART-02 high: objects and textures stay bounded across corridor entry and repeated restarts', async ({ page }) => {
  const errors = await open(page, 'high');
  const baseline = await stats(page);
  await page.keyboard.press('x');
  await walk(page, ['KeyD', 'KeyS'], async () => (await page.locator('body').getAttribute('data-slice-room')) === 'corridor');
  await page.keyboard.press('z');
  await page.waitForTimeout(500);
  const corridor = await stats(page);
  expect(corridor.room).toBe('corridor');
  for (let i = 0; i < 6; i++) {
    await page.getByTestId('vs00-btn-restart').click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(300);
  const after = await stats(page);
  expect(after.room).toBe('lab');
  // One env texture per room at a time + shared backdrop/vignettes + a handful of glow colours.
  expect(after.textures).toBeLessThanOrEqual(baseline.textures + 8);
  expect(after.textures).toBeLessThanOrEqual(16);
  expect(after.lights).toBeLessThanOrEqual(40);
  expect(after.objects).toBeLessThanOrEqual(6 + 40);
  expect(after.particles).toBeLessThanOrEqual(260 + 48);
  expect(errors).toEqual([]);
});

test('ART-02: pause freezes presentation and resume continues', async ({ page }) => {
  await open(page, 'high');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const a = await stats(page);
  await page.waitForTimeout(600);
  const b = await stats(page);
  expect(b.particles).toBe(a.particles);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vs00-feedback')).not.toContainText('已暂停');
});

test('ART-02: gameplay outcomes are identical with the art layer on and off', async ({ page }) => {
  const run = async (vq: string) => {
    await open(page, vq);
    const out: string[] = [];
    const read = async () => out.push([
      await page.getByTestId('vs00-door-state').getAttribute('data-state'),
      await page.getByTestId('vs00-energy').getAttribute('data-energy'),
      await page.getByTestId('vs00-feedback').getAttribute('data-code'),
      await page.getByTestId('vs00-scan-details').getAttribute('data-link'),
    ].join('|'));
    await page.keyboard.press('f'); await read();
    await page.keyboard.press('z'); await read();
    await page.keyboard.press('x'); await read();
    await page.keyboard.press('x'); await read();
    return out;
  };
  const off = await run('off');
  const high = await run('high');
  // Energy can differ by regen ticks between runs; compare door/result/reveal only.
  const strip = (r: string[]) => r.map((l) => { const [d, , c, k] = l.split('|'); return `${d}|${c}|${k}`; });
  expect(strip(high)).toEqual(strip(off));
});
