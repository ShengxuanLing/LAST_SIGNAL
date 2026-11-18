// GAMEPLAY-01 P4 — RENDERED evidence for the formal DEMO-01/DEMO-03 World.
//
// Developer-owned evidence script (NOT tests/**, NOT a tester acceptance run).
// It drives the REAL product through real browser input (menu click, WASD, mouse
// fire, F, Y) and only READS state through the existing dev seam `window.__game`.
//
// Labels: agent (automated real input), fixture (a dev seam was used, labelled),
// autoOwner (automated owner control), human (never claimed here).
// NON-BLIND: the fight/steer loop reads canonical coordinates to choose keys.
// HUMAN ACCEPTANCE PENDING — nobody played this build by hand.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 5471);
const ROOT = path.resolve('reports/gameplay-01/developer/p4-recovery/rendered');
const SHOTS = path.join(ROOT, 'shots');
const OUT = path.join(ROOT, 'evidence');
const SAVE_KEY = 'last_signal_save_v1';
const LOCAL_W = 1280;
const LOCAL_H = 720;
const SEED = Number(process.env.P4_SEED ?? 20261117);

const evidence: Array<Record<string, unknown>> = [];
function record(item: string, data: Record<string, unknown>): void {
  evidence.push({ item, at: new Date().toISOString(), ...data });
}
function flush(): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, 'p4-rendered-evidence.json'), JSON.stringify(evidence, null, 2));
}
async function shot(page: Page, name: string): Promise<string> {
  mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `p4-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function canvasBox(page: Page) {
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!box) throw new Error('no canvas');
  return box;
}

async function clickLogical(page: Page, lx: number, ly: number): Promise<void> {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + (lx * box.w) / LOCAL_W, box.y + (ly * box.h) / LOCAL_H);
}

async function clickLabel(page: Page, sceneKey: string, label: string): Promise<void> {
  const logical = await page.evaluate(({ key, label }) => {
    const g = (window as any).__game;
    const s = g.scene.getScene(key);
    if (!s || !g.scene.isActive(key)) return null;
    const flat: any[] = [];
    const walk = (list: any[]) => {
      for (const c of list) {
        if (c.type === 'Container' && Array.isArray(c.list)) { walk(c.list); continue; }
        flat.push(c);
      }
    };
    walk(s.children.list);
    const centre = (c: any) => {
      const b = c.getBounds ? c.getBounds() : null;
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
    };
    const matches = flat.filter((c) => c.type === 'Text' && c.visible !== false && c.text && String(c.text).includes(label));
    if (!matches.length) return null;
    const interactive = flat.filter((c) => c.input && c.input.enabled !== false && c.visible !== false);
    const pick = matches.find((m) => {
      const c = centre(m);
      if (!c) return false;
      if (m.input) return true;
      return interactive.some((o) => {
        const oc = centre(o);
        return !!oc && Math.abs(oc.x - c.x) <= 4 && Math.abs(oc.y - c.y) <= 4;
      });
    }) ?? matches[0];
    return centre(pick);
  }, { key: sceneKey, label });
  expect(logical, `label "${label}" visible in ${sceneKey}`).not.toBeNull();
  await clickLogical(page, logical!.x, logical!.y);
  await page.waitForTimeout(300);
}

async function snap(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    if (!gs || !gs.world) return null;
    const w: any = gs.world;
    const room = w.currentRoom ? w.currentRoom() : null;
    const rec = room ? w.map.rooms[room.id] : null;
    const sig = w.signalView ? w.signalView() : null;
    const sim = w.sim;
    return {
      tick: sim.tick,
      active: g.scene.getScenes(true).map((s: any) => s.sys.settings.key),
      room: room ? { id: room.id, kind: room.kind, cleared: !!(rec && rec.cleared), spawned: !!(rec && rec.spawned) } : null,
      player: { x: w.player.wx, y: w.player.wy, hp: w.player.data.hp },
      portal: w.portal ? { x: w.portal.wx, y: w.portal.wy, target: w.portal.targetRoom } : null,
      routeTarget: w.p1RouteTarget ?? null,
      linkedFire: w.p1LinkedFireEnabled ?? null,
      relay: sig ? { state: sig.relay, manual: sig.manualEnabled, powered: sig.powered, energy: sig.playerEnergy } : null,
      authored: sim.authored ?? null,
      scenario: w.p1Scenario ? {
        roomId: w.p1Scenario.roomId,
        startRoomId: w.p1Scenario.startRoomId,
        relay: w.p1Scenario.relay,
        playerStart: w.p1Scenario.playerStart ?? null,
        drones: w.p1Scenario.drones,
        routes: w.p1Scenario.routes
      } : null,
      enemyHp: ((w.enemies as any[]) ?? []).map((e: any) => e._data?.hp ?? null),
      objective: gs.txtObjective ? String(gs.txtObjective.text) : ''
    };
  });
}

/** REAL input fight loop (NON-BLIND steering: reads canonical coordinates). */
async function fightUntilCleared(page: Page, maxMs = 180000) {
  const started = Date.now();
  let shots = 0;
  let approaches = 0;
  let firstHp: number | null = null;
  const diag: Array<Record<string, unknown>> = [];
  while (Date.now() - started < maxMs) {
    const info = await page.evaluate(() => {
      const g = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      if (!gs || !g.scene.isActive('GameScene') || !gs.world) return null;
      const w: any = gs.world;
      const list = ((w.enemies as any[]) ?? []).map((e: any) => {
        const x = typeof e._wx === 'number' ? e._wx : (e.wx ?? e.x);
        const y = typeof e._wy === 'number' ? e._wy : (e.wy ?? e.y);
        const hp = e._hp ?? e.hp ?? null;
        return { x, y, hp, d: Math.hypot(x - w.player.wx, y - w.player.wy) };
      }).filter((e: any) => (e.hp ?? 0) > 0).sort((a: any, b: any) => a.d - b.d);
      const pick = list[0] ?? null;
      let screen = null;
      if (pick) {
        const cam = gs.cameras.main;
        const d = w.worldToScreen(pick.x, pick.y);
        const p0 = cam.getWorldPoint(0, 0);
        const px = cam.getWorldPoint(100, 0);
        const py = cam.getWorldPoint(0, 100);
        const ax = (px.x - p0.x) / 100, bx = p0.x;
        const ay = (py.y - p0.y) / 100, by = p0.y;
        screen = { x: (d.x - bx) / ax, y: (d.y - by) / ay };
      }
      const room = w.currentRoom();
      const rec = room ? w.map.rooms[room.id] : null;
      return {
        enemy: pick ? { ...pick, screen } : null,
        cleared: !!(rec && rec.cleared),
        portal: w.portal ? { target: w.portal.targetRoom } : null,
        hp: w.player.data.hp,
        player: { x: w.player.wx, y: w.player.wy },
        enemies: list.length,
        weapon: w.player.data.weapons?.[0]?.ammo ?? null,
        dead: g.scene.isActive('GameOverScene')
      };
    });
    if (!info) return { shots, approaches, cleared: false, died: true, firstHp, diag };
    if (firstHp === null) firstHp = info.hp;
    diag.push({ t: Date.now() - started, hp: info.hp, enemies: info.enemies, ammo: info.weapon,
      player: info.player, enemy: info.enemy ? { x: info.enemy.x, y: info.enemy.y, hp: info.enemy.hp, d: info.enemy.d } : null });
    if (diag.length > 30) diag.shift();
    if (info.dead || info.hp <= 0) return { shots, approaches, cleared: false, died: true, firstHp, diag };
    if (info.cleared) return { shots, approaches, cleared: true, died: false, firstHp, diag };
    const target = info.enemy;
    if (!target) {
      // No living enemy sprite left: let the core commit the clear.
      await page.waitForTimeout(250);
      continue;
    }
    if (target.d > 4.5) {
      const dx = target.x - info.player.x, dy = target.y - info.player.y;
      const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : (dy > 0 ? 'KeyS' : 'KeyW');
      await page.keyboard.down(key);
      await page.waitForTimeout(280);
      await page.keyboard.up(key);
      approaches++;
      continue;
    }
    if (!target.screen) continue;
    const box = await canvasBox(page);
    await page.mouse.move(box.x + (target.screen.x * box.w) / LOCAL_W, box.y + (target.screen.y * box.h) / LOCAL_H);
    await page.mouse.down();
    await page.waitForTimeout(320);
    await page.mouse.up();
    shots++;
    await page.waitForTimeout(60);
  }
  const fin = await snap(page);
  return { shots, approaches, cleared: !!fin?.room?.cleared, died: false, firstHp, diag };
}

async function pressToward(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, ms: number): Promise<void> {
  const dx = to.x - from.x, dy = to.y - from.y;
  const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : (dy > 0 ? 'KeyS' : 'KeyW');
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(40);
}

async function walkToPortal(page: Page, maxMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const info = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const w: any = gs.world;
      return {
        player: { x: w.player.wx, y: w.player.wy },
        portal: w.portal ? { x: w.portal.wx, y: w.portal.wy } : null
      };
    });
    if (!info.portal) return { arrived: false, reason: 'no-portal' };
    const d = Math.hypot(info.portal.x - info.player.x, info.portal.y - info.player.y);
    if (d < 0.9) return { arrived: true, reason: 'at-portal', distance: d };
    await pressToward(page, info.player, info.portal, d > 3 ? 300 : 90);
  }
  return { arrived: false, reason: 'timeout' };
}

async function bootDemo(page: Page, seed: number): Promise<void> {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate((key) => localStorage.removeItem(key), SAVE_KEY);
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.evaluate((s) => {
    const g: any = (window as any).__game;
    const menu: any = g.scene.getScene('MainMenuScene');
    const orig = menu.scene.start.bind(menu.scene);
    menu.scene.start = (key: string, data?: any) =>
      key === 'GameScene' ? orig(key, { ...(data ?? {}), seed: s }) : orig(key, data);
  }, seed);
  await clickLabel(page, 'MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(900);
}

test.describe('GAMEPLAY-01 P4 · rendered DEMO-01 cooperative level', () => {
  test.setTimeout(300000);
  test.afterAll(() => flush());

  test('A) real menu entry, early playable state, real clear, authored portal, route entry', async ({ page }) => {
    await bootDemo(page, SEED);
    const early = await snap(page);
    expect(early, 'world exists').not.toBeNull();
    expect(early!.active, 'no DEMO UNAVAILABLE fallback').toContain('GameScene');
    expect(early!.scenario, 'authored scenario active').not.toBeNull();
    // M5: start room captured before the kind mutation.
    expect(early!.scenario!.startRoomId).toBe(early!.scenario!.roomId);
    expect(early!.authored, 'M2: authored identity is in the CORE state').not.toBeNull();
    // M3: no device on the player, no stacked sentries.
    const s = early!.scenario!;
    const distDevice = Math.hypot(s.relay.x - s.playerStart!.x, s.relay.y - s.playerStart!.y);
    expect(distDevice).toBeGreaterThanOrEqual(1.5);
    expect(Math.hypot(s.drones[0].x - s.drones[1].x, s.drones[0].y - s.drones[1].y)).toBeGreaterThanOrEqual(2);
    // M1: the room starts UNCLEARED and no authored portal exists yet.
    expect(early!.room!.cleared).toBe(false);
    expect(early!.portal).toBeNull();
    expect(early!.relay!.state).toBe('ACTIVE');
    expect(early!.linkedFire).toBe(true);
    const earlyShot = await shot(page, '1-early-playable');
    record('rendered-early', {
      seed: SEED, tick: early!.tick, shot: earlyShot,
      relay: early!.relay, linkedFire: early!.linkedFire, objective: early!.objective,
      scenario: early!.scenario, portal: early!.portal, player: early!.player, room: early!.room
    });

    const fight = await fightUntilCleared(page);
    record('rendered-fight', { seed: SEED, shots: fight.shots, approaches: fight.approaches, cleared: fight.cleared, hp: fight.firstHp, diag: fight.diag });
    expect(fight.died, 'the solo player must not die in the authored opening').toBe(false);
    expect(fight.cleared, 'the room is cleared by REAL fire input').toBe(true);
    await page.waitForTimeout(500);
    const cleared = await snap(page);
    expect(cleared!.room!.cleared, 'canonical map flag cleared').toBe(true);
    // M7: the presented portal is the authored CELL CENTRE and the interaction
    // point is that same point (no half-tile offset).
    const routePortals = cleared!.scenario!.routes.map((r: any) => r.portal);
    expect(routePortals).toContainEqual({ x: cleared!.portal!.x, y: cleared!.portal!.y });
    expect(cleared!.portal!.target).toBe(cleared!.routeTarget);
    expect(cleared!.routeTarget).toBe(cleared!.scenario!.routes[0].target);
    const clearedShot = await shot(page, '2-cleared-authored-portal');
    record('rendered-clear', {
      seed: SEED, tick: cleared!.tick, shots: fight.shots, approaches: fight.approaches,
      hpStart: fight.firstHp, hpEnd: cleared!.player.hp,
      portal: cleared!.portal, routeTarget: cleared!.routeTarget,
      room: cleared!.room, shot: clearedShot
    });

    // Jam at the door (product decision): the door is INSIDE jam range, so
    // standing on the authored portal and pressing Y naturally closes the route.
    const walkBefore = await walkToPortal(page);
    const atDoor = await snap(page);
    const distanceRelayDoor = atDoor!.portal
      ? Math.hypot(atDoor!.portal.x - s.relay.x, atDoor!.portal.y - s.relay.y) : null;
    record('rendered-at-door', { seed: SEED, walkBefore, distanceRelayDoor, portal: atDoor!.portal });
    await shot(page, '3-at-authored-door');
    // Real jam cost (review F3): JAM_COST is 25 (src/signal/signalTuning.ts); one
    // tick of regen may refund 1-2 points, so assert a bounded real cost.
    const JAM_COST = 25;
    const energyBeforeJam = atDoor!.relay!.energy as number;
    await page.keyboard.press('KeyY');
    await page.waitForTimeout(500);
    const jammed = await snap(page);
    const energyAfterJam = jammed!.relay!.energy as number;
    const jamCost = energyBeforeJam - energyAfterJam;
    record('rendered-jammed-at-door', {
      seed: SEED, relay: jammed!.relay, portal: jammed!.portal, routeTarget: jammed!.routeTarget,
      roomCleared: jammed!.room!.cleared,
      energyBeforeJam, energyAfterJam, jamCost, jamCostExpected: JAM_COST
    });
    expect(jammed!.relay!.state).toBe('JAMMED');
    expect(jamCost, 'standing Jam at the authored door costs real energy').toBeGreaterThanOrEqual(JAM_COST - 2);
    expect(jamCost).toBeLessThanOrEqual(JAM_COST);
    expect(jammed!.routeTarget).toBeNull();
    expect(jammed!.portal).toBeNull();
    expect(jammed!.room!.cleared, 'JAM does not un-clear the room').toBe(true);
    await shot(page, '4-jam-closes-route');

    // F while jammed: no room change (the gate is a real safety assertion).
    const beforeRoom = jammed!.room!.id;
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(700);
    const afterJamF = await snap(page);
    expect(afterJamF!.room!.id, 'F while JAMMED must not change the room').toBe(beforeRoom);

    // Jam expiry restores the SAME committed route from the relay state.
    await page.waitForTimeout(7000);
    const expired = await snap(page);
    record('rendered-jam-expired', {
      seed: SEED, relay: expired!.relay, portal: expired!.portal, routeTarget: expired!.routeTarget
    });
    expect(expired!.relay!.state).toBe('ACTIVE');
    expect(expired!.routeTarget).toBe(cleared!.scenario!.routes[0].target);
    expect(expired!.portal).not.toBeNull();
    await shot(page, '5-jam-expired-route-restored');

    // Walk onto the authored door and press F: a REAL route transition.
    const arrived = await walkToPortal(page);
    expect(arrived.arrived, JSON.stringify(arrived)).toBe(true);
    await page.waitForTimeout(200);
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(1200);
    const entered = await snap(page);
    record('rendered-route-entry', {
      seed: SEED, arrived, fromRoom: beforeRoom, toRoom: entered!.room!.id,
      routeTarget: cleared!.routeTarget, status: entered!.active
    });
    expect(entered!.room!.id, 'F at the authored door enters the route target').toBe(cleared!.routeTarget);
    await shot(page, '6-entered-route-a');
  });

  test('B) checkpoint restore re-derives the authored portal from the committed relay (M2)', async ({ page }) => {
    await bootDemo(page, SEED);
    const fight = await fightUntilCleared(page);
    record('rendered-fight-b', { seed: SEED, shots: fight.shots, approaches: fight.approaches, cleared: fight.cleared, hp: fight.firstHp, diag: fight.diag });
    expect(fight.cleared).toBe(true);
    await page.waitForTimeout(600);
    const cleared = await snap(page);
    const savedPortal = cleared!.portal;
    expect(savedPortal).not.toBeNull();

    // Reload = exit/refresh: the last checkpoint is restored (never a new R0).
    await page.reload();
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 20000 });
    await page.waitForTimeout(500);
    await clickLabel(page, 'MainMenuScene', 'CONTINUE');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
    await page.waitForTimeout(1200);
    const restored = await snap(page);
    record('rendered-restore', {
      seed: SEED,
      savedPortal,
      restoredPortal: restored!.portal,
      restoredRouteTarget: restored!.routeTarget,
      restoredAuthored: restored!.authored,
      restoredRoom: restored!.room,
      restoredScenarioStartRoomId: restored!.scenario?.startRoomId ?? null
    });
    expect(restored!.authored, 'demo identity survives the World restore').not.toBeNull();
    expect(restored!.room!.cleared, 'the cleared authored room is restored').toBe(true);
    expect(restored!.routeTarget, 'route target is re-derived, not inherited').toBe(cleared!.routeTarget);
    expect(restored!.portal, 'the authored portal is re-derived from the committed relay').toEqual(savedPortal);
    await shot(page, '7-restored-authored-portal');
  });
});
