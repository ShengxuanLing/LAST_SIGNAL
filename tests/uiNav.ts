// UI-REWORK-01 — shared navigation helpers for the Pause overlay.
//
// The reworked Pause navigator puts ECHO / LLM / external-agent authorisation
// behind one explicit hub ("AI & COMPANION"), so older specs that clicked those
// controls directly on the pause root must take one extra step. Only the
// navigation changes here; every assertion in those specs is left untouched.
//
// The helpers work on the real rendered Phaser scene: they find the visible
// label, map its world-space centre through the canvas transform and click it,
// exactly like a player would.

import type { Page } from '@playwright/test';

const LOGICAL_W = 1280;
const LOGICAL_H = 720;

const FLAT = `(s) => {
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

const WORLD_BOX = `(c) => {
  const b = c.getBounds ? c.getBounds() : null;
  if (!b) return null;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}`;

async function canvasBox(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) throw new Error('no canvas');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

/** Logical (1280x720) game coordinates of a visible label in a scene. */
export async function labelCenter(page: Page, sceneKey: string, label: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate(({ key, label, flatSrc, boxSrc }) => {
    const g = (window as any).__game;
    const s = g.scene.getScene(key);
    if (!s || !g.scene.isActive(key)) return null;
    const flat = eval(flatSrc)(s) as any[];
    const worldBox = eval(boxSrc) as (c: any) => { x: number; y: number; w: number; h: number } | null;
    const matches = flat.filter((c) => c.type === 'Text' && c.visible !== false && c.text && String(c.text).includes(label));
    if (!matches.length) return null;
    const centre = (o: any) => {
      const b = worldBox(o);
      return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
    };
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
    return centre(pick) ?? centre(matches[0]);
  }, { key: sceneKey, label, flatSrc: FLAT, boxSrc: WORLD_BOX });
}

/** Click a visible label in a scene (real pointer click through the canvas). */
export async function clickLabel(page: Page, sceneKey: string, label: string): Promise<void> {
  const logical = await labelCenter(page, sceneKey, label);
  if (!logical) throw new Error(`label "${label}" not visible in ${sceneKey}`);
  const box = await canvasBox(page);
  await page.mouse.click(box.x + (logical.x * box.w) / LOGICAL_W, box.y + (logical.y * box.h) / LOGICAL_H);
  await page.waitForTimeout(220);
}

/** Current page of the reworked Pause navigator ('pause' when old UI). */
export async function pausePage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.scene.getScene('PauseScene');
    if (!s || !g.scene.isActive('PauseScene')) return 'none';
    return typeof s.page === 'string' ? s.page : 'pause';
  });
}

export async function pauseActive(page: Page): Promise<boolean> {
  return page.evaluate(() => !!(window as any).__game?.scene.isActive('PauseScene'));
}

/** Open the pause overlay from live play (idempotent). */
export async function ensurePause(page: Page): Promise<void> {
  if (await pauseActive(page)) return;
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(350);
}

/**
 * Escape is one level back in the reworked navigator, so walking to the root is
 * a real ESC chain (Escape on the root resumes, which the callers never need:
 * they always navigate forward again).
 */
export async function toPauseRoot(page: Page): Promise<void> {
  await ensurePause(page);
  for (let i = 0; i < 4; i++) {
    const cur = await pausePage(page);
    if (cur === 'pause' || cur === 'none') return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  if (!(await pauseActive(page))) await ensurePause(page);
}

/** Pause root -> AI & COMPANION hub (where ECHO / LLM / AUTHORIZE now live). */
export async function openAiHub(page: Page): Promise<void> {
  await toPauseRoot(page);
  if ((await pausePage(page)) === 'ai') return;
  await clickLabel(page, 'PauseScene', 'AI & COMPANION');
  await page.waitForFunction(() => {
    const g = (window as any).__game;
    const s = g.scene.getScene('PauseScene');
    return g.scene.isActive('PauseScene') && s.page === 'ai';
  }, { timeout: 10000 });
}

export async function openEcho(page: Page): Promise<void> {
  await openAiHub(page);
  await clickLabel(page, 'PauseScene', 'ECHO COMPANION');
  await page.waitForTimeout(300);
}

export async function openLlm(page: Page): Promise<void> {
  await openAiHub(page);
  await clickLabel(page, 'PauseScene', 'LLM COMPANION');
  await page.waitForTimeout(350);
}

export async function openSettings(page: Page): Promise<void> {
  await toPauseRoot(page);
  await clickLabel(page, 'PauseScene', 'SETTINGS');
  await page.waitForTimeout(300);
}

/** Settings page -> the masked external-link form. */
export async function openExternalLinkSetup(page: Page): Promise<void> {
  await openSettings(page);
  await clickLabel(page, 'PauseScene', 'EXTERNAL LINK SETUP');
  await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 10000 });
}

/** Leave the overlay back to live play: ESC walks the whole chain (max 4). */
export async function resumeGame(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if (!(await pauseActive(page))) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(420);
  }
  await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'), { timeout: 5000 });
}

/**
 * Wait until the real ButtonHandle with this label is enabled.
 * The LLM page polls the Companion link, so CONFIRM/REJECT only become
 * actionable once a real pending proposal has been rendered.
 */
export async function waitForButton(page: Page, label: string, enabled = true, timeout = 15000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const state = await page.evaluate((needle) => {
      const g = (window as any).__game;
      const s = g.scene.getScene('PauseScene');
      if (!s || !g.scene.isActive('PauseScene')) return null;
      for (const value of Object.values(s) as any[]) {
        if (!value || !value.rect || !value.label || typeof value.label.text !== 'string') continue;
        if (!value.label.text.includes(needle)) continue;
        return !!value.enabled;
      }
      return null;
    }, label);
    if (state === enabled) return;
    await page.waitForTimeout(120);
  }
  throw new Error(`button "${label}" did not become ${enabled ? 'enabled' : 'disabled'} within ${timeout}ms`);
}
