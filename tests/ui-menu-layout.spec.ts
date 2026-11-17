// UI-REWORK-01 — real browser coverage for the pause/settings/inventory/ECHO/LLM
// menu surfaces.
//
// Ownership: this file is the UI-REWORK-01 tester's test surface (also the
// "before" evidence capture harness). It never modifies src and never writes
// outside reports/ui-rework-01/.
//
// Phases:
//   UI_PHASE=before|after   (default before) — only prefixes evidence files.
//   UI_OUT_DIR=<dir>        (default reports/ui-rework-01/<phase>) — screenshot dir.
//
// The spec deliberately has one "capture" test that never asserts so a red
// layout on `before` still produces complete evidence, plus separate audit /
// navigation / functional tests that are the actual gate.
//
// Run:
//   npm run build            (optional; dev server also works)
//   npx vite --port 5433 --strictPort
//   PORT=5433 UI_PHASE=before npx playwright test tests/ui-menu-layout.spec.ts --workers=1

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import path from 'node:path';
import { SAVE_KEY } from '../src/config/game';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorldGateway } from '../src/ai-native/worldGateway';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../src/ai-native/ownerAuthFixture';
import { openEcho, openLlm, resumeGame, waitForButton } from './uiNav';

const PORT = Number(process.env.PORT ?? 5433);
// 'auto' keeps full-suite runs (which execute this file too) from overwriting
// the committed before/after evidence: explicit UI_PHASE is required for that.
const PHASE = process.env.UI_PHASE ?? 'auto';
const OUT = path.resolve(process.env.UI_OUT_DIR ?? path.join('reports/ui-rework-01', PHASE));
const REPO = process.cwd();
const LOGICAL_W = 1280;
const LOGICAL_H = 720;

export const VIEWPORTS: Array<[number, number]> = (() => {
  const all: Array<[number, number]> = [
    [1920, 1080],
    [1600, 900],
    [1366, 768],
    [1280, 720],
    [1024, 768],
    [800, 600]
  ];
  const filter = process.env.UI_VIEWPORTS;
  if (!filter) return all;
  const wanted = new Set(filter.split(',').map((s) => s.trim()));
  return all.filter(([w, h]) => wanted.has(`${w}x${h}`));
})();

type Box = { x: number; y: number; w: number; h: number };
type LayoutElement = {
  type: string;
  id: string | null;
  text: string | null;
  box: Box | null;
  visible: boolean;
  alpha: number;
  interactive: boolean;
  depth: number;
  background: boolean;
};
type LayoutSnapshot = {
  scene: string;
  mode: string | null;
  scenesActive: string[];
  logical: { w: number; h: number };
  elements: LayoutElement[];
};

report_safe_guard();
function report_safe_guard(): void {
  const resolved = path.resolve(OUT);
  if (!resolved.startsWith(path.join(REPO, 'reports', 'ui-rework-01'))) {
    throw new Error(`UI_OUT_DIR must stay under reports/ui-rework-01 (got ${resolved})`);
  }
}

function shotPath(name: string): string {
  return path.join(OUT, `${PHASE}-${name}.png`);
}

async function canvasBox(page: Page): Promise<Box | null> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

/** Convert logical (1280x720) game coordinates to CSS page coordinates. */
async function logicalToCss(page: Page, lx: number, ly: number): Promise<{ x: number; y: number }> {
  const box = await canvasBox(page);
  if (!box) throw new Error('no canvas');
  return { x: box.x + (lx * box.w) / LOGICAL_W, y: box.y + (ly * box.h) / LOGICAL_H };
}

/**
 * Phaser world-space bounding box of one game object.
 * Container children report local bounds, so the object's world transform
 * matrix (which already includes every ancestor) is applied for them.
 */
const WORLD_BOX_FN = `(c) => {
  const b = c.getBounds ? c.getBounds() : null;
  if (!b) return null;
  // Phaser 3.90 getBounds() already returns world-space coordinates, including
  // for Container children (verified: settings container at 640,300 with a
  // child at local 0,0 reports 590.5,291 = world top-left). Never re-apply a
  // parent matrix here or the box is double-translated.
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}`;

/** Flatten a scene's display list, expanding containers into their children. */
const FLAT_CHILDREN_FN = `(s) => {
  const out = [];
  const walk = (list) => {
    for (const c of list) {
      if (c.type === 'Container' && Array.isArray(c.list)) { walk(c.list); continue; }
      out.push(c);
    }
  };
  walk(s.children.list);
  return out;
}`;

/** Click a visible text object of a scene by its label (substring match). */
async function clickText(page: Page, sceneKey: string, label: string, exact = false): Promise<{ x: number; y: number }> {
  const logical = await page.evaluate(({ key, label, exact, flatSrc, boxSrc }) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene(key);
    if (!s || !g.scene.isActive(key)) return null;
    const flat = eval(flatSrc)(s);
    const worldBox = eval(boxSrc);
    const matches = flat.filter((c: any) => {
      if (c.type !== 'Text' || c.visible === false || !c.text) return false;
      const t = String(c.text);
      return exact ? t.trim() === label : t.includes(label);
    });
    if (!matches.length) return null;
    // Prefer a text that is (or sits exactly on) a real control: the same label
    // may also appear in a read-only status line ("MOVEMENT … ASSIST ARMED").
    const interactive = flat.filter((c: any) => c.input && c.input.enabled !== false && c.visible !== false);
    const centre = (o: any) => {
      const b = worldBox(o);
      return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
    };
    const pick = matches.find((m: any) => {
      const c = centre(m);
      if (!c) return false;
      if (m.input) return true;
      return interactive.some((o: any) => {
        const oc = centre(o);
        return oc && Math.abs(oc.x - c.x) <= 4 && Math.abs(oc.y - c.y) <= 4;
      });
    }) ?? matches[0];
    const b = worldBox(pick);
    if (!b) return null;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }, { key: sceneKey, label, exact, flatSrc: FLAT_CHILDREN_FN, boxSrc: WORLD_BOX_FN });
  expect(logical, `visible text "${label}" in ${sceneKey}`).not.toBeNull();
  const p = await logicalToCss(page, logical!.x, logical!.y);
  await page.mouse.click(p.x, p.y);
  return p;
}

/** True when a scene object is currently interactive and visible. */
async function clickObjectId(page: Page, sceneKey: string, name: string): Promise<void> {
  const logical = await page.evaluate(({ key, name, boxSrc }) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene(key);
    if (!s || !g.scene.isActive(key)) return null;
    const obj = s[name];
    if (!obj || !obj.input || obj.visible === false) return null;
    const b = eval(boxSrc)(obj);
    if (!b) return null;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }, { key: sceneKey, name, boxSrc: WORLD_BOX_FN });
  expect(logical, `interactive ${sceneKey}.${name}`).not.toBeNull();
  const p = await logicalToCss(page, logical!.x, logical!.y);
  await page.mouse.click(p.x, p.y);
}

async function bootRun(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), SAVE_KEY);
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 20000 });
  await page.waitForTimeout(400);
  for (let attempt = 0; attempt < 3; attempt++) {
    await clickText(page, 'MainMenuScene', 'NEW RUN');
    const started = await page
      .waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    if (started) {
      await page.waitForTimeout(900);
      return;
    }
  }
  throw new Error('new run did not start after 3 clicks');
}

async function openPause(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(450);
}

async function closePauseWithEsc(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  const closed = await page
    .waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'), { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (!closed) {
    const state = await page.evaluate(() => {
      const g: any = (window as any).__game;
      return {
        active: g.scene.getScenes(true).map((s: any) => s.sys.settings.key),
        mode: g.scene.getScene('PauseScene')?.sys?.settings?.data?.mode ?? null,
        worldPaused: g.scene.getScene('GameScene')?.paused ?? null
      };
    }).catch((e) => ({ evalError: String(e) }));
    console.log('ESC_DID_NOT_CLOSE', JSON.stringify(state));
    throw new Error(`ESC did not close PauseScene: ${JSON.stringify(state)}`);
  }
  await page.waitForTimeout(400);
}

/** Open the pause overlay unless it is already the top overlay. */
async function ensurePause(page: Page): Promise<void> {
  const active = await page.evaluate(() => (window as any).__game?.scene.isActive('PauseScene'));
  if (!active) await openPause(page);
}

/** Structural snapshot of a live Phaser scene (logical coordinates). */
async function layout(page: Page, sceneKey: string): Promise<LayoutSnapshot | null> {
  return page.evaluate(({ key, flatSrc, boxSrc }) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene(key);
    if (!s) return null;
    const W = g.scale.gameSize.width;
    const H = g.scale.gameSize.height;
    const flat = eval(flatSrc)(s);
    const worldBox = eval(boxSrc);
    const elements = flat.map((c: any) => {
      let box: any = null;
      try {
        const b = worldBox(c);
        if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) box = b;
      } catch { box = null; }
      const background = !!(box && box.w >= W * 0.9 && box.h >= H * 0.9);
      return {
        type: c.type,
        id: typeof c.name === 'string' && c.name ? c.name : null,
        text: c.type === 'Text' ? String(c.text) : null,
        box,
        visible: c.visible !== false,
        alpha: typeof c.alpha === 'number' ? c.alpha : 1,
        interactive: !!c.input && c.input.enabled !== false,
        depth: typeof c.depth === 'number' ? c.depth : 0,
        background
      };
    });
    return {
      scene: key,
      mode: (s.sys.settings.data && s.sys.settings.data.mode) ?? null,
      scenesActive: g.scene.getScenes(true).map((sc: any) => sc.sys.settings.key),
      logical: { w: W, h: H },
      elements
    };
  }, { key: sceneKey, flatSrc: FLAT_CHILDREN_FN, boxSrc: WORLD_BOX_FN });
}

function intersectionArea(a: Box, b: Box): number {
  const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (x <= 0 || y <= 0) return 0;
  return x * y;
}

type AuditFinding = {
  kind: 'overlap' | 'clipped' | 'hidden-but-interactive' | 'outside-parent';
  viewport: string;
  scene: string;
  a: string;
  b?: string;
  area?: number;
  aBox?: Box | null;
  bBox?: Box | null;
};

function describe(e: LayoutElement): string {
  const label = e.text ? `"${e.text.slice(0, 42)}"` : e.type;
  return `${e.type}${label}${e.interactive ? ' [clickable]' : ''}`;
}

const EPS = 2;
function sameBox(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS &&
    Math.abs(a.w - b.w) <= EPS + 1 && Math.abs(a.h - b.h) <= EPS + 1;
}
function contains(outer: Box, inner: Box, tolerance = 1): boolean {
  return outer.x <= inner.x + tolerance && outer.y <= inner.y + tolerance &&
    outer.x + outer.w >= inner.x + inner.w - tolerance &&
    outer.y + outer.h >= inner.y + inner.h - tolerance;
}

/**
 * Layout audit for one captured page.
 *
 * Compound controls: a button is a visual rectangle + a label Text + a
 * transparent hit rectangle, all sharing the same centre. Boxes that match
 * within 2px are treated as one control, and a non-interactive box that fully
 * contains another box (panel, container background, label inside its button)
 * is a legitimate parent/child pair. Two *interactive* controls nested inside
 * each other, or any partial overlap between two controls, is a defect.
 */
function auditLayout(snapshot: LayoutSnapshot): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const { w: W, h: H } = snapshot.logical;
  const els = snapshot.elements.filter((e) => e.box);
  for (const e of els) {
    const b = e.box!;
    if (!e.background && (b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1)) {
      findings.push({ kind: 'clipped', viewport: '', scene: snapshot.scene, a: describe(e), area: 0, aBox: e.box });
    }
    if (!e.visible && e.interactive) {
      findings.push({ kind: 'hidden-but-interactive', viewport: '', scene: snapshot.scene, a: describe(e) });
    }
  }
  const visible = els.filter((e) => e.visible && e.alpha > 0.05 && !e.background);
  // Opaque panels: a large non-interactive rectangle that legitimately covers
  // everything drawn under it (the settings panel over the pause buttons).
  const panels = visible.filter((e) => !e.interactive && e.type === 'Rectangle' &&
    e.box!.w >= 200 && e.box!.h >= 100);
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i];
      const b = visible[j];
      const area = intersectionArea(a.box!, b.box!);
      if (area <= 0.5) continue;
      // Same control: identical boxes (button visual rect + hit rect + label).
      if (sameBox(a.box!, b.box!)) continue;
      // Both inside the same opaque panel: the panel owns that area.
      if (panels.some((p) => contains(p.box!, a.box!) && contains(p.box!, b.box!))) continue;
      // Legitimate parent/child: a non-interactive box fully containing the
      // other (panel, overlay, label inside its own button).
      const aInB = contains(b.box!, a.box!);
      const bInA = contains(a.box!, b.box!);
      if (aInB || bInA) {
        const inner = aInB ? a : b;
        const outer = aInB ? b : a;
        if (!(inner.interactive && outer.interactive)) continue;
      }
      findings.push({ kind: 'overlap', viewport: '', scene: snapshot.scene, a: describe(a), b: describe(b), area, aBox: a.box, bBox: b.box });
    }
  }
  return findings;
}

/** Real product state used by the interaction assertions. */
async function gameState(page: Page) {
  return page.evaluate((saveKey) => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const ps: any = g.scene.getScene('PauseScene');
    const world = gs?.world;
    let save: any = null;
    try { save = JSON.parse(localStorage.getItem(saveKey) || 'null'); } catch { save = null; }
    return {
      active: g.scene.getScenes(true).map((s: any) => s.sys.settings.key),
      page: g.scene.isActive('PauseScene') ? (typeof ps?.page === 'string' ? ps.page : null) : null,
      gsPaused: gs?.paused ?? null,
      authorityPaused: world?.player?.control?.paused ?? null,
      aiEnabled: world?.player?.control?.aiEnabled ?? null,
      owner: world?.player?.control?.owner ?? null,
      tick: world?.sim?.tick ?? null,
      echo: world?.echoActor ? { hp: world.echoActor.data.hp, max: world.echoActor.data.maxHp } : null,
      echoMode: world?.echoMode ?? null,
      echoArmed: world?.echoAssistArmed ?? null,
      hudVisible: gs?.txtControl ? gs.txtControl.visible !== false : null,
      companionLink: !!gs?.companionLink,
      companionStatus: gs?.companionStatus ?? null,
      settings: save?.settings ?? null,
      optIn: save?.permanent?.signalCollaborationOptIn ?? null
    };
  }, SAVE_KEY);
}

/** Number of real interactive objects on the Pause overlay (0 when closed). */
async function interactiveCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    if (!s || !g.scene.isActive('PauseScene')) return 0;
    const walk = (list: any[]): any[] => list.flatMap((c: any) => (c.type === 'Container' && c.list ? walk(c.list) : [c]));
    return walk(s.children.list).filter((c: any) => c.input && c.input.enabled !== false).length;
  });
}

const PAGE_MARKERS: Record<string, string[]> = {
  pause: ['CONTINUE RESUMES FROM YOUR LAST SAFE CHECKPOINT'],
  settings: ['APPLIED IMMEDIATELY · SAVED LOCALLY'],
  inventory: ['WEAPON ARSENAL'],
  ai: ['MODES  HUMAN'],
  echo: ['MODE: FOLLOW'],
  llm: ['PENDING PROPOSAL']
};

/** Labels that belong to another page than the one on screen (leak detector). */
async function staleLabels(page: Page): Promise<string[]> {
  return page.evaluate((markers) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    if (!s || !g.scene.isActive('PauseScene')) return [];
    const walk = (list: any[]): any[] => list.flatMap((c: any) => (c.type === 'Container' && c.list ? walk(c.list) : [c]));
    const texts = walk(s.children.list).map((c: any) => String(c.text ?? ''));
    const cur = typeof s.page === 'string' ? s.page : null;
    const out: string[] = [];
    for (const [pg, ms] of Object.entries(markers as Record<string, string[]>)) {
      if (pg === cur) continue;
      for (const m of ms) if (texts.some((t) => t.includes(m))) out.push(`${pg}:${m}`);
    }
    return out;
  }, PAGE_MARKERS);
}

const COMPANION_SERVER = resolve(process.cwd(), 'dist-mcp/companionMcpServer.mjs');

/** Official Agent SDK (token only) against the local bridge — no fake session. */
async function openCompanionSdk(bridgeUrl: string, token: string): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [COMPANION_SERVER],
    env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: bridgeUrl, LAST_SIGNAL_WORLD_TOKEN: token } as never,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'ui-rework-tester', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}

/** All visible text of a live scene (debug aid + exact content assertions). */
async function sceneTexts(page: Page, sceneKey: string): Promise<string[]> {
  return page.evaluate((key) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene(key);
    if (!s || !g.scene.isActive(key)) return [];
    const walk = (l: any[]): any[] => l.flatMap((c: any) => (c.type === 'Container' && c.list ? walk(c.list) : [c]));
    return walk(s.children.list)
      .filter((c: any) => c.type === 'Text' && c.visible !== false)
      .map((c: any) => String(c.text ?? ''));
  }, sceneKey);
}

/** Enabled flag of the real ButtonHandle whose label matches (rename-proof). */
async function buttonState(page: Page, label: string): Promise<{ key: string; enabled: boolean; label: string } | null> {
  return page.evaluate((needle) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    if (!s || !g.scene.isActive('PauseScene')) return null;
    for (const [key, value] of Object.entries(s)) {
      const v = value as any;
      if (!v || !v.rect || !v.label || typeof v.label.text !== 'string') continue;
      if (!v.label.text.includes(needle)) continue;
      return { key, enabled: !!v.enabled, label: v.label.text };
    }
    return null;
  }, label);
}

function writeJson(name: string, data: unknown): string {
  const file = path.join(OUT, name);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

type CaptureResult = { shots: string[]; layouts: Record<string, LayoutSnapshot | null> };

/**
 * UI generation of the Pause scene under test.
 *   old — HEAD (0faf95c): ECHO/LLM links live directly on the pause root,
 *         the AI toggle is a root button, settings is an in-scene panel.
 *   new — UI-REWORK-01: a dedicated AI & COMPANION hub with ECHO / LLM pages
 *         and a one-page-at-a-time navigator (ESC walks one level back).
 */
const GEN: 'old' | 'new' = process.env.UI_GEN === 'old' ? 'old' : 'new';

async function hasText(page: Page, sceneKey: string, label: string): Promise<boolean> {
  return page.evaluate(({ sceneKey, label }) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene(sceneKey);
    if (!s || !g.scene.isActive(sceneKey)) return false;
    const walk = (list: any[]): any[] => list.flatMap((c: any) => (c.type === 'Container' && c.list ? walk(c.list) : [c]));
    const needle = label.toLowerCase();
    return walk(s.children.list).some((c: any) =>
      c.type === 'Text' && c.visible !== false && String(c.text ?? '').toLowerCase().includes(needle));
  }, { sceneKey, label });
}

/** Current PauseScene page: the new navigator exposes `page`, old infers from labels. */
async function currentPage(page: Page): Promise<string> {
  return page.evaluate((gen) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    if (!s || !g.scene.isActive('PauseScene')) return 'none';
    if (gen === 'new' && typeof s.page === 'string') return s.page;
    const texts = (s.children.list as any[]).map((c: any) => String(c.text ?? ''));
    const has = (needle: string) => texts.some((t) => t.includes(needle));
    if (has('ECHO COMPANION') && (has('DISABLE ECHO') || has('ENABLE ECHO'))) return 'echo';
    if (has('LLM COMPANION · OWNER CONFIRM')) return 'llm';
    if (has('INVENTORY') && has('WEAPON ARSENAL')) return 'inventory';
    if (has('MASTER') && has('SCREEN SHAKE')) return 'settings';
    return 'pause';
  }, GEN);
}

/** One real keyboard ESC (the app-level back gesture). */
async function esc(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
}

/** Reach the pause root from wherever we are (never closes when already open). */
async function toRoot(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const cur = await currentPage(page);
    if (cur === 'none') { await openPause(page); continue; }
    if (cur === 'pause') return;
    if (cur === 'settings' && GEN === 'old') {
      // HEAD settings is an in-scene panel with its own BACK button; ESC there
      // closes the whole overlay.
      await clickText(page, 'PauseScene', 'BACK');
      await page.waitForTimeout(400);
      continue;
    }
    await esc(page);
  }
  throw new Error('could not reach the pause root');
}

async function toAi(page: Page): Promise<void> {
  await toRoot(page);
  if (GEN === 'old') return; // no dedicated hub in the old UI
  if ((await currentPage(page)) === 'ai') return;
  await clickText(page, 'PauseScene', 'AI & COMPANION');
  await page.waitForTimeout(450);
}

async function toSubPage(page: Page, label: string, viaAi: boolean): Promise<void> {
  if (viaAi) await toAi(page);
  else await toRoot(page);
  await clickText(page, 'PauseScene', label);
  await page.waitForTimeout(450);
}

/** Real navigation pass across every menu surface, screenshots at each step. */
async function captureAllSurfaces(page: Page, key: string): Promise<CaptureResult> {
  const captured: CaptureResult = { shots: [], layouts: {} };
  const surface = async (name: string): Promise<void> => {
    await page.screenshot({ path: shotPath(`${key}-${name}`) });
    captured.shots.push(shotPath(`${key}-${name}`));
    captured.layouts[name] = await layout(page, 'PauseScene');
    if (name === 'pause') captured.layouts['game-hud'] = await layout(page, 'GameScene');
  };

  await bootRun(page);
  await page.screenshot({ path: shotPath(`${key}-run-hud`) });
  captured.shots.push(shotPath(`${key}-run-hud`));
  captured.layouts['run'] = await layout(page, 'GameScene');

  await openPause(page);
  await surface('pause');

  await toSubPage(page, 'SETTINGS', false);
  await surface('settings');
  await toRoot(page);

  await toSubPage(page, 'INVENTORY', false);
  await surface('inventory');
  await toRoot(page);

  if (GEN === 'new') {
    await toAi(page);
    await surface('ai');
    await clickText(page, 'PauseScene', 'AI CONTROL');
    await page.waitForTimeout(500);
    await surface('ai-on');
    await clickText(page, 'PauseScene', 'AI CONTROL'); // restore the honest OFF default
    await page.waitForTimeout(500);
  } else {
    await toRoot(page);
    await clickText(page, 'PauseScene', 'AI CONTROL');
    await page.waitForTimeout(500);
    await surface('pause-ai-on');
    await clickText(page, 'PauseScene', 'AI CONTROL');
    await page.waitForTimeout(500);
  }

  await toSubPage(page, 'ECHO COMPANION', GEN === 'new');
  await surface('echo');
  await toRoot(page);

  await toSubPage(page, 'LLM COMPANION', GEN === 'new');
  await surface('llm');
  await toRoot(page);
  return captured;
}

/** Collect the menu surfaces used by the layout audit for one viewport. */
async function collectSurfaces(page: Page, vp: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  await bootRun(page);
  await openPause(page);
  const surfaces: Array<[string, LayoutSnapshot | null]> = [['pause', await layout(page, 'PauseScene')]];
  await toSubPage(page, 'SETTINGS', false);
  surfaces.push(['settings', await layout(page, 'PauseScene')]);
  await toRoot(page);
  await toSubPage(page, 'INVENTORY', false);
  surfaces.push(['inventory', await layout(page, 'PauseScene')]);
  await toRoot(page);
  if (GEN === 'new') {
    await toAi(page);
    surfaces.push(['ai', await layout(page, 'PauseScene')]);
  }
  await toSubPage(page, 'ECHO COMPANION', GEN === 'new');
  surfaces.push(['echo', await layout(page, 'PauseScene')]);
  await toRoot(page);
  await toSubPage(page, 'LLM COMPANION', GEN === 'new');
  surfaces.push(['llm', await layout(page, 'PauseScene')]);
  for (const [name, snap] of surfaces) {
    if (!snap) continue;
    for (const f of auditLayout(snap)) findings.push({ ...f, viewport: vp, a: `${name}: ${f.a}` });
  }
  return findings;
}

function attachDiagnostics(page: Page, tag: string): void {
  page.on('pageerror', (e) => console.log(`PAGEERROR ${tag}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`CONSOLE_ERROR ${tag}: ${m.text()}`);
  });
  page.on('crash', () => console.log(`PAGE_CRASH ${tag}`));
}

test.describe('UI-REWORK-01 menu surfaces', () => {
  // No serial mode: one bad viewport must not skip the remaining evidence.
  test.setTimeout(300000);

  for (const [w, h] of VIEWPORTS) {
    test(`capture ${w}x${h}`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      attachDiagnostics(page, `capture-${w}x${h}`);
      await page.setViewportSize({ width: w, height: h });
      const t0 = Date.now();
      const captured = await captureAllSurfaces(page, `${w}x${h}`);
      writeJson(`capture-${PHASE}-${w}x${h}.json`, { phase: PHASE, port: PORT, viewport: [w, h], captured, ms: Date.now() - t0 });
      expect(captured.shots.length).toBeGreaterThanOrEqual(7);
    });

    test(`audit ${w}x${h}`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      attachDiagnostics(page, `audit-${w}x${h}`);
      await page.setViewportSize({ width: w, height: h });
      const findings = await collectSurfaces(page, `${w}x${h}`);
      writeJson(`audit-${PHASE}-${w}x${h}.json`, findings);
      const clipped = findings.filter((f) => f.kind === 'clipped' || f.kind === 'hidden-but-interactive');
      const overlap = findings.filter((f) => f.kind === 'overlap');
      console.log(`audit ${w}x${h}: ${clipped.length} clipped/hidden, ${overlap.length} overlaps`);
      for (const f of [...clipped, ...overlap].slice(0, 12)) {
        console.log(`  ${f.kind} ${f.scene} ${f.viewport} ${f.a}${f.b ? ` <> ${f.b}` : ''}`);
      }
      expect(clipped, 'clipped / hidden-but-interactive elements').toEqual([]);
      expect(overlap, 'overlapping visible elements').toEqual([]);
    });
  }

  // -------------------------------------------------------------------------
  // Interaction / functional coverage
  // -------------------------------------------------------------------------

  test('navigation: ESC walks exactly one level back', async ({ page }) => {
    attachDiagnostics(page, 'nav-esc');
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootRun(page);

    // Root: ESC resumes the run (no stuck pause, HUD comes back).
    await openPause(page);
    let s = await gameState(page);
    expect(s.page, 'pause root page').toBe('pause');
    expect(s.gsPaused, 'run is frozen while paused').toBe(true);
    expect(s.hudVisible, 'game HUD is hidden behind the menu').toBe(false);
    const tickBefore = s.tick;
    await page.waitForTimeout(700);
    expect((await gameState(page)).tick, 'no tick advances while paused').toBe(tickBefore);
    await esc(page);
    s = await gameState(page);
    expect(s.active, 'ESC on the root resumes the run').not.toContain('PauseScene');
    expect(s.gsPaused, 'run is live after resume').toBe(false);
    expect(s.hudVisible, 'HUD restored after resume').toBe(true);

    // AI hub is a real level: ESC returns to the root, it does not resume.
    await openPause(page);
    await clickText(page, 'PauseScene', 'AI & COMPANION');
    await page.waitForTimeout(400);
    expect((await gameState(page)).page, 'AI hub opened').toBe('ai');
    await esc(page);
    s = await gameState(page);
    expect(s.page, 'ESC from AI hub -> pause root').toBe('pause');
    expect(s.gsPaused, 'run still frozen one level up').toBe(true);

    // ECHO / LLM are one level deeper: ESC goes back to the AI hub.
    for (const [label, name] of [['ECHO COMPANION', 'echo'], ['LLM COMPANION', 'llm']] as Array<[string, string]>) {
      await clickText(page, 'PauseScene', 'AI & COMPANION');
      await page.waitForTimeout(350);
      await clickText(page, 'PauseScene', label);
      await page.waitForTimeout(400);
      expect((await gameState(page)).page, `${name} page opened`).toBe(name);
      await esc(page);
      expect((await gameState(page)).page, `ESC from ${name} -> AI hub`).toBe('ai');
      await esc(page);
      expect((await gameState(page)).page, `ESC from AI hub -> pause root`).toBe('pause');
    }

    // Settings and the pause-opened inventory are single levels.
    await clickText(page, 'PauseScene', 'SETTINGS');
    await page.waitForTimeout(400);
    expect((await gameState(page)).page, 'settings opened').toBe('settings');
    await esc(page);
    expect((await gameState(page)).page, 'ESC from settings -> pause root').toBe('pause');

    await clickText(page, 'PauseScene', 'INVENTORY');
    await page.waitForTimeout(400);
    expect((await gameState(page)).page, 'inventory opened from pause').toBe('inventory');
    await esc(page);
    expect((await gameState(page)).page, 'ESC from inventory -> pause root (not resume)').toBe('pause');

    // The direct KeyI overlay is a single-level overlay: ESC resumes the game.
    await esc(page);
    expect((await gameState(page)).active, 'run resumed before KeyI').not.toContain('PauseScene');
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(500);
    const direct = await gameState(page);
    expect(direct.active, 'KeyI opens the inventory overlay').toContain('PauseScene');
    expect(direct.page, 'KeyI opens inventory directly').toBe('inventory');
    await esc(page);
    expect((await gameState(page)).active, 'ESC resumes the direct KeyI overlay').not.toContain('PauseScene');
  });

  test('functional: settings change, persist and reset; AI local toggle', async ({ page }) => {
    attachDiagnostics(page, 'functional-settings');
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootRun(page);
    await openPause(page);
    await clickText(page, 'PauseScene', 'SETTINGS');
    await page.waitForTimeout(400);

    const start = await gameState(page);
    expect(start.settings, 'save settings exist').not.toBeNull();
    const master0 = start.settings!.masterVolume as number;

    await clickText(page, 'PauseScene', '▶');
    await page.waitForTimeout(350);
    const louder = await gameState(page);
    expect(louder.settings!.masterVolume, 'MASTER +10%) persisted to the save').toBeCloseTo(Math.min(1, Math.round((master0 + 0.1) * 10) / 10), 5);
    expect(await hasText(page, 'PauseScene', `${Math.round((louder.settings!.masterVolume as number) * 100)}%`), 'new value is shown').toBe(true);

    await clickText(page, 'PauseScene', 'RESET AUDIO');
    await page.waitForTimeout(400);
    const reset = await gameState(page);
    expect(reset.settings!.masterVolume, 'RESET AUDIO restores the default master volume').toBeCloseTo(0.7, 5);
    expect(reset.settings!.sfxVolume, 'RESET AUDIO restores the default sfx volume').toBeCloseTo(0.8, 5);

    const shakeBefore = reset.settings!.screenShake;
    await clickText(page, 'PauseScene', 'SCREEN SHAKE');
    await page.waitForTimeout(350);
    const shook = await gameState(page);
    expect(shook.settings!.screenShake, 'screen shake toggled').toBe(!shakeBefore);
    expect(await hasText(page, 'PauseScene', `SCREEN SHAKE: ${!shakeBefore ? 'ON' : 'OFF'}`), 'toggle label follows the real value').toBe(true);

    const optInBefore = reset.optIn;
    await clickText(page, 'PauseScene', 'SIGNAL COLLABORATION');
    await page.waitForTimeout(350);
    const opt = await gameState(page);
    expect(opt.optIn, 'signal collaboration opt-in persisted').toBe(!optInBefore);
    expect(await hasText(page, 'PauseScene', `SIGNAL COLLABORATION · ${!optInBefore ? 'ON' : 'OFF'}`), 'opt-in label follows the real value').toBe(true);

    // Back to the root, then AI local control from its own hub page.
    await esc(page);
    await clickText(page, 'PauseScene', 'AI & COMPANION');
    await page.waitForTimeout(400);
    await clickText(page, 'PauseScene', 'AI CONTROL');
    await page.waitForTimeout(500);
    let s = await gameState(page);
    expect(s.aiEnabled, 'local AI enabled from the hub').toBe(true);
    expect(await hasText(page, 'PauseScene', 'AI CONTROL: ON'), 'hub labels the AI as ON').toBe(true);
    await esc(page);
    await esc(page);
    await page.waitForTimeout(800);
    s = await gameState(page);
    expect(s.owner, 'AI owns the live run after resume').toBe('ai');

    await openPause(page);
    await clickText(page, 'PauseScene', 'AI & COMPANION');
    await page.waitForTimeout(350);
    await clickText(page, 'PauseScene', 'AI CONTROL');
    await page.waitForTimeout(500);
    expect((await gameState(page)).aiEnabled, 'local AI disabled again').toBe(false);
    await esc(page);
    await esc(page);
    await page.waitForTimeout(600);
    s = await gameState(page);
    expect(s.owner, 'human owns the run after disabling').toBe('human');
  });

  test('functional: ECHO enable, mode and assist arming', async ({ page }) => {
    attachDiagnostics(page, 'functional-echo');
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootRun(page);
    const reopenEcho = async (): Promise<void> => {
      await openPause(page);
      await clickText(page, 'PauseScene', 'AI & COMPANION');
      await page.waitForTimeout(350);
      await clickText(page, 'PauseScene', 'ECHO COMPANION');
      await page.waitForTimeout(400);
    };
    const resumeOneTick = async (): Promise<void> => {
      await esc(page); // echo -> ai
      await esc(page); // ai -> pause
      await esc(page); // pause -> resume
      await page.waitForTimeout(800);
    };
    await openPause(page);
    await clickText(page, 'PauseScene', 'AI & COMPANION');
    await page.waitForTimeout(350);
    await clickText(page, 'PauseScene', 'ECHO COMPANION');
    await page.waitForTimeout(400);
    expect((await gameState(page)).page, 'echo page opened').toBe('echo');

    // ENABLE is a core command: nothing may pretend the echo exists before the
    // next core tick (the paused world does not tick).
    await clickText(page, 'PauseScene', 'ENABLE ECHO');
    await page.waitForTimeout(450);
    expect((await gameState(page)).echo, 'no fake echo actor while the world is frozen').toBeNull();
    await resumeOneTick();
    let s = await gameState(page);
    expect(s.echo, 'echo actor exists after one real core tick').not.toBeNull();
    expect(s.echo!.hp, 'echo has real HP').toBeGreaterThan(0);

    await reopenEcho();
    expect(await hasText(page, 'PauseScene', 'STATUS  HP'), 'echo status shows real HP').toBe(true);

    await clickText(page, 'PauseScene', 'MODE: HOLD POSITION');
    await page.waitForTimeout(350);
    expect((await gameState(page)).echoMode, 'echo mode = hold').toBe('hold');
    await clickText(page, 'PauseScene', 'MODE: MOVE TO AIM');
    await page.waitForTimeout(350);
    expect((await gameState(page)).echoMode, 'echo mode = move-to').toBe('move-to');
    await clickText(page, 'PauseScene', 'MODE: FOLLOW');
    await page.waitForTimeout(350);
    expect((await gameState(page)).echoMode, 'echo mode = follow').toBe('follow');

    await clickText(page, 'PauseScene', 'CONFIRM ASSIST FIRE');
    await page.waitForTimeout(400);
    expect((await gameState(page)).echoArmed, 'owner confirm arms the assist').toBe(true);
    expect(await hasText(page, 'PauseScene', 'ASSIST ARMED'), 'armed state is shown').toBe(true);
    await clickText(page, 'PauseScene', 'ASSIST ARMED');
    await page.waitForTimeout(400);
    expect((await gameState(page)).echoArmed, 'assist revoked').toBe(false);

    await clickText(page, 'PauseScene', 'DISABLE ECHO');
    await page.waitForTimeout(450);
    await resumeOneTick();
    expect((await gameState(page)).echo, 'echo actor removed after the next real tick').toBeNull();
    await reopenEcho();
    expect(await hasText(page, 'PauseScene', 'STATUS  DISABLED'), 'disabled state is shown honestly').toBe(true);
  });

  test('functional: LLM page is honest without a model; failure feedback; no secret leak', async ({ page }) => {
    attachDiagnostics(page, 'functional-llm');
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootRun(page);
    await openPause(page);
    await clickText(page, 'PauseScene', 'AI & COMPANION');
    await page.waitForTimeout(350);
    await clickText(page, 'PauseScene', 'LLM COMPANION');
    await page.waitForTimeout(400);
    const llm = await gameState(page);
    expect(llm.page, 'llm page opened').toBe('llm');
    expect(llm.companionLink, 'no live companion link without a real bridge').toBe(false);
    expect(await hasText(page, 'PauseScene', 'NOT CONNECTED'), 'page states NOT CONNECTED').toBe(true);
    expect(await hasText(page, 'PauseScene', 'NO MODEL'), 'page states NO MODEL instead of a fake session').toBe(true);
    expect(await hasText(page, 'PauseScene', 'no pending'), 'page states that nothing is pending').toBe(true);

    // CONFIRM / REJECT without a proposal must do nothing (and must not crash).
    await clickText(page, 'PauseScene', 'CONFIRM FIRST PROPOSAL');
    await page.waitForTimeout(300);
    await clickText(page, 'PauseScene', 'REJECT FIRST PROPOSAL');
    await page.waitForTimeout(300);
    expect((await gameState(page)).page, 'still on the LLM page after no-pending clicks').toBe('llm');
    expect((await gameState(page)).companionLink, 'no link created by a no-pending click').toBe(false);

    await clickText(page, 'PauseScene', 'DISCONNECT');
    await page.waitForTimeout(300);
    expect((await gameState(page)).page, 'disconnect without a link keeps the page usable').toBe('llm');

    // Real masked Owner form: a bogus local bridge must surface a real failure.
    const token = 'e2e-token-0123456789abcdef';
    const ownerKey = 'a'.repeat(64);
    await clickText(page, 'PauseScene', 'ENABLE / RE-AUTHORIZE');
    await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 8000 });
    await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]', 'http://127.0.0.1:9');
    await page.fill('[data-testid="external-link-form"] input[name="token"]', token);
    await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]', ownerKey);
    await page.screenshot({ path: shotPath('llm-owner-form-filled') });
    await page.click('[data-testid="external-link-form"] button[type="submit"]');
    const status = page.locator('[data-testid="external-link-status"]');
    await status.waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="external-link-status"]');
      return !!el && /FAILED|rejected|unreachable/i.test(el.textContent ?? '');
    }, { timeout: 20000 });
    expect((await gameState(page)).page, 'still on the LLM page after the failed form submit').toBe('llm');
    const feedback = (await status.textContent()) ?? '';
    expect(feedback, 'real failure feedback is shown').toMatch(/FAILED|rejected|unreachable/i);
    await page.screenshot({ path: shotPath('llm-owner-failure') });

    // Secrets must be cleared from the DOM and never rendered in scene text.
    const secrets = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('[data-testid="external-link-form"] input')) as HTMLInputElement[];
      const g: any = (window as any).__game;
      const s: any = g.scene.getScene('PauseScene');
      const walk = (l: any[]): any[] => l.flatMap((c: any) => (c.type === 'Container' && c.list ? walk(c.list) : [c]));
      return { values: inputs.map((i) => i.value), texts: walk(s.children.list).map((c: any) => String(c.text ?? '')).join('\n') };
    });
    expect(secrets.values.filter((v) => v === token || v === ownerKey), 'token/owner key cleared from the inputs').toEqual([]);
    expect(secrets.texts.includes(token) || secrets.texts.includes(ownerKey), 'no secret in scene text').toBe(false);
    const st = await gameState(page);
    expect(st.companionStatus ?? 'OFF', 'no fake CONNECTED state after a failed authorization').not.toBe('CONNECTED');
    expect(st.companionLink, 'no companion link after a failed owner pairing').toBe(false);

    // ESC while the masked form has keyboard focus must close only the form.
    await page.focus('[data-testid="external-link-form"] input[name="token"]');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const afterEsc = await page.evaluate(() => !!document.querySelector('[data-testid="external-link-form"]'));
    const escState = await gameState(page);
    expect(afterEsc, 'ESC closes only the DOM form (typing is not interrupted)').toBe(false);
    expect(escState.page, 'ESC inside the form never navigates the menu').toBe('llm');
    expect(escState.active, 'ESC inside the form never closes the pause overlay').toContain('PauseScene');
    // The explicit CANCEL button also closes only the form.
    await clickText(page, 'PauseScene', 'ENABLE / RE-AUTHORIZE');
    await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 8000 });
    await page.click('[data-testid="external-link-form"] button[type="button"]');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => !!document.querySelector('[data-testid="external-link-form"]')), 'CANCEL closes the form').toBe(false);
    expect((await gameState(page)).page, 'CANCEL keeps the LLM page').toBe('llm');
  });

  test('functional: real pending proposal — Owner CONFIRM commits, REJECT does not', async ({ page }) => {
    test.setTimeout(240000);
    attachDiagnostics(page, 'functional-llm-pending');
    await page.setViewportSize({ width: 1280, height: 720 });
    const TOKEN = randomBytes(24).toString('hex');
    const ORIGIN = `http://localhost:${PORT}`;
    const gateway = new WorldGateway();
    const bridge = await startWorldBridge({
      gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH,
      allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
    });
    let sdk: { client: Client; transport: StdioClientTransport } | null = null;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await bootRun(page);
      // Real echo actor + a real drone in the current room (no fake suggestion).
      await page.evaluate(() => {
        const gs: any = (window as any).__game.scene.getScene('GameScene');
        gs.world.enableEcho();
      });
      await page.waitForFunction(() => !!(window as any).__game.scene.getScene('GameScene').world.echoActor, undefined, { timeout: 15000 });
      await page.evaluate(() => {
        const w: any = (window as any).__game.scene.getScene('GameScene').world;
        const e = w.echoActor;
        const room = w.currentRoom();
        w.spawnEnemy('drone', e.x + 1, e.y, room?.id ?? 0, 1);
      });
      await page.waitForTimeout(300);

      await openPause(page);
      await clickText(page, 'PauseScene', 'AI & COMPANION');
      await page.waitForTimeout(350);
      await clickText(page, 'PauseScene', 'LLM COMPANION');
      await page.waitForTimeout(450);
      const idleConfirm = await buttonState(page, 'CONFIRM FIRST PROPOSAL');
      expect(idleConfirm, 'CONFIRM control exists').not.toBeNull();
      expect(idleConfirm!.enabled, 'CONFIRM is disabled while nothing is pending').toBe(false);

      // Real masked Owner form against the local bridge.
      await clickText(page, 'PauseScene', 'ENABLE / RE-AUTHORIZE');
      await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 10000 });
      await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]', bridge.url);
      await page.fill('[data-testid="external-link-form"] input[name="token"]', TOKEN);
      await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]', TEST_OWNER_KEY);
      await page.click('[data-testid="external-link-form"] button[type="submit"]');
      await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').companionStatus === 'CONNECTED', undefined, { timeout: 25000 });
      await page.screenshot({ path: shotPath('llm-connected') });

      // Official Agent SDK, token only: propose a real fire suggestion.
      sdk = await openCompanionSdk(bridge.url, TOKEN);
      await sdk.client.callTool({ name: 'echo_observe', arguments: {} });
      const suggestionId = 'sug_' + 'b'.repeat(24);
      const proposal = (await sdk.client.callTool({
        name: 'echo_suggest',
        arguments: { requestId: 'req_' + 'b'.repeat(24), suggestionId, kind: 'fire', reason: 'perceived_hostile', ttlTicks: 600 }
      })).structuredContent as any;
      expect(proposal.ok, `echo_suggest: ${JSON.stringify(proposal)}`).toBe(true);

      await expect.poll(async () => (await buttonState(page, 'CONFIRM FIRST PROPOSAL'))?.enabled, { timeout: 15000 })
        .toBe(true);
      expect((await buttonState(page, 'REJECT FIRST PROPOSAL'))?.enabled, 'REJECT enabled with a pending proposal').toBe(true);
      expect(await hasText(page, 'PauseScene', 'perceived_hostile'), 'the real proposal is rendered').toBe(true);
      await page.screenshot({ path: shotPath('llm-pending-proposal') });

      // Owner CONFIRM queues one intent; the next REAL core tick commits it.
      await clickText(page, 'PauseScene', 'CONFIRM FIRST PROPOSAL');
      await page.waitForFunction(() => {
        const gs: any = (window as any).__game.scene.getScene('GameScene');
        return gs.world.hasPendingCompanionIntent === true;
      }, undefined, { timeout: 15000 });
      const queued = await gameState(page);
      expect(queued.gsPaused, 'the world is still frozen when the Owner confirms').toBe(true);
      await toRoot(page);
      await esc(page); // resume
      await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'), { timeout: 10000 });
      const tickBefore = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.tick);
      await page.waitForFunction((tb: number) => {
        const gs: any = (window as any).__game.scene.getScene('GameScene');
        return gs.world.sim.tick > tb + 3;
      }, tickBefore, { timeout: 15000 });
      const committed = await page.evaluate(() => {
        const gs: any = (window as any).__game.scene.getScene('GameScene');
        return { pending: gs.world.hasPendingCompanionIntent, tick: gs.world.sim.tick };
      });
      expect(committed.pending, 'the confirmed intent was committed by a real tick').toBe(false);
      expect(committed.tick, 'core tick advanced').toBeGreaterThan(tickBefore);

      // A second proposal must be rejected without ever being committed.
      await openPause(page);
      await clickText(page, 'PauseScene', 'AI & COMPANION');
      await page.waitForTimeout(350);
      await clickText(page, 'PauseScene', 'LLM COMPANION');
      await page.waitForTimeout(450);
      const second = 'sug_' + 'c'.repeat(24);
      await sdk.client.callTool({
        name: 'echo_suggest',
        arguments: { requestId: 'req_' + 'c'.repeat(24), suggestionId: second, kind: 'fire', reason: 'perceived_hostile', ttlTicks: 600 }
      });
      await expect.poll(async () => (await buttonState(page, 'REJECT FIRST PROPOSAL'))?.enabled, { timeout: 15000 })
        .toBe(true);
      await clickText(page, 'PauseScene', 'REJECT FIRST PROPOSAL');
      await page.waitForTimeout(1200);
      const afterReject = await page.evaluate(() => {
        const gs: any = (window as any).__game.scene.getScene('GameScene');
        return { pending: gs.world.hasPendingCompanionIntent, enabled: null as unknown };
      });
      expect(afterReject.pending, 'a rejected proposal never becomes a queued intent').toBe(false);
      await page.screenshot({ path: shotPath('llm-after-reject') });

      // DISCONNECT must end the real link and keep the page honest.
      await clickText(page, 'PauseScene', 'DISCONNECT');
      await expect.poll(async () => (await gameState(page)).companionStatus, { timeout: 15000 }).not.toBe('CONNECTED');
      const afterDisconnectTexts = await sceneTexts(page, 'PauseScene');
      const joined = afterDisconnectTexts.join(' | ');
      expect(joined, 'page no longer claims a live model').not.toContain('STATE  CONNECTED');
      expect(joined, 'page reports an offline / not-connected state honestly').toMatch(/OFFLINE|NOT CONNECTED/);
      expect((await buttonState(page, 'CONFIRM FIRST PROPOSAL'))?.enabled, 'CONFIRM disabled after disconnect').toBe(false);
      expect((await buttonState(page, 'REJECT FIRST PROPOSAL'))?.enabled, 'REJECT disabled after disconnect').toBe(false);
      expect(errors.filter((e) => !/favicon/i.test(e)), `no page errors: ${errors.join(' | ')}`).toEqual([]);
    } finally {
      await sdk?.client.close().catch(() => undefined);
      await bridge.close();
    }
  });

  test('boundary: repeated open/close never stacks or leaves hidden controls', async ({ page }) => {
    attachDiagnostics(page, 'boundary-repeat');
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootRun(page);
    const counts: Record<string, number[]> = {};
    for (let i = 0; i < 4; i++) {
      await openPause(page);
      for (const [label, name] of [['SETTINGS', 'settings'], ['INVENTORY', 'inventory']] as Array<[string, string]>) {
        await toRoot(page);
        await clickText(page, 'PauseScene', label);
        await page.waitForTimeout(350);
        const c = await interactiveCount(page);
        (counts[name] ??= []).push(c);
        expect(c, `${name} has at least one control`).toBeGreaterThan(0);
        await toRoot(page);
      }
      (counts.pause ??= []).push(await interactiveCount(page));
      await esc(page);
      expect((await gameState(page)).active, 'overlay closed').not.toContain('PauseScene');
      expect(await interactiveCount(page), 'closed overlay leaves no interactive object behind').toBe(0);
      expect(await staleLabels(page), 'closed overlay leaves no page labels behind').toEqual([]);
    }
    for (const [name, list] of Object.entries(counts)) {
      expect(new Set(list).size, `${name} control count is stable across re-opens (${list.join(',')})`).toBe(1);
    }
    // Visiting every page in sequence must also be stable.
    await openPause(page);
    for (let i = 0; i < 3; i++) {
      await toAi(page);
      const aiCount = await interactiveCount(page);
      await clickText(page, 'PauseScene', 'ECHO COMPANION');
      await page.waitForTimeout(350);
      const echoCount = await interactiveCount(page);
      await toRoot(page);
      await toAi(page);
      await clickText(page, 'PauseScene', 'LLM COMPANION');
      await page.waitForTimeout(350);
      const llmCount = await interactiveCount(page);
      await toRoot(page);
      expect([aiCount, echoCount, llmCount].every((n) => n > 0), 'every page keeps its own controls').toBe(true);
    }
    expect(await staleLabels(page), 'no stale page labels on the root').toEqual([]);
  });

  test('boundary: keyboard focus, wheel and real click agree', async ({ page }) => {
    attachDiagnostics(page, 'boundary-focus');
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootRun(page);
    await openPause(page);
    const pauseLayout = await layout(page, 'PauseScene');
    // Wheel over the canvas must not scroll menu controls out of the viewport.
    const box = await canvasBox(page);
    await page.mouse.move(box!.x + box!.w / 2, box!.y + box!.h / 2);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(300);
    const afterWheel = await layout(page, 'PauseScene');
    const moved = afterWheel!.elements.filter((e, i) => {
      const before = pauseLayout!.elements[i];
      return before?.box && e.box && (Math.abs(before.box.y - e.box.y) > 2 || Math.abs(before.box.x - e.box.x) > 2);
    });
    expect(moved.map((m) => m.text ?? m.type), 'wheel does not drag menu controls').toEqual([]);
    expect(auditLayout(afterWheel!).filter((f) => f.kind === 'clipped'), 'nothing leaves the viewport after wheel').toEqual([]);

    // Keyboard focus: DOWN then ENTER activates the focused control (INVENTORY).
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    expect((await gameState(page)).page, 'ENTER activates the focused button').toBe('inventory');
    await toRoot(page);
    // UP from RESUME wraps to QUIT TO MENU; do not activate it, just prove focus moves.
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);
    const focused = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const s: any = g.scene.getScene('PauseScene');
      const btns = Object.entries(s).filter(([, v]: any) => v && v.rect && v.label).map(([k, v]: any) => ({ k, focused: !!v.focused, label: v.label.text }));
      return btns.filter((b) => b.focused);
    });
    expect(focused.length, 'exactly one focused control').toBe(1);
    expect(focused[0].label, 'UP wraps focus to the last control').toBe('QUIT TO MENU');
    // Real pointer click on the reported centre of SETTINGS still works.
    await clickText(page, 'PauseScene', 'SETTINGS');
    await page.waitForTimeout(400);
    expect((await gameState(page)).page, 'real click activates SETTINGS').toBe('settings');
  });

  test('audit: shared font stack, disabled controls, resize and destroy stability', async ({ page }) => {
    attachDiagnostics(page, 'audit-fonts-resize');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await bootRun(page);
    await openPause(page);

    const gotoPage = async (name: string): Promise<void> => {
      if (name === 'pause') await toRoot(page);
      else if (name === 'ai') await toAi(page);
      else if (name === 'echo') await openEcho(page);
      else if (name === 'llm') await openLlm(page);
      else if (name === 'inventory') { await toRoot(page); await clickText(page, 'PauseScene', 'INVENTORY'); await page.waitForTimeout(350); }
      else if (name === 'settings') { await toRoot(page); await clickText(page, 'PauseScene', 'SETTINGS'); await page.waitForTimeout(350); }
    };

    for (const name of ['pause', 'ai', 'echo', 'llm', 'inventory', 'settings']) {
      await gotoPage(name);
      expect(await currentPage(page), `${name} page reached`).toBe(name);

      // Every canvas text must use the one shared monospace stack (a missing or
      // empty fontFamily is a real visual defect, not a style preference).
      const fonts = await page.evaluate(() => {
        const g = (window as any).__game;
        const s = g.scene.getScene('PauseScene');
        const walk = (l: any[]): any[] => l.flatMap((c: any) => (c.type === 'Container' && c.list ? walk(c.list) : [c]));
        return walk(s.children.list)
          .filter((c: any) => c.type === 'Text')
          .map((c: any) => ({ text: String(c.text).slice(0, 24), family: String(c.style?.fontFamily ?? '') }));
      });
      expect(fonts.length, `${name} renders text`).toBeGreaterThan(0);
      const badFonts = fonts.filter((f) => !/mono|Consolas|Menlo/i.test(f.family));
      expect(badFonts, `${name} uses the shared mono font stack`).toEqual([]);

      // Resize sweep: the FIT canvas rescales, the page must stay identical.
      const count = await interactiveCount(page);
      for (const [w, h] of [[800, 600], [1600, 900], [1366, 768], [1280, 720]] as Array<[number, number]>) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(320);
        expect(await currentPage(page), `${name} stays open after resize to ${w}x${h}`).toBe(name);
        expect(await interactiveCount(page), `${name} does not duplicate controls at ${w}x${h}`).toBe(count);
        const findings = auditLayout((await layout(page, 'PauseScene'))!);
        expect(findings, `${name} layout stays clean at ${w}x${h}`).toEqual([]);
      }
      // Leave and re-enter: no leaked objects, same control count.
      await toRoot(page);
      await gotoPage(name);
      expect(await interactiveCount(page), `${name} control count stable after re-entry`).toBe(count);
    }

    // DOM form font (the only real DOM UI) must match the same stack.
    await toRoot(page);
    await clickText(page, 'PauseScene', 'SETTINGS');
    await page.waitForTimeout(350);
    await clickText(page, 'PauseScene', 'EXTERNAL LINK SETUP');
    await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 8000 });
    const domFont = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="external-link-form"] form') as HTMLElement;
      const cs = getComputedStyle(panel);
      return { family: cs.fontFamily, size: parseFloat(cs.fontSize) };
    });
    expect(domFont.family, 'DOM form uses the shared mono font stack').toMatch(/mono|Consolas|Menlo/i);
    expect(domFont.size, 'DOM form font size is readable').toBeGreaterThanOrEqual(12);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Disabled controls: not activatable by mouse, skipped by keyboard focus.
    await openLlm(page);
    const confirmBtn = await buttonState(page, 'CONFIRM FIRST PROPOSAL');
    const rejectBtn = await buttonState(page, 'REJECT FIRST PROPOSAL');
    expect(confirmBtn?.enabled, 'CONFIRM disabled without a proposal').toBe(false);
    expect(rejectBtn?.enabled, 'REJECT disabled without a proposal').toBe(false);
    const focusedLabels: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(120);
      const label = await page.evaluate(() => {
        const g = (window as any).__game;
        const s = g.scene.getScene('PauseScene');
        for (const value of Object.values(s) as any[]) {
          if (value?.rect && value?.label && value.focused) return String(value.label.text);
        }
        return '';
      });
      focusedLabels.push(label);
    }
    expect(focusedLabels.filter((l) => l === '').length, 'keyboard focus always lands on a control').toBe(0);
    expect(focusedLabels.some((l) => /CONFIRM|REJECT/.test(l)), 'keyboard focus never lands on a disabled control').toBe(false);
    await clickText(page, 'PauseScene', 'CONFIRM FIRST PROPOSAL');
    await page.waitForTimeout(400);
    expect((await gameState(page)).companionLink, 'disabled CONFIRM creates nothing').toBe(false);
    expect(await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.hasPendingCompanionIntent), 'disabled CONFIRM queues nothing').toBe(false);
  });

  test('functional: inventory EQUIP is keyboard reachable and commits on the next tick', async ({ page }) => {
    attachDiagnostics(page, 'functional-equip');
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootRun(page);
    // Real core command: give the run a second owned weapon.
    await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const upgraded = JSON.parse(JSON.stringify(w.sim.player.data));
      upgraded.weapons.push({ key: 'scatter', level: 1, ammo: 6, magazine: 6, reloading: false, reloadTimer: 0 });
      w.enqueueSetPlayerData(upgraded);
    });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.player.data.weapons.length),
      'second weapon is real player data').toBeGreaterThan(1);

    await openPause(page);
    await clickText(page, 'PauseScene', 'INVENTORY');
    await page.waitForTimeout(400);
    expect(await currentPage(page), 'inventory page').toBe('inventory');
    const before = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return { equipped: w.player.data.weaponKey, pending: w.getPendingEquipWeapon() };
    });
    expect(before.pending, 'nothing queued yet').toBeNull();
    // Keyboard shortcut 2 = second weapon (the inventory stays open).
    await page.keyboard.press('Digit2');
    await page.waitForTimeout(400);
    const queued = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return { equipped: w.player.data.weaponKey, pending: w.getPendingEquipWeapon() };
    });
    expect(queued.pending, 'keyboard EQUIP queues the second weapon').toBe('scatter');
    expect(queued.equipped, 'core state is unchanged until the next tick').toBe(before.equipped);
    expect(await hasText(page, 'PauseScene', 'QUEUED'), 'the UI shows the honest QUEUED state').toBe(true);
    // Resume: the queued command commits on the first real tick.
    await resumeGame(page);
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.player.data.weaponKey),
      'the queued equip committed').toBe('scatter');
    // Re-open: the new weapon shows as EQUIPPED (not a fake pending label).
    await openPause(page);
    await clickText(page, 'PauseScene', 'INVENTORY');
    await page.waitForTimeout(400);
    expect(await hasText(page, 'PauseScene', 'EQUIPPED'), 'inventory shows the equipped state').toBe(true);
    const rows = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return { equipped: w.player.data.weaponKey, pending: w.getPendingEquipWeapon() };
    });
    expect(rows.equipped).toBe('scatter');
    expect(rows.pending).toBeNull();
  });

  test('functional: settings persist across reopen and reset', async ({ page }) => {
    attachDiagnostics(page, 'functional-settings-persist');
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootRun(page);
    await openPause(page);
    await clickText(page, 'PauseScene', 'SETTINGS');
    await page.waitForTimeout(400);
    const start = await gameState(page);
    const master0 = start.settings!.masterVolume as number;
    await clickText(page, 'PauseScene', '▶');
    await page.waitForTimeout(350);
    const changed = await gameState(page);
    expect(changed.settings!.masterVolume, 'master volume changed').not.toBeCloseTo(master0, 5);
    const shown = Math.round((changed.settings!.masterVolume as number) * 100);
    // Leave settings -> pause -> play -> reopen: the value and its label persist.
    await toRoot(page);
    await resumeGame(page);
    await page.waitForTimeout(400);
    await openPause(page);
    await clickText(page, 'PauseScene', 'SETTINGS');
    await page.waitForTimeout(400);
    expect(await hasText(page, 'PauseScene', `${shown}%`), 'reopened settings shows the persisted value').toBe(true);
    expect((await gameState(page)).settings!.masterVolume, 'persisted value survived the reopen').toBeCloseTo(changed.settings!.masterVolume as number, 5);
    // RESET AUDIO restores the defaults and is persisted too.
    await clickText(page, 'PauseScene', 'RESET AUDIO');
    await page.waitForTimeout(400);
    const reset = await gameState(page);
    expect(reset.settings!.masterVolume, 'RESET AUDIO persisted the default').toBeCloseTo(0.7, 5);
    await toRoot(page);
    await resumeGame(page);
    await page.waitForTimeout(300);
    await openPause(page);
    await clickText(page, 'PauseScene', 'SETTINGS');
    await page.waitForTimeout(400);
    expect(await hasText(page, 'PauseScene', '70%'), 'reset value survives another reopen').toBe(true);
  });

  test('functional: owner re-authorize swaps capability on the same instance and retires old suggestions', async ({ page }) => {
    test.setTimeout(240000);
    attachDiagnostics(page, 'functional-reauth');
    await page.setViewportSize({ width: 1280, height: 720 });
    const TOKEN = randomBytes(24).toString('hex');
    const gateway = new WorldGateway();
    const bridge = await startWorldBridge({
      gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH,
      allowedOrigins: [`http://localhost:${PORT}`], heartbeatIntervalMs: 20
    });
    let sdk: { client: Client; transport: StdioClientTransport } | null = null;
    try {
      await bootRun(page);
      await page.evaluate(() => {
        const w = (window as any).__game.scene.getScene('GameScene').world;
        w.enableEcho();
      });
      await page.waitForFunction(() => !!(window as any).__game.scene.getScene('GameScene').world.echoActor, undefined, { timeout: 15000 });
      // A real hostile in the room BEFORE pausing: the agent can only propose
      // what its own perception actually saw.
      await page.evaluate(() => {
        const w = (window as any).__game.scene.getScene('GameScene').world;
        const e = w.echoActor;
        w.spawnEnemy('drone', e.x + 1, e.y, w.currentRoom()?.id ?? 0, 1);
      });
      await page.waitForTimeout(350);
      await openLlm(page);

      const fillOwner = async (url: string, token: string, ownerKey: string): Promise<void> => {
        await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 10000 });
        await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]', url);
        await page.fill('[data-testid="external-link-form"] input[name="token"]', token);
        await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]', ownerKey);
        await page.click('[data-testid="external-link-form"] button[type="submit"]');
      };

      await clickText(page, 'PauseScene', 'ENABLE / RE-AUTHORIZE');
      await fillOwner(bridge.url, TOKEN, TEST_OWNER_KEY);
      await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').companionStatus === 'CONNECTED', undefined, { timeout: 25000 });
      // Tag the live instance so a silent re-creation is detectable.
      await page.evaluate(() => { (window as any).__game.scene.getScene('GameScene').companionLink.__uiReworkMark = 'live-1'; });

      sdk = await openCompanionSdk(bridge.url, TOKEN);
      const observed = (await sdk.client.callTool({ name: 'echo_observe', arguments: {} })).structuredContent as any;
      expect(observed.ok, 'agent observes the real room').toBe(true);
      const oldId = 'sug_' + 'd'.repeat(24);
      await sdk.client.callTool({
        name: 'echo_suggest',
        arguments: { requestId: 'req_' + 'd'.repeat(24), suggestionId: oldId, kind: 'fire', reason: 'perceived_hostile', ttlTicks: 600 }
      });
      await waitForButton(page, 'CONFIRM FIRST PROPOSAL');
      const linkBefore = await page.evaluate(() => {
        const gs = (window as any).__game.scene.getScene('GameScene');
        return { mark: gs.companionLink?.__uiReworkMark ?? null };
      });
      expect(linkBefore.mark, 'live link instance tagged').toBe('live-1');

      // Human re-authorize with a fresh owner key on the SAME live link.
      await clickText(page, 'PauseScene', 'ENABLE / RE-AUTHORIZE');
      await fillOwner(bridge.url, TOKEN, TEST_OWNER_KEY);
      await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').companionStatus === 'CONNECTED', undefined, { timeout: 25000 });
      const afterReauth = await page.evaluate(() => {
        const gs = (window as any).__game.scene.getScene('GameScene');
        return { mark: gs.companionLink?.__uiReworkMark ?? null, status: gs.companionStatus };
      });
      expect(afterReauth.mark, 're-authorize reuses the same link instance (atomic capability swap)').toBe('live-1');
      expect(afterReauth.status, 'link is CONNECTED after re-authorize').toBe('CONNECTED');
      // The old proposal must be retired: it can never be confirmed any more.
      await expect.poll(async () => (await buttonState(page, 'CONFIRM FIRST PROPOSAL'))?.enabled ?? false, { timeout: 15000 }).toBe(false);
      await clickText(page, 'PauseScene', 'CONFIRM FIRST PROPOSAL');
      await page.waitForTimeout(700);
      expect(await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.hasPendingCompanionIntent),
        'a retired proposal is never queued').toBe(false);
      // Re-authorize keeps the session and epoch; it only clears the published
      // observation and cancels unconfirmed suggestions (companionGateway:
      // `state.observation = null`). So the honest negative assertion is a
      // stateful refusal ("re-observe first"), NOT a revoked session.
      const reobserved = (await sdk.client.callTool({ name: 'echo_observe', arguments: {} })).structuredContent as any;
      expect(reobserved.ok, `observe right after re-authorize: ${JSON.stringify(reobserved).slice(0, 220)}`).toBe(false);
      expect(JSON.stringify(reobserved), 'refusal reason is the cleared observation, not a revoked session')
        .toMatch(/no_observation|E_LINK_UNAVAILABLE/);

      // Real recovery path: the renderer publishes a fresh observation while the
      // run is playing. Resume a few real ticks (with a live hostile in the
      // room), pause again, then the SAME official SDK session must be able to
      // observe, propose, and the human must be able to confirm it.
      await page.evaluate(() => {
        const w = (window as any).__game.scene.getScene('GameScene').world;
        const e = w.echoActor;
        w.spawnEnemy('drone', e.x + 1, e.y, w.currentRoom()?.id ?? 0, 1);
      });
      const tickAtSwap = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.tick);
      await resumeGame(page);
      await page.waitForFunction((tb: number) => (window as any).__game.scene.getScene('GameScene').world.sim.tick > tb + 8, tickAtSwap, { timeout: 15000 });
      await openLlm(page);
      await expect.poll(async () => {
        const r = await sdk.client.callTool({ name: 'echo_observe', arguments: {} }).then((x) => x.structuredContent as any).catch(() => ({ ok: false }));
        return r.ok === true;
      }, { timeout: 20000 }).toBe(true);
      const fresh = (await sdk.client.callTool({
        name: 'echo_suggest',
        arguments: { requestId: 'req_' + 'e'.repeat(24), suggestionId: 'sug_' + 'e'.repeat(24), kind: 'fire', reason: 'perceived_hostile', ttlTicks: 600 }
      })).structuredContent as any;
      expect(fresh.ok, `proposal after the capability swap: ${JSON.stringify(fresh).slice(0, 220)}`).toBe(true);
      await waitForButton(page, 'CONFIRM FIRST PROPOSAL');
      await clickText(page, 'PauseScene', 'CONFIRM FIRST PROPOSAL');
      await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').world.hasPendingCompanionIntent === true, undefined, { timeout: 15000 });

      // The page also stays usable for the human: DISCONNECT ends the real link
      // and the UI reports the real offline state (never a fake CONNECTED).
      await clickText(page, 'PauseScene', 'DISCONNECT');
      await expect.poll(async () => (await gameState(page)).companionStatus, { timeout: 15000 }).not.toBe('CONNECTED');
      const afterTexts = (await sceneTexts(page, 'PauseScene')).join(' | ');
      expect(afterTexts, 'page no longer claims a live model').not.toContain('STATE  CONNECTED');
      expect(afterTexts, 'page reports an offline / not-connected state honestly').toMatch(/OFFLINE|NOT CONNECTED/);
    } finally {
      await sdk?.client.close().catch(() => undefined);
      await bridge.close();
    }
  });

  test('functional: an expired proposal is never confirmed', async ({ page }) => {
    test.setTimeout(240000);
    attachDiagnostics(page, 'functional-expired');
    await page.setViewportSize({ width: 1280, height: 720 });
    const TOKEN = randomBytes(24).toString('hex');
    const gateway = new WorldGateway();
    const bridge = await startWorldBridge({
      gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH,
      allowedOrigins: [`http://localhost:${PORT}`], heartbeatIntervalMs: 20
    });
    let sdk: { client: Client; transport: StdioClientTransport } | null = null;
    try {
      await bootRun(page);
      await page.evaluate(() => {
        const w = (window as any).__game.scene.getScene('GameScene').world;
        w.enableEcho();
      });
      await page.waitForFunction(() => !!(window as any).__game.scene.getScene('GameScene').world.echoActor, undefined, { timeout: 15000 });
      // A real hostile in the room BEFORE pausing: the agent can only propose
      // what its own perception actually saw.
      await page.evaluate(() => {
        const w = (window as any).__game.scene.getScene('GameScene').world;
        const e = w.echoActor;
        w.spawnEnemy('drone', e.x + 1, e.y, w.currentRoom()?.id ?? 0, 1);
      });
      await page.waitForTimeout(350);
      await openLlm(page);
      await clickText(page, 'PauseScene', 'ENABLE / RE-AUTHORIZE');
      await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 10000 });
      await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]', bridge.url);
      await page.fill('[data-testid="external-link-form"] input[name="token"]', TOKEN);
      await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]', TEST_OWNER_KEY);
      await page.click('[data-testid="external-link-form"] button[type="submit"]');
      await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').companionStatus === 'CONNECTED', undefined, { timeout: 25000 });

      sdk = await openCompanionSdk(bridge.url, TOKEN);
      const observed = (await sdk.client.callTool({ name: 'echo_observe', arguments: {} })).structuredContent as any;
      expect(observed.ok, 'agent observes the real room').toBe(true);
      await sdk.client.callTool({
        name: 'echo_suggest',
        arguments: { requestId: 'req_' + 'f'.repeat(24), suggestionId: 'sug_' + 'f'.repeat(24), kind: 'fire', reason: 'perceived_hostile', ttlTicks: 20 }
      });
      await waitForButton(page, 'CONFIRM FIRST PROPOSAL');
      // Let real ticks retire it (ttl 20 ticks), then pause again.
      const tick0 = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.tick);
      await resumeGame(page);
      await page.waitForFunction((tb: number) => {
        const gs = (window as any).__game.scene.getScene('GameScene');
        return gs.world.sim.tick > tb + 40;
      }, tick0, { timeout: 15000 });
      await openLlm(page);
      await expect.poll(async () => (await buttonState(page, 'CONFIRM FIRST PROPOSAL'))?.enabled ?? true, { timeout: 15000 }).toBe(false);
      expect(await hasText(page, 'PauseScene', 'no pending'), 'UI states that nothing is pending').toBe(true);
      await clickText(page, 'PauseScene', 'CONFIRM FIRST PROPOSAL');
      await page.waitForTimeout(700);
      expect(await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.hasPendingCompanionIntent),
        'an expired proposal is never queued').toBe(false);
    } finally {
      await sdk?.client.close().catch(() => undefined);
      await bridge.close();
    }
  });

  test('functional: level-up, death and restart keep the menu honest', async ({ page }) => {
    attachDiagnostics(page, 'functional-lifecycle');
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootRun(page);

    // Real level-up overlay: ESC must not resume the frozen run.
    await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      gs.world.player.addXp(gs.world.player.data.xpToNext);
    });
    await page.waitForFunction(() => (window as any).__game.scene.isActive('LevelUpScene'), { timeout: 8000 });
    const levelTick = (await gameState(page)).tick;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    let s = await gameState(page);
    expect(s.gsPaused, 'ESC on the level-up overlay does not resume').toBe(true);
    expect(s.tick, 'no tick advances while the level-up overlay is open').toBe(levelTick);
    await page.keyboard.press('1');
    await page.waitForFunction(() => !(window as any).__game.scene.isActive('LevelUpScene'), { timeout: 8000 });
    await page.waitForTimeout(600);
    s = await gameState(page);
    expect(s.gsPaused, 'run resumes after choosing an upgrade').toBe(false);

    // Real death path: no dash, so invuln is genuinely 0 before the lethal hit.
    const before = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return { invuln: gs.world.player.invuln, hp: gs.world.player.data.hp };
    });
    expect(before.invuln, 'player is not invulnerable (no dash/keyboard input used)').toBe(0);
    await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      gs.world.player.hurt(999999, gs.world.player.wx + 1, gs.world.player.wy);
    });
    await page.waitForFunction(() => (window as any).__game.scene.isActive('GameOverScene'), { timeout: 10000 });
    s = await gameState(page);
    expect(s.active, 'real lethal damage reaches GameOverScene').toContain('GameOverScene');

    // Restart from the death screen: a fresh, unpaused run with full HP.
    await clickText(page, 'GameOverScene', 'RETRY SAME SEED');
    await page.waitForTimeout(700);
    if (await page.evaluate(() => (window as any).__game.scene.isActive('MainMenuScene'))) {
      await clickText(page, 'MainMenuScene', 'NEW RUN');
      await page.waitForTimeout(700);
    }
    await page.waitForFunction(() => (window as any).__game.scene.isActive('GameScene'), { timeout: 10000 });
    await page.waitForTimeout(900);
    s = await gameState(page);
    expect(s.active, 'a fresh GameScene is active').toContain('GameScene');
    expect(s.active, 'the death screen is gone').not.toContain('GameOverScene');
    expect(s.gsPaused, 'restarted run is not paused').toBe(false);
    const fresh = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return { hp: gs.world.player.data.hp, max: gs.world.player.data.maxHp };
    });
    expect(fresh.hp, 'restart restores player HP').toBe(fresh.max);
    // Pause still works on the restarted run (no stale overlay state).
    await openPause(page);
    expect((await gameState(page)).page, 'pause works after restart').toBe('pause');
    await esc(page);
    expect((await gameState(page)).gsPaused, 'resume works after restart').toBe(false);
  });
});
