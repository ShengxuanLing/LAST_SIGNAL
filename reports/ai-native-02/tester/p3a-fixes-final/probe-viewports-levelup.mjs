// Minimal five-viewport + pause/level-up/portal/save regression (212cd56).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const BASE = 'http://localhost:5371/';
const EV = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-fixes-final/evidence-viewports';
mkdirSync(EV, { recursive: true });
const out = { checks: [], steps: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-fixes-final/viewports.json', JSON.stringify(out, null, 2)); } catch {} });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.waitForTimeout(400);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(400);

const flow = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  w.enableEcho(); w.stepFrame(1000 / 60 + 1e-6, neutral, neutral);
  const t0 = w.sim.tick;
  gs.onPause(); const tp = w.sim.tick; gs.onResume(); const tr = w.sim.tick;
  gs.onLevelUp(1); const tl = w.sim.tick; gs.onLevelUpClosed(); const tlc = w.sim.tick;
  return { t0, tp, tr, tl, tlc, levelUpMethod: typeof gs.onLevelUp === 'function', echo: !!w.echoActor };
});
out.steps.push({ name: 'overlays', flow });
check('pause-and-levelup-no-forced-tick', flow.echo && flow.t0 === flow.tp && flow.tp === flow.tr && flow.tr === flow.tl && flow.tl === flow.tlc, flow);

// portal command: real transition + echo teleport on the same tick boundary
const portal = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  w.player.reset(w.portal.wx, w.portal.wy);
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral, neutral);
  const before = { room: w.currentRoom()?.id, tick: w.sim.tick, echo: w.echoActor ? { x: w.echoActor.x, y: w.echoActor.y } : null };
  w.tryInteract(w.player);
  w.resetSimulationAccumulator(); const e1 = w.stepFrame(1000 / 60 + 1e-6, neutral, neutral);
  w.resetSimulationAccumulator(); const e2 = w.stepFrame(1000 / 60 + 1e-6, neutral, neutral);
  const after = { room: w.currentRoom()?.id, tick: w.sim.tick, echo: w.echoActor ? { x: w.echoActor.x, y: w.echoActor.y } : null };
  return { before, after, echoTeleportEvents: [...e1, ...e2].filter((e) => e.type === 'echo-moved').length, delta: after.tick - before.tick };
});
out.steps.push({ name: 'portal', portal });
check('portal-transition-echo-follows-no-tick-skip', portal.after.room !== portal.before.room && portal.delta === 2 && portal.echoTeleportEvents > 0, portal);

// save: captureCheckpoint under safe conditions returns a deep copy with echo
const save = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  w.clearEnemiesForTest();
  for (const r of w.map.rooms) { if (r.kind === 'boss') continue; r.cleared = true; r.spawned = true; }
  const cp = w.captureCheckpoint('tester-view', 424242, { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 });
  if (!cp) return { captured: false };
  const hp = w.echoActor?.data.hp;
  cp.coreState.echo.data.hp = 1;
  return { captured: true, hasEcho: !!cp.coreState.echo, liveHpUnchanged: w.echoActor?.data.hp === hp };
});
out.steps.push({ name: 'save', save });
check('checkpoint-echo-deep-copy', save.captured && save.hasEcho && save.liveHpUnchanged, save);
check('no-page-errors', errs.length === 0, errs);
await page.close();

for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720], [1024, 768], [800, 600]]) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
  await p.waitForTimeout(350);
  const b = await p.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await p.mouse.click(Math.round(b.x + 640 * b.w / 1280), Math.round(b.y + 340 * b.h / 720));
  await p.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
  await p.waitForTimeout(350);
  const st = await p.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene'); const world = gs.world;
    const n = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    world.enableEcho(); world.stepFrame(1000 / 60 + 1e-6, n, n);
    gs.refreshHud();
    const texts = gs.children.list.filter((c) => c.type === 'Text').map((c) => c.text);
    return { echo: !!world.echoActor, hud: texts.find((t) => typeof t === 'string' && t.startsWith('ECHO ')), control: texts.find((t) => typeof t === 'string' && t.startsWith('CONTROL')) };
  });
  await p.screenshot({ path: `${EV}/hud-echo-${w}x${h}.png` });
  out.steps.push({ name: `viewport-${w}x${h}`, st });
  check(`viewport-${w}x${h}-dual-actor-hud`, st.echo && /ECHO .*(HP|ASSIST|DOWN)/.test(st.hud ?? ''), st);
  await p.close();
}
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-fixes-final/viewports.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]) }, null, 2));
await browser.close();
process.exit(0);
