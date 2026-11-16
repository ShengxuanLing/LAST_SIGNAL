// AI-NATIVE-02 final delivery — World.sim must invalidate after a direct core
// spawn. Regression for the c3c-headless-parity fixture cache: a caller that
// warms `world.sim` before `spawnEnemy` must see the newly spawned drone in the
// NEXT `world.sim`, while the previous frozen snapshot stays unchanged.
//
// The test uses the real production mutator (`spawnEnemy`) and the real core
// canonical projection. It does not read `_sim` as a replacement for the
// public snapshot.

import { expect, test } from '@playwright/test';

async function bootRun(page: any): Promise<void> {
  await page.goto('/');
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
}

test('World.sim invalidates after spawnEnemy and the old snapshot stays frozen', async ({ page }) => {
  await bootRun(page);

  const result = await page.evaluate(async () => {
    const mod: any = await import('/src/world/sim/core.ts');
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const w = gs.world;
    const p = { x: w.player.wx, y: w.player.wy };
    const room = w.currentRoom();

    // Warm the public snapshot BEFORE the spawn. This is exactly what the
    // per-frame Signal HUD does in rendered play.
    const before = w.sim;
    const beforeDrones = before.drones.length;
    const beforeFrozen = Object.isFrozen(before);

    const drone = w.spawnEnemy('drone', p.x + 2, p.y, room?.id ?? 0, 1);
    const after = w.sim;
    const live = w.simFixture;

    const afterDrones = after.drones.length;
    const afterHasId = after.drones.some((d: any) => d.id === drone._id);
    const liveHasId = live.drones.some((d: any) => d.id === drone._id);
    const afterCanonical = mod.canonicalSimulationState(after);
    const liveCanonical = mod.canonicalSimulationState(live);

    // A real tick must produce a NEW latest snapshot, never reuse the cache.
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    const events = w.stepFrame(1000 / 60 + 1e-6, neutral);
    const ticked = w.sim;
    const tickedLive = w.simFixture;

    return {
      beforeDrones,
      afterDrones,
      afterHasId,
      liveHasId,
      afterIsNew: after !== before,
      beforeUnchanged: before.drones.length === beforeDrones,
      beforeFrozen,
      afterFrozen: Object.isFrozen(after),
      snapshotMatchesLive: afterCanonical === liveCanonical,
      tickAfterSpawn: ticked.tick,
      liveTickAfterSpawn: tickedLive.tick,
      tickSnapshotMatchesLive: mod.canonicalSimulationState(ticked) === mod.canonicalSimulationState(tickedLive),
      tickHasDrone: ticked.drones.some((d: any) => d.id === drone._id),
      eventsIsArray: Array.isArray(events)
    };
  });

  expect(result.beforeDrones, 'warm snapshot starts without the new drone').toBe(0);
  expect(result.afterDrones, 'next world.sim sees the spawned drone').toBe(1);
  expect(result.afterHasId, 'the new snapshot contains the actual drone id').toBe(true);
  expect(result.liveHasId, 'the live core really contains the drone').toBe(true);
  expect(result.afterIsNew, 'spawnEnemy invalidates the cached snapshot').toBe(true);
  expect(result.beforeUnchanged, 'the old frozen snapshot is immutable history').toBe(true);
  expect(result.beforeFrozen).toBe(true);
  expect(result.afterFrozen).toBe(true);
  expect(result.snapshotMatchesLive, 'the latest snapshot matches canonical live state').toBe(true);
  expect(result.tickAfterSpawn, 'a real tick advanced the core').toBeGreaterThan(0);
  expect(result.liveTickAfterSpawn).toBe(result.tickAfterSpawn);
  expect(result.tickSnapshotMatchesLive, 'the ticked snapshot matches canonical live state').toBe(true);
  expect(result.tickHasDrone, 'the drone survives the real tick').toBe(true);
  expect(result.eventsIsArray).toBe(true);
});
