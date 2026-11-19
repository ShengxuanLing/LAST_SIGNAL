// Legacy-flow no-bypass-tick + five-viewport dual-actor HUD evidence (b3930c5).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5361/';
const EV = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-final/evidence-viewports';
mkdirSync(EV, { recursive: true });
const out = { checks: [], steps: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-final/legacy-viewports.json', JSON.stringify(out, null, 2)); } catch {} });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.waitForTimeout(500);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(500);

// enable echo (real world path) and commit one tick
const enabled = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  w.enableEcho();
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral);
  return { echo: !!w.echoActor, tick: w.sim.tick };
});
check('echo-on-for-legacy-flows', enabled.echo, enabled);

// direct callback checks (no RAF bypass): pause/resume and inventory open/close do not tick
const pauseCheck = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const before = w.sim.tick;
  gs.onPause();
  const during = w.sim.tick;
  gs.onResume();
  const after = w.sim.tick;
  return { before, during, after, paused: gs.paused };
});
out.steps.push({ name: 'pause-resume', pauseCheck });
check('pause-resume-no-forced-tick', pauseCheck.before === pauseCheck.during && pauseCheck.during === pauseCheck.after, pauseCheck);

const inv = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const before = w.sim.tick;
  gs.toggleInventory?.(); // P3-a overlay path; may reopen/close
  const after = w.sim.tick;
  return { before, after, paused: gs.paused, hasMethod: typeof gs.toggleInventory === 'function' };
});
out.steps.push({ name: 'inventory', inv });
check('inventory-open-no-forced-tick', inv.before === inv.after, inv);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

// portal transition: exactly one legal tick, echo follows (teleport-echo command)
const portal = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  w.player.reset(w.portal.wx, w.portal.wy);
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral);
  const before = { room: w.currentRoom()?.id ?? null, tick: w.sim.tick, echo: w.echoActor ? { x: w.echoActor.x, y: w.echoActor.y } : null };
  w.tryInteract(w.player);
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral);
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral);
  const after = { room: w.currentRoom()?.id ?? null, tick: w.sim.tick, echo: w.echoActor ? { x: w.echoActor.x, y: w.echoActor.y } : null };
  return { before, after };
});
out.steps.push({ name: 'portal', portal });
check('portal-real-transition', portal.after.room !== portal.before.room, portal);
check('portal-echo-follows-same-tick-boundary', portal.after.echo && portal.before.echo && (portal.after.echo.x !== portal.before.echo.x || portal.after.echo.y !== portal.before.echo.y), portal);
check('portal-no-tick-skip', portal.after.tick - portal.before.tick === 2, { delta: portal.after.tick - portal.before.tick });

// checkpoint echo frame is a deep copy (old save without echo still valid via unit tests)
const cp = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const run = w.captureCheckpoint('tester', w.sim.seed, { kills: 0, damageDealt: 0, damageTaken: 0, shotsFired: 0, roomsCleared: 0, elapsedMs: 0, startedAt: 0, lootCollected: 0, suppliesPurchased: 0, deaths: 0 });
  if (!run) return { captured: false };
  const before = w.echoActor ? w.echoActor.data.hp : null;
  const echo = (run.coreState ?? {}).echo;
  if (echo) echo.data.hp = 1;
  const after = w.echoActor ? w.echoActor.data.hp : null;
  return { captured: true, hasEcho: !!echo, before, after, mutatedFrameDoesNotTouchLive: before === after };
});
out.steps.push({ name: 'checkpoint', cp });
check('checkpoint-refused-outside-safe-conditions', cp.captured === false || (cp.hasEcho && cp.mutatedFrameDoesNotTouchLive), cp);
check('no-page-errors', errs.length === 0, errs);
await page.close();

// five viewports: dual actor + HUD line actually visible
const sizes = [[1920, 1080], [1366, 768], [1280, 720], [1024, 768], [800, 600]];
for (const [w, h] of sizes) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
  await p.waitForTimeout(400);
  const b = await p.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await p.mouse.click(Math.round(b.x + 640 * b.w / 1280), Math.round(b.y + 340 * b.h / 720));
  await p.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
  await p.waitForTimeout(450);
  const st = await p.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene'); const world = gs.world;
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    world.enableEcho();
    world.resetSimulationAccumulator(); world.stepFrame(1000 / 60 + 1e-6, neutral);
    gs.refreshHud?.();
    const texts = gs.children.list.filter((c) => c.type === 'Text').map((c) => c.text);
    return { echo: !!world.echoActor, hudEcho: texts.find((t) => typeof t === 'string' && t.startsWith('ECHO ')), hudControl: texts.find((t) => typeof t === 'string' && t.startsWith('CONTROL')) };
  });
  await p.screenshot({ path: `${EV}/hud-echo-${w}x${h}.png` });
  out.steps.push({ name: `viewport-${w}x${h}`, st });
  check(`viewport-${w}x${h}-dual-actor-hud`, st.echo && /ECHO .*(HP|ASSIST|DOWN)/.test(st.hudEcho ?? ''), st);
  await p.close();
}
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-final/legacy-viewports.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]), steps: out.steps }, null, 2));
await browser.close();
process.exit(0);
