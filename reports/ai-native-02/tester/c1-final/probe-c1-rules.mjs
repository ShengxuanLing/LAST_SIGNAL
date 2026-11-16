// Independent C1 probe (rendered World on frozen cdb594e build).
// FIXTURES (declared): one spawned drone for the pulse test, one more drone for the
// drone-FSM/ranged test, and added scatter/plasma weapons so legacy weapons can be
// fired. NO i-frame refresh, NO HP writes, NO coordinate writes, NO addXp/hurt.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5284/';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c1-final/evidence-c1';
mkdirSync(OUT, { recursive: true });
const GAME_W = 1280, GAME_H = 720;
const report = {
  meta: { url: BASE, fixtures: ['spawn drone x2', 'add scatter/plasma weapons and equip them'], notFixtures: ['no invuln refresh', 'no HP writes', 'no coordinate writes', 'no addXp/hurt/spawnEnemy except the declared drones'], startedUtc: new Date().toISOString() },
  steps: [], pulse: null, scatter: null, plasma: null, wall: null, drone: null, errors: []
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
    const c = g.canvas.getBoundingClientRect();
    const s = g.scale;
    return { x: c.x + sx * (c.width / s.width), y: c.y + sy * (c.height / s.height) };
  }, { gx, gy });
}
const snap = () => page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene');
  const active = g.scene.getScenes(true).map((s) => s.sys.settings.key);
  if (!gs || !gs.world) return { active, world: null };
  const w = gs.world, pl = w.player;
  return {
    active, hp: pl.data.hp, grid: { x: pl.wx, y: pl.wy }, walkable: w.isWalkable(pl.wx, pl.wy, 0.5),
    weaponKey: pl.data.weaponKey, magazine: (pl.data.weapons.find((x) => x.key === pl.data.weaponKey) || {}).magazine,
    ammo: (pl.data.weapons.find((x) => x.key === pl.data.weaponKey) || {}).ammo,
    spec: pl.lastWeaponSpec ? { ...pl.lastWeaponSpec } : null,
    projectiles: w.projectiles.map((p) => ({ damage: p.data.damage, vel: p.data.vel, pierce: p.data.pierce, lifetime: p.data.lifetime, radius: p.data.radius, side: p.data.side })),
    enemyProjectiles: w.projectiles.filter((p) => p.data.side === 'enemy').length,
    lastProjectile: w.lastProjectileData ? { damage: w.lastProjectileData.damage, vel: w.lastProjectileData.vel, pierce: w.lastProjectileData.pierce, lifetime: w.lastProjectileData.lifetime, radius: w.lastProjectileData.radius } : null,
    enemies: w.enemies.map((e) => ({ id: e._id, hp: e._hp, state: e.data.state, lastDroneStep: e.lastDroneStep ? { state: e.lastDroneStep.state, attack: e.lastDroneStep.attack, timer: e.lastDroneStep.stateTimer } : null, lastHit: e.lastHitResult })),
    owner: pl.control.owner, levelUp: active.includes('LevelUpScene'), gameOver: active.includes('GameOverScene')
  };
});
const step = (name, detail) => report.steps.push({ name, detail });

await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await clickLogical(640, 340); // real NEW RUN, no seed injection
await page.waitForTimeout(1500);
step('new-run', await snap());

// ---------- Pulse damage on a real spawned drone ----------
const pulseSetup = await page.evaluate(() => {
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
  window.__c1Drone1 = enemy;
  return { enemyId: enemy._id, enemyHp: enemy._hp, target, weaponKey: pl.data.weaponKey, player: { x: pl.wx, y: pl.wy } };
});
step('pulse-setup', pulseSetup);
const aim1 = await gridToCss(pulseSetup.target.x, pulseSetup.target.y);
await page.mouse.move(Math.round(aim1.x), Math.round(aim1.y));
await page.mouse.down();
await page.waitForTimeout(250);
const duringPulse = await snap();
await page.waitForTimeout(700);
await page.mouse.up();
await page.waitForTimeout(250);
const afterPulse = await snap();
report.pulse = {
  weaponKey: pulseSetup.weaponKey, droneBefore: pulseSetup.enemyHp,
  duringProjectiles: duringPulse.projectiles.filter((p) => p.side === 'player').length,
  spec: duringPulse.spec,
  lastProjectile: afterPulse.lastProjectile,
  drones: afterPulse.enemies.filter((e) => e.id === pulseSetup.enemyId),
  droneGone: !afterPulse.enemies.some((e) => e.id === pulseSetup.enemyId),
  pass: pulseSetup.weaponKey === 'pulse' && duringPulse.spec && duringPulse.spec.shots === 1 &&
    (!afterPulse.enemies.some((e) => e.id === pulseSetup.enemyId) ||
      afterPulse.enemies.some((e) => e.id === pulseSetup.enemyId && e.hp < pulseSetup.enemyHp))
};
step('pulse-damage', report.pulse);
await page.screenshot({ path: path.join(OUT, '01-pulse.png') });

// ---------- Scatter: 5 real projectiles with spread ----------
const scatterSetup = await page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene');
  const pl = gs.world.player;
  pl.data.weapons.push({ key: 'scatter', level: 1, ammo: 8, magazine: 8, reloading: false, reloadTimer: 0 });
  pl.equipWeapon('scatter');
  const ws = pl.data.weapons.find((x) => x.key === 'scatter');
  return { weaponKey: pl.data.weaponKey, ammo: ws.ammo, magazine: ws.magazine };
});
step('scatter-setup', scatterSetup);
const aim2 = await gridToCss(pulseSetup.target.x, pulseSetup.target.y);
await page.mouse.move(Math.round(aim2.x), Math.round(aim2.y));
await page.mouse.down();
await page.waitForTimeout(180);
const duringScatter = await snap();
await page.mouse.up();
await page.waitForTimeout(150);
const afterScatter = await snap();
const scatterPlayerBullets = duringScatter.projectiles.filter((p) => p.side === 'player');
const angles = scatterPlayerBullets.map((p) => Math.atan2(p.vel.y, p.vel.x));
const angleRange = angles.length ? Math.max(...angles) - Math.min(...angles) : 0;
report.scatter = {
  weaponKey: scatterSetup.weaponKey, spec: duringScatter.spec, count: scatterPlayerBullets.length,
  distinctAngles: new Set(angles.map((a) => a.toFixed(3))).size, angleRange,
  magazineBefore: scatterSetup.magazine, ammoAfter: afterScatter.ammo, magazineAfter: afterScatter.magazine,
  pass: scatterSetup.weaponKey === 'scatter' && duringScatter.spec.shots === 5 && scatterPlayerBullets.length >= 5 &&
    new Set(angles.map((a) => a.toFixed(3))).size >= 3 && angleRange > 0.5
};
step('scatter', report.scatter);
await page.screenshot({ path: path.join(OUT, '02-scatter.png') });

// ---------- Plasma: pierce + real bullet ----------
const plasmaSetup = await page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene');
  const pl = gs.world.player;
  pl.data.weapons.push({ key: 'plasma', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 });
  pl.equipWeapon('plasma');
  return { weaponKey: pl.data.weaponKey, pierceCount: pl.data.pierceCount };
});
step('plasma-setup', plasmaSetup);
const aim3 = await gridToCss(pulseSetup.target.x, pulseSetup.target.y);
await page.mouse.move(Math.round(aim3.x), Math.round(aim3.y));
await page.mouse.down();
await page.waitForTimeout(220);
const duringPlasma = await snap();
await page.mouse.up();
await page.waitForTimeout(150);
const plasmaBullets = duringPlasma.projectiles.filter((p) => p.side === 'player');
report.plasma = {
  weaponKey: plasmaSetup.weaponKey, pierceCount: plasmaSetup.pierceCount, spec: duringPlasma.spec,
  bullets: plasmaBullets.map((b) => ({ pierce: b.pierce, speed: Math.hypot(b.vel.x, b.vel.y), damage: b.damage, lifetime: b.lifetime })),
  pass: plasmaSetup.weaponKey === 'plasma' && duringPlasma.spec.pierce === plasmaSetup.pierceCount + 2 &&
    plasmaBullets.length >= 1 && plasmaBullets.every((b) => b.pierce === plasmaSetup.pierceCount + 2) &&
    Math.abs(Math.hypot(plasmaBullets[0].vel.x, plasmaBullets[0].vel.y) - 380 / 64) < 0.02
};
step('plasma', report.plasma);
await page.screenshot({ path: path.join(OUT, '03-plasma.png') });
await page.waitForTimeout(2000); // let scatter/plasma bullets expire before the drone-FSM test

// ---------- Wall collision: real human movement toward a wall, sampled at 100ms ----------
const wallSamples = [];
let levelUps = 0;
await page.keyboard.down('KeyD');
for (let i = 0; i < 16; i++) {
  const s = await snap();
  if (s.levelUp) { levelUps++; await page.keyboard.press('1'); await page.waitForTimeout(400); }
  wallSamples.push({ i, grid: s.grid, walkable: s.walkable, hp: s.hp });
  await page.waitForTimeout(100);
}
await page.keyboard.up('KeyD');
await page.waitForTimeout(200);
let maxStep = 0, prev = null;
for (const s of wallSamples) {
  if (prev) maxStep = Math.max(maxStep, Math.hypot(s.grid.x - prev.grid.x, s.grid.y - prev.grid.y));
  prev = s;
}
report.wall = {
  samples: wallSamples.length, allWalkable: wallSamples.every((s) => s.walkable), maxStep, levelUps,
  positions: wallSamples.slice(0, 5), pass: wallSamples.every((s) => s.walkable) && maxStep < 3.2
};
step('wall-samples', report.wall);

// ---------- Drone FSM + real ranged damage to the player ----------
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
  window.__c1Drone2 = enemy;
  return { enemyId: enemy._id, enemyHp: enemy._hp, target, playerHp: pl.data.hp };
});
step('drone-setup', droneSetup);
const droneSamples = [];
let playerHpBefore = droneSetup.playerHp, enemyProjectilesSeen = 0, hpDrop = false;
for (let i = 0; i < 40; i++) {
  const s = await snap();
  if (s.levelUp) { await page.keyboard.press('1'); await page.waitForTimeout(350); }
  const d = s.enemies.find((e) => e.id === droneSetup.enemyId);
  enemyProjectilesSeen = Math.max(enemyProjectilesSeen, s.enemyProjectiles);
  if (s.hp < playerHpBefore) hpDrop = true;
  droneSamples.push({ i, state: d ? d.state : 'gone', lastDroneStep: d ? d.lastDroneStep : null, hp: d ? d.hp : null, playerHp: s.hp, enemyProjectiles: s.enemyProjectiles, grid: s.grid, walkable: s.walkable });
  if (hpDrop && i > 8) break;
  await page.waitForTimeout(200);
}
report.drone = {
  setup: droneSetup,
  states: [...new Set(droneSamples.map((d) => d.state))],
  sampledLastStep: droneSamples.some((d) => d.lastDroneStep !== null),
  hpDrop, playerHpBefore, playerHpLast: droneSamples[droneSamples.length - 1].playerHp,
  enemyProjectilesSeen,
  samples: droneSamples.slice(0, 10),
  pass: droneSamples.some((d) => d.lastDroneStep !== null) && hpDrop && enemyProjectilesSeen > 0
};
step('drone-fsm-ranged', report.drone);
await page.screenshot({ path: path.join(OUT, '04-drone.png') });

report.meta.endedUtc = new Date().toISOString();
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c1-final/c1-rules-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ meta: report.meta, pulse: report.pulse, scatter: report.scatter, plasma: report.plasma, wall: report.wall, drone: report.drone, errors: report.errors }, null, 2));
await browser.close();
