// GAMEPLAY-01 P1-B real-browser verification (fixture: scripted input + rescue;
// not human acceptance). Covers: real clear, route A/B/JAMMED, portalTarget save,
// checkpoint restore, 3 seed variants.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5499';
const BASE = `http://localhost:${PORT}/`;
const OUT = path.resolve('reports/gameplay-01/developer/p1');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const state = () => page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const s = w.signalView();
  const room = w.currentRoom();
  return {
    scen: w.p1Scenario,
    relay: s?.relay ?? null,
    manual: s?.manualEnabled ?? null,
    energy: s?.playerEnergy ?? null,
    room: room ? { id: room.id, kind: room.kind } : null,
    cleared: room ? w.map.rooms[room.id].cleared : null,
    portal: w.portal ? { target: w.portal.targetRoom, wx: w.portal.wx, wy: w.portal.wy } : null,
    objective: w.roomObjective,
    alive: w.sim.drones.filter((d) => d.hp > 0).map((d) => d.id),
    hp: w.player.data.hp,
    mapSeed: w.map.seed,
    tick: w.sim.tick
  };
});

async function bootDemo(seed) {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(500);
  if (seed === undefined) {
    const pos = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MainMenuScene');
      const t = s.children.list.find((c) => c.type === 'Text' && String(c.text || '').includes('DEMO 01'));
      return t ? { x: t.getBounds().centerX, y: t.getBounds().centerY } : null;
    });
    if (!pos) throw new Error('DEMO 01 button not found');
    await page.mouse.click(pos.x, pos.y);
  } else {
    await page.evaluate((s) => { window.__game.scene.stop('MainMenuScene'); window.__game.scene.start('GameScene', { demo: 'p1', seed: s }); }, seed);
  }
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(700);
}

/** Real weapon kill: aim the pointer at the nearest live drone and hold fire. */
async function killSentries() {
  await page.evaluate(() => { window.__game.scene.getScene('GameScene').world.player.invuln = 1e9; });
  await page.mouse.move(640, 360);
  await page.mouse.down();
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const info = await page.evaluate(() => {
      const g = window.__game; const gs = g.scene.getScene('GameScene'); const w = gs.world;
      const alive = w.sim.drones.filter((d) => d.hp > 0);
      if (!alive.length) return { alive: 0 };
      const p = w.player; let best = alive[0], bd = Infinity;
      for (const d of alive) { const dist = Math.hypot(d.x - p.x, d.y - p.y); if (dist < bd) { bd = dist; best = d; } }
      const cam = gs.cameras.main;
      const p0 = cam.getWorldPoint(0, 0), px = cam.getWorldPoint(100, 0), py = cam.getWorldPoint(0, 100);
      const ax = (px.x - p0.x) / 100, bx = p0.x, ay = (py.y - p0.y) / 100, by = p0.y;
      const d = w.worldToScreen(best.x, best.y);
      return { alive: alive.length, x: (d.x - bx) / ax, y: (d.y - by) / ay };
    });
    if (info.alive === 0) break;
    if (Number.isFinite(info.x)) await page.mouse.move(info.x, info.y);
    await page.waitForTimeout(80);
  }
  await page.mouse.up();
  await page.waitForFunction(() => {
    const w = window.__game.scene.getScene('GameScene').world;
    const room = w.currentRoom();
    return !!room && w.map.rooms[room.id].cleared === true;
  }, undefined, { timeout: 10000 });
}

async function setRelay(on) {
  await page.evaluate((v) => window.__game.scene.getScene('GameScene').world.toggleRelay(v), on);
  await page.waitForFunction((v) => {
    const s = window.__game.scene.getScene('GameScene').world.signalView();
    return s?.relay === (v ? 'ACTIVE' : 'INACTIVE');
  }, on, { timeout: 6000 });
  await page.waitForTimeout(250);
}

try {
  // ---- Route A (ACTIVE) + route B (INACTIVE) + JAMMED (neither) ----
  await bootDemo();
  const start = await state();
  say(`START: relay=${start.relay} room=${JSON.stringify(start.room)} linkedAlive=${JSON.stringify(start.alive)} routes=${JSON.stringify(start.scen?.routes)}`);
  await killSentries();
  const cleared = await state();
  const routeA = cleared.scen?.routes.find((r) => r.when === 'RELAY_ACTIVE')?.target;
  const routeB = cleared.scen?.routes.find((r) => r.when === 'RELAY_INACTIVE')?.target;
  say(`CLEARED: cleared=${cleared.cleared} portal=${JSON.stringify(cleared.portal)} routeA=${routeA} routeB=${routeB} objective="${cleared.objective}"`);
  await page.screenshot({ path: path.join(OUT, 'demo-B-routeA-1280x720.png') });

  await setRelay(false);
  const bState = await state();
  say(`ROUTE B: relay=${bState.relay} portal=${JSON.stringify(bState.portal)} objective="${bState.objective}"`);
  await page.screenshot({ path: path.join(OUT, 'demo-B-routeB-1280x720.png') });

  await setRelay(true);
  await page.evaluate(() => window.__game.scene.getScene('GameScene').world.playerSignalJam());
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.signalView()?.relay === 'JAMMED', undefined, { timeout: 6000 });
  await page.waitForTimeout(350);
  const jammed = await state();
  say(`JAMMED: relay=${jammed.relay} portal=${JSON.stringify(jammed.portal)} objective="${jammed.objective}"`);
  await page.screenshot({ path: path.join(OUT, 'demo-B-jammed-1280x720.png') });
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.signalView()?.relay === 'ACTIVE', undefined, { timeout: 10000 });
  await page.waitForTimeout(300);
  const afterJam = await state();
  say(`POST-JAM: relay=${afterJam.relay} portal=${JSON.stringify(afterJam.portal)} objective="${afterJam.objective}"`);

  // ---- Save route B + checkpoint restore ----
  await setRelay(false);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') || '{}'));
  say(`SAVE: demo=${saved.run?.demo} portalTarget=${saved.run?.portalTarget} relay=${saved.run?.coreState?.signal?.relay} manual=${saved.run?.coreState?.signal?.manualEnabled}`);
  const expectedB = routeB;
  await page.goto(BASE);
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(500);
  const cont = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MainMenuScene');
    const t = s.children.list.find((c) => c.type === 'Text' && String(c.text || '').trim().startsWith('CONTINUE'));
    return t ? { x: t.getBounds().centerX, y: t.getBounds().centerY } : null;
  });
  if (!cont) throw new Error('CONTINUE not found');
  await page.mouse.click(cont.x, cont.y);
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(1200);
  const restored = await state();
  say(`RESTORED: room=${JSON.stringify(restored.room)} relay=${restored.relay} portal=${JSON.stringify(restored.portal)} objective="${restored.objective}"`);

  // Travel route B through the real portal + F interaction (teleport is fixture).
  const travel = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const w = gs.world;
    if (!w.portal) return null;
    const target = w.portal.targetRoom;
    w.enqueueTeleport(w.portal.wx, w.portal.wy, true, false);
    w.resetSimulationAccumulator();
    w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    return { target, roomBefore: w.currentRoom()?.id ?? null };
  });
  await page.keyboard.press('KeyF');
  await page.waitForFunction((t) => {
    const w = window.__game.scene.getScene('GameScene').world;
    return w.currentRoom()?.id === t;
  }, travel?.target, { timeout: 8000 }).catch(() => undefined);
  const arrived = await state();
  say(`TRAVEL B: target=${travel?.target} roomAfter=${arrived.room?.id}`);

  // ---- Jam on portal + JAMMED checkpoint restore ----
  await bootDemo();
  await killSentries();
  const portalPos = await page.evaluate(() => {
    const w = window.__game.scene.getScene('GameScene').world;
    if (!w.portal) return null;
    const p = { x: w.portal.wx, y: w.portal.wy };
    // Fixture teleport (walking is not the thing under test); the jam is real.
    w.enqueueTeleport(w.sim.signal.x, w.sim.signal.y, true, false);
    w.resetSimulationAccumulator();
    w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    return p;
  });
  const jamEnqueued = await page.evaluate(() => window.__game.scene.getScene('GameScene').world.playerSignalJam());
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.signalView()?.relay === 'JAMMED', undefined, { timeout: 6000 });
  await page.waitForTimeout(300);
  await page.evaluate((p) => {
    const w = window.__game.scene.getScene('GameScene').world;
    w.enqueueTeleport(p.x, p.y, true, false);
    w.resetSimulationAccumulator();
    w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  }, portalPos);
  const onPortalJammed = await state();
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  const afterF = await state();
  say(`JAM ON PORTAL: jamEnqueued=${jamEnqueued} relay=${onPortalJammed.relay} portal=${JSON.stringify(onPortalJammed.portal)} roomAfterF=${afterF.room?.id}`);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(500);
  const jamSave = await page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') || '{}'));
  say(`JAM SAVE: demo=${jamSave.run?.demo} portalTarget=${jamSave.run?.portalTarget} relay=${jamSave.run?.coreState?.signal?.relay}`);
  await page.goto(BASE);
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(500);
  const cont2 = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MainMenuScene');
    const t = s.children.list.find((c) => c.type === 'Text' && String(c.text || '').trim().startsWith('CONTINUE'));
    return t ? { x: t.getBounds().centerX, y: t.getBounds().centerY } : null;
  });
  if (!cont2) throw new Error('CONTINUE (jammed) not found');
  await page.mouse.click(cont2.x, cont2.y);
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(900);
  const jamRestored = await state();
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.signalView()?.relay === 'ACTIVE', undefined, { timeout: 12000 });
  await page.waitForTimeout(400);
  const jamExpired = await state();
  await setRelay(false);
  const jamRouteB = await state();
  say(`JAM RESTORE: restoredPortal=${JSON.stringify(jamRestored.portal)} relay=${jamRestored.relay} expiredPortal=${JSON.stringify(jamExpired.portal)} routeB=${JSON.stringify(jamRouteB.portal)}`);

  // ---- 3 seed variants (production demo path, fixture start) ----
  const variants = [];
  for (const seed of [20261117, 20261118, 20261119]) {
    await bootDemo(seed);
    const v = await state();
    variants.push({
      seed,
      scenId: v.scen?.id,
      roomId: v.scen?.roomId,
      mapSeed: v.mapSeed,
      roomKind: v.room?.kind,
      relay: v.relay,
      linked: v.scen?.drones,
      routes: v.scen?.routes,
      alive: v.alive,
      objective: v.objective
    });
    say(`VARIANT ${seed}: room=${JSON.stringify(v.room)} relay=${v.relay} routes=${JSON.stringify(v.scen?.routes)} drones=${JSON.stringify(v.scen?.drones)} alive=${v.alive.length}`);
  }
  const uniqueVariants = new Set(variants.map((v) => JSON.stringify({ seed: v.mapSeed, room: v.roomId, routes: v.routes, drones: v.linked }))).size;

  const ok =
    start.scen?.id === 'p1' && start.relay === 'ACTIVE' && start.alive.length === 2 &&
    cleared.cleared === true && cleared.portal?.target === routeA && cleared.relay === 'ACTIVE' &&
    bState.relay === 'INACTIVE' && bState.portal?.target === routeB &&
    jammed.relay === 'JAMMED' && jammed.portal === null &&
    afterJam.relay === 'ACTIVE' && afterJam.portal?.target === routeA &&
    saved.run?.demo === 'p1' && saved.run?.portalTarget === expectedB &&
    saved.run?.coreState?.signal?.relay === 'INACTIVE' && saved.run?.coreState?.signal?.manualEnabled === false &&
    restored.scen?.id === 'p1' && restored.relay === 'INACTIVE' && restored.portal?.target === routeB &&
    traveledOk(travel, arrived) &&
    onPortalJammed.relay === 'JAMMED' && onPortalJammed.portal === null && afterF.room?.id === 0 &&
    jamSave.run?.portalTarget === null && jamSave.run?.coreState?.signal?.relay === 'JAMMED' &&
    jamRestored.portal === null && jamRestored.relay === 'JAMMED' &&
    jamExpired.relay === 'ACTIVE' && jamExpired.portal?.target === routeA &&
    jamRouteB.relay === 'INACTIVE' && jamRouteB.portal?.target === routeB &&
    variants.every((v) => v.scenId === 'p1' && v.relay === 'ACTIVE' && v.alive.length === 2 && v.routes?.length === 2) &&
    variants.every((v) => v.mapSeed !== undefined) &&
    uniqueVariants >= 3 && errors.length === 0;
  say(`RESULT: ${ok ? 'PASS' : 'FAIL'} (fixture; not human acceptance) uniqueVariants=${uniqueVariants}`);
  fs.writeFileSync(path.join(OUT, 'demo-B-verify.json'), JSON.stringify({
    ok, start, cleared, bState, jammed, afterJam, savedRun: saved.run, restored, travel, arrived,
    onPortalJammed, afterF, jamSaveRun: jamSave.run, jamRestored, jamExpired, jamRouteB, variants, errors
  }, null, 2));
  fs.writeFileSync(path.join(OUT, 'logs/demo-b-verify.log'), lines.join('\n') + '\n');
  process.exit(ok ? 0 : 1);
} catch (e) {
  say(`ERROR: ${String(e).split('\n')[0]}`);
  say(`PAGE ERRORS: ${errors.slice(0, 3).join(' | ')}`);
  fs.writeFileSync(path.join(OUT, 'logs/demo-b-verify.log'), lines.join('\n') + '\n');
  await browser.close();
  process.exit(1);
}

function traveledOk(travel, arrived) {
  return !!travel && arrived.room?.id === travel.target;
}
await browser.close();
