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
// Recommended run (frozen built snapshot, no HMR):
//   npm run build
//   npx vite preview --port 5173 --strictPort
//   npx vite preview --port 5199 --strictPort
//   PORT=5173 npx playwright test tests/ai-native-world.spec.ts --workers=1

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
      'txtAgentLink', 'txtHp', 'txtXp', 'txtCurrency', 'txtLevel', 'timer', 'txtStats', 'txtHelp'];
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
        h: o.height
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
  await clickLogical(page, 640, 540); // AI CONTROL button
  await page.waitForTimeout(550);
  const on = await state(page);
  expect(on?.aiEnabled, 'AI demo enabled from Pause menu').toBe(true);
  await page.keyboard.press('Escape'); // PauseScene closes -> GameScene.onResume()
  await page.waitForTimeout(900);
}

// Test-harness fixture (not a controller action, not gameplay logic):
// combat difficulty must not kill the run while control transitions are being
// sampled. Death is still exercised through the real hurt() path later, after
// invulnerability is explicitly cleared. This is recorded in the operation log.
async function stabilizeEvidenceRun(page: Page): Promise<void> {
  await page.evaluate(() => {
    // World.tryInteract() -> Player.reset() legitimately resets i-frames on
    // room transitions, so refresh them from the test harness. No HP or
    // coordinates are changed; the HUD keeps its normal values. The death test
    // clears i-frames and calls hurt() synchronously in one evaluate below.
    const apply = () => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      if (gs?.world?.player) gs.world.player.invuln = 1e9;
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
      reason: 'avoid unrelated combat death while sampling control transitions; death still tested via real hurt() after clearing i-frames',
      onlyIFramesRefreshed: true, hpUnchanged: true, coordinatesUnchanged: true,
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

    await clickLogical(page, 640, 540);
    await page.waitForTimeout(550);
    st = await state(page);
    expect(st!.aiEnabled, 'AI enabled while paused').toBe(true);
    expect(st!.owner, 'owner flips to AI').toBe('ai');
    expect(st!.authorityPaused, 'authority frozen while paused').toBe(true);
    record('ai-enabled-paused', { owner: st!.owner, paused: st!.paused, aiEnabled: st!.aiEnabled });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    st = await state(page);
    expect(st!.paused, 'game resumed').toBe(false);
    expect(st!.owner, 'AI owns the live run').toBe('ai');
    expect(st!.mode).toBe('AI');
    expect(st!.txtControl).toContain('LOCAL DETERMINISTIC');

    // Sample the running AI: real movement, legal actions, collision stays valid.
    const samples: Array<Record<string, unknown>> = [];
    let pathLength = 0;
    let previous: { x: number; y: number; room: string | null } | null = null;
    let maxStep = 0;
    let movingSamples = 0;
    let portalTransitions = 0;
    const portalJumps: Array<Record<string, unknown>> = [];
    let levelUpChoices = 0;
    const seenRooms = new Set<string>();
    for (let i = 0; i < 14; i++) {
      const active = await page.evaluate(() =>
        (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
      if (active.includes('LevelUpScene')) {
        levelUpChoices++;
        await page.keyboard.press('1');
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(300);
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
      if (s!.room) seenRooms.add(s!.room);
      samples.push({
        i, grid: s!.grid, action: s!.lastAiAction, target: s!.lastAiTarget,
        room: s!.room, enemies: s!.enemies, projectiles: s!.projectiles,
        intentOwner: s!.lastIntentOwner, intent: s!.intent, walkable: s!.walkable,
        hp: s!.hp, damage: s!.damage, active: s!.active
      });
      if (i % 3 === 0) await page.screenshot({ path: path.join(OUT, `ai-run-${String(i).padStart(2, '0')}.png`) });
    }
    record('ai-samples', { samples, pathLength, maxStep, movingSamples, portalTransitions, portalJumps, rooms: [...seenRooms], levelUpChoices });
    st = await state(page);

    // Observable movement: multiple moving samples, real path, collision-legal.
    const actions = new Set(samples.map((s) => String(s.action)).filter((a) => a !== 'null'));
    expect(movingSamples, 'AI produced multiple intents with non-zero movement').toBeGreaterThan(2);
    expect(pathLength, 'AI actually walked through the World').toBeGreaterThan(1.5);
    expect(maxStep, 'no collision-skipping jump between same-room samples').toBeLessThan(3.2);
    if (portalTransitions > 0) {
      // Portal transitions are legal World.tryInteract room changes, so they
      // are logged separately and excluded from collision-legality steps.
      expect(portalJumps.every((j) => Number(j.distance) > 3.2),
        'room transitions are recorded as distinct interact jumps').toBe(true);
    }
    walkableOnly(samples);
    expect(actions.size, 'AI reported real action changes').toBeGreaterThan(1);
    expect(st!.aiActionCount, 'AI executed a countable sequence of actions').toBeGreaterThan(1);
    expect(st!.lastAiAction, 'HUD has a last AI action').toBeTruthy();
    expect(st!.txtAiAction, 'HUD shows the AI action').toContain(String(st!.lastAiAction));
    expect(st!.txtAiTarget, 'HUD shows the AI target').toContain(String(st!.lastAiTarget));
    expect(st!.lastIntentOwner, 'last executed intent came from AI').toBe('ai');
    record('ai-summary', {
      aiActionCount: st!.aiActionCount, lastAiAction: st!.lastAiAction, lastAiTarget: st!.lastAiTarget,
      movedTo: st!.grid, room: st!.room, enemies: st!.enemies, pathLength, maxStep, movingSamples,
      portalTransitions, seenRooms: [...seenRooms]
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
      const enemy = w.spawnEnemy('drone', other.gx + 2, other.gy + 2, other.id, 1);
      const obs = w.observationView();
      const view = w.intentView();
      return {
        worldEnemies: w.enemies.length,
        hiddenEnemyId: enemy._id,
        hiddenEnemyRoom: other.id,
        currentRoom: current,
        visibleIds: obs.visibleActors.map((a: any) => a.id),
        intentEnemyIds: view.enemies.map((a: any) => a.id),
        hasTargetRoom: JSON.stringify(obs).includes('targetRoom'),
        playerHp: obs.player.hp,
        roomKind: w.currentRoom()?.kind ?? null
      };
    });
    expect(whitelist.worldEnemies, 'hidden enemy exists in the World').toBeGreaterThan(1);
    expect(whitelist.visibleIds, 'other-room enemy is not in the whitelist').not.toContain(whitelist.hiddenEnemyId);
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
    expect(runningLabels.some((t) => t.includes('AI CONTROL: ON · LOCAL DEMO')),
      'pause menu shows AI control ON while AI is running (not OFF)').toBe(true);
    expect(runningLabels.some((t) => t.includes('CONTROL  AI · LOCAL DETERMINISTIC DEMO')),
      'pause menu labels local deterministic demo').toBe(true);
    const pausedActionCount = paused!.aiActionCount;
    await page.waitForTimeout(900);
    const frozen = await state(page);
    expect(frozen!.grid.x, 'AI cannot step while paused').toBeCloseTo(paused!.grid.x, 6);
    expect(frozen!.grid.y, 'AI cannot step while paused').toBeCloseTo(paused!.grid.y, 6);
    expect(frozen!.aiActionCount, 'no AI actions while paused').toBe(pausedActionCount);
    record('pause-freeze', { paused: paused!.mode, frozen: frozen!.grid, aiActionCount: pausedActionCount });

    // Manual disable from the pause menu: back to human, no self-reclaim.
    const takeoverBeforeDisable = paused!.takeoverCount;
    await clickLogical(page, 640, 540); // AI CONTROL: ON -> OFF
    await page.waitForTimeout(550);
    const disabled = await state(page);
    expect(disabled!.aiEnabled, 'AI disabled from pause menu').toBe(false);
    expect(disabled!.owner, 'owner back to human after disable').toBe('human');
    expect(disabled!.lastTakeoverReason, 'disable reason recorded').toBe('pause-menu');
    expect(disabled!.takeoverCount, 'disable counted as takeover').toBe(takeoverBeforeDisable + 1);
    const offLabels = await sceneTexts(page, 'PauseScene');
    expect(offLabels.some((t) => t.includes('AI CONTROL: OFF')), 'pause menu shows OFF after disable').toBe(true);
    await page.screenshot({ path: path.join(OUT, 'pause-ai-off-1280x720.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const stationaryStart = await state(page);
    await page.waitForTimeout(2500);
    const stationary = await state(page);
    expect(stationary!.owner, 'human still owns control after disable').toBe('human');
    expect(stationary!.aiEnabled, 'AI stays disabled (no self-reclaim)').toBe(false);
    expect(stationary!.lastAiAction, 'AI action state cleared after disable').toBeNull();
    expect(stationary!.txtControl, 'HUD returns to HUMAN').toContain('HUMAN');
    if (stationaryStart!.hp === stationary!.hp) {
      // No enemy knockback involved: the disabled AI must not move the player.
      expect(stationary!.grid.x, 'disabled AI does not move the player').toBeCloseTo(stationaryStart!.grid.x, 6);
      expect(stationary!.grid.y, 'disabled AI does not move the player').toBeCloseTo(stationaryStart!.grid.y, 6);
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
      gs.world.player.invuln = 0;
      gs.world.player.hurt(999999, gs.world.player.wx + 1, gs.world.player.wy);
    });
    await page.waitForTimeout(1000);
    const dead = await state(page);
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
      // Mutate the live run the same way play would (currency / hp).
      gs.world.player.data.currency += 7;
      gs.world.player.data.hp = Math.max(1, gs.world.player.data.hp - 5);
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
    await clickLogical(page, 640, 480); // QUIT TO MENU
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
    test(`HUD fully visible, non-overlapping and readable after scaling at ${w}x${h}`, async ({ page }) => {
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
        ['txtWeapon', 'txtRoom', 'txtEnemies', 'txtControl', 'txtAiAction', 'txtAiTarget', 'txtAgentLink'].includes(r.name));
      expect(column.length, 'all right-column HUD rows present').toBe(7);
      for (let i = 0; i < column.length; i++) {
        for (let j = i + 1; j < column.length; j++) {
          const a = column[i], b = column[j];
          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          expect(overlapX <= 0.5 || overlapY <= 0.5,
            `HUD rows ${a.name}/${b.name} must not overlap`).toBe(true);
        }
      }
      // Readability after real CSS scaling: smallest rendered text height in CSS px.
      const renderedHeights = column.map((r) => ({ name: r.name, cssPx: r.h * scale }));
      const minRow = renderedHeights.reduce((a, b) => (a.cssPx < b.cssPx ? a : b));
      expect(minRow.cssPx, `smallest HUD status row readable at ${w}x${h} (${minRow.name})`).toBeGreaterThanOrEqual(7.5);
      // Fire CSS size for the main HUD rows (evidence only, no absolute-unit dependency).
      record(`hud-${w}x${h}`, {
        box, scale, canvasCssWidth: box!.w, canvasCssHeight: box!.h,
        logicalResolution: `${GAME_W}x${GAME_H}`,
        renderedHeights, minRow, rects, mode: st!.mode
      });
      await page.screenshot({ path: path.join(OUT, `hud-ai-${w}x${h}.png`) });
      expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
      saveLog(`hud-${w}x${h}`);
    });
  }
});
