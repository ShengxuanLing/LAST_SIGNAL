// AI-NATIVE-02 C3-c — Rendered canonical export for Rendered<->Headless parity.
//
// Mirrors the C2 parity approach: the rendered World (real Phaser adapter over
// the SAME core) runs a controlled intent sequence one fixed tick at a time and
// writes the initial `SimulationState`, the sequence, and the canonical
// state/events. A Node script then replays the SAME sequence with the headless
// same-core runtime and compares.
//
// This is a REAL combat encounter (player + real drone), not an empty scene.

import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('reports/ai-native-02/c3c/parity');

async function bootRun(page: any): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  await page.evaluate(() => localStorage.removeItem('lastSignal.save.v1'));
  const newRun = await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const t = s.children.list.find((c: any) => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  });
  expect(newRun).not.toBeNull();
  await page.mouse.click(newRun!.x, newRun!.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
}

test('Rendered canonical/events export for headless same-core parity', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  mkdirSync(OUT, { recursive: true });
  await bootRun(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const result = await page.evaluate(async () => {
    const mod: any = await import('/src/world/sim/core.ts');
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const w = gs.world;
    const p = { x: w.player.wx, y: w.player.wy };
    const room = w.currentRoom();
    // A REAL drone spawned through the World's own path.
    let target: any = null;
    for (const d of [3, -3, 2.5, -2.5, 4, -4]) {
      const x = p.x + d, y = p.y;
      if (w.isWalkable(x, y, 0.5)) { target = { x, y }; break; }
    }
    if (!target) target = { x: p.x + 2, y: p.y };
    w.spawnEnemy('drone', target.x, target.y, room?.id ?? 0, 1);
    const initial = JSON.parse(JSON.stringify(w.sim));
    const drone = initial.drones[0];
    const aim = drone ? { x: drone.x, y: drone.y } : target;
    const sequence = [
      { ticks: 10, intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false } },
      { ticks: 1, intent: { move: { x: 0, y: 0 }, dash: false, fire: true, aim, interact: false } },
      { ticks: 2, intent: { move: { x: 0, y: 0 }, dash: false, fire: true, aim, interact: false } },
      { ticks: 40, intent: { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false } },
      { ticks: 8, intent: { move: { x: -1, y: 0 }, dash: false, fire: false, aim: null, interact: false } }
    ];
    const events: any[] = [];
    w.resetSimulationAccumulator();
    for (const step of sequence) {
      for (let i = 0; i < step.ticks; i += 1) {
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

  writeFileSync(path.join(OUT, 'initial.json'), JSON.stringify(result.initial, null, 2));
  writeFileSync(path.join(OUT, 'sequence.json'), JSON.stringify(result.sequence, null, 2));
  writeFileSync(path.join(OUT, 'rendered.json'), JSON.stringify({
    canonical: result.canonical,
    events: result.events,
    eventTypes: result.eventTypes,
    finalTick: result.finalTick,
    dronesLeft: result.dronesLeft,
    projectilesLeft: result.projectilesLeft
  }, null, 2));

  expect(result.initial.drones.length, 'a real drone is in the initial snapshot').toBeGreaterThan(0);
  expect(result.eventTypes, 'real combat events emitted').toContain('player-fired');
  expect(result.eventTypes, 'drone FSM ran').toContain('drone-step');
  expect(result.finalTick, 'controlled ticks advanced').toBeGreaterThan(result.initial.tick);
  expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
