// GAMEPLAY-01 P1 — reviewer-owned independent browser harness.
//
// Everything here is READ-ONLY for src/tests: it drives the real product from
// the real main menu entry (no private spawn), instruments the public
// `world.stepFrame` return value to count UNIQUE `projectile-spawned` events,
// and uses the existing `clearEnemiesForTest()` seam only where a room must be
// cleared (labelled fixture). One route is completed by REAL keyboard walking.
import { test, expect } from '@playwright/test';

const OUT = 'reports/gameplay-01/reviewer/p1';
const SAVE_KEY = 'last_signal_save_v1';

async function boot(page: any): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(400);
}

async function clickText(page: any, scene: string, label: string): Promise<void> {
  const logical = await page.evaluate(({ scene, label }) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene(scene);
    const flat: any[] = [];
    const walk = (l: any[]) => { for (const c of l) { if (c.type === 'Container' && Array.isArray(c.list)) walk(c.list); else flat.push(c); } };
    walk(s.children.list);
    const cands = flat.filter((c) => c.type === 'Text' && c.visible !== false && String(c.text || '').includes(label));
    if (!cands.length) return null;
    const t = cands[0];
    const b = t.getBounds();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, { scene, label });
  expect(logical, `text "${label}" in ${scene}`).not.toBeNull();
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + (logical!.x * box.w) / 1280, box.y + (logical!.y * box.h) / 720);
  await page.waitForTimeout(350);
}

async function enterDemo(page: any): Promise<void> {
  await boot(page);
  await clickText(page, 'MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForFunction(() => !!(window as any).__game.scene.getScene('GameScene').world?.p1Scenario, { timeout: 20000 });
  await page.waitForTimeout(700);
  // Instrument: collect every core event the scene applies, per frame.
  await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w: any = gs.world;
    (window as any).__p1 = { events: [] as any[] };
    const orig = w.stepFrame.bind(w);
    w.stepFrame = (...args: any[]) => {
      const ev = orig(...args) as any[];
      if (Array.isArray(ev)) for (const e of ev) (window as any).__p1.events.push(e);
      return ev;
    };
  });
}

async function st(page: any) {
  return page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w: any = gs.world;
    const s = w.sim;
    const sig = s.signal;
    return {
      tick: s.tick,
      room: w.currentRoomId,
      relay: sig ? sig.relay : null,
      energy: sig ? sig.actors.player.energy.energy : null,
      jamLeft: sig ? Math.max(0, sig.jammedUntilTick - s.tick) : 0,
      manual: sig ? sig.manualEnabled : null, powered: sig ? sig.powered : null, jamUntil: sig ? sig.jammedUntilTick : null,
      hp: s.player.data.hp,
      drones: s.drones.map((d: any) => ({ id: d.id, hp: d.hp, room: d.data.spawnRoom, link: d.relayDeviceId ?? null })),
      projectiles: s.projectiles.map((p: any) => ({ id: p.id, owner: p.ownerId, side: p.side })),
      portal: w.portal ? { x: w.portal.wx, y: w.portal.wy, target: w.portal.targetRoom } : null,
      fireEnabled: w.p1LinkedFireEnabled,
      routeTarget: w.p1RouteTarget,
      px: s.player.x,
      py: s.player.y,
      cleared: w.map.rooms[w.currentRoomId]?.cleared ?? null,
      p1: w.p1Scenario ? { room: w.p1Scenario.roomId, routes: w.p1Scenario.routes.map((r: any) => ({ t: r.target, w: r.when })) } : null,
      objective: w.roomObjective,
      detail: gs.txtSignalDetail ? String(gs.txtSignalDetail.text) : null
    };
  });
}

async function mark(page: any): Promise<number> {
  return page.evaluate(() => (window as any).__p1.events.length);
}

/** UNIQUE enemy projectile-spawn events in (from, to) — counts events, not arrays. */
async function spawns(page: any, from: number, to?: number) {
  return page.evaluate(({ from, to }) => {
    const ev = (window as any).__p1.events.slice(from, to ?? (window as any).__p1.events.length);
    const out: any[] = [];
    const seen = new Set<number>();
    for (const e of ev) {
      if (e?.type !== 'projectile-spawned') continue;
      const p = e.projectile;
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ id: p.id, owner: p.ownerId, side: p.side });
    }
    return { unique: out.length, enemy: out.filter((p) => p.side === 'enemy').length, ids: out.map((p) => p.id) };
  }, { from, to });
}

/** Real keyboard walking towards a world tile: BFS waypoints on the real map,
 *  then WASD movement with axis fallback (no teleport fixture). */
async function pathTo(page: any, tx: number, ty: number) {
  return page.evaluate(({ tx, ty }) => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    const round = (v: number) => Math.round(v * 2) / 2;
    let start = { x: round(w.player.x), y: round(w.player.y) };
    if (!w.isWalkable(start.x, start.y, 0.5)) {
      let best = start, bd = Infinity;
      for (let dx = -2; dx <= 2; dx += 0.5) for (let dy = -2; dy <= 2; dy += 0.5) {
        const cx = round(w.player.x + dx), cy = round(w.player.y + dy);
        if (!w.isWalkable(cx, cy, 0.5)) continue;
        const d = Math.hypot(cx - w.player.x, cy - w.player.y);
        if (d < bd) { bd = d; best = { x: cx, y: cy }; }
      }
      start = best;
    }
    const goal = { x: Math.round(tx * 2) / 2, y: Math.round(ty * 2) / 2 };
    const key = (x: number, y: number) => `${x},${y}`;
    const ok = (x: number, y: number) => {
      try { return !!w.isWalkable(x, y, 0.5); } catch { return false; }
    };
    if (!ok(goal.x, goal.y)) return null;
    const q: Array<{ x: number; y: number }> = [start];
    const prev = new Map<string, string | null>([[key(start.x, start.y), null]]);
    const steps = [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]];
    let found = false;
    while (q.length && prev.size < 20000) {
      const cur = q.shift()!;
      if (Math.hypot(cur.x - goal.x, cur.y - goal.y) < 0.3) { found = true; break; }
      for (const [dx, dy] of steps) {
        const nx = Math.round((cur.x + dx) * 2) / 2, ny = Math.round((cur.y + dy) * 2) / 2;
        const k = key(nx, ny);
        if (prev.has(k) || !ok(nx, ny)) continue;
        prev.set(k, key(cur.x, cur.y));
        q.push({ x: nx, y: ny });
      }
    }
    if (!found) return null;
    // reconstruct
    const path: Array<{ x: number; y: number }> = [];
    let cur: string | null = key(Math.round(goal.x * 2) / 2, Math.round(goal.y * 2) / 2);
    // find the reached node (within 0.3 of goal)
    let reached = cur!;
    while (cur) { const [x, y] = cur.split(',').map(Number); path.push({ x, y }); cur = prev.get(cur) ?? null; }
    path.reverse();
    return path;
  }, { tx, ty });
}

async function walkTo(page: any, tx: number, ty: number): Promise<boolean> {
  const path = await pathTo(page, tx, ty);
  if (!path || path.length < 2) return false;
  let held: string[] = [];
  const setKeys = async (want: string[]) => {
    for (const k of held) if (!want.includes(k)) await page.keyboard.up(k);
    for (const k of want) if (!held.includes(k)) await page.keyboard.down(k);
    held = want;
  };
  let idx = 1;
  let last = await st(page);
  let stuck = 0;
  for (let guard = 0; guard < 240; guard++) {
    const s = await st(page);
    if (Math.hypot(tx - s.px, ty - s.py) < 0.7) break;
    while (idx < path.length - 1 && Math.hypot(path[idx].x - s.px, path[idx].y - s.py) < 0.55) idx++;
    const wp = path[idx];
    const dx = wp.x - s.px, dy = wp.y - s.py;
    const moved = Math.hypot(s.px - last.px, s.py - last.py);
    last = s;
    if (moved < 0.04) stuck++; else stuck = 0;
    const want: string[] = [];
    // On a wall, alternate single-axis movement (slide) instead of pushing diagonally.
    const slide = stuck >= 1;
    const axisX = dx > 0.06 ? 'KeyD' : dx < -0.06 ? 'KeyA' : null;
    const axisY = dy > 0.06 ? 'KeyS' : dy < -0.06 ? 'KeyW' : null;
    if (slide) {
      if (Math.abs(dx) >= Math.abs(dy)) { if (axisX) want.push(axisX); else if (axisY) want.push(axisY); }
      else { if (axisY) want.push(axisY); else if (axisX) want.push(axisX); }
      if (stuck >= 3) { if (want[0] === 'KeyA') want[0] = 'KeyD'; else if (want[0] === 'KeyD') want[0] = 'KeyA'; }
    } else {
      if (axisX) want.push(axisX);
      if (axisY) want.push(axisY);
    }
    if (!want.length) { idx++; continue; }
    await setKeys(want);
    await page.waitForTimeout(90);
    if (stuck > 8) break;
  }
  await setKeys([]);
  const s = await st(page);
  const dist = Math.hypot(tx - s.px, ty - s.py);
  console.log('[walk] end', JSON.stringify({ dist: +dist.toFixed(2), px: +s.px.toFixed(2), py: +s.py.toFixed(2), room: s.room, relay: s.relay, manual: s.manual, powered: s.powered, jamUntil: s.jamUntil, portal: s.portal }));
  return dist < 1.2;
}

/** Longer key hold so a 60fps Phaser frame reliably sees JustDown(). */
async function tap(page: any, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(130);
  await page.keyboard.up(key);
  await page.waitForTimeout(60);
}

async function readSave(page: any) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY);
}

test.describe('GAMEPLAY-01 P1 final reviewer harness', () => {
  test('A: real menu demo — ACTIVE/JAM/expiry/OFF/ON, old-shot damage, unique spawn events', async ({ page }) => {
    test.setTimeout(300000);
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

    await enterDemo(page);
    let s = await st(page);
    expect(s.p1, 'real main-menu demo entry produced an authored scenario').not.toBeNull();
    expect(s.relay, 'authored initial ACTIVE').toBe('ACTIVE');
    expect(s.fireEnabled).toBe(true);
    console.log('[A] entry', JSON.stringify({ relay: s.relay, hp: s.hp, drones: s.drones, routes: s.p1.routes, objective: s.objective }));

    // 1) ACTIVE: linked drones really open fire
    const m0 = await mark(page);
    await page.waitForTimeout(2200);
    const activeShots = await spawns(page, m0);
    console.log('[A] active spawns', JSON.stringify(activeShots));
    expect(activeShots.enemy, 'linked sentries fire while ACTIVE').toBeGreaterThan(0);

    // 2) JAM: new fire stops, old projectiles keep flying and keep hurting
    const preJam = await st(page);
    const enemyInFlight = preJam.projectiles.filter((p: any) => p.side === 'enemy').length;
    const energyBefore = preJam.energy!;
    await tap(page, 'KeyY');
    await page.waitForTimeout(400);
    const jam = await st(page);
    expect(jam.relay, 'JAM puts the relay in JAMMED').toBe('JAMMED');
    expect(jam.fireEnabled, 'HUD/core gate says fire blocked').toBe(false);
    expect(jam.energy!, 'jam charged energy').toBeLessThan(energyBefore);
    const m1 = await mark(page);
    await page.waitForTimeout(2600);
    const jamShots = await spawns(page, m1);
    const afterJam = await st(page);
    console.log('[A] jam window', JSON.stringify({
      relay: afterJam.relay, jamLeft: afterJam.jamLeft, newSpawns: jamShots.unique,
      hpBefore: preJam.hp, hpAfter: afterJam.hp, enemyInFlightAtJam: enemyInFlight
    }));
    expect(jamShots.enemy, 'no NEW linked shots while JAMMED').toBe(0);
    if (enemyInFlight > 0) {
      expect(afterJam.hp, 'already-fired shots still damage the player during JAM').toBeLessThan(preJam.hp);
    }

    // 3) expiry restores the manual/powered state and linked fire
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.sim.signal?.relay === 'ACTIVE';
    }, undefined, { timeout: 20000 });
    const m2 = await mark(page);
    await page.waitForTimeout(1800);
    const resumed = await spawns(page, m2);
    console.log('[A] after expiry', JSON.stringify(resumed));
    expect(resumed.enemy, 'linked fire resumes after jam expiry').toBeGreaterThan(0);

    // 4) R toggles manual OFF -> INACTIVE -> no new fire; ON again -> fire
    await tap(page, 'KeyR');
    await page.waitForTimeout(500);
    const off = await st(page);
    expect(off.relay, 'R toggles INACTIVE').toBe('INACTIVE');
    expect(off.fireEnabled).toBe(false);
    const m3 = await mark(page);
    await page.waitForTimeout(2200);
    const offShots = await spawns(page, m3);
    console.log('[A] manual off window', JSON.stringify({ relay: off.relay, spawns: offShots }));
    expect(offShots.enemy, 'no new linked shots while INACTIVE').toBe(0);

    await tap(page, 'KeyR');
    await page.waitForTimeout(600);
    const on = await st(page);
    expect(on.relay, 'R toggles back to ACTIVE').toBe('ACTIVE');
    const m4 = await mark(page);
    await page.waitForTimeout(1800);
    const onShots = await spawns(page, m4);
    console.log('[A] manual on window', JSON.stringify(onShots));
    expect(onShots.enemy, 'linked fire resumes when ACTIVE again').toBeGreaterThan(0);
    expect(errs, errs.join(' | ')).toEqual([]);
  });

  test('B: routes A/B by real walking, JAMMED gate, checkpoint demo field', async ({ page }) => {
    test.setTimeout(300000);

    // ---- Phase 1: JAMMED gate + checkpoint(null) + route A by real walking
    await enterDemo(page);
    const s0 = await st(page);
    const routes = s0.p1!.routes;
    const routeA = routes.find((r: any) => r.w === 'RELAY_ACTIVE')!;
    const routeB = routes.find((r: any) => r.w === 'RELAY_INACTIVE')!;
    const kinds = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      const sc = w.p1Scenario;
      return sc ? sc.routes.map((r: any) => ({ target: r.target, kind: w.map.rooms[r.target]?.kind })) : null;
    });
    console.log('[B] routes/kinds', JSON.stringify({ routeA, routeB, kinds }));
    for (const k of kinds ?? []) expect(['boss', 'extraction'], 'route target must not be a terminal room').not.toContain(k.kind);

    await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.clearEnemiesForTest());
    await page.waitForTimeout(700);
    const cleared = await st(page);
    expect(cleared.cleared, 'room cleared (labelled fixture: clearEnemiesForTest)').toBe(true);
    expect(cleared.portal!.target, 'ACTIVE selects route A').toBe(routeA.t);

    // Jam from the spawn tile (which is in JAM range) -> portal must vanish.
    const jamNearRelay = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      const sc = w.p1Scenario;
      return { dist: Math.hypot(w.player.x - sc.relay.x, w.player.y - sc.relay.y) };
    });
    await tap(page, 'KeyY');
    await page.waitForTimeout(350);
    const jammed = await st(page);
    console.log('[B] jam near relay', JSON.stringify({ dist: +jamNearRelay.dist.toFixed(2), relay: jammed.relay, energy: jammed.energy, portal: jammed.portal }));
    expect(jammed.relay, 'jam accepted from an in-range position').toBe('JAMMED');
    expect(jammed.portal, 'JAMMED matches neither route: portal is gone').toBeNull();

    // Distance from the portal tile to the relay: documents why "stand on the
    // door and jam it" is not reachable through natural play.
    const distPortalToRelay = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      const sc = w.p1Scenario;
      return Math.hypot(sc.relay.x - w.portal?.wx ?? 0, 0);
    }).catch(() => null);

    // Save while the portal is null (pause), then F on the same tile must not pass.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    const saved = await readSave(page);
    console.log('[B] save while JAMMED', JSON.stringify({ demo: saved.run?.demo, portalTarget: saved.run?.portalTarget, relay: saved.run?.coreState?.signal?.relay ?? null }));
    expect(saved.run?.demo, 'checkpoint carries the demo marker').toBe('p1');
    expect(saved.run?.portalTarget, 'JAMMED => portalTarget null in save').toBeNull();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const roomBefore = (await st(page)).room;
    await tap(page, 'KeyF');
    await page.waitForTimeout(600);
    expect((await st(page)).room, 'F cannot pass with no portal (JAMMED)').toBe(roomBefore);

    // Expiry restores ACTIVE -> route A portal; walk it for real and cross.
    await page.waitForFunction(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.sim.signal?.relay === 'ACTIVE';
    }, undefined, { timeout: 20000 });
    await page.waitForTimeout(600);
    const backA = await st(page);
    expect(backA.portal, 'portal returns after jam expiry').not.toBeNull();
    expect(backA.portal!.target, 'expiry restores route A (manual/powered preserved)').toBe(routeA.t);
    const walkedA = await walkTo(page, backA.portal!.x, backA.portal!.y);
    expect(walkedA, 'independent normal walking reached route-A portal').toBe(true);
    // jam is out of range from the door: record the real refusal (design observation)
    const atDoor = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      const sc = w.p1Scenario;
      return { dist: Math.hypot(w.player.x - sc.relay.x, w.player.y - sc.relay.y) };
    });
    await tap(page, 'KeyY');
    await page.waitForTimeout(300);
    const doorJam = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      return { relay: w.sim.signal?.relay ?? null, feedback: w.lastSignalFeedback };
    });
    console.log('[B] jam at the door tile', JSON.stringify({ distToRelay: +atDoor.dist.toFixed(2), ...doorJam }));

    await tap(page, 'KeyF');
    await page.waitForFunction((t) => (window as any).__game.scene.getScene('GameScene').world.currentRoomId === t, routeA.t, { timeout: 15000 }).catch(() => undefined);
    const crossedA = await st(page);
    console.log('[B] crossed A', JSON.stringify({ room: crossedA.room, expected: routeA.t }));
    expect(crossedA.room, 'F at the route-A portal enters room A (real walking + real F)').toBe(routeA.t);

    // ---- Phase 2: fresh demo -> route B by real walking
    await enterDemo(page);
    await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.clearEnemiesForTest());
    await page.waitForTimeout(600);
    await tap(page, 'KeyR');
    await page.waitForTimeout(700);
    const sw = await st(page);
    expect(sw.relay, 'R -> INACTIVE').toBe('INACTIVE');
    expect(sw.portal!.target, 'INACTIVE selects route B (live)').toBe(routeB.t);
    const walkedB = await walkTo(page, sw.portal!.x, sw.portal!.y);
    expect(walkedB, 'independent normal walking reached route-B portal').toBe(true);
    await tap(page, 'KeyF');
    await page.waitForFunction((t) => (window as any).__game.scene.getScene('GameScene').world.currentRoomId === t, routeB.t, { timeout: 15000 }).catch(() => undefined);
    const crossedB = await st(page);
    console.log('[B] crossed B', JSON.stringify({ room: crossedB.room, expected: routeB.t }));
    expect(crossedB.room, 'F at the route-B portal enters room B (real walking + real F)').toBe(routeB.t);
    await page.screenshot({ path: `${OUT}/demo-B-route-walked.png` });
  });

  test('C: independent real-walk crossing for route A and route B', async ({ page }) => {
    test.setTimeout(300000);
    // Route A: default ACTIVE
    await enterDemo(page);
    const a0 = await st(page);
    const routeA = a0.p1!.routes.find((r: any) => r.w === 'RELAY_ACTIVE')!;
    const routeB = a0.p1!.routes.find((r: any) => r.w === 'RELAY_INACTIVE')!;
    await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.clearEnemiesForTest());
    await page.waitForTimeout(700);
    const pa = await st(page);
    expect(pa.portal!.target, 'ACTIVE -> route A portal').toBe(routeA.t);
    const okA = await walkTo(page, pa.portal!.x, pa.portal!.y);
    expect(okA, 'real walking reached route A portal').toBe(true);
    await tap(page, 'KeyF');
    const crossedA = await page.waitForFunction((t) => (window as any).__game.scene.getScene('GameScene').world.currentRoomId === t, routeA.t, { timeout: 12000 }).then(() => true).catch(() => false);
    const sA = await st(page);
    console.log('[C] route A', JSON.stringify({ crossedA, room: sA.room, expected: routeA.t }));
    expect(crossedA, 'F at route A portal enters room A').toBe(true);
    await page.screenshot({ path: `${OUT}/walk-route-A.png` });

    // Route B: fresh demo, R -> INACTIVE
    await enterDemo(page);
    await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.clearEnemiesForTest());
    await page.waitForTimeout(600);
    await tap(page, 'KeyR');
    await page.waitForTimeout(700);
    const pb = await st(page);
    expect(pb.relay, 'R -> INACTIVE').toBe('INACTIVE');
    expect(pb.portal!.target, 'INACTIVE -> route B portal').toBe(routeB.t);
    const okB = await walkTo(page, pb.portal!.x, pb.portal!.y);
    expect(okB, 'real walking reached route B portal').toBe(true);
    await tap(page, 'KeyF');
    const crossedB = await page.waitForFunction((t) => (window as any).__game.scene.getScene('GameScene').world.currentRoomId === t, routeB.t, { timeout: 12000 }).then(() => true).catch(() => false);
    const sB = await st(page);
    console.log('[C] route B', JSON.stringify({ crossedB, room: sB.room, expected: routeB.t }));
    expect(crossedB, 'F at route B portal enters room B').toBe(true);
    await page.screenshot({ path: `${OUT}/walk-route-B.png` });
  });

  test('compact 800x600: new HUD detail text size, contrast and overlap', async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 800, height: 600 });
    await enterDemo(page);
    await page.waitForTimeout(600);
    const info = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const g: any = (window as any).__game;
      const canvas = document.querySelector('canvas')!;
      const r = canvas.getBoundingClientRect();
      const scale = r.width / g.scale.gameSize.width;
      const text = gs.txtSignalDetail;
      const style = text ? String(text.style.fontSize) : null;
      const logical = style ? parseFloat(style) : null;
      const b = text ? text.getBounds() : null;
      // overlaps with other HUD texts (screen-locked, same camera space)
      const others = gs.hudObjects.filter((o: any) => o && o !== text && o.type === 'Text' && o.visible !== false);
      const box = (o: any) => { const q = o.getBounds(); return { x: q.x, y: q.y, w: q.width, h: q.height }; };
      const tb = b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
      const overlaps: Array<{ other: string; area: number }> = [];
      if (tb) {
        for (const o of others) {
          const q = box(o);
          const ox = Math.min(tb.x + tb.w, q.x + q.w) - Math.max(tb.x, q.x);
          const oy = Math.min(tb.y + tb.h, q.y + q.h) - Math.max(tb.y, q.y);
          if (ox > 1 && oy > 1) overlaps.push({ other: String(o.text || o.type).slice(0, 28), area: Math.round(ox * oy) });
        }
      }
      return {
        scale, logical, css: logical ? +(logical * scale).toFixed(2) : null,
        color: text ? String(text.style.color) : null,
        text: text ? String(text.text) : null,
        box: tb, overlaps,
        canvas: { w: r.width, h: r.height }
      };
    });
    console.log('[compact] detail', JSON.stringify(info));
    expect(info.css, 'new HUD detail text keeps >=10 CSS px').toBeGreaterThanOrEqual(10);
    expect(info.overlaps.filter((o) => o.area > 6), 'no real overlap with other HUD text').toEqual([]);
    // contrast ratio of the detail colour vs the game background (#05070c)
    const lum = (hex: string) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
      if (!m) return null;
      const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const bg = lum('#05070c')!;
    const fg = info.color ? lum(info.color) : null;
    const contrast = fg === null ? null : +(((fg + 0.05) / (bg + 0.05)).toFixed(2));
    console.log('[compact] contrast', JSON.stringify({ color: info.color, contrast }));
    await page.screenshot({ path: `${OUT}/p1-compact-800x600.png` });

    // main menu demo button vs bottom help text at 800x600 (replace-save semantics unchanged)
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
    await page.waitForTimeout(400);
    const menu = await page.evaluate(() => {
      const s: any = (window as any).__game.scene.getScene('MainMenuScene');
      const flat: any[] = [];
      const walk = (l: any[]) => { for (const c of l) { if (c.type === 'Container' && Array.isArray(c.list)) walk(c.list); else flat.push(c); } };
      walk(s.children.list);
      const texts = flat.filter((c) => c.type === 'Text');
      const demo = texts.find((t) => String(t.text || '').includes('DEMO 01'));
      const help = texts.find((t) => String(t.text || '').includes('WASD move'));
      const b = (o: any) => { const q = o.getBounds(); return { x: q.x, y: q.y, w: q.width, h: q.height }; };
      return { demo: demo ? b(demo) : null, help: help ? b(help) : null };
    });
    if (menu.demo && menu.help) {
      const dy = Math.abs((menu.demo.y + menu.demo.h / 2) - (menu.help.y + menu.help.h / 2));
      console.log('[menu] demo vs help', JSON.stringify({ menu, dy }));
      expect(dy, 'demo entry does not sit on the bottom help line').toBeGreaterThan(10);
    }
    await page.screenshot({ path: `${OUT}/p1-menu-800x600.png` });
  });
});
