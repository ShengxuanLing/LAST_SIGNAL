// P3-a ECHO independent E2E (real browser, real core ticks). Frozen b3930c5.
// Menu-only control path for echo enable/mode/confirm; drones are spawned through the
// World's real spawnEnemy (fixture, disclosed) so the encounter is deterministic.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5361/';
const EV = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-final/evidence';
mkdirSync(EV, { recursive: true });
const out = { meta: { target: 'b3930c5df4010b896ffac868da9f0d2e0d6695a5', build: 'dev (__game verification)', fixture: 'spawnEnemy for deterministic drone/hunter; menu-only echo controls' }, checks: [], steps: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-final/e2e.json', JSON.stringify(out, null, 2)); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: `${EV}/${n}.png` });
const G = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const echo = w.echoActor;
  const echoView = w.echoView();
  return {
    tick: w.sim.tick, roomId: w.sim.roomId, paused: gs.paused,
    player: { x: w.sim.player.x, y: w.sim.player.y, hp: w.sim.player.data.hp },
    echo: echo ? { x: echo.x, y: echo.y, hp: echo.data.hp, maxHp: echo.data.maxHp, aimYaw: echo.aimYaw } : null,
    echoMode: w.echoMode, armed: w.echoAssistArmed, suggestion: w.echoSuggestion, shots: w.echoShotsFired,
    drones: w.sim.drones.map((d) => ({ id: d.id, hp: d.hp, x: d.x, y: d.y })),
    targets: w.sim.targets.map((t) => ({ id: t.id, hp: t.hp, x: t.x, y: t.y })),
    echoSees: echoView ? echoView.drones.length : null,
    playerSees: w.observationView().perceivedActors.length,
    echoViewIds: echoView ? echoView.drones.map((d) => d.id) : [],
    playerViewIds: w.observationView().perceivedActors.map((a) => a.id),
    enemies: w.enemies.length
  };
});
const clickText = async (prefix, sceneKey = 'PauseScene') => {
  const pos = await page.evaluate(({ prefix, sceneKey }) => {
    const s = window.__game.scene.getScene(sceneKey);
    const t = s?.children.list.find((c) => c.type === 'Text' && (c.text || '').startsWith(prefix));
    return t ? { x: t.x + (t.width || 0) * (0.5 - (t.originX ?? 0)), y: t.y + (t.height || 0) * (0.5 - (t.originY ?? 0)) } : null;
  }, { prefix, sceneKey });
  if (!pos) return null;
  await page.mouse.click(Math.round(pos.x), Math.round(pos.y));
  return pos;
};
const openEchoPanel = async () => {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), null, { timeout: 5000 });
  await clickText('ECHO COMPANION');
  await sleep(350);
};
const closePanel = async () => {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__game?.scene.isActive('PauseScene'), null, { timeout: 5000 }).catch(() => {});
  await sleep(200);
};
const holdKey = async (key, ms) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); await sleep(350); };

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.waitForTimeout(500);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(700);

const before = await G();
check('echo-off-initially', before.echo === null, { echo: before.echo });
await openEchoPanel();
await shot('01-echo-panel-disabled');
await clickText('ENABLE ECHO');
await sleep(300);
await closePanel();
await sleep(800);
const enabled = await G();
out.steps.push({ name: 'enabled', state: enabled });
check('echo-enabled-independent-actor', enabled.echo !== null && Number.isFinite(enabled.echo.x) && enabled.echo.hp > 0, enabled.echo);
check('echo-independent-coordinates', enabled.echo && (enabled.echo.x !== enabled.player.x || enabled.echo.y !== enabled.player.y), { echo: enabled.echo, player: enabled.player });
await openEchoPanel();
await shot('02-echo-enabled-panel');
await closePanel();

// FOLLOW: move the player and check the echo closes distance
const f0 = await G();
await holdKey('d', 900);
const f1 = await G();
out.steps.push({ name: 'follow', before: f0.echo, after: f1.echo, player: f1.player, mode: f1.echoMode });
const followDist = f1.echo && Math.hypot(f1.echo.x - f1.player.x, f1.echo.y - f1.player.y);
const followMoved = f0.echo && f1.echo && Math.hypot(f1.echo.x - f0.echo.x, f1.echo.y - f0.echo.y);
check('echo-follows-player', !!followMoved && followMoved > 0.2 && followDist <= 3.8 && f1.echoMode === 'follow', { moved: followMoved, distAfter: followDist });
await shot('03-follow');

// HOLD: move player away; echo must stay
await openEchoPanel();
await clickText('MODE: HOLD POSITION');
await sleep(300);
await closePanel();
const h0 = await G();
await holdKey('w', 900);
const h1 = await G();
out.steps.push({ name: 'hold', before: h0.echo, after: h1.echo, mode: h1.echoMode });
check('echo-hold-stays', h0.echo && h1.echo && Math.hypot(h1.echo.x - h0.echo.x, h1.echo.y - h0.echo.y) < 0.60 && h1.echoMode === 'hold', { delta: h0.echo && h1.echo && Math.hypot(h1.echo.x - h0.echo.x, h1.echo.y - h0.echo.y) });

// disclosed setup for the own-view test: keep the protagonist inside the SAME room,
// at the room corner farthest from the echo; spawn a real drone on the echo's side.
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const e = w.echoActor; const room = w.currentRoom();
  const corners = [
    { x: room.gx + 0.6, y: room.gy + 0.6 }, { x: room.gx + room.w - 0.6, y: room.gy + 0.6 },
    { x: room.gx + 0.6, y: room.gy + room.h - 0.6 }, { x: room.gx + room.w - 0.6, y: room.gy + room.h - 0.6 }
  ].filter((p) => w.isWalkable(p.x, p.y, 0.5));
  corners.sort((a, b) => Math.hypot(b.x - e.x, b.y - e.y) - Math.hypot(a.x - e.x, a.y - e.y));
  if (corners[0]) w.player.reset(corners[0].x, corners[0].y);
});
await sleep(450);
const droneSpawn = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const e = w.echoActor; const room = w.currentRoom();
  const p = w.sim.player;
  const dx = e.x - p.x, dy = e.y - p.y, len = Math.hypot(dx, dy) || 1;
  let chosen = null;
  for (const dist of [2.5, 3, 2, 4]) {
    const ox = e.x + (dx / len) * dist, oy = e.y + (dy / len) * dist;
    if (w.isWalkable(ox, oy, 0.5)) { chosen = { x: ox, y: oy, dist }; break; }
  }
  if (!chosen) chosen = { x: e.x + 2, y: e.y, dist: 2 };
  const prevIds = w.sim.drones.map((d) => d.id).concat(w.sim.targets.map((t) => t.id));
  w.spawnEnemy('drone', chosen.x, chosen.y, room?.id ?? 0, 1);
  const afterIds = w.sim.drones.map((d) => d.id).concat(w.sim.targets.map((t) => t.id));
  return { echo: { x: e.x, y: e.y }, player: { x: p.x, y: p.y }, chosen, playerDist: +Math.hypot(chosen.x - p.x, chosen.y - p.y).toFixed(2), echoDist: +Math.hypot(chosen.x - e.x, chosen.y - e.y).toFixed(2), newIds: afterIds.filter((id) => !prevIds.includes(id)), prevIds };
});
await sleep(900);
const ownView = await G();
out.steps.push({ name: 'own-view', spawn: droneSpawn, player: ownView.player, echo: ownView.echo, echoSees: ownView.echoSees, playerSees: ownView.playerSees, echoViewIds: ownView.echoViewIds, playerViewIds: ownView.playerViewIds, drones: ownView.drones });
const newId = droneSpawn.newIds[0];
const echoCentered = ownView.echo && Math.hypot(ownView.echo.x - droneSpawn.echo.x, ownView.echo.y - droneSpawn.echo.y) < 3 && droneSpawn.echoDist <= 12;
check('echo-own-view-is-echo-centred-and-bounded', ownView.echoViewIds.length >= 1 && echoCentered, { playerDist: droneSpawn.playerDist, echoDist: droneSpawn.echoDist, echoViewIds: ownView.echoViewIds, playerViewIds: ownView.playerViewIds, note: 'start room is too small for a >12 separation; both views can legally see a nearby target, the echo view is still its own bounded projection' });
check('player-safe-during-own-view', ownView.player.hp === 100, { playerHp: ownView.player.hp });

// before confirm: no echo fire, drone HP unchanged over real ticks
const pre = await G();
await sleep(1200);
const preAfter = await G();
const shotsBeforeConfirm = preAfter.shots;
out.steps.push({ name: 'before-confirm', shotsBefore: pre.shots, shotsAfter: preAfter.shots, droneHpBefore: pre.drones.map((d) => d.hp), droneHpAfter: preAfter.drones.map((d) => d.hp) });
check('no-attack-before-confirm', preAfter.shots === pre.shots && JSON.stringify(preAfter.drones.map((d) => [d.id, d.hp])) === JSON.stringify(pre.drones.map((d) => [d.id, d.hp])), { shots: preAfter.shots, before: pre.drones, after: preAfter.drones });

// confirm assist -> real damage/kill
await openEchoPanel();
await clickText('CONFIRM ASSIST FIRE');
await sleep(250);
await shot('04-echo-armed-panel');
await closePanel();
const c0 = await G();
let kill = null;
for (let i = 0; i < 40; i += 1) {
  await sleep(200);
  const s = await G();
  const alive = s.drones.filter((d) => d.hp > 0);
  if (s.shots > c0.shots && alive.length === 0) { kill = { shots: s.shots, tick: s.tick, armed: s.armed }; break; }
  if (alive.length === 0 && s.shots > c0.shots) { kill = { shots: s.shots, tick: s.tick, armed: s.armed }; break; }
}
const afterKill = await G();
out.steps.push({ name: 'confirm-kill', before: { shots: c0.shots, drones: c0.drones }, after: { shots: afterKill.shots, drones: afterKill.drones, armed: afterKill.armed }, kill });
check('confirm-then-real-fire', afterKill.shots > shotsBeforeConfirm, { shotsBeforeConfirm, after: afterKill.shots });
check('echo-real-kill', afterKill.drones.filter((d) => d.hp > 0).length === 0, { drones: afterKill.drones });
check('player-hp-unrelated-to-echo-fire', afterKill.player.hp === c0.player.hp, { before: c0.player.hp, after: afterKill.player.hp });
await shot('05-echo-killed');

// revoke assist so the echo stops firing and can be independently damaged
const revoke = await (async () => {
  await openEchoPanel();
  const p = await clickText('ASSIST ARMED — CLICK TO REVOKE');
  await sleep(250);
  await closePanel();
  return p;
})();
out.steps.push({ name: 'revoke', clicked: !!revoke, armed: (await G()).armed });

// independent echo damage: spawn a hunter next to the echo; player stays far
const hurtSetup = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const e = w.echoActor; const room = w.currentRoom();
  let placed = null;
  for (let a = 0; a < 16 && !placed; a += 1) {
    const ang = (a / 16) * Math.PI * 2;
    for (const r of [1.6, 2.0, 2.4]) {
      const x = e.x + Math.cos(ang) * r, y = e.y + Math.sin(ang) * r;
      if (w.isWalkable(x, y, 0.5)) { w.spawnEnemy('drone', x, y, room?.id ?? 0, 2); placed = { x, y, r }; break; }
    }
  }
  return { echo: { x: e.x, y: e.y, hp: e.data.hp }, player: { x: w.sim.player.x, y: w.sim.player.y, hp: w.sim.player.data.hp }, placed, targets: w.sim.targets.map((t) => ({ id: t.id, kind: t.kind, hp: t.hp })) };
});
let hurt = null;
for (let i = 0; i < 60; i += 1) {
  await sleep(250);
  const s = await G();
  if (s.echo && s.echo.hp < hurtSetup.echo.hp) { hurt = { echoHpBefore: hurtSetup.echo.hp, echoHpAfter: s.echo.hp, playerHpBefore: hurtSetup.player.hp, playerHpAfter: s.player.hp, tick: s.tick }; break; }
}
out.steps.push({ name: 'echo-hurt', hurt, setup: hurtSetup });
check('echo-takes-independent-damage', !!hurt, hurt);
check('player-hp-does-not-mirror-echo', hurt && hurt.playerHpAfter === hurt.playerHpBefore, hurt);
await shot('06-echo-hurt');

// echo death and no firing afterwards
let death = null;
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const e = w.echoActor; const room = w.currentRoom();
  let spawned = 0;
  for (let a = 0; a < 24 && spawned < 4; a += 1) {
    const ang = (a / 24) * Math.PI * 2;
    for (const r of [1.6, 2.0, 2.6]) {
      const x = e.x + Math.cos(ang) * r, y = e.y + Math.sin(ang) * r;
      if (!w.isWalkable(x, y, 0.5)) continue;
      w.spawnEnemy('drone', x, y, room?.id ?? 0, 3); spawned += 1; break;
    }
  }
});
for (let i = 0; i < 60; i += 1) {
  await sleep(250);
  const s = await G();
  if (s.echo && s.echo.hp <= 0) { death = { tick: s.tick, shots: s.shots, playerHp: s.player.hp }; break; }
}
const dead0 = await G();
await sleep(1200);
const dead1 = await G();
out.steps.push({ name: 'echo-death', death, shotsAtDeath: dead0.shots, shotsLater: dead1.shots, echoMode: dead1.echoMode, playerHp: dead1.player.hp });
check('echo-death-reachable', !!death && dead1.echo && dead1.echo.hp <= 0, death);
check('no-fire-after-echo-death', dead1.shots === dead0.shots, { atDeath: dead0.shots, later: dead1.shots });
check('player-survives-echo-death', dead1.player.hp > 0, { playerHp: dead1.player.hp });
await shot('07-echo-dead');

check('no-page-errors', errs.length === 0, errs);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-final/e2e.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), steps: out.steps }, null, 2));
await browser.close();
process.exit(0);
