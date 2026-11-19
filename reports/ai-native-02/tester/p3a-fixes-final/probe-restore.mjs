// P3-a fix: restore authority reset, HP fidelity, old-save compatibility.
// Disclosed fixtures: owner/dev simFixture HP writes and room cleared flags to create
// a legal checkpoint; restore itself and the FSM decisions are real product code.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const out = { meta: { target: '212cd5634ea4ef1e775294eab3ccfca8ecff3a1f', fixtures: 'simFixture HP 42/55, cleared-room flags for a legal checkpoint' }, checks: [], steps: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-fixes-final/restore.json', JSON.stringify(out, null, 2)); } catch {} });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5371/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.waitForTimeout(400);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(400);

const prepared = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  w.clearEnemiesForTest();
  w.enableEcho();
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral, neutral);
  w.setEchoMode('hold'); w.confirmEchoAssist();
  const view = w.echoView();
  if (view) { w.echoController.observe(view); w.echoController.decide(view); }
  w.simFixture.echo.data.hp = 42;
  w.simFixture.player.data.hp = 55;
  for (const r of w.map.rooms) { if (r.kind === 'boss') continue; r.cleared = true; r.spawned = true; }
  const frame = w.captureCheckpoint('tester-restore', 424242, { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 });
  if (frame) frame.portalTarget = null;
  return {
    frame,
    armedBefore: w.echoAssistArmed, modeBefore: w.echoMode,
    memoryBefore: w.echoController.memory.length,
    echoHpBefore: w.echoActor?.data.hp, playerHpBefore: w.simFixture.player.data.hp
  };
});
out.steps.push({ name: 'prepared', prepared: { ...prepared, frame: !!prepared.frame } });
check('checkpoint-captured-echo42-player55', !!prepared.frame && prepared.echoHpBefore === 42 && prepared.playerHpBefore === 55 && prepared.armedBefore === true && prepared.modeBefore === 'hold', { captured: !!prepared.frame, echoHp: prepared.echoHpBefore, playerHp: prepared.playerHpBefore, armed: prepared.armedBefore, mode: prepared.modeBefore });

const restored = await page.evaluate((frame) => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const ok = w.restoreCheckpoint(frame);
  const c = w.echoController; const e = w.echoActor;
  const snap = {
    assist: w.echoAssistArmed, mode: w.echoMode, memory: c.memory.length,
    suggestion: c.suggestion, lastIntent: { ...c.lastIntent, move: { ...c.lastIntent.move } },
    echoHp: e?.data.hp ?? null, playerHp: w.simFixture.player.data.hp, shots: w.echoShotsFired
  };
  const room = w.currentRoom();
  if (e) w.spawnEnemy('drone', e.x + 1, e.y, room?.id ?? 0, 1);
  const view = w.echoView();
  const intent = view ? c.decide(view) : null;
  return { ok, ...snap, intentFire: intent?.fire ?? null };
}, prepared.frame);
out.steps.push({ name: 'restored', restored });
check('restore-ok', restored.ok === true, restored);
check('restore-revokes-assist-and-memory', restored.assist === false && restored.mode === 'follow' && restored.memory === 0 && restored.suggestion === null && restored.lastIntent.move.x === 0 && restored.lastIntent.move.y === 0, restored);
check('restore-keeps-hp-42-55', restored.echoHp === 42 && restored.playerHp === 55, { echoHp: restored.echoHp, playerHp: restored.playerHp });
check('restore-no-fire-no-shots', restored.intentFire === false && restored.shots === 0, { intentFire: restored.intentFire, shots: restored.shots });

const repeat = await page.evaluate((frame) => {
  const w = window.__game.scene.getScene('GameScene').world;
  const a = w.restoreCheckpoint(frame); const b = w.restoreCheckpoint(frame);
  return { a, b, echoHp: w.echoActor?.data.hp, playerHp: w.simFixture.player.data.hp, assist: w.echoAssistArmed, shots: w.echoShotsFired };
}, prepared.frame);
out.steps.push({ name: 'no-hp-farm', repeat });
check('repeated-restore-cannot-farm-hp', repeat.a && repeat.b && repeat.echoHp === 42 && repeat.playerHp === 55 && repeat.assist === false && repeat.shots === 0, repeat);

const oldSave = await page.evaluate((frame) => {
  const w = window.__game.scene.getScene('GameScene').world;
  const legacy = JSON.parse(JSON.stringify(frame));
  delete legacy.coreState.echo;
  const ok = w.restoreCheckpoint(legacy);
  const noEcho = w.echoActor === null;
  w.enableEcho();
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral, neutral);
  const memoryAtRestore = w.echoController.memory.length;
  const room = w.currentRoom(); const e = w.echoActor;
  if (e) w.spawnEnemy('drone', e.x + 1, e.y, room?.id ?? 0, 1);
  const view = w.echoView();
  const intent = view ? w.echoController.decide(view) : null;
  return { ok, noEcho, assist: w.echoAssistArmed, echoHp: e?.data.hp ?? null, suggestion: w.echoSuggestion, intentFire: intent?.fire ?? null, shots: w.echoShotsFired, memoryAtRestore, memoryAfterNewObservation: w.echoController.memory.length };
}, prepared.frame);
out.steps.push({ name: 'old-save', oldSave });
check('old-save-no-echo-then-new-echo-base-hp', oldSave.ok === true && oldSave.noEcho === true && oldSave.echoHp === 100, oldSave);
check('old-save-requires-new-confirmation', oldSave.assist === false && oldSave.intentFire === false && oldSave.shots === 0 && oldSave.memoryAtRestore === 0, oldSave);

const lifecycle = await page.evaluate(() => {
  const w = window.__game.scene.getScene('GameScene').world;
  w.confirmEchoAssist(); const armed = w.echoAssistArmed;
  w.setEchoMode('hold'); const afterMode = w.echoAssistArmed;
  w.confirmEchoAssist(); w.reset();
  return { armed, afterMode, afterReset: w.echoAssistArmed, modeAfterReset: w.echoMode };
});
out.steps.push({ name: 'lifecycle', lifecycle });
check('mode-switch-and-restart-revoke-assist', lifecycle.armed === true && lifecycle.afterMode === false && lifecycle.afterReset === false && lifecycle.modeAfterReset === 'follow', lifecycle);
check('no-page-errors', errs.length === 0, errs);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-fixes-final/restore.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]) }, null, 2));
await browser.close();
process.exit(0);
