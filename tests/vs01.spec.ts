import { expect, test, type Page } from '@playwright/test';

const SLICE_KEY = 'last_signal_station_zero_vs00_v1';
const MAIN_KEY = 'last_signal_save_v1';
const east = ['KeyD', 'KeyS'];
const north = ['KeyW', 'KeyD'];

async function walk(page: Page, keys: string[], done: () => Promise<boolean>) {
  for (const key of keys) await page.keyboard.down(key);
  try {
    await expect.poll(done, { timeout: 7000, intervals: [16] }).toBe(true);
  } finally {
    for (const key of keys) await page.keyboard.up(key);
  }
}

async function coordinate(page: Page, axis: 'x' | 'y'): Promise<number> {
  return Number(await page.getByTestId('vs00-player-position').getAttribute(`data-${axis}`));
}

function readSave(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), SLICE_KEY);
}

test('each action key event is handled once when Scan and Jam arrive in the same frame', async ({ page }) => {
  await page.goto('/station-zero.html');
  await expect(page.locator('body')).toHaveAttribute('data-vs00-ready', '1');
  // Deliver two complete presses in one browser task so the engine cannot clear its queue between them.
  await page.evaluate(() => {
    for (const [key, keyCode] of [['z', 90], ['x', 88]] as const) {
      for (const type of ['keydown', 'keyup']) {
        window.dispatchEvent(new KeyboardEvent(type, { key, keyCode }));
      }
    }
  });
  const feedback = page.getByTestId('vs00-feedback');
  await expect(page.getByTestId('vs00-door-state')).toHaveAttribute('data-state', 'JAMMED_OPEN');
  await expect(feedback).toHaveAttribute('data-cost', '25');
  await page.keyboard.press('x');
  await expect(feedback).toHaveAttribute('data-code', 'E_RETRYABLE');
});

test('VS-01 follows real keyboard input from the lab to a safe collapse and across the rebuilt bridge', async ({ page }) => {
  const errors: string[] = [];
  const offOrigin: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (!new URL(request.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)) offOrigin.push(request.url()); });
  await page.goto('/station-zero.html');
  await expect(page.locator('body')).toHaveAttribute('data-vs00-ready', '1');
  await page.evaluate((key) => localStorage.setItem(key, 'original-and-economy-save'), MAIN_KEY);

  const room = page.locator('body');
  const door = page.getByTestId('vs00-door-state');
  const bridge = page.getByTestId('vs01-bridge-state');
  const relay = page.getByTestId('vs01-relay-state');
  const health = page.getByTestId('vs01-health');
  const feedback = page.getByTestId('vs00-feedback');
  const scan = page.getByTestId('vs00-scan-details');
  await page.keyboard.press('x');
  await expect(door).toHaveAttribute('data-state', 'JAMMED_OPEN');
  await walk(page, east, async () => (await room.getAttribute('data-slice-room')) === 'corridor');
  expect((await readSave(page)).corridor).toBeUndefined();
  await expect(bridge).toHaveAttribute('data-state', 'UNAVAILABLE');
  await expect(relay).toHaveAttribute('data-state', 'INACTIVE');

  await page.keyboard.press('f');
  await expect(feedback).toHaveAttribute('data-code', 'E_ILLEGAL_TARGET');
  await expect(feedback).toHaveAttribute('data-cost', '0');
  await page.keyboard.press('z');
  await expect(scan).toContainText('中继器 → 桥梁承重');
  await expect(scan).toContainText('感知端口（预留，无信号）');
  await expect(bridge).toHaveAttribute('data-state', 'UNAVAILABLE');

  await page.keyboard.press('j');
  await expect(health).toHaveAttribute('data-guard', '12');
  await page.waitForTimeout(220);
  await page.keyboard.press('j');
  await expect(health).toHaveAttribute('data-guard', '0');
  await walk(page, north, async () => (await coordinate(page, 'y')) <= 9.5);
  await walk(page, east, async () => (await coordinate(page, 'x')) >= 8.4);
  await page.keyboard.press('f');
  await expect(relay).toHaveAttribute('data-output', '1');
  await expect(bridge).toHaveAttribute('data-state', 'TRANSITIONING');
  await expect(bridge).toHaveAttribute('data-passable', '0');
  await expect(bridge).toHaveAttribute('data-state', 'STABLE');
  await expect(relay).toHaveAttribute('data-cooldown-ticks', '0', { timeout: 9000 });
  await walk(page, east, async () => (await coordinate(page, 'x')) >= 12.4);
  await expect(health).toHaveAttribute('data-on-bridge', '1');
  await page.keyboard.press('x');
  await expect(relay).toHaveAttribute('data-state', 'JAMMED');
  await expect(bridge).toHaveAttribute('data-state', 'UNSTABLE');
  await expect(bridge).toHaveAttribute('data-passable', '1');
  await expect(bridge).toContainText('退往西岸');
  await page.keyboard.press('Escape');
  await expect(feedback).toContainText('已暂停');
  const frozen = await bridge.getAttribute('data-ticks');
  await page.waitForTimeout(1650);
  await expect(bridge).toHaveAttribute('data-ticks', frozen!);
  await expect(health).toHaveAttribute('data-hp', '100');
  await page.keyboard.press('Escape');
  await expect(bridge).toHaveAttribute('data-state', 'UNAVAILABLE');
  await expect(feedback).toContainText('西岸安全点，损失 20 HP');
  await expect(health).toHaveAttribute('data-hp', '80');
  await expect(health).toHaveAttribute('data-on-bridge', '0');
  await expect(page.getByTestId('vs00-player-position')).toHaveAttribute('data-x', '9.5');

  await page.getByTestId('vs00-btn-save').click();
  const saved = await readSave(page);
  expect(saved.corridor.jamRemaining).toBeGreaterThan(0);
  await page.reload();
  await expect(room).toHaveAttribute('data-slice-room', 'corridor');
  await expect(health).toHaveAttribute('data-hp', '80');
  await expect(health).toHaveAttribute('data-guard', '0');
  await expect(relay).toHaveAttribute('data-state', 'JAMMED');
  expect(Number(await relay.getAttribute('data-jam-ticks'))).toBeLessThanOrEqual(saved.corridor.jamRemaining);
  await expect(relay).toHaveAttribute('data-state', 'ACTIVE', { timeout: 7500 });
  await expect(bridge).toHaveAttribute('data-state', 'STABLE');
  await walk(page, east, async () => (await page.getByTestId('vs00-complete').getAttribute('data-complete')) === '1');
  await expect(page.getByTestId('vs00-complete')).toContainText('已到达东岸');
  expect((await readSave(page)).corridor).toMatchObject({ crossed: true, bridge: 'STABLE', hp: 80 });
  await page.getByTestId('vs00-btn-restart').click();
  await expect(room).toHaveAttribute('data-slice-room', 'lab');
  await expect(door).toHaveAttribute('data-state', 'SEALED');
  await expect(page.getByTestId('vs00-energy')).toHaveAttribute('data-energy', '100');
  expect(await page.evaluate((key) => localStorage.getItem(key), MAIN_KEY)).toBe('original-and-economy-save');
  expect(errors).toEqual([]);
  expect(offOrigin).toEqual([]);
});

test('a lethal collapse clears the run and permits a fresh start', async ({ page }) => {
  // Fixture shortens the setup. The warning, movement and collapse use real input.
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({
      schema: key, version: 1, roomId: 'station-zero-r1', passed: true, energy: 100, tick: 100,
      doorState: 'SEALED', manualOpenIntent: false, sealSourcePresent: true,
      position: { x: 12.5, y: 5.5 },
      remaining: { jam: 0, jamCooldown: 0, scanCooldown: 0, scanReveal: 0, safeClear: 60, regenAcc: 0 },
      corridor: {
        template: 'station-zero-r2-v1', position: { x: 9.5, y: 9.5 }, hp: 20,
        relayEnabled: true, powered: true, bridge: 'STABLE', guardCleared: true, crossed: false,
        jamRemaining: 0, scanRemaining: 0, reveal: null,
      },
    }));
  }, SLICE_KEY);
  await page.goto('/station-zero.html');
  await expect(page.getByTestId('vs01-bridge-state')).toHaveAttribute('data-state', 'STABLE');
  await walk(page, east, async () => (await coordinate(page, 'x')) >= 12.4);
  await page.keyboard.press('x');
  await expect(page.getByTestId('vs01-bridge-state')).toHaveAttribute('data-state', 'UNSTABLE');
  await expect(page.getByTestId('vs01-health')).toHaveAttribute('data-hp', '0');
  await expect(page.getByTestId('vs00-complete')).toContainText('本局失败');
  expect(await page.evaluate((key) => localStorage.getItem(key), SLICE_KEY)).toBeNull();
  await page.getByTestId('vs00-btn-restart').click();
  await expect(page.getByTestId('vs00-player-position')).toHaveAttribute('data-x', '3.5');
});
