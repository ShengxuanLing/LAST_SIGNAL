// GAMEPLAY-01 · P1 (DEMO 01 · LINKED SENTRY) acceptance spec.
//
// Tester-owned. Read-only w.r.t. src: this file drives the REAL product through
// real browser input and only reads public/core state through the existing
// dev/test seams for observation.
//
// Runner labels used in every record:
//   agent    — Agent-driven real mouse/keyboard (NOT a human)
//   fixture  — a dev/test seam did something (labelled per use)
//   autoOwner— an automated click on an Owner control (never a human)
//   human    — an actual person (none here → HUMAN ACCEPTANCE PENDING)
//
// The authored contract under test is the frozen P1 patch on c7e03c5
// (12 source files, hashes recorded in reports/gameplay-01/developer/p1/final/
// manifest.json). Nothing here claims a full natural playthrough: only the
// per-test facts it actually measures.

import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 5480);
const OUT = path.resolve(process.env.P1_EVIDENCE_DIR ?? 'reports/gameplay-01/tester/evidence');
const SHOTS = path.resolve(process.env.LS_SHOT_DIR ?? 'reports/gameplay-01/tester/shots');
const SAVE_KEY = 'last_signal_save_v1';
const LOCAL_W = 1280;
const LOCAL_H = 720;

/** Real Signal tuning (src/signal/signalTuning.ts) — used as expectations. */
const TUNE = { SCAN_COST: 10, JAM_COST: 25, JAM_RANGE: 6, JAM_DURATION_TICKS: 360, ENERGY_MAX: 100 };

const metrics: Array<Record<string, unknown>> = [];
function record(item: string, data: Record<string, unknown>): void {
  metrics.push({ item, at: new Date().toISOString(), ...data });
}
function flush(): string {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'p1-acceptance.json');
  writeFileSync(file, JSON.stringify(metrics, null, 2));
  return file;
}
async function shot(page: Page, name: string): Promise<string> {
  mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `p1-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}
/**
 * One real frame edge for a single-frame key (T/Y/R/F): keydown -> at least one
 * real game frame -> keyup. Phaser's `press()` can lose `JustDown` at a frame
 * boundary, which made the same assertion fail in a full-suite run and pass in
 * isolation (diagnosed 2026-11-18). Input-driver fix only: no result threshold,
 * timeout or assertion is relaxed.
 */
async function tapKey(page: Page, code: string): Promise<void> {
  const t0 = await page.evaluate(() => (window as any).__game?.loop?.frame ?? -1);
  await page.keyboard.down(code);
  await page.waitForFunction((f: number) => ((window as any).__game?.loop?.frame ?? f) > f, t0, { timeout: 4000 });
  await page.keyboard.up(code);
  await page.waitForTimeout(120);
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
    const box = (c: any) => {
      const b = c.getBounds ? c.getBounds() : null;
      return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
    };
    const centre = (c: any) => { const b = box(c); return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null; };
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
  await page.waitForTimeout(250);
}

/** Real menu entry: DEMO 01 · LINKED SENTRY (optional seed override). */
async function bootDemo(page: Page, seed?: number): Promise<void> {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate((key) => localStorage.removeItem(key), SAVE_KEY);
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 20000 });
  await page.waitForTimeout(400);
  if (seed !== undefined) {
    await page.evaluate((s) => {
      const g: any = (window as any).__game;
      const menu: any = g.scene.getScene('MainMenuScene');
      const orig = menu.scene.start.bind(menu.scene);
      menu.scene.start = (key: string, data?: any) =>
        key === 'GameScene' ? orig(key, { ...(data ?? {}), seed: s }) : orig(key, data);
    }, seed);
  }
  await clickLabel(page, 'MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
  // Readiness by real state, not by a fixed sleep: the scene can be "active"
  // while create() is still running (world/cameras not built yet), and a key
  // pressed in that window is lost. No assertion is relaxed by this wait.
  await page.waitForFunction(() => {
    const gs: any = (window as any).__game?.scene.getScene('GameScene');
    return !!gs?.world && gs.world.sim.tick > 0 && !!gs.cameras?.main && gs.world.p1Scenario !== undefined;
  }, undefined, { timeout: 30000 });
  await page.waitForTimeout(400);
}

async function snap(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const w = gs.world;
    if (!w) return null;
    const sig = w.signalView ? w.signalView() : null;
    const sc = w.p1Scenario;
    return {
      tick: w.sim.tick,
      seed: gs.seed ?? null,
      paused: gs.paused,
      room: w.currentRoom() ? {
        id: w.currentRoom().id,
        kind: w.currentRoom().kind,
        cleared: !!(w.map.rooms[w.currentRoom().id] && w.map.rooms[w.currentRoom().id].cleared)
      } : null,
      player: { x: w.player.wx, y: w.player.wy, hp: w.player.data.hp },
      portal: w.portal ? { x: w.portal.wx, y: w.portal.wy, target: w.portal.targetRoom } : null,
      relay: sig ? { state: sig.relay, manual: sig.manualEnabled, powered: sig.powered, jamUntil: sig.jammedUntilTick, evidence: sig.evidence } : null,
      energy: sig ? { playerEnergy: sig.playerEnergy, scanCD: sig.playerScanCD, jamCD: sig.playerJamCD } : null,
      p1: sc ? {
        roomId: sc.roomId,
        relay: sc.relay,
        routes: sc.routes.map((r: any) => ({ target: r.target, when: r.when })),
        drones: sc.drones.length
      } : null,
      linkedFire: w.p1LinkedFireEnabled ?? null,
      jamRemaining: w.p1JamRemainingTicks ?? null,
      routeTarget: w.p1RouteTarget ?? null,
      objective: gs.txtObjective ? String(gs.txtObjective.text) : '',
      enemies: (w.enemies ?? []).length,
      drones: (w.sim.drones ?? []).length,
      active: g.scene.getScenes(true).map((s: any) => s.sys.settings.key)
    };
  });
}

/**
 * Real, player-reachable signal strategy: the DEMO 01 run starts on the relay
 * tile, so Y is inside JAM_RANGE and the linked sentries stop firing for the
 * authored jam window. Returns the relay state after the press.
 */
async function jamFromStart(page: Page): Promise<{ relay: string | null; jamLeft: number | null; energy: number | null }> {
  const before = await snap(page);
  expect(before!.relay!.state, 'relay is ACTIVE before the jam').toBe('ACTIVE');
  await tapKey(page, 'KeyY');
  await page.waitForTimeout(450);
  const after = await snap(page);
  return { relay: after!.relay!.state, jamLeft: after!.jamRemaining, energy: after!.energy!.playerEnergy };
}

/**
 * Real combat driver — NON-BLIND. The direction/aim decision reads canonical
 * state (`world.enemies`, `_data.hp`, world→screen projection); movement and
 * firing are real keyboard/mouse events and nothing writes game state.
 * It is therefore NOT a human blind playtest and NOT a legal Player-model chain.
 */
async function fightUntilCleared(page: Page, maxMs: number) {
  const started = Date.now();
  const diag: Array<Record<string, unknown>> = [];
  let shots = 0;
  let approaches = 0;
  let firstHp = null as number | null;
  let minEnemies = Infinity;
  while (Date.now() - started < maxMs) {
    const info = await page.evaluate(() => {
      const g = (window as any).__game;
      const active = g.scene.getScenes(true).map((s: any) => s.sys.settings.key);
      const gs: any = g.scene.getScene('GameScene');
      if (!gs || !g.scene.isActive('GameScene') || !gs.world || !gs.cameras?.main) {
        return { enemy: null, cleared: false, hp: null, player: null, enemies: 0, active };
      }
      const w: any = gs.world;
      const room = w.currentRoom();
      const list = ((w.enemies as any[]) ?? []).map((e: any) => {
        const x = typeof e._wx === 'number' ? e._wx : (e.wx ?? e.x);
        const y = typeof e._wy === 'number' ? e._wy : (e.wy ?? e.y);
        const hp = e._data?.hp ?? e.data?.hp ?? null;
        return { x, y, hp, d: Math.hypot(x - w.player.wx, y - w.player.wy) };
      }).sort((a, b) => a.d - b.d);
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
      const roomRec = room ? w.map.rooms[room.id] : null;
      return {
        enemy: pick ? { ...pick, screen } : null,
        // `currentRoom()` is a RoomInfo copy; the canonical clear flag lives on
        // the map room record.
        cleared: !!(roomRec && roomRec.cleared),
        roomFlags: roomRec ? {
          spawned: !!roomRec.spawned,
          pendingEnter: w.pendingRoomEnters ? w.pendingRoomEnters.has(roomRec.id) : null,
          kind: roomRec.kind
        } : null,
        core: { drones: (w.sim.drones ?? []).length, targets: (w.sim.targets ?? []).length },
        portal: w.portal ? { target: w.portal.targetRoom } : null,
        hp: w.player.data.hp,
        player: { x: w.player.wx, y: w.player.wy },
        enemies: list.length,
        weapon: { key: w.player.data.weaponKey, ammo: w.player.data.weapons?.[0]?.ammo ?? null, magazine: w.player.data.weapons?.[0]?.magazine ?? null, reloading: w.player.data.weapons?.[0]?.reloading ?? null },
        projectiles: (w.projectiles ?? []).length,
        active
      };
    });
    if (firstHp === null) firstHp = info.hp;
    minEnemies = Math.min(minEnemies, info.enemies);
    if (info.active.includes('GameOverScene') || !info.player) {
      return { shots, approaches, cleared: false, hp: info.hp, died: info.active.includes('GameOverScene'), firstHp, minEnemies, active: info.active };
    }
    {
      diag.push({
        t: Date.now() - started, enemies: info.enemies, hp: info.hp,
        player: info.player, enemy: info.enemy ? { x: info.enemy.x, y: info.enemy.y, hp: info.enemy.hp, d: Math.round(info.enemy.d * 10) / 10, screen: info.enemy.screen && { x: Math.round(info.enemy.screen.x), y: Math.round(info.enemy.screen.y) } } : null,
        weapon: info.weapon, projectiles: info.projectiles,
        roomFlags: info.roomFlags, core: info.core, portal: info.portal
      });
      if (diag.length > 40) diag.shift();
    }
    if (info.cleared) return { shots, approaches, cleared: true, hp: info.hp, died: false, firstHp, minEnemies, diag };
    const target = info.enemy;
    if (!target) {
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(200);
      await page.keyboard.up('KeyD');
      continue;
    }
    // Close the distance first (real keys); fire when inside weapon range.
    if (target.d > 4.5) {
      const dx = target.x - info.player.x, dy = target.y - info.player.y;
      const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : (dy > 0 ? 'KeyS' : 'KeyW');
      await page.keyboard.down(key);
      await page.waitForTimeout(300);
      await page.keyboard.up(key);
      approaches++;
      continue;
    }
    if (!target.screen) continue;
    const box = await canvasBox(page);
    await page.mouse.move(box.x + (target.screen.x * box.w) / LOCAL_W, box.y + (target.screen.y * box.h) / LOCAL_H);
    await page.mouse.down();
    await page.waitForTimeout(360);
    await page.mouse.up();
    shots++;
    await page.waitForTimeout(70);
  }
  const fin = await snap(page);
  return { shots, approaches, cleared: !!fin?.room?.cleared, hp: fin?.player.hp ?? null, died: false, firstHp, minEnemies, diag };
}

/** Walk to the portal with real keys, then press F. Returns whether the room changed. */
async function walkToPortalAndEnter(page: Page, maxMs = 30000) {
  const started = Date.now();
  const before = await snap(page);
  while (Date.now() - started < maxMs) {
    const info = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return {
        player: { x: w.player.wx, y: w.player.wy },
        portal: w.portal ? { x: w.portal.wx, y: w.portal.wy } : null,
        room: w.currentRoom()?.id ?? null,
        paused: (window as any).__game.scene.getScene('GameScene').paused
      };
    });
    if (!info.portal) return { entered: false, reason: 'no-portal', before };
    const dx = info.portal.x - info.player.x;
    const dy = info.portal.y - info.player.y;
    if (Math.hypot(dx, dy) < 1.0) {
      await tapKey(page, 'KeyF');
      await page.waitForTimeout(900);
      const after = await snap(page);
      return { entered: (after?.room?.id ?? null) !== before?.room?.id, reason: 'interact', before, after };
    }
    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : (dy > 0 ? 'KeyS' : 'KeyW');
    await page.keyboard.down(key);
    await page.waitForTimeout(90);
    await page.keyboard.up(key);
    await page.waitForTimeout(30);
  }
  return { entered: false, reason: 'timeout', before };
}

test.describe('GAMEPLAY-01 P1 · DEMO 01 (Linked Sentry) acceptance', () => {
  // Every test boots its own run through the real menu (no cross-test state), so
  // the default ordering is used instead of serial mode: one failure must not
  // discard the following tests. Per-test budget stays 240000 ms.
  test.setTimeout(240000);
  test.afterAll(() => {
    // eslint-disable-next-line no-console
    console.log('P1_METRICS ' + flush());
  });

  test('1) real menu entry: relay ACTIVE, linked drones, T/Y costs and jam expiry', async ({ page }) => {
    await bootDemo(page);
    const base = await snap(page);
    expect(base, 'world exists').not.toBeNull();
    expect(base!.p1, 'authored P1 scenario is active on a normal DEMO 01 entry').not.toBeNull();
    expect(base!.active, 'no scenario-unavailable route').toContain('GameScene');
    expect(base!.relay!.state, 'authored relay starts ACTIVE').toBe('ACTIVE');
    expect(base!.linkedFire, 'linked drones may fire while ACTIVE').toBe(true);
    expect(base!.p1!.drones, 'authored sentries were placed').toBeGreaterThan(0);
    const energy0 = base!.energy!.playerEnergy;
    // Read-only capture of committed core events: wrap the EXISTING stepFrame
    // (no extra step, no input change) so the scan/jam deduction can be asserted
    // from the event payload instead of from a post-sample net delta.
    await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      (window as any).__p1Events = [];
      (window as any).__p1Batches = [];
      const orig = w.stepFrame.bind(w);
      w.stepFrame = (dt: number, intent: any, echoIntent?: any) => {
        // Pre-tick energy is the authoritative "before" when no regen event was
        // emitted inside the batch (energy events only appear on regen ticks).
        const pre = w.signalView()?.playerEnergy ?? null;
        const ev = orig(dt, intent, echoIntent) ?? [];
        if (ev.length) {
          (window as any).__p1Events.push(...ev);
          (window as any).__p1Batches.push({ pre, ev });
        }
        return ev;
      };
    });

    // Real key input: T = scan.
    await tapKey(page, 'KeyT');
    // Wait for the committed scan (cooldown starts) instead of a fixed delay.
    await page.waitForFunction(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const v = w.signalView();
      return !!v && (v.playerScanCD > 0 || v.evidence > 0);
    }, undefined, { timeout: 8000 });
    const scanned = await snap(page);
    // EXACT cost from the committed event: the last energy-bearing event before
    // the scan commit is the authoritative "before" (regen ticks are listed
    // separately), so regen can never be used as tolerance.
    const scanCommit = await page.evaluate(() => {
      const batches = ((window as any).__p1Batches ?? []) as any[];
      for (const b of batches) {
        const i = (b.ev as any[]).findIndex((e) => e.type === 'signal-scanned');
        if (i < 0) continue;
        let before: number | null = null;
        for (let k = i - 1; k >= 0; k--) {
          if (typeof b.ev[k].energy === 'number') { before = b.ev[k].energy; break; }
        }
        const regenInBatch = (b.ev as any[]).slice(0, i).filter((e) => e.type === 'signal-energy').length;
        if (before === null) before = b.pre;
        return {
          actorId: b.ev[i].actorId, ok: b.ev[i].ok !== false, energy: b.ev[i].energy,
          before, regenEvents: regenInBatch, cooldownTicks: b.ev[i].cooldownTicks,
          source: regenInBatch > 0 ? 'regen-event-in-batch' : 'pre-tick-energy'
        };
      }
      return null;
    });
    expect(scanCommit, 'scan committed a signal-scanned event').not.toBeNull();
    expect(scanCommit!.ok, 'scan was accepted by the core').toBe(true);
    expect(scanCommit!.actorId, 'the scan was committed by the PLAYER actor').toBe(0);
    expect(scanCommit!.before, 'an energy reading exists before the commit').not.toBeNull();
    expect(scanCommit!.before! - scanCommit!.energy, `scan deducts exactly ${TUNE.SCAN_COST}`).toBe(TUNE.SCAN_COST);
    // Post-sample net delta is recorded only as an observation (includes regen).
    const scanDelta = energy0 - scanned!.energy!.playerEnergy;
    expect(scanned!.relay!.evidence, 'scan produced real evidence').toBeGreaterThan(0);
    expect(scanned!.energy!.scanCD, 'scan cooldown is running').toBeGreaterThan(0);

    // Real key input: Y = jam.
    await tapKey(page, 'KeyY');
    await page.waitForFunction(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const v = w.signalView();
      return !!v && v.relay === 'JAMMED';
    }, undefined, { timeout: 8000 });
    const jammed = await snap(page);
    expect(jammed!.relay!.state, 'jam puts the relay into JAMMED').toBe('JAMMED');
    const jamCommit = await page.evaluate(() => {
      const batches = ((window as any).__p1Batches ?? []) as any[];
      for (const b of batches) {
        const i = (b.ev as any[]).findIndex((e) => e.type === 'signal-jammed');
        if (i < 0) continue;
        let before: number | null = null;
        for (let k = i - 1; k >= 0; k--) {
          if (typeof b.ev[k].energy === 'number') { before = b.ev[k].energy; break; }
        }
        const regenInBatch = (b.ev as any[]).slice(0, i).filter((e) => e.type === 'signal-energy').length;
        if (before === null) before = b.pre;
        return {
          actorId: b.ev[i].actorId, ok: b.ev[i].ok !== false, energy: b.ev[i].energy, before,
          relay: b.ev[i].relay, jamExpiresAtTick: b.ev[i].jamExpiresAtTick,
          regenEvents: regenInBatch,
          source: regenInBatch > 0 ? 'regen-event-in-batch' : 'pre-tick-energy'
        };
      }
      return null;
    });
    expect(jamCommit, 'jam committed a signal-jammed event').not.toBeNull();
    expect(jamCommit!.ok, 'jam was accepted by the core').toBe(true);
    expect(jamCommit!.actorId, 'the jam was committed by the PLAYER actor').toBe(0);
    expect(jamCommit!.before! - jamCommit!.energy, `jam deducts exactly ${TUNE.JAM_COST}`).toBe(TUNE.JAM_COST);
    expect(jamCommit!.relay, 'the committed jam event carries the relay state').toBe('JAMMED');
    const jamDelta = scanned!.energy!.playerEnergy - jammed!.energy!.playerEnergy;
    expect(jammed!.linkedFire, 'linked drones may not fire while JAMMED').toBe(false);
    expect(jammed!.jamRemaining, 'jam has a bounded remaining window').toBeGreaterThan(0);
    expect(jammed!.routeTarget, 'JAMMED matches neither authored route').toBeNull();
    await shot(page, '1-jammed');

    // Expiry through REAL ticks (6 s) restores ACTIVE without any extra input.
    const tickAtJam = jammed!.tick;
    await page.waitForFunction((tb: number) => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return w.sim.tick > tb + 380;
    }, tickAtJam, { timeout: 20000 });
    const expired = await snap(page);
    expect(expired!.relay!.state, 'jam expires back to ACTIVE').toBe('ACTIVE');
    expect(expired!.jamRemaining, 'no jam time remains').toBe(0);
    expect(expired!.linkedFire, 'linked fire resumes after expiry').toBe(true);
    expect(expired!.routeTarget, 'route A becomes selectable again').toBe(expired!.p1!.routes[0].target);
    await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      delete (w as any).stepFrame; // drop the own-property wrapper, back to the prototype
    });
    record('p1-relay-basics', {
      runner: 'agent (real T/Y keys)',
      fixtures: 'none',
      seed: base!.seed,
      scenario: base!.p1,
      energy: {
        start: energy0,
        afterScan: scanned!.energy!.playerEnergy,
        afterJam: jammed!.energy!.playerEnergy,
        exactScanCost: scanCommit!.before! - scanCommit!.energy,
        exactJamCost: jamCommit!.before! - jamCommit!.energy,
        scanRegenEventsBeforeCommit: scanCommit!.regenEvents,
        jamRegenEventsBeforeCommit: jamCommit!.regenEvents,
        netScanDelta: scanDelta, netJamDelta: jamDelta,
        note: 'exact costs come from the committed core events; net deltas are post-sample observations that include regen'
      },
      relay: { start: base!.relay!.state, jammed: jammed!.relay!.state, expired: expired!.relay!.state },
      ticks: { atJam: tickAtJam, expired: expired!.tick },
      routeTargets: { jammed: jammed!.routeTarget, expired: expired!.routeTarget, routeA: expired!.p1!.routes[0].target },
      shot: await shot(page, '1-relay-expired')
    });
  });

  test('2) route A reached by real walking + F after real combat (no teleport, no rescue)', async ({ page }) => {
    const t0 = Date.now();
    await bootDemo(page);
    // Real strategy: jam the relay (in range from the start tile) so the linked
    // sentries stop firing, then fight them normally.
    const jam = await jamFromStart(page);
    expect(jam.relay, 'jam is committed before the fight').toBe('JAMMED');
    const fight = await fightUntilCleared(page, 120000);
    record('p1-route-a', {
      runner: 'agent (real Y jam strategy + real mouse aim/click + real WASD)',
      fixtures: 'none (no clearEnemiesForTest, no setPlayerPositionForTest, no heal)',
      strategy: 'jam-first (player-reachable: start tile is inside JAM_RANGE)',
      jam,
      ms: Date.now() - t0,
      fight,
      cleared: fight.cleared
    });
    expect(fight.cleared, 'the authored combat room was cleared by real play').toBe(true);
    // The jam expires on real ticks (6 s) and route A (RELAY_ACTIVE) comes back.
    await page.waitForFunction(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return (w.signalView()?.relay ?? null) === 'ACTIVE';
    }, undefined, { timeout: 20000 });
    const beforeRoute = await snap(page);
    expect(beforeRoute!.relay!.state, 'relay returned to ACTIVE after the jam window').toBe('ACTIVE');
    expect(beforeRoute!.portal, 'route A portal exists once the room is cleared').not.toBeNull();
    expect(beforeRoute!.portal!.target, 'portal target is the authored route A').toBe(beforeRoute!.p1!.routes[0].target);
    const walk = await walkToPortalAndEnter(page, 45000);
    expect(walk.entered, `route A entered by walking + F (${walk.reason})`).toBe(true);
    const after = await snap(page);
    expect(after!.room!.id, 'the run is now in the route A room').toBe(beforeRoute!.p1!.routes[0].target);
    record('p1-route-a-walk', { runner: 'agent', fixtures: 'none', walk, room: after!.room, ms: Date.now() - t0, shot: await shot(page, '2-route-a') });
  });

  test('3) route B: manual relay OFF (R) selects the other authored route', async ({ page }) => {
    await bootDemo(page);
    // Real key input: R = manual relay toggle (human control, not a jam). Doing
    // it first also stops the linked sentries from firing during the fight.
    await tapKey(page, 'KeyR');
    await page.waitForTimeout(600);
    const afterToggle = await snap(page);
    expect(afterToggle!.relay!.manual, 'manual relay control is off before the fight').toBe(false);
    const fight = await fightUntilCleared(page, 120000);
    expect(fight.cleared, 'room cleared by real play').toBe(true);
    const routeB = await snap(page);
    expect(routeB!.relay!.manual, 'manual relay control is now off').toBe(false);
    expect(routeB!.relay!.state, 'relay state follows the manual control').not.toBe('ACTIVE');
    expect(routeB!.routeTarget, 'route B is selected while the relay is INACTIVE').toBe(routeB!.p1!.routes[1].target);
    expect(routeB!.portal!.target, 'the portal points at the authored route B').toBe(routeB!.p1!.routes[1].target);
    const walk = await walkToPortalAndEnter(page, 45000);
    expect(walk.entered, `route B entered by walking + F (${walk.reason})`).toBe(true);
    const after = await snap(page);
    expect(after!.room!.id, 'the run is now in the route B room').toBe(routeB!.p1!.routes[1].target);
    record('p1-route-b', {
      runner: 'agent (real R + real walking)',
      fixtures: 'none',
      fight,
      manualOff: routeB!.relay!.manual,
      routeTarget: routeB!.routeTarget,
      room: after!.room,
      shot: await shot(page, '3-route-b')
    });
  });

  test('4) the door is naturally jam-usable (exact cost) and a JAMMED route cannot be passed', async ({ page }) => {
    await bootDemo(page);
    // Real strategy: jam the relay from the spawn tile (legitimately in range) so
    // the linked sentries stop firing during the fight.
    const jam = await jamFromStart(page);
    expect(jam.relay, 'the spawn jam is committed before the fight').toBe('JAMMED');
    const fight = await fightUntilCleared(page, 120000);
    expect(fight.cleared, 'room cleared by real play').toBe(true);
    // A real capability wait: the spawn jam's cooldown must clear on real ticks,
    // otherwise the out-of-range attempt would be refused by COOLDOWN and would
    // prove nothing about range.
    await page.waitForFunction(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const v = w.signalView();
      return !!v && v.relay === 'ACTIVE' && v.playerJamCD === 0;
    }, undefined, { timeout: 40000 });

    // --- branch 1: a real position OUTSIDE jam range is still rejected ---
    // The authored relay now sits next to the door, so the out-of-range attempt
    // has to be made from a genuinely distant, walkable cell (real walking).
    const awayTarget = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const room = w.currentRoom();
      const relay = w.p1Scenario.relay;
      let best: { x: number; y: number; d: number } | null = null;
      for (const row of w.map.tiles) {
        for (const t of row) {
          if (t.x < room.gx || t.x >= room.gx + room.w) continue;
          if (t.y < room.gy || t.y >= room.gy + room.h) continue;
          if (!w.isWalkable(t.x + 0.5, t.y + 0.5, 0.5)) continue;
          const d = Math.hypot(t.x + 0.5 - relay.x, t.y + 0.5 - relay.y);
          if (!best || d > best.d) best = { x: t.x + 0.5, y: t.y + 0.5, d };
        }
      }
      return { target: best, relay };
    });
    expect(awayTarget.target, 'the room has a walkable cell away from the device').not.toBeNull();
    for (let i = 0; i < 160; i++) {
      const p = await page.evaluate(() => {
        const w = (window as any).__game.scene.getScene('GameScene').world;
        return { x: w.player.wx, y: w.player.wy };
      });
      const dx = awayTarget.target!.x - p.x, dy = awayTarget.target!.y - p.y;
      if (Math.hypot(dx, dy) < 1.0) break;
      const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : (dy > 0 ? 'KeyS' : 'KeyW');
      await page.keyboard.down(key);
      await page.waitForTimeout(90);
      await page.keyboard.up(key);
      await page.waitForTimeout(30);
    }
    const farAway = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const sig = w.signalView();
      const relay = w.p1Scenario.relay;
      return {
        player: { x: w.player.wx, y: w.player.wy },
        distanceRelayPlayer: Math.hypot(w.player.wx - relay.x, w.player.wy - relay.y),
        energy: sig?.playerEnergy ?? null,
        relayState: sig?.relay ?? null,
        jamCD: sig?.playerJamCD ?? null
      };
    });
    expect(farAway.distanceRelayPlayer, 'the player really walked outside JAM_RANGE').toBeGreaterThan(TUNE.JAM_RANGE);
    expect(farAway.jamCD, 'the jam cooldown had already cleared (range, not cooldown)').toBe(0);
    await tapKey(page, 'KeyY');
    await page.waitForTimeout(500);
    const afterFarY = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const sig = w.signalView();
      return { energy: sig?.playerEnergy ?? null, relayState: sig?.relay ?? null, jamCD: sig?.playerJamCD ?? null };
    });
    expect(afterFarY.relayState, 'an out-of-range jam is rejected (relay unchanged)').toBe('ACTIVE');
    expect(afterFarY.jamCD, 'a rejected jam starts no cooldown').toBe(0);
    expect(afterFarY.energy, 'a rejected jam does not spend energy').toBe(farAway.energy);

    // --- branch 2: the authored door IS inside jam range (P4 layout) ---
    const door = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const relay = w.p1Scenario.relay;
      return {
        portal: w.portal ? { x: w.portal.wx, y: w.portal.wy, target: w.portal.targetRoom } : null,
        doorToRelay: w.portal ? Math.hypot(w.portal.wx - relay.x, w.portal.wy - relay.y) : null
      };
    });
    expect(door.portal, 'the authored route portal exists once the room is cleared').not.toBeNull();
    expect(door.doorToRelay, 'authored door is inside JAM_RANGE (P4 natural layout)').toBeLessThanOrEqual(TUNE.JAM_RANGE);
    for (let i = 0; i < 200; i++) {
      const p = await page.evaluate(() => {
        const w = (window as any).__game.scene.getScene('GameScene').world;
        return { x: w.player.wx, y: w.player.wy };
      });
      const dx = door.portal!.x - p.x, dy = door.portal!.y - p.y;
      if (Math.hypot(dx, dy) < 1.0) break;
      const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : (dy > 0 ? 'KeyS' : 'KeyW');
      await page.keyboard.down(key);
      await page.waitForTimeout(90);
      await page.keyboard.up(key);
      await page.waitForTimeout(30);
    }
    const atDoor = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const sig = w.signalView();
      const relay = w.p1Scenario.relay;
      return {
        player: { x: w.player.wx, y: w.player.wy },
        portal: w.portal ? { x: w.portal.wx, y: w.portal.wy } : null,
        distanceRelayDoor: w.portal && relay ? Math.hypot(w.portal.wx - relay.x, w.portal.wy - relay.y) : null,
        distanceRelayPlayer: relay ? Math.hypot(w.player.wx - relay.x, w.player.wy - relay.y) : null,
        energy: sig?.playerEnergy ?? null,
        relayState: sig?.relay ?? null
      };
    });
    expect(atDoor.distanceRelayPlayer, 'the player standing on the door is inside JAM_RANGE').toBeLessThanOrEqual(TUNE.JAM_RANGE);

    // Exact cost from the committed core event (regen makes the net delta smaller).
    await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      (window as any).__p1DoorBatches = [];
      const orig = w.stepFrame.bind(w);
      w.stepFrame = (dt: number, intent: any, echoIntent?: any) => {
        const pre = w.signalView()?.playerEnergy ?? null;
        const ev = orig(dt, intent, echoIntent) ?? [];
        if (ev.length) (window as any).__p1DoorBatches.push({ pre, ev });
        return ev;
      };
    });
    await tapKey(page, 'KeyY');
    await page.waitForFunction(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return (w.signalView()?.relay ?? '') === 'JAMMED';
    }, undefined, { timeout: 8000 });
    const jamCommit = await page.evaluate(() => {
      const batches = ((window as any).__p1DoorBatches ?? []) as any[];
      for (const b of batches) {
        const i = (b.ev as any[]).findIndex((e) => e.type === 'signal-jammed');
        if (i < 0) continue;
        let before: number | null = null;
        for (let k = i - 1; k >= 0; k--) {
          if (typeof b.ev[k].energy === 'number') { before = b.ev[k].energy; break; }
        }
        const regen = (b.ev as any[]).slice(0, i).filter((e) => e.type === 'signal-energy').length;
        if (before === null) before = b.pre;
        return {
          actorId: b.ev[i].actorId, ok: b.ev[i].ok !== false, energy: b.ev[i].energy, before,
          relay: b.ev[i].relay, regenEvents: regen,
          source: regen > 0 ? 'energy-event-in-batch' : 'pre-tick-energy'
        };
      }
      return null;
    });
    const jammedAtDoor = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const sig = w.signalView();
      return {
        relay: sig?.relay ?? null, energy: sig?.playerEnergy ?? null,
        portal: w.portal ? { target: w.portal.targetRoom } : null,
        routeTarget: w.p1RouteTarget ?? null, room: w.currentRoom()?.id ?? null
      };
    });
    expect(jamCommit, 'the door jam committed a signal-jammed core event').not.toBeNull();
    expect(jamCommit!.ok, 'the core accepted the door jam (range + LOS)').toBe(true);
    expect(jamCommit!.actorId, 'the jam was committed by the PLAYER actor').toBe(0);
    expect(jamCommit!.before! - jamCommit!.energy!, `jam deducts exactly ${TUNE.JAM_COST} (event payload)`).toBe(TUNE.JAM_COST);
    const netJamDelta = atDoor.energy! - jammedAtDoor.energy!;
    expect(jammedAtDoor.relay, 'fixture-free jam from the real door is committed').toBe('JAMMED');
    expect(jammedAtDoor.portal, 'no authored route portal exists while JAMMED').toBeNull();
    expect(jammedAtDoor.routeTarget, 'JAMMED matches neither authored route').toBeNull();
    await tapKey(page, 'KeyF');
    await page.waitForTimeout(700);
    const afterF = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return { room: w.currentRoom()?.id ?? null };
    });
    expect(afterF.room, 'F at the door while JAMMED does not change rooms').toBe(jammedAtDoor.room);

    // --- expiry through REAL ticks restores a selectable route, no fixture ---
    await page.waitForFunction(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return (w.signalView()?.relay ?? '') !== 'JAMMED';
    }, undefined, { timeout: 60000 });
    const recovered = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const sig = w.signalView();
      return {
        relay: sig?.relay ?? null,
        portal: w.portal ? { target: w.portal.targetRoom } : null,
        routeTarget: w.p1RouteTarget ?? null
      };
    });
    expect(recovered.relay, 'the relay recovers after the jam expires').toBe('ACTIVE');
    expect(recovered.portal, 'the route portal is selectable again after expiry').not.toBeNull();
    expect(recovered.routeTarget, 'route A is selectable again').toBe(1);
    await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      delete (w as any).stepFrame;
    });
    record('p1-jam-range-door', {
      runner: 'agent (real walking + real Y, real F)',
      fixtures: 'none for either jam (both positions are real)',
      fight,
      outOfRange: {
        distanceRelayPlayer: farAway.distanceRelayPlayer,
        targetCell: awayTarget.target,
        before: { energy: farAway.energy, relay: farAway.relayState, jamCD: farAway.jamCD },
        after: afterFarY,
        proves: 'a legal Y outside JAM_RANGE spends nothing and changes nothing'
      },
      atDoor: {
        distanceRelayDoor: atDoor.distanceRelayDoor,
        distanceRelayPlayer: atDoor.distanceRelayPlayer,
        before: { energy: atDoor.energy, relay: atDoor.relayState },
        commit: jamCommit, netDelta: netJamDelta,
        note: 'exact 25 comes from the committed signal-jammed event; the net view delta is smaller because of regen',
        jammed: jammedAtDoor, roomAfterF: afterF.room,
        proves: 'the authored door is naturally jam-usable and a JAMMED relay closes the authored route portal (F cannot pass)'
      },
      recovered,
      shot: await shot(page, '4-door-range-jam')
    });
  });

  test('5) save -> page reload -> CONTINUE restores room, relay and route target', async ({ page }) => {
    await bootDemo(page);
    await tapKey(page, 'KeyR'); // manual OFF first: stops linked fire AND gives a non-default route
    await page.waitForTimeout(500);
    const fight = await fightUntilCleared(page, 120000);
    expect(fight.cleared, 'room cleared by real play').toBe(true);
    await page.waitForTimeout(2000); // checkpoint / autosave window
    const before = await snap(page);
    expect(before!.routeTarget, 'a non-default route is selected before reload').toBe(before!.p1!.routes[1].target);
    await page.reload();
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 20000 });
    await page.waitForTimeout(600);
    await clickLabel(page, 'MainMenuScene', 'CONTINUE');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
    await page.waitForTimeout(1200);
    const after = await snap(page);
    expect(after!.room!.id, 'CONTINUE returns to the same room').toBe(before!.room!.id);
    expect(after!.relay!.manual, 'manual relay control survived the reload').toBe(false);
    expect(after!.routeTarget, 'portalTarget / route choice survived the reload').toBe(before!.routeTarget);
    expect(after!.p1, 'the authored scenario is re-attached on restore').not.toBeNull();
    record('p1-save-reload-continue', {
      runner: 'agent (real reload + CONTINUE click)',
      fixtures: 'none',
      before: { room: before!.room, manual: before!.relay!.manual, routeTarget: before!.routeTarget, tick: before!.tick },
      after: { room: after!.room, manual: after!.relay!.manual, routeTarget: after!.routeTarget, tick: after!.tick },
      shot: await shot(page, '5-continue')
    });
  });

  test('6) seeds 20261117/18/19 all set up a real playable authored layout', async ({ page }) => {
    // Manifest seeds for the P1 demo. Each must produce the authored scene:
    // no error notice, two legal routes (never boss/extraction), and the actual
    // layout must vary (route pair or sentry placement) — "failed with a notice"
    // is NOT a pass. Earlier observations with 4242 / 7 remain separate records.
    const seeds = [20261117, 20261118, 20261119];
    const rows: Array<Record<string, unknown>> = [];
    for (const seed of seeds) {
      await bootDemo(page, seed);
      const s = await snap(page);
      const detail = await page.evaluate(() => {
        const w = (window as any).__game.scene.getScene('GameScene').world;
        const sc = w.p1Scenario;
        if (!sc) return { error: w.p1ScenarioError ?? null, routes: null, drones: null };
        return {
          error: w.p1ScenarioError ?? null,
          routes: sc.routes.map((r: any) => ({ target: r.target, when: r.when, kind: w.map.rooms[r.target]?.kind ?? null })),
          drones: sc.drones.map((d: any) => ({ x: d.x, y: d.y })),
          relay: sc.relay
        };
      });
      rows.push({
        seed,
        p1: !!s?.p1,
        error: detail.error,
        routes: detail.routes,
        drones: detail.drones,
        relay: detail.relay,
        objective: s?.objective ?? null,
        roomKind: s?.room?.kind ?? null
      });
      expect(detail.error, `seed ${seed}: authored setup reports no error`).toBeNull();
      expect(s?.p1, `seed ${seed}: authored P1 scenario exists`).not.toBeNull();
      const routes = (detail.routes ?? []) as Array<{ target: number; kind: string | null }>;
      expect(routes.length, `seed ${seed}: exactly two authored routes`).toBe(2);
      const illegal = routes.filter((r) => r.kind === 'boss' || r.kind === 'extraction');
      expect(illegal, `seed ${seed}: no boss/extraction route`).toEqual([]);
      expect(new Set(routes.map((r) => r.target)).size, `seed ${seed}: the two routes are distinct`).toBe(2);
      expect(s?.room?.kind, `seed ${seed}: authored room is a combat room`).toBe('combat');
    }
    // Real layout variation across the three seeds (route pair or sentry spots).
    const signatures = rows.map((r) => JSON.stringify({
      targets: (r.routes as any[])?.map((x) => x.target),
      drones: r.drones
    }));
    record('p1-seeds', {
      runner: 'agent (real menu entry per seed)',
      fixtures: 'seed override only',
      requirement: 'each seed must build the authored scene with two legal, distinct routes',
      rows,
      distinctLayouts: new Set(signatures).size
    });
    expect(new Set(signatures).size, 'the three manifest seeds produce more than one real layout').toBeGreaterThanOrEqual(2);
  });

  test('7) HUD + menu at five viewports: readable font, no clipped / unexpected overlap', async ({ page }) => {
    const viewports: Array<[number, number]> = [[1920, 1080], [1366, 768], [1280, 720], [1024, 768], [800, 600]];
    const rows: Array<Record<string, unknown>> = [];
    for (const [w, h] of viewports) {
      await page.setViewportSize({ width: w, height: h });
      await bootDemo(page);
      const hud = await page.evaluate(() => {
        const g = (window as any).__game;
        const gs: any = g.scene.getScene('GameScene');
        const cam = gs.cameras.main;
        const p0 = cam.getWorldPoint(0, 0);
        const px = cam.getWorldPoint(100, 0);
        const py = cam.getWorldPoint(0, 100);
        const ax = (px.x - p0.x) / 100, bx = p0.x;
        const ay = (py.y - p0.y) / 100, by = p0.y;
        const names = ['txtHp', 'txtXp', 'txtWeapon', 'txtRoom', 'txtEnemies', 'txtControl', 'txtAiAction',
          'txtAiTarget', 'txtAgentLink', 'txtEcho', 'txtObjective', 'txtSignalDetail', 'txtHelp', 'txtStats'];
        const els = names.map((n) => {
          const o = gs[n];
          if (!o || typeof o.text !== 'string' || o.visible === false) return null;
          const sx = (o.x - bx) / ax, sy = (o.y - by) / ay;
          return {
            name: n, text: String(o.text).slice(0, 40),
            fontSize: parseFloat(String(o.style?.fontSize ?? '0')),
            x: sx - o.originX * o.width, y: sy - o.originY * o.height,
            w: o.width, h: o.height
          };
        }).filter(Boolean);
        return { els, logical: { w: g.scale.gameSize.width, h: g.scale.gameSize.height } };
      });
      const scale = Math.min(w / hud.logical.w, h / hud.logical.h);
      const tooSmall = hud.els.filter((e: any) => e.fontSize * scale < 10);
      const outOfView = hud.els.filter((e: any) => e.x < -1 || e.y < -1 || e.x + e.w > hud.logical.w + 1 || e.y + e.h > hud.logical.h + 1);
      const overlaps: string[] = [];
      for (let i = 0; i < hud.els.length; i++) {
        for (let j = i + 1; j < hud.els.length; j++) {
          const a: any = hud.els[i], b: any = hud.els[j];
          const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ix > 1 && iy > 1) overlaps.push(`${a.name}<>${b.name}`);
        }
      }
      // Menu: real render at the same viewport, then ESC/keyboard compatibility.
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'), { timeout: 10000 });
      await page.waitForTimeout(400);
      const pauseTexts = await page.evaluate(() => {
        const g = (window as any).__game;
        const s: any = g.scene.getScene('PauseScene');
        const walk = (l: any[]): any[] => l.flatMap((c: any) => (c.type === 'Container' && c.list ? walk(c.list) : [c]));
        return walk(s.children.list).filter((c: any) => c.type === 'Text' && c.visible !== false)
          .map((c: any) => ({ text: String(c.text).slice(0, 40), fontSize: parseFloat(String(c.style?.fontSize ?? '0')) }));
      });
      const pauseTooSmall = pauseTexts.filter((t: any) => t.fontSize * scale < 10);
      await page.keyboard.press('Escape'); // settings-free root: ESC resumes
      await page.waitForTimeout(500);
      const resumed = await page.evaluate(() => !(window as any).__game.scene.isActive('PauseScene'));
      rows.push({
        viewport: `${w}x${h}`, scale: Math.round(scale * 1000) / 1000,
        hudElements: hud.els.length, tooSmall: tooSmall.map((e: any) => e.name),
        outOfView: outOfView.map((e: any) => e.name), overlaps,
        pauseTexts: pauseTexts.length, pauseTooSmall: pauseTooSmall.map((t: any) => t.text.slice(0, 16)),
        objective: hud.els.find((e: any) => e.name === 'txtObjective')?.text ?? null,
        escResumes: resumed
      });
      expect(tooSmall, `${w}x${h}: HUD font >= 10 CSS px`).toEqual([]);
      expect(outOfView, `${w}x${h}: no HUD element outside the viewport`).toEqual([]);
      expect(overlaps, `${w}x${h}: no unexpected HUD overlap`).toEqual([]);
      expect(pauseTooSmall, `${w}x${h}: pause text >= 10 CSS px`).toEqual([]);
      expect(resumed, `${w}x${h}: ESC on the pause root resumes`).toBe(true);
    }
    record('p1-viewports', { runner: 'agent', fixtures: 'none', rows, note: 'HUD/pause text measured as fontSize * canvas scale (CSS px)' });
  });
});
