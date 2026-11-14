// Independent reviewer round2 probe (frozen 0df1514; production preview).
// Uses only legal commands/getters; no deleted setters.
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5357);
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

  // B1 via enqueueTargetHp commands.
  const hunter = w.spawnEnemy('hunter', spot.x, spot.y, room.id, 1);
  const stalker = w.spawnEnemy('stalker', spot.x, spot.y, room.id, 1);
  const sentinel = w.spawnEnemy('sentinel', spot.x, spot.y, room.id, 1);
  w.enqueueTargetHp(hunter._id, 20); w.enqueueTargetHp(stalker._id, 20); w.enqueueTargetHp(sentinel._id, 20);
  w.resetSimulationAccumulator();
  w.stepFrame(1000 / 60 + 1e-6, neutral);
  const before = [hunter._hp, stalker._hp, sentinel._hp];
  for (let i = 0; i < 150; i++) w.stepFrame(1000 / 60 + 1e-6, fireAt(spot));
  const after = [hunter._hp, stalker._hp, sentinel._hp];
  const removed = [hunter, stalker, sentinel].map((e) => !w.enemies.some((x) => x._id === e._id));

  // Boss radius and death.
  w.spawnBoss(w.map.rooms[room.id]);
  const boss = w.boss;
  const bossRadius = w.sim.targets.find((t) => t.id === boss._id)?.radius ?? null;
  w.enqueueTargetMove(boss._id, spot.x, spot.y); w.enqueueTargetHp(boss._id, 24);
  boss.attackTimer = 999999;
  w.resetSimulationAccumulator();
  w.stepFrame(1000 / 60 + 1e-6, neutral);
  for (let i = 0; i < 60; i++) w.stepFrame(1000 / 60 + 1e-6, fireAt({ x: boss.x, y: boss.y }));
  const bossDead = !w.boss;

  // B2 player bullet vs Boss.fireLaser.
  if (!w.boss) { w.spawnBoss(w.map.rooms[room.id]); w.boss.attackTimer = 999999; }
  w.resetSimulationAccumulator();
  w.stepFrame(1000 / 60 + 1e-6, fireAt({ x: p.wx + 5, y: p.wy }));
  const playerBullet = w.sim.projectiles.find((x) => x.source === 'player');
  const beforeVel = playerBullet ? { ...playerBullet.vel } : null;
  const enemyBefore = w.sim.projectiles.filter((x) => x.side === 'enemy').length;
  if (w.boss) w.boss.fireLaser(p);
  const afterVel = playerBullet ? { ...playerBullet.vel } : null;
  const enemyAfter = w.sim.projectiles.filter((x) => x.side === 'enemy').length;
  const laserOk = enemyAfter > enemyBefore && w.sim.projectiles.filter((x) => x.side === 'enemy').every((x) => Math.hypot(x.vel.x, x.vel.y) > 0);

  // B3 getter copy / setter no-op / ids.
  const coreCount = w.sim.projectiles.length;
  const view = w.projectiles;
  const coreBullet = w.sim.projectiles[0];
  const viewIsCore = view.some((v) => w.sim.projectiles.includes(v.data));
  const pos0 = { ...coreBullet.pos }, vel0 = { ...coreBullet.vel }, ids0 = [...coreBullet.hitIds];
  view[0].data.pos.x += 50; view[0].data.vel.x = 999; view[0].data.hitIds.push(777); view[0].data.hitSet.add(888);
  const viewMutatedCore = coreBullet.pos.x !== pos0.x || coreBullet.vel.x !== vel0.x || coreBullet.hitIds.length !== ids0.length;
  w.projectiles = [];
  const coreAfterSetter = w.sim.projectiles.length;
  const idsUnique = new Set(w.sim.projectiles.map((x) => x.id)).size === w.sim.projectiles.length;

  // B4 two lethal queued hits.
  p.data.hp = 5; p.invuln = 0;
  const q1 = p.hurt(10, p.x + 1, p.y);
  const q2 = p.hurt(10, p.x + 1, p.y);
  const pendingDeath = w.sim.pendingPlayerHits.length;
  const evDeath = w.stepFrame(1000 / 60 + 1e-6, neutral);
  const deathCount = evDeath.filter((e) => e.type === 'player-death').length;
  const hurtCount = evDeath.filter((e) => e.type === 'player-hurt').length;
  const blockedHurt = evDeath.filter((e) => e.type === 'player-hurt' && e.hit.blocked).length;
  // invuln hit
  p.data.hp = 100; p.invuln = 10;
  const qInv = p.hurt(10, p.x + 1, p.y);
  const pendingInv = w.sim.pendingPlayerHits.length;

  // H9 production helper gate.
  const helperErrors = {};
  try { w.resetProjectilesForTest(); } catch (e) { helperErrors.reset = String(e); }
  try { w.clearEnemiesForTest(); } catch (e) { helperErrors.clear = String(e); }
  try { w.stepSimulationTicksForTest(1, neutral); } catch (e) { helperErrors.step = String(e); }

  // H10 non-Boss hit flash: spawn hunter, fire at it, inspect data.hitFlash.
  const flashEnemy = w.spawnEnemy('hunter', spot.x, spot.y, room.id, 1);
  w.enqueueTargetHp(flashEnemy._id, 40);
  w.stepFrame(1000 / 60 + 1e-6, neutral);
  w.resetSimulationAccumulator();
  for (let i = 0; i < 20; i++) w.stepFrame(1000 / 60 + 1e-6, fireAt({ x: flashEnemy.x, y: flashEnemy.y }));
  const flash = flashEnemy.data.hitFlash;

  // B9: direct core projectile/enemy creation outside tick.
  const tickBefore = w.sim.tick;
  const coreBefore = w.sim.projectiles.length;
  w.spawnEnemyProjectile(999, p.wx + 1, p.wy, 8, { x: 0, y: 0 });
  const coreAfterSpawn = w.sim.projectiles.length;
  const tickAfter = w.sim.tick;

  // Target read-only + public sim/player.data live refs.
  const targetEnemy = w.spawnEnemy('hunter', spot.x, spot.y, room.id, 1);
  const target = w.sim.targets.find((t) => t.id === targetEnemy._id);
  let setterError = null;
  try { targetEnemy._hp = 7; targetEnemy.wx = 999; } catch (e) { setterError = String(e); }
  const targetAfterSetterAttempt = target ? { hp: target.hp, x: target.x } : null;
  const targetHp0 = target?.hp;
  if (target) target.hp = 3;
  const enemySeesCore = targetEnemy._hp;
  const playerHp0 = p.data.hp;
  w.sim.player.data.hp = 1;
  const playerSeesLive = p.data.hp;

  // Loot/economy bypass: spawn loot at player and step with 0 delta.
  const currency0 = p.data.currency;
  w.spawnLoot(p.wx, p.wy, 'currency', 'currency', 10);
  const evLoot = w.stepFrame(0, neutral);
  const currency1 = p.data.currency;
  const lootEvent = evLoot.some((e) => e.type === 'currency-gained');
  const heal0 = p.data.hp;
  w.healPlayer(5);
  const heal1 = p.data.hp;
  const speed0 = p.data.speed;
  w.applyUpgradeChoice('speed', 1);
  const speed1 = p.data.speed;

  return {
    paused: gs.paused,
    b1: { before, after, removed },
    b2: { beforeVel, afterVel, enemyBefore, enemyAfter, laserOk },
    b3: { coreCount, viewIsCore, coreAfterSetter, idsUnique, viewMutatedCore },
    b4: { q1, q2, pendingDeath, deathCount, hurtCount, blockedHurt, qInv, pendingInv },
    bossRadius, bossDead,
    h9: helperErrors,
    h10: { flash, flashAfterHit: flash },
    b9: { tickBefore, tickAfter, coreBefore, coreAfterSpawn },
    target: { targetHp0, setterError, targetAfterSetterAttempt, enemySeesCore },
    liveRefs: { playerHp0, playerSeesLive },
    lootBypass: { currency0, currency1, lootEvent, heal0, heal1, speed0, speed1 },
  };
});
console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
await browser.close();
