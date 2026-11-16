// AI-NATIVE-02 Task C fix #5 — human R keeps GLOBAL device control across rooms.
//
// Real UI regression for 4b938a5: `commitToggleRelay` compared the player's
// current room to the device room for EVERY source, so a human pressing R in a
// new room could no longer control the relay left behind in the previous room
// (c233 behaviour). The narrow contract is:
//   - ONLY a Companion-confirmed command carries an internal originRoom binding
//   - that binding is re-verified by the core at commit time
//   - human R has no binding and stays a global control (c233)
//
// The fixture only stands the player on the real portal; no device is injected.

import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SHOTS = resolve(process.cwd(), 'reports/ai-native-02/signal-fix/humanR-ui');

const SAVE = {
  version: 2,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  permanent: {
    maxHpBonus: 0, speedBonus: 0, damageBonus: 0, critChanceBonus: 0,
    armorBonus: 0, xpBonus: 0, currencyBonus: 0,
    unlockedWeapons: ['pulse'], unlockedAbilities: [],
    cores: 0, runs: 0, bossesDefeated: 0, bestSeed: 0,
    signalCollaborationOptIn: true
  },
  settings: {
    masterVolume: 0.7, sfxVolume: 0.8, mouseDpi: 1,
    fullscreen: false, screenShake: true
  },
  stats: { enemiesKilled: 0, itemsCollected: 0, damageDealt: 0, playTimeSeconds: 0 }
};

test('human R in a new room still controls the relay left in the old room', async ({ page }) => {
  test.setTimeout(120000);
  mkdirSync(SHOTS, { recursive: true });
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto('/');
  await page.evaluate((save) => localStorage.setItem('last_signal_save_v1', JSON.stringify(save)), SAVE);
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));

  const newRun = await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const t = s.children.list.find((c: any) => c.type === 'Text'
        && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  });
  expect(newRun).not.toBeNull();
  await page.mouse.click(newRun!.x, newRun!.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));

  // The opt-in save makes the real room enter spawn its ONE relay device.
  await page.waitForFunction(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    return !!gs?.world?.sim?.signal;
  }, undefined, { timeout: 20000 });

  const read = () => page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    const s = w.signalView();
    return {
      roomId: w.roomIdValue,
      relay: s.relay,
      exitOpen: s.exitOpen,
      manualEnabled: s.manualEnabled,
      deviceRoom: s.roomId,
      pending: (w.sim.pendingCommands || []).map((c: any) => c.type)
    };
  });
  const pressR = async () => {
    await page.keyboard.down('R');
    await page.waitForTimeout(120);
    await page.keyboard.up('R');
    await page.waitForTimeout(400);
  };

  // 1) Human R in room A (same room as the device): ACTIVE.
  const before = await read();
  expect(before.roomId, 'device spawned in the current room').toBe(before.deviceRoom);
  await pressR();
  const active = await read();
  expect(active.relay).toBe('ACTIVE');
  expect(active.exitOpen).toBe(true);
  console.log('STEP U1 human R in room A:', JSON.stringify(active));
  await page.screenshot({ path: `${SHOTS}/01-roomA-R-active.png` });

  // 2) Real portal A -> B; the device stays in A.
  await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    w.player.reset(w.portal.wx, w.portal.wy);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    gs.world.player.requestInteract();
  });
  await page.waitForFunction((roomA: number) => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return w.roomIdValue !== roomA && w.roomIdValue >= 0;
  }, active.roomId, { timeout: 25000 });
  const inB = await read();
  expect(inB.roomId).not.toBe(active.roomId);
  expect(inB.deviceRoom).toBe(active.deviceRoom);
  expect(inB.relay).toBe('ACTIVE');
  console.log('STEP U2 real portal A->B:', JSON.stringify(inB));
  await page.screenshot({ path: `${SHOTS}/02-roomB-device-left-in-A.png` });

  // 3) Fresh human R in room B: global control preserved (c233) -> INACTIVE.
  await pressR();
  const after = await read();
  expect(after.relay, 'human R must still toggle the old-room device').toBe('INACTIVE');
  expect(after.exitOpen).toBe(false);
  expect(after.manualEnabled).toBe(false);
  console.log('STEP U3 human R in room B toggles old-room device:', JSON.stringify(after));
  await page.screenshot({ path: `${SHOTS}/03-roomB-R-global-control.png` });

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
