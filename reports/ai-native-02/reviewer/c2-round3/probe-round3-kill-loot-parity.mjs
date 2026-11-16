// Independent round-3 dev-only parity probe: kill -> visible loot -> legal movement
// pickup -> resources/events -> subsequent shot, rendered World vs Node core.
// Explicit dev/test fixtures: simFixture, playerDataFixture, clearEnemiesForTest,
// setPlayerPositionForTest are used only for setup; pickup movement uses normal
// stepFrame intents, not direct position writes.
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5371);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__game.scene.start('GameScene', { seed: 424242 }));
await page.waitForTimeout(1200);
await page.keyboard.press('Escape');
await page.waitForTimeout(350);

const result = await page.evaluate(async () => {
  const core = await import('/src/world/sim/core.ts');
  const ctrl = await import('/src/ai-native/control.ts');
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const step = (intent) => w.stepFrame(1000 / 60 + 1e-6, intent);
  const clone = (s) => JSON.parse(JSON.stringify(s));
  const canon = (s) => core.canonicalSimulationState(s);
  const evcanon = (e) => core.canonicalSimulationEvents(e);

  // Explicit dev/test fixtures (production-gated helpers, legal on dev server).
  w.clearEnemiesForTest();
  for (const r of w.map.rooms) { r.spawned = true; r.cleared = true; }
  w.resetSimulationAccumulator();

  const room = w.currentRoom();
  const px = w.playerX, py = w.playerY;
  const findDrone = () => {
    for (const d of [4, 5, 6, 7, 8, -4, -5, -6]) {
      const x = px + d, y = py;
      if (w.isWalkable(x, y, 0.5)) return { x, y };
    }
    return { x: px + 2, y: py };
  };
  const droneSpot = findDrone();
  w.enqueueSpawnEnemy('drone', droneSpot.x, droneSpot.y, room.id, 1);
  step(neutral); // worldSpawns -> core drone
  const drone = w.simFixture.drones[0];
  drone.hp = 1;
  drone.data.state = 'stun';
  drone.data.stateTimer = 1000;
  drone.attackTimer = 1000;
  drone.wanderTimer = 1000;
  w.bumpSimVersion?.();

  // Find a legal straight path: far start, loot far enough from far start to
  // avoid C1 auto-pickup threshold (PLAYER_RADIUS + 12).
  let fx = null, lx = null, ryRow = null;
  const cands = [];
  const h = w.map.height, wd = w.map.width;
  for (let ry = 0; ry < h; ry++) {
    const xs = [];
    for (let x = 0; x < wd; x++) if (w.isWalkable(x, ry, 0.5)) xs.push(x);
    xs.sort((a, b) => a - b);
    const loot = xs[xs.length - 1], far = xs[0];
    if (!Number.isFinite(loot - far)) continue;
    if (loot - far < 16 || loot - far > 30) continue;
    let ok = true;
    for (let x = far; x <= loot; x += 0.5) if (!w.isWalkable(x, ry, 0.5)) { ok = false; break; }
    if (ok) cands.push({ far, loot, ry });
  }
  if (cands.length === 0) return { setupFailed: 'no legal walkable far/loot pair', walkedRows: h };
  fx = cands[0].far; lx = cands[0].loot; ryRow = cands[0].ry;

  const initial = clone(w.simFixture);
  const node = clone(initial);
  const renderedEvents = [];
  const nodeEvents = [];

  // Phase A: kill the drone with a legal fire intent.
  const fire = { move: { x: 0, y: 0 }, dash: false, fire: true, aim: { x: droneSpot.x, y: droneSpot.y }, interact: false };
  for (let i = 0; i < 30; i++) renderedEvents.push(...step(fire));
  nodeEvents.push(...core.stepSimulationTicks(node, 30, fire));
  const phaseA = {
    equalCanonical: canon(w.simFixture) === canon(node),
    equalEvents: evcanon(renderedEvents) === evcanon(nodeEvents),
    eventTypes: [...new Set(renderedEvents.map((e) => e.type))],
    lootAfterKill: w.simFixture.loot.length
  };

  // Phase B: teleport away (validated core command) and enqueue a visible loot drop.
  w.enqueueTeleport(fx, ryRow, false);
  w.spawnLoot(lx, ryRow, 'currency', 'currency', 7);
  const bR = step(neutral);
  renderedEvents.push(...bR);
  core.enqueueCommand(node, { type: 'teleport-player', x: fx, y: ryRow, healToFull: false });
  core.enqueueSpawnLoot(node, lx, ryRow, 'currency', 'currency', 7);
  const bN = core.stepSimulationTicks(node, 1, neutral);
  nodeEvents.push(...bN);
  const phaseB = {
    equalCanonical: canon(w.simFixture) === canon(node),
    equalEvents: evcanon(renderedEvents) === evcanon(nodeEvents),
    bEvents: bR.map((e) => e.type),
    playerX: w.simFixture.player.x,
    lx: w.simFixture.loot[0]?.x ?? null,
    distance: Math.abs((w.simFixture.loot[0]?.x ?? lx) - w.simFixture.player.x)
  };

  // Phase C: legal movement intent toward the loot; pickup must commit.
  const dx = lx - fx;
  const dir = ctrl.screenDirectionTowardGrid(dx, 0);
  const moveIntent = { move: dir, dash: false, fire: false, aim: null, interact: false };
  for (let i = 0; i < 260; i++) renderedEvents.push(...step(moveIntent));
  nodeEvents.push(...core.stepSimulationTicks(node, 260, moveIntent));
  const phaseC = {
    equalCanonical: canon(w.simFixture) === canon(node),
    equalEvents: evcanon(renderedEvents) === evcanon(nodeEvents),
    lootCollected: renderedEvents.some((e) => e.type === 'loot-collected'),
    currencyGained: renderedEvents.some((e) => e.type === 'currency-gained'),
    lootLeft: w.simFixture.loot.length,
    currency: w.simFixture.player.data.currency,
    pickupTick: renderedEvents.findIndex((e) => e.type === 'loot-collected'),
    nodePickupTick: nodeEvents.findIndex((e) => e.type === 'loot-collected')
  };

  // Phase D: subsequent shot after pickup.
  const shot = { move: { x: 0, y: 0 }, dash: false, fire: true, aim: { x: lx + 5, y: ryRow }, interact: false };
  renderedEvents.push(...step(shot));
  nodeEvents.push(...core.stepSimulationTicks(node, 1, shot));
  const phaseD = {
    equalCanonical: canon(w.simFixture) === canon(node),
    equalEvents: evcanon(renderedEvents) === evcanon(nodeEvents),
    finalRngStateEqual: w.simFixture.rngState === node.rngState
  };

  const _dbg = { fx, lx, ryRow, fxType: typeof fx, lxType: typeof lx, candidates: cands.length };
  return {
    paused: gs.paused,
    fixtures: ['clearEnemiesForTest', 'simFixture', 'setPlayerPositionForTest (not used)', 'spawned/cleared room flags'],
    droneSpot, fx, lx, rowY: ryRow, _dbg,
    initial: { drones: initial.drones.length, loot: initial.loot.length, pendingCommands: initial.pendingCommands.length },
    phaseA, phaseB, phaseC, phaseD,
    totalRenderedEvents: renderedEvents.length,
    totalNodeEvents: nodeEvents.length
  };
});
console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
await browser.close();
