// Dev-only room-transition probe: onEnterRoom spawn directness, resource loot queue,
// portal placement, cross-room progression and a small enemy-kind distribution sample.
// Fixture declared: dev-only simFixture live-core read + enqueueTeleport transitions.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5289/';
const report = { meta: { url: BASE, target: '6ac60b2', devOnly: 'simFixture + enqueueTeleport', startedUtc: new Date().toISOString() }, checks: [], findings: [], flow: {}, errors: [] };
const check = (n, ok, d) => { report.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const finding = (n, d) => report.findings.push({ n, d });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await page.evaluate(() => { const g = window.__game, m = g.scene.getScene('MainMenuScene'); const o = m.scene.start.bind(m.scene); m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...(d || {}), seed: 424242 }) : o(k, d); });
const b = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(b.x + (640 * b.w) / 1280, b.y + (340 * b.h) / 720);
await page.waitForTimeout(1400);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const result = await page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const step = () => w.stepFrame(1000 / 60 + 1e-6, neutral);
  const live = () => w.simFixture;
  const transitions = [];
  for (let t = 0; t < 4; t++) {
    const cur = w.currentRoom();
    if (!cur) break;
    const connected = (cur.connectedTo || w.map.rooms[cur.id].connectedTo || []);
    const nb = connected.find((n) => n !== cur.id);
    if (nb === undefined || nb === null) break;
    const dest = w.map.rooms[nb];
    if (!dest) break;
    // walkable landing in destination room
    let landing = null;
    for (const row of w.map.tiles) for (const tile of row) {
      if (tile.x < dest.gx || tile.x >= dest.gx + dest.w || tile.y < dest.gy || tile.y >= dest.gy + dest.h) continue;
      if (w.isWalkable(tile.x + 0.5, tile.y + 0.5, 0.5)) { landing = { x: tile.x + 0.5, y: tile.y + 0.5 }; break; }
      if (landing) break;
    }
    if (!landing) landing = { x: dest.gx + dest.w / 2, y: dest.gy + dest.h / 2 };
    const before = live();
    const beforeCounts = { targets: before.targets.length, drones: before.drones.length, pending: before.pendingCommands.length, tick: before.tick, room: cur.id };
    w.enqueueTeleport(landing.x, landing.y, false);
    const ev1 = step().map((e) => e.type);
    const mid = live();
    const midCounts = { targets: mid.targets.length, drones: mid.drones.length, pending: mid.pendingCommands.length, tick: mid.tick, room: w.currentRoom()?.id ?? null, kinds: [...mid.targets.map((x) => x.kind), ...mid.drones.map(() => 'drone')], pendingKinds: mid.pendingCommands.map((c) => c.type) };
    const ev2 = step().map((e) => e.type);
    const after = live();
    transitions.push({ from: cur.id, to: nb, landing, before: beforeCounts, afterFirstTick: midCounts, ev1, ev2, afterSecond: { targets: after.targets.length, drones: after.drones.length, pending: after.pendingCommands.length, tick: after.tick }, portal: w.portal ? { targetRoom: w.portal.targetRoom, wx: w.portal.wx, wy: w.portal.wy } : null });
  }
  const roomsSeen = [...new Set(transitions.map((t) => t.afterFirstTick.room))];
  const kindsSeen = [...new Set(transitions.flatMap((t) => t.afterFirstTick.kinds))];
  return { transitions, roomsSeen, kindsSeen };
});
report.flow = result;
check('room-transitions-happened', result.transitions.length >= 2, result.transitions.length);
const directSpawn = result.transitions.some((t) => (t.afterFirstTick.targets + t.afterFirstTick.drones) > (t.before.targets + t.before.drones) && !t.afterFirstTick.pendingKinds.includes('spawn-enemy'));
if (directSpawn) {
  finding('on-enter-room-direct-spawn', { note: 'entering a room creates core targets/drones directly in spawnForRoom (registerTarget/registerDrone) without a pending spawn command; source: World.spawnForRoom → spawnEnemy', transitions: result.transitions });
} else {
  check('room-spawn-queued', false, result.transitions);
}
const queuedLoot = result.transitions.some((t) => t.afterFirstTick.pendingKinds.includes('spawn-loot'));
report.flow.queuedResourceLoot = queuedLoot;
check('cross-room-no-deadlock', result.transitions.every((t) => t.afterSecond.tick > t.before.tick) && result.roomsSeen.length >= 2, { roomsSeen: result.roomsSeen, transitions: result.transitions.map((t) => ({ from: t.from, to: t.to, tick: t.before.tick, after: t.afterSecond.tick })) });
check('portal-placed-after-enter', result.transitions.some((t) => t.portal && typeof t.portal.targetRoom === 'number'), result.transitions.map((t) => t.portal));
check('enemy-kind-sample', result.kindsSeen.length >= 1, result.kindsSeen);
check('no-console-error', report.errors.length === 0, report.errors);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-round3-final/room-transition-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
