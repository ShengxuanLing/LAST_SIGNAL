// AI-NATIVE-02 C3c fix — Rendered canonical export for Rendered<->Headless parity.
//
// The rendered World (real Phaser adapter over the SAME core) runs an ADAPTIVE
// controlled sequence that (a) kills a real drone and (b) moves over the drop
// and collects the loot. The exact per-tick intents actually used are recorded,
// so the Node headless replay is deterministic. This is a REAL kill + loot
// pickup, not an empty scene and not a synthetic damage fixture.

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

test('Rendered canonical/events export (real kill + loot) for headless parity', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  mkdirSync(OUT, { recursive: true });
  await bootRun(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const result = await page.evaluate(async () => {
    const mod: any = await import('/src/world/sim/core.ts');
    const rules: any = await import('/src/world/sim/rules.ts');
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const w = gs.world;
    const p = { x: w.player.wx, y: w.player.wy };
    const room = w.currentRoom();
    // A REAL drone spawned through the World's own path near the player.
    let target: any = null;
    for (const d of [3, -3, 2.5, -2.5, 4, -4]) {
      const x = p.x + d, y = p.y;
      if (w.isWalkable(x, y, 0.5)) { target = { x, y }; break; }
    }
    if (!target) target = { x: p.x + 2, y: p.y };
    const drone = w.spawnEnemy('drone', target.x, target.y, room?.id ?? 0, 1);
    const initial = JSON.parse(JSON.stringify(w.sim));
    const sequence: Array<{ ticks: number; intent: any }> = [];
    const events: any[] = [];
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    w.resetSimulationAccumulator();
    const runStep = (intent: any): void => {
      sequence.push({ ticks: 1, intent });
      events.push(...w.stepFrame(1000 / 60 + 1e-6, intent));
    };
    // 1) Kill the real drone: aim at its CURRENT position each shot window.
    let sawDeath = false;
    for (let i = 0; i < 1200 && !sawDeath; i += 1) {
      const live = w.sim.drones.find((d: any) => d.hp > 0);
      if (!live) { sawDeath = true; break; }
      runStep({ ...neutral, fire: true, aim: { x: live.x, y: live.y } });
      for (let k = 0; k < 2; k += 1) {
        if (w.sim.drones.some((d: any) => d.hp <= 0)) { sawDeath = true; break; }
        runStep(neutral);
      }
    }
    // 2) Move to the loot drop and collect it.
    let lootSeen = false;
    let collected = false;
    for (let i = 0; i < 600 && !collected; i += 1) {
      const loot = w.sim.loot[0];
      if (!loot) { collected = events.some((e: any) => e.type === 'loot-collected'); break; }
      lootSeen = true;
      const dx = loot.x - w.player.wx;
      const dy = loot.y - w.player.wy;
      if (Math.hypot(dx, dy) < 0.4) { runStep(neutral); continue; }
      const dir = rules.gridDirectionToScreenDirection(dx, dy);
      runStep({ ...neutral, move: dir });
    }
    const state = w.sim;
    return {
      initial,
      sequence,
      canonical: mod.canonicalSimulationState(state),
      events: mod.canonicalSimulationEvents(events),
      eventTypes: [...new Set(events.map((e: any) => e.type))],
      finalTick: state.tick,
      dronesLeft: state.drones.length,
      projectilesLeft: state.projectiles.length,
      lootLeft: state.loot.length,
      lootSeen,
      currency: state.player.data.currency,
      xp: state.player.data.xp,
      level: state.player.data.level,
      playerHp: state.player.data.hp
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
    projectilesLeft: result.projectilesLeft,
    lootLeft: result.lootLeft,
    currency: result.currency,
    xp: result.xp,
    level: result.level,
    playerHp: result.playerHp
  }, null, 2));

  expect(result.eventTypes, 'real kill event').toContain('enemy-died');
  expect(result.eventTypes, 'real loot drop').toContain('loot-dropped');
  expect(result.eventTypes, 'real loot pickup').toContain('loot-collected');
  expect(result.lootLeft, 'loot fully collected').toBe(0);
  expect(result.dronesLeft, 'the drone is really dead').toBe(0);
  expect(result.currency + result.xp, 'pickup granted real resources').toBeGreaterThan(0);
  expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
