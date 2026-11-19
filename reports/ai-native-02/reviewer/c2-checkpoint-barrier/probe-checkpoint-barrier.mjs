// Targeted barrier probe on a dev server (exclusive port): low-delta, paused,
// immediate-exit, and first-checkpoint behavior for World.captureCheckpoint.
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5391);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1200);

const result = await page.evaluate(async () => {
  const g = window.__game;
  // Start a fresh run.
  g.scene.start('GameScene', { seed: 424242 });
  await new Promise((r) => setTimeout(r, 1200));
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const step = (ms) => w.stepFrame(ms, neutral);
  const cp = () => w.captureCheckpoint('probe', gs.seed, { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 });

  // Right after create: room-enter command may be pending -> first checkpoint deferral.
  const atCreate = {
    pending: w.hasUncommittedCommands(),
    pendingTypes: w.sim.pendingCommands.map((c) => c.type),
    captureNull: cp() === null
  };

  // Give one full tick so the room-enter commits, then capture should succeed.
  w.resetSimulationAccumulator();
  step(1000 / 60 + 1e-6);
  const afterCommit = { pending: w.hasUncommittedCommands(), captureNull: cp() === null };

  // Low-delta: enqueue reward, one sub-tick frame -> still pending, capture refused.
  w.resetSimulationAccumulator();
  w.enqueueCurrency(10);
  const curBefore = w.sim.player.data.currency;
  step(1); // 1ms, not enough for a tick
  const lowDelta = {
    pending: w.hasUncommittedCommands(),
    currencyUnchanged: w.sim.player.data.currency === curBefore,
    captureNull: cp() === null
  };
  // Full tick commits.
  w.resetSimulationAccumulator();
  step(1000 / 60 + 1e-6);
  const lowDeltaCommitted = {
    pending: w.hasUncommittedCommands(),
    currencyGained: w.sim.player.data.currency === curBefore + 10
  };

  // Paused: enqueue while paused, no stepFrame (GameScene.update returns early) ->
  // commands stay pending; capture refused (barrier), no stale save.
  gs.paused = true;
  w.enqueueCurrency(5);
  const pausedPending = { pending: w.hasUncommittedCommands(), captureNull: cp() === null };
  gs.paused = false;

  // Immediate exit: enqueue, no tick, capture refused -> saveCheckpoint returns false
  // and does not clear checkpointDirty (old checkpoint preserved).
  gs.markCheckpointDirty();
  w.enqueueCurrency(5);
  const immediateExit = { captureNull: cp() === null, saveReturns: gs.saveCheckpoint() };

  return { atCreate, afterCommit, lowDelta, lowDeltaCommitted, pausedPending, immediateExit };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
