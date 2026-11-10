import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 5173);
const SHOT_DIR = process.env.LS_SHOT_DIR
  ? path.resolve(process.env.LS_SHOT_DIR)
  : path.resolve('screens');

const PROJECT = path.resolve(process.env.LAST_SIGNAL_ROOT ?? process.cwd());

async function scaleState(page: any) {
  return page.evaluate(() => {
    const g: any = (window as any).__game;
    const rect = g.canvas.getBoundingClientRect();
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      canvasRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      canvasAttr: { w: g.canvas.width, h: g.canvas.height },
      displayW: g.scale.displaySize.width,
      displayH: g.scale.displaySize.height,
      gameW: g.scale.gameSize.width,
      gameH: g.scale.gameSize.height,
      scaleMode: g.scale.scaleMode,
      autoCenter: g.scale.autoCenter,
      canvasImageRendering: g.canvas.style.imageRendering,
      render: {
        antialias: g.renderer.config.antialias,
        roundPixels: g.renderer.config.roundPixels,
        pixelArt: g.config.pixelArt
      }
    };
  });
}

test('runtime bug regressions: viewport scaling, text rendering, wall alignment, projectile cleanup', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  mkdirSync(SHOT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => !!(window as any).__game, { timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of g.scene.getScenes(true)) g.scene.stop(s.sys.settings.key);
    g.scene.start('GameScene', { seed: 424242 });
  });
  await page.waitForTimeout(1200);

  // 1) Fixed 1280x720 canvas must scale to the viewport, not sit in the top-left corner.
  const s1440 = await scaleState(page);
  expect(s1440.gameW, 'internal game width stays 1280').toBe(1280);
  expect(s1440.gameH, 'internal game height stays 720').toBe(720);
  expect(s1440.scaleMode, 'Phaser ScaleManager is active').not.toBe(0);
  expect(s1440.canvasRect.w, 'canvas fills viewport width').toBeGreaterThanOrEqual(s1440.viewport.w - 2);
  expect(s1440.canvasRect.h, 'canvas fills most of viewport height').toBeGreaterThan(s1440.viewport.h * 0.88);
  expect(s1440.canvasRect.x, 'canvas is centered horizontally').toBeLessThanOrEqual(2);
  // Text must not be forced through global pixelArt / nearest-neighbour CSS scaling.
  expect(s1440.render.antialias, 'canvas antialias is enabled for readable text').toBe(true);
  expect(s1440.render.roundPixels, 'text is not rounded to whole pixels').toBe(false);
  expect(s1440.render.pixelArt, 'global pixelArt mode is off').toBe(false);
  expect(s1440.canvasImageRendering, 'canvas is not image-rendering: pixelated').not.toContain('pixelated');
  await page.screenshot({ path: path.join(SHOT_DIR, 'runtime-bugs-1440x900.png') });

  // 16:9 viewport should cover both axes exactly.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);
  const s1920 = await scaleState(page);
  expect(s1920.canvasRect.w, '16:9 canvas fills width').toBeGreaterThanOrEqual(s1920.viewport.w - 2);
  expect(s1920.canvasRect.h, '16:9 canvas fills height').toBeGreaterThanOrEqual(s1920.viewport.h - 2);
  expect(s1920.render.antialias, 'antialias stays enabled on 16:9').toBe(true);
  expect(s1920.canvasImageRendering, '16:9 canvas is not pixelated').not.toContain('pixelated');
  await page.screenshot({ path: path.join(SHOT_DIR, 'runtime-bugs-1920x1080.png') });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  // 2) Wall collision still blocks logical wall cells.
  const wallCheck = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world;
    const key = (x: number, y: number) => `${x},${y}`;
    const floor = new Set<string>();
    for (const row of w.map.tiles) for (const t of row) if (t.type !== 'wall') floor.add(key(t.x, t.y));
    const samples: Array<{ x: number; y: number; centerR05: boolean; centerR01: boolean }> = [];
    for (const row of w.map.tiles) for (const t of row) {
      if (t.type !== 'wall') continue;
      let adjacent = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) if (floor.has(key(t.x + dx, t.y + dy))) adjacent = true;
      }
      if (!adjacent) continue;
      samples.push({
        x: t.x, y: t.y,
        centerR05: w.isWalkable(t.x + 0.5, t.y + 0.5, 0.5),
        centerR01: w.isWalkable(t.x + 0.5, t.y + 0.5, 0.1)
      });
      if (samples.length >= 12) break;
    }
    return { count: samples.length, allBlocked: samples.every((s) => !s.centerR05 && !s.centerR01) };
  });
  expect(wallCheck.count, 'found wall cells adjacent to floor').toBeGreaterThan(0);
  expect(wallCheck.allBlocked, 'logical wall cells are not walkable').toBe(true);

  // 3) Enemy-hit knockback must not push the player through a wall.
  const knockback = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world;
    const key = (x: number, y: number) => `${x},${y}`;
    const byKey = new Map();
    for (const row of w.map.tiles) for (const t of row) byKey.set(key(t.x, t.y), t);
    let chosen: any = null;
    for (const row of w.map.tiles) for (const t of row) {
      if (t.type === 'wall' || !w.isWalkable(t.x, t.y, 0.5)) continue;
      const wall = byKey.get(key(t.x + 1, t.y));
      const behind = byKey.get(key(t.x - 1, t.y));
      if (wall && wall.type === 'wall' && behind && behind.type !== 'wall') { chosen = { floor: t, wall }; break; }
    }
    if (!chosen) return { found: false };
    const p = w.player;
    p.reset(chosen.floor.x, chosen.floor.y);
    p.data.hp = p.data.maxHp;
    p.invuln = 0;
    const before = { x: p.wx, y: p.wy };
    // Source on the floor side pushes the player toward the wall at +x.
    p.hurt(10, chosen.floor.x - 1, chosen.floor.y);
    return {
      found: true,
      wall: { x: chosen.wall.x, y: chosen.wall.y },
      before,
      after: { x: p.wx, y: p.wy },
      walkable: w.isWalkable(p.wx, p.wy, p.getRadius())
    };
  });
  expect(knockback.found, 'found a floor/wall/floor line for knockback test').toBe(true);
  expect(knockback.walkable, 'player remains on walkable ground after knockback').toBe(true);
  expect(knockback.after.x, 'player does not cross into the wall tile').toBeLessThan(knockback.wall.x);

  // 3b) If already inside a wall, the next update recovers to the nearest walkable cell.
  const recovery = await page.evaluate(({ wallX, wallY }: { wallX: number; wallY: number }) => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world;
    const p = w.player;
    p.wx = wallX;
    p.wy = wallY;
    p.project();
    return { walkableBefore: w.isWalkable(p.wx, p.wy, p.getRadius()) };
  }, { wallX: knockback.wall.x, wallY: knockback.wall.y });
  expect(recovery.walkableBefore, 'test placed player inside a wall').toBe(false);
  await page.waitForTimeout(120);
  const recovered = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world;
    return { x: w.player.wx, y: w.player.wy, walkable: w.isWalkable(w.player.wx, w.player.wy, w.player.getRadius()) };
  });
  expect(recovered.walkable, 'stuck player recovers to walkable ground').toBe(true);

  // 4) Wall top face is aligned to its own iso diamond, not lifted into neighbouring floor.
  const rendererSrc = readFileSync(path.join(PROJECT, 'src/world/WorldRenderer.ts'), 'utf8');
  expect(rendererSrc, 'old lifted wall top is gone').not.toContain('_diamond(g, cx, cy - wallH');
  expect(rendererSrc, 'wall top sits on own diamond').toContain('_diamond(g, cx, cy, halfW, halfH)');
  expect(rendererSrc, 'wall body extends downward').toContain('cy + wallH');

  // 5) Bullets must actually destroy their sprites when removed from world.projectiles.
  const worldSrc = readFileSync(path.join(PROJECT, 'src/world/World.ts'), 'utf8');
  expect(worldSrc, 'projectile sprite cleanup helper exists').toContain('destroyProjectileSprite');
  expect(worldSrc, 'projectile radius is normalized to tile units').toContain('/ GAME.PIXEL_TO_TILE');

  await page.mouse.move(900, 360);
  await page.mouse.down();
  await page.waitForFunction(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs?.world;
    return !!w && w.player.fireHeld() && w.projectiles.length > 0;
  }, { timeout: 2000 });
  const fired = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    return gs.world.projectiles.length;
  });
  expect(fired, 'holding fire creates at least one projectile').toBeGreaterThan(0);
  await page.mouse.up();
  await page.waitForTimeout(2200);
  const after = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world;
    const orphan = gs.children.list.filter((c: any) => c.texture && String(c.texture.key).startsWith('proj_'));
    return {
      projectilesArray: w.projectiles.length,
      orphanSprites: orphan.length,
      orphanVisible: orphan.filter((c: any) => c.visible).length
    };
  });
  expect(after.projectilesArray, 'projectile entries expired').toBe(0);
  expect(after.orphanSprites, 'no ghost projectile sprites remain').toBe(0);
  expect(after.orphanVisible, 'no visible ghost projectiles remain').toBe(0);

  await page.screenshot({ path: path.join(SHOT_DIR, 'runtime-bugs-after-cleanup.png') });

  // 6) Level-up text must remain readable and at its designed fixed positions.
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const pl = gs.world.player;
    pl.data.xp = 0; pl.data.xpToNext = 30; pl.addXp(30);
  });
  await page.waitForTimeout(700);
  const levelUp = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const ls: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'LevelUpScene');
    const texts = (ls?.children?.list ?? []).filter((c: any) => c.type === 'Text');
    const descriptions = texts.filter((c: any) => Math.abs(c.y - 330) < 2);
    const diffs = texts.filter((c: any) => Math.abs(c.y - 450) < 2);
    return {
      active: g.scene.getScenes(true).map((s: any) => s.sys.settings.key),
      textCount: texts.length,
      allReadable: texts.every((c: any) => c.width > 0 && c.height > 0 && c.scaleX === 1 && c.scaleY === 1),
      descriptions: descriptions.map((c: any) => ({ text: c.text, x: c.x, y: c.y, width: c.displayWidth, originX: c.originX, align: c.style.align })),
      diffs: diffs.map((c: any) => ({ text: c.text, y: c.y, bottom: c.y + c.displayHeight / 2 })),
      sample: texts.slice(0, 3).map((c: any) => ({ text: c.text, x: c.x, y: c.y, width: c.width, height: c.height }))
    };
  });
  expect(levelUp.active, 'LevelUpScene is active').toContain('LevelUpScene');
  expect(levelUp.textCount, 'level-up texts exist').toBeGreaterThan(0);
  expect(levelUp.allReadable, 'level-up texts have positive size and no forced scaling').toBe(true);
  expect(levelUp.descriptions.length, 'three upgrade descriptions').toBe(3);
  expect(levelUp.descriptions.every((d: any) => d.originX === 0.5 && d.align === 'center' && d.width <= 210), 'descriptions are centered and inside card width').toBe(true);
  expect(levelUp.diffs.length, 'three upgrade diff lines').toBe(3);
  expect(levelUp.diffs.every((d: any) => d.bottom <= 470), 'diff lines stay inside the card bottom').toBe(true);
  await page.screenshot({ path: path.join(SHOT_DIR, 'runtime-bugs-levelup.png') });
  expect(errors, 'no pageerror / console error').toEqual([]);
});

test('cleared room always offers an exit portal, even when every room is visited', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => !!(window as any).__game, { timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of g.scene.getScenes(true)) g.scene.stop(s.sys.settings.key);
    g.scene.start('GameScene', { seed: 424242 });
  });
  await page.waitForTimeout(1200);

  // Start room: portal exists, is walkable, and stays inside the room.
  const startPortal = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world;
    const p = w.portal;
    const room = w.currentRoom();
    return {
      has: !!p,
      walkable: p ? w.isWalkable(p.wx, p.wy, 0.5) : false,
      inRoom: !!(p && room) && p.wx >= room.gx && p.wx < room.gx + room.w && p.wy >= room.gy && p.wy < room.gy + room.h
    };
  });
  expect(startPortal.has, 'start room portal exists').toBe(true);
  expect(startPortal.walkable, 'start room portal is walkable').toBe(true);
  expect(startPortal.inRoom, 'start room portal is inside room bounds').toBe(true);

  // Enter the first connected room, clear it, and verify a portal remains.
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world;
    w.player.reset(w.portal.wx, w.portal.wy);
    w.tryInteract(w.player);
  });
  await page.waitForTimeout(250);
  const entered = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world;
    const room = w.currentRoom();
    for (const e of w.enemies) { e._hp = 0; e.sprite.destroy(); }
    w.enemies = [];
    return { id: room?.id, kind: room?.kind };
  });
  await page.waitForTimeout(250);
  const afterClear = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world;
    const p = w.portal;
    const room = w.currentRoom();
    return {
      has: !!p,
      walkable: p ? w.isWalkable(p.wx, p.wy, 0.5) : false,
      inRoom: !!(p && room) && p.wx >= room.gx && p.wx < room.gx + room.w && p.wy >= room.gy && p.wy < room.gy + room.h,
      roomKind: room?.kind
    };
  });
  expect(entered.kind, 'teleported into a non-start room').not.toBe('start');
  expect(afterClear.has, 'next-room portal remains after clear').toBe(true);
  expect(afterClear.walkable, 'next-room portal is walkable after clear').toBe(true);
  expect(afterClear.inRoom, 'next-room portal stays inside current room').toBe(true);

  // Force the worst case: every room has been visited. The portal must fall back
  // to a connected room instead of disappearing and soft-locking the run.
  const fallback = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world;
    const room = w.map.rooms[w.currentRoom().id];
    w.enteredRooms = new Set(w.map.rooms.map((r: any) => r.id));
    if (w.portal) { w.portal.spr.destroy(); w.portal = null; }
    w.placePortal(room);
    const p = w.portal;
    return {
      has: !!p,
      target: p?.targetRoom,
      neighbor: !!p && room.connectedTo.includes(p.targetRoom),
      walkable: p ? w.isWalkable(p.wx, p.wy, 0.5) : false,
      inRoom: !!p && p.wx >= room.gx && p.wx < room.gx + room.w && p.wy >= room.gy && p.wy < room.gy + room.h
    };
  });
  expect(fallback.has, 'portal exists even when no unvisited room remains').toBe(true);
  expect(fallback.neighbor, 'fallback portal targets a directly connected room').toBe(true);
  expect(fallback.walkable, 'fallback portal is on walkable ground').toBe(true);
  expect(fallback.inRoom, 'fallback portal stays inside current room').toBe(true);

  const exit = await page.evaluate(({ target }: { target: number }) => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world;
    w.player.reset(w.portal.wx, w.portal.wy);
    w.tryInteract(w.player);
    return { room: w.currentRoom()?.id, target };
  }, { target: fallback.target });
  expect(exit.room, 'player can use fallback portal to leave the room').toBe(exit.target);
  expect(errors, 'no pageerror / console error').toEqual([]);
});
