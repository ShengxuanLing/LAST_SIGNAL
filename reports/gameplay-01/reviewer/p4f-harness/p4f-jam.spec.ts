// Reviewer-only P4 rendered probe (snapshot only): door-side jam cost.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5495';
const OUT = path.resolve(process.env.P4F_OUT ?? 'evidence');

function rec(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
}

async function box(page: Page) {
  const b = await page.evaluate(() => { const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  return b;
}

async function clickLabel(page: Page, sceneKey: string, label: string) {
  const f = await page.evaluate(({ key, label }) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene(key);
    if (!s || !g.scene.isActive(key)) return null;
    const flat: any[] = [];
    const walk = (l: any[]) => { for (const c of l) { if (c.type === 'Container' && c.list) walk(c.list); else flat.push(c); } };
    walk(s.children.list);
    const t = flat.filter((c) => c.type === 'Text' && c.visible !== false && String(c.text).includes(label))[0];
    if (!t) return null;
    const bb = t.getBounds(); const cam = s.cameras.main;
    return { fx: (bb.x + bb.width / 2 - cam.scrollX) / (cam.width / cam.zoom), fy: (bb.y + bb.height / 2 - cam.scrollY) / (cam.height / cam.zoom) };
  }, { key: sceneKey, label });
  expect(f, `label ${label}`).not.toBeNull();
  const b = await box(page);
  await page.mouse.click(b.x + f!.fx * b.w, b.y + f!.fy * b.h);
  await page.waitForTimeout(300);
}

test('reviewer: door-side jam pays JAM_COST and closes the route target', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('last_signal_autoOwner', 'human'); });
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), undefined, { timeout: 30000 });
  await page.waitForTimeout(400);
  await clickLabel(page, 'MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), undefined, { timeout: 30000 });
  await page.waitForTimeout(1200);

  const start = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    const route = w.p1Scenario?.routes?.[0];
    return {
      portal: route?.portal ?? null,
      relay: w.p1Scenario?.relay ?? null,
      player: { x: w.sim.player.x, y: w.sim.player.y },
      energy: w.signalView()?.playerEnergy ?? null,
      relayState: w.signalView()?.relay ?? null,
      jamCost: null
    };
  });
  expect(start.portal, 'the authored route portal cell exists').not.toBeNull();

  // closed-loop walk to the authored door cell with real keys
  const pos = async () => page.evaluate(() => { const w: any = (window as any).__game.scene.getScene('GameScene').world; return { x: w.sim.player.x, y: w.sim.player.y }; });
  let cur = start.player;
  for (let i = 0; i < 90; i += 1) {
    cur = await pos();
    const dx = start.portal!.x - cur.x, dy = start.portal!.y - cur.y;
    if (Math.hypot(dx, dy) <= 0.55) break;
    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : (dy > 0 ? 'KeyS' : 'KeyW');
    await page.keyboard.down(key);
    await page.waitForTimeout(140);
    await page.keyboard.up(key);
  }
  cur = await pos();
  const atDoor = Math.hypot(start.portal!.x - cur.x, start.portal!.y - cur.y);
  expect(atDoor, `walked to the authored door cell (dist ${atDoor.toFixed(2)})`).toBeLessThanOrEqual(1.0);

  const before = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    const v: any = w.signalView();
    return { energy: v?.playerEnergy ?? null, relay: v?.relay ?? null, routeTarget: w.p1RouteTarget ?? null, portal: w.portal ? { x: w.portal.wx, y: w.portal.wy } : null };
  });
  await page.keyboard.press('KeyY');
  await page.waitForFunction(() => ((window as any).__game.scene.getScene('GameScene').world.signalView()?.relay) === 'JAMMED', undefined, { timeout: 8000 });
  const after = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    const v: any = w.signalView();
    return { energy: v?.playerEnergy ?? null, relay: v?.relay ?? null, routeTarget: w.p1RouteTarget ?? null, portal: w.portal ? { x: w.portal.wx, y: w.portal.wy } : null };
  });
  const delta = before.energy !== null && after.energy !== null ? before.energy - after.energy : null;
  const rec3 = { start, atDoor: Number(atDoor.toFixed(2)), before, after, delta };
  rec('p4f-door-jam-cost', rec3);
  await page.screenshot({ path: path.join(OUT, 'p4f-door-jam-cost.png') });

  expect(before.relay, 'relay was ACTIVE before the jam').toBe('ACTIVE');
  expect(after.relay, 'a real Y press at the door jams the relay').toBe('JAMMED');
  expect(after.routeTarget, 'JAMMED yields no route target').toBeNull();
  expect(before.routeTarget, 'a target existed before the jam').not.toBeNull();
  expect(delta, 'the jam really cost energy').not.toBeNull();
  expect(delta!, 'jam cost is JAM_COST (25) minus at most one tick of regen').toBeGreaterThan(23.5);
  expect(delta!, 'jam cost never exceeds JAM_COST').toBeLessThanOrEqual(25.01);
});
