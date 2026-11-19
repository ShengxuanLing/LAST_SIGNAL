// REVIEWER PROBE (not part of the frozen commit) — proves the ACTIVE-gated
// portal really lands in a CONCRETE next room id, not just the -1 teleport
// transition the frozen coop spec stops at.
import { expect, test } from '@playwright/test';

async function clickText(page: any, text: string): Promise<void> {
  const p = await page.evaluate((label) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    function findText(list: any[]): { x: number; y: number } | null {
      for (const c of list) {
        if (!c) continue;
        if (c.type === 'Text' && (c.text || '').includes(label)) {
          const b = c.getBounds();
          return { x: b.centerX, y: b.centerY };
        }
        if (c.list && Array.isArray(c.list)) {
          const found = findText(c.list);
          if (found) return found;
        }
      }
      return null;
    }
    return findText(s.children.list);
  }, text);
  expect(p, `text ${text}`).not.toBeNull();
  await page.mouse.click(p!.x, p!.y);
}

test('reviewer probe: ACTIVE relay portal enters a real next room', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('lastSignal.save.v1'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  const newRun = await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const t = s.children.list.find((c: any) => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  });
  await page.mouse.click(newRun!.x, newRun!.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));

  // Real, explicit human opt-in through the Pause UI.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await clickText(page, 'SETTINGS');
  await page.waitForTimeout(300);
  await clickText(page, 'SIGNAL COLLABORATION · OFF');
  await page.waitForTimeout(200);
  await clickText(page, 'BACK');
  await page.waitForTimeout(400);
  for (let i = 0; i < 5; i += 1) {
    if (!(await page.evaluate(() => (window as any).__game?.scene.isActive('PauseScene')))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'), undefined, { timeout: 15000 });

  // Real room enter (fixture placement only): device spawns INACTIVE.
  const room0 = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.currentRoomId);
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    w.player.reset(w.portal.wx, w.portal.wy);
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.player.requestInteract());
  await page.waitForFunction(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return !!w.sim.signal && w.currentRoomId > 0;
  }, undefined, { timeout: 20000 });
  const roomBefore = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.currentRoomId);
  const relay0 = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.signal.relay);
  expect(relay0).toBe('INACTIVE');

  // NEGATIVE first: the closed exit really refuses.
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    w.player.reset(w.portal.wx, w.portal.wy);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.player.requestInteract());
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.currentRoomId)).toBe(roomBefore);

  // Open it (fixture: direct core command, NOT the Owner UI path — that is
  // already proven by tests/signal-coop-e2e.spec.ts).
  await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.toggleRelay(true));
  await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').world.sim.signal.relay === 'ACTIVE',
    undefined, { timeout: 15000 });

  // Real portal interact -> a CONCRETE next room id must appear.
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    w.player.reset(w.portal.wx, w.portal.wy);
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.player.requestInteract());
  await page.waitForFunction((prev: number) => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return w.currentRoomId > 0 && w.currentRoomId !== prev;
  }, roomBefore, { timeout: 20000 });
  const roomAfter = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.currentRoomId);
  console.log(`PROBE room ${room0} -> ${roomBefore} -> ${roomAfter} (concrete next room; note device roomId stays ${await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.signal.roomId)})`);
  expect(roomAfter).toBeGreaterThan(0);
  expect(roomAfter).not.toBe(roomBefore);
  expect(errors).toEqual([]);
});
