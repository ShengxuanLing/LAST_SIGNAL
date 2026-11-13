// AI-NATIVE-02 C2 — controlled fixed-tick / Node-Rendered parity evidence.
//
// Dev-server only (imports /src/world/sim/core.ts). No direct Scene state
// writes: controlled intents go through World.stepSimulationTicksForTest(),
// which calls the same core as Node and then syncs presentation.

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
        { ticks: 120, intent: { move: { x: 0, y: 0 }, dash: false, fire: true, aim, interact: false } },
        { ticks: 12, intent: { move: { x: -1, y: 0 }, dash: false, fire: false, aim: null, interact: false } }
      ];
      const events: any[] = [];
      for (const step of sequence) {
        events.push(...w.stepSimulationTicksForTest(step.ticks, step.intent));
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
    expect(result.finalTick, 'controlled ticks advanced the core').toBe(result.initial.tick + 152);
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

});
