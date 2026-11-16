// Independent C2 rendered probe — NORMAL FRAME PATH ONLY.
// No stepFrame()/stepSimulationTicksForTest()/resetSimulationAccumulator() calls.
// Real RAF loop + real keyboard/mouse input; read-only page.evaluate for evidence.
// Fixtures declared: one spawned drone; restoreCheckpoint boundary check at the end.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5285/';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-final/evidence-rendered';
mkdirSync(OUT, { recursive: true });
const GAME_W = 1280, GAME_H = 720;
const report = {
  meta: {
    url: BASE, normalFramePathOnly: true,
    notCalled: ['stepFrame', 'stepSimulationTicksForTest', 'resetSimulationAccumulator'],
    fixtures: ['one spawned drone for real pulse combat', 'restoreCheckpoint boundary check at the end'],
    notFixtures: ['no seed injection', 'no HP/coordinate writes', 'no i-frame refresh', 'no addXp/hurt'],
    startedUtc: new Date().toISOString()
  },
  steps: [], cadence: null, movement: null, combat: null, pause: null, restore: null, errors: []
};
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));

const box = () => page.evaluate(() => {
  const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
async function clickLogical(lx, ly) {
  const b = await box(); await page.mouse.click(b.x + (lx * b.w) / GAME_W, b.y + (ly * b.h) / GAME_H);
}
async function gridToCss(gx, gy) {
  return page.evaluate(({ gx, gy }) => {
    const g = window.__game, gs = g.scene.getScene('GameScene');
    const cam = gs.cameras.main;
    const p0 = cam.getWorldPoint(0, 0), px = cam.getWorldPoint(100, 0), py = cam.getWorldPoint(0, 100);
    const ax = (px.x - p0.x) / 100, bx = p0.x, ay = (py.y - p0.y) / 100, by = p0.y;
    const d = gs.world.worldToScreen(gx, gy);
    const sx = (d.x - bx) / ax, sy = (d.y - by) / ay;
    const c = g.canvas.getBoundingClientRect(); const s = g.scale;
    return { x: c.x + sx * (c.width / s.width), y: c.y + sy * (c.height / s.height) };
  }, { gx, gy });
}
const snap = () => page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene');
  const active = g.scene.getScenes(true).map((s) => s.sys.settings.key);
  if (!gs || !gs.world) return { active, world: null };
  const w = gs.world, pl = w.player;
  return {
    active, tick: w.sim.tick, seed: w.sim.seed,
    simPlayer: { x: w.sim.player.x, y: w.sim.player.y, hp: w.sim.player.data.hp },
    player: { x: pl.wx, y: pl.wy, hp: pl.data.hp },
    drones: w.sim.drones.map((d) => ({ id: d.id, hp: d.hp, x: d.x, y: d.y })),
    worldEnemies: w.enemies.map((e) => ({ id: e._id, hp: e._hp })),
    coreProjectiles: w.sim.projectiles.length,
    projectilesView: w.projectiles.length,
    damageDealt: gs.damageDealt, kills: gs.enemiesKilled,
    paused: gs.paused, levelUp: active.includes('LevelUpScene'), gameOver: active.includes('GameOverScene'),
    txtControl: gs.txtControl.text, agentLink: gs.txtAgentLink.text
  };
});
const step = (name, detail) => report.steps.push({ name, detail });

await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await clickLogical(640, 340); // real NEW RUN, no seed injection
await page.waitForTimeout(1500);
const start = await snap();
step('start', start);

// 1) Real RAF cadence: sample the core tick every 100ms for 1s.
const cadence = [];
for (let i = 0; i < 10; i++) {
  const s = await snap();
  cadence.push({ i, tMs: Date.now(), tick: s.tick });
  await page.waitForTimeout(100);
}
const deltas = cadence.slice(1).map((c, i) => c.tick - cadence[i].tick);
report.cadence = {
  samples: cadence.length, tickStart: cadence[0].tick, tickEnd: cadence[cadence.length - 1].tick,
  deltas, nonzeroSamples: deltas.filter((d) => d > 0).length,
  maxDelta: Math.max(...deltas), minDelta: Math.min(...deltas),
  // A single test-only 60-tick jump would show one huge delta and zeros; the real
  // RAF path spreads ticks across samples with small per-sample deltas.
  pass: deltas.filter((d) => d > 0).length >= 6 && Math.max(...deltas) <= 15 &&
    (cadence[cadence.length - 1].tick - cadence[0].tick) >= 40 && (cadence[cadence.length - 1].tick - cadence[0].tick) <= 100
};
step('cadence', report.cadence);

// 2) Real movement: key input must move the core state and the rendered player together.
const beforeMove = await snap();
await page.keyboard.down('KeyD');
await page.waitForTimeout(500);
await page.keyboard.up('KeyD');
await page.waitForTimeout(250);
const afterMove = await snap();
report.movement = {
  tickBefore: beforeMove.tick, tickAfter: afterMove.tick,
  simDelta: { x: afterMove.simPlayer.x - beforeMove.simPlayer.x, y: afterMove.simPlayer.y - beforeMove.simPlayer.y },
  renderedDelta: { x: afterMove.player.x - beforeMove.player.x, y: afterMove.player.y - beforeMove.player.y },
  simEqualsRendered: Math.abs(afterMove.simPlayer.x - afterMove.player.x) < 1e-9 && Math.abs(afterMove.simPlayer.y - afterMove.player.y) < 1e-9,
  pass: (Math.abs(afterMove.simPlayer.x - beforeMove.simPlayer.x) > 0.5 || Math.abs(afterMove.simPlayer.y - beforeMove.simPlayer.y) > 0.5) &&
    Math.abs(afterMove.simPlayer.x - afterMove.player.x) < 1e-9
};
step('movement', report.movement);

// 3) Real combat through the normal frame loop: spawn a drone, aim, fire, observe core HP/kill.
const droneSetup = await page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene');
  const w = gs.world, pl = w.player;
  const room = w.currentRoom();
  let target = null;
  for (const d of [3, 2.5, 3.5, -3, -2.5]) {
    const x = pl.wx + d, y = pl.wy;
    if (w.isWalkable(x, y, 0.5)) { target = { x, y }; break; }
  }
  if (!target) target = { x: pl.wx, y: pl.wy + 3 };
  const enemy = w.spawnEnemy('drone', target.x, target.y, room?.id ?? 0, 1);
  window.__c2Drone = enemy;
  return { enemyId: enemy._id, hp: enemy._hp, target, tick: w.sim.tick, simDrones: w.sim.drones.length };
});
step('drone-setup', droneSetup);
await page.waitForTimeout(250);
const preFire = await snap();
const aim = await gridToCss(droneSetup.target.x, droneSetup.target.y);
await page.mouse.move(Math.round(aim.x), Math.round(aim.y));
await page.mouse.down();
const fireSamples = [];
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(150);
  const s = await snap();
  fireSamples.push({ i, tick: s.tick, droneHp: (s.drones.find((d) => d.id === droneSetup.enemyId) || {}).hp ?? null, worldHp: (s.worldEnemies.find((e) => e.id === droneSetup.enemyId) || {}).hp ?? null, coreProjectiles: s.coreProjectiles, damageDealt: s.damageDealt });
}
await page.mouse.up();
await page.waitForTimeout(300);
const postFire = await snap();
const droneSample = fireSamples.map((f) => f.droneHp).filter((h) => typeof h === 'number');
report.combat = {
  setup: droneSetup,
  preTick: preFire.tick, postTick: postFire.tick,
  simDronesBefore: preFire.drones.length, simDronesAfter: postFire.drones.length,
  droneRemovedFromSim: !postFire.drones.some((d) => d.id === droneSetup.enemyId),
  droneRemovedFromWorld: !postFire.worldEnemies.some((e) => e.id === droneSetup.enemyId),
  damageDealt: postFire.damageDealt, kills: postFire.kills,
  maxCoreProjectiles: Math.max(0, ...fireSamples.map((f) => f.coreProjectiles)),
  tickAdvanced: postFire.tick > preFire.tick,
  hpSampleMin: droneSample.length ? Math.min(...droneSample) : null,
  pass: postFire.tick > preFire.tick &&
    (!postFire.drones.some((d) => d.id === droneSetup.enemyId) || (droneSample.length > 0 && Math.min(...droneSample) < droneSetup.hp)) &&
    postFire.damageDealt > 0 && Math.max(0, ...fireSamples.map((f) => f.coreProjectiles)) > 0
};
step('combat', report.combat);
await page.screenshot({ path: path.join(OUT, '01-combat.png') });

// 4) Pause: real ESC, real wall-clock wait, no catch-up on resume.
await page.keyboard.press('Escape');
await page.waitForTimeout(350);
const pauseStart = await snap();
await page.waitForTimeout(1200);
const pauseEnd = await snap();
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const resumed = await snap();
report.pause = {
  paused: pauseStart.paused,
  tickFrozen: pauseStart.tick === pauseEnd.tick,
  frozenDelta: pauseEnd.tick - pauseStart.tick,
  resumeDelta: resumed.tick - pauseEnd.tick,
  catchUpThreshold: 60, // 1s of ticks
  noCatchUp: (resumed.tick - pauseEnd.tick) < 60 && resumed.paused === false,
  pass: pauseStart.paused && pauseStart.tick === pauseEnd.tick && resumed.paused === false && (resumed.tick - pauseEnd.tick) < 60 && (resumed.tick - pauseEnd.tick) > 0
};
step('pause', report.pause);
await page.screenshot({ path: path.join(OUT, '02-after-pause.png') });

// 5) restoreCheckpoint input mutation must not alias live state (boundary check, declared).
const restoreCheck = await page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const frame = w.captureCheckpoint('c2-f08-probe', gs.seed, gs.runStats());
  if (!frame) return { available: false };
  if (!w.restoreCheckpoint(frame)) return { available: false, restored: false };
  const hp = w.player.data.hp, x = w.player.wx, simX = w.sim.player.x;
  frame.player.hp = 1;
  frame.position.x = x + 100;
  return { available: true, restored: true, hp, x, simX, hpAfter: w.player.data.hp, xAfter: w.player.wx, simXAfter: w.sim.player.x };
});
report.restore = {
  ...restoreCheck,
  pass: restoreCheck.available && restoreCheck.restored && restoreCheck.hpAfter === restoreCheck.hp && restoreCheck.xAfter === restoreCheck.x && restoreCheck.simXAfter === restoreCheck.simX
};
step('restore-mutation', report.restore);

report.meta.endedUtc = new Date().toISOString();
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-final/rendered-normal-frame-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  meta: report.meta, cadence: report.cadence, movement: report.movement,
  combat: report.combat, pause: report.pause, restore: report.restore, errors: report.errors
}, null, 2));
await browser.close();
