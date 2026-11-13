// ART-RENAISSANCE — reproducible visual baseline + performance capture.
//
// Determinism contract (so AR-02..AR-07 "after" shots are comparable 1:1):
//  * Math.random is replaced before any game script runs by a seeded mulberry32
//    (VISUAL_SEED). This fixes the procedural starfield, level-up card draw,
//    loot bob phase, boss summon angles and Phaser camera shake offsets.
//  * The main run uses a fixed map seed chosen by scanning seeds 1..64 for the
//    first map that contains every room kind (stored in the manifest).
//  * For each still shot the Phaser RAF loop is put to sleep and the game is
//    advanced with game.step(t, 1000/60) a fixed number of frames, so tweens,
//    enemy FSMs, projectiles and the camera lerp all see an identical clock.
//  * Viewport 1280x720, deviceScaleFactor 1 (Phaser.Scale.FIT => 1:1 canvas).
// Nothing here changes game code or game rules; it only drives the public
// window.__game handle that the existing E2E suite already uses.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PHASE = process.env.ART_PHASE ?? 'before';
const OUT = path.resolve('reports', 'art', PHASE);
const PERF_OUT = path.resolve('reports', 'art', 'test-results');
const VISUAL_SEED = 20261113;
const MAIN_KEY = 'last_signal_save_v1';
const FRAME_MS = 1000 / 60;
const REQUIRED_KINDS = ['start', 'combat', 'resource', 'shop', 'event', 'elite', 'boss'];

interface Shot {
  id: string; file: string; scene: string; description: string;
  seed?: number; roomId?: number; roomKind?: string; steps?: number;
  camera?: { zoom: number; scrollX: number; scrollY: number };
  avatar?: string; weapon?: string; notes?: string;
}
const shots: Shot[] = [];
const consoleErrors: string[] = [];

async function seedRandom(page: Page): Promise<void> {
  await page.addInitScript((seed: number) => {
    let a = seed >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, VISUAL_SEED);
}

async function bootToMenu(page: Page): Promise<void> {
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => {
    const g: any = (window as any).__game;
    return !!g && g.scene.isActive('MainMenuScene');
  }, { timeout: 20000 });
  await page.waitForTimeout(400);
}

/** Freeze the RAF loop; from now on only step() advances the game. */
async function freeze(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    const w: any = window as any;
    if (!w.__artClock) w.__artClock = { t: g.loop.now || performance.now() };
    if (g.loop.running) g.loop.sleep();
  });
}

async function wake(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    if (!g.loop.running) g.loop.wake(true);
    (window as any).__artClock = null;
  });
}

async function step(page: Page, frames: number): Promise<void> {
  await page.evaluate(({ frames, dt }) => {
    const g: any = (window as any).__game;
    const c: any = (window as any).__artClock;
    for (let i = 0; i < frames; i++) { c.t += dt; g.step(c.t, dt); }
  }, { frames, dt: FRAME_MS });
}

async function cameraInfo(page: Page) {
  return page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const cam = gs?.cameras?.main;
    return cam ? { zoom: +cam.zoom.toFixed(4), scrollX: Math.round(cam.scrollX), scrollY: Math.round(cam.scrollY) } : undefined;
  });
}

async function snap(page: Page, shot: Omit<Shot, 'file'>): Promise<void> {
  const file = `${shot.id}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  shots.push({ ...shot, file });
}

/** Start a fresh deterministic GameScene run (loop awake while scenes switch). */
async function startRun(page: Page, seed: number): Promise<void> {
  await wake(page);
  await page.evaluate((seed) => {
    const g: any = (window as any).__game;
    for (const s of g.scene.getScenes(true)) g.scene.stop(s.sys.settings.key);
    g.scene.start('GameScene', { seed });
  }, seed);
  await page.waitForFunction(() => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    return !!(gs && gs.world && gs.world.player && g.scene.isActive('GameScene'));
  }, { timeout: 15000 });
  await freeze(page);
  await step(page, 2);
}

/** Teleport into a room (real spawn path), make the player invulnerable, snap the camera. */
async function enterRoom(page: Page, roomId: number, opts: { fire?: boolean; weapon?: string; aimAtEnemy?: boolean } = {}) {
  return page.evaluate(({ roomId, opts }) => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const w = gs.world, pl = w.player, cam = gs.cameras.main;
    const room = w.map.rooms[roomId];
    const spot = w.findWalkableInRoom(room);
    // Stand 30% toward the room's near corner so enemies + portal share the frame.
    const sx = Math.round(spot.x - room.w * 0.18), sy = Math.round(spot.y + room.h * 0.18);
    const target = w.isWalkable(sx, sy, 0.5) ? { x: sx, y: sy } : spot;
    pl.reset(target.x, target.y);
    pl.invuln = 1e9;
    w.currentRoomId = -1;
    w.updateRoom();
    if (opts.weapon && opts.weapon !== 'pulse') {
      if (!pl.data.weapons.some((x: any) => x.key === opts.weapon)) {
        const mag = opts.weapon === 'scatter' ? 8 : -1;
        pl.data.weapons.push({ key: opts.weapon, level: 1, ammo: mag, magazine: mag, reloading: false, reloadTimer: 0 });
      }
      pl.equipWeapon(opts.weapon);
    }
    gs.fireHeld = !!opts.fire;
    w.shakeAmount = 0;
    const isBoss = room.kind === 'boss';
    cam.zoom = isBoss ? 1.25 : 0.8;
    const s = cam.getScroll(pl.sprite.x, pl.sprite.y);
    cam.setScroll(s.x, s.y);
    // Screen point of nearest hostile, used for the mouse aim.
    let aim: { x: number; y: number } | null = null;
    const foes = [...w.enemies, ...(w.boss ? [w.boss] : [])];
    if (foes.length) {
      foes.sort((a: any, b: any) => Math.hypot(a.x - pl.x, a.y - pl.y) - Math.hypot(b.x - pl.x, b.y - pl.y));
      const f = foes[0];
      const wp = w.worldToScreen(f.x, f.y);
      aim = { x: (wp.x - cam.worldView.x) * cam.zoom, y: (wp.y - cam.worldView.y) * cam.zoom };
    }
    return { kind: room.kind, enemies: w.enemies.length, boss: !!w.boss, aim };
  }, { roomId, opts });
}

test.describe.configure({ mode: 'serial' });

test('AR-00 visual baseline capture', async ({ page, browserName }) => {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(PERF_OUT, { recursive: true });
  await seedRandom(page);
  await bootToMenu(page);

  // 01 — main menu (fresh profile, default OPERATOR appearance)
  await freeze(page);
  await step(page, 30);
  await snap(page, { id: '01-main-menu', scene: 'MainMenuScene', description: 'Fresh profile main menu, OPERATOR avatar', steps: 30 });

  // Choose the first seed whose map contains every room kind.
  await wake(page);
  const seedInfo = await page.evaluate((required) => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    for (let seed = 1; seed <= 64; seed++) {
      const map = gs.buildMap(seed);
      const kinds = new Set(map.rooms.map((r: any) => r.kind));
      if (required.every((k: string) => kinds.has(k))) return { seed, rooms: map.rooms.map((r: any) => ({ id: r.id, kind: r.kind, w: r.w, h: r.h })), complete: true };
    }
    const map = gs.buildMap(1);
    return { seed: 1, rooms: map.rooms.map((r: any) => ({ id: r.id, kind: r.kind, w: r.w, h: r.h })), complete: false };
  }, REQUIRED_KINDS);
  const SEED = seedInfo.seed;
  const firstOf = (kind: string) => seedInfo.rooms.find((r: any) => r.kind === kind)?.id as number | undefined;
  // No seed in 1..64 contains every kind (shop/event are rare rolls). For each kind
  // missing from the main seed, record the first seed (1..400) that has it.
  const fallbackSeeds: Record<string, { seed: number; roomId: number }> = await page.evaluate(({ required, have }) => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const out: Record<string, { seed: number; roomId: number }> = {};
    for (const kind of required) {
      if (have.includes(kind)) continue;
      for (let seed = 1; seed <= 400; seed++) {
        const room = gs.buildMap(seed).rooms.find((r: any) => r.kind === kind);
        if (room) { out[kind] = { seed, roomId: room.id }; break; }
      }
    }
    return out;
  }, { required: REQUIRED_KINDS, have: seedInfo.rooms.map((r: any) => r.kind) });
  const roomFor = (kind: string): { seed: number; roomId: number } | undefined => {
    const id = firstOf(kind);
    if (id !== undefined) return { seed: SEED, roomId: id };
    return fallbackSeeds[kind];
  };

  // 02 — exploration, start room, idle
  await startRun(page, SEED);
  await step(page, 60);
  await snap(page, { id: '02-explore-start', scene: 'GameScene', description: 'Start room on spawn, no hostiles, portal visible', seed: SEED, roomKind: 'start', steps: 62, camera: await cameraInfo(page) });

  // 03..07 — every non-boss room kind
  const roomShots: Array<[string, string, string, boolean]> = [
    ['03-room-combat', 'combat', 'Combat room right after entry, pulse rifle firing at nearest hostile', true],
    ['04-room-resource', 'resource', 'Resource room: loot + decor props', false],
    ['05-room-shop', 'shop', 'Shop room: one guard + loot', true],
    ['06-room-event', 'event', 'Event room (currently plays as combat)', true],
    ['07-room-elite', 'elite', 'Elite room: largest regular fight', true]
  ];
  for (const [id, kind, description, fire] of roomShots) {
    const where = roomFor(kind);
    if (!where) { shots.push({ id, file: '', scene: 'GameScene', description: `${description} — SKIPPED: kind not found in seeds 1..400` }); continue; }
    await startRun(page, where.seed);
    const info = await enterRoom(page, where.roomId, { fire });
    if (info.aim) await page.mouse.move(info.aim.x, info.aim.y);
    await step(page, fire ? 48 : 30);
    await snap(page, { id, scene: 'GameScene', description, seed: where.seed, roomId: where.roomId, roomKind: info.kind, steps: fire ? 48 : 30, camera: await cameraInfo(page), weapon: 'pulse', notes: where.seed !== SEED ? 'fallback seed (kind absent from main seed)' : undefined });
  }

  // 08..10 — weapon VFX in the same combat room
  const combatId = firstOf('combat') ?? firstOf('elite')!;
  if (process.env.ART_AR02 === '1') {
    await startRun(page, SEED);
    await enterRoom(page, combatId, { fire: false });
    await page.mouse.move(650, 540);
    await step(page, 32);
    await page.evaluate(() => {
      (window as any).__game.scene.getScene('GameScene').fireHeld = true;
    });
    for (const [id, frames] of [['23-pulse-muzzle', 2], ['24-pulse-flight', 7]] as const) {
      await step(page, frames);
      await snap(page, { id, scene: 'GameScene', description: 'Pulse timing study, live shot after scripted aim', seed: SEED, roomId: combatId, steps: id === '23-pulse-muzzle' ? 34 : 41, camera: await cameraInfo(page), weapon: 'pulse' });
    }

    await startRun(page, SEED);
    await enterRoom(page, combatId);
    await page.evaluate((roomId) => {
      const world = (window as any).__game.scene.getScene('GameScene').world;
      for (const enemy of world.enemies) enemy.sprite.destroy();
      world.enemies.length = 0;
      const room = world.map.rooms[roomId];
      const center = world.findWalkableInRoom(room);
      const depth = world.roomDepth.of(roomId);
      const actorSpot = { x: center.x - 2, y: center.y + 3 };
      if (world.isWalkable(actorSpot.x, actorSpot.y, 0.5)) {
        world.player.reset(actorSpot.x, actorSpot.y);
      }
      for (const [kind, offset] of [['drone', -2], ['stalker', 0], ['hunter', 2]] as const) {
        const enemy = world.spawnEnemy(kind, center.x + offset - 1, center.y - offset - 1, roomId, depth);
        enemy.update = () => {};
      }
    }, combatId);
    await step(page, 32);
    await snap(page, { id: '25-enemy-lineup', scene: 'GameScene', description: 'Controlled sprite lineup using actual spawn method: drone, stalker and hunter', seed: SEED, roomId: combatId, steps: 32, camera: await cameraInfo(page), notes: 'Scripted fixture. Natural spawn and balance are unchanged.' });
  }
  for (const [id, weapon, frames] of [['08-weapon-scatter', 'scatter', 30], ['09-weapon-plasma', 'plasma', 40], ['10-weapon-arc', 'arc', 30]] as const) {
    await startRun(page, SEED);
    const info = await enterRoom(page, combatId, { fire: true, weapon });
    if (info.aim) await page.mouse.move(info.aim.x, info.aim.y);
    await step(page, frames);
    await snap(page, { id, scene: 'GameScene', description: `Weapon ${weapon} firing in combat room`, seed: SEED, roomId: combatId, roomKind: info.kind, steps: frames, camera: await cameraInfo(page), weapon });
  }

  // 11 — boss entry (phase 1), 12 — boss barrage (phase 3)
  const bossId = firstOf('boss');
  if (bossId !== undefined) {
    await startRun(page, SEED);
    await enterRoom(page, bossId, { fire: false });
    await step(page, 90);
    await snap(page, { id: '11-boss-phase1', scene: 'GameScene', description: 'Warden boss room, phase 1, 1.5 s after entry', seed: SEED, roomId: bossId, roomKind: 'boss', steps: 90, camera: await cameraInfo(page) });
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const b = gs.world.boss; if (!b) return;
      b._hp = Math.round(b.maxHp() * 0.3); b.phase = 3; b.attackTimer = 0;
    });
    await step(page, 75);
    await snap(page, { id: '12-boss-phase3-barrage', scene: 'GameScene', description: 'Warden forced to phase 3 (30% HP), laser fan + shockwave rings', seed: SEED, roomId: bossId, roomKind: 'boss', steps: 75, camera: await cameraInfo(page) });
  }

  // 13 — level-up overlay over a live combat room
  await startRun(page, SEED);
  await enterRoom(page, combatId, { fire: false });
  await step(page, 20);
  await page.evaluate(() => { (window as any).__game.scene.getScene('GameScene').onLevelUp(2); });
  await step(page, 30);
  await snap(page, { id: '13-level-up', scene: 'LevelUpScene', description: 'Level-up 3-card choice over combat room', seed: SEED, roomId: combatId, steps: 50 });

  // 14 — pause, 15 — inventory
  await startRun(page, SEED);
  await enterRoom(page, combatId, { fire: false });
  await step(page, 20);
  await page.evaluate(() => { (window as any).__game.scene.getScene('GameScene').onPause(); });
  await step(page, 30);
  await snap(page, { id: '14-pause', scene: 'PauseScene', description: 'Pause overlay (mode pause)', seed: SEED, steps: 50 });
  await startRun(page, SEED);
  await enterRoom(page, combatId, { fire: false });
  await step(page, 20);
  await page.evaluate(() => { (window as any).__game.scene.getScene('GameScene').toggleInventory(); });
  await step(page, 30);
  await snap(page, { id: '15-inventory', scene: 'PauseScene', description: 'Inventory overlay (mode inventory)', seed: SEED, steps: 50 });

  // 16 — death recap, 17 — victory recap
  const stats = { kills: 23, items: 9, damage: 4210, elapsedSeconds: 312 };
  for (const [id, won] of [['16-game-over', false], ['17-victory', true]] as const) {
    await wake(page);
    await page.evaluate(({ seed, stats, won }) => {
      const g: any = (window as any).__game;
      for (const s of g.scene.getScenes(true)) g.scene.stop(s.sys.settings.key);
      g.scene.start('GameOverScene', { seed, stats, won, coreAwarded: won });
    }, { seed: SEED, stats, won });
    await page.waitForFunction(() => (window as any).__game.scene.isActive('GameOverScene'));
    await freeze(page);
    await step(page, 20);
    await snap(page, { id, scene: 'GameOverScene', description: won ? 'Victory recap (+1 core)' : 'Death recap', seed: SEED, steps: 20 });
  }

  // 18 — community avatar in the same combat room (scale/style cohesion check)
  await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const save = JSON.parse(raw);
    save.settings = { ...(save.settings ?? {}), avatar: 'whale' };
    localStorage.setItem(key, JSON.stringify(save));
  }, MAIN_KEY);
  await startRun(page, SEED);
  const whaleInfo = await enterRoom(page, combatId, { fire: true });
  if (whaleInfo.aim) await page.mouse.move(whaleInfo.aim.x, whaleInfo.aim.y);
  await step(page, 40);
  await snap(page, { id: '18-avatar-whale-combat', scene: 'GameScene', description: 'Whale-chan community sprite in the combat room', seed: SEED, roomId: combatId, steps: 40, avatar: 'whale', camera: await cameraInfo(page) });
  await page.evaluate((key) => {
    const raw = localStorage.getItem(key); if (!raw) return;
    const save = JSON.parse(raw); save.settings.avatar = 'operator'; localStorage.setItem(key, JSON.stringify(save));
  }, MAIN_KEY);

  // ---------- Performance baseline (real RAF loop, same scenario) ----------
  const perf: Record<string, unknown> = {};
  for (const [name, kind] of [['combat-room-sustained-fire', 'combat'], ['elite-room-sustained-fire', 'elite'], ['boss-phase3-barrage', 'boss']] as const) {
    const roomId = firstOf(kind);
    if (roomId === undefined) continue;
    await startRun(page, SEED);
    const info = await enterRoom(page, roomId, { fire: kind !== 'boss' });
    if (info.aim) await page.mouse.move(info.aim.x, info.aim.y);
    await page.evaluate((kind) => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const w = gs.world;
      // Immortal targets keep the load constant for the whole window.
      for (const e of w.enemies) { e._hp = 1e9; e.data.stats.maxHp = 1e9; }
      if (kind === 'boss' && w.boss) { w.boss._hp = Math.round(w.boss.maxHp() * 0.3); w.boss.phase = 3; w.boss.hit = () => false; }
    }, kind);
    await wake(page);
    const result = await page.evaluate(async (durationMs) => {
      const g: any = (window as any).__game;
      const mem = (performance as any).memory;
      const heap0 = mem ? mem.usedJSHeapSize : null;
      const deltas: number[] = [];
      const fpsSamples: number[] = [];
      // RAF deltas are vsync-capped (16.7 ms) and hide headroom, so also time the
      // CPU cost of each Phaser game.step (update + Canvas render) directly.
      const stepCost: number[] = [];
      // TimeStep invokes a bound copy of game.step stored on loop.callback.
      const origStep = g.loop.callback;
      g.loop.callback = function (time: number, delta: number) {
        const s = performance.now();
        origStep(time, delta);
        stepCost.push(performance.now() - s);
      };
      let objects = 0;
      await new Promise<void>((resolve) => {
        let last = performance.now();
        const t0 = last;
        const tick = (now: number) => {
          deltas.push(now - last); last = now;
          if (deltas.length % 30 === 0) fpsSamples.push(g.loop.actualFps);
          if (now - t0 < durationMs) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
      g.loop.callback = origStep;
      const gs: any = g.scene.getScene('GameScene');
      objects = gs.children.list.length;
      const heap1 = mem ? mem.usedJSHeapSize : null;
      const cost = [...stepCost.slice(5)].sort((a, b) => a - b);
      const cpct = (p: number) => cost.length ? +cost[Math.min(cost.length - 1, Math.floor(cost.length * p))].toFixed(2) : null;
      const cmean = cost.length ? +(cost.reduce((s, v) => s + v, 0) / cost.length).toFixed(2) : null;
      const sorted = [...deltas.slice(5)].sort((a, b) => a - b);
      const pct = (p: number) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2);
      const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
      return {
        frames: sorted.length,
        meanFrameMs: +mean.toFixed(2), fpsFromMean: +(1000 / mean).toFixed(1),
        p50FrameMs: pct(0.5), p95FrameMs: pct(0.95), p99FrameMs: pct(0.99), maxFrameMs: +sorted[sorted.length - 1].toFixed(2),
        framesOver20ms: sorted.filter((d) => d > 20).length,
        stepCpuMeanMs: cmean, stepCpuP50Ms: cpct(0.5), stepCpuP95Ms: cpct(0.95), stepCpuP99Ms: cpct(0.99), stepCpuMaxMs: cost.length ? +cost[cost.length - 1].toFixed(2) : null,
        phaserActualFpsAvg: +(fpsSamples.reduce((s, v) => s + v, 0) / Math.max(1, fpsSamples.length)).toFixed(1),
        usedJSHeapMB_start: heap0 === null ? null : +(heap0 / 1048576).toFixed(1),
        usedJSHeapMB_end: heap1 === null ? null : +(heap1 / 1048576).toFixed(1),
        displayListObjectsAtEnd: objects,
        enemies: gs.world.enemies.length, projectilesAtEnd: gs.world.projectiles.length
      };
    }, 10000);
    perf[name] = { seed: SEED, roomId, roomKind: kind, durationMs: 10000, ...result };
  }

  const env = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    phaser: (window as any).Phaser?.VERSION ?? (window as any).__game?.config?.gameVersion ?? null,
    renderer: (window as any).__game.config.renderType === 1 ? 'CANVAS' : 'WEBGL/AUTO',
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency
  }));

  const manifest = {
    phase: PHASE,
    capturedAt: new Date().toISOString(),
    browser: browserName,
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    visualRandomSeed: VISUAL_SEED,
    mapSeed: SEED,
    mapSeedHasAllKinds: seedInfo.complete,
    fallbackSeeds,
    rooms: seedInfo.rooms,
    clock: 'RAF loop slept; game.step(t, 1000/60) per frame',
    settings: 'fresh localStorage profile; defaults (screenShake on, master 0.7, sfx 0.8)',
    environment: env,
    shots,
    consoleErrors
  };
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(PERF_OUT, `perf-${PHASE}.json`), JSON.stringify({ phase: PHASE, environment: env, mapSeed: SEED, visualRandomSeed: VISUAL_SEED, scenarios: perf }, null, 2));
  expect(shots.filter((s) => s.file).length).toBeGreaterThanOrEqual(10);
});

test('AR-00 Station Zero (Signal prototype) capture', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await seedRandom(page);
  page.on('pageerror', (e) => consoleErrors.push(`station-zero: ${e.message}`));
  await page.goto('/station-zero.html');
  await expect(page.locator('body')).toHaveAttribute('data-vs00-ready', '1');
  await page.waitForTimeout(500);
  const extra: Shot[] = [];
  const shoot = async (id: string, description: string) => {
    await page.screenshot({ path: path.join(OUT, `${id}.png`) });
    extra.push({ id, file: `${id}.png`, scene: 'SliceScene', description });
  };
  await shoot('19-signal-lab-idle', 'Station Zero lab, sealed door, unscanned');
  await page.keyboard.press('z');
  if (process.env.ART_AR02 === '1') {
    await page.waitForTimeout(130);
    await shoot('26-signal-scan-sweep', 'Station Zero lab during the Scan pulse');
    await page.waitForTimeout(250);
  } else {
    await page.waitForTimeout(400);
  }
  await shoot('20-signal-lab-scan', 'Lab after Scan (Z): receiver/source/link revealed');
  await page.keyboard.press('x');
  await page.waitForTimeout(400);
  await shoot('21-signal-lab-jam', 'Lab after Jam (X): door JAMMED_OPEN');
  for (const k of ['KeyD', 'KeyS']) await page.keyboard.down(k);
  await expect.poll(async () => page.locator('body').getAttribute('data-slice-room'), { timeout: 8000, intervals: [16] }).toBe('corridor');
  for (const k of ['KeyD', 'KeyS']) await page.keyboard.up(k);
  await page.waitForTimeout(300);
  await page.keyboard.press('z');
  await page.waitForTimeout(400);
  await shoot('22-signal-corridor-scan', 'Unstable corridor after Scan: relay -> bridge / guard perception links');
  expect(consoleErrors).toEqual([]);
  writeFileSync(path.join(OUT, 'manifest-station-zero.json'), JSON.stringify({ phase: PHASE, clock: 'real time (fixed 60 Hz rules tick)', visualRandomSeed: VISUAL_SEED, shots: extra }, null, 2));
});
