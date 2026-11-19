// Browser probe (dev): pause must not advance; onResume forced-tick check;
// inventory QUEUED semantics; pendingRoomEnters prevents premature clear.
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5396);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1000);
await page.evaluate(() => window.__game.scene.start('GameScene', { seed: 424242 }));
await page.waitForTimeout(1200);

const result = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const tick = () => w.sim.tick;

  // --- Pause must not advance ---
  gs.paused = true;
  const pausedTick0 = tick();
  gs.update(0, 1000); // even a full second of delta while paused
  const pausedTick1 = tick();
  const pauseNoAdvance = pausedTick0 === pausedTick1;
  gs.paused = false;

  // --- onResume forced tick (delta-independent) ---
  const resumeTick0 = tick();
  gs.onResume();
  const resumeTick1 = tick();
  const onResumeAdvance = resumeTick1 - resumeTick0;

  // --- Inventory QUEUED: equip queued while paused, committed only on resume tick ---
  w.playerDataFixture.weapons.push({ key: 'scatter', level: 1, ammo: 8, magazine: 8, reloading: false, reloadTimer: 0 });
  gs.paused = true;
  w.enqueueEquipWeapon('scatter');
  const queued = {
    pendingEquip: w.getPendingEquipWeapon(),
    committedWeapon: w.sim.player.data.weaponKey
  };
  gs.onResume();
  const afterResumeEquip = w.sim.player.data.weaponKey;

  // --- pendingRoomEnters: no premature clear before generation commits ---
  w.player.reset(w.portal.wx, w.portal.wy);
  w.resetSimulationAccumulator();
  w.stepFrame(1000 / 60 + 1e-6, neutral);
  const target = w.portal?.targetRoom;
  w.tryInteract(w.player);
  const targetRoom = typeof target === 'number' ? w.map.rooms[target] : undefined;
  const pendingBeforeCommit = {
    hasPending: w.hasPendingSpawns(),
    pendingSize: w.pendingRoomEnters.size,
    cleared: targetRoom?.cleared,
    spawned: targetRoom?.spawned
  };
  // updateRoom must NOT clear it while generation is pending.
  w.updateRoom();
  const afterUpdateRoomPending = { cleared: targetRoom?.cleared };
  // Commit generation with one tick.
  w.resetSimulationAccumulator();
  w.stepFrame(1000 / 60 + 1e-6, neutral);
  const afterCommit = {
    pendingSize: w.pendingRoomEnters.size,
    spawned: targetRoom?.spawned,
    cleared: targetRoom?.cleared,
    enemiesInRoom: w.enemies.filter((e) => e.data.spawnRoom === targetRoom?.id && e.alive).length
  };
  // Clear enemies and let updateRoom mark cleared (once).
  for (const e of w.enemies) { if (e.sprite?.scene) e.sprite.destroy(); }
  w.enemies = [];
  w.simFixture.drones = []; w.simFixture.targets = [];
  w.resetSimulationAccumulator();
  w.stepFrame(1000 / 60 + 1e-6, neutral);
  const afterClear = { cleared: targetRoom?.cleared };

  return { pauseNoAdvance, pausedTick0, pausedTick1, onResumeAdvance, queued, afterResumeEquip,
    pendingBeforeCommit, afterUpdateRoomPending, afterCommit, afterClear };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
