// GAMEPLAY-01 · P4 — Demo-01 entry, Demo-03 authored cooperation level.
//
// Runner labels (used in every record):
//   agent     — Agent-driven real mouse/keyboard (NOT a human)
//   fixture   — a labelled dev/test seam did something (Owner auto-confirm, seed
//               override, event tap); never a clearEnemies / teleport / heal and
//               never a fabricated `cleared`
//   autoOwner — an automated Owner confirmation (never a human click)
//   human     — an actual person: none here → HUMAN ACCEPTANCE PENDING
//
// Rules encoded here (tester owns tests/**; product source untouched):
//  - play is real keyboard/mouse. The driver is NON-BLIND (it reads canonical
//    state to aim and to route); it is not a human blind playtest.
//  - completion is read from the AUTHORITATIVE flag `map.rooms[id].cleared`
//    (plus the core `room-cleared` commit event). "0 drones alive" is recorded
//    but is never the gate (reviewer M1).
//  - the Headless model must answer the SAME state for the same seed; its
//    `routeState.roomCleared` is checked against its own `map.rooms[id].cleared`
//    and against the commit event, never against a live-drone count.
//  - jam cost is taken from the committed core event (`signal-jammed.energy`),
//    not from a post-sample net delta (regen makes the net smaller).
//  - same seed runs HumanOnly and HumanEcho; nothing asserts ECHO is better.
//  - archive, checkpoint reload and raw headless replay are three different
//    things and are asserted separately.

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HeadlessWorld } from '../src/ai-native/worldHeadless';

const PORT = Number(process.env.PORT ?? 5492);
const BASE = path.resolve(process.env.LS_P4_DIR ?? 'reports/gameplay-01/tester/p4-final/run1');
const SAVE_KEY = 'last_signal_save_v1';
const LOCAL_W = 1280;
const LOCAL_H = 720;
const SEEDS = [20261117, 20261118, 20261119] as const;
/** Real tuning (src/signal/signalTuning.ts) — expectations, not knobs. */
const TUNE = { JAM_COST: 25, JAM_RANGE: 6, ENERGY_MAX: 100, JAM_DURATION_TICKS: 360 };

type Mode = 'HumanOnly' | 'HumanEcho';

function outDir(kind: 'evidence' | 'shots'): string {
  const dir = path.join(BASE, kind);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function rec(name: string, data: unknown): void {
  writeFileSync(path.join(outDir('evidence'), `${name}.json`), JSON.stringify(data, null, 2));
}
async function shot(page: Page, name: string): Promise<string> {
  const file = path.join(outDir('shots'), `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

// ---------------------------------------------------------------------------
// input + menu (proven helpers, same shape as the P1 acceptance spec)
// ---------------------------------------------------------------------------

/** One real frame edge: keydown -> at least one real game frame -> keyup. */
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
  await page.waitForTimeout(250);
}

/** Real menu entry: the ORDINARY DEMO 01 entry (which shows the Demo-03 level). */
async function bootDemo(page: Page, seed?: number): Promise<void> {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate((key) => localStorage.removeItem(key), SAVE_KEY);
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 30000 });
  await page.waitForTimeout(400);
  if (seed !== undefined) {
    await page.evaluate((s) => {
      const menu: any = (window as any).__game.scene.getScene('MainMenuScene');
      const orig = menu.scene.start.bind(menu.scene);
      menu.scene.start = (key: string, data?: any) =>
        key === 'GameScene' ? orig(key, { ...(data ?? {}), seed: s }) : orig(key, data);
    }, seed);
  }
  await clickLabel(page, 'MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 30000 });
  await page.waitForTimeout(900);
}

// ---------------------------------------------------------------------------
// read-only state probe
// ---------------------------------------------------------------------------

async function snap(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const w: any = gs.world;
    if (!w) return null;
    const sig: any = w.signalView ? w.signalView() : null;
    const room = w.currentRoom();
    const roomRec = room ? w.map.rooms[room.id] : null;
    const sc: any = w.p1Scenario;
    const obs: any = w.observationView ? w.observationView() : null;
    const portal = w.portal;
    const spr = portal?.spr ?? null;
    return {
      seed: gs.seed ?? null,
      tick: w.sim.tick,
      page: g.scene.getScene('PauseScene')?.currentPage ?? 'game',
      room: room ? { id: room.id, kind: room.kind } : null,
      roomFlags: roomRec ? { spawned: !!roomRec.spawned, cleared: !!roomRec.cleared, kind: roomRec.kind } : null,
      mapCleared: roomRec ? !!roomRec.cleared : null,
      player: { x: w.player.wx, y: w.player.wy, hp: w.player.data.hp },
      portal: portal ? { x: portal.wx, y: portal.wy, target: portal.targetRoom } : null,
      portalSprite: spr ? { x: spr.x, y: spr.y } : null,
      observedPortal: obs?.portal ?? null,
      relay: sig ? { state: sig.relay, manual: sig.manualEnabled, powered: sig.powered, jamUntil: sig.jammedUntilTick, evidence: sig.evidence } : null,
      energy: sig ? { player: sig.playerEnergy, echo: sig.echoEnergy, jamCD: sig.playerJamCD } : null,
      scenario: sc ? {
        id: sc.id, roomId: sc.roomId, startRoomId: sc.startRoomId,
        relay: sc.relay, playerStart: sc.playerStart, drones: sc.drones.length,
        routes: sc.routes.map((r: any) => ({ target: r.target, when: r.when, portal: r.portal ?? null }))
      } : null,
      scenarioError: w.p1ScenarioError ?? null,
      routeTarget: w.p1RouteTarget ?? null,
      jamRemaining: w.p1JamRemainingTicks ?? null,
      linkedFire: w.p1LinkedFireEnabled ?? null,
      liveDrones: (w.sim.drones ?? []).filter((d: any) => d.hp > 0).length,
      enemies: (w.enemies ?? []).length,
      echo: w.echoActor ? { exists: true, hp: w.echoActor.data?.hp ?? 0, energy: sig?.echoEnergy ?? null } : { exists: false, hp: 0, energy: null },
      proposal: w.echoLocalProposal ? { id: w.echoLocalProposal.id, kind: w.echoLocalProposal.kind } : null,
      pending: w.echoPendingLocal ?? null,
      companionStatus: gs.companionStatus ?? null
    };
  });
}

type Snap = Awaited<ReturnType<typeof snap>>;

/** Read-only capture of committed core events: wraps the EXISTING stepFrame with an
 *  own property (no extra step, no input change). `pre` is the energy reading taken
 *  before the batch, used only when no energy event precedes the commit. */
async function installEventTap(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    (window as any).__p4Batches = [];
    if ((w as any).__p4tapped) return;
    const orig = w.stepFrame.bind(w);
    w.stepFrame = (dt: number, intent: any, echoIntent?: any) => {
      const pre = w.signalView()?.playerEnergy ?? null;
      const ev = orig(dt, intent, echoIntent) ?? [];
      if (ev.length) (window as any).__p4Batches.push({ pre, ev, tick: w.sim.tick });
      return ev;
    };
    (w as any).__p4tapped = true;
  });
}
async function dropEventTap(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    if ((w as any).__p4tapped) { delete w.stepFrame; delete w.__p4tapped; }
  });
}

/** Exact energy cost of the first committed `signal-jammed`/`signal-scanned`
 *  event of the given actor, derived from the event payload (never a net delta). */
async function signalCommit(page: Page, type: 'signal-jammed' | 'signal-scanned', actorId = 0) {
  return page.evaluate(({ type, actorId }) => {
    const batches = ((window as any).__p4Batches ?? []) as any[];
    for (const b of batches) {
      const i = (b.ev as any[]).findIndex((e) => e.type === type && e.actorId === actorId);
      if (i < 0) continue;
      let before: number | null = null;
      for (let k = i - 1; k >= 0; k--) {
        if (typeof b.ev[k].energy === 'number') { before = b.ev[k].energy; break; }
      }
      const regenInBatch = (b.ev as any[]).slice(0, i).filter((e) => e.type === 'signal-energy').length;
      if (before === null) before = b.pre;
      return {
        actorId: b.ev[i].actorId, ok: b.ev[i].ok !== false, code: b.ev[i].code ?? null,
        energy: b.ev[i].energy ?? null, before,
        relay: b.ev[i].relay ?? null, jamExpiresAtTick: b.ev[i].jamExpiresAtTick ?? null,
        regenEvents: regenInBatch, tick: b.tick,
        source: regenInBatch > 0 ? 'energy-event-in-batch' : 'pre-tick-energy'
      };
    }
    return null;
  }, { type, actorId });
}

/** Did the core commit a room clear for this room? (authoritative commit event) */
async function roomClearedEvents(page: Page, roomId: number) {
  return page.evaluate((rid: number) => {
    const out: any[] = [];
    for (const b of (((window as any).__p4Batches ?? []) as any[])) {
      for (const e of b.ev as any[]) {
        if (e.type === 'room-cleared' && e.roomId === rid) out.push({ tick: b.tick, event: e });
      }
    }
    return out;
  }, roomId);
}

// ---------------------------------------------------------------------------
// real play
// ---------------------------------------------------------------------------

/** Real combat driver — NON-BLIND (aim/approach read canonical state; every
 *  move/fire is a real key/mouse event). No clearEnemies, no teleport, no heal. */
async function fightUntilCleared(page: Page, maxMs: number) {
  const started = Date.now();
  let shots = 0;
  let approaches = 0;
  let minEnemies = Number.POSITIVE_INFINITY;
  let firstHp: number | null = null;
  while (Date.now() - started < maxMs) {
    const info = await page.evaluate(() => {
      const g = (window as any).__game;
      const active = g.scene.getScenes(true).map((s: any) => s.sys.settings.key);
      const gs: any = g.scene.getScene('GameScene');
      if (!gs || !g.scene.isActive('GameScene') || !gs.world || !gs.cameras?.main) {
        return { enemy: null, cleared: false, hp: null, player: null, enemies: 0, active, flags: null };
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
      let screen: { x: number; y: number } | null = null;
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
      const rec = room ? w.map.rooms[room.id] : null;
      return {
        enemy: pick ? { ...pick, screen } : null,
        cleared: !!(rec && rec.cleared),
        flags: rec ? { spawned: !!rec.spawned, cleared: !!rec.cleared } : null,
        hp: w.player.data.hp,
        player: { x: w.player.wx, y: w.player.wy },
        enemies: list.length,
        projectiles: (w.projectiles ?? []).length,
        active
      };
    });
    if (firstHp === null) firstHp = info.hp;
    minEnemies = Math.min(minEnemies, info.enemies);
    if (info.active.includes('GameOverScene') || !info.player) {
      return { shots, approaches, cleared: false, died: true, firstHp, minEnemies, elapsedMs: Date.now() - started };
    }
    if (info.cleared) {
      return { shots, approaches, cleared: true, died: false, firstHp, minEnemies, elapsedMs: Date.now() - started, flags: info.flags };
    }
    const target = info.enemy;
    if (!target) {
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(160);
      await page.keyboard.up('KeyD');
      continue;
    }
    if (target.d > 4.5) {
      const dx = target.x - info.player.x, dy = target.y - info.player.y;
      const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : (dy > 0 ? 'KeyS' : 'KeyW');
      await page.keyboard.down(key);
      await page.waitForTimeout(220);
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
  return { shots, approaches, cleared: !!fin?.mapCleared, died: false, firstHp, minEnemies, elapsedMs: Date.now() - started };
}

/** Walk to a world point with real keys. Returns the final distance. */
async function walkTo(page: Page, target: { x: number; y: number }, tolerance = 0.8, maxSteps = 200): Promise<number> {
  for (let i = 0; i < maxSteps; i++) {
    const p = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      return { x: w.player.wx, y: w.player.wy };
    });
    const dx = target.x - p.x, dy = target.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= tolerance) return d;
    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : (dy > 0 ? 'KeyS' : 'KeyW');
    await page.keyboard.down(key);
    await page.waitForTimeout(80);
    await page.keyboard.up(key);
    await page.waitForTimeout(25);
  }
  const p = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return { x: w.player.wx, y: w.player.wy };
  });
  return Math.hypot(target.x - p.x, target.y - p.y);
}

/** Walk with real keys to the farthest walkable cell of the current room from `from`.
 *  Used to put the player genuinely OUT of jam range (no teleport). */
async function walkOutOfRange(page: Page, from: { x: number; y: number }) {
  const target = await page.evaluate((relay: { x: number; y: number }) => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    const room = w.currentRoom();
    if (!room) return null;
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
    return best;
  }, from);
  expect(target, 'the room has a walkable cell away from the relay').not.toBeNull();
  let best = 0;
  // Try the farthest cell, then a couple of alternatives if walls block the path.
  const candidates: Array<{ x: number; y: number }> = [target!];
  for (const c of candidates) {
    const d = await walkTo(page, c, 1.0, 140);
    const now = await page.evaluate((relay: { x: number; y: number }) => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      return Math.hypot(w.player.wx - relay.x, w.player.wy - relay.y);
    }, from);
    best = Math.max(best, now);
    void d;
  }
  return best;
}

/** Real F press at the current portal. Returns the room change. */
async function takeRoute(page: Page) {
  const before = await snap(page);
  expect(before!.portal, 'a route portal exists before F').not.toBeNull();
  const dist = await walkTo(page, { x: before!.portal!.x, y: before!.portal!.y }, 1.0, 220);
  const at = await snap(page);
  await tapKey(page, 'KeyF');
  await page.waitForTimeout(900);
  const after = await snap(page);
  return { before, at, after, dist, changed: before!.room!.id !== after!.room!.id };
}

/** HumanEcho setup — labelled FIXTURE: the same calls the menu's ENABLE issues
 *  (human opt-in + spawn next to the protagonist). No proposal is fabricated. */
async function enableEchoMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    w.setEchoCooperationOptIn(true);
    w.enableEcho();
  });
  await page.waitForFunction(() => !!(window as any).__game.scene.getScene('GameScene').world.echoActor, undefined, { timeout: 15000 });
  const s = await snap(page);
  expect(s!.echo.exists, 'the real ECHO actor exists in HumanEcho mode').toBe(true);
}

/** One real local proposal -> Owner auto-confirm (FIXTURE) -> next-tick commit.
 *  Returns measured facts; never asserts that cooperation is better. */
async function echoCycle(page: Page) {
  const before = await snap(page);
  const proposal = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    let p = w.echoLocalProposal;
    if (!p) { w.proposeLocalEcho(); p = w.echoLocalProposal; }
    return p ? { id: p.id, kind: p.kind, target: p.target ?? null, echoReady: !!w.echoActor } : null;
  });
  const beforeApply = await snap(page);
  if (!proposal) return { proposal: null, accepted: false, applied: false, before, beforeApply };
  const accepted = await page.evaluate((id: string) => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return !!w.confirmLocalEchoProposal(id);
  }, proposal.id);
  const applied = await page.waitForFunction((id: string) => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return w.echoAudit.recent(32).some((e: any) => e.proposalId === id && e.result === 'applied');
  }, proposal.id, { timeout: 15000 }).then(() => true).catch(() => false);
  const audit = await page.evaluate((id: string) => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return w.echoAudit.recent(32).filter((e: any) => e.proposalId === id)
      .map((e: any) => ({ tick: e.tick, kind: e.action, result: e.result, code: e.code ?? null, provenance: e.provenance }));
  }, proposal.id);
  const after = await snap(page);
  const commit = proposal.kind === 'scan' ? await signalCommit(page, 'signal-scanned', -2)
    : await signalCommit(page, 'signal-jammed', -2);
  void commit;
  return { proposal, accepted, applied, audit, before, beforeApply, after };
}

// ---------------------------------------------------------------------------
// headless counterpart (same seed, same authored scenario, same rule)
// ---------------------------------------------------------------------------

/** Drive the formal Headless model to a REAL clear with core ticks only: no state
 *  writes, no kill/teleport fixtures. Two legal strategies are tried in order. */
function headlessClear(seed: number) {
  const strategies: string[] = [];
  for (const strategy of ['plain-fight', 'jam-first'] as const) {
    const hw = new HeadlessWorld({ seed, demo: true, echoAutonomy: false });
    const scenario = hw.demoScenario;
    if (!scenario) throw new Error('P4 demo scenario unavailable in Headless');
    const roomId = scenario.roomId;
    const room0 = hw.state.map.rooms[roomId];
    const initial = {
      roomId, spawned: !!room0.spawned, cleared: !!room0.cleared,
      liveDrones: hw.liveDrones, routeState: hw.routeState, tick: hw.tick
    };
    if (strategy === 'jam-first') hw.enqueueSignalCommand({ type: 'signal-jam', actor: 'player' });
    let guard = 0;
    let firstClearTick: number | null = null;
    let liveAtClear: number | null = null;
    const clearEvents: any[] = [];
    while (!hw.routeState?.roomCleared && guard < 400 && hw.runStatus === 'running') {
      const st = hw.state;
      const live = st.drones.filter((d) => d.hp > 0);
      if (!live.length) break;
      const p = st.player;
      const near = live.reduce((a, b) => (Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a));
      const dist = Math.hypot(near.x - p.x, near.y - p.y);
      const mv = dist > 4 ? { x: (near.x - p.x) / dist, y: (near.y - p.y) / dist } : { x: 0, y: 0 };
      const evs = hw.runSteps([{
        ticks: 4,
        intent: { move: mv, dash: false, fire: dist <= 12, aim: { x: near.x, y: near.y }, interact: false }
      }]);
      for (const e of evs) {
        if (e.type === 'room-cleared' && (e as any).roomId === roomId) {
          if (firstClearTick === null) firstClearTick = hw.tick;
          liveAtClear = hw.liveDrones;
          clearEvents.push({ tick: hw.tick, event: e });
        }
      }
      guard += 1;
    }
    const done = hw.routeState;
    const room1 = hw.state.map.rooms[roomId];
    const result = {
      strategy,
      initial,
      final: {
        tick: hw.tick, status: hw.runStatus, spawned: !!room1.spawned, cleared: !!room1.cleared,
        liveDrones: hw.liveDrones, routeState: done, kills: hw.killCount, shots: hw.shotCount, hp: hw.playerHp
      },
      clearEvents, firstClearTick, liveAtClear,
      parity: done !== null && done.roomCleared === !!room1.cleared && !!room1.cleared
    };
    strategies.push(strategy);
    if (done?.roomCleared) return { cleared: true, tried: strategies, result, world: hw };
  }
  return { cleared: false, tried: strategies, result: null as any, world: null as any };
}

/** Layout summary of the authored scene for a seed, from the Headless builder
 *  (same table the rendered World uses). */
function headlessLayout(seed: number) {
  const hw = new HeadlessWorld({ seed, demo: true, echoAutonomy: false });
  // The core-authored projection carries the ROUTE identity (target/when/portal);
  // the device cell lives in the committed signal state, the spawn in the player.
  // One neutral core tick commits the constructor's spawn/link commands.
  hw.runSteps([{ ticks: 1, intent: null }]);
  const sc: any = (hw as any).demoScenario;
  const st = hw.state;
  const routes = sc.routes.map((r: any) => ({ target: r.target, when: r.when, portal: r.portal ?? null }));
  const relay = st.signal ? { x: st.signal.x, y: st.signal.y, deviceId: st.signal.deviceId, roomId: st.signal.roomId, relay: st.signal.relay } : null;
  const playerStart = { x: st.player.x, y: st.player.y };
  const relayToPortal = relay ? routes.map((r: any) => (r.portal ? Math.hypot(r.portal.x - relay.x, r.portal.y - relay.y) : null)) : [];
  return {
    seed, roomId: sc.roomId, startRoomId: sc.startRoomId, relay, playerStart,
    drones: st.drones.length, routes, relayToPortal,
    spawnToRelay: relay ? Math.hypot(playerStart.x - relay.x, playerStart.y - relay.y) : null,
    routeSeparation: routes[0].portal && routes[1].portal
      ? Math.hypot(routes[0].portal.x - routes[1].portal.x, routes[0].portal.y - routes[1].portal.y) : null
  };
}

// ---------------------------------------------------------------------------
// 6 route tests: 3 seeds x {HumanOnly, HumanEcho}
// ---------------------------------------------------------------------------

for (const seed of SEEDS) {
  for (const mode of ['HumanOnly', 'HumanEcho'] as Mode[]) {
    test(`P4 route · seed ${seed} · ${mode}: real clear, natural door jam (exact cost), F blocked, expiry, route taken`, async ({ page }) => {
      test.setTimeout(300000);
      await page.setViewportSize({ width: LOCAL_W, height: LOCAL_H });
      await bootDemo(page, seed);
      const start = await snap(page);
      expect(start, 'the world exists on the DEMO 01 entry').not.toBeNull();
      expect(start!.seed, 'the run uses the requested seed').toBe(seed);
      expect(start!.scenario, 'the Demo-03 authored scenario is active (no error notice)').not.toBeNull();
      expect(start!.scenarioError, 'the authored scene did not fail to build').toBeNull();
      expect(start!.scenario!.drones, 'two authored sentries are placed').toBe(2);
      const spawnToRelay = Math.hypot(start!.scenario!.playerStart!.x - start!.scenario!.relay.x, start!.scenario!.playerStart!.y - start!.scenario!.relay.y);
      expect(spawnToRelay, 'spawn and device are distinct cells (M5)').toBeGreaterThan(0.5);

      const fixtures: string[] = ['seed override (menu start wrapper)'];
      if (mode === 'HumanEcho') {
        await enableEchoMode(page);
        fixtures.push('autoOwner: setEchoCooperationOptIn(true) + enableEcho() (same calls as the menu ENABLE)');
      }
      await installEventTap(page);

      // A real, player-reachable strategy: jam the linked sentries from the spawn
      // tile when it is legitimately in range, then fight with real input.
      const spawnJam = await page.evaluate(() => {
        const w: any = (window as any).__game.scene.getScene('GameScene').world;
        const sc = w.p1Scenario;
        return Math.hypot(w.player.wx - sc.relay.x, w.player.wy - sc.relay.y);
      });
      let spawnJamResult: any = { attempted: false, distance: spawnJam };
      if (spawnJam <= TUNE.JAM_RANGE) {
        await tapKey(page, 'KeyY');
        await page.waitForTimeout(400);
        spawnJamResult = { ...spawnJamResult, attempted: true, commit: await signalCommit(page, 'signal-jammed', 0), after: (await snap(page))!.relay };
      }

      const fight = await fightUntilCleared(page, 150000);
      const afterFight = await snap(page);
      const roomId = afterFight!.scenario!.roomId;
      expect(afterFight!.room, 'the fight happened in the authored room').not.toBeNull();
      expect(afterFight!.room!.id, 'still the authored room').toBe(roomId);
      // AUTHORITATIVE clear: the map flag + the core commit event.
      expect(afterFight!.roomFlags!.spawned, 'the room generation committed (spawned)').toBe(true);
      expect(afterFight!.mapCleared, 'the room is cleared by real play (map flag)').toBe(true);
      const clearEvents = await roomClearedEvents(page, roomId);
      expect(clearEvents.length, 'the core emitted the room-cleared commit').toBeGreaterThan(0);
      expect(afterFight!.liveDrones, 'no live drone remains (recorded, never the gate)').toBe(0);

      // Headless parity for the same seed: the SAME rule, driven by real core ticks.
      const hl = headlessClear(seed);
      expect(hl.cleared, `Headless reaches its own clear for seed ${seed} (${hl.tried.join(' -> ')})`).toBe(true);
      expect(hl.result.initial.routeState.roomCleared, 'a fresh Headless room is not cleared').toBe(false);
      expect(hl.result.initial.liveDrones, 'the fresh Headless room has live drones').toBeGreaterThan(0);
      expect(hl.result.initial.routeState.portal, 'no portal before the committed clear').toBeNull();
      expect(hl.result.final.routeState.roomCleared, 'Headless roomCleared is true after its own clear').toBe(true);
      expect(hl.result.final.cleared, 'Headless map.rooms[id].cleared agrees with roomCleared (M1)').toBe(true);
      expect(hl.result.clearEvents.length, 'Headless also commits via a room-cleared core event').toBeGreaterThan(0);

      // The spawn jam (if any) must end first: a JAMMED relay intentionally has no
      // portal, and the next door jam needs a clear jam cooldown. Real ticks only.
      // Wait for a non-JAMMED relay so the next jam is legal (the spawn jam may still run).
      await page.waitForFunction(() => {
        const w: any = (window as any).__game.scene.getScene('GameScene').world;
        const v = w.signalView();
        return !!v && v.relay !== 'JAMMED' && v.playerJamCD === 0;
      }, undefined, { timeout: 40000 });
      const routeReady = await snap(page);
      expect(routeReady!.relay!.state, 'the relay is back to ACTIVE before the door phase').toBe('ACTIVE');

      // --- natural door jam: the authored layout puts the door inside range ---
      expect(routeReady!.portal, 'a route portal exists once the room is cleared').not.toBeNull();
      const doorToRelay = Math.hypot(routeReady!.portal!.x - routeReady!.scenario!.relay.x, routeReady!.portal!.y - routeReady!.scenario!.relay.y);
      expect(doorToRelay, 'the authored door is inside JAM_RANGE (real layout fact)').toBeLessThanOrEqual(TUNE.JAM_RANGE);
      const standOnDoor = await walkTo(page, { x: routeReady!.portal!.x, y: routeReady!.portal!.y }, 1.0, 220);
      const atDoor = await snap(page);
      const playerToRelay = Math.hypot(atDoor!.player.x - atDoor!.scenario!.relay.x, atDoor!.player.y - atDoor!.scenario!.relay.y);
      expect(playerToRelay, 'the player standing on the door is in jam range').toBeLessThanOrEqual(TUNE.JAM_RANGE);
      await page.evaluate(() => { (window as any).__p4Batches = []; }); // only this jam
      await tapKey(page, 'KeyY');
      await page.waitForTimeout(500);
      const jammed = await snap(page);
      const jamCommit = await signalCommit(page, 'signal-jammed', 0);
      expect(jamCommit, 'the door jam committed a signal-jammed event').not.toBeNull();
      expect(jamCommit!.ok, 'the core accepted the door jam (range + LOS)').toBe(true);
      expect(jamCommit!.before! - jamCommit!.energy!, `the jam deducts exactly ${TUNE.JAM_COST} (event payload)`).toBe(TUNE.JAM_COST);
      expect(jammed!.relay!.state, 'the relay is JAMMED from the real door position').toBe('JAMMED');
      expect(jammed!.portal, 'a JAMMED relay leaves no route portal').toBeNull();
      expect(jammed!.routeTarget, 'a JAMMED relay has no selectable route').toBeNull();
      const netJamDelta = atDoor!.energy!.player - jammed!.energy!.player;
      await shot(page, `p4-${seed}-${mode}-jam-at-door`);

      await tapKey(page, 'KeyF');
      await page.waitForTimeout(700);
      const afterF = await snap(page);
      expect(afterF!.room!.id, 'F at a JAMMED door does not change rooms').toBe(jammed!.room!.id);

      // --- expiry restores the route without any fixture ---
      const tickAtJam = jammed!.tick;
      await page.waitForFunction((t0: number) => {
        const w: any = (window as any).__game.scene.getScene('GameScene').world;
        return w.sim.tick > t0 + 20 && (w.signalView()?.relay ?? '') !== 'JAMMED';
      }, tickAtJam, { timeout: 60000 });
      const recovered = await snap(page);
      expect(recovered!.relay!.state, 'the relay recovers after the jam window').toBe('ACTIVE');
      expect(recovered!.portal, 'the route portal is selectable again').not.toBeNull();
      expect(recovered!.routeTarget, 'the ACTIVE route is selectable again').toBe(recovered!.scenario!.routes[0].target);
      await shot(page, `p4-${seed}-${mode}-expired`);

      // --- ECHO: real local proposal -> Owner auto-confirm -> next-tick commit ---
      // Done before leaving the room: the relay/device lives here.
      const echo = mode === 'HumanEcho' ? await echoCycle(page) : null;
      if (echo) {
        expect(echo.proposal, 'the product generated a real local proposal').not.toBeNull();
        expect(echo.accepted, 'the Owner confirmation was accepted by the real boundary').toBe(true);
        expect(echo.applied, 'the proposal reached the applied audit on a real tick').toBe(true);
        const changedByKind =
          echo.proposal!.kind === 'scan' ? echo.after!.relay!.evidence > echo.beforeApply!.relay!.evidence
            : echo.proposal!.kind === 'toggle-relay' ? echo.after!.relay!.manual !== echo.beforeApply!.relay!.manual
              : echo.after!.relay!.state === 'JAMMED';
        expect(changedByKind, `the confirmed ${echo.proposal!.kind} produced a real non-combat state change`).toBe(true);
      }
      // If ECHO jammed the relay, wait for the route to come back before travelling.
      await page.waitForFunction(() => {
        const w: any = (window as any).__game.scene.getScene('GameScene').world;
        return (w.signalView()?.relay ?? '') === 'ACTIVE' && !!w.portal;
      }, undefined, { timeout: 60000 });

      // --- take the route for real ---
      const route = await takeRoute(page);
      expect(route.changed, 'a real F press takes the authored route').toBe(true);
      expect(route.after!.room!.id, 'the run is now in the route A room').toBe(recovered!.scenario!.routes[0].target);

      // --- M7: portal art sits on the interaction point (measured at the door) ---
      const spriteOff = recovered!.portalSprite && recovered!.portal
        ? await page.evaluate(({ px, py, sx, sy }: { px: number; py: number; sx: number; sy: number }) => {
          const w: any = (window as any).__game.scene.getScene('GameScene').world;
          const d = w.worldToScreen(px, py);
          return Math.hypot(sx - d.x, sy - d.y);
        }, { px: recovered!.portal!.x, py: recovered!.portal!.y, sx: recovered!.portalSprite!.x, sy: recovered!.portalSprite!.y })
        : null;
      expect(spriteOff, 'the portal sprite is drawn exactly on the interaction point (M7)').not.toBeNull();
      expect(spriteOff!, 'portal art and interaction point agree within 0.5 px').toBeLessThanOrEqual(0.5);
      // The AI observation contract carries the portal POSITION only (it is
      // perceivable-gated by design); it must agree with the interaction point.
      expect(recovered!.observedPortal, 'the observation view exposes the portal').not.toBeNull();
      expect(Math.hypot(
        recovered!.observedPortal!.x - recovered!.portal!.x,
        recovered!.observedPortal!.y - recovered!.portal!.y
      ), 'the observation portal equals the interaction point').toBeLessThanOrEqual(0.5);

      await dropEventTap(page);
      rec(`p4-route-${seed}-${mode}`, {
        runner: 'agent (real keys/mouse; NON-BLIND driver: reads canonical state to aim/route)',
        fixtures,
        seed, mode, spawnToRelay, doorToRelay, playerToRelay, standOnDoor,
        spawnJam: spawnJamResult,
        cleared: { fight, mapFlag: afterFight!.mapCleared, spawned: afterFight!.roomFlags!.spawned, coreClearEvents: clearEvents.length, liveDrones: afterFight!.liveDrones },
        headless: hl.result,
        jam: { commit: jamCommit, netDelta: netJamDelta, state: jammed!.relay!.state, portal: jammed!.portal, routeTarget: jammed!.routeTarget },
        afterF: { room: afterF!.room!.id, unchanged: afterF!.room!.id === jammed!.room!.id },
        recovered: { relay: recovered!.relay!.state, portal: recovered!.portal, routeTarget: recovered!.routeTarget, tickDelta: recovered!.tick - tickAtJam },
        spriteToInteractionPx: spriteOff,
        route: { from: route.before!.room!.id, to: route.after!.room!.id, distanceAtPress: route.dist },
        echo,
        shots: [
          await shot(page, `p4-${seed}-${mode}-route`),
          path.join(outDir('shots'), `p4-${seed}-${mode}-jam-at-door.png`),
          path.join(outDir('shots'), `p4-${seed}-${mode}-expired.png`)
        ]
      });
    });
  }
}

// ---------------------------------------------------------------------------
// reject + no-connection sample: the route stays legal
// ---------------------------------------------------------------------------

test('P4 · rejected proposal and a no-connection sample still leave a legal route', async ({ page }) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: LOCAL_W, height: LOCAL_H });
  await bootDemo(page, SEEDS[0]);
  await enableEchoMode(page);
  await installEventTap(page);
  const fight = await fightUntilCleared(page, 150000);
  const afterFight = await snap(page);
  expect(afterFight!.mapCleared, 'the room is cleared by real play before the reject case').toBe(true);
  void fight;

  const rejected = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    let p = w.echoLocalProposal;
    if (!p) { w.proposeLocalEcho(); p = w.echoLocalProposal; }
    if (!p) return { proposed: false };
    const ok = w.rejectLocalEchoProposal(p.id);
    const audit = w.echoAudit.recent(32).filter((e: any) => e.proposalId === p.id)
      .map((e: any) => ({ tick: e.tick, kind: e.action, result: e.result, code: e.code ?? null }));
    return { proposed: true, id: p.id, kind: p.kind, rejected: ok, audit };
  });
  const afterReject = await snap(page);
  expect(rejected.proposed, 'a real proposal existed to reject').toBe(true);
  expect(rejected.rejected, 'the real reject boundary accepted the rejection').toBe(true);
  expect((rejected.audit ?? []).some((a: any) => a.result === 'rejected' && a.code === 'E_USER_REJECTED'),
    'the rejection is recorded in the audit with its real code').toBe(true);
  expect(afterReject!.relay!.state, 'a rejected proposal does not jam or disable the relay').not.toBe('JAMMED');
  expect(afterReject!.portal, 'a rejected proposal leaves the route portal in place').not.toBeNull();

  // No-connection SAMPLE (not a disconnection test: the run never had a model
  // connection; the P2 model-outage evidence is a separate, earlier record).
  const conn = { companionStatus: afterReject!.companionStatus, modelState: await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return (w.signalView?.() as any)?.modelState ?? null;
  }) };

  const route = await takeRoute(page);
  expect(route.changed, 'the route is still legally traversable after reject + no connection').toBe(true);
  await dropEventTap(page);
  rec('p4-reject-noconn', {
    runner: 'agent (real keys/mouse + real reject call)',
    fixtures: ['autoOwner echo enable', 'seed override'],
    rejected, afterReject: { relay: afterReject!.relay!.state, portal: afterReject!.portal, routeTarget: afterReject!.routeTarget },
    connectionSample: conn,
    note: 'no-connection sample only; the run never connected to a model. P2 holds the separate model-outage evidence.',
    route: { from: route.before!.room!.id, to: route.after!.room!.id },
    shot: await shot(page, 'p4-reject-noconn')
  });
});

// ---------------------------------------------------------------------------
// archive vs checkpoint reload vs raw headless replay (three different things)
// ---------------------------------------------------------------------------

test('P4 · checkpoint reload re-derives the route; raw frame replay keeps authored identity', async ({ page }) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: LOCAL_W, height: LOCAL_H });
  await bootDemo(page, SEEDS[0]);
  await installEventTap(page);
  const fight = await fightUntilCleared(page, 150000);
  void fight;
  const cleared = await snap(page);
  expect(cleared!.mapCleared, 'the room is cleared by real play before the archive case').toBe(true);
  // A non-default relay state makes the route choice observable across the reload.
  await tapKey(page, 'KeyR');
  await page.waitForTimeout(500);
  const atRoute = await snap(page);
  expect(atRoute!.routeTarget, 'a real route target is selected before the reload').not.toBeNull();

  // 0) SAFE POINT: the product only checkpoints at an action boundary, so there
  // is no in-flight local ECHO command here - the queue-drop on resume is a
  // different path from a headless mid-execution restore (see the R1/R2 probes).
  const atSafePoint = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return { pendingLocal: w.echoPendingLocal, queue: w.sim.pendingCommands.map((c: any) => c.type) };
  });
  expect(atSafePoint.pendingLocal, 'no in-flight local ECHO action at the checkpoint').toBeNull();
  expect(atSafePoint.queue.length <= 1, 'at most one core command is in flight at a safe point').toBe(true);

  // 1) ARCHIVE: capture the real checkpoint the product writes and hash its bytes.
  const checkpoint = await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const cp = gs.world.captureCheckpoint(gs.runId, gs.seed, gs.runStats());
    return cp ? JSON.parse(JSON.stringify(cp)) : null;
  });
  expect(checkpoint, 'a real checkpoint was captured').not.toBeNull();
  const archivedBytes = JSON.stringify(checkpoint);
  const archivedSha = await page.evaluate(async (s: string) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }, archivedBytes);

  // 2) RELOAD: a real page reload + the product's own CONTINUE path.
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 30000 });
  await page.waitForTimeout(600);
  await clickLabel(page, 'MainMenuScene', 'CONTINUE');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 30000 });
  await page.waitForTimeout(1200);
  const reloaded = await snap(page);
  expect(reloaded!.room!.id, 'CONTINUE returns to the authored room').toBe(cleared!.room!.id);
  expect(reloaded!.mapCleared, 'the resumed run keeps the cleared room').toBe(true);
  expect(reloaded!.scenario, 'the authored scenario is re-attached on restore (M2)').not.toBeNull();
  expect(reloaded!.routeTarget, 'the route target survives the reload').toBe(atRoute!.routeTarget);
  expect(reloaded!.portal, 'the reloaded presenter re-derives the portal').not.toBeNull();
  expect(reloaded!.portal!.target, 'the re-derived portal points at the same room').toBe(atRoute!.portal!.target);
  const afterReloadQueue = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return { queue: w.sim.pendingCommands.map((c: any) => c.type), pendingLocal: w.echoPendingLocal };
  });
  expect(afterReloadQueue.queue, 'the resumed run starts with an empty command queue').toEqual([]);
  expect(afterReloadQueue.pendingLocal, 'no stale local ECHO pending after the resume').toBeNull();
  await shot(page, 'p4-reload-vs-replay');

  // 3) RAW HEADLESS REPLAY: snapshot -> fromFrame -> replay, all in the same model.
  const hl = headlessClear(SEEDS[0]);
  expect(hl.cleared, 'the Headless counterpart reaches its own clear').toBe(true);
  const frame = hl.world.snapshot();
  const restored = HeadlessWorld.fromFrame(frame);
  const step = [{ ticks: 2, intent: { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false } }];
  // `replay` compares the re-run against THIS session's real state for the same
  // interval, so the live model must advance by the steps too (otherwise the
  // comparison is meaningless by construction).
  hl.world.runSteps(step);
  const replayResult = hl.world.replay(frame, step);
  rec('p4-reload-vs-replay', {
    runner: 'agent (real reload + CONTINUE) + node headless model',
    archived: { routeTarget: atRoute!.routeTarget, portal: atRoute!.portal, room: atRoute!.room, cleared: atRoute!.mapCleared, checkpointSha256: archivedSha, checkpointBytes: archivedBytes.length },
    safePoint: atSafePoint,
    reloaded: { routeTarget: reloaded!.routeTarget, portal: reloaded!.portal, room: reloaded!.room, cleared: reloaded!.mapCleared, relay: reloaded!.relay!.state, queueAfterResume: afterReloadQueue },
    headless: {
      frameEpoch: frame.epoch,
      fromFrameAuthored: (restored as any).demoScenario ?? (restored as any).state?.authored ?? null,
      fromFrameRoute: restored.routeState,
      replayKeys: Object.keys(replayResult ?? {}),
      replayResult
    },
    note: 'the checkpoint archive, the rendered reload and the headless frame replay are three separate facts'
  });
  // The replay path is a REAL model comparison, not just a call that returned.
  expect(replayResult.ok, 'replay accepted the frame and steps').toBe(true);
  expect(replayResult.sameState, 'replay reproduces the same canonical state').toBe(true);
  expect(replayResult.sameEvents, 'replay reproduces the same canonical events').toBe(true);
  expect(restored.routeState, 'a raw frame keeps the authored route identity (M2)').not.toBeNull();
  expect(restored.routeState!.roomCleared, 'the raw frame keeps the committed clear').toBe(true);
  expect(restored.routeState!.target, 'the raw frame keeps the same route target').toBe(hl.world.routeState.target);
  expect(restored.routeState!.portal, 'the raw frame re-derives the portal').toEqual(hl.world.routeState.portal);
});

// ---------------------------------------------------------------------------
// 3-seed authored layout validity (static: no clear needed) + identity parity
// ---------------------------------------------------------------------------

test('P4 · three seeds produce valid, distinct authored layouts (World and Headless agree)', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: LOCAL_W, height: LOCAL_H });
  const rows: any[] = [];
  for (const seed of SEEDS) {
    await bootDemo(page, seed);
    const s = await snap(page);
    expect(s!.seed, `seed ${seed} is the run seed`).toBe(seed);
    expect(s!.scenario, `seed ${seed}: the authored scene exists`).not.toBeNull();
    expect(s!.scenarioError, `seed ${seed}: no layout failure notice`).toBeNull();
    const sc = s!.scenario!;
    expect(sc.startRoomId, `seed ${seed}: the authored start room identity is captured`).not.toBeNull();
    expect(new Set(sc.routes.map((r) => r.target)).size, `seed ${seed}: two distinct route targets`).toBe(2);
    expect(sc.routes[0].when, `seed ${seed}: route A is RELAY_ACTIVE`).toBe('RELAY_ACTIVE');
    expect(sc.routes[1].when, `seed ${seed}: route B is RELAY_INACTIVE`).toBe('RELAY_INACTIVE');
    const sep = Math.hypot(sc.routes[0].portal!.x - sc.routes[1].portal!.x, sc.routes[0].portal!.y - sc.routes[1].portal!.y);
    expect(sep, `seed ${seed}: the two route cells are separated`).toBeGreaterThan(1.0);
    const spawnRelay = Math.hypot(sc.playerStart!.x - sc.relay.x, sc.playerStart!.y - sc.relay.y);
    expect(spawnRelay, `seed ${seed}: spawn != device`).toBeGreaterThan(0.5);
    const relayToA = Math.hypot(sc.routes[0].portal!.x - sc.relay.x, sc.routes[0].portal!.y - sc.relay.y);
    const relayToB = Math.hypot(sc.routes[1].portal!.x - sc.relay.x, sc.routes[1].portal!.y - sc.relay.y);
    expect(Math.max(relayToA, relayToB), `seed ${seed}: both doors are inside JAM_RANGE from the device`).toBeLessThanOrEqual(TUNE.JAM_RANGE);
    expect(sc.drones, `seed ${seed}: two authored sentries`).toBe(2);
    const hl = headlessLayout(seed);
    expect(hl.roomId, `seed ${seed}: Headless authored room matches the World`).toBe(sc.roomId);
    expect(hl.startRoomId, `seed ${seed}: Headless start room identity matches`).toBe(sc.startRoomId);
    expect(hl.relay ? { x: hl.relay.x, y: hl.relay.y } : null, `seed ${seed}: Headless relay cell matches`).toEqual(sc.relay);
    expect(hl.routes.map((r: any) => r.portal), `seed ${seed}: Headless route cells match`).toEqual(sc.routes.map((r) => r.portal));
    rows.push({
      seed, roomId: sc.roomId, startRoomId: sc.startRoomId, relay: sc.relay, playerStart: sc.playerStart,
      routes: sc.routes, spawnRelay, relayToA, relayToB, routeSeparation: sep, drones: sc.drones,
      headless: { roomId: hl.roomId, startRoomId: hl.startRoomId, relay: hl.relay, routes: hl.routes }
    });
  }
  const shapes = new Set(rows.map((r) => JSON.stringify({ p: r.playerStart, a: r.routes[0].portal, b: r.routes[1].portal })));
  expect(shapes.size, 'the three seeds produce genuinely different layouts').toBeGreaterThan(1);
  rec('p4-layout-3seeds', {
    runner: 'agent (real menu entry per seed)',
    fixtures: ['seed override (menu start wrapper)'],
    jamRange: TUNE.JAM_RANGE, rows,
    parity: 'Headless demo scenario cells/identity equal the rendered ones for every seed',
    shot: await shot(page, 'p4-layout-3seeds')
  });
});
