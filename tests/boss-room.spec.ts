import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SHOT_DIR = path.resolve(process.env.LS_SHOT_DIR ?? 'screens');

// Boss-room regression: a real kind==='boss' room of the seed-1 map, player and
// boss on the walkable tile closest to the room centre, zoom 1.25 and a
// max-strength shake. Verifies the player stays on screen / centred, the frame
// is not blanked, the shake is clamped, the camera bounds cover the world layer
// and the run produces no pageerror / console error.
test.use({ viewport: { width: 1440, height: 900 } });

test('boss room: player, camera bounds and shake stay sane after addShake(18)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  mkdirSync(SHOT_DIR, { recursive: true });
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => !!(window as any).__game, { timeout: 10000 });
  await page.waitForTimeout(1000);

  // Stop every active scene, then start a fresh deterministic run.
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of g.scene.getScenes(true)) g.scene.stop(s.sys.settings.key);
    g.scene.start('GameScene', { seed: 1 });
  });
  await page.waitForFunction(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    return !!(gs && gs.world && gs.world.player && g.scene.isActive('GameScene'));
  }, { timeout: 10000 });
  await page.waitForTimeout(300);

  const setup = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world, pl = w.player, cam = gs.cameras.main;

    // A real room from the generated map (not a fabricated boss-room object).
    const room: any = w.map.rooms.find((r: any) => r.kind === 'boss');
    if (!room) throw new Error('seed=1 map has no kind==="boss" room');

    // Walkable tile strictly inside the room bounds, closest to the room centre.
    const cx = room.gx + room.w / 2, cy = room.gy + room.h / 2;
    const best = { x: 0, y: 0 };
    let bestD = Infinity;
    let foundTile = false;
    for (const row of w.map.tiles) {
      for (const t of row) {
        if (t.x < room.gx || t.x >= room.gx + room.w) continue;
        if (t.y < room.gy || t.y >= room.gy + room.h) continue;
        if (!w.isWalkable(t.x, t.y, 0.5)) continue;
        const d = (t.x + 0.5 - cx) ** 2 + (t.y + 0.5 - cy) ** 2;
        if (d < bestD) { bestD = d; best.x = t.x; best.y = t.y; foundTile = true; }
      }
    }
    if (!foundTile) throw new Error('boss room has no walkable tile');

    // reset() restores hp/invuln from its own defaults, so apply ours afterwards.
    pl.reset(best.x, best.y);
    pl.data.hp = 1000;
    pl.data.maxHp = 1000;
    pl.invuln = 999;

    // Re-enter the boss room (spawns the real Boss, portal and room HUD).
    w.currentRoomId = -1;
    w.updateRoom();
    if (!w.boss) w.spawnBoss(room);
    const boss = w.boss;
    boss.attackTimer = 999;
    boss.phase = 1;

    cam.zoom = 1.25;
    // Phaser's setScroll(x, y) takes numbers: unpack the Vector2 from getScroll,
    // exactly as GameScene.create does. Zoom first, so getScroll clamps at 1.25.
    const s = cam.getScroll(pl.sprite.x, pl.sprite.y);
    cam.setScroll(s.x, s.y);

    w.addShake(18);
    return {
      roomId: room.id,
      roomKind: room.kind,
      currentRoomKind: w.currentRoom()?.kind ?? null,
      tile: { x: best.x, y: best.y },
      player: { x: pl.wx, y: pl.wy },
      boss: { x: boss.wx, y: boss.wy, attackTimer: boss.attackTimer, phase: boss.phase },
      separation: Math.hypot(boss.wx - pl.wx, boss.wy - pl.wy),
      zoom: cam.zoom
    };
  });

  expect(setup.roomKind, 'found room is a real boss room').toBe('boss');
  expect(setup.currentRoomKind, 'player stands inside the boss room').toBe('boss');
  expect(setup.player.x, 'player landed on the chosen walkable tile (x)').toBe(setup.tile.x);
  expect(setup.player.y, 'player landed on the chosen walkable tile (y)').toBe(setup.tile.y);
  expect(setup.separation, 'boss does not spawn on top of the player').toBeGreaterThanOrEqual(3);

  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT_DIR, 'boss-room.png') });

  const m = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world, pl = w.player, cam = gs.cameras.main;

    // Invert the live camera transform (scroll + zoom + shake) to get the
    // player's screen coordinates in the internal 1280x720 canvas.
    const p0 = cam.getWorldPoint(0, 0);
    const p1 = cam.getWorldPoint(100, 0);
    const p2 = cam.getWorldPoint(0, 100);
    const ax = (p1.x - p0.x) / 100, bx = p0.x;
    const ay = (p2.y - p0.y) / 100, by = p0.y;
    const screenX = (pl.sprite.x - bx) / ax;
    const screenY = (pl.sprite.y - by) / ay;

    const centre = cam.getWorldPoint(640, 360);
    const centerErr = Math.hypot(centre.x - pl.sprite.x, centre.y - pl.sprite.y);

    const canvas = g.canvas;
    const ctx = canvas.getContext('2d')!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let bright = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 60 || data[i + 1] > 60 || data[i + 2] > 60) bright++;
    }
    const bar = gs.bossBarFill;
    const barScreenX = (bar.x - bx) / ax;
    const barScreenY = (bar.y - by) / ay;
    const barRectX = Math.max(0, Math.round(barScreenX - 170));
    const barRectY = Math.max(0, Math.round(barScreenY - 20));
    const barRectW = Math.min(canvas.width - barRectX, 340);
    const barRectH = Math.min(canvas.height - barRectY, 40);
    const barData = ctx.getImageData(barRectX, barRectY, barRectW, barRectH).data;
    let bossBarRed = 0;
    for (let i = 0; i < barData.length; i += 4) {
      if (barData[i] > 180 && barData[i + 1] < 100 && barData[i + 2] < 120) bossBarRed++;
    }

    const sh: any = (cam as any).shakeEffect;
    const renderer: any = w.renderer;
    return {
      screenX, screenY, centerErr, bright,
      intensityX: sh.intensity.x, intensityY: sh.intensity.y,
      offsetX: sh._offsetX, offsetY: sh._offsetY,
      boundsHeight: cam.getBounds().height,
      layerHeight: renderer.layer.height,
      playerDepth: pl.sprite.depth,
      bossDepth: w.boss ? w.boss.sprite.depth : -1,
      barScreenX, barScreenY, barWidth: bar.width, bossBarRed
    };
  });

  expect(m.screenX, 'player screen x in 0..1280').toBeGreaterThan(0);
  expect(m.screenX, 'player screen x in 0..1280').toBeLessThan(1280);
  expect(m.screenY, 'player screen y in 0..720').toBeGreaterThan(0);
  expect(m.screenY, 'player screen y in 0..720').toBeLessThan(720);
  expect(m.centerErr, 'camera centre error < 20').toBeLessThan(20);
  expect(m.bright, 'canvas bright pixels > 2000 (frame not blanked)').toBeGreaterThan(2000);
  expect(Math.abs(m.intensityX), 'shake intensity x < 0.02').toBeLessThan(0.02);
  expect(Math.abs(m.intensityY), 'shake intensity y < 0.02').toBeLessThan(0.02);
  expect(Math.abs(m.offsetX), 'shake _offsetX |.| < 20').toBeLessThan(20);
  expect(Math.abs(m.offsetY), 'shake _offsetY |.| < 20').toBeLessThan(20);
  expect(m.boundsHeight, 'camera bounds height >= renderer.layer.height').toBeGreaterThanOrEqual(m.layerHeight);
  expect(m.playerDepth, 'player renders above boss').toBeGreaterThan(m.bossDepth);
  expect(m.barScreenY, 'boss HP fill stays near its HUD y under shake').toBeGreaterThan(30);
  expect(m.barScreenY, 'boss HP fill stays near its HUD y under shake').toBeLessThan(80);
  expect(m.barWidth, 'boss HP fill has non-zero width').toBeGreaterThan(0);
  expect(
    m.bossBarRed,
    'boss HP bar shows red fill: ' + JSON.stringify({ x: m.barScreenX, y: m.barScreenY, width: m.barWidth, red: m.bossBarRed })
  ).toBeGreaterThan(1000);
  expect(errors, 'no pageerror / console error').toHaveLength(0);
});
