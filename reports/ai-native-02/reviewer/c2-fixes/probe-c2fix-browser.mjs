// Independent reviewer probe for C2 fix a8232c8 (production preview; __game only).
// Diagnostic only; no production file changes.
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5355);
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
await page.waitForTimeout(400);
const result = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const p = w.player;
  const room = w.currentRoom();
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const fireAt = (t) => ({ move: { x: 0, y: 0 }, dash: false, fire: true, aim: t, interact: false });
  let spot = null;
  for (const d of [3, -3, 2, -2]) { const x = p.wx + d, y = p.wy; if (w.isWalkable(x, y, 0.5)) { spot = { x, y }; break; } }
  if (!spot) spot = { x: p.wx, y: p.wy + 3 };

  // B1: all legacy kinds + Boss via NORMAL stepFrame.
  const hunter = w.spawnEnemy('hunter', spot.x, spot.y, room.id, 1);
  const stalker = w.spawnEnemy('stalker', spot.x, spot.y, room.id, 1);
  const sentinel = w.spawnEnemy('sentinel', spot.x, spot.y, room.id, 1);
  hunter._hp = 20; stalker._hp = 20; sentinel._hp = 20;
  const before = [hunter._hp, stalker._hp, sentinel._hp];
  w.resetSimulationAccumulator();
  for (let i = 0; i < 150; i++) w.stepFrame(1000 / 60 + 1e-6, fireAt(spot));
  const after = [hunter._hp, stalker._hp, sentinel._hp];
  const removed = [hunter, stalker, sentinel].map((e) => !w.enemies.some((x) => x._id === e._id));
  w.spawnBoss(w.map.rooms[room.id]);
  const boss = w.boss;
  boss.wx = spot.x; boss.wy = spot.y; boss.attackTimer = 999999; boss._hp = 24;
  w.resetSimulationAccumulator();
  for (let i = 0; i < 60; i++) w.stepFrame(1000 / 60 + 1e-6, fireAt({ x: boss.x, y: boss.y }));
  const bossDead = !w.boss;

  // B2: live player core bullet must survive Boss.fireLaser untouched.
  if (!w.boss) { w.spawnBoss(w.map.rooms[room.id]); w.boss.attackTimer = 999999; }
  w.resetSimulationAccumulator();
  w.stepFrame(1000 / 60 + 1e-6, fireAt({ x: p.wx + 5, y: p.wy }));
  const playerBullet = w.sim.projectiles.find((x) => x.source === 'player');
  const beforeVel = playerBullet ? { ...playerBullet.vel } : null;
  const enemyBefore = w.sim.projectiles.filter((x) => x.side === 'enemy').length;
  if (w.boss) w.boss.fireLaser(p);
  const afterVel = playerBullet ? { ...playerBullet.vel } : null;
  const enemyProjectiles = w.sim.projectiles.filter((x) => x.side === 'enemy');
  const laserOk = enemyProjectiles.length > enemyBefore && enemyProjectiles.every((x) => Math.hypot(x.vel.x, x.vel.y) > 0);

  // B3: getter is a deep-enough copy; setter no-op; IDs unique.
  const coreCount = w.sim.projectiles.length;
  const view = w.projectiles;
  const coreBullet = w.sim.projectiles[0];
  const viewIsCore = view.some((v) => w.sim.projectiles.includes(v.data));
  const viewNested = view[0];
  const posBefore = { ...coreBullet.pos }, velBefore = { ...coreBullet.vel }, idsBefore = [...coreBullet.hitIds];
  viewNested.data.pos.x += 123; viewNested.data.vel.x = 999; viewNested.data.hitSet.add(777); viewNested.data.hitIds.push(888);
  const posAfter = { ...coreBullet.pos }, velAfter = { ...coreBullet.vel }, idsAfter = [...coreBullet.hitIds];
  w.projectiles = [];
  const coreAfterSetter = w.sim.projectiles.length;
  const ids = w.sim.projectiles.map((x) => x.id);
  const idsUnique = new Set(ids).size === ids.length;

  // B4: legacy Player.hurt queue order/events/invuln/death.
  p.data.hp = 100; p.invuln = 0;
  const hp0 = w.sim.player.data.hp;
  const q = p.hurt(10, p.x + 1, p.y);
  const hpAfterCall = w.sim.player.data.hp;
  const pending0 = w.sim.pendingPlayerHits.length;
  const ev1 = w.stepFrame(1000 / 60 + 1e-6, neutral);
  const hpAfterTick = w.sim.player.data.hp;
  // invuln: a second legacy hit should not queue/impact.
  p.invuln = 10;
  const qInv = p.hurt(10, p.x + 1, p.y);
  const pendingInv = w.sim.pendingPlayerHits.length;
  const evInv = w.stepFrame(1000 / 60 + 1e-6, neutral);
  const hpAfterInv = w.sim.player.data.hp;
  // death: queue two hits at hp 5, invuln 0.
  p.data.hp = 5; p.invuln = 0;
  const q1 = p.hurt(10, p.x + 1, p.y);
  const q2 = p.hurt(10, p.x + 1, p.y);
  const pendingDeath = w.sim.pendingPlayerHits.length;
  const evDeath = w.stepFrame(1000 / 60 + 1e-6, neutral);
  const deathCount = evDeath.filter((e) => e.type === 'player-death').length;
  const hurtCount = evDeath.filter((e) => e.type === 'player-hurt').length;
  const blockedHurt = evDeath.filter((e) => e.type === 'player-hurt' && e.hit.blocked).length;

  // registerTarget: identity / double-write check.
  const targetEnemy = w.spawnEnemy('hunter', spot.x, spot.y, room.id, 1);
  const target = w.sim.targets.find((t) => t.id === targetEnemy._id);
  const targetLinked = !!target && target.hp === targetEnemy._hp;
  targetEnemy._hp = 7;
  const targetAfterLegacyHp = target ? target.hp : null;
  if (target) target.hp = 9;
  const enemyAfterCoreHp = targetEnemy._hp;

  // step helper dev gate in production.
  let helperError = null;
  try { w.stepSimulationTicksForTest(1, neutral); } catch (e) { helperError = String(e); }

  return {
    paused: gs.paused,
    b1: { before, after, removed, bossDead },
    b2: { beforeVel, afterVel, enemyBefore, enemyAfter: enemyProjectiles.length, laserOk, playerBulletId: playerBullet?.id ?? null },
    b3: { coreCount, viewIsCore, coreAfterSetter, ids, idsUnique, posChanged: posBefore.x !== posAfter.x, velChanged: velBefore.x !== velAfter.x, idsChanged: idsBefore.length !== idsAfter.length },
    b4: { hp0, q, hpAfterCall, pending0, hpAfterTick, qInv, pendingInv, hpAfterInv, q1, q2, pendingDeath, deathCount, hurtCount, blockedHurt },
    target: { targetLinked, targetAfterLegacyHp, enemyAfterCoreHp },
    helperError,
  };
});
console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
await browser.close();
