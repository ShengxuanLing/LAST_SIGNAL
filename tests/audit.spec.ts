import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Fixed-seed playability regression.
//
// Replaces the old "audit" probe, which pushed fake objects (Object.create of an
// undefined prototype + Object.assign) into world.enemies. Those objects had no
// update(), so the game threw `e.update is not a function` while the test still
// reported "passed" because it contained zero assertions.
//
// This test uses a fixed map seed, real Enemy instances, real pointer/keyboard
// input and asserts the whole core loop. Every step must pass with no pageerror
// or console error.

const PORT = Number(process.env.PORT ?? 5173);
const SEED = 424242;
const SHOT_DIR = process.env.LS_SHOT_DIR
  ? path.resolve(process.env.LS_SHOT_DIR)
  : path.resolve('screens');

// Screen coords for a grid point, derived from the live camera transform (so it
// works for any zoom / scroll instead of hard-coding a pixel position).
async function gridToScreen(page: any, gx: number, gy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ gx, gy }) => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    const w = gs.world, cam = gs.cameras.main;
    const p0 = cam.getWorldPoint(0, 0);
    const px = cam.getWorldPoint(100, 0);
    const py = cam.getWorldPoint(0, 100);
    const ax = (px.x - p0.x) / 100, bx = p0.x;
    const ay = (py.y - p0.y) / 100, by = p0.y;
    const d = w.worldToScreen(gx, gy);
    return { x: (d.x - bx) / ax, y: (d.y - by) / ay };
  }, { gx, gy });
}

async function worldState(page: any) {
  return page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    if (!gs?.world) return null;
    const w = gs.world, pl = w.player, cam = gs.cameras.main;
    const c = cam.getWorldPoint(640, 360);
    const s = w.worldToScreen(pl.wx, pl.wy);
    return {
      active: g.scene.getScenes(true).map((x: any) => x.constructor.name),
      seed: gs.seed, paused: gs.paused, camAlpha: cam.alpha, zoom: cam.zoom,
      grid: { x: pl.wx, y: pl.wy }, sprite: { x: pl.sprite.x, y: pl.sprite.y },
      w2s: s, spriteErr: Math.hypot(pl.sprite.x - s.x, pl.sprite.y - s.y),
      centerErr: Math.hypot(c.x - pl.sprite.x, c.y - pl.sprite.y),
      enemies: w.enemies.length, projectiles: w.projectiles.length, loot: w.loot.length,
      xp: pl.data.xp, level: pl.data.level, currency: pl.data.currency,
      weapon: pl.data.weaponKey, upgrades: pl.data.upgrades.slice(),
      kills: gs.enemiesKilled, items: gs.itemsCollected, dmg: gs.damageDealt,
      txtHp: gs.txtHp.text, txtXp: gs.txtXp.text, txtWeapon: gs.txtWeapon.text,
      txtStats: gs.txtStats.text, room: w.currentRoom(),
      hasPortal: !!w.portal,
      portal: w.portal ? { wx: w.portal.wx, wy: w.portal.wy, targetRoom: w.portal.targetRoom } : null
    };
  });
}

test('fixed-seed playability regression: menu -> movement -> fire -> kill -> loot -> upgrade -> pause -> teleport', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  mkdirSync(SHOT_DIR, { recursive: true });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => !!(window as any).__game, { timeout: 10000 });
  await page.waitForTimeout(1300);

  // Instrument MainMenuScene.scene.start so NEW RUN is deterministic (fixed seed)
  // and we can prove the button fires exactly once. The click itself is a real click.
  await page.evaluate((seed) => {
    const g: any = (window as any).__game;
    const menu: any = g.scene.getScene('MainMenuScene');
    (window as any).__gameStarts = 0;
    const orig = menu.scene.start.bind(menu.scene);
    menu.scene.start = (key: string, data?: any) => {
      if (key === 'GameScene') { (window as any).__gameStarts++; return orig(key, { seed }); }
      return orig(key, data);
    };
  }, SEED);

  // 1) Blank click / LOAD RUN / CONTINUE must NOT start GameScene.
  await page.mouse.click(100, 100);
  await page.mouse.click(640, 400); // LOAD RUN, no checkpoint
  await page.mouse.click(640, 460); // CONTINUE, no checkpoint
  await page.waitForTimeout(200);
  const menuState = await page.evaluate(() => ({
    active: (window as any).__game.scene.getScenes(true).map((s: any) => s.constructor.name),
    starts: (window as any).__gameStarts
  }));
  expect(menuState.active, 'menu still active after blank/disabled clicks').toContain('MainMenuScene');
  expect(menuState.starts, 'blank/disabled clicks must not start GameScene').toBe(0);
  await page.screenshot({ path: path.join(SHOT_DIR, 'main-menu.png') });

  // 2) NEW RUN -> GameScene, exactly once, fixed seed, player centred on screen.
  await page.mouse.click(640, 340);
  await page.waitForTimeout(1400);
  let st = await worldState(page);
  expect(st, 'GameScene world exists').not.toBeNull();
  expect(st.active, 'GameScene active').toContain('GameScene');
  expect(st.active, 'MainMenuScene stopped').not.toContain('MainMenuScene');
  expect(st.seed, 'fixed seed applied').toBe(SEED);
  const starts = await page.evaluate(() => (window as any).__gameStarts);
  expect(starts, 'NEW RUN starts GameScene exactly once').toBe(1);
  expect(st.centerErr, 'player near screen centre').toBeLessThan(60);
  expect(st.spriteErr, 'player sprite == worldToScreen(grid)').toBeLessThan(1);
  expect(st.hasPortal, 'portal placed').toBe(true);
  expect(st.room?.kind).toBe('start');

  // 3) WASD actually changes grid coords.
  const gridBefore = st.grid;
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  st = await worldState(page);
  expect(Math.hypot(st.grid.x - gridBefore.x, st.grid.y - gridBefore.y), 'WASD moves wx/wy').toBeGreaterThan(0.3);
  expect(st.spriteErr, 'sprite follows grid after movement').toBeLessThan(1);

  // 4) Hold left mouse -> visible bullets leaving the player, aimed at the pointer.
  const aimAt = await gridToScreen(page, st.grid.x + 3, st.grid.y);
  await page.mouse.move(Math.round(aimAt.x), Math.round(aimAt.y));
  await page.mouse.down();
  await page.waitForTimeout(260);
  const fire = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    const w = gs.world, pl = w.player, cam = gs.cameras.main;
    const ptr = gs.input.activePointer;
    const wp = cam.getWorldPoint(ptr.x, ptr.y);
    const gw = w.screenToWorld(wp.x, wp.y);
    const expectedYaw = Math.atan2(gw.y - pl.wy, gw.x - pl.wx);
    const diff = (a: number, b: number) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); };
    return {
      count: w.projectiles.length, aimYaw: pl.aimYaw, expectedYaw,
      aimErr: diff(pl.aimYaw, expectedYaw), fireHeld: pl.fireHeld(),
      projs: w.projectiles.map((q: any) => {
        const s = w.worldToScreen(q.data.pos.x, q.data.pos.y);
        return {
          visible: q.spr.visible, depth: q.spr.depth,
          dist: Math.hypot(q.spr.x - pl.sprite.x, q.spr.y - pl.sprite.y),
          projErr: Math.hypot(q.spr.x - s.x, q.spr.y - s.y),
          velAngle: Math.atan2(q.data.vel.y, q.data.vel.x),
          speed: Math.hypot(q.data.vel.x, q.data.vel.y)
        };
      })
    };
  });
  expect(fire.count, 'holding mouse produces bullets').toBeGreaterThan(0);
  expect(fire.fireHeld, 'fire flag is set').toBe(true);
  expect(fire.aimErr, 'aim angle points at the pointer (grid space)').toBeLessThan(0.15);
  expect(Math.min(...fire.projs.map((p: any) => p.dist)), 'a bullet is near the player').toBeLessThan(260);
  for (const q of fire.projs) {
    expect(q.visible, 'bullet sprite visible').toBe(true);
    expect(q.projErr, 'bullet sprite == worldToScreen(bullet grid pos)').toBeLessThan(1);
    expect(q.speed, 'bullet has velocity').toBeGreaterThan(1);
    // velocity direction must match the aim angle (mouse direction == actual trajectory)
    const d = Math.abs(((q.velAngle - fire.aimYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    expect(d, 'bullet velocity follows aim').toBeLessThan(0.15);
  }
  await page.screenshot({ path: path.join(SHOT_DIR, 'combat.png') });
  await page.mouse.up();
  await page.waitForTimeout(400);

  // 5) A REAL enemy (has update()) takes damage / dies, drops XP and updates HUD.
  const enemySetup = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    const w = gs.world, pl = w.player;
    for (const q of w.projectiles) q.spr.destroy();
    w.projectiles = [];
    const e = w.spawnEnemy('drone', pl.wx + 3, pl.wy, w.currentRoom()?.id ?? 0, 1);
    (window as any).__enemyId = e._id;
    return { id: e._id, maxHp: e._hp, hasUpdate: typeof e.update === 'function', grid: { x: e.x, y: e.y } };
  });
  expect(enemySetup.hasUpdate, 'spawned enemy is a real Enemy with update()').toBe(true);
  expect(enemySetup.maxHp).toBeGreaterThan(0);
  const enemyScreen = await gridToScreen(page, enemySetup.grid.x, enemySetup.grid.y);
  await page.mouse.move(Math.round(enemyScreen.x), Math.round(enemyScreen.y));
  await page.mouse.down();
  await page.waitForTimeout(1400);
  await page.mouse.up();
  st = await worldState(page);
  const enemyHp = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    const e = gs.world.enemies.find((x: any) => x._id === (window as any).__enemyId);
    return e ? e._hp : -1; // -1 => removed (killed)
  });
  expect(enemyHp < enemySetup.maxHp || enemyHp === -1, 'enemy HP dropped or enemy died').toBe(true);
  expect(st.dmg, 'damage stat updated').toBeGreaterThan(0);
  expect(st.kills, 'kill counted').toBeGreaterThan(0);
  expect(st.xp, 'XP gained from kill').toBeGreaterThan(0);
  expect(st.txtXp, 'HUD XP text updated').toContain(`${st.xp}`);
  expect(st.txtStats, 'HUD stats text shows kills').toContain('KILLS');

  // 5b) Enemy ranged bullets spawn AT the enemy with velocity toward the player;
  //     Boss laser/shockwave still set velocity on the returned data object.
  const projectileRegress = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    const w = gs.world, pl = w.player;
    for (const q of w.projectiles) q.spr.destroy();
    w.projectiles = [];
    const e = w.spawnEnemy('drone', pl.wx + 6, pl.wy, w.currentRoom()?.id ?? 0, 1);
    e.attackTimer = 0;
    e.doAttack(pl);
    const q: any = w.projectiles[w.projectiles.length - 1];
    const enemyShot = q ? {
      atEnemy: Math.abs(q.data.pos.x - e.x) < 0.01 && Math.abs(q.data.pos.y - e.y) < 0.01,
      speed: Math.hypot(q.data.vel.x, q.data.vel.y)
    } : null;
    let bossOk = null;
    try {
      w.spawnBoss(w.map.rooms[w.currentRoom()?.id ?? 0]);
      const boss: any = w.boss;
      boss.attackTimer = 0; boss.phase = 2; boss.stateTimer = -1;
      const c0 = w.projectiles.length;
      boss.doAttack(pl, 20);
      const c1 = w.projectiles.length;
      boss.phase = 3;
      boss.doAttack(pl, 20);
      bossOk = {
        laserCreated: c1 - c0,
        total: w.projectiles.length,
        anyVelocity: w.projectiles.some((x: any) => Math.hypot(x.data.vel.x, x.data.vel.y) > 0)
      };
      boss.sprite.destroy(); w.boss = null;
      for (const x of w.projectiles) x.spr.destroy();
      w.projectiles = [];
      w.enemies = w.enemies.filter((x: any) => x !== e);
      e.sprite.destroy();
    } catch (err) { bossOk = { error: String(err) }; }
    return { enemyShot, bossOk };
  });
  expect(projectileRegress.enemyShot, 'enemy ranged bullet created').not.toBeNull();
  expect(projectileRegress.enemyShot.atEnemy, 'bullet spawns at enemy, not player').toBe(true);
  expect(projectileRegress.enemyShot.speed, 'bullet has velocity toward player').toBeGreaterThan(0);
  expect((projectileRegress.bossOk as any).error, 'boss attack did not throw').toBeUndefined();
  expect((projectileRegress.bossOk as any).laserCreated, 'boss fireLaser still creates bullets').toBeGreaterThan(0);
  expect((projectileRegress.bossOk as any).anyVelocity, 'boss bullets still get velocity').toBe(true);

  // 6) Loot is visible, then collected (and its sprite is removed).
  const beforeLoot = st.currency;
  // Spawn + read visibility in ONE evaluate: pickupRange is expressed in grid
  // units, so a drop is magnetised almost immediately on the next update tick.
  const lootVisible = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    const w = gs.world;
    w.spawnLoot(w.player.wx + 18, w.player.wy, 'currency', 'currency', 10);
    return { count: w.loot.length, visible: w.loot.map((l: any) => l.spr.visible) };
  });
  expect(lootVisible.count, 'loot drop exists').toBeGreaterThan(0);
  expect(lootVisible.visible.every(Boolean), 'loot sprite visible').toBe(true);
  await page.waitForTimeout(600);
  st = await worldState(page);
  const orphanIcons = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    return gs.children.list.filter((c: any) => c.texture?.key === 'icon_currency').length;
  });
  expect(st.currency, 'currency increased from pickup').toBeGreaterThan(beforeLoot);
  expect(st.items, 'pickup counted').toBeGreaterThan(0);
  expect(st.loot, 'loot list emptied').toBe(0);
  expect(orphanIcons, 'collected loot sprite destroyed').toBe(0);

  // 7) applyUpgrade really mutates state (unit-level guard against the old no-op).
  const upgradeUnit = await page.evaluate(async () => {
    const mod: any = await import('/src/config/upgrades.ts');
    const state: any = { maxHp: 100, hp: 100, speed: 220, damage: 1, critChance: 0.1, critDamage: 1.5,
      pickupRange: 90, cooldownReduced: 0, pierceCount: 0, hpRegen: 0, armor: 0, xpGain: 1,
      dashCooldown: 0.9, upgrades: [] };
    const before = JSON.stringify(state);
    mod.applyUpgrade(mod.UPGRADES.power, state, 1);
    return { changed: JSON.stringify(state) !== before, damage: state.damage, count: Object.keys(mod.UPGRADES).length };
  });
  expect(upgradeUnit.count, '12 upgrade definitions').toBe(12);
  expect(upgradeUnit.changed, 'applyUpgrade mutates PlayerData').toBe(true);
  expect(upgradeUnit.damage, 'power upgrade raises damage').toBeCloseTo(1.1, 5);

  // 8) Level-up scene opens, 3 cards on screen, one click chooses exactly one,
  //    current-run stats change, and play resumes.
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    const pl = gs.world.player;
    pl.data.xp = 0; pl.data.xpToNext = 30; pl.addXp(30);
  });
  await page.waitForTimeout(700);
  const levelUp = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const ls = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'LevelUpScene') as any;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    const d = gs.world.player.data;
    return {
      active: g.scene.isActive('LevelUpScene'), choices: ls?.choices ?? [],
      buttons: (ls?.buttons ?? []).map((b: any) => ({ x: b.x, y: b.y, w: b.width, h: b.height })),
      previews: (ls?.children?.list ?? []).filter((c: any) => c.type === 'Text' && Math.abs(c.y - 450) < 1 && (c.text || '').trim().length > 0).length,
      paused: gs.paused, camAlpha: gs.cameras.main.alpha,
      before: { maxHp: d.maxHp, hp: d.hp, speed: d.speed, damage: d.damage, critChance: d.critChance,
        critDamage: d.critDamage, pickupRange: d.pickupRange, cooldownReduced: d.cooldownReduced,
        pierceCount: d.pierceCount, hpRegen: d.hpRegen, armor: d.armor, xpGain: d.xpGain,
        dashCooldown: d.dashCooldown },
      upgradesBefore: d.upgrades.length
    };
  });
  expect(levelUp.active, 'LevelUpScene opened').toBe(true);
  expect(levelUp.paused, 'game paused while choosing').toBe(true);
  expect(levelUp.choices.length, '3 upgrade cards').toBe(3);
  expect(levelUp.buttons.length, '3 card hit areas').toBe(3);
  for (const b of levelUp.buttons) {
    expect(b.x - b.w / 2, 'card fully on screen (left)').toBeGreaterThan(0);
    expect(b.x + b.w / 2, 'card fully on screen (right)').toBeLessThan(1280);
  }
  expect(levelUp.previews, 'numeric upgrade previews rendered').toBeGreaterThan(0);
  await page.screenshot({ path: path.join(SHOT_DIR, 'levelup.png') });

  await page.mouse.click(Math.round(levelUp.buttons[0].x), Math.round(levelUp.buttons[0].y));
  await page.waitForTimeout(700);
  st = await worldState(page);
  const after = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    const d = gs.world.player.data;
    return { maxHp: d.maxHp, hp: d.hp, speed: d.speed, damage: d.damage, critChance: d.critChance,
      critDamage: d.critDamage, pickupRange: d.pickupRange, cooldownReduced: d.cooldownReduced,
      pierceCount: d.pierceCount, hpRegen: d.hpRegen, armor: d.armor, xpGain: d.xpGain,
      dashCooldown: d.dashCooldown, upgrades: d.upgrades.length,
      levelUpActive: g.scene.isActive('LevelUpScene') };
  });
  expect(after.levelUpActive, 'LevelUpScene closed after choosing').toBe(false);
  expect(st.paused, 'play resumed').toBe(false);
  expect(st.camAlpha, 'camera alpha restored').toBe(1);
  expect(after.upgrades - levelUp.upgradesBefore, 'exactly ONE upgrade chosen').toBe(1);
  const changed = Object.keys(levelUp.before).some((k) => (levelUp.before as any)[k] !== (after as any)[k]);
  expect(changed, 'current-run attributes changed immediately').toBe(true);

  // 9) ESC opens the pause/inventory overlay and closes it again, no getParentScene error.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const pauseOpen = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    return { active: g.scene.isActive('PauseScene'), paused: gs.paused };
  });
  expect(pauseOpen.active, 'PauseScene opened by ESC').toBe(true);
  expect(pauseOpen.paused, 'game paused').toBe(true);
  await page.screenshot({ path: path.join(SHOT_DIR, 'pause.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const pauseClosed = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    return { active: g.scene.isActive('PauseScene'), paused: gs.paused };
  });
  expect(pauseClosed.active, 'PauseScene closed').toBe(false);
  expect(pauseClosed.paused, 'game resumed').toBe(false);

  // 9b) SETTINGS: two independent volume rows both change and persist.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  await page.mouse.click(640, 420); // SETTINGS
  await page.waitForTimeout(350);
  const settingsBefore = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const ps: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'PauseScene');
    const c: any = ps.children.list.find((x: any) => x.type === 'Container');
    const txt = c ? c.list.filter((x: any) => x.type === 'Text').map((x: any) => x.text) : [];
    return { master: txt.find((t: string) => t.startsWith('MASTER')), sfx: txt.find((t: string) => t.startsWith('SFX')), arrows: txt.filter((t: string) => t === '◀' || t === '▶').length };
  });
  expect(settingsBefore.arrows, 'two rows of volume arrows (4 total)').toBe(4);
  expect(settingsBefore.master, 'master volume label shown').toBeTruthy();
  expect(settingsBefore.sfx, 'sfx volume label shown').toBeTruthy();
  await page.mouse.click(480, 300); // master -
  await page.mouse.click(480, 340); // sfx -
  await page.waitForTimeout(300);
  const settingsAfter = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const ps: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'PauseScene');
    const c: any = ps.children.list.find((x: any) => x.type === 'Container');
    const txt = c ? c.list.filter((x: any) => x.type === 'Text').map((x: any) => x.text) : [];
    const saved = JSON.parse(localStorage.getItem('last_signal_save_v1') || '{}');
    return {
      master: txt.find((t: string) => t.startsWith('MASTER')),
      sfx: txt.find((t: string) => t.startsWith('SFX')),
      settings: saved.settings || null
    };
  });
  expect(settingsAfter.master, 'master volume changed').not.toBe(settingsBefore.master);
  expect(settingsAfter.sfx, 'sfx volume changed').not.toBe(settingsBefore.sfx);
  expect(settingsAfter.settings?.screenShake, 'strict validate() still accepts persisted save').toBe(true);
  await page.mouse.click(640, 370); // screen shake toggle
  await page.mouse.click(640, 405); // reset audio
  const restoredSettings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('last_signal_save_v1') || '{}').settings);
  expect(restoredSettings).toMatchObject({ screenShake: false, masterVolume: 0.7, sfxVolume: 0.8 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const settingsClosed = await page.evaluate(() => ({
    pauseActive: (window as any).__game.scene.isActive('PauseScene'),
    paused: (Object.values((window as any).__game.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any).paused
  }));
  expect(settingsClosed.pauseActive, 'PauseScene closed by ESC from settings').toBe(false);
  expect(settingsClosed.paused, 'game resumed after settings').toBe(false);

  // 10) F teleports to the next room: grid == nearest walkable landing tile and sprite follows.
  st = await worldState(page);
  expect(st.hasPortal, 'portal available for teleport').toBe(true);
  const teleport = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
    const w = gs.world, t = w.map.rooms[w.portal.targetRoom];
    const expected = w.findWalkableInRoom(t);
    w.player.reset(w.portal.wx, w.portal.wy); // walk onto the portal
    return { expected, beforeRoom: w.currentRoom()?.id, expectedWalkable: w.isWalkable(expected.x, expected.y, 0.5) };
  });
  expect(teleport.expectedWalkable, 'target landing tile is walkable').toBe(true);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(500);
  st = await worldState(page);
  expect(Math.abs(st.grid.x - teleport.expected.x), 'teleported grid x == target landing tile').toBeLessThan(0.01);
  expect(Math.abs(st.grid.y - teleport.expected.y), 'teleported grid y == target landing tile').toBeLessThan(0.01);
  expect(st.spriteErr, 'teleported sprite == worldToScreen(grid)').toBeLessThan(1);
  expect(st.room?.id, 'entered a different room').not.toBe(teleport.beforeRoom);
  expect(st.centerErr, 'camera re-centred after teleport').toBeLessThan(120);

  // 11) The orange wall stripe flood is gone: sample the actual game canvas.
  const orangeRatio = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const ctx = g.canvas.getContext('2d');
    const d = ctx.getImageData(0, 0, 1280, 720).data;
    let orange = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (r > 150 && gg > 55 && gg < 185 && b < 120 && r - gg > 55) orange++;
    }
    return orange / (1280 * 720);
  });
  expect(orangeRatio, 'orange stripes no longer cover the screen').toBeLessThan(0.02);

  // 12) QUIT TO MENU shuts the run down; a second NEW RUN starts fresh & playable.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  await page.mouse.click(640, 480); // QUIT TO MENU
  await page.waitForTimeout(600);
  const afterQuit = await page.evaluate(() => ({
    active: (window as any).__game.scene.getScenes(true).map((s: any) => s.constructor.name),
    menuActive: (window as any).__game.scene.isActive('MainMenuScene')
  }));
  expect(afterQuit.menuActive, 'MainMenuScene active after quit').toBe(true);
  expect(afterQuit.active, 'GameScene stopped after quit').not.toContain('GameScene');
  await page.mouse.click(640, 340); // NEW RUN again
  await page.waitForTimeout(200);
  await page.mouse.click(640, 400); // REPLACE AND START
  await page.waitForTimeout(1200);
  const secondRun = await worldState(page);
  expect(secondRun.active, 'second GameScene active').toContain('GameScene');
  expect(secondRun.paused, 'second run is NOT frozen').toBe(false);
  expect(secondRun.centerErr, 'second run camera centred').toBeLessThan(60);

  // 13) No pageerror / console error across the whole flow.
  expect(errors, 'no pageerror / console error').toEqual([]);
});


// ---------------------------------------------------------------------------
// P2 (second phase) regression. Phase-1 assertions above are untouched (81).
// Covers: normalised Boss bullet speed + visible/surviving bullets after 0.5s,
// screen-locked worldLight under camera scroll/zoom, unlockedWeapons from the
// save + Q/E switching + auto-reload, single UI sound per click, and the
// dimmed LOAD RUN / CONTINUE buttons when there is no checkpoint.
// ---------------------------------------------------------------------------
test('P2 regression: boss bullets, screen-locked light, unlocked weapons, single UI sound', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  mkdirSync(SHOT_DIR, { recursive: true });

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => !!(window as any).__game, { timeout: 10000 });
  await page.waitForTimeout(1300);

  // Instrument the AudioSystem singleton so we can count real UI sounds.
  await page.evaluate(async () => {
    const mod: any = await import('/src/systems/AudioSystem.ts');
    const a = mod.audio;
    (window as any).__uiCount = 0;
    (window as any).__chooseCount = 0;
    const ui = a.ui.bind(a);
    const choose = a.levelchoose.bind(a);
    a.ui = (...args: any[]) => { (window as any).__uiCount++; return ui(...args); };
    a.levelchoose = (...args: any[]) => { (window as any).__chooseCount++; return choose(...args); };
  });

  // Seed a save with three unlocked weapons (no 'arc'), then start a fixed-seed run.
  await page.evaluate((seed) => {
    const save = {
      version: 1, createdAt: 'p2', updatedAt: 'p2',
      permanent: {
        maxHpBonus: 0, speedBonus: 0, damageBonus: 0, critChanceBonus: 0,
        armorBonus: 0, xpBonus: 0, currencyBonus: 0,
        unlockedWeapons: ['pulse', 'scatter', 'plasma'], unlockedAbilities: [],
        runs: 0, bossesDefeated: 0, bestSeed: 0
      },
      settings: { masterVolume: 0.7, sfxVolume: 0.8, mouseDpi: 1, fullscreen: false, screenShake: true },
      stats: { enemiesKilled: 0, itemsCollected: 0, damageDealt: 0, playTimeSeconds: 0 }
    };
    localStorage.setItem('last_signal_save_v1', JSON.stringify(save));
    const g: any = (window as any).__game;
    const m: any = g.scene.getScene('MainMenuScene');
    const o = m.scene.start.bind(m.scene);
    m.scene.start = (key: string, data?: any) => key === 'GameScene' ? o(key, { seed }) : o(key, data);
  }, SEED);

  // LOAD RUN / CONTINUE must stay dimmed when no checkpoint exists.
  const disabled = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const m: any = g.scene.getScene('MainMenuScene');
    const labels = m.children.list.filter((c: any) => c.type === 'Text').map((c: any) => c.text);
    const dimRects = m.children.list.filter((c: any) => c.type === 'Rectangle' && c.fillAlpha === 0.16).length;
    return { labels, dimRects };
  });
  expect(disabled.labels).toEqual(expect.arrayContaining(['LOAD RUN', 'CONTINUE']));
  expect(disabled.dimRects, 'two dimmed button backgrounds').toBe(2);
  await page.mouse.click(640, 400); // LOAD RUN
  await page.mouse.click(640, 460); // CONTINUE
  await page.waitForTimeout(200);
  const afterDisabled = await page.evaluate(() => ({
    active: (window as any).__game.scene.getScenes(true).map((s: any) => s.constructor.name),
    ui: (window as any).__uiCount,
    flash: ((window as any).__game.scene.getScene('MainMenuScene').children.list
      .filter((c: any) => c.type === 'Text').map((c: any) => c.text) as string[])
      .includes('NO CHECKPOINT AVAILABLE')
  }));
  expect(afterDisabled.active, 'disabled buttons do not start GameScene').toContain('MainMenuScene');
  expect(afterDisabled.active, 'no GameScene from LOAD RUN/CONTINUE').not.toContain('GameScene');
  expect(afterDisabled.flash, 'missing-checkpoint prompt rendered').toBe(true);
  expect(afterDisabled.ui, 'one UI sound per disabled-button click').toBe(2);

  await page.mouse.click(640, 340); // NEW RUN
  await page.waitForTimeout(1300);
  const newRunUi = await page.evaluate(() => (window as any).__uiCount);
  expect(newRunUi, 'NEW RUN click adds exactly ONE UI sound (no double play)').toBe(3);

  // Unlocked weapons came from the save, no un-unlocked weapon granted.
  const gear = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const d = gs.world.player.data;
    return { keys: d.weapons.map((w: any) => w.key), weaponKey: d.weaponKey,
      scatter: d.weapons.find((w: any) => w.key === 'scatter') };
  });
  expect(gear.keys, 'weapons read from save.unlockedWeapons').toEqual(['pulse', 'scatter', 'plasma']);
  expect(gear.keys, 'no un-unlocked arc weapon granted').not.toContain('arc');
  expect(gear.weaponKey, 'starts with pulse').toBe('pulse');
  expect(gear.scatter.ammo, 'scatter starts with a full magazine').toBe(8);
  expect(gear.scatter.magazine, 'scatter magazine = 8').toBe(8);

  // Q/E now actually switch because owned.length > 1.
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(120);
  const afterQ = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    return gs.world.player.data.weaponKey;
  });
  expect(afterQ, 'Q switches weapon').not.toBe('pulse');
  expect(gear.keys, 'Q stays within owned weapons').toContain(afterQ);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(120);
  const afterE = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    return gs.world.player.data.weaponKey;
  });
  expect(afterE, 'E switches back to pulse').toBe('pulse');

  // Emptying a magazine now auto-recovers instead of locking the weapon forever.
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const ws = gs.world.player.data.weapons.find((w: any) => w.key === 'scatter');
    ws.ammo = 0; ws.reloading = true; ws.reloadTimer = 0.05;
  });
  await page.waitForTimeout(250);
  const reloaded = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const ws = gs.world.player.data.weapons.find((w: any) => w.key === 'scatter');
    return { ammo: ws.ammo, reloading: ws.reloading };
  });
  expect(reloaded.reloading, 'reload finishes').toBe(false);
  expect(reloaded.ammo, 'magazine refilled').toBe(8);

  // ---- screen-locked worldLight: before camera move ----
  const lightRect = () => page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const cam = gs.cameras.main, L = gs.world.renderer.light;
    const m = Array.from(cam.matrix.matrix) as number[];
    const tp = cam.matrix.transformPoint(L.x - cam.scrollX * L.scrollFactorX, L.y - cam.scrollY * L.scrollFactorY, { x: 0, y: 0 });
    return { x: tp.x, y: tp.y, w: 1280 * L.scaleX * m[0], h: 720 * L.scaleY * m[3],
      zoom: cam.zoom, scrollX: cam.scrollX, scrollY: cam.scrollY,
      scrollFactorX: L.scrollFactorX, originX: L.originX, visible: L.visible,
      prerenderListeners: gs.events.listenerCount('prerender') };
  });
  const lightBefore = await lightRect();
  expect(lightBefore.scrollFactorX, 'worldLight scrollFactorX = 0').toBe(0);
  expect(lightBefore.originX, 'worldLight origin(0,0)').toBe(0);
  expect(lightBefore.visible, 'worldLight visible').toBe(true);
  expect(Math.abs(lightBefore.x), 'light left edge at screen x=0').toBeLessThan(2);
  expect(Math.abs(lightBefore.y), 'light top edge at screen y=0').toBeLessThan(2);
  expect(Math.abs(lightBefore.w - 1280), 'light covers full screen width').toBeLessThan(2);
  expect(Math.abs(lightBefore.h - 720), 'light covers full screen height').toBeLessThan(2);
  await page.screenshot({ path: path.join(SHOT_DIR, 'p2-light-before-camera-move.png') });

  // Move the player to another room AND change zoom; light must stay locked.
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world, t = w.map.rooms[3];
    w.player.reset(t.gx + t.w / 2, t.gy + t.h / 2);
    gs.cameras.main.setZoom(1.25);
  });
  await page.waitForTimeout(300);
  const lightAfter = await lightRect();
  await page.screenshot({ path: path.join(SHOT_DIR, 'p2-light-after-camera-move.png') });
  expect(Math.abs(lightAfter.scrollX - lightBefore.scrollX), 'camera actually scrolled').toBeGreaterThan(50);
  expect(Math.abs(lightAfter.zoom - lightBefore.zoom), 'camera actually zoomed').toBeGreaterThan(0.02);
  expect(Math.abs(lightAfter.x - lightBefore.x), 'light screen x unchanged after camera move/zoom').toBeLessThan(2);
  expect(Math.abs(lightAfter.y - lightBefore.y), 'light screen y unchanged after camera move/zoom').toBeLessThan(2);
  expect(Math.abs(lightAfter.w - 1280), 'light still covers width after zoom').toBeLessThan(2);
  expect(Math.abs(lightAfter.h - 720), 'light still covers height after zoom').toBeLessThan(2);
  expect(lightAfter.prerenderListeners, 'no duplicate prerender listeners').toBe(1);

  // ---- Boss bullets: normalised speed + still visible after 0.5s ----
  const bossInit = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world, pl = w.player;
    for (const q of w.projectiles) q.spr.destroy();
    w.projectiles = [];
    if (!w.boss) w.spawnBoss(w.map.rooms[w.currentRoom()?.id ?? 0]);
    const boss = w.boss;
    // The player was just reset() into this room and is invulnerable, so a Boss
    // spawned on top of the player would have all 15 bullets consumed by the
    // player-collision check on the very first frame (no knockback while invuln).
    // Put the Boss on a walkable tile ~9 grid units away so the barrage actually
    // flies and stays inside the visible viewport.
    const offsets = [[9, 0], [9, -3], [9, 3], [7, -6], [-9, 0], [0, -9]];
    for (const [dx, dy] of offsets) {
      const nx = pl.wx + dx, ny = pl.wy + dy;
      if (w.isWalkable(nx, ny, 0.5) && w.tileAt(nx, ny).type !== 'wall') {
        boss.wx = nx; boss.wy = ny; boss.project();
        break;
      }
    }
    boss.attackTimer = 999999; boss.stateTimer = 999999; // freeze auto-attacks
    const c0 = w.projectiles.length;
    boss.phase = 2; boss.fireLaser(pl); boss.shockwave();
    const created = w.projectiles.slice(c0);
    const cam = gs.cameras.main;
    return {
      count: created.length,
      speeds: created.map((q: any) => Math.hypot(q.data.vel.x, q.data.vel.y)),
      bullets: created.map((q: any) => ({
        id: q.data.id, pos: { x: q.data.pos.x, y: q.data.pos.y },
        vel: { x: q.data.vel.x, y: q.data.vel.y }, visible: q.spr.visible,
        screen: (() => { const tp = cam.matrix.transformPoint(q.spr.x - cam.scrollX, q.spr.y - cam.scrollY, { x: 0, y: 0 }); return { x: tp.x, y: tp.y }; })()
      }))
    };
  });
  expect(bossInit.count, 'laser(3) + shockwave(12) bullets created').toBe(15);
  const maxSpeed = Math.max(...bossInit.speeds);
  const minSpeed = Math.min(...bossInit.speeds);
  expect(minSpeed, 'Boss bullets still have velocity (phase-1 guarantee)').toBeGreaterThan(0);
  expect(maxSpeed, 'Boss bullet speed normalised (<= 3 tile/s, not 160)').toBeLessThanOrEqual(3);
  expect(Math.abs(maxSpeed - 2.5), 'laser = 160/64 = 2.5 tile/s').toBeLessThan(0.01);
  expect(Math.abs(minSpeed - 1.875), 'shockwave = 120/64 = 1.875 tile/s').toBeLessThan(0.01);
  expect(bossInit.bullets.every((b: any) => b.visible), 'all Boss bullet sprites visible').toBe(true);
  expect(bossInit.bullets.every((b: any) => b.screen.x > 0 && b.screen.x < 1280 && b.screen.y > 0 && b.screen.y < 720),
    'Boss bullets spawn inside the visible viewport').toBe(true);
  await page.waitForTimeout(500);
  const afterHalf = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const w = gs.world, cam = gs.cameras.main;
    return {
      count: w.projectiles.length,
      visible: w.projectiles.filter((q: any) => q.spr.visible).length,
      lifetimes: w.projectiles.map((q: any) => q.data.lifetime),
      bullets: w.projectiles.map((q: any) => ({
        id: q.data.id, pos: { x: q.data.pos.x, y: q.data.pos.y },
        screen: (() => { const tp = cam.matrix.transformPoint(q.spr.x - cam.scrollX, q.spr.y - cam.scrollY, { x: 0, y: 0 }); return { x: tp.x, y: tp.y }; })()
      }))
    };
  });
  expect(afterHalf.count, 'Boss bullets still exist 0.5s later').toBeGreaterThan(0);
  expect(afterHalf.visible, 'all surviving Boss bullets still visible').toBe(afterHalf.count);
  expect(afterHalf.lifetimes.every((l: number) => l > 0), 'bullets not expired').toBe(true);
  const moved = afterHalf.bullets.some((b: any) => {
    const before = bossInit.bullets.find((x: any) => x.id === b.id);
    return before && Math.hypot(b.pos.x - before.pos.x, b.pos.y - before.pos.y) > 0.05;
  });
  expect(moved, 'Boss bullets actually travelled (not 160-tile/s teleport)').toBe(true);
  expect(afterHalf.bullets.every((b: any) => b.screen.x > 0 && b.screen.x < 1280 && b.screen.y > 0 && b.screen.y < 720),
    'surviving bullets remain on screen after 0.5s').toBe(true);
  await page.screenshot({ path: path.join(SHOT_DIR, 'p2-boss-barrage.png') });

  // A boss attack used to shake the camera by ~1e5 px and blank the whole frame.
  const shakeBounded = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const cam = gs.cameras.main;
    const sh: any = (cam as any).shakeEffect;
    return { offsetX: sh._offsetX, offsetY: sh._offsetY, intensityX: sh.intensity.x };
  });
  expect(Math.abs(shakeBounded.offsetX), 'shake offset X bounded to a few px').toBeLessThan(20);
  expect(Math.abs(shakeBounded.offsetY), 'shake offset Y bounded to a few px').toBeLessThan(20);
  const bright = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const d = g.canvas.getContext('2d').getImageData(0, 0, 1280, 720).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) n++;
    return n;
  });
  expect(bright, 'frame is NOT blanked during a Boss attack').toBeGreaterThan(1000);

  // One card click -> exactly one levelchoose sound (no double play).
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
    const pl = gs.world.player;
    pl.data.xp = 0; pl.data.xpToNext = 30; pl.addXp(30);
  });
  await page.waitForTimeout(500);
  const cardBtn = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const ls: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'LevelUpScene');
    return ls && ls.buttons.length ? { x: ls.buttons[0].x, y: ls.buttons[0].y } : null;
  });
  expect(cardBtn, 'LevelUpScene card available').not.toBeNull();
  // Q/E weapon switches also play a ui sound (2 earlier), so take a fresh
  // baseline here: a card click must add exactly one levelchoose and zero ui.
  const uiBeforeCard = await page.evaluate(() => (window as any).__uiCount);
  await page.mouse.click(Math.round(cardBtn.x), Math.round(cardBtn.y));
  await page.waitForTimeout(500);
  const cardSound = await page.evaluate(() => ({ ui: (window as any).__uiCount, choose: (window as any).__chooseCount }));
  expect(cardSound.choose, 'one card click -> exactly one levelchoose sound').toBe(1);
  expect(cardSound.ui, 'card click does not add extra ui sounds').toBe(uiBeforeCard);

  expect(errors, 'no pageerror / console error across P2 flow').toEqual([]);
});
