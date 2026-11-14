// Independent P1 probe — NO evidence fixture.
// Rules: no i-frame refresh, no HP/coordinate writes, no hurt()/addXp()/spawnEnemy()
// injection, no direct control mutation. Only real page input + read-only page.evaluate.
// Served from the tester's own frozen production build on 5282.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5282/';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/evidence-normal';
mkdirSync(OUT, { recursive: true });

const GAME_W = 1280, GAME_H = 720;
const report = {
  meta: {
    url: BASE,
    viewport: { w: 1280, h: 720 },
    fixture: false,
    fixtureDeclaration: 'NO stabilizeEvidenceRun; NO invuln refresh; NO HP/coordinate mutation; NO forced hurt/addXp/spawnEnemy. Real NEW RUN + Pause menu AI CONTROL + real keyboard/mouse input only.',
    startedUtc: new Date().toISOString()
  },
  steps: [], samples: [], screenshots: [], errors: [],
  takeoverTrials: [], pauseOff: null, naturalDeath: null, restart: null, wall: null, levelUps: []
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));

const box = () => page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
});
async function clickLogical(lx, ly) {
  const b = await box();
  await page.mouse.click(b.x + (lx * b.w) / GAME_W, b.y + (ly * b.h) / GAME_H);
}
const snap = () => page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const active = g.scene.getScenes(true).map((s) => s.sys.settings.key);
  if (!gs || !gs.world) return { active, world: null };
  const w = gs.world, pl = w.player, c = pl.control.snapshot();
  return {
    active, world: true,
    seed: gs.seed, paused: gs.paused, hp: pl.data.hp, maxHp: pl.data.maxHp,
    invuln: pl.invuln, grid: { x: pl.wx, y: pl.wy },
    walkable: w.isWalkable(pl.wx, pl.wy, 0.5),
    room: w.currentRoom() ? { id: w.currentRoom().id, kind: w.currentRoom().kind } : null,
    enemies: w.enemies.length, projectiles: w.projectiles.length,
    owner: c.owner, aiEnabled: c.aiEnabled, mode: c.mode, pausedAuthority: c.paused,
    action: c.lastAiAction, target: c.lastAiTarget, actionCount: c.aiActionCount,
    takeoverCount: c.takeoverCount, takeoverReason: c.lastTakeoverReason,
    lastIntentOwner: pl.lastIntentOwner,
    intent: { move: pl.lastIntent ? { ...pl.lastIntent.move } : null, fire: pl.lastIntent ? pl.lastIntent.fire : null },
    txtControl: gs.txtControl.text, txtAiAction: gs.txtAiAction.text,
    txtAiTarget: gs.txtAiTarget.text, txtAgentLink: gs.txtAgentLink.text,
    gameOver: active.includes('GameOverScene'), levelUp: active.includes('LevelUpScene')
  };
});
const labels = (name) => page.evaluate((n) => {
  const g = window.__game, s = g.scene.getScene(n);
  if (!s || !g.scene.isActive(n)) return [];
  return s.children.list.filter((c) => c.type === 'Text').map((c) => c.text);
}, name);
const step = (name, detail = {}) => report.steps.push({ name, tMs: Date.now() - t0, detail });

const t0 = Date.now();
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await clickLogical(640, 340); // real NEW RUN, no seed injection
await page.waitForTimeout(1500);
let s = await snap();
step('new-run', { seed: s.seed, hp: s.hp, grid: s.grid, active: s.active, txtAgentLink: s.txtAgentLink });
await page.screenshot({ path: path.join(OUT, '00-new-run.png') });
report.screenshots.push('00-new-run.png');

// Real entry: ESC -> AI CONTROL ON -> ESC (no fixture)
await page.keyboard.press('Escape');
await page.waitForTimeout(550);
step('pause-open', { active: (await snap()).active, labels: (await labels('PauseScene')).filter((t) => /AI|AGENT|CONTROL/.test(t)) });
await clickLogical(640, 540);
await page.waitForTimeout(550);
step('ai-control-on', { labels: (await labels('PauseScene')).filter((t) => /AI CONTROL|CONTROL|AGENT/.test(t)), state: await snap() });
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
s = await snap();
step('resumed', { owner: s.owner, mode: s.mode, hp: s.hp, grid: s.grid, txtControl: s.txtControl, txtAgentLink: s.txtAgentLink });
await page.screenshot({ path: path.join(OUT, '01-ai-enabled.png') });
report.screenshots.push('01-ai-enabled.png');

// 20s normal run at 200ms cadence, real survival/death, wall-collision evidence.
let levelUps = 0, deathSeen = false, prev = null, sameRoomSteps = [], blocked = 0, nonWalkable = 0;
for (let i = 0; i < 100; i++) {
  const t = Date.now() - t0;
  const q = await snap();
  report.samples.push({ i, tMs: t, ...q });
  if (!q.world) break;
  if (q.levelUp) {
    levelUps++;
    report.levelUps.push({ i, tMs: t, owner: q.owner, actionCount: q.actionCount, grid: q.grid });
    await page.keyboard.press('1'); // real player upgrade choice, not a state write
    await page.waitForTimeout(300);
  }
  if (!q.walkable) nonWalkable++;
  if (prev && q.room && prev.room && q.room.id === prev.room.id) {
    const d = Math.hypot(q.grid.x - prev.grid.x, q.grid.y - prev.grid.y);
    sameRoomSteps.push(d);
    if (q.intent && q.intent.move && (q.intent.move.x !== 0 || q.intent.move.y !== 0) && d < 0.02) blocked++;
  }
  prev = q;
  if (q.gameOver) { deathSeen = true; break; }
  if (i === 40 || i === 80) {
    const f = `02-run-${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(OUT, f) });
    report.screenshots.push(f);
  }
  await page.waitForTimeout(200);
}
const last = report.samples[report.samples.length - 1];
report.wall = {
  samples: report.samples.length,
  allWalkable: nonWalkable === 0,
  nonWalkableSamples: nonWalkable,
  sameRoomSteps: sameRoomSteps.length,
  maxSameRoomStep: sameRoomSteps.length ? Math.max(...sameRoomSteps) : null,
  meanSameRoomStep: sameRoomSteps.length ? sameRoomSteps.reduce((a, b) => a + b, 0) / sameRoomSteps.length : null,
  blockedIntentSamples: blocked
};
report.naturalDeath = {
  occurred: deathSeen,
  last: last ? { hp: last.hp, grid: last.grid, active: last.active, owner: last.owner, aiEnabled: last.aiEnabled, mode: last.mode } : null,
  hpStart: report.samples[0]?.hp ?? null,
  hpMin: Math.min(...report.samples.filter((x) => typeof x.hp === 'number').map((x) => x.hp)),
  hpEnd: last?.hp ?? null,
  actions: [...new Set(report.samples.map((x) => String(x.action)).filter((a) => a !== 'null'))],
  rooms: [...new Set(report.samples.filter((x) => x.room).map((x) => x.room.kind))],
  aiIntentOwnerSamples: report.samples.filter((x) => x.lastIntentOwner === 'ai').length,
  levelUps
};
const fEnd = '03-normal-run-end.png';
await page.screenshot({ path: path.join(OUT, fEnd) });
report.screenshots.push(fEnd);
step('normal-run-end', report.naturalDeath);

// If the run ended naturally, restart through the real RETRY SAME SEED button.
if (deathSeen) {
  await clickLogical(640, 500);
  await page.waitForTimeout(1600);
  const r = await snap();
  report.restart = { active: r.active, owner: r.owner, aiEnabled: r.aiEnabled, actionCount: r.actionCount, takeoverCount: r.takeoverCount, hp: r.hp };
  step('restart-after-natural-death', report.restart);
}

async function enableAiIfNeeded(tag) {
  let st = await snap();
  if (st.active.includes('LevelUpScene')) { await page.keyboard.press('1'); await page.waitForTimeout(400); }
  st = await snap();
  if (st.owner === 'ai' && st.aiEnabled) return st;
  if (st.active.includes('PauseScene')) await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const onLabels = await labels('PauseScene');
  if (onLabels.some((t) => t.includes('AI CONTROL: OFF'))) {
    await clickLogical(640, 540);
    await page.waitForTimeout(500);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const after = await snap();
  step(`${tag}-enable-ai`, { owner: after.owner, aiEnabled: after.aiEnabled, active: after.active });
  return after;
}

async function trial(kind, act) {
  const before = await enableAiIfNeeded(kind);
  await act();
  await page.waitForTimeout(400);
  const after = await snap();
  const pass = before.owner === 'ai' && after.owner === 'human' && after.aiEnabled === false && after.takeoverReason === 'human-input';
  report.takeoverTrials.push({ kind, pass, before: { owner: before.owner, aiEnabled: before.aiEnabled, takeoverCount: before.takeoverCount, grid: before.grid }, after: { owner: after.owner, aiEnabled: after.aiEnabled, takeoverCount: after.takeoverCount, takeoverReason: after.takeoverReason, grid: after.grid, txtControl: after.txtControl } });
  step(`${kind}-takeover`, { pass, owner: after.owner, reason: after.takeoverReason });
  return pass;
}

// Three real human inputs: movement, fire, F interact.
await trial('move-KeyD', async () => { await page.keyboard.down('KeyD'); await page.waitForTimeout(180); await page.keyboard.up('KeyD'); });
await trial('fire-mouse', async () => {
  const b = await box();
  await page.mouse.move(b.x + (800 * b.w) / GAME_W, b.y + (400 * b.h) / GAME_H);
  await page.mouse.down(); await page.waitForTimeout(180); await page.mouse.up();
});
await trial('interact-KeyF', async () => { await page.keyboard.press('KeyF'); });

// Independent pause-menu OFF check while the AI is running (no fixture).
const beforeOff = await enableAiIfNeeded('pause-off');
await page.keyboard.press('Escape');
await page.waitForTimeout(450);
const onLabels = await labels('PauseScene');
const frozenBefore = await snap();
await page.waitForTimeout(900);
const frozenAfter = await snap();
await clickLogical(640, 540);
await page.waitForTimeout(550);
const disabled = await snap();
const offLabels = await labels('PauseScene');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const afterResume = await snap();
await page.waitForTimeout(2000);
const after2s = await snap();
report.pauseOff = {
  before: { owner: beforeOff.owner, aiEnabled: beforeOff.aiEnabled, mode: beforeOff.mode },
  onLabels: onLabels.filter((t) => /AI CONTROL|CONTROL|AGENT/.test(t)),
  frozen: { gridSame: frozenBefore.grid.x === frozenAfter.grid.x && frozenBefore.grid.y === frozenAfter.grid.y, actionCountSame: frozenBefore.actionCount === frozenAfter.actionCount, mode: frozenBefore.mode },
  disabled: { owner: disabled.owner, aiEnabled: disabled.aiEnabled, reason: disabled.takeoverReason, takeoverCount: disabled.takeoverCount },
  offLabels: offLabels.filter((t) => /AI CONTROL|CONTROL|AGENT/.test(t)),
  afterResume: { owner: afterResume.owner, aiEnabled: afterResume.aiEnabled, txtControl: afterResume.txtControl },
  after2s: { owner: after2s.owner, aiEnabled: after2s.aiEnabled, lastAiAction: after2s.action },
  pass: beforeOff.owner === 'ai' && frozenBefore.mode === 'PAUSED' && onLabels.some((t) => t.includes('AI CONTROL: ON')) &&
    disabled.owner === 'human' && disabled.aiEnabled === false && disabled.takeoverReason === 'pause-menu' &&
    offLabels.some((t) => t.includes('AI CONTROL: OFF')) && after2s.owner === 'human' && after2s.aiEnabled === false
};
await page.screenshot({ path: path.join(OUT, '04-after-pause-off.png') });
report.screenshots.push('04-after-pause-off.png');
step('pause-off', report.pauseOff);

report.meta.endedUtc = new Date().toISOString();
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/normal-run-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  meta: report.meta,
  naturalDeath: report.naturalDeath,
  wall: report.wall,
  takeoverTrials: report.takeoverTrials.map(({ kind, pass, before, after }) => ({ kind, pass, before: before.owner, after: after.owner, reason: after.takeoverReason })),
  pauseOff: report.pauseOff,
  restart: report.restart,
  errors: report.errors
}, null, 2));
await browser.close();
