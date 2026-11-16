// Task C fix — real ORDINARY portal path: the ECHO must arrive with the
// protagonist in the SAME transition tick, and the old room's armed assist /
// memory must be dropped. Plus an explicit NEGATIVE CONTROL: a teleport that
// does not request migration must leave the echo untouched (so the test cannot
// pass just because "some tick moved the echo").
//
// Real browser, real portal interaction (world.player.requestInteract), real
// core ticks. No manual stepFrame, no direct signal/HP/energy writes.
// The only fixture is placing the protagonist on its own portal (disclosed).

import { expect, test, type Page } from '@playwright/test';

async function bootRun(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('lastSignal.save.v1'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  const newRun = await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const t = s.children.list.find((c: any) =>
        c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  });
  expect(newRun).not.toBeNull();
  await page.mouse.click(newRun!.x, newRun!.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
}

async function enableEcho(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    if (!w.sim.echo) w.enableEcho();
  });
  await page.waitForFunction(
    () => !!((window as any).__game.scene.getScene('GameScene').world.sim.echo),
    undefined, { timeout: 20000 }
  );
}

interface Snapshot {
  tick: number; roomId: number;
  player: { x: number; y: number };
  echo: { x: number; y: number } | null;
  room: { gx: number; gy: number; w: number; h: number } | null;
  assistArmed: boolean;
  echoMemory: Array<{ x: number; y: number }>;
  hasPortal: boolean;
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    const room = w.currentRoom ? w.currentRoom() : null;
    return {
      tick: w.sim.tick,
      roomId: w.currentRoomId,
      player: { x: w.sim.player.x, y: w.sim.player.y },
      echo: w.sim.echo ? { x: w.sim.echo.x, y: w.sim.echo.y } : null,
      room: room ? { gx: room.gx, gy: room.gy, w: room.w, h: room.h } : null,
      assistArmed: w.echoAssistArmed,
      echoMemory: w.echoController.memory.map((m: any) => ({ x: m.x, y: m.y })),
      hasPortal: !!w.portal
    };
  });
}

const inside = (s: Snapshot): boolean => !!s.room && !!s.echo
  && s.echo.x >= s.room.gx && s.echo.x < s.room.gx + s.room.w
  && s.echo.y >= s.room.gy && s.echo.y < s.room.gy + s.room.h;

test('ordinary portal: the ECHO migrates with the protagonist in the same transition, assist cleared', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bootRun(page);
  await enableEcho(page);

  // Arm the assist so the transition has something stale to clear.
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    w.confirmEchoAssist();
  });
  expect((await snapshot(page)).assistArmed, 'assist armed before the transition').toBe(true);

  const before = await snapshot(page);
  expect(before.hasPortal, 'a real portal exists in the start room').toBe(true);

  // FIXTURE (disclosed): stand the protagonist on its own portal.
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    w.player.reset(w.portal.wx, w.portal.wy);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    (window as any).__game.scene.getScene('GameScene').world.player.requestInteract();
  });
  await page.waitForFunction((prev: number) => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return w.currentRoomId !== prev && w.currentRoomId >= 0;
  }, before.roomId, { timeout: 25000 });

  const after = await snapshot(page);
  expect(after.roomId, 'the real portal really entered a different room').not.toBe(before.roomId);
  expect(after.echo, 'the echo still exists').not.toBeNull();
  expect(inside(after), 'the ECHO is inside the NEW room, not stranded in the old one').toBe(true);
  expect(Math.hypot(after.echo!.x - after.player.x, after.echo!.y - after.player.y),
    'the echo arrives right next to the protagonist').toBeLessThan(3.5);
  expect(after.assistArmed, 'the old room assist is not carried into the new encounter').toBe(false);
  expect(
    after.echoMemory.every((m) => after.room
      && m.x >= after.room.gx - 1 && m.x < after.room.gx + after.room.w + 1
      && m.y >= after.room.gy - 1 && m.y < after.room.gy + after.room.h + 1),
    'no old-room memory entry survives the transition'
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('NEGATIVE CONTROL: a teleport without migration leaves the echo where it was', async ({ page }) => {
  test.setTimeout(120000);
  await bootRun(page);
  await enableEcho(page);
  // HOLD makes the companion stationary, so "did it teleport?" is observable
  // without the follow AI blurring the answer.
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    w.setEchoMode('hold');
  });
  await page.waitForTimeout(300);
  const before = await snapshot(page);
  expect(before.echo).not.toBeNull();

  // The same real core command WITHOUT the migration flag: this is the exact
  // pre-fix behaviour, still reachable on purpose (debug / reset teleports).
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    const room = w.currentRoom();
    w.enqueueTeleport(room.gx + 1, room.gy + 1, true);
  });
  await page.waitForFunction((t: number) =>
    (window as any).__game.scene.getScene('GameScene').world.sim.tick > t + 2,
    before.tick, { timeout: 15000 });

  const after = await snapshot(page);
  expect(Math.hypot(after.player.x - before.player.x, after.player.y - before.player.y),
    'the control teleport really moved the protagonist').toBeGreaterThan(2);
  expect(after.echo!.x, 'no migration requested => echo stays put').toBeCloseTo(before.echo!.x, 3);
  expect(after.echo!.y, 'no migration requested => echo stays put').toBeCloseTo(before.echo!.y, 3);
});
