import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 5173);
const SHOT_DIR = path.resolve(process.env.LS_SHOT_DIR ?? 'screens');
const SLICE_KEY = 'last_signal_station_zero_vs00_v1';
const MAIN_KEY = 'last_signal_save_v1';

const consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors.length = 0;
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
});

async function open(page: Page): Promise<void> {
  await page.goto(`http://localhost:${PORT}/station-zero.html`);
  await page.waitForSelector('body[data-vs00-ready="1"]', { timeout: 15000 });
}

async function attr(page: Page, testid: string, name: string): Promise<string | null> {
  return page.locator(`[data-testid="${testid}"]`).getAttribute(name);
}

async function energy(page: Page): Promise<number> {
  return Number(await attr(page, 'vs00-energy', 'data-energy'));
}

async function door(page: Page): Promise<string | null> {
  return attr(page, 'vs00-door-state', 'data-state');
}

async function posX(page: Page): Promise<number> {
  return Number(await attr(page, 'vs00-player-position', 'data-x'));
}

/** Hold a key combination until `predicate(x)` is true, polling at frame cadence. */
async function walkUntil(page: Page, keys: string[], predicate: (x: number) => boolean, maxMs = 6000): Promise<number> {
  for (const k of keys) await page.keyboard.down(k);
  const start = Date.now();
  let x = await posX(page);
  while (Date.now() - start < maxMs) {
    x = await posX(page);
    if (predicate(x)) break;
    await page.waitForTimeout(16);
  }
  for (const k of keys) await page.keyboard.up(k);
  return x;
}

function fixtureState(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'last_signal_station_zero_vs00_v1',
    version: 1,
    roomId: 'station-zero-r1',
    energy: 100,
    tick: 0,
    doorState: 'SEALED',
    manualOpenIntent: false,
    sealSourcePresent: true,
    passed: false,
    position: { x: 3.5, y: 5.5 },
    remaining: { jam: 0, jamCooldown: 0, scanCooldown: 0, scanReveal: 0, safeClear: 60, regenAcc: 0 },
    ...over,
  };
}

test('E1: real Scan -> Jam -> WASD through the door (default, no fixture)', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await open(page);

  expect(await energy(page)).toBe(100);
  expect(await door(page)).toBe('SEALED');
  expect(await attr(page, 'vs00-scan-details', 'data-revealed')).toBe('0');
  expect((await page.getByTestId('vs00-scan-details').textContent()) ?? '').not.toContain('源');

  await page.keyboard.press('z');
  await expect.poll(() => attr(page, 'vs00-feedback', 'data-cost')).toBe('10');
  expect(await attr(page, 'vs00-scan-details', 'data-revealed')).toBe('1');
  // Scan only reveals; it must not open the door.
  expect(await door(page)).toBe('SEALED');

  await page.keyboard.press('x');
  await expect.poll(() => door(page)).toBe('JAMMED_OPEN');
  expect(await attr(page, 'vs00-feedback', 'data-cost')).toBe('25');
  // Energy may regenerate immediately after the charge (5/s), so assert the
  // reported cost and the door transition instead of a transient exact meter.

  // D + S cancel the iso axes into a pure +x world move.
  const x = await walkUntil(page, ['KeyD', 'KeyS'], (v) => v > 8.2);
  expect(x).toBeGreaterThan(8.0);
  await expect.poll(() => attr(page, 'vs00-complete', 'data-complete')).toBe('1');

  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, 'vs00-full-flow.png') });

  // No LLM / no external calls: every request stays on the local dev origin.
  for (const url of requests) expect(url.startsWith(`http://localhost:${PORT}/`)).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test('E2: Jam expiry while standing in the doorway never clamps the player', async ({ page }) => {
  await open(page);
  await page.keyboard.press('x');
  await expect.poll(() => door(page)).toBe('JAMMED_OPEN');

  // Walk into the doorway and stop near its centre (x ~= 7.3, i.e. still overlapping).
  const inDoorX = await walkUntil(page, ['KeyD', 'KeyS'], (v) => v >= 7.25);
  expect(inDoorX).toBeGreaterThan(7.0);
  expect(inDoorX).toBeLessThan(8.0);

  // Let the 6 s Jam expire while the player stands in the doorway.
  await expect.poll(() => door(page), { timeout: 12000, intervals: [200] }).toBe('SAFE_PENDING_CLOSE');
  const afterX = await posX(page);
  expect(Math.abs(afterX - inDoorX)).toBeLessThan(0.25);

  // Occupied: the door must not close even after the delay.
  await page.waitForTimeout(800);
  expect(await door(page)).toBe('SAFE_PENDING_CLOSE');

  // Step out to the west; the door closes only after the 1 s safe delay.
  await walkUntil(page, ['KeyW', 'KeyA'], (v) => v < 6.2);
  await expect.poll(() => door(page), { timeout: 5000, intervals: [100] }).toBe('SEALED');
  expect(consoleErrors).toEqual([]);
});

test('E3: Pause freezes movement and timers; resume does not catch up', async ({ page }) => {
  await open(page);
  // Use the real Pause button: same rule entry as Esc, but deterministic to toggle.
  await page.getByTestId('vs00-btn-pause').click();
  await expect.poll(async () => (await page.getByTestId('vs00-feedback').textContent()) ?? '').toContain('已暂停');

  const x0 = await posX(page);
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyS');
  expect(await posX(page)).toBe(x0);

  await page.getByTestId('vs00-btn-pause').click();
  // Wait for the pause to actually clear before testing movement again.
  await expect.poll(async () => (await page.getByTestId('vs00-feedback').textContent()) ?? '').not.toContain('已暂停');
  const x1 = await walkUntil(page, ['KeyD', 'KeyS'], (v) => v > x0 + 0.5);
  expect(x1).toBeGreaterThan(x0 + 0.4);
  expect(consoleErrors).toEqual([]);
});

test('E4: energy-insufficient feedback from a storage fixture, then natural recovery', async ({ page }) => {
  // Fixture only seeds the prototype's own save; it is not a gameplay shortcut.
  await page.addInitScript(([key, state]) => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [SLICE_KEY, fixtureState({ energy: 10 })]);

  await open(page);
  // Fixture value may tick up by 1-2 due to regen before the first read.
  expect(await energy(page)).toBeLessThanOrEqual(12);

  await page.keyboard.press('x');
  await expect.poll(() => attr(page, 'vs00-feedback', 'data-code')).toBe('E_ENERGY_INSUFFICIENT');
  expect(Number(await attr(page, 'vs00-feedback', 'data-cost'))).toBe(0);
  expect(await energy(page)).toBeLessThan(25);

  // 5 energy / logic-second: wait for a real recharge to 25+.
  await expect.poll(() => energy(page), { timeout: 6000, intervals: [200] }).toBeGreaterThanOrEqual(25);
  await page.keyboard.press('x');
  await expect.poll(() => door(page)).toBe('JAMMED_OPEN');
  expect(consoleErrors).toEqual([]);
});

test('E5: save/reload keeps main+economy key byte-identical; restart clears only the slice key', async ({ page }) => {
  const MAIN_RAW = '{"sentinel":"main/economy must not be touched"}';
  await page.addInitScript(([key, raw]) => { localStorage.setItem(key, raw); }, [MAIN_KEY, MAIN_RAW]);

  await open(page);
  await page.keyboard.press('z');
  await page.keyboard.press('x');
  await page.getByTestId('vs00-btn-save').click();

  const afterSave = await page.evaluate(([mk, sk]) => ({
    main: localStorage.getItem(mk),
    slice: localStorage.getItem(sk),
  }), [MAIN_KEY, SLICE_KEY]);
  expect(afterSave.main).toBe(MAIN_RAW);
  expect(afterSave.slice).toBeTruthy();

  await page.reload();
  await page.waitForSelector('body[data-vs00-ready="1"]', { timeout: 15000 });
  expect(await page.evaluate((mk) => localStorage.getItem(mk), MAIN_KEY)).toBe(MAIN_RAW);

  await page.getByTestId('vs00-btn-restart').click();
  const afterRestart = await page.evaluate(([mk, sk]) => ({
    main: localStorage.getItem(mk),
    slice: localStorage.getItem(sk),
  }), [MAIN_KEY, SLICE_KEY]);
  expect(afterRestart.main).toBe(MAIN_RAW);
  expect(afterRestart.slice).toBeNull();
  expect(consoleErrors).toEqual([]);
});

test('E6: a rejected save is preserved, never overwritten by Save or by completion auto-save', async ({ page }) => {
  const BAD_RAW = '{"schema":"not-vs00","version":99,"payload":"keep-me"}';
  await page.addInitScript(([key, raw]) => { localStorage.setItem(key, raw); }, [SLICE_KEY, BAD_RAW]);

  await open(page);
  await expect.poll(async () => (await page.getByTestId('vs00-feedback').textContent()) ?? '').toContain('保留');

  // The explicit Save button must not clobber a rejected raw save.
  await page.getByTestId('vs00-btn-save').click();
  expect(await page.evaluate((k) => localStorage.getItem(k), SLICE_KEY)).toBe(BAD_RAW);

  // Completing the prototype auto-saves; it must also keep the rejected raw value.
  await page.keyboard.press('z');
  await page.keyboard.press('x');
  await walkUntil(page, ['KeyD', 'KeyS'], (v) => v > 8.2);
  await expect.poll(() => attr(page, 'vs00-complete', 'data-complete')).toBe('1');
  expect(await page.evaluate((k) => localStorage.getItem(k), SLICE_KEY)).toBe(BAD_RAW);
  expect(consoleErrors).toEqual([]);
});

test('E7: storage write failure surfaces an explicit message and stays playable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = function setItem(): void {
      throw new Error('quota exceeded (VS-00 test)');
    };
  });

  await open(page);
  await page.getByTestId('vs00-btn-save').click();
  await expect.poll(async () => (await page.getByTestId('vs00-feedback').textContent()) ?? '').toMatch(/失败|无法/);
  // Still playable after the failure.
  expect(await energy(page)).toBe(100);
  await page.keyboard.press('z');
  await expect.poll(() => attr(page, 'vs00-feedback', 'data-cost')).toBe('10');
});

test('E9: near the sealed door, F reports E_LINK_UNAVAILABLE without opening it', async ({ page }) => {
  await open(page);
  // Walk close to the door first: the prototype may use an independent interact
  // range (2 or 6), so this must not rely on a far-away F press.
  await walkUntil(page, ['KeyD', 'KeyS'], (v) => v >= 6.2);
  expect(await posX(page)).toBeLessThan(7.0);
  const e0 = await energy(page);
  await page.keyboard.press('f');
  await expect.poll(() => attr(page, 'vs00-feedback', 'data-code')).toBe('E_LINK_UNAVAILABLE');
  expect(Number(await attr(page, 'vs00-feedback', 'data-cost'))).toBe(0);
  expect(await door(page)).toBe('SEALED');
  // No energy was spent (regen may only increase it).
  expect(await energy(page)).toBeGreaterThanOrEqual(e0);
  expect(consoleErrors).toEqual([]);
});

test('E8: reload after completion restores a passed-consistent position, not the spawn', async ({ page }) => {
  await open(page);
  await page.keyboard.press('z');
  await page.keyboard.press('x');
  await walkUntil(page, ['KeyD', 'KeyS'], (v) => v > 8.4);
  await expect.poll(() => attr(page, 'vs00-complete', 'data-complete')).toBe('1');
  // Completion auto-saves at the 8.0 threshold; persist the later east position via
  // the real Save button so the HUD's 1-decimal reading is unambiguously > 8.0.
  await page.getByTestId('vs00-btn-save').click();
  await expect.poll(async () => (await page.getByTestId('vs00-feedback').textContent()) ?? '').toContain('已保存');

  await page.reload();
  await page.waitForSelector('body[data-vs00-ready="1"]', { timeout: 15000 });
  expect(await attr(page, 'vs00-complete', 'data-complete')).toBe('1');
  const x = await posX(page);
  expect(x).toBeGreaterThan(8.0);
  expect(consoleErrors).toEqual([]);
});
