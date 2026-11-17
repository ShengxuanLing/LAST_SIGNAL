// AI-NATIVE-02 P1 — real-World verification for human / local-AI shared control.
//
// Drives the actual rendered Phaser World (not Station Zero, not a headless
// engine): fixed-seed run from the real main menu, local deterministic
// controller enabled through the real Pause menu, real sampling of player
// position / intent owner / AI action / HUD, human safety takeover, pause
// freeze, pause-menu disable, level-up-overlay takeover, death, restart and
// scene exit, plus HUD checks at five viewports.
//
// It proves exactly what it measures: a LOCAL DETERMINISTIC controller with
// NO external agent connected. It does not claim a real LLM/Codex run, a
// Headless World or an MCP-in-Scene integration.
//
// Evidence scope (F-07): this spec injects fixed seed, i-frames refresh,
// addXp level-ups, hidden enemies, a second weapon, synthetic lethal damage,
// enteredRooms mutation, temporary tile.type='wall', plus synthetic Boss/portal
// coordinates for the perception-bounds case. It therefore proves control
// ownership / pause / takeover / UI-click ownership / geometry / perception
// bounds, NOT real combat survival or AI skill. Independent no-fixture probes
// for the parent commit 2d78e80 live in
// reports/ai-native-02/tester/p1-final/; independent no-fixture probes for the
// fix commit 1aadd2e live in
// reports/ai-native-02/tester/p1-fixes-final/. Neither class is a real external
// Agent or a human playtest; commit attribution is in
// docs/AI_NATIVE_PHASE_REPORTS.md.
//
// Recommended run (frozen built snapshot, no HMR):
//   npm run build
//   npx vite preview --port 5173 --strictPort
//   npx vite preview --port 5199 --strictPort
//   PORT=5173 npx playwright test tests/ai-native-world.spec.ts --workers=1

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SAVE_KEY } from '../src/config/game';
import { clickLabel, openAiHub, openEcho, resumeGame } from './uiNav';

const PORT = Number(process.env.PORT ?? 5173);
const SEED = 424242;
const OUT = process.env.LS_AI_EVIDENCE_DIR
  ? path.resolve(process.env.LS_AI_EVIDENCE_DIR)
  : path.resolve('reports/ai-native-02/evidence');

const GAME_W = 1280;
const GAME_H = 720;

interface LogEntry { step: string; detail: Record<string, unknown>; }
let log: LogEntry[] = [];
function record(step: string, detail: Record<string, unknown> = {}): void {
  log.push({ step, detail });
}
function saveLog(name: string): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `operation-log-${name}.json`), JSON.stringify(log, null, 2));
  log = [];
}

async function canvasBox(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
  });
}

async function logicalToCss(page: Page, lx: number, ly: number) {
  const box = await canvasBox(page);
  if (!box) throw new Error('no canvas');
  return { x: box.x + (lx * box.w) / GAME_W, y: box.y + (ly * box.h) / GAME_H };
}

async function gridToCss(page: Page, gx: number, gy: number) {
  const logical = await page.evaluate(({ gx, gy }) => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const w = gs.world, cam = gs.cameras.main;
    const p0 = cam.getWorldPoint(0, 0);
    const px = cam.getWorldPoint(100, 0);
    const py = cam.getWorldPoint(0, 100);
    const ax = (px.x - p0.x) / 100, bx = p0.x;
    const ay = (py.y - p0.y) / 100, by = p0.y;
    const d = w.worldToScreen(gx, gy);
    return { x: (d.x - bx) / ax, y: (d.y - by) / ay };
  }, { gx, gy });
  const box = await canvasBox(page);
  if (!box) throw new Error('no canvas');
  return { x: box.x + logical.x * box.w / GAME_W, y: box.y + logical.y * box.h / GAME_H };
}

async function clickLogical(page: Page, lx: number, ly: number): Promise<void> {
  const p = await logicalToCss(page, lx, ly);
  await page.mouse.click(p.x, p.y);
}

async function state(page: Page) {
  return page.evaluate(() => {
    const g: any = (window as any).__game;
    // Production builds minify class names: always resolve scenes by key.
    const gs: any = g.scene.getScene('GameScene');
    if (!gs?.world) return null;
    const ctl = gs.world.player.control;
    const snap = ctl.snapshot();
    const intent = gs.world.player.lastIntent;
    return {
      active: g.scene.getScenes(true).map((s: any) => s.sys.settings.key),
      paused: gs.paused,
      aiEnabled: ctl.aiEnabled,
      owner: ctl.owner,
      authorityPaused: ctl.paused,
      mode: snap.mode,
      modeLabel: snap.modeLabel,
      lastAiAction: snap.lastAiAction,
      lastAiTarget: snap.lastAiTarget,
      aiActionCount: snap.aiActionCount,
      takeoverCount: snap.takeoverCount,
      lastTakeoverReason: snap.lastTakeoverReason,
      externalAgentConnected: snap.externalAgentConnected,
      grid: { x: gs.world.player.wx, y: gs.world.player.wy },
      intent: { move: intent.move, fire: intent.fire, aim: intent.aim, interact: intent.interact },
      lastIntentOwner: gs.world.player.lastIntentOwner,
      walkable: gs.world.isWalkable(gs.world.player.wx, gs.world.player.wy, 0.5),
      enemies: gs.world.enemies.length,
      projectiles: gs.world.projectiles.length,
      hp: gs.world.player.data.hp,
      damage: gs.damageDealt,
      fireHeld: gs.fireHeld,
      playerFireHeld: gs.world.player.fireHeld(),
      inputFlags: { ...gs.world.player.input },
      weaponKey: gs.world.player.data.weaponKey,
      visibilityBasis: gs.world.observationView().visibilityBasis,
      aiPathStats: (window as any).__aiPathStats ?? null,
      room: gs.world.currentRoom()?.kind ?? null,
      hpBarText: gs.txtHp.text,
      txtControl: gs.txtControl.text,
      txtAiAction: gs.txtAiAction.text,
      txtAiTarget: gs.txtAiTarget.text,
      txtAgentLink: gs.txtAgentLink.text,
      txtHelp: gs.txtHelp.text
    };
  });
}

async function sceneTexts(page: Page, sceneName: string) {
  return page.evaluate((name) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene(name);
    if (!s || !g.scene.isActive(name)) return [];
    return (s.children.list as any[]).filter((c) => c.type === 'Text').map((c) => c.text as string);
  }, sceneName);
}

async function hudRects(page: Page) {
  return page.evaluate(() => {
    const g: any = (window as any).__game;
    // Production builds minify class names: always resolve scenes by key.
    const gs: any = g.scene.getScene('GameScene');
    const cam = gs.cameras.main;
    const p0 = cam.getWorldPoint(0, 0);
    const px = cam.getWorldPoint(100, 0);
    const py = cam.getWorldPoint(0, 100);
    const ax = (px.x - p0.x) / 100, bx = p0.x;
    const ay = (py.y - p0.y) / 100, by = p0.y;
    const names = ['txtWeapon', 'txtRoom', 'txtEnemies', 'txtControl', 'txtAiAction', 'txtAiTarget',
      'txtAgentLink', 'txtEcho', 'txtHp', 'txtXp', 'txtCurrency', 'txtLevel', 'timer', 'txtStats', 'txtHelp'];
    return names.map((n) => {
      const o = gs[n];
      if (!o) return null;
      const sx = (o.x - bx) / ax;
      const sy = (o.y - by) / ay;
      return {
        name: n,
        text: o.text,
        x: sx - o.originX * o.width,
        y: sy - o.originY * o.height,
        w: o.width,
        h: o.height,
        color: o.style && o.style.color ? o.style.color : null
      };
    }).filter(Boolean);
  });
}

async function bootRun(page: Page): Promise<void> {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => !!(window as any).__game, { timeout: 15000 });
  await page.waitForTimeout(1300);
  // Deterministic fixed seed via the real NEW RUN button (real click below).
  await page.evaluate((seed) => {
    const g: any = (window as any).__game;
    const menu: any = g.scene.getScene('MainMenuScene');
    const orig = menu.scene.start.bind(menu.scene);
    menu.scene.start = (key: string, data?: any) => {
      if (key === 'GameScene') return orig(key, { seed });
      return orig(key, data);
    };
  }, SEED);
  await clickLogical(page, 640, 340);
  await page.waitForTimeout(1500);
}

async function enableAiViaPause(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(550);
  const paused = await state(page);
  expect(paused?.active, 'PauseScene open').toContain('PauseScene');
  // The dev entry now lives on the AI & COMPANION page of the Pause navigator.
  await openAiHub(page);
  await clickLabel(page, 'PauseScene', 'AI CONTROL');
  await page.waitForTimeout(550);
  const on = await state(page);
  expect(on?.aiEnabled, 'AI demo enabled from Pause menu').toBe(true);
  await resumeGame(page); // pause chain -> GameScene.onResume()
  await page.waitForTimeout(900);
}

// Test-harness fixture (not a controller action, not gameplay logic):
// the control/overlay suites sample ownership and UI behaviour, not combat
// survival, so the run is rescued from death by topping HP back up through the REAL
// core command `World.enqueueHeal` (the same command the game uses for healing;
// it commits on the next tick). Combat itself stays real: enemies live, fire,
// damage the player between top-ups, and the controller keeps targeting them.
//
// Why not i-frames: `Player.invuln` is a getter-only view over the core state
// (src/entities/Player.ts:64 -> World.playerInvuln), so `player.invuln = 1e9`
// is a silent no-op. The old fixture claimed to refresh i-frames while doing
// nothing; that false claim is removed here. Position, seed, control state and
// the tick are untouched.
//
// `protect = false` keeps the run completely untouched for the echo-combat suite.
async function stabilizeEvidenceRun(page: Page, protect = true): Promise<void> {
  if (!protect) return;
  await page.evaluate(() => {
    const apply = () => {
      const g: any = (window as any).__game;
      const gs: any = g?.scene?.getScene('GameScene');
      const w = gs?.world;
      if (!w?.player) return;
      const p = w.player.data;
      // Only rescue a run that is about to die, so ordinary knockback still
      // changes HP (the movement assertions below use that as their guard).
      if (p.hp > 0 && p.hp < p.maxHp * 0.35) w.enqueueHeal(p.maxHp - p.hp);
    };
    apply();
    (window as any).__lsKeepAlive = window.setInterval(apply, 100);
  });
}

async function clearLevelUp(page: Page): Promise<number> {
  let closed = 0;
  for (let i = 0; i < 5; i++) {
    const active = await page.evaluate(() =>
      (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
    if (!active.includes('LevelUpScene')) break;
    await page.keyboard.press('1');
    closed++;
    await page.waitForTimeout(450);
  }
  return closed;
}

function walkableOnly(samples: Array<Record<string, unknown>>): void {
  for (const s of samples) {
    expect(s.walkable, `sampled position stays walkable @${JSON.stringify(s.grid)}`).toBe(true);
  }
}

test.describe('AI-NATIVE-02 P1 real World', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit', async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    mkdirSync(OUT, { recursive: true });

    await bootRun(page);
    await stabilizeEvidenceRun(page);
    record('evidence-fixture', {
      reason: 'avoid an unrelated death while sampling control transitions (live combat kept, HP topped up via a real core command); death still tested via the real hurt() path',
      hpToppedUp: 'World.enqueueHeal (real core command, commits on the next tick)',
      iframesWritten: false, hpToppedUpBelow35Pct: true, coordinatesUnchanged: true, tickUntouched: true,
      actor: 'test-harness (not the controller)'
    });
    let st = await state(page);
    expect(st, 'GameScene world exists').not.toBeNull();
    expect(st!.active, 'GameScene active').toContain('GameScene');
    // Honest default: human control, no external agent.
    expect(st!.owner).toBe('human');
    expect(st!.aiEnabled).toBe(false);
    expect(st!.mode).toBe('HUMAN');
    expect(st!.txtControl).toContain('HUMAN');
    expect(st!.txtAgentLink).toContain('EXTERNAL NOT CONNECTED');
    expect(st!.txtAgentLink).toContain('LOCAL DETERMINISTIC');
    expect(st!.externalAgentConnected).toBe(false);
    expect(st!.lastIntentOwner).toBe('human');
    record('human-default', { mode: st!.mode, txtControl: st!.txtControl, txtAgentLink: st!.txtAgentLink });
    await page.screenshot({ path: path.join(OUT, 'hud-human-1280x720.png') });

    // Pause menu exposes the dev entry and labels the demo honestly.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const pauseLabels = await sceneTexts(page, 'PauseScene');
    expect(pauseLabels.some((t) => t.includes('AI CONTROL: OFF')), 'AI toggle shown as OFF when disabled').toBe(true);
    expect(pauseLabels.some((t) => t.includes('EXTERNAL AGENT  NOT CONNECTED')), 'pause states no external agent').toBe(true);
    await page.screenshot({ path: path.join(OUT, 'pause-ai-entry-1280x720.png') });
    record('pause-entry', { labels: pauseLabels });

    await openAiHub(page);
    await clickLabel(page, 'PauseScene', 'AI CONTROL');
    await page.waitForTimeout(550);
    // Passive in-page sampler: records real core positions every 50ms so a fast
    // travel burst is not lost to Node<->browser round-trip latency.
    await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const stats: any = { samples: 0, pathLength: 0, transitions: 0, maxStep: 0, legalSamples: 0, prev: null };
      (window as any).__aiPathStats = stats;
      (window as any).__aiPathTimer = setInterval(() => {
        const w = gs.world;
        const p = { x: w.sim.player.x, y: w.sim.player.y, room: w.currentRoom()?.kind ?? null };
        if (stats.prev) {
          const d = Math.hypot(p.x - stats.prev.x, p.y - stats.prev.y);
          if (p.room !== stats.prev.room) stats.transitions++;
          else { stats.pathLength += d; stats.maxStep = Math.max(stats.maxStep, d); }
        }
        stats.prev = p;
        stats.samples++;
        if (w.isWalkable(p.x, p.y, 0.5)) stats.legalSamples++;
      }, 50);
    });
    st = await state(page);
    expect(st!.aiEnabled, 'AI enabled while paused').toBe(true);
    expect(st!.owner, 'owner flips to AI').toBe('ai');
    expect(st!.authorityPaused, 'authority frozen while paused').toBe(true);
    record('ai-enabled-paused', { owner: st!.owner, paused: st!.paused, aiEnabled: st!.aiEnabled });

    await resumeGame(page); // AI page -> pause root -> resume (ESC walks one level)
    await page.waitForTimeout(320);
    st = await state(page);
    expect(st!.paused, 'game resumed').toBe(false);
    expect(st!.owner, 'AI owns the live run').toBe('ai');
    expect(st!.mode).toBe('AI');
    expect(st!.txtControl).toContain('LOCAL DETERMINISTIC');

    // Sample the running AI with a bounded wait for *valid continuous motion*.
    // Do not relax the movement threshold: keep requiring >=3 moving intents,
    // >=1.5 tiles of real path, legal same-room steps, and a real portal
    // interact (World.tryInteract), but wait up to a bounded window for those
    // conditions instead of assuming a fixed 14-frame window always contains them.
    const samples: Array<Record<string, unknown>> = [];
    const MAX_SAMPLES = 80;
    const MIN_SAMPLES = 20;
    let pathLength = 0;
    let previous: { x: number; y: number; room: string | null } | null = null;
    let maxStep = 0;
    let movingSamples = 0;
    let interactSamples = 0;
    let portalTransitions = 0;
    let legalSamples = 0;
    let boundedWaitExhausted = true;
    const portalJumps: Array<Record<string, unknown>> = [];
    let levelUpChoices = 0;
    const seenRooms = new Set<string>();
    for (let i = 0; i < MAX_SAMPLES; i++) {
      const active = await page.evaluate(() =>
        (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
      if (active.includes('LevelUpScene')) {
        levelUpChoices++;
        await page.keyboard.press('1');
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(100);
      const s = await state(page);
      if (s!.owner !== 'ai') break;
      if (previous) {
        const step = Math.hypot(s!.grid.x - previous.x, s!.grid.y - previous.y);
        if (previous.room !== s!.room) {
          // World.tryInteract() legally lands the player in the next room. This
          // is a room transition through the shared interact rule, not a
          // collision-skipping movement step; record it separately.
          portalTransitions++;
          portalJumps.push({ from: previous, to: s!.grid, distance: step, room: s!.room });
        } else {
          pathLength += step;
          maxStep = Math.max(maxStep, step);
        }
      }
      previous = { x: s!.grid.x, y: s!.grid.y, room: s!.room };
      if (s!.intent.move.x !== 0 || s!.intent.move.y !== 0) movingSamples++;
      if (s!.intent.interact) interactSamples++;
      if (s!.walkable) legalSamples++;
      if (s!.room) seenRooms.add(s!.room);
      samples.push({
        i, grid: s!.grid, action: s!.lastAiAction, target: s!.lastAiTarget,
        room: s!.room, enemies: s!.enemies, projectiles: s!.projectiles,
        intentOwner: s!.lastIntentOwner, intent: s!.intent, walkable: s!.walkable,
        hp: s!.hp, damage: s!.damage, active: s!.active
      });
      if (i % 3 === 0) await page.screenshot({ path: path.join(OUT, `ai-run-${String(i).padStart(2, '0')}.png`) });
      const stats = s!.aiPathStats;
      const motionValid = !!stats && stats.pathLength > 1.5 && stats.maxStep > 0.1 && stats.maxStep < 3.2;
      const interactionValid = (!!stats && stats.transitions > 0) || interactSamples > 0;
      // The bounded wait also gives the controller a chance to expose more than
      // one distinct action (TRAVEL while crossing a room, STOP/AIM/FIRE when it
      // engages); without it a single long traverse made the assertion a coin
      // flip. The bar itself is unchanged: the assertion below still requires
      // more than one real action.
      const actionVariety = new Set(samples.map((x) => String(x.action)).filter((a) => a !== 'null')).size;
      if (i >= MIN_SAMPLES - 1 && motionValid && interactionValid && actionVariety > 1) {
        boundedWaitExhausted = false;
        break;
      }
    }
    const aiPathStats = await page.evaluate(() => {
      clearInterval((window as any).__aiPathTimer);
      const stats = (window as any).__aiPathStats;
      return stats ? { ...stats, prev: undefined } : null;
    });
    record('ai-samples', {
      samples, pathLength, maxStep, movingSamples, interactSamples, legalSamples,
      portalTransitions, portalJumps, rooms: [...seenRooms], levelUpChoices, aiPathStats,
      boundedWindow: { min: MIN_SAMPLES, max: MAX_SAMPLES, exhausted: boundedWaitExhausted }
    });
    st = await state(page);

    // Observable movement: thresholds unchanged, now supported by a bounded wait.
    const actions = new Set(samples.map((s) => String(s.action)).filter((a) => a !== 'null'));
    // Movement is asserted from actual sampled displacement, not intent count:
    // a fast travel burst can teleport before many samples report move != 0.
    expect(aiPathStats, 'in-page 50ms sampler exists').not.toBeNull();
    expect(aiPathStats!.pathLength, 'AI actually walked through the World (50ms sampler)').toBeGreaterThan(1.5);
    expect(aiPathStats!.maxStep, 'AI produced a real movement step (50ms sampler)').toBeGreaterThan(0.1);
    expect(aiPathStats!.maxStep, 'no collision-skipping jump between in-page samples').toBeLessThan(3.2);
    expect(aiPathStats!.legalSamples, 'every in-page sampled position stayed walkable').toBe(aiPathStats!.samples);
    expect(boundedWaitExhausted, 'bounded wait found valid continuous motion + real interaction').toBe(false);
    expect(aiPathStats!.transitions > 0 || interactSamples > 0,
      'real portal interaction (World.tryInteract) observed, not simulated').toBe(true);
    if (portalTransitions > 0) {
      // Portal transitions are legal World.tryInteract room changes, so they
      // are logged separately and excluded from collision-legality steps.
      expect(portalJumps.every((j) => Number(j.distance) > 3.2),
        'room transitions are recorded as distinct interact jumps').toBe(true);
      expect(seenRooms.size, 'portal interaction changed rooms').toBeGreaterThan(1);
    }
    walkableOnly(samples);
    expect(actions.size, `AI reported real action changes (${[...actions].join(',')} over ${samples.length} samples)`).toBeGreaterThan(1);
    expect(st!.aiActionCount, 'AI executed a countable sequence of actions').toBeGreaterThan(1);
    expect(st!.lastAiAction, 'HUD has a last AI action').toBeTruthy();
    expect(st!.txtAiAction, 'HUD shows the AI action').toContain(String(st!.lastAiAction));
    expect(st!.txtAiTarget, 'HUD shows the AI target').toContain(String(st!.lastAiTarget));
    expect(st!.lastIntentOwner, 'last executed intent came from AI').toBe('ai');
    record('ai-summary', {
      aiActionCount: st!.aiActionCount, lastAiAction: st!.lastAiAction, lastAiTarget: st!.lastAiTarget,
      movedTo: st!.grid, room: st!.room, enemies: st!.enemies, pathLength, maxStep, movingSamples,
      interactSamples, portalTransitions, samples: samples.length, aiPathStats,
      boundedWaitExhausted, seenRooms: [...seenRooms]
    });
    await page.screenshot({ path: path.join(OUT, 'ai-active-hud-1280x720.png') });

    // R-04 evidence: an actor in another room is NOT visible to the controller,
    // while legal public state (own HP, current-room actors) is preserved.
    const whitelist = await page.evaluate(() => {
      const g: any = (window as any).__game;
      // Production builds minify class names: always resolve scenes by key.
    const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      const current = w.currentRoom()?.id ?? 0;
      const other = w.map.rooms.find((r: any) => r.id !== current);
      // Guarantee at least one in-world enemy besides the hidden one, so the
      // "hidden enemy exists in the World" assertion is deterministic.
      w.spawnEnemy('drone', w.player.wx, w.player.wy, current, 1);
      const enemy = w.spawnEnemy('drone', other.gx + 2, other.gy + 2, other.id, 1);
      const obs = w.observationView();
      const view = w.intentView();
      return {
        worldEnemies: w.enemies.length,
        hiddenEnemyId: enemy._id,
        hiddenEnemyRoom: other.id,
        currentRoom: current,
        perceivedIds: obs.perceivedActors.map((a: any) => a.id),
        intentEnemyIds: view.enemies.map((a: any) => a.id),
        hasTargetRoom: JSON.stringify(obs).includes('targetRoom'),
        playerHp: obs.player.hp,
        roomKind: w.currentRoom()?.kind ?? null
      };
    });
    expect(whitelist.worldEnemies, 'hidden enemy exists in the World').toBeGreaterThan(1);
    expect(whitelist.perceivedIds, 'other-room enemy is not in the perception projection').not.toContain(whitelist.hiddenEnemyId);
    expect(whitelist.intentEnemyIds, 'controller view also excludes it').not.toContain(whitelist.hiddenEnemyId);
    expect(whitelist.hasTargetRoom, 'portal destination never leaves the projection').toBe(false);
    expect(whitelist.playerHp, 'own public HP is kept in the projection').toBeGreaterThan(0);
    record('observation-whitelist', whitelist);

    // Pause while AI is running: ownership is frozen and the menu shows ON.
    const beforePause = await state(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
    const paused = await state(page);
    expect(paused!.paused, 'game paused').toBe(true);
    expect(paused!.authorityPaused, 'authority paused').toBe(true);
    expect(paused!.mode, 'HUD mode frozen as PAUSED').toBe('PAUSED');
    const runningLabels = await sceneTexts(page, 'PauseScene');
    // UI-REWORK-01 keeps the same honest labels; the root renders the status
    // row form ("AI CONTROL: ON · LOCAL DETERMINISTIC DEMO") and the AI hub
    // button the short form ("AI CONTROL: ON · LOCAL DEMO").
    expect(runningLabels.some((t) => /AI CONTROL: ON · LOCAL/.test(t)),
      'pause menu shows AI control ON while AI is running (not OFF)').toBe(true);
    expect(runningLabels.some((t) => /AI CONTROL: ON · LOCAL DETERMINISTIC DEMO/.test(t)),
      'pause menu spells out the local deterministic demo').toBe(true);
    expect(runningLabels.some((t) => /CONTROL  AI · LOCAL (DETERMINISTIC )?DEMO/.test(t)),
      'pause menu labels local deterministic demo').toBe(true);
    expect(runningLabels.some((t) => /EXTERNAL AGENT  NOT CONNECTED/.test(t)),
      'pause menu still states that no external agent is connected').toBe(true);
    const pausedActionCount = paused!.aiActionCount;
    await page.waitForTimeout(900);
    const frozen = await state(page);
    expect(frozen!.grid.x, 'AI cannot step while paused').toBeCloseTo(paused!.grid.x, 6);
    expect(frozen!.grid.y, 'AI cannot step while paused').toBeCloseTo(paused!.grid.y, 6);
    expect(frozen!.aiActionCount, 'no AI actions while paused').toBe(pausedActionCount);
    record('pause-freeze', { paused: paused!.mode, frozen: frozen!.grid, aiActionCount: pausedActionCount });

    // Manual disable from the pause menu: back to human, no self-reclaim.
    const takeoverBeforeDisable = paused!.takeoverCount;
    await openAiHub(page);
    await clickLabel(page, 'PauseScene', 'AI CONTROL'); // AI CONTROL: ON -> OFF
    await page.waitForTimeout(550);
    const disabled = await state(page);
    expect(disabled!.aiEnabled, 'AI disabled from pause menu').toBe(false);
    expect(disabled!.owner, 'owner back to human after disable').toBe('human');
    expect(disabled!.lastTakeoverReason, 'disable reason recorded').toBe('pause-menu');
    expect(disabled!.takeoverCount, 'disable counted as takeover').toBe(takeoverBeforeDisable + 1);
    const offLabels = await sceneTexts(page, 'PauseScene');
    expect(offLabels.some((t) => t.includes('AI CONTROL: OFF')), 'pause menu shows OFF after disable').toBe(true);
    await page.screenshot({ path: path.join(OUT, 'pause-ai-off-1280x720.png') });
    await resumeGame(page); // AI hub -> pause root -> resume
    // Let the resume tick drain any intent that was already queued when the
    // human disabled the controller (the core commits queued intents on the
    // next tick; that is legal and not the AI driving again).
    await page.waitForTimeout(1500);
    const stationaryStart = await state(page);
    expect(stationaryStart!.owner, 'human owns control once the run settles').toBe('human');
    await page.waitForTimeout(2500);
    const stationary = await state(page);
    expect(stationary!.owner, 'human still owns control after disable').toBe('human');
    expect(stationary!.aiEnabled, 'AI stays disabled (no self-reclaim)').toBe(false);
    expect(stationary!.lastAiAction, 'AI action state cleared after disable').toBeNull();
    expect(stationary!.txtControl, 'HUD returns to HUMAN').toContain('HUMAN');
    if (stationaryStart!.hp === stationary!.hp) {
      // No enemy knockback involved: the disabled AI must not move the player.
      expect(stationary!.grid.x, `disabled AI does not move the player (x ${stationary!.grid.x} vs ${stationaryStart!.grid.x})`).toBeCloseTo(stationaryStart!.grid.x, 6);
      expect(stationary!.grid.y, `disabled AI does not move the player (y ${stationary!.grid.y} vs ${stationaryStart!.grid.y})`).toBeCloseTo(stationaryStart!.grid.y, 6);
    }
    record('manual-disable', { owner: stationary!.owner, takeoverCount: stationary!.takeoverCount, reason: disabled!.lastTakeoverReason });

    // Human safety takeover during live AI play.
    await enableAiViaPause(page);
    await clearLevelUp(page);
    const beforeTakeover = await state(page);
    expect(beforeTakeover!.owner).toBe('ai');
    // Fine-grained position tracking: real movement is continuous, a teleport
    // would show one huge step. This is an observed movement/collision check,
    // not a relaxed aggregate threshold.
    const track: Array<{ x: number; y: number }> = [{ ...beforeTakeover!.grid }];
    await page.keyboard.down('KeyD');
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(80);
      const s = await state(page);
      track.push({ ...s!.grid });
    }
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(250);
    const maxTrackStep = Math.max(...track.slice(1).map((p, i) =>
      Math.hypot(p.x - track[i].x, p.y - track[i].y)));
    await clearLevelUp(page);
    st = await state(page);
    expect(st!.owner, 'human regained ownership').toBe('human');
    expect(st!.aiEnabled, 'local demo disabled after takeover').toBe(false);
    expect(st!.lastTakeoverReason).toBe('human-input');
    expect(st!.lastIntentOwner).toBe('human');
    expect(st!.txtControl).toContain('HUMAN');
    expect(maxTrackStep, 'takeover movement is continuous, not a teleport').toBeLessThan(1.2);
    expect((await state(page))!.walkable, 'post-takeover position is walkable').toBe(true);
    record('human-takeover', {
      owner: st!.owner, takeoverCount: st!.takeoverCount, reason: st!.lastTakeoverReason,
      maxTrackStep, track
    });
    await page.waitForTimeout(2000);
    expect((await state(page))!.owner, 'human keeps control for 2s after takeover').toBe('human');

    // Real product behavior: human takes over while LevelUpScene is on top.
    await enableAiViaPause(page);
    await clearLevelUp(page);
    const takeoversBeforeLevelUp = (await state(page))!.takeoverCount;
    await page.evaluate(() => {
      const g: any = (window as any).__game;
      // Production builds minify class names: always resolve scenes by key.
    const gs: any = g.scene.getScene('GameScene');
      const pl = gs.world.player;
      pl.addXp(pl.data.xpToNext);
    });
    await page.waitForTimeout(1200);
    const overlay = await state(page);
    expect(overlay!.active, 'LevelUpScene open').toContain('LevelUpScene');
    expect(overlay!.owner, 'AI still owns the paused run before human input').toBe('ai');
    const overlayActionCount = overlay!.aiActionCount;
    await page.waitForTimeout(900);
    const overlayFrozen = await state(page);
    expect(overlayFrozen!.aiActionCount, 'AI cannot act inside the overlay').toBe(overlayActionCount);
    expect(overlayFrozen!.grid.x, 'player cannot move inside the overlay').toBeCloseTo(overlay!.grid.x, 6);
    expect(overlayFrozen!.grid.y, 'player cannot move inside the overlay').toBeCloseTo(overlay!.grid.y, 6);
    await page.screenshot({ path: path.join(OUT, 'levelup-ai-paused-1280x720.png') });
    // A single movement key must reclaim control WITHOUT closing the overlay.
    await page.keyboard.press('KeyW');
    await page.waitForTimeout(500);
    const duringOverlay = await state(page);
    expect(duringOverlay!.active, 'LevelUpScene still open after takeover key').toContain('LevelUpScene');
    expect(duringOverlay!.owner, 'human takeover works inside the level-up overlay').toBe('human');
    expect(duringOverlay!.aiEnabled, 'AI disabled by overlay takeover').toBe(false);
    expect(duringOverlay!.takeoverCount, 'overlay takeover counted').toBe(takeoversBeforeLevelUp + 1);
    record('levelup-takeover', {
      active: duringOverlay!.active, owner: duringOverlay!.owner,
      takeoverCount: duringOverlay!.takeoverCount, reason: duringOverlay!.lastTakeoverReason
    });
    await page.keyboard.press('1'); // real product choice, then resume
    await page.waitForTimeout(900);
    const afterLevelUp = await state(page);
    expect(afterLevelUp!.active, 'LevelUpScene closed after choosing').not.toContain('LevelUpScene');
    expect(afterLevelUp!.paused, 'run resumed after choosing').toBe(false);
    expect(afterLevelUp!.owner, 'human still owns control after level-up').toBe('human');
    expect(afterLevelUp!.aiEnabled, 'AI stays disabled after level-up takeover').toBe(false);
    expect(afterLevelUp!.txtControl, 'HUD reflects human control after level-up').toContain('HUMAN');
    record('levelup-after', { owner: afterLevelUp!.owner, aiEnabled: afterLevelUp!.aiEnabled, paused: afterLevelUp!.paused });

    // Death ends the run: AI is dropped and control returns to the human.
    await page.evaluate(() => {
      const g: any = (window as any).__game;
      // Production builds minify class names: always resolve scenes by key.
    const gs: any = g.scene.getScene('GameScene');
      // `player.invuln = 0` would be a silent no-op (getter-only view over the
      // core), so let any residual i-frames expire through REAL core ticks.
      const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
      for (let i = 0; i < 180 && gs.world.player.invuln > 0; i++) gs.world.stepFrame(1000 / 60, neutral);
      gs.world.player.hurt(999999, gs.world.player.wx + 1, gs.world.player.wy);
      // Commit the queued hit deterministically (B4: legacy hurt is applied by
      // the core on the next tick, not synchronously by the adapter).
      for (let i = 0; i < 10; i++) gs.world.stepFrame(1000 / 60, neutral);
    });
    await page.waitForTimeout(400);
    const dead = await state(page);
    expect(dead!.active, 'GameOverScene after death').toContain('GameOverScene');
    expect(dead!.active, 'GameOverScene after death').toContain('GameOverScene');
    expect(dead!.owner, 'ownership back to human after death').toBe('human');
    expect(dead!.aiEnabled, 'AI disabled after death').toBe(false);
    expect(dead!.authorityPaused, 'authority paused after death').toBe(true);
    const saveAfterDeath = await page.evaluate(() => {
      const raw = localStorage.getItem('last_signal_save_v1');
      const parsed = raw ? JSON.parse(raw) : {};
      return { hasRun: !!parsed.run, cores: parsed.permanent?.cores ?? null };
    });
    expect(saveAfterDeath.hasRun, 'death clears the run checkpoint').toBe(false);
    record('death', { active: dead!.active, owner: dead!.owner, aiEnabled: dead!.aiEnabled, save: saveAfterDeath });
    await page.screenshot({ path: path.join(OUT, 'death-ownership-1280x720.png') });

    // Restart: a brand-new run boots human-controlled, with no residual state.
    await clickLogical(page, 640, 500); // RETRY SAME SEED
    await page.waitForTimeout(1600);
    const restarted = await state(page);
    // R-03 evidence: a captured checkpoint frame is a deep copy, not live state.
    const captured = await page.evaluate(() => {
      const g: any = (window as any).__game;
      // Production builds minify class names: always resolve scenes by key.
    const gs: any = g.scene.getScene('GameScene');
      const cp = gs.world.captureCheckpoint('frame-test', gs.seed, gs.runStats());
      if (!cp) return { available: false };
      (window as any).__capturedFrame = cp;
      (window as any).__capturedJson = JSON.stringify(cp);
      // Mutate the live run the same way play would (currency / hp) through core
      // transactions, so this remains valid on a production preview.
      gs.world.enqueueCurrency(7);
      gs.world.enqueueHeal(-5);
      gs.world.resetSimulationAccumulator();
      gs.world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
      return { available: true };
    });
    expect(captured.available, 'start-room checkpoint frame captured in memory').toBe(true);
    const afterMutation = await page.evaluate(() => {
      const g: any = (window as any).__game;
      // Production builds minify class names: always resolve scenes by key.
    const gs: any = g.scene.getScene('GameScene');
      const cp = (window as any).__capturedFrame;
      return {
        unchanged: JSON.stringify(cp) === (window as any).__capturedJson,
        capturedCurrency: cp.player.currency,
        liveCurrency: gs.world.player.data.currency,
        capturedHp: cp.player.hp,
        liveHp: gs.world.player.data.hp
      };
    });
    expect(afterMutation.unchanged, 'captured frame does not mutate with the live run').toBe(true);
    expect(afterMutation.liveCurrency, 'live run changed').toBe(afterMutation.capturedCurrency + 7);
    record('checkpoint-copy', afterMutation);
    expect(restarted!.active, 'new GameScene after restart').toContain('GameScene');
    expect(restarted!.paused, 'new run resumed').toBe(false);
    expect(restarted!.owner, 'new run starts human-controlled').toBe('human');
    expect(restarted!.aiEnabled, 'no AI state carried into new run').toBe(false);
    expect(restarted!.aiActionCount).toBe(0);
    expect(restarted!.takeoverCount).toBe(0);
    record('restart', { owner: restarted!.owner, aiEnabled: restarted!.aiEnabled, aiActionCount: restarted!.aiActionCount });

    // Scene exit: QUIT TO MENU must shut the World down without errors.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await clickLabel(page, 'PauseScene', 'QUIT TO MENU');
    await page.waitForTimeout(1000);
    const menuActive = await page.evaluate(() =>
      (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
    expect(menuActive, 'MainMenuScene active after quit').toContain('MainMenuScene');
    expect(menuActive, 'GameScene stopped after quit').not.toContain('GameScene');
    record('scene-exit', { active: menuActive });
    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
    saveLog('control-flow-1280x720');
  });

  for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720], [1024, 768], [800, 600]] as Array<[number, number]>) {
    test(`HUD fully visible, non-overlapping and scaled geometry at ${w}x${h}`, async ({ page }) => {
      test.setTimeout(60000);
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await page.setViewportSize({ width: w, height: h });
      mkdirSync(OUT, { recursive: true });

      await bootRun(page);
      await stabilizeEvidenceRun(page);
      const scale = ((await canvasBox(page))!.w) / GAME_W;
      await enableAiViaPause(page);
      await page.waitForTimeout(1200);
      // A real run may open the real LevelUpScene; choose its first card.
      for (let i = 0; i < 6; i++) {
        const active = await page.evaluate(() =>
          (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
        if (!active.includes('LevelUpScene')) break;
        await page.keyboard.press('1');
        await page.waitForTimeout(450);
      }
      const st = await state(page);
      expect(st!.mode, 'AI running at this viewport').toBe('AI');
      expect(st!.owner).toBe('ai');
      expect(st!.txtControl).toContain('LOCAL DETERMINISTIC');
      expect(st!.txtAgentLink).toContain('EXTERNAL NOT CONNECTED');

      const box = await canvasBox(page);
      expect(box, 'canvas exists').not.toBeNull();
      expect(box!.x, 'canvas fully visible (left)').toBeGreaterThanOrEqual(0);
      expect(box!.y, 'canvas fully visible (top)').toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.w, 'canvas fully visible (right)').toBeLessThanOrEqual(box!.vw + 1);
      expect(box!.y + box!.h, 'canvas fully visible (bottom)').toBeLessThanOrEqual(box!.vh + 1);

      const rects = await hudRects(page);
      for (const r of rects) {
        expect(r.x, `${r.name} inside left edge`).toBeGreaterThanOrEqual(-0.5);
        expect(r.y, `${r.name} inside top edge`).toBeGreaterThanOrEqual(-0.5);
        expect(r.x + r.w, `${r.name} inside right edge`).toBeLessThanOrEqual(GAME_W + 0.5);
        expect(r.y + r.h, `${r.name} inside bottom edge`).toBeLessThanOrEqual(GAME_H + 0.5);
        expect(r.w, `${r.name} has width`).toBeGreaterThan(0);
        expect(r.h, `${r.name} has height`).toBeGreaterThan(0);
      }
      // The right-hand status column must not overlap itself.
      const column = rects.filter((r) =>
        ['txtWeapon', 'txtRoom', 'txtEnemies', 'txtControl', 'txtAiAction', 'txtAiTarget', 'txtAgentLink', 'txtEcho'].includes(r.name));
      expect(column.length, 'all right-column HUD rows present').toBe(8);
      for (let i = 0; i < column.length; i++) {
        for (let j = i + 1; j < column.length; j++) {
          const a = column[i], b = column[j];
          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          expect(overlapX <= 0.5 || overlapY <= 0.5,
            `HUD rows ${a.name}/${b.name} must not overlap`).toBe(true);
        }
      }
      // F-06: geometry, not a claim that a numeric threshold proves readability.
      // Compact viewports (<0.85 scale) use larger logical fonts so the minimum
      // rendered row is >=10 CSS px; screenshots are saved for human judgement.
      const renderedHeights = column.map((r) => ({ name: r.name, cssPx: r.h * scale }));
      const minRow = renderedHeights.reduce((a, b) => (a.cssPx < b.cssPx ? a : b));
      expect(minRow.cssPx, `smallest HUD status row geometry >=10 CSS px at ${w}x${h} (${minRow.name})`).toBeGreaterThanOrEqual(10);
      const help = rects.find((r) => r.name === 'txtHelp');
      expect(help, 'operation hint is present').toBeTruthy();
      expect(help!.h * scale, 'operation hint geometry >=10 CSS px').toBeGreaterThanOrEqual(10);
      expect(help!.color, 'operation hint uses readable contrast').toBe('#aea896');
      expect(help!.text, 'operation hint mentions move / fire / F takeover').toContain('ANY MOVE / FIRE / F TAKES HUMAN CONTROL');
      record(`hud-${w}x${h}`, {
        box, scale, canvasCssWidth: box!.w, canvasCssHeight: box!.h,
        logicalResolution: `${GAME_W}x${GAME_H}`,
        renderedHeights, minRow, help: { cssPx: help!.h * scale, color: help!.color, text: help!.text },
        geometryOnly: true, readabilityClaim: false,
        note: 'numeric threshold is a geometry check; screenshots saved for human visual review',
        rects, mode: st!.mode
      });
      await page.screenshot({ path: path.join(OUT, `hud-ai-${w}x${h}.png`) });
      expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
      saveLog(`hud-${w}x${h}`);
    });
  }

  test('F-04/F-05: inventory/pause/level-up overlay ownership, UI clicks vs fire/F takeover', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    mkdirSync(OUT, { recursive: true });
    await bootRun(page);
    await stabilizeEvidenceRun(page);
    record('evidence-fixture', {
      reason: 'overlay ownership regression clears hostile shots via the real core test seam + a second weapon fixture',
      hpToppedUp: 'World.enqueueHeal (real core command, commits on the next tick)',
      iframesWritten: false, hpToppedUpBelow35Pct: true, injectedWeapon: 'scatter', actor: 'test-harness'
    });
    // Add a second owned weapon via a core command (production-safe), so the
    // inventory EQUIP buttons are real player data. No dev fixture is used here.
    await page.evaluate(() => {
      const g = (window as any).__game;
      const gs = g.scene.getScene('GameScene');
      const w = gs.world;
      const upgraded = JSON.parse(JSON.stringify(w.sim.player.data));
      upgraded.weapons.push({ key: 'scatter', level: 1, ammo: 6, magazine: 6, reloading: false, reloadTimer: 0 });
      w.enqueueSetPlayerData(upgraded);
      w.resetSimulationAccumulator();
      w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    });

    await enableAiViaPause(page);
    let st = await state(page);
    expect(st!.owner).toBe('ai');

    // Inventory is a pause-like overlay: authority paused, input dropped.
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(500);
    st = await state(page);
    expect(st!.active, 'inventory overlay open').toContain('PauseScene');
    expect(st!.authorityPaused, 'inventory freezes control authority').toBe(true);
    expect(st!.mode).toBe('PAUSED');
    expect(st!.txtControl).toContain('PAUSED');
    expect(st!.fireHeld, 'no residual fire flag').toBe(false);
    expect(st!.playerFireHeld, 'no residual player fire flag').toBe(false);
    expect(Object.values(st!.inputFlags).every((v) => !v), 'no residual direction flags').toBe(true);
    record('inventory-open', { mode: st!.mode, authorityPaused: st!.authorityPaused, fireHeld: st!.fireHeld });

    // UI click ownership: EQUIP changes weapon, does NOT count as fire / takeover.
    await clickLogical(page, 420, 236);
    await page.evaluate(() => {
      const g = (window as any).__game;
      const gs = g.scene.getScene('GameScene');
      const w = gs.world;
      w.resetSimulationAccumulator();
      w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    });
    await page.waitForTimeout(400);
    st = await state(page);
    expect(st!.weaponKey, 'inventory equip still works').toBe('scatter');
    expect(st!.owner, 'UI equip click does not take control').toBe('ai');
    expect(st!.aiEnabled, 'AI remains enabled after UI click').toBe(true);
    expect(st!.fireHeld, 'UI click does not leave a fire flag').toBe(false);
    record('ui-equip-click', { weaponKey: st!.weaponKey, owner: st!.owner, fireHeld: st!.fireHeld });

    // CLOSE UI click resumes AI (no takeover happened).
    await clickLogical(page, 640, GAME_H - 60);
    await page.waitForTimeout(500);
    st = await state(page);
    expect(st!.paused, 'inventory closed').toBe(false);
    expect(st!.owner, 'AI resumes when no human takeover occurred').toBe('ai');
    expect(st!.aiEnabled).toBe(true);
    expect(st!.fireHeld).toBe(false);
    record('inventory-close-no-takeover', { owner: st!.owner, paused: st!.paused });

    // Movement key takeover inside inventory, then CLOSE must NOT re-grab AI.
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(400);
    const beforeKey = await state(page);
    await page.keyboard.press('KeyW');
    await page.waitForTimeout(350);
    st = await state(page);
    expect(st!.active, 'inventory still open during key takeover').toContain('PauseScene');
    expect(st!.owner, 'W takes over inside inventory').toBe('human');
    expect(st!.aiEnabled, 'AI disabled by overlay takeover').toBe(false);
    expect(st!.takeoverCount).toBe(beforeKey!.takeoverCount + 1);
    expect(st!.lastTakeoverReason).toBe('human-input');
    await clickLogical(page, 640, GAME_H - 60);
    await page.waitForTimeout(500);
    st = await state(page);
    expect(st!.owner, 'closing inventory does not auto re-grab a human-taken run').toBe('human');
    expect(st!.aiEnabled).toBe(false);
    expect(st!.txtControl).toContain('HUMAN');
    await page.waitForTimeout(1200);
    expect((await state(page))!.owner, 'human stays in control after inventory close').toBe('human');
    record('inventory-key-takeover', { owner: st!.owner, takeoverCount: st!.takeoverCount });

    // F key takeover inside inventory.
    await enableAiViaPause(page);
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(400);
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(350);
    st = await state(page);
    expect(st!.active, 'inventory still open during F takeover').toContain('PauseScene');
    expect(st!.owner, 'F takes over inside inventory').toBe('human');
    expect(st!.aiEnabled).toBe(false);
    await clickLogical(page, 640, GAME_H - 60);
    await page.waitForTimeout(400);
    expect((await state(page))!.owner).toBe('human');
    record('inventory-f-takeover', { owner: st!.owner, reason: st!.lastTakeoverReason });

    // Non-UI mouse press (fire) inside inventory takes over; no UI hit there.
    await enableAiViaPause(page);
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(400);
    await clickLogical(page, 100, 100);
    await page.waitForTimeout(350);
    st = await state(page);
    expect(st!.owner, 'non-UI mouse press takes over inside inventory').toBe('human');
    expect(st!.aiEnabled).toBe(false);
    await clickLogical(page, 640, GAME_H - 60);
    await page.waitForTimeout(400);
    expect((await state(page))!.owner).toBe('human');
    record('inventory-pointer-takeover', { owner: st!.owner });

    // Level-up card click is UI, NOT fire: AI ownership survives the click.
    await enableAiViaPause(page);
    await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const pl = gs.world.player;
      pl.addXp(pl.data.xpToNext);
    });
    await page.waitForTimeout(1000);
    const cardOwnerBefore = await state(page);
    expect(cardOwnerBefore!.active).toContain('LevelUpScene');
    expect(cardOwnerBefore!.owner).toBe('ai');
    await clickLogical(page, 380, 320);
    await page.waitForTimeout(800);
    st = await state(page);
    expect(st!.active, 'level-up closed after card click').not.toContain('LevelUpScene');
    expect(st!.owner, 'card UI click does not take control').toBe('ai');
    expect(st!.aiEnabled).toBe(true);
    expect(st!.paused).toBe(false);
    record('levelup-card-ui-click', { owner: st!.owner, paused: st!.paused });

    // Pause-menu SETTINGS button is UI, NOT fire: AI ownership survives.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
    await clickLabel(page, 'PauseScene', 'SETTINGS');
    await page.waitForTimeout(450);
    const settingsOpened = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const ps: any = g.scene.getScene('PauseScene');
      // UI-REWORK-01: settings is its own page of the Pause navigator (the old
      // in-scene panel used a Container; the page model is the equivalent).
      return ps.page === 'settings';
    });
    expect(settingsOpened, 'settings panel opened').toBe(true);
    st = await state(page);
    expect(st!.owner, 'pause menu UI click does not take control').toBe('ai');
    expect(st!.aiEnabled).toBe(true);
    await resumeGame(page); // settings -> pause root -> resume (ESC walks one level)
    await page.waitForTimeout(450);
    expect((await state(page))!.paused, 'pause overlay closed').toBe(false);
    record('pause-settings-ui-click', { owner: st!.owner, settingsOpened });

    // Level-up overlay: F and non-UI pointer also reclaim control for real.
    for (const input of ['KeyF', 'pointer'] as const) {
      // AI may still be ON after the UI-click checks; enable only when OFF.
      if (!(await state(page))!.aiEnabled) await enableAiViaPause(page);
      await page.evaluate(() => {
        const g: any = (window as any).__game;
        const gs: any = g.scene.getScene('GameScene');
        const pl = gs.world.player;
        pl.addXp(pl.data.xpToNext);
      });
      await page.waitForTimeout(900);
      const before = await state(page);
      expect(before!.active).toContain('LevelUpScene');
      expect(before!.owner).toBe('ai');
      if (input === 'KeyF') await page.keyboard.press('KeyF');
      else await clickLogical(page, 100, 100);
      await page.waitForTimeout(350);
      const during = await state(page);
      expect(during!.active, `level-up still open during ${input} takeover`).toContain('LevelUpScene');
      expect(during!.owner, `${input} takes over inside level-up`).toBe('human');
      expect(during!.aiEnabled).toBe(false);
      await page.keyboard.press('1');
      await page.waitForTimeout(650);
      const after = await state(page);
      expect(after!.owner, 'human keeps control after card choice').toBe('human');
      expect(after!.paused).toBe(false);
      record(`levelup-${input}-takeover`, { owner: during!.owner, reason: during!.lastTakeoverReason });
    }

    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
    saveLog('overlay-ownership-1280x720');
  });

  test('F-01/F-02: perception radius, occlusion, unexplored rooms, boss/portal and bounded canWalk', async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    mkdirSync(OUT, { recursive: true });
    await bootRun(page);
    // F-07: explicit fixture register for the perception-bounds E2E. The wall,
    // enemy, explored-room flag and Boss/portal coordinates below are injected;
    // they are NOT natural map generation or a real battle.
    record('evidence-fixture', {
      case: 'F-01/F-02 perception bounds',
      reason: 'synthetic perception probes; not independent no-fixture evidence',
      fixtures: [
        "bootRun: rewrite MainMenuScene.scene.start to inject fixed seed 424242",
        "spawnEnemy('drone', other.gx+2, other.gy+2, other.id, 1): hidden enemy in an unentered room",
        "w.enteredRooms.add(other.id): mark that room explored-but-far",
        "temporary mid.type='wall' on a real map tile, restored after the LOS check",
        "w.spawnBoss(...) + boss.wx/wy rewritten near/far, boss.sprite.destroy() and w.boss=null cleanup",
        "w.portal.wx/wy rewritten near/far, restored to original values",
        "intentView().canWalk(NaN|Infinity|-Infinity, ...) non-finite probes",
        "spawnEnemy('drone', candidate.x, candidate.y, room.id, 1): near unobstructed target"
      ],
      notFixtures: ['no i-frames refresh', 'no HP/坐标 direct edits', 'no addXp', 'no hurt(999999)']
    });

    const probe = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      const p = { x: w.player.wx, y: w.player.wy };
      const room = w.currentRoom();
      const other = w.map.rooms.find((r: any) => r.id !== room.id);
      const hidden = w.spawnEnemy('drone', other.gx + 2, other.gy + 2, other.id, 1);

      // Far floor / far wall anywhere on the map (real terrain, unentered room).
      let farFloor: any = null, farWall: any = null;
      for (const row of w.map.tiles) {
        for (const tile of row) {
          const d = Math.hypot(tile.x - p.x, tile.y - p.y);
          if (d < 20) continue;
          if (!farFloor && w.isWalkable(tile.x, tile.y, 0.5)) farFloor = { x: tile.x, y: tile.y };
          if (!farWall && tile.type === 'wall') farWall = { x: tile.x, y: tile.y };
        }
      }
      const view0 = w.intentView();
      const canWalkFarFloor = farFloor ? view0.canWalk(farFloor.x + 0.2, farFloor.y + 0.2) : null;
      const canWalkFarWall = farWall ? view0.canWalk(farWall.x + 0.2, farWall.y + 0.2) : null;
      const nonFiniteRejected = !view0.canWalk(NaN, 0) && !view0.canWalk(Infinity, 0) && !view0.canWalk(0, -Infinity);

      // A short-range, explored, walkable probe must still work for steering.
      let nearProbe = null;
      for (let dx = -1; dx <= 1 && nearProbe === null; dx += 0.5) {
        for (let dy = -1; dy <= 1; dy += 0.5) {
          if (Math.hypot(dx, dy) > 1.2 || (dx === 0 && dy === 0)) continue;
          if (w.isWalkable(p.x + dx, p.y + dy, 0.5)) {
            nearProbe = { x: p.x + dx, y: p.y + dy, canWalk: view0.canWalk(p.x + dx, p.y + dy) };
            break;
          }
        }
      }

      const obs0 = w.observationView();
      const hiddenVisibleUnexplored = obs0.perceivedActors.some((a: any) => a.id === hidden._id);
      w.enteredRooms.add(other.id); // mark it explored, but still far away
      const obsExplored = w.observationView();
      const hiddenVisibleExploredButFar = obsExplored.perceivedActors.some((a: any) => a.id === hidden._id);
      const canWalkFarFloorExplored = farFloor ? w.intentView().canWalk(farFloor.x + 0.2, farFloor.y + 0.2) : null;

      // Find a perceivable, floor, same-room point ~3 tiles away with a clear
      // mid-cell; then temporarily turn that mid-cell into a wall (LOS test).
      let candidate: any = null;
      for (let dx = -4; dx <= 4 && !candidate; dx++) {
        for (let dy = -4; dy <= 4; dy++) {
          const d = Math.hypot(dx, dy);
          if (d < 2 || d > 5) continue;
          const tx = p.x + dx, ty = p.y + dy;
          if (!w.isWalkable(tx, ty, 0.5)) continue;
          if (!w.isPerceivable(tx, ty)) continue;
          const mid = w.tileAt(Math.floor(p.x + dx / 2), Math.floor(p.y + dy / 2));
          if (mid.type === 'wall') continue;
          candidate = { x: tx, y: ty, mid };
          break;
        }
      }
      const nearEnemy = candidate ? w.spawnEnemy('drone', candidate.x, candidate.y, room.id, 1) : null;
      const nearVisible = nearEnemy ? w.observationView().perceivedActors.some((a: any) => a.id === nearEnemy._id) : null;
      let nearVisibleBehindWall = null;
      if (candidate) {
        const previousType = candidate.mid.type;
        candidate.mid.type = 'wall';
        nearVisibleBehindWall = w.observationView().perceivedActors.some((a: any) => a.id === nearEnemy._id);
        candidate.mid.type = previousType;
      }

      // Boss position obeys the same bounds.
      w.spawnBoss(w.map.rooms[room.id]);
      const boss: any = w.boss;
      const nearPoint = candidate ?? { x: p.x + 1, y: p.y };
      const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
      w.enqueueTargetMove(boss._id, nearPoint.x, nearPoint.y);
      w.resetSimulationAccumulator();
      w.stepFrame(1000 / 60 + 1e-6, neutral);
      const bossNear = !!w.observationView().boss;
      w.enqueueTargetMove(boss._id, other.gx + 2, other.gy + 2);
      w.stepFrame(1000 / 60 + 1e-6, neutral);
      const bossFar = !!w.observationView().boss;
      for (const e of w.enemies) { if (e.sprite.scene) e.sprite.destroy(); }
      w.enemies = [];
      if (w.boss) { if (w.boss.sprite.scene) w.boss.sprite.destroy(); w.boss = null; }

      // Portal position obeys the same bounds; destination never leaves the DTO.
      const portal = w.portal;
      const originalPortal = { x: portal.wx, y: portal.wy };
      portal.wx = nearPoint.x; portal.wy = nearPoint.y;
      const portalNear = !!w.observationView().portal;
      portal.wx = other.gx + 2; portal.wy = other.gy + 2;
      const portalFar = !!w.observationView().portal;
      portal.wx = originalPortal.x; portal.wy = originalPortal.y;
      const finalObs = w.observationView();

      return {
        player: p, roomId: room.id, otherRoomId: other.id,
        hiddenEnemyId: hidden._id,
        visibilityBasis: finalObs.visibilityBasis,
        perception: finalObs.perception,
        farFloor, farWall, canWalkFarFloor, canWalkFarWall, canWalkFarFloorExplored,
        nonFiniteRejected, nearProbe,
        hiddenVisibleUnexplored, hiddenVisibleExploredButFar,
        nearVisible, nearVisibleBehindWall,
        bossNear, bossFar, portalNear, portalFar,
        hasTargetRoom: JSON.stringify(finalObs).includes('targetRoom'),
        hasPhase: JSON.stringify(finalObs).includes('phase'),
        perceivedIds: finalObs.perceivedActors.map((a: any) => a.id)
      };
    });

    record('perception-probe', probe);
    expect(probe.visibilityBasis).toBe('grid-radius+explored+line-of-sight');
    expect(probe.perception.requiresExplored).toBe(true);
    expect(probe.perception.requiresLineOfSight).toBe(true);
    expect(probe.farFloor, 'found a real far floor cell').not.toBeNull();
    expect(probe.farWall, 'found a real far wall cell').not.toBeNull();
    expect(probe.canWalkFarFloor, 'far floor query is rejected').toBe(false);
    expect(probe.canWalkFarWall, 'far wall query is rejected').toBe(false);
    expect(probe.canWalkFarFloor, 'far floor and wall queries are indistinguishable').toBe(probe.canWalkFarWall);
    expect(probe.canWalkFarFloorExplored, 'explored-but-far query is still rejected').toBe(false);
    expect(probe.nonFiniteRejected, 'non-finite probes rejected').toBe(true);
    expect(probe.nearProbe, 'found a short-range local probe').not.toBeNull();
    expect(probe.nearProbe.canWalk, 'short-range legal probe still works').toBe(true);
    expect(probe.hiddenVisibleUnexplored, 'unexplored-room enemy is not perceived').toBe(false);
    expect(probe.hiddenVisibleExploredButFar, 'explored but out-of-range enemy is not perceived').toBe(false);
    expect(probe.nearVisible, 'near, unobstructed same-room enemy is perceived').toBe(true);
    expect(probe.nearVisibleBehindWall, 'same enemy behind a wall is not perceived').toBe(false);
    expect(probe.bossNear, 'near boss position is perceived').toBe(true);
    expect(probe.bossFar, 'far boss position is not perceived').toBe(false);
    expect(probe.portalNear, 'near portal position is perceived').toBe(true);
    expect(probe.portalFar, 'far portal position is not perceived').toBe(false);
    expect(probe.hasTargetRoom, 'portal destination never leaves the projection').toBe(false);
    expect(probe.hasPhase, 'boss phase never leaves the projection').toBe(false);
    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
    saveLog('perception-bounds-1280x720');
  });

  test('C1: rendered World applies the shared pure rules (movement, aim, pulse fire, drone FSM, hit)', async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    mkdirSync(OUT, { recursive: true });
    await bootRun(page);

    // Fixture: one real drone on a real walkable tile; no i-frames / HP edits.
    const setup = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world, pl = w.player;
      const room = w.currentRoom();
      let target: any = null;
      for (const d of [2, 1.5, -2, -1.5, 3, -3]) {
        const x = pl.wx + d, y = pl.wy;
        if (w.isWalkable(x, y, 0.5)) { target = { x, y }; break; }
      }
      if (!target) target = { x: pl.wx, y: pl.wy + 2 };
      const enemy = w.spawnEnemy('drone', target.x, target.y, room?.id ?? 0, 1);
      (window as any).__c1Enemy = enemy;
      (window as any).__c1EnemyId = enemy._id;
      return {
        enemyId: enemy._id, enemyHp: enemy._hp, target,
        player: { x: pl.wx, y: pl.wy }, speed: pl.data.speed, tick: w.sim.tick
      };
    });
    expect(setup.enemyId, 'real drone spawned').toBeGreaterThan(0);
    expect(setup.enemyHp).toBeGreaterThan(0);
    record('c1-fixture', { reason: 'one spawned drone + real keyboard/mouse; no i-frames/HP fixture; C2 core state is authoritative', setup });

    // Movement is owned by the fixed-tick core; real KeyD must move that state.
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(200);
    const moved = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      return {
        x: w.sim.player.x, y: w.sim.player.y, tick: w.sim.tick,
        walkable: w.isWalkable(w.sim.player.x, w.sim.player.y, 0.5)
      };
    });
    await page.keyboard.up('KeyD');
    expect(moved.tick, 'core advanced under real input').toBeGreaterThan(setup.tick);
    expect(Math.hypot(moved.x - setup.player.x, moved.y - setup.player.y), 'core player moved').toBeGreaterThan(0.1);
    expect(moved.walkable, 'core player stayed walkable').toBe(true);

    // Drone FSM/state is the same live core state, not an adapter mirror.
    await page.waitForTimeout(500);
    const droneStep = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      const d = w.sim.drones.find((x: any) => x.id === (window as any).__c1EnemyId);
      return d ? { id: d.id, x: d.x, y: d.y, hp: d.hp, state: d.data.state, tick: w.sim.tick } : null;
    });
    expect(droneStep, 'Enemy is backed by World.sim.drones').not.toBeNull();
    expect(droneStep.state).toBeTruthy();

    // Aim + real mouse fire: core projectile + swept hit + core drone HP.
    const aim = await gridToCss(page, setup.target.x, setup.target.y);
    await page.mouse.move(Math.round(aim.x), Math.round(aim.y));
    await page.mouse.down();
    let seenProjectile: any = null;
    for (let i = 0; i < 12 && !seenProjectile; i++) {
      await page.waitForTimeout(60);
      seenProjectile = await page.evaluate(() => {
        const g: any = (window as any).__game;
        const gs: any = g.scene.getScene('GameScene');
        const p = gs.world.sim.projectiles.find((x: any) => x.source === 'player');
        return p ? {
          damage: p.damage, crit: p.crit, vel: p.vel, lifetime: p.lifetime,
          radius: p.radius, pos: p.pos, source: p.source
        } : null;
      });
    }
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const fired = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world, pl = w.player;
      const def = pl.weapon;
      const data = pl.data;
      const ws = data.weapons.find((x: any) => x.key === data.weaponKey);
      const drone = w.sim.drones.find((x: any) => x.id === (window as any).__c1EnemyId);
      const enemy = (window as any).__c1Enemy;
      return {
        weaponKey: data.weaponKey,
        expected: {
          damage: def.baseDamage * data.damage,
          speed: def.baseProjectileSpeed / 64,
          lifetime: def.baseRange / def.baseProjectileSpeed,
          critChance: data.critChance,
          critDamage: data.critDamage,
          pierce: data.pierceCount + (def.kind === 'plasma' ? 2 : 0),
          magazine: ws.magazine,
          shots: def.kind === 'scatter' ? 5 : 1,
          spread: def.baseSpread
        },
        drone: drone ? { id: drone.id, hp: drone.hp } : null,
        enemyHp: enemy ? enemy._hp : null,
        stillInWorld: w.enemies.some((x: any) => x._id === (window as any).__c1EnemyId),
        coreProjectiles: w.sim.projectiles.length,
        aimYaw: w.sim.player.aimYaw
      };
    });
    expect(fired.weaponKey, 'pulse is the C1 first slice').toBe('pulse');
    expect(seenProjectile, 'core produced a player projectile from real mouse fire').not.toBeNull();
    expect(seenProjectile.damage).toBeCloseTo(
      (seenProjectile.crit ? fired.expected.critDamage : 1) * fired.expected.damage, 6);
    expect(Math.hypot(seenProjectile.vel.x, seenProjectile.vel.y)).toBeCloseTo(fired.expected.speed, 6);
    expect(seenProjectile.lifetime).toBeGreaterThan(0);
    expect(seenProjectile.lifetime).toBeLessThanOrEqual(fired.expected.lifetime + 1e-9);
    expect(seenProjectile.radius).toBe(0.2);
    expect(fired.enemyHp, 'core drone HP dropped or drone died').toBeLessThan(setup.enemyHp);
    expect(fired.aimYaw, 'core aim follows the real pointer').toBeTruthy();
    record('c1-rendered', {
      weaponKey: fired.weaponKey, expected: fired.expected, projectile: seenProjectile,
      enemyHp: fired.enemyHp, stillInWorld: fired.stillInWorld,
      coreProjectiles: fired.coreProjectiles, moved, droneStep
    });
    await page.screenshot({ path: path.join(OUT, 'c1-rendered-rules-1280x720.png') });
    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
    saveLog('c1-rendered-rules-1280x720');
  });
});

// ---------------------------------------------------------------------------
// P3-a: independent echo companion (real rendered World, real core actor).
// The echo is enabled/controlled ONLY through the Pause menu entry; it has its
// own actor identity, HP, cooldown, facing and 12-tile/LOS perception.
// ---------------------------------------------------------------------------
test.describe('P3-a echo companion', () => {
  test('enable via pause, follow/hold, confirm-before-fire, real damage', async ({ page }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    const probe = () => page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const w: any = gs.world;
      const e: any = w.echoActor;
      return {
        echo: e ? { x: e.x, y: e.y, hp: e.data.hp, maxHp: e.data.maxHp, actorId: e.actorId } : null,
        mode: w.echoMode,
        assist: w.echoAssistArmed,
        suggestion: w.echoSuggestion,
        player: { x: w.playerX, y: w.playerY, hp: w.playerDataSnapshot.hp },
        hud: gs.txtEcho.text,
        echoShots: w.echoShotsFired,
        echoSprite: !!(w as any).echoSprite,
        echoSeen: w.echoView()?.drones.length ?? 0,
        drones: w.sim.drones.map((d: any) => ({ id: d.id, x: d.x, y: d.y, hp: d.hp })),
        active: (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key)
      };
    });

    await bootRun(page);
    await stabilizeEvidenceRun(page, false); // live combat is the point of P3-a
    await clearLevelUp(page);

    const before = await probe();
    expect(before.echo, 'no echo in a normal solo run').toBeNull();
    expect(before.hud).toContain('ECHO OFF');

    // Enable through the real Pause menu entry.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await openEcho(page); // AI & COMPANION > ECHO COMPANION
    await page.waitForTimeout(600);
    expect(await sceneTexts(page, 'PauseScene')).toContain('ECHO COMPANION');
    await clickLabel(page, 'PauseScene', 'ENABLE ECHO');
    await page.waitForTimeout(600);
    await resumeGame(page); // echo BACK -> AI hub, ESC chain -> resume
    await page.waitForTimeout(900);
    await clearLevelUp(page);

    const enabled = await probe();
    expect(enabled.echo, 'echo enabled').not.toBeNull();
    expect(enabled.echo!.actorId, 'echo is a distinct actor, not the player').not.toBe(0);
    expect(enabled.hud, 'HUD shows the echo state').toContain('ECHO');
    expect(enabled.mode).toBe('follow');
    expect(enabled.echoSprite, 'rendered echo sprite exists').toBe(true);
    await page.screenshot({ path: path.join(OUT, 'p3a-echo-1-enabled-1280x720.png') });

    // FOLLOW: move the protagonist; the echo must move too and never overlap.
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(400);
    const followed = await probe();
    expect(followed.player.x, 'protagonist moved').not.toBe(enabled.player.x);
    expect(followed.echo!.x, 'echo followed').not.toBe(enabled.echo!.x);
    const dist = Math.hypot(followed.echo!.x - followed.player.x, followed.echo!.y - followed.player.y);
    expect(dist, 'echo keeps a standoff and never overlaps the player').toBeGreaterThan(0.5);

    // HOLD: the echo must stay put while the protagonist keeps moving.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await openEcho(page);
    await page.waitForTimeout(600);
    await clickLabel(page, 'PauseScene', 'MODE: HOLD POSITION');
    await page.waitForTimeout(500);
    await resumeGame(page); // BACK -> AI hub, ESC chain -> resume
    await page.waitForTimeout(700);
    const held = await probe();
    expect(held.mode).toBe('hold');
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyA');
    await page.waitForTimeout(400);
    const afterHold = await probe();
    expect(afterHold.player.x, 'protagonist moved during hold').not.toBe(held.player.x);
    expect(afterHold.echo!.x, 'held echo did not chase').toBeCloseTo(held.echo!.x, 1);
    expect(afterHold.echo!.y).toBeCloseTo(held.echo!.y, 1);

    // Spawn a real drone next to the echo through the normal spawn queue.
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const w: any = gs.world;
      const e = w.echoActor;
      w.enqueueSpawnEnemy('drone', e.x + 0.5, e.y, w.currentRoom()?.id ?? 0, 1);
    });
    await page.waitForTimeout(900);

    // No fire before the human confirms assist.
    const armedBefore = await probe();
    expect(armedBefore.drones.length, 'real drone spawned').toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    const notFired = await probe();
    expect(notFired.echoShots, 'echo must not fire without confirm').toBe(0);

    // Confirm assist through the pause panel, then the echo fires for real.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await openEcho(page);
    await page.waitForTimeout(600);
    await clickLabel(page, 'PauseScene', 'CONFIRM ASSIST FIRE');
    await page.waitForTimeout(500);
    await resumeGame(page); // BACK -> AI hub, ESC chain -> resume
    await page.waitForTimeout(700);
    const armed = await probe();
    expect(armed.assist, 'assist armed by the human').toBe(true);
    await page.screenshot({ path: path.join(OUT, 'p3a-echo-2-armed-1280x720.png') });

    let shots = 0;
    let droneHurt = false;
    const totalHp = (list: Array<{ hp: number }>) => list.reduce((sum, d) => sum + d.hp, 0);
    // Baseline is the pre-confirm view: the echo may kill the drone before the
    // first post-confirm probe.
    const baselineTotal = totalHp(notFired.drones);
    const baselineCount = notFired.drones.length;
    expect(baselineCount, 'a real drone existed before confirm').toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(300);
      const now = await probe();
      shots = Math.max(shots, now.echoShots);
      droneHurt = totalHp(now.drones) < baselineTotal - 1e-6 || now.drones.length < baselineCount;
      if (shots > 0 && droneHurt) break;
    }
    expect(shots, 'echo fired after confirm').toBeGreaterThan(0);
    expect(droneHurt, 'echo shots damaged/killed a real drone').toBe(true);
    await page.screenshot({ path: path.join(OUT, 'p3a-echo-3-killed-1280x720.png') });

    // Independent damage: revoke assist (so the echo stops shooting), spawn a
    // fresh real drone next to it, move the protagonist far away and let the
    // drone hit the echo.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await openEcho(page);
    await page.waitForTimeout(600);
    if ((await probe()).assist) {
      await clickLabel(page, 'PauseScene', 'ASSIST ARMED'); // revoke
      await page.waitForTimeout(500);
    }
    await resumeGame(page); // BACK -> AI hub, ESC chain -> resume
    await page.waitForTimeout(700);
    expect((await probe()).assist, 'assist revoked').toBe(false);
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const w: any = gs.world;
      const e = w.echoActor;
      w.enqueueSpawnEnemy('drone', e.x + 0.5, e.y, w.currentRoom()?.id ?? 0, 1);
      w.setPlayerPositionForTest(e.x + 12, e.y);
    });
    await page.waitForTimeout(900);
    const hpBefore = (await probe()).echo!.hp;
    const playerHpBefore = (await probe()).player.hp;
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(300);
      const now = await probe();
      if (now.echo!.hp < hpBefore) break;
    }
    const hurt = await probe();
    expect(hurt.echo!.hp, 'echo takes real damage independently').toBeLessThan(hpBefore);
    expect(hurt.player.hp, 'protagonist HP is unaffected by echo damage').toBe(playerHpBefore);
    expect(hurt.hud, 'HUD still reports the echo').toContain('ECHO');

    await page.screenshot({ path: path.join(OUT, 'p3a-echo-4-hurt-1280x720.png') });
    record('p3a-echo', { enabled, followed, held, afterHold, armed, hurt, shots });
    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
    saveLog('p3a-echo-1280x720');
  });
});
