// Independent P1 probe #2 — longer NO-fixture normal run:
//  * natural level-up overlay takeover using a real movement key (no addXp injection)
//  * wall-collision neighbourhood sampling (no coordinate/HP writes)
//  * natural death + real RETRY SAME SEED restart if death occurs
// No i-frame refresh, no forced hurt(), no state mutation via page.evaluate.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5282/';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-final/evidence-natural';
mkdirSync(OUT, { recursive: true });
const GAME_W = 1280, GAME_H = 720;

const report = {
  meta: { url: BASE, fixture: false, declaration: 'No invuln refresh, no HP/coordinate writes, no hurt/addXp/spawnEnemy injection; real UI input only', startedUtc: new Date().toISOString() },
  samples: [], steps: [], errors: [], screenshots: [],
  overlayTakeover: null, naturalDeath: null, restart: null, wall: null, invuln: null
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
const snap = () => page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene');
  const active = g.scene.getScenes(true).map((s) => s.sys.settings.key);
  if (!gs || !gs.world) return { active, world: null };
  const w = gs.world, pl = w.player, c = pl.control.snapshot(), x = pl.wx, y = pl.wy;
  const n = (dx, dy) => w.isWalkable(x + dx, y + dy, 0.5);
  return {
    active, world: true, seed: gs.seed, hp: pl.data.hp, invuln: pl.invuln,
    grid: { x, y }, walkable: w.isWalkable(x, y, 0.5),
    walls: { E: !n(1, 0), W: !n(-1, 0), S: !n(0, 1), N: !n(0, -1), SE: !n(1, 1), NW: !n(-1, -1), NE: !n(1, -1), SW: !n(-1, 1) },
    room: w.currentRoom() ? { id: w.currentRoom().id, kind: w.currentRoom().kind } : null,
    enemies: w.enemies.length, projectiles: w.projectiles.length,
    owner: c.owner, aiEnabled: c.aiEnabled, mode: c.mode, action: c.lastAiAction,
    actionCount: c.aiActionCount, takeoverCount: c.takeoverCount, takeoverReason: c.lastTakeoverReason,
    lastIntentOwner: pl.lastIntentOwner,
    intent: pl.lastIntent ? { move: { ...pl.lastIntent.move }, fire: pl.lastIntent.fire } : null,
    txtControl: gs.txtControl.text, txtAgentLink: gs.txtAgentLink.text,
    gameOver: active.includes('GameOverScene'), levelUp: active.includes('LevelUpScene')
  };
});
const step = (name, detail = {}) => report.steps.push({ name, tMs: Date.now() - t0, detail });
const t0 = Date.now();

await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await clickLogical(640, 340); // real NEW RUN
await page.waitForTimeout(1500);
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
await clickLogical(640, 540); await page.waitForTimeout(500);
await page.keyboard.press('Escape'); await page.waitForTimeout(700);
step('ai-enabled', await snap());
await page.screenshot({ path: path.join(OUT, '00-ai-enabled.png') }); report.screenshots.push('00-ai-enabled.png');

async function reenableAi(tag) {
  if ((await snap()).active.includes('LevelUpScene')) { await page.keyboard.press('1'); await page.waitForTimeout(450); }
  let s = await snap();
  if (s.active.includes('PauseScene')) await page.keyboard.press('Escape');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  const labels = await page.evaluate(() => {
    const ps = window.__game.scene.getScene('PauseScene');
    return ps && window.__game.scene.isActive('PauseScene') ? ps.children.list.filter((c) => c.type === 'Text').map((c) => c.text) : [];
  });
  if (labels.some((t) => t.includes('AI CONTROL: OFF'))) { await clickLogical(640, 540); await page.waitForTimeout(500); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  s = await snap();
  step(`${tag}-reenable`, { owner: s.owner, aiEnabled: s.aiEnabled, mode: s.mode });
  return s;
}

let overlayTested = false, deathSeen = false, prev = null;
let steps = [], blocked = 0, nonWalkable = 0, nearWall = 0;
for (let i = 0; i < 200; i++) {
  const q = await snap();
  report.samples.push({ i, tMs: Date.now() - t0, ...q });
  if (!q.world) break;
  if (q.levelUp && !overlayTested) {
    const before = q;
    await page.waitForTimeout(900);
    const frozen = await snap();
    await page.screenshot({ path: path.join(OUT, '01-natural-levelup-overlay.png') }); report.screenshots.push('01-natural-levelup-overlay.png');
    await page.keyboard.press('KeyW');
    await page.waitForTimeout(450);
    const during = await snap();
    report.overlayTakeover = {
      natural: true, noXpInjection: true,
      before: { active: before.active, owner: before.owner, aiEnabled: before.aiEnabled, actionCount: before.actionCount, grid: before.grid },
      frozen: { active: frozen.active, actionCountSame: frozen.actionCount === before.actionCount, gridSame: frozen.grid.x === before.grid.x && frozen.grid.y === before.grid.y },
      during: { active: during.active, owner: during.owner, aiEnabled: during.aiEnabled, takeoverCount: during.takeoverCount, takeoverReason: during.takeoverReason, txtControl: during.txtControl },
      pass: before.owner === 'ai' && frozen.actionCount === before.actionCount && during.active.includes('LevelUpScene') && during.owner === 'human' && during.aiEnabled === false && during.takeoverReason === 'human-input'
    };
    step('natural-overlay-takeover', report.overlayTakeover);
    await page.keyboard.press('1'); await page.waitForTimeout(800);
    const after = await snap();
    report.overlayTakeover.afterChoice = { active: after.active, owner: after.owner, aiEnabled: after.aiEnabled, paused: after.mode };
    await reenableAi('overlay');
    overlayTested = true;
    continue;
  }
  if (q.levelUp) { await page.keyboard.press('1'); await page.waitForTimeout(350); }
  if (!q.walkable) nonWalkable++;
  const wallCount = Object.values(q.walls).filter(Boolean).length;
  if (wallCount > 0) nearWall++;
  if (prev && q.room && prev.room && q.room.id === prev.room.id) {
    const d = Math.hypot(q.grid.x - prev.grid.x, q.grid.y - prev.grid.y);
    steps.push(d);
    if (q.intent && q.intent.move && (q.intent.move.x !== 0 || q.intent.move.y !== 0) && d < 0.02) blocked++;
  }
  prev = q;
  if (q.gameOver) { deathSeen = true; break; }
  if (i === 60 || i === 120 || i === 180) {
    const f = `02-run-${String(i).padStart(3, '0')}.png`;
    await page.screenshot({ path: path.join(OUT, f) }); report.screenshots.push(f);
  }
  await page.waitForTimeout(250);
}
const last = report.samples[report.samples.length - 1];
report.wall = {
  samples: report.samples.length, allWalkable: nonWalkable === 0, nonWalkableSamples: nonWalkable,
  samplesWithAdjacentWall: nearWall, sameRoomSteps: steps.length,
  maxSameRoomStep: steps.length ? Math.max(...steps) : null,
  meanSameRoomStep: steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : null,
  blockedIntentSamples: blocked
};
const inv = report.samples.filter((x) => typeof x.invuln === 'number').map((x) => x.invuln);
report.invuln = { min: Math.min(...inv), max: Math.max(...inv), refreshedByFixture: inv.some((v) => v > 1000) };
report.naturalDeath = {
  occurred: deathSeen,
  hpStart: report.samples[0]?.hp ?? null,
  hpMin: Math.min(...report.samples.filter((x) => typeof x.hp === 'number').map((x) => x.hp)),
  hpEnd: last?.hp ?? null,
  last: last ? { active: last.active, owner: last.owner, aiEnabled: last.aiEnabled, hp: last.hp, mode: last.mode } : null,
  rooms: [...new Set(report.samples.filter((x) => x.room).map((x) => x.room.kind))],
  aiIntentOwnerSamples: report.samples.filter((x) => x.lastIntentOwner === 'ai').length
};
await page.screenshot({ path: path.join(OUT, '03-end.png') }); report.screenshots.push('03-end.png');
step('watch-end', report.naturalDeath);
if (deathSeen) {
  const save = await page.evaluate(() => {
    const raw = localStorage.getItem('last_signal_save_v1'); const p = raw ? JSON.parse(raw) : {};
    return { hasRun: !!p.run, cores: p.permanent?.cores ?? null };
  });
  report.naturalDeath.save = save;
  await clickLogical(640, 500); // real RETRY SAME SEED
  await page.waitForTimeout(1600);
  const r = await snap();
  report.restart = { active: r.active, owner: r.owner, aiEnabled: r.aiEnabled, actionCount: r.actionCount, takeoverCount: r.takeoverCount, hp: r.hp };
  step('restart-after-natural-death', report.restart);
  await page.screenshot({ path: path.join(OUT, '04-restart.png') }); report.screenshots.push('04-restart.png');
}
report.meta.endedUtc = new Date().toISOString();
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-final/natural-death-wall-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ meta: report.meta, overlayTakeover: report.overlayTakeover, wall: report.wall, invuln: report.invuln, naturalDeath: report.naturalDeath, restart: report.restart, errors: report.errors }, null, 2));
await browser.close();
