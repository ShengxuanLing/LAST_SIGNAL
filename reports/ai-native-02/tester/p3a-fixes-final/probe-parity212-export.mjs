// My own Rendered ECHO parity export: exactly 212 fixed core ticks.
// Core-managed actors + ONE static non-drone target; real kill / loot / echo-hurt.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-fixes-final/parity212';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5371/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.waitForTimeout(400);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(400);

const result = await page.evaluate(async () => {
  const mod = await import('/src/world/sim/core.ts');
  const rules = await import('/src/world/sim/rules.ts');
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const dt = 1000 / 60 + 1e-6;
  w.clearEnemiesForTest(); w.resetProjectilesForTest();
  w.enableEcho(); w.stepFrame(dt, neutral, neutral); // commit spawn-echo
  const room = w.currentRoom();
  let row = null, col = 0;
  for (const r of w.map.tiles) {
    for (const tile of r) {
      if (room && (tile.x < room.gx || tile.x >= room.gx + room.w || tile.y < room.gy || tile.y >= room.gy + room.h)) continue;
      let ok = true;
      for (let k = 0; k < 9; k += 1) if (!w.isWalkable(tile.x + k, tile.y, 0.5)) { ok = false; break; }
      if (ok) { row = tile.y; col = tile.x; break; }
    }
    if (row !== null) break;
  }
  if (row === null) return { error: 'no walkable 9-tile row' };
  w.setPlayerPositionForTest(col, row);
  w.simFixture.player.x = col; w.simFixture.player.y = row;
  const echo = w.simFixture.echo;
  echo.x = col + 5; echo.y = row;
  w.echoActor.x = col + 5; w.echoActor.y = row;
  const drone = w.spawnEnemy('drone', col + 6, row, room?.id ?? 0, 1);
  const hunter = w.spawnEnemy('hunter', col + 2, row, room?.id ?? 0, 1);
  hunter.data.state = 'idle'; hunter.data.stateTimer = 1e9; hunter.wanderTimer = 1e9;
  w.enqueueSpawnLoot(col + 3, row, 'currency', 'currency', 4);
  w.worldSpawns = []; w.pendingRoomEnters.clear();
  const initial = JSON.parse(JSON.stringify(w.sim));
  const enteredRooms = w.map.rooms.map((_r, i) => i);
  const sequence = [];
  const events = [];
  const runStep = (intent, echoIntent) => {
    sequence.push({ ticks: 1, intent, echoIntent });
    w.resetSimulationAccumulator();
    events.push(...w.stepFrame(dt, intent, echoIntent));
  };
  const aimAt = (x, y) => ({ ...neutral, fire: true, aim: { x, y } });
  // 1) real kill of the static non-drone target by player + echo
  for (let i = 0; i < 100; i += 1) runStep(aimAt(col + 2, row), aimAt(col + 2, row));
  // 2) real drone engagement and echo-hurt
  for (let i = 0; i < 60; i += 1) runStep(neutral, neutral);
  // 3) real loot pickup by the protagonist
  for (let i = 0; i < 40; i += 1) {
    const loot = w.sim.loot[0];
    if (!loot) { runStep(neutral, neutral); continue; }
    const dx = loot.x - w.sim.player.x, dy = loot.y - w.sim.player.y;
    const dir = rules.gridDirectionToScreenDirection(dx, dy);
    runStep({ ...neutral, move: dir }, neutral);
  }
  // 4) fill to exactly 212 real ticks
  while (sequence.length < 212) runStep(neutral, neutral);
  return {
    initial, enteredRooms, sequence,
    canonical: mod.canonicalSimulationState(w.sim),
    events: mod.canonicalSimulationEvents(events),
    eventTypes: [...new Set(events.map((e) => e.type))],
    finalTick: w.sim.tick,
    echoHp: w.sim.echo?.data.hp ?? null,
    playerHp: w.sim.player.data.hp,
    dronesLeft: w.sim.drones.length, targetsLeft: w.sim.targets.length,
    lootLeft: w.sim.loot.length,
    echoFired: events.filter((e) => e.type === 'echo-fired').length,
    attributedHits: events.filter((e) => e.type === 'enemy-hit' && e.byActorId === 1).length,
    echoHurt: events.filter((e) => e.type === 'echo-hurt').length
  };
});
if (result.error) { console.error(result.error); process.exit(2); }
writeFileSync(OUT + '/initial.json', JSON.stringify(result.initial));
writeFileSync(OUT + '/sequence.json', JSON.stringify(result.sequence));
writeFileSync(OUT + '/rendered.json', JSON.stringify({ ...result, initial: undefined, enteredRooms: undefined, sequence: undefined }));
console.log(JSON.stringify({ ticks: result.sequence.length, eventTypes: result.eventTypes, finalTick: result.finalTick, echoHp: result.echoHp, playerHp: result.playerHp, dronesLeft: result.dronesLeft, targetsLeft: result.targetsLeft, lootLeft: result.lootLeft, echoFired: result.echoFired, attributedHits: result.attributedHits, echoHurt: result.echoHurt, errors: errs }, null, 2));
await browser.close();
