// P3-a fix — Rendered <-> Headless echo parity export (real core, real actors).
//
// Fixture disclosure: the spec places the two actors and spawns a real drone
// and a real non-drone hunter along a walkable row using owner/dev facades, and
// scripts BOTH actor intents. All damage/death/loot/echo-hurt events come from
// the real fixed-tick core; nothing is faked. The exact ordered intents are
// exported for the Node replay in scripts/p3a-echo-rendered-parity.mts.
//
// SCOPE: the hunter is a static core-owned target (legacy FSM idle), so the
// strict byte comparison covers only core-managed state. Legacy FSM/AI
// decisions are out of this parity scope and are tested in the rendered E2E
// tests/p3a-enemy-target.spec.ts; no recorded legacy command is replayed.

import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('reports/ai-native-02/p3a/parity');

async function bootRun(page: any): Promise<void> {
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
  expect(newRun).not.toBeNull();
  await page.mouse.click(newRun!.x, newRun!.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
}

test('Rendered echo canonical/events export for Headless byte parity', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  mkdirSync(OUT, { recursive: true });
  await bootRun(page);

  const result = await page.evaluate(async () => {
    const mod: any = await import('/src/world/sim/core.ts');
    const rules: any = await import('/src/world/sim/rules.ts');
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    const dt = 1000 / 60 + 1e-6;
    w.clearEnemiesForTest();
    w.enableEcho();
    w.stepFrame(dt, neutral, neutral); // commit spawn-echo

    // Find a walkable 9-tile row inside the current room.
    const room = w.currentRoom();
    let row: number | null = null;
    let col = 0;
    for (const r of w.map.tiles) {
      for (const tile of r) {
        if (room && (tile.x < room.gx || tile.x >= room.gx + room.w || tile.y < room.gy || tile.y >= room.gy + room.h)) continue;
        let ok = true;
        for (let k = 0; k < 9; k += 1) if (!w.isWalkable(tile.x + k, tile.y, 0.5)) { ok = false; break; }
        if (ok) { row = tile.y; col = tile.x; break; }
      }
      if (row !== null) break;
    }
    if (row === null) return { error: 'no walkable row' };
    w.setPlayerPositionForTest(col, row);
    w.simFixture.player.x = col;
    w.simFixture.player.y = row;
    const echo = w.simFixture.echo!;
    echo.x = col + 5;
    echo.y = row;
    const drone = w.spawnEnemy('drone', col + 6, row, room?.id ?? 0, 1);
    const hunter = w.spawnEnemy('hunter', col + 2, row, room?.id ?? 0, 1);
    hunter.data.state = 'idle';
    hunter.data.stateTimer = 1e9;
    hunter.wanderTimer = 1e9;
    // Explicit, recorded fixture: a real core `spawn-loot` command guarantees a
    // deterministic loot event (kill loot is RNG-gated in the frozen C1 rules).
    // It is part of the captured initial frame, so Node replays the same drop.
    w.enqueueSpawnLoot(col + 3, row, 'currency', 'currency', 4);
    // Isolate from unrelated room spawns: no pending world spawns remain.
    const initial = JSON.parse(JSON.stringify(w.sim));
    const sequence: Array<{ ticks: number; intent: any; echoIntent: any }> = [];
    const events: any[] = [];
    w.resetSimulationAccumulator();
    const runStep = (intent: any, echoIntent: any): void => {
      sequence.push({ ticks: 1, intent, echoIntent });
      events.push(...w.stepFrame(dt, intent, echoIntent));
    };
    const aimAt = (x: number, y: number) => ({ ...neutral, fire: true, aim: { x, y } });

    // 1) Echo + player kill the real non-drone hunter.
    let killed = false;
    for (let i = 0; i < 400 && !killed; i += 1) {
      const live = w.sim.targets.find((t: any) => t.id === hunter._id && t.hp > 0);
      if (!live) { killed = true; break; }
      runStep(aimAt(live.x, live.y), aimAt(live.x, live.y));
    }
    // 2) Let the real drone engage the echo (echo-hurt) and settle projectiles.
    for (let i = 0; i < 180; i += 1) runStep(neutral, neutral);
    // 3) Player walks to the real loot and collects it.
    let collected = false;
    for (let i = 0; i < 600 && !collected; i += 1) {
      const loot = w.sim.loot[0];
      if (!loot) { collected = events.some((e: any) => e.type === 'loot-collected'); break; }
      const dx = loot.x - w.sim.player.x;
      const dy = loot.y - w.sim.player.y;
      if (Math.hypot(dx, dy) < 0.4) { runStep(neutral, neutral); continue; }
      const dir = rules.gridDirectionToScreenDirection(dx, dy);
      runStep({ ...neutral, move: dir }, neutral);
      runStep({ ...neutral, move: dir }, neutral);
    }
    const state = w.sim;
    return {
      initial, sequence,
      enteredRooms: w.map.rooms.map((_r: any, i: number) => i),
      canonical: mod.canonicalSimulationState(state),
      events: mod.canonicalSimulationEvents(events),
      eventTypes: [...new Set(events.map((e: any) => e.type))],
      finalTick: state.tick,
      echoHp: state.echo?.data?.hp ?? null,
      droneHp: state.drones[0]?.hp ?? 0,
      killed, droneId: drone._id, hunterId: hunter._id,
      echoShotEvents: events.filter((e: any) => e.type === 'echo-fired').length,
      attributedHits: events.filter((e: any) => e.type === 'enemy-hit' && e.byActorId === 1).length
    };
  });

  expect(result.error).toBeUndefined();
  if (result.error) throw new Error(result.error);
  const rendered = result as Exclude<typeof result, { error: string }>;
  writeFileSync(path.join(OUT, 'initial.json'), JSON.stringify(rendered.initial, null, 2));
  writeFileSync(path.join(OUT, 'sequence.json'), JSON.stringify(rendered.sequence, null, 2));
  writeFileSync(path.join(OUT, 'rendered.json'), JSON.stringify({
    canonical: rendered.canonical, events: rendered.events, eventTypes: rendered.eventTypes,
    finalTick: rendered.finalTick, echoHp: rendered.echoHp, droneHp: rendered.droneHp,
    enteredRooms: rendered.enteredRooms
  }, null, 2));

  expect(rendered.eventTypes, 'real non-drone death').toContain('enemy-died');
  expect(rendered.eventTypes, 'real loot drop').toContain('loot-dropped');
  expect(rendered.eventTypes, 'real loot pickup').toContain('loot-collected');
  expect(rendered.eventTypes, 'echo really got hurt').toContain('echo-hurt');
  expect(rendered.eventTypes, 'echo really fired').toContain('echo-fired');
  expect(rendered.attributedHits, 'non-drone hits are attributed to the echo actor').toBeGreaterThan(0);
  expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
