// Independent C2 round-2 rendered probe (normal RAF path only; no test-only stepping).
// Fixtures declared: one spawned enemy per kind, one boss in the current room, boss phase/
// attackTimer set to exercise the real laser, enqueueTargetHp(boss,1) before the kill shot,
// and fixed seed via scene.start patch. No HP/coordinate/i-frame writes on the player.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5288/';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-round2-final/evidence-rendered';
mkdirSync(OUT, { recursive: true });
const GAME_W = 1280, GAME_H = 720;
const report = { meta: { url: BASE, normalFramePath: true, fixtures: ['fixed seed', 'spawn enemies/boss', 'boss phase/attackTimer', 'enqueueTargetHp(boss,1)'], startedUtc: new Date().toISOString() }, steps: [], errors: [] };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));

const box = () => page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
async function clickLogical(lx, ly) { const b = await box(); await page.mouse.click(b.x + (lx * b.w) / GAME_W, b.y + (ly * b.h) / GAME_H); }
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
  const w = gs.world;
  return {
    active, tick: w.sim.tick, paused: gs.paused,
    player: { x: w.player.wx, y: w.player.wy, hp: w.player.data.hp, xp: w.player.data.xp, level: w.player.data.level, currency: w.player.data.currency },
    targets: w.sim.targets.map((t) => ({ id: t.id, kind: t.kind, x: t.x, y: t.y, hp: t.hp, isBoss: t.isBoss })),
    drones: w.sim.drones.map((d) => ({ id: d.id, x: d.x, y: d.y, hp: d.hp })),
    enemies: w.enemies.map((e) => ({ id: e._id, kind: e.data.kind, x: e.wx, y: e.wy, hp: e._hp, hitFlash: e.data.hitFlash })),
    projectiles: w.sim.projectiles.map((p) => ({ id: p.id, side: p.side, kind: p.kind, x: p.pos.x, y: p.pos.y })),
    boss: w.boss ? { id: w.boss._id, x: w.boss.wx, y: w.boss.wy, hp: w.boss._hp, phase: w.boss.phase, hitFlash: w.boss.hitFlash } : null,
    damageDealt: gs.damageDealt, levelUp: active.includes('LevelUpScene')
  };
});
const step = (name, detail) => report.steps.push({ name, detail });
const clearLevelUp = async () => {
  for (let i = 0; i < 5; i++) {
    const s = await snap();
    if (!s.levelUp) break;
    await page.keyboard.press('1');
    await page.waitForTimeout(350);
  }
};

await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await page.evaluate(() => {
  const g = window.__game, menu = g.scene.getScene('MainMenuScene');
  const orig = menu.scene.start.bind(menu.scene);
  menu.scene.start = (key, data) => key === 'GameScene' ? orig(key, { ...(data || {}), seed: 424242 }) : orig(key, data);
});
await clickLogical(640, 340);
await page.waitForTimeout(1500);
report.start = await snap();
step('start', report.start);

// --- normal RAF cadence ---
const cad = [];
for (let i = 0; i < 6; i++) { const s = await snap(); cad.push(s.tick); await page.waitForTimeout(100); }
const deltas = cad.slice(1).map((t, i) => t - cad[i]);
report.raf = { deltas, pass: deltas.filter((d) => d > 0).length >= 4 && Math.max(...deltas) <= 15 };
step('raf-cadence', report.raf);

// --- pause / inventory / level-up: real time must not be caught up ---
{
  const t0 = (await snap()).tick;
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const p0 = await snap(); await page.waitForTimeout(900); const p1 = await snap();
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  const r1 = await snap();
  report.pause = { paused: p0.paused, frozenDelta: p1.tick - p0.tick, resumeDelta: r1.tick - p1.tick, pass: p0.paused && p1.tick === p0.tick && r1.tick - p1.tick < 60 && r1.tick - p1.tick > 0 };
  step('pause', report.pause);
  const i0 = r1.tick;
  await page.keyboard.press('KeyI'); await page.waitForTimeout(300);
  const inv0 = await snap(); await page.waitForTimeout(900); const inv1 = await snap();
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  const inv2 = await snap();
  report.inventory = { opened: inv0.active.includes('PauseScene'), frozenDelta: inv1.tick - inv0.tick, resumeDelta: inv2.tick - inv1.tick, pass: inv0.active.includes('PauseScene') && inv1.tick === inv0.tick && inv2.tick - inv1.tick < 60 };
  step('inventory', report.inventory);
  await page.evaluate(() => window.__game.scene.getScene('GameScene').world.addPlayerXp(1000));
  await page.waitForTimeout(700);
  const lv0 = await snap(); await page.waitForTimeout(900); const lv1 = await snap();
  for (let i = 0; i < 10; i++) {
    const cur = await snap();
    if (!cur.levelUp) break;
    await page.keyboard.press('1');
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(700);
  const lv2 = await snap();
  report.levelup = { opened: lv0.levelUp, frozenDelta: lv1.tick - lv0.tick, resumeDelta: lv2.tick - lv1.tick, closed: !lv2.levelUp, pass: lv0.levelUp && lv1.tick === lv0.tick && !lv2.levelUp && lv2.tick - lv1.tick > 0 && lv2.tick - lv1.tick < 80 };
  step('levelup', report.levelup);
}

// --- non-drone kinds: real mouse fire, hit/death/reward/hit flash ---
report.kinds = {};
for (const kind of ['hunter', 'stalker', 'sentinel', 'drone']) {
  await clearLevelUp();
  const setup = await page.evaluate((kind) => {
    const g = window.__game, gs = g.scene.getScene('GameScene');
    const w = gs.world, pl = w.player, room = w.currentRoom();
    let pos = null;
    for (const d of [2, 2.5, 3, -2, -2.5, -3]) {
      const x = pl.wx + d, y = pl.wy;
      if (w.isWalkable(x, y, 0.5)) { pos = { x, y }; break; }
    }
    if (!pos) pos = { x: pl.wx, y: pl.wy + 2 };
    const e = w.spawnEnemy(kind, pos.x, pos.y, room?.id ?? 0, 1);
    return { id: e._id, kind, pos, hp: e._hp, target: w.sim.targets.find((t) => t.id === e._id) ? { x: w.sim.targets.find((t) => t.id === e._id).x, y: w.sim.targets.find((t) => t.id === e._id).y } : null, xp: pl.data.xp, currency: pl.data.currency, level: pl.data.level };
  }, kind);
  await page.waitForTimeout(150);
  const before = await snap();
  const aim = await gridToCss(setup.pos.x, setup.pos.y);
  await page.mouse.move(Math.round(aim.x), Math.round(aim.y));
  await page.mouse.down();
  let maxFlash = 0;
  const frames = kind === 'sentinel' ? 28 : 12;
  for (let i = 0; i < frames; i++) {
    await page.waitForTimeout(120);
    const s = await snap();
    const e = s.enemies.find((x) => x.id === setup.id);
    if (e?.hitFlash > maxFlash) maxFlash = e.hitFlash;
    if (s.levelUp) break;
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await snap();
  await clearLevelUp();
  const e = after.enemies.find((x) => x.id === setup.id);
  const t = after.targets.find((x) => x.id === setup.id);
  const killed = !e && !t;
  report.kinds[kind] = {
    setup, hitFlash: maxFlash, killed,
    hpAfter: e ? e.hp : 0, targetAfter: t ? t.hp : 0,
    xpGain: after.player.xp - before.player.xp, currencyGain: after.player.currency - before.player.currency,
    levelGain: after.player.level - before.player.level,
    damageDealt: after.damageDealt,
    pass: killed && after.player.xp >= before.player.xp
  };
}
step('kinds', report.kinds);
await page.screenshot({ path: path.join(OUT, '01-kinds.png') });

// --- read-only setter migration + old enemy movement/attack ---
{
  const setup = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene');
    const w = gs.world, pl = w.player, room = w.currentRoom();
    let pos = null;
    for (const d of [3, 2.5, 3.5, -3]) { const x = pl.wx + d, y = pl.wy; if (w.isWalkable(x, y, 0.5)) { pos = { x, y }; break; } }
    if (!pos) pos = { x: pl.wx, y: pl.wy + 3 };
    const e = w.spawnEnemy('stalker', pos.x, pos.y, room?.id ?? 0, 1);
    const t = w.sim.targets.find((x) => x.id === e._id);
    let threw = false;
    const coreX0 = t.x, coreHp0 = t.hp;
    try { e.wx = t.x + 100; e._hp = 1; } catch { threw = true; }
    return { id: e._id, coreX: coreX0, coreHp: coreHp0, coreXAfterAssign: t.x, coreHpAfterAssign: t.hp, enemyX: e.wx, enemyHp: e._hp, threw, hp: pl.data.hp };
  });
  await page.waitForTimeout(500);
  const s1 = await snap();
  await page.waitForTimeout(1800);
  const s2 = await snap();
  const t1 = s1.targets.find((x) => x.id === setup.id);
  const t2 = s2.targets.find((x) => x.id === setup.id);
  report.setter = {
    setup, coreUnchanged: setup.coreXAfterAssign === setup.coreX && setup.coreHpAfterAssign === setup.coreHp,
    enemyGetterReadOnly: setup.enemyX === setup.coreX && setup.enemyHp === setup.coreHp,
    moved: !!(t1 && t2 && (Math.abs(t2.x - t1.x) > 1e-6 || Math.abs(t2.y - t1.y) > 1e-6)),
    playerHpBefore: s1.player.hp, playerHpAfter: s2.player.hp,
    attacked: s2.player.hp < s1.player.hp
  };
  step('setter-migration', report.setter);
}

// --- Boss: hit/death, laser + simultaneous player projectile, ID uniqueness ---
{
  const setup = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene');
    const w = gs.world, room = w.currentRoom();
    w.spawnBoss(w.map.rooms[room.id]);
    const b = w.boss;
    return { id: b._id, x: w.sim.targets.find((t) => t.id === b._id)?.x ?? b.wx, y: w.sim.targets.find((t) => t.id === b._id)?.y ?? b.wy, hp: b._hp };
  });
  await page.waitForTimeout(300);
  const aim = await gridToCss(setup.x, setup.y);
  await page.mouse.move(Math.round(aim.x), Math.round(aim.y));
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const hit = await snap();
  const bossHit = hit.boss;
  // Force phase 2 and a laser frame; then fire one player shot and sample both sides.
  await page.waitForTimeout(600); // let weapon cooldown clear after the boss-hit burst
  await page.evaluate(() => { const g = window.__game, gs = g.scene.getScene('GameScene'); gs.world.boss.phase = 2; gs.world.boss.attackTimer = 0; gs.world.boss.stateTimer = 100; });
  await page.waitForTimeout(140); // laser fires on the next normal frames; enemy projectiles live 2.5s
  const away = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene');
    const w = gs.world, pl = w.player, b = w.boss;
    const dx = pl.wx - b.wx, dy = pl.wy - b.wy, d = Math.hypot(dx, dy) || 1;
    return { x: pl.wx + (dx / d) * 3, y: pl.wy + (dy / d) * 3 };
  });
  const awayCss = await gridToCss(away.x, away.y);
  await page.mouse.move(Math.round(awayCss.x), Math.round(awayCss.y));
  await page.mouse.down();
  let both = null;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(25);
    const s = await snap();
    const p = s.projectiles.filter((x) => x.side === 'player').length;
    const e = s.projectiles.filter((x) => x.side === 'enemy').length;
    if (p > 0 && e > 0) { both = s; break; }
    both = s;
  }
  await page.mouse.up();
  const bothSample = both;
  const sides = { player: bothSample.projectiles.filter((p) => p.side === 'player').length, enemy: bothSample.projectiles.filter((p) => p.side === 'enemy').length };
  const ids = bothSample.projectiles.map((p) => p.id);
  // Kill via legal core command (declared fixture), then real aimed shots at the moving boss.
  await page.evaluate((id) => {
    const g = window.__game, gs = g.scene.getScene('GameScene');
    gs.world.boss.phase = 1; gs.world.boss.attackTimer = 100; gs.world.boss.stateTimer = 100;
    gs.world.enqueueTargetHp(id, 1);
  }, setup.id);
  await page.waitForTimeout(120);
  await page.mouse.down();
  for (let i = 0; i < 24; i++) {
    const cur = await snap();
    if (!cur.boss) break;
    const b = cur.boss;
    const p = await gridToCss(b.x, b.y);
    await page.mouse.move(Math.round(p.x), Math.round(p.y));
    await page.waitForTimeout(100);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const dead = await snap();
  report.boss = {
    setup, hit: { hp: bossHit?.hp, hitFlash: bossHit?.hitFlash, hpDropped: !!bossHit && bossHit.hp < setup.hp },
    laser: { sides, idsUnique: new Set(ids).size === ids.length, playerProjectileAliveWithLaser: sides.player > 0 && sides.enemy > 0 },
    death: { bossGone: !dead.boss, active: dead.active, playerWon: dead.active.includes('GameOverScene') || !dead.boss }
  };
  step('boss', report.boss);
  await page.screenshot({ path: path.join(OUT, '02-boss.png') });
}

report.meta.endedUtc = new Date().toISOString();
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-round2-final/rendered-authority-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ meta: report.meta, raf: report.raf, pause: report.pause, inventory: report.inventory, levelup: report.levelup, kinds: report.kinds, setter: report.setter, boss: report.boss, errors: report.errors }, null, 2));
await browser.close();
