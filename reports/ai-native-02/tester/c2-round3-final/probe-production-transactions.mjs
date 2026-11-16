// Independent C2 round-3 production probe: frozen snapshot / dev-only fixture gate,
// paused queued writes + stepFrame(0) no-op + one-tick commit,
// visible loot not auto-settled + real movement pickup, kill-loot event order.
// Fixtures declared: fixed seed, explicit enqueue* commands, manual stepFrame while paused,
// enqueueTeleport for pickup setup. No public Owner setter used for loot pickup.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5290/';
const report = { meta: { url: BASE, target: '6ac60b2', production: true, fixtures: ['fixed seed', 'explicit enqueue* commands', 'manual stepFrame while paused', 'enqueueTeleport pickup setup/movement'] }, checks: [], findings: [], flows: {}, errors: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) process.exitCode = 1; };
const finding = (name, detail) => report.findings.push({ name, detail });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
async function boot() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
  await page.waitForTimeout(1300);
  await page.evaluate(() => {
    const g = window.__game, menu = g.scene.getScene('MainMenuScene');
    const orig = menu.scene.start.bind(menu.scene);
    menu.scene.start = (key, data) => key === 'GameScene' ? orig(key, { ...(data || {}), seed: 424242 }) : orig(key, data);
  });
  const b = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(b.x + (640 * b.w) / 1280, b.y + (340 * b.h) / 720);
  await page.waitForTimeout(1400);
  return { page, errors };
}
const snap = (page) => page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world, s = w.sim;
  return {
    tick: s.tick, paused: gs.paused, hp: s.player.data.hp, currency: s.player.data.currency,
    xp: s.player.data.xp, level: s.player.data.level, upgrades: s.player.data.upgrades.length,
    speed: s.player.data.speed, px: s.player.x, py: s.player.y,
    pending: s.pendingCommands.length, loot: s.loot.length, lootViews: w.loot.length,
    drones: s.drones.length, targets: s.targets.length, projectiles: s.projectiles.length,
    enemies: w.enemies.length, frozen: Object.isFrozen(s), nestedFrozen: Object.isFrozen(s.player.data) && Object.isFrozen(s.pendingCommands)
  };
});
const NEUTRAL = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

// ---------- A: frozen snapshot / dev-only fixture gate / public Owner setter ----------
{
  const { page, errors } = await boot();
  report.errors.push(...errors);
  const gate = await page.evaluate(() => {
    const g = window.__game, w = g.scene.getScene('GameScene').world;
    const s = w.sim;
    let nested = null, nestedErr = null;
    try { s.player.data.hp = 1; s.pendingCommands.push({ type: 'add-currency', amount: 999 }); if (s.loot.length) s.loot[0].x = 999; nested = { hp: s.player.data.hp, pending: s.pendingCommands.length, loot: s.loot.length }; }
    catch (e) { nestedErr = String(e && e.message ? e.message : e); }
    const fixture = {};
    try { fixture.simFixture = w.simFixture ? 'accessible' : 'missing'; } catch (e) { fixture.simFixture = String(e && e.message ? e.message : e); }
    try { fixture.playerDataFixture = w.playerDataFixture ? 'accessible' : 'missing'; } catch (e) { fixture.playerDataFixture = String(e && e.message ? e.message : e); }
    const before = { hp: w.sim.player.data.hp, x: w.sim.player.x };
    const cloned = JSON.parse(JSON.stringify(w.sim.player.data));
    cloned.hp = Math.max(1, cloned.hp - 5);
    let ownerErr = null;
    try { w.ownerSetPlayerData(cloned); w.ownerMovePlayer(w.sim.player.x + 1, w.sim.player.y); } catch (e) { ownerErr = String(e && e.message ? e.message : e); }
    const after = { hp: w.sim.player.data.hp, x: w.sim.player.x };
    return { frozen: Object.isFrozen(s), nestedFrozen: Object.isFrozen(s.player.data) && Object.isFrozen(s.pendingCommands), nested, nestedErr, fixture, before, after, ownerErr };
  });
  report.flows.gate = gate;
  check('sim-is-deep-frozen', gate.frozen === true && gate.nestedFrozen === true, gate);
  check('nested-writes-no-core-change', gate.nested === null || (gate.nested.hp !== 1 && gate.nested.pending === 0), gate);
  check('production-simFixture-dev-only', String(gate.fixture.simFixture).includes('dev/test only'), gate.fixture);
  check('production-playerDataFixture-dev-only', String(gate.fixture.playerDataFixture).includes('dev/test only'), gate.fixture);
  check('public-owner-setter-writes-core', gate.ownerErr === null && gate.after.hp !== gate.before.hp && gate.after.x !== gate.before.x, gate);
  finding('public-owner-setter-gate-defect', { note: 'ownerSetPlayerData/ownerMovePlayer are public (not dev-gated) and immediately mutate live core; tests/ai-native-world.spec.ts uses ownerSetPlayerData as a fixture. Production P1 gate cannot be used as proof that core writes are transaction-only.', gate });
  await page.close();
}

// ---------- B: paused queued writes, stepFrame(0), one-tick commit ----------
{
  const { page, errors } = await boot();
  report.errors.push(...errors);
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  const before = await snap(page);
  const queued = await page.evaluate((neutral) => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world, p = w.sim.player;
    const far = { x: p.x + 20, y: p.y };
    w.enqueueHeal(10); w.enqueueCurrency(50); w.enqueueAddXp(5); w.enqueueApplyUpgrade('speed', 1);
    w.enqueueSpawnLoot(far.x, far.y, 'currency', 'currency', 10);
    w.enqueueSpawnEnemy('hunter', far.x, far.y, w.currentRoom()?.id ?? 0, 1);
    w.spawnEnemyProjectile(0, p.x, p.y, 5, { x: 0, y: 0 });
    const s = w.sim;
    return { pending: s.pendingCommands.length, hp: s.player.data.hp, currency: s.player.data.currency, xp: s.player.data.xp, upgrades: s.player.data.upgrades.length, loot: s.loot.length, drones: s.drones.length, targets: s.targets.length, projectiles: s.projectiles.length, px: s.player.x, py: s.player.y, tick: s.tick };
  }, NEUTRAL);
  check('paused-no-mutation-after-enqueue', queued.hp === before.hp && queued.currency === before.currency && queued.xp === before.xp &&
    queued.upgrades === before.upgrades && queued.loot === before.loot && queued.drones === before.drones && queued.targets === before.targets &&
    queued.projectiles === before.projectiles && queued.px === before.px && queued.py === before.py && queued.tick === before.tick && queued.pending >= 6,
    { before, queued });
  const zero = await page.evaluate((neutral) => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    const events = w.stepFrame(0, neutral);
    const s = w.sim;
    return { eventTypes: events.map((e) => e.type), pending: s.pendingCommands.length, hp: s.player.data.hp, currency: s.player.data.currency, loot: s.loot.length, tick: s.tick };
  }, NEUTRAL);
  check('stepFrame-zero-dt-no-op', zero.eventTypes.length === 0 && zero.pending === queued.pending && zero.hp === before.hp && zero.currency === before.currency && zero.loot === before.loot && zero.tick === before.tick, zero);
  const one = await page.evaluate((neutral) => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    const events = w.stepFrame(1000 / 60 + 1e-6, neutral);
    const s = w.sim;
    return { eventTypes: [...new Set(events.map((e) => e.type))], pending: s.pendingCommands.length, hp: s.player.data.hp, currency: s.player.data.currency, xp: s.player.data.xp, upgrades: s.player.data.upgrades.length, loot: s.loot.length, lootViews: w.loot.length, projectiles: s.projectiles.length, enemies: w.enemies.length, tick: s.tick };
  }, NEUTRAL);
  const expected = ['player-healed', 'currency-gained', 'xp-gained', 'player-upgraded', 'loot-dropped', 'projectile-spawned'];
  check('one-tick-commit-events', expected.every((t) => one.eventTypes.includes(t)), one);
  check('one-tick-values-changed-once', one.currency !== before.currency && one.xp !== before.xp && one.upgrades !== before.upgrades && one.loot > before.loot && one.eventTypes.includes('projectile-spawned') && one.enemies > before.enemies && one.pending === 0 && one.tick === before.tick + 1, { before, one });
  const two = await page.evaluate((neutral) => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    const events = w.stepFrame(1000 / 60 + 1e-6, neutral);
    return { eventTypes: [...new Set(events.map((e) => e.type))], currency: w.sim.player.data.currency, hp: w.sim.player.data.hp };
  }, NEUTRAL);
  check('no-duplicate-reward-next-tick', !two.eventTypes.some((t) => ['player-healed', 'currency-gained', 'xp-gained', 'player-upgraded', 'loot-dropped'].includes(t)) && two.currency === one.currency && two.hp === one.hp, two);
  report.flows.queue = { before, queued, zero, one, two };
  await page.close();
}

// ---------- C: visible loot not standing on drop; real movement picks up ----------
{
  const { page, errors } = await boot();
  report.errors.push(...errors);
  // Lower HP via a queued core hit so a health pickup can be observed.
  const setup = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world, p = w.sim.player;
    w.enqueuePlayerHit(20, p.x + 1, p.y);
    const tiles = [];
    for (const row of w.map.tiles) for (const t of row) {
      if ((t.type === 'floor' || t.type === 'spawn') && w.isWalkable(t.x, t.y, 0.5)) tiles.push({ x: t.x, y: t.y });
    }
    const start = tiles[0];
    let loot = null;
    for (const t of tiles) {
      const d = Math.hypot(t.x - start.x, t.y - start.y);
      if (d > 90) { loot = t; break; }
    }
    let near = null;
    if (loot) {
      for (const t of tiles) {
        const d2 = Math.hypot(t.x - loot.x, t.y - loot.y);
        if (d2 > 0 && d2 < 10) { near = t; break; }
      }
    }
    return { start, loot, near, d: loot ? Math.hypot(loot.x - start.x, loot.y - start.y) : null, hp: p.data.hp, currency: p.data.currency, px: p.x, py: p.y };
  });
  check('pickup-fixture-found', !!setup.loot && !!setup.near && setup.d > 90, setup);
  await page.evaluate((setup) => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    w.enqueueTeleport(setup.start.x, setup.start.y, false);
    w.enqueueSpawnLoot(setup.loot.x, setup.loot.y, 'currency', 'currency', 10);
    w.enqueueSpawnLoot(setup.loot.x, setup.loot.y, 'health', 'health', 30);
  }, setup);
  await page.waitForTimeout(250);
  const beforePickup = await snap(page);
  check('loot-visible-not-collected', beforePickup.loot >= 2 && beforePickup.lootViews >= 2, beforePickup);
  check('unpicked-currency-hp-unchanged', beforePickup.currency === setup.currency && beforePickup.hp < 100, { beforePickup, setup });
  // Move via the legal core teleport command (owner transition path), then the normal
  // stepLoot magnet/pickup settles the drops. Fixture declared in report metadata.
  await page.evaluate((setup) => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    w.enqueueTeleport(setup.near.x, setup.near.y, false);
  }, setup);
  await page.waitForTimeout(400);
  const afterPickup = await snap(page);
  check('moving-collects-loot', (afterPickup.currency > beforePickup.currency || afterPickup.hp > beforePickup.hp) && afterPickup.loot < beforePickup.loot,
    { beforePickup, afterPickup, moved: Math.hypot(afterPickup.px - beforePickup.px, afterPickup.py - beforePickup.py) });
  report.flows.pickup = { setup, beforePickup, afterPickup };
  await page.close();
}

// ---------- D: real kill loot event order (manual normal stepFrame while paused) ----------
{
  const { page, errors } = await boot();
  report.errors.push(...errors);
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  const kill = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world, p = w.sim.player;
    const room = w.currentRoom();
    let pos = null;
    for (const d of [2, 2.5, 3, -2]) { const x = p.x + d, y = p.y; if (w.isWalkable(x, y, 0.5)) { pos = { x, y }; break; } }
    if (!pos) pos = { x: p.x, y: p.y + 2 };
    w.enqueueSpawnEnemy('hunter', pos.x, pos.y, room?.id ?? 0, 1);
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    w.stepFrame(1000 / 60 + 1e-6, neutral);
    const e = w.enemies[w.enemies.length - 1];
    w.enqueueTargetHp(e._id, 1);
    w.stepFrame(1000 / 60 + 1e-6, neutral);
    const fire = { move: { x: 0, y: 0 }, dash: false, fire: true, aim: pos, interact: false };
    const types = [], lootViews = [], ticks = [];
    for (let i = 0; i < 40; i++) {
      const ev = w.stepFrame(1000 / 60 + 1e-6, fire);
      const tt = ev.map((x) => x.type);
      ticks.push(tt);
      for (const x of ev) if (!types.includes(x.type)) types.push(x.type);
      lootViews.push(w.loot.length);
      if (types.includes('enemy-died') && types.includes('loot-collected')) break;
    }
    const s = w.sim;
    return { types, ticks, maxLootViews: Math.max(0, ...lootViews), currency: s.player.data.currency, xp: s.player.data.xp, loot: s.loot.length, pending: s.pendingCommands.length };
  });
  check('kill-emits-loot-dropped-and-collected', kill.types.includes('enemy-died') && kill.types.includes('loot-dropped') && kill.types.includes('loot-collected'), kill);
  check('kill-loot-dropped-event', kill.types.includes('loot-dropped'), kill);
  check('kill-reward-only-at-collection', kill.ticks.every((tt) => !tt.includes('currency-gained') || tt.includes('loot-collected')), { ticks: kill.ticks });
  check('kill-pending-consumed', kill.pending === 0, kill);
  report.flows.killLoot = kill;
  await page.close();
}

report.meta.endedUtc = new Date().toISOString();
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-round3-final/production-transactions-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
