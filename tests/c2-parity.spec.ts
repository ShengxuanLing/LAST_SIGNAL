// AI-NATIVE-02 C2 — controlled fixed-tick / Node-Rendered parity evidence.
//
// Dev-server only (imports /src/world/sim/core.ts). No direct Scene state
// writes: controlled intents go through the normal World.stepFrame accumulator
// path; the test-only core facade is not used as official parity evidence.

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 5173);
const SEED = 424242;
const OUT = path.resolve('reports/ai-native-02/c2/parity');
const NEUTRAL = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

async function bootRun(page: Page): Promise<void> {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => !!(window as any).__game, { timeout: 15000 });
  await page.waitForTimeout(1300);
  await page.evaluate((seed) => {
    const g: any = (window as any).__game;
    const menu: any = g.scene.getScene('MainMenuScene');
    const orig = menu.scene.start.bind(menu.scene);
    menu.scene.start = (key: string, data?: any) => {
      if (key === 'GameScene') return orig(key, { seed });
      return orig(key, data);
    };
  }, SEED);
  await page.mouse.click(640, 340);
  await page.waitForTimeout(1500);
}

async function gameScene(page: Page) {
  return page.evaluate(() => {
    const g: any = (window as any).__game;
    return g.scene.getScene('GameScene') as any;
  });
}

test.describe('AI-NATIVE-02 C2 fixed-tick core', () => {
  test('subframe, 15-tick cap, pause freeze and no catch-up', async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await bootRun(page);
    // Real ESC opens PauseScene so the RAF loop stops stepping the core.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);

    const tick = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      const tickMs = 1000 / 60;
      w.resetSimulationAccumulator();
      const t0 = w.sim.tick;
      w.stepFrame(5, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
      const t1 = w.sim.tick;
      w.stepFrame(20, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
      const t2 = w.sim.tick;
      w.resetSimulationAccumulator();
      w.stepFrame(10000, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
      const t3 = w.sim.tick;
      return {
        tickMs, t0, t1, t2, t3,
        accumulatorAfterCap: w.simAccumulatorMs,
        paused: gs.paused,
        accumulatorAfterSubframe: null
      };
    });
    expect(tick.paused, 'PauseScene froze the RAF loop').toBe(true);
    expect(tick.t1, 'sub-frame delta < 1 tick does not advance core').toBe(tick.t0);
    expect(tick.t2, 'one full tick advances exactly one').toBe(tick.t0 + 1);
    expect(tick.t3, '250ms frame is capped at 15 ticks').toBe(tick.t2 + 15);
    expect(tick.accumulatorAfterCap, 'excess delta is dropped, not carried').toBeLessThan(tick.tickMs);

    // Paused frames must not advance the core; resuming must not catch up.
    const frozenStart = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.sim.tick;
    });
    await page.waitForTimeout(900);
    const frozenEnd = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return { tick: gs.world.sim.tick, acc: gs.world.simAccumulatorMs };
    });
    expect(frozenEnd.tick, 'core frozen during pause').toBe(frozenStart);
    expect(frozenEnd.acc, 'accumulator reset on pause').toBe(0);

    await page.keyboard.press('Escape'); // PauseScene closes -> GameScene.onResume()
    await page.waitForTimeout(450);
    const resumed = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return { tick: gs.world.sim.tick, acc: gs.world.simAccumulatorMs, paused: gs.paused };
    });
    expect(resumed.paused, 'game resumed').toBe(false);
    expect(resumed.tick - frozenStart, 'no paused-time catch-up').toBeLessThan(60);
    expect(resumed.acc, 'accumulator bounded after resume').toBeLessThan(20);
    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('controlled intent queue: Rendered canonical state/events for Node parity', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    mkdirSync(OUT, { recursive: true });
    await bootRun(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);

    const result = await page.evaluate(async () => {
      const mod: any = await import('/src/world/sim/core.ts');
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      const p = { x: w.player.wx, y: w.player.wy };
      const room = w.currentRoom();
      let target: any = null;
      for (const d of [2, 1.5, -2, -1.5, 3, -3]) {
        const x = p.x + d, y = p.y;
        if (w.isWalkable(x, y, 0.5)) { target = { x, y }; break; }
      }
      if (!target) target = { x: p.x, y: p.y + 2 };
      w.spawnEnemy('drone', target.x, target.y, room?.id ?? 0, 1);
      const initial = JSON.parse(JSON.stringify(w.sim));
      const drone = initial.drones[0];
      const aim = drone ? { x: drone.x, y: drone.y } : { x: target.x, y: target.y };
      const sequence = [
        { ticks: 20, intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false } },
        { ticks: 1, intent: { move: { x: 0, y: 0 }, dash: false, fire: true, aim, interact: false } },
        { ticks: 30, intent: { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false } },
        { ticks: 12, intent: { move: { x: -1, y: 0 }, dash: false, fire: false, aim: null, interact: false } }
      ];
      const events: any[] = [];
      w.resetSimulationAccumulator();
      for (const step of sequence) {
        for (let i = 0; i < step.ticks; i++) {
          events.push(...w.stepFrame(1000 / 60 + 1e-6, step.intent));
        }
      }
      return {
        initial,
        sequence,
        canonical: mod.canonicalSimulationState(w.sim),
        events: mod.canonicalSimulationEvents(events),
        eventTypes: [...new Set(events.map((e: any) => e.type))],
        finalTick: w.sim.tick,
        dronesLeft: w.sim.drones.length,
        projectilesLeft: w.sim.projectiles.length
      };
    });
    writeFileSync(path.join(OUT, 'parity-initial.json'), JSON.stringify(result.initial, null, 2));
    writeFileSync(path.join(OUT, 'parity-sequence.json'), JSON.stringify(result.sequence, null, 2));
    writeFileSync(path.join(OUT, 'parity-rendered.json'), JSON.stringify({
      canonical: result.canonical,
      events: result.events,
      eventTypes: result.eventTypes,
      finalTick: result.finalTick,
      dronesLeft: result.dronesLeft,
      projectilesLeft: result.projectilesLeft
    }, null, 2));
    expect(result.finalTick, 'controlled ticks advanced the core').toBe(result.initial.tick + 63);
    expect(result.eventTypes, 'real combat events emitted').toContain('player-fired');
    expect(result.eventTypes, 'drone FSM ran').toContain('drone-step');
    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
  test('F-08: restoreCheckpoint uses a deep copy of the incoming frame', async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await bootRun(page);
    const checked = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      const frame = w.captureCheckpoint('f08-test', gs.seed, gs.runStats());
      if (!frame) return { available: false };
      if (!w.restoreCheckpoint(frame)) return { available: false, restored: false };
      const hp = w.player.data.hp;
      const x = w.player.wx;
      // Mutate the *incoming* frame after restore; live state must not alias it.
      frame.player.hp = 1;
      frame.position.x = x + 100;
      return {
        available: true, restored: true,
        hp, x, hpAfterMutation: w.player.data.hp, xAfterMutation: w.player.wx
      };
    });
    expect(checked.available, 'a valid start-room checkpoint frame exists').toBe(true);
    expect(checked.restored, 'checkpoint restored').toBe(true);
    expect(checked.hpAfterMutation, 'live HP is not aliased to the input frame').toBe(checked.hp);
    expect(checked.xAfterMutation, 'live position is not aliased to the input frame').toBe(checked.x);
    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('B1-B4: normal stepFrame damages all enemy kinds/Boss; laser/setter/player-hit authority', async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await bootRun(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
    const result = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      const p = w.player;
      const room = w.currentRoom();
      const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
      const fireAt = (target: any) => ({ move: { x: 0, y: 0 }, dash: false, fire: true, aim: target, interact: false });
      let spot: any = null;
      for (const d of [3, -3, 2, -2]) {
        const x = p.wx + d, y = p.wy;
        if (w.isWalkable(x, y, 0.5)) { spot = { x, y }; break; }
      }
      if (!spot) spot = { x: p.wx, y: p.wy + 3 };

      const hunter = w.spawnEnemy('hunter', spot.x, spot.y, room.id, 1);
      const stalker = w.spawnEnemy('stalker', spot.x, spot.y, room.id, 1);
      const sentinel = w.spawnEnemy('sentinel', spot.x, spot.y, room.id, 1);
      // Reduce HP only to verify the shared damage/death transaction in a short test.
      hunter._hp = 20; stalker._hp = 20; sentinel._hp = 20;
      const h0 = [hunter._hp, stalker._hp, sentinel._hp];
      w.resetSimulationAccumulator();
      for (let i = 0; i < 150; i++) w.stepFrame(1000 / 60 + 1e-6, fireAt(spot));
      const h1 = [hunter._hp, stalker._hp, sentinel._hp];
      const removed = [hunter, stalker, sentinel].map((e) => !w.enemies.some((x: any) => x._id === e._id));

      w.spawnBoss(w.map.rooms[room.id]);
      const boss = w.boss;
      boss.wx = spot.x; boss.wy = spot.y; boss.attackTimer = 999999;
      boss._hp = 24;
      w.resetSimulationAccumulator();
      for (let i = 0; i < 60; i++) w.stepFrame(1000 / 60 + 1e-6, fireAt({ x: boss.x, y: boss.y }));
      const bossDead = !w.boss;

      // B2: a live core player bullet must not be rewritten by Boss.fireLaser.
      if (!w.boss) {
        w.spawnBoss(w.map.rooms[room.id]);
        w.boss.attackTimer = 999999;
      }
      w.resetSimulationAccumulator();
      w.stepFrame(1000 / 60 + 1e-6, fireAt({ x: p.wx + 5, y: p.wy }));
      const playerBullet = w.sim.projectiles.find((x: any) => x.source === 'player');
      const beforeVel = playerBullet ? { ...playerBullet.vel } : null;
      const enemyBefore = w.sim.projectiles.filter((x: any) => x.side === 'enemy').length;
      if (w.boss) w.boss.fireLaser(p);
      const afterVel = playerBullet ? { ...playerBullet.vel } : null;
      const enemyAfter = w.sim.projectiles.filter((x: any) => x.side === 'enemy').length;
      const laserOk = enemyAfter > enemyBefore && w.sim.projectiles.filter((x: any) => x.side === 'enemy').every((x: any) => Math.hypot(x.vel.x, x.vel.y) > 0);

      // B3: compatibility getter is a copy; setter must not clear core.
      const coreCount = w.sim.projectiles.length;
      const view = w.projectiles;
      const viewIsCore = view.some((v: any) => w.sim.projectiles.includes(v.data));
      w.projectiles = [];
      const coreAfterSetter = w.sim.projectiles.length;

      // B4: legacy Player.hurt queues; core commits/event on next tick.
      p.data.hp = 100; p.invuln = 0;
      const hpBefore = w.sim.player.data.hp;
      const queued = p.hurt(10, p.x + 1, p.y);
      const hpAfterCall = w.sim.player.data.hp;
      const events = w.stepFrame(1000 / 60 + 1e-6, neutral);
      return {
        enemyBefore: h0, enemyAfter: h1, removed,
        bossDead,
        beforeVel, afterVel, laserOk,
        playerBulletId: playerBullet?.id ?? null,
        coreCount, viewIsCore, coreAfterSetter,
        hpBefore, hpAfterCall, hpAfterTick: w.sim.player.data.hp, queued,
        eventTypes: events.map((e: any) => e.type)
      };
    });
    expect(result.enemyAfter[0], 'hunter damaged/dead').toBeLessThan(result.enemyBefore[0]);
    expect(result.enemyAfter[1], 'stalker damaged/dead').toBeLessThan(result.enemyBefore[1]);
    expect(result.enemyAfter[2], 'sentinel damaged/dead').toBeLessThan(result.enemyBefore[2]);
    expect(result.removed.every(Boolean), 'all three legacy kinds removed after death').toBe(true);
    expect(result.bossDead, 'Boss can die through core projectile collision').toBe(true);
    expect(result.beforeVel, 'player bullet exists before Boss laser').not.toBeNull();
    expect(result.afterVel, 'player bullet velocity unchanged by Boss laser').toEqual(result.beforeVel);
    expect(result.laserOk, 'Boss laser creates its own moving projectiles').toBe(true);
    expect(result.viewIsCore, 'compatibility view must not expose mutable core objects').toBe(false);
    expect(result.coreAfterSetter, 'compatibility setter must not clear core projectiles').toBe(result.coreCount);
    expect(result.hpAfterCall, 'Player.hurt does not write core outside tick').toBe(result.hpBefore);
    expect(result.queued).toBe(true);
    expect(result.hpAfterTick, 'queued player hit commits in next core tick').toBeLessThan(result.hpBefore);
    expect(result.eventTypes, 'legacy hit produces core player-hurt event').toContain('player-hurt');
    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });


  test('H3: checkpoint capture/restore preserves core tick/rng/nextProjectileId', async ({ page }) => {
    test.setTimeout(90000);
    await bootRun(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
    const result = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      for (const rm of w.map.rooms) { if (rm.kind !== 'boss') { rm.spawned = true; rm.cleared = true; } }
      w.enemies = []; w.boss = null; w.won = false;
      const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
      w.resetSimulationAccumulator();
      for (let i = 0; i < 40; i++) w.stepFrame(1000 / 60 + 1e-6, neutral);
      const frame = w.captureCheckpoint('h3-test', w.map.seed, { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 });
      const before = { tick: w.sim.tick, rng: w.sim.rngState, pid: w.sim.nextProjectileId };
      w.sim.tick = 9999; w.sim.rngState = 1; w.sim.nextProjectileId = 1;
      const ok = w.restoreCheckpoint(frame as any);
      return { ok, coreCaptured: !!(frame as any)?.coreState, before, after: { tick: w.sim.tick, rng: w.sim.rngState, pid: w.sim.nextProjectileId } };
    });
    expect(result.ok, 'checkpoint restored').toBe(true);
    expect(result.coreCaptured, 'checkpoint captures coreState').toBe(true);
    expect(result.after.tick, 'core tick restored').toBe(result.before.tick);
    expect(result.after.rng, 'core rngState restored').toBe(result.before.rng);
    expect(result.after.pid, 'core nextProjectileId restored').toBe(result.before.pid);
  });
});
