// REVIEWER PROBE — REAL browser: after a REAL portal transition, does the HUMAN
// relay toggle (world.toggleRelay / the R key) still work while the run's ONE
// device stays behind in the previous room? Run on c233e5c (control) and
// 4b938a5 (candidate) and compare the logged numbers.
import { expect, test } from '@playwright/test';

async function clickText(page: any, text: string): Promise<void> {
  const p = await page.evaluate((label: string) => {
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
async function openPause(page: any): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    if (await page.evaluate(() => !!(window as any).__game?.scene.isActive('PauseScene'))) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  throw new Error('pause did not open');
}
async function closePause(page: any): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    if (await page.evaluate(() => !(window as any).__game?.scene.isActive('PauseScene'))) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  throw new Error('pause did not close');
}
const relayState = (page: any) => page.evaluate(() => {
  const w = (window as any).__game.scene.getScene('GameScene').world;
  const gs: any = (window as any).__game.scene.getScene('GameScene');
  return {
    tick: w.sim.tick,
    roomId: w.currentRoomId,
    deviceRoom: w.sim.signal ? w.sim.signal.roomId : null,
    relay: w.sim.signal ? w.sim.signal.relay : null,
    manual: w.sim.signal ? w.sim.signal.manualEnabled : null,
    exitOpen: w.signalView() ? w.signalView().exitOpen : null,
    hud: gs.txtSignal ? gs.txtSignal.text : '',
    playerRoom: (() => {
      const rooms = w.map.rooms as any[];
      return (rooms.find((r) => w.sim.player.x >= r.gx && w.sim.player.x < r.gx + r.w
        && w.sim.player.y >= r.gy && w.sim.player.y < r.gy + r.h) ?? null)?.id ?? null;
    })()
  };
});

test('human relay toggle AFTER a real portal (device stays in the old room)', async ({ page }) => {
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

  // real opt-in via the Pause settings UI (retry once; the panel tweens in)
  let optInVia = 'pause-ui';
  await openPause(page);
  await page.waitForTimeout(500);
  try {
    await clickText(page, 'SETTINGS');
    await page.waitForTimeout(500);
    await clickText(page, 'SIGNAL COLLABORATION · OFF');
    await page.waitForTimeout(300);
    await clickText(page, 'BACK');
    await page.waitForTimeout(300);
    await closePause(page);
  } catch {
    // disclosed fallback: the same flag the panel writes (no UI claim)
    optInVia = 'world-api-fallback';
    const labels = await page.evaluate(() => {
      const s: any = (window as any).__game.scene.getScene('PauseScene');
      const out: string[] = [];
      const walk = (list: any[]) => {
        for (const c of list ?? []) {
          if (!c) continue;
          if (c.type === 'Text' && typeof c.text === 'string') out.push(c.text);
          if (c.list) walk(c.list);
        }
      };
      if (s) walk(s.children.list);
      return out;
    });
    console.log('PAUSE_LABELS ' + JSON.stringify(labels));
    await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      if (typeof w.setSignalCollaborationOptIn === 'function') w.setSignalCollaborationOptIn(true);
      else w.signalCollaborationOptIn = true;
    });
    await closePause(page);
  }

  // real portal -> room A with the device INACTIVE
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    w.player.reset(w.portal.wx, w.portal.wy);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.player.requestInteract());
  await page.waitForFunction(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return !!w.sim.signal && w.currentRoomId > 0;
  }, undefined, { timeout: 25000 });
  await page.waitForTimeout(600);
  const inRoomA = await relayState(page);

  // baseline: human toggle INSIDE the device room opens the gate
  await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.toggleRelay(true));
  await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').world.sim.signal.relay === 'ACTIVE', undefined, { timeout: 15000 });
  const openedInA = await relayState(page);

  // real portal out of room A -> room B (device stays in A)
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    w.player.reset(w.portal.wx, w.portal.wy);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.player.requestInteract());
  await page.waitForFunction((prev: number) => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return w.currentRoomId > 0 && w.currentRoomId !== prev;
  }, inRoomA.roomId, { timeout: 25000 });
  await page.waitForTimeout(800);
  const inRoomB = await relayState(page);

  // (1) programmatic human API path (what the R key handler calls)
  await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.toggleRelay(false));
  await page.waitForTimeout(900);
  const afterApiToggle = await relayState(page);

  // (2) the real keyboard path: R = toggle relay
  await page.keyboard.press('r');
  await page.waitForTimeout(900);
  const afterKeyToggle = await relayState(page);

  // (3) the exact call the Owner-confirm 'apply' makes, in the new room:
  //     does it report success (=> the renderer will post an applied receipt)
  //     while the core silently refuses?
  const enqueued = await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return w.enqueueCompanionAction('toggle-relay');
  });
  await page.waitForTimeout(900);
  const afterCompanionPath = await relayState(page);

  console.log('TOGGLE_PROBE ' + JSON.stringify({
    optInVia,
    inRoomA: { deviceRoom: inRoomA.deviceRoom, roomId: inRoomA.roomId, relay: inRoomA.relay, hud: inRoomA.hud },
    openedInA: { relay: openedInA.relay, exitOpen: openedInA.exitOpen },
    inRoomB: { deviceRoom: inRoomB.deviceRoom, roomId: inRoomB.roomId, relay: inRoomB.relay, exitOpen: inRoomB.exitOpen, playerRoom: inRoomB.playerRoom },
    afterApiToggle: { relay: afterApiToggle.relay, manual: afterApiToggle.manual, exitOpen: afterApiToggle.exitOpen, hud: afterApiToggle.hud },
    afterKeyToggle: { relay: afterKeyToggle.relay, manual: afterKeyToggle.manual, exitOpen: afterKeyToggle.exitOpen, hud: afterKeyToggle.hud },
    enqueueCompanionActionReturns: enqueued,
    afterCompanionPath: { relay: afterCompanionPath.relay, manual: afterCompanionPath.manual, exitOpen: afterCompanionPath.exitOpen }
  }));
  expect(errors).toEqual([]);
});
