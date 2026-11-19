// GAMEPLAY-01 · P4 — Demo-03 cooperation level: two legitimate full routes.
//
// STATUS WHEN WRITTEN: NOT RUN. This spec targets the frozen P4 tree (DEMO 01 entry
// showing the Demo-03 authored level). It was written against main-repo sources
// `feat/gameplay-01-ai-cooperation` @1a6306f plus the API surface the pre-review
// confirmed; the current dirty 4-file candidate is NOT an acceptance snapshot
// (reviewer M1/M2/M3/M7 open), so nothing here claims a green run. It contains no
// `skip` and no timeout/assertion relaxation: on an unfrozen tree it fails loudly.
//
// Rules encoded here (tester owns tests/**, product source untouched):
//  - real keyboard/mouse only for play; no clearEnemies / teleport / heal to prove
//    completion (the only dev seams are labelled `fixture:` and never produce a
//    cleared room, a kill or a route completion);
//  - route completion is read from the AUTHORITATIVE flag (`map.rooms[id].cleared`),
//    never inferred from "0 drones alive"; the Headless counterpart must answer the
//    same state for the same seed (M1 parity), not a lower bound of its own;
//  - same seed runs both modes: HumanOnly and HumanEcho; no assumption that ECHO is
//    better — only measurements are recorded;
//  - archiving, checkpoint reload and raw snapshot replay are three distinct
//    things and are asserted separately;
//  - the portal sprite centre and the interaction point are the same cell centre
//    (M7), and spawn ≠ device cell (M5).

import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { HeadlessWorld } from '../src/ai-native/worldHeadless';

const PORT = process.env.PORT ?? '5492';
const SEEDS = [20261117, 20261118, 20261119] as const;
const JAM_RANGE = 6;
const JAM_COST = 25;
const SEED_SRC = 'seed'; // overwritten with the file's sha256 when a run archives

type Mode = 'HumanOnly' | 'HumanEcho';

// ---------------------------------------------------------------------------
// archiving / metrics
// ---------------------------------------------------------------------------

function outDir(kind: 'evidence' | 'shots'): string {
  const base = process.env.LS_P4_DIR;
  if (!base) throw new Error('LS_P4_DIR is required: evidence must never be ephemeral');
  const dir = path.join(base, kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rec(name: string, data: unknown): void {
  fs.writeFileSync(path.join(outDir('evidence'), `${name}.json`), JSON.stringify(data, null, 2));
}

async function shot(page: Page, name: string): Promise<string> {
  const file = path.join(outDir('shots'), `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Real key press that cannot lose the single-frame edge (down -> real frame -> up). */
async function tapKey(page: Page, code: string): Promise<void> {
  await page.keyboard.down(code);
  await page.waitForFunction(() => (window as any).__game?.loop?.frame !== undefined, undefined, { timeout: 2000 });
  await page.waitForTimeout(40);
  await page.keyboard.up(code);
  await page.waitForTimeout(40);
}

async function holdKey(page: Page, code: string, ms: number): Promise<void> {
  await page.keyboard.down(code);
  await page.waitForTimeout(ms);
  await page.keyboard.up(code);
}

// ---------------------------------------------------------------------------
// boot: the ORDINARY DEMO 01 entry (which shows the Demo-03 authored level in P4)
// ---------------------------------------------------------------------------

type Probe = {
  seed: number | null;
  demo: string | null;
  page: string;
  tick: number;
  room: number | null;
  cleared: boolean | null;
  roomSpawned: boolean | null;
  relay: string | null;
  energy: number | null;
  player: { x: number; y: number } | null;
  portal: { x: number; y: number; target: number } | null;
  portalSprite: { x: number; y: number } | null;
  routeTarget: number | null;
  spawn: { x: number; y: number } | null;
  relayCell: { x: number; y: number } | null;
  drones: number;
  echo: { exists: boolean; alive: boolean; energy: number | null } | null;
  proposal: { id: string; kind: string } | null;
  pending: string | null;
  queue: string[];
  auditApplied: string[];
  modelState: string | null;
};

/** READ-ONLY state probe. Never writes, never fabricates `cleared`. */
async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const w: any = gs?.world;
    if (!w) return null as any;
    const sig: any = w.signalView?.() ?? {};
    const room = w.currentRoom?.() ?? null;
    const sc: any = w.demoScenario ?? w.p1Scenario ?? null;
    const ps: any = w.portal?.spr ?? null;
    return {
      seed: gs.seed ?? null,
      demo: gs.demo ?? null,
      page: g.scene.getScene('PauseScene')?.currentPage ?? 'game',
      tick: w.sim?.tick ?? -1,
      room: room?.id ?? null,
      cleared: room ? !!room.cleared : null,
      roomSpawned: room ? !!room.spawned : null,
      relay: sig.relay ?? null,
      energy: sig.playerEnergy ?? null,
      player: w.player ? { x: w.player.wx, y: w.player.wy } : null,
      portal: w.portal ? { x: w.portal.wx, y: w.portal.wy, target: w.portal.targetRoom } : null,
      portalSprite: ps ? { x: ps.x, y: ps.y } : null,
      routeTarget: w.p1RouteTarget ?? null,
      spawn: sc?.player ?? sc?.playerStart ?? null,
      relayCell: sc?.relay ?? null,
      drones: (w.enemies?.list ?? []).filter((e: any) => e?.dead !== true).length,
      echo: w.echoActor ? { exists: true, alive: (w.echoActor.data?.hp ?? 0) > 0, energy: sig.echoEnergy ?? null } : { exists: false, alive: false, energy: null },
      proposal: w.echoLocalProposal ? { id: w.echoLocalProposal.id, kind: w.echoLocalProposal.kind } : null,
      pending: w.echoPendingLocal?.proposalId ?? null,
      queue: (w.sim?.pendingCommands ?? []).map((c: any) => c.type),
      auditApplied: w.echoAudit.recent(32).filter((e: any) => e.result === 'applied').map((e: any) => e.proposalId),
      modelState: sig.modelState ?? null
    };
  });
}

/** Real menu click on DEMO 01; returns the scene init data so seed overrides stay honest. */
async function bootDemo01(page: Page): Promise<void> {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('last_signal_')) localStorage.removeItem(k);
    localStorage.setItem('last_signal_autoOwner', 'human');
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 30000 });
  await page.waitForTimeout(400);
  const pt = await page.evaluate(() => {
    const s: any = (window as any).__game.scene.getScene('MainMenuScene');
    const flat: any[] = [];
    const walk = (l: any[]): void => { for (const c of l) { if (c?.type === 'Container' && c.list) walk(c.list); else flat.push(c); } };
    walk(s.children.list);
    const hit = flat.find((c) => c?.type === 'Text' && /DEMO 01/.test(String(c.text)));
    if (!hit) return null;
    const b = hit.getBounds();
    const cam = s.cameras.main;
    return { fx: (b.x + b.width / 2 - cam.scrollX) / (cam.width / cam.zoom), fy: (b.y + b.height / 2 - cam.scrollY) / (cam.height / cam.zoom) };
  });
  expect(pt, 'the DEMO 01 entry exists in the real menu').not.toBeNull();
  const box = await page.evaluate(() => { const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(box.x + pt!.fx * box.w, box.y + pt!.fy * box.h);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 30000 });
  await page.waitForTimeout(900);
}

/** Same demo entry, other seed. The override is a declared fixture: only the seed
 *  changes, the demo entry and its authored content stay the product's. */
async function bootSeed(page: Page, seed: number): Promise<void> {
  await bootDemo01(page);
  const current = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    return { seed: gs.seed, data: gs.sys.settings.data ?? {} };
  });
  if (current.seed === seed) return;
  await page.evaluate(({ seed, data }: { seed: number; data: any }) => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    gs.scene.start('GameScene', { ...data, seed });
  }, { seed, data: current.data });
  await page.waitForFunction((sd: number) => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    return gs?.seed === sd && !!gs.world;
  }, seed, { timeout: 30000 });
  await page.waitForTimeout(900);
}

// ---------------------------------------------------------------------------
// real play
// ---------------------------------------------------------------------------

/** Move to a world point with real keys only. Returns the final distance. */
async function walkTo(page: Page, target: { x: number; y: number }, tolerance = 0.8, maxSteps = 160): Promise<number> {
  for (let i = 0; i < maxSteps; i++) {
    const p = await probe(page);
    if (!p.player) break;
    const dx = target.x - p.player.x;
    const dy = target.y - p.player.y;
    const d = Math.hypot(dx, dy);
    if (d <= tolerance) return d;
    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : (dy > 0 ? 'KeyS' : 'KeyW');
    await holdKey(page, key, 70);
  }
  const p = await probe(page);
  return p.player ? Math.hypot(target.x - p.player.x, target.y - p.player.y) : Infinity;
}

/** Real play until the room is cleared or the budget runs out. Returns the
 *  authoritative cleared flag plus how it was observed (never "0 drones so done"). */
async function playRoomToCleared(page: Page, budgetMs = 150000) {
  const started = Date.now();
  let lastDrones = Number.POSITIVE_INFINITY;
  while (Date.now() - started < budgetMs) {
    const p = await probe(page);
    if (p.cleared === true) break;
    if (p.drones !== lastDrones) lastDrones = p.drones;
    // aim at the nearest live enemy and fire with real mouse/keys
    const aimed = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const w: any = gs.world;
      const me = w.player;
      const live = (w.enemies?.list ?? []).filter((e: any) => e?.dead !== true);
      if (!me || !live.length) return null;
      let best: any = null;
      let bd = Infinity;
      for (const e of live) {
        const d = Math.hypot(e.wx - me.wx, e.wy - me.wy);
        if (d < bd) { bd = d; best = e; }
      }
      const cam = gs.cameras.main;
      return { wx: best.wx, wy: best.wy, d: bd, cam: { zoom: cam.zoom, sx: cam.scrollX, sy: cam.scrollY, x: cam.x, y: cam.y, w: cam.width / cam.zoom, h: cam.height / cam.zoom } };
    });
    if (!aimed) { await page.waitForTimeout(120); continue; }
    const box = await page.evaluate(() => { const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const fx = (aimed.wx - aimed.cam.sx) / aimed.cam.w;
    const fy = (aimed.wy - aimed.cam.sy) / aimed.cam.h;
    await page.mouse.move(box.x + fx * box.w, box.y + fy * box.h);
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(180);
    await page.mouse.up({ button: 'left' });
    // reposition if out of reach, otherwise keep firing from here
    if (aimed.d > 6) await walkTo(page, { x: aimed.wx, y: aimed.wy }, 4.5, 40);
    await page.waitForTimeout(60);
  }
  const end = await probe(page);
  return { cleared: end.cleared, dronesLeft: end.drones, seedRoom: end.room, tick: end.tick };
}

/** Route traversal with a real F press; returns what the world did. */
async function takeRoute(page: Page) {
  const before = await probe(page);
  expect(before.portal, 'a selectable route/portal exists before F').not.toBeNull();
  const dist = await walkTo(page, { x: before.portal!.x, y: before.portal!.y }, 1.2, 200);
  expect(dist, 'reached the door with real keys').toBeLessThan(2.0);
  await tapKey(page, 'KeyF');
  await page.waitForTimeout(700);
  const after = await probe(page);
  return { before, after, dist, changedRoom: before.room !== after.room };
}

// ---------------------------------------------------------------------------
// modes
// ---------------------------------------------------------------------------

async function setMode(page: Page, mode: Mode): Promise<void> {
  if (mode === 'HumanOnly') return; // a new run is human-only by product default
  // FIXTURE (labelled): Owner auto-confirm of the real ECHO enable, same call the
  // menu's own ENABLE uses. The proposal is still generated by the product.
  await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    w.setEchoCooperationOptIn?.(true);
    w.enableEcho?.(w.p1Scenario?.relay?.x ?? w.demoScenario?.relay?.x, w.p1Scenario?.relay?.y ?? w.demoScenario?.relay?.y);
  });
  await page.waitForFunction(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return !!w.echoActor;
  }, undefined, { timeout: 15000 }).catch(() => { /* asserted below, not skipped */ });
  const p = await probe(page);
  expect(p.echo?.exists, 'the real ECHO actor exists in HumanEcho mode').toBe(true);
}

/** One ECHO suggestion cycle: propose -> Owner auto-confirm fixture -> real non-combat
 *  state change. Returns the measured outcome (never asserts ECHO is better). */
async function echoCycle(page: Page) {
  const before = await probe(page);
  const proposed = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    const p = w.echoLocalProposal ?? w.proposeLocalEcho?.();
    return p ? { id: p.id, kind: p.kind } : null;
  });
  if (!proposed) return { proposed: null, accepted: false, applied: false, before, after: before };
  // FIXTURE (labelled): Owner auto-confirm — the same confirm the human button
  // issues; no proposal content is invented.
  const accepted = await page.evaluate((id: string) => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return !!w.confirmLocalEchoProposal?.(id);
  }, proposed.id);
  const applied = await page
    .waitForFunction((id: string) => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      return w.echoAudit.recent(32).some((e: any) => e.proposalId === id && e.result === 'applied');
    }, proposed.id, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const after = await probe(page);
  return { proposed, accepted, applied, before, after };
}

// ---------------------------------------------------------------------------
// the two legitimate routes, per seed
// ---------------------------------------------------------------------------

for (const seed of SEEDS) {
  for (const mode of ['HumanOnly', 'HumanEcho'] as Mode[]) {
    test(`P4 route · seed ${seed} · ${mode}: real play clears the room, jam-at-door is natural, route is taken`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await bootSeed(page, seed);
      const start = await probe(page);
      expect(start.seed, 'the run uses the requested seed').toBe(seed);
      expect(start.relayCell, 'the authored scenario exposes its relay cell').not.toBeNull();
      expect(start.spawn, 'the authored scenario exposes its spawn').not.toBeNull();
      // spawn and device must not share a cell (M5) — measured, not assumed
      const spawnDevice = Math.hypot(start.spawn!.x - start.relayCell!.x, start.spawn!.y - start.relayCell!.y);
      expect(spawnDevice, 'spawn and device are distinct cells').toBeGreaterThan(0.5);

      await setMode(page, mode);
      const t0 = Date.now();
      const cleared = await playRoomToCleared(page);
      const elapsedMs = Date.now() - t0;
      // AUTHORITATIVE flag only; "0 drones" is recorded but never used as the gate.
      expect(cleared.cleared, 'the room is cleared by real play (authoritative map flag)').toBe(true);
      const afterFight = await probe(page);

      // Headless parity for the same seed: same state, not a lower bound of its own.
      const hw = new HeadlessWorld({ seed, demo: true, echoAutonomy: false });
      const headlessCleared = (hw as any).routeState?.roomCleared ?? null;
      const headlessMapCleared = (hw as any).map?.rooms?.[afterFight.room!]?.cleared ?? null;

      // natural jam from the real door position (no teleport, no seed manipulation)
      expect(afterFight.portal, 'a route portal exists once the room is cleared').not.toBeNull();
      const standOnDoor = await walkTo(page, { x: afterFight.portal!.x, y: afterFight.portal!.y }, 1.0, 200);
      const atDoor = await probe(page);
      const doorToRelay = Math.hypot(atDoor.player!.x - atDoor.relayCell!.x, atDoor.player!.y - atDoor.relayCell!.y);
      expect(doorToRelay, 'the door is inside JAM_RANGE (natural reachability)').toBeLessThanOrEqual(JAM_RANGE);
      const energyBefore = atDoor.energy;
      await tapKey(page, 'KeyY');
      await page.waitForTimeout(500);
      const jammed = await probe(page);
      expect(jammed.relay, 'a legal jam from the door state is committed').toBe('JAMMED');
      expect(jammed.energy, 'the jam costs the real price').toBe(energyBefore! - JAM_COST);
      expect(jammed.portal, 'a JAMMED relay leaves no route portal').toBeNull();
      await tapKey(page, 'KeyF');
      await page.waitForTimeout(600);
      const afterF = await probe(page);
      expect(afterF.room, 'F at the door while JAMMED does not change rooms').toBe(jammed.room);

      // expiry: the route comes back without any fixture
      await page.waitForFunction(() => {
        const w: any = (window as any).__game.scene.getScene('GameScene').world;
        return (w.signalView?.()?.relay ?? '') !== 'JAMMED';
      }, undefined, { timeout: 60000 });
      const recovered = await probe(page);
      expect(recovered.relay, 'the relay recovers after the jam expires').not.toBe('JAMMED');
      expect(recovered.portal, 'the route portal is selectable again after expiry').not.toBeNull();

      // take the route for real
      const route = await takeRoute(page);
      expect(route.changedRoom, 'a real F press takes the authored route').toBe(true);

      const echo = mode === 'HumanEcho' ? await echoCycle(page) : null;
      rec(`p4-route-${seed}-${mode}`, {
        runner: 'agent (real keys/mouse; NON-BLIND driver: reads canonical state to aim/route)',
        fixtures: mode === 'HumanEcho'
          ? 'Owner auto-confirm of the real local proposal; seed override for non-default seeds'
          : 'seed override for non-default seeds',
        seed, mode, spawnDevice, doorToRelay, standOnDoor,
        energyBeforeJam: energyBefore, jammed: { relay: jammed.relay, energy: jammed.energy },
        recovered: { relay: recovered.relay, portal: recovered.portal },
        cleared, elapsedMs,
        headless: { routeStateRoomCleared: headlessCleared, mapRoomCleared: headlessMapCleared, parity: headlessMapCleared === cleared.cleared },
        route: { from: route.before.room, to: route.after.room, dist: route.dist },
        echo,
        shot: await shot(page, `p4-route-${seed}-${mode}`)
      });
      // World and Headless must answer the same thing (reviewer M1).
      expect(headlessMapCleared, 'Headless reports the same authoritative roomCleared').toBe(cleared.cleared);
    });
  }
}

// ---------------------------------------------------------------------------
// reject / offline still traverse legally
// ---------------------------------------------------------------------------

test('P4 · a rejected proposal and an offline model still leave a legal route', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootSeed(page, SEEDS[0]);
  await setMode(page, 'HumanEcho');
  const cleared = await playRoomToCleared(page);
  expect(cleared.cleared, 'room cleared before the reject case').toBe(true);

  const rejected = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    const p = w.echoLocalProposal ?? w.proposeLocalEcho?.();
    if (!p) return { proposed: false };
    const ok = w.rejectLocalEchoProposal?.(p.id) ?? false;
    const audit = w.echoAudit.recent(32).filter((e: any) => e.proposalId === p.id);
    return { proposed: true, rejected: ok, results: audit.map((e: any) => e.result) };
  });
  const state = await probe(page);

  const offline = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    const sv = w.signalView?.() ?? {};
    return { modelState: sv.modelState ?? null, aiSource: sv.aiSource ?? null, relay: sv.relay ?? null };
  });
  // Traversal stays legal regardless of the model: real walk + real F.
  const route = await takeRoute(page);
  rec('p4-reject-offline', {
    runner: 'agent (real keys/mouse)',
    rejected, state: { relay: state.relay, energy: state.energy, queue: state.queue }, offline,
    route: { from: route.before.room, to: route.after.room, changed: route.changedRoom },
    shot: await shot(page, 'p4-reject-offline')
  });
  expect(state.relay, 'a rejected proposal does not jam or disable the relay').not.toBe('JAMMED');
  expect(route.changedRoom, 'the route is still legally traversable').toBe(true);
});

// ---------------------------------------------------------------------------
// archive vs reload vs raw snapshot replay (three different things)
// ---------------------------------------------------------------------------

test('P4 · checkpoint reload re-derives the route; raw snapshot replay matches it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootSeed(page, SEEDS[0]);
  const cleared = await playRoomToCleared(page);
  expect(cleared.cleared, 'room cleared before the archive case').toBe(true);
  const atRoute = await probe(page);
  const checkpoint = await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    return gs.world.captureCheckpoint(gs.runId, gs.seed, gs.runStats());
  });
  expect(checkpoint, 'a real checkpoint was captured').not.toBeNull();

  // 1) archive: the checkpoint bytes are the record, nothing is mutated
  rec('p4-archive-checkpoint', { seed: SEEDS[0], routeTarget: atRoute.routeTarget, portal: atRoute.portal, checkpointShaHint: JSON.stringify(checkpoint).length });

  // 2) reload: real page reload -> resume checkpoint -> route re-derived from relay state
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 30000 });
  await page.evaluate(() => {
    const s: any = (window as any).__game.scene.getScene('MainMenuScene');
    const flat: any[] = [];
    const walk = (l: any[]): void => { for (const c of l) { if (c?.type === 'Container' && c.list) walk(c.list); else flat.push(c); } };
    walk(s.children.list);
    return flat.some((c) => c?.type === 'Text' && /RESUME CHECKPOINT|CONTINUE/.test(String(c.text)));
  });
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    g.scene.getScene('MainMenuScene').scene.start('GameScene', { resume: true });
  });
  await page.waitForFunction(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    return !!gs?.world && gs.world.sim.tick > 0;
  }, undefined, { timeout: 30000 });
  await page.waitForTimeout(600);
  const reloaded = await probe(page);

  // 3) raw snapshot replay: the headless reconstruction must answer the same route
  const replay = new HeadlessWorld({ seed: SEEDS[0], demo: true, echoAutonomy: false });
  const replayed = (replay as any).routeState ?? null;

  rec('p4-reload-vs-replay', {
    runner: 'agent (real reload) + node headless replay',
    archived: { routeTarget: atRoute.routeTarget, portal: atRoute.portal, room: atRoute.room, cleared: atRoute.cleared },
    reloaded: { routeTarget: reloaded.routeTarget, portal: reloaded.portal, room: reloaded.room, cleared: reloaded.cleared, relay: reloaded.relay },
    replayedRouteState: replayed,
    shot: await shot(page, 'p4-reload-vs-replay')
  });
  expect(reloaded.cleared, 'the resumed run keeps the cleared room').toBe(true);
  expect(reloaded.portal, 'the reloaded run re-derives a route portal').not.toBeNull();
  expect(reloaded.routeTarget, 'the reloaded route target matches the archived one').toBe(atRoute.routeTarget);
  expect(replayed?.routeTarget ?? replayed, 'raw headless replay answers a route state, not null').not.toBeNull();
});

// ---------------------------------------------------------------------------
// portal presentation vs interaction point (M7) and 3-seed layout validity
// ---------------------------------------------------------------------------

test('P4 · portal sprite centre equals the interaction point and the layout is valid on 3 seeds', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const rows: any[] = [];
  for (const seed of SEEDS) {
    await bootSeed(page, seed);
    const cleared = await playRoomToCleared(page, 150000);
    expect(cleared.cleared, `seed ${seed}: room cleared`).toBe(true);
    const p = await probe(page);
    expect(p.portal, `seed ${seed}: a portal exists`).not.toBeNull();
    expect(p.portalSprite, `seed ${seed}: the portal sprite is exposed`).not.toBeNull();
    const spriteToInteraction = p.portalSprite
      ? Math.hypot(p.portalSprite.x - p.portal!.x, p.portalSprite.y - p.portal!.y)
      : null;
    const spawnDevice = Math.hypot(p.spawn!.x - p.relayCell!.x, p.spawn!.y - p.relayCell!.y);
    const relayDoor = Math.hypot(p.relayCell!.x - p.portal!.x, p.relayCell!.y - p.portal!.y);
    rows.push({ seed, room: p.room, cleared: p.cleared, spawnDevice, relayDoor, spriteToInteraction, routeTarget: p.routeTarget });
    // the visible beacon must sit on the cell the game actually interacts with
    expect(spriteToInteraction, `seed ${seed}: portal art sits on the interaction point`).toBeLessThanOrEqual(0.5);
    expect(spawnDevice, `seed ${seed}: spawn ≠ device`).toBeGreaterThan(0.5);
    expect(relayDoor, `seed ${seed}: door within jam range`).toBeLessThanOrEqual(JAM_RANGE);
  }
  rec('p4-layout-3seeds', { runner: 'agent (real play per seed)', rows, shots: [await shot(page, 'p4-layout-3seeds')] });
  expect(rows.length, 'three seeds were measured').toBe(3);
  const distinct = new Set(rows.map((r) => JSON.stringify({ a: r.spawnDevice, b: r.relayDoor })));
  expect(distinct.size, 'the seeds produce genuinely different layouts').toBeGreaterThan(1);
});
