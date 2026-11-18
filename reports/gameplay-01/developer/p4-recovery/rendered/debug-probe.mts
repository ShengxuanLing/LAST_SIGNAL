// debug probe (developer, temporary): dump the authored World state
import { chromium } from '@playwright/test';

const PORT = process.env.PORT ?? '5471';
const SAVE_KEY = 'last_signal_save_v1';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE_ERR', m.text()); });
page.on('pageerror', (e) => console.log('PAGE_ERR', e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.evaluate((k) => localStorage.removeItem(k), SAVE_KEY);
await page.reload();
await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 20000 });
await page.waitForTimeout(400);
await page.evaluate(() => {
  const g: any = (window as any).__game;
  const menu: any = g.scene.getScene('MainMenuScene');
  const orig = menu.scene.start.bind(menu.scene);
  menu.scene.start = (key: string, data?: any) =>
    key === 'GameScene' ? orig(key, { ...(data ?? {}), seed: 20261117 }) : orig(key, data);
});
// click DEMO 01 via the label helper (same as the spec)
const logical = await page.evaluate(() => {
  const g = (window as any).__game;
  const s: any = g.scene.getScene('MainMenuScene');
  const flat: any[] = [];
  const walk = (list: any[]) => { for (const c of list) { if (c.type === 'Container' && Array.isArray(c.list)) { walk(c.list); continue; } flat.push(c); } };
  walk(s.children.list);
  const m = flat.find((c) => c.type === 'Text' && c.text && String(c.text).includes('DEMO 01'));
  const b = m.getBounds();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
const box = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c!.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(box.x + (logical.x * box.w) / 1280, box.y + (logical.y * box.h) / 720);
await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
await page.waitForTimeout(1200);

const dump = (tag: string) => page.evaluate((tag) => {
  const w: any = (window as any).__game.scene.getScene('GameScene').world;
  const sim = w._sim;
  return {
    tag,
    tick: sim.tick,
    authored: sim.authored ?? null,
    room: { id: w.currentRoom()?.id, kind: w.currentRoom()?.kind, flags: w.map.rooms[w.currentRoom()?.id ?? 0] },
    sameMapObject: sim.map === w.map,
    drones: sim.drones.map((d: any) => ({ id: d.id, hp: d.hp, room: d.data?.spawnRoom })),
    targets: sim.targets.map((t: any) => ({ id: t.id, hp: t.hp, x: t.x, y: t.y })),
    pending: sim.pendingCommands.map((c: any) => c.type),
    portal: w.portal ? { x: w.portal.wx, y: w.portal.wy, target: w.portal.targetRoom } : null,
    routeTarget: w.p1RouteTarget,
    enemies: (w.enemies ?? []).length
  };
}, tag);

console.log(JSON.stringify(await dump('start'), null, 1));
// Real-input fight loop (non-blind), same as the evidence spec.
const t0 = Date.now();
let shots = 0;
while (Date.now() - t0 < 60000) {
  const info = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const w: any = gs.world;
    const list = ((w.enemies as any[]) ?? []).map((e: any) => ({
      x: e._wx ?? e.wx, y: e._wy ?? e.wy, hp: e._hp ?? e.hp ?? null,
      d: Math.hypot((e._wx ?? e.wx) - w.player.wx, (e._wy ?? e.wy) - w.player.wy)
    })).filter((e: any) => (e.hp ?? 0) > 0).sort((a: any, b: any) => a.d - b.d);
    const pick = list[0] ?? null;
    let screen = null as any;
    if (pick) {
      const cam = gs.cameras.main;
      const d = w.worldToScreen(pick.x, pick.y);
      const p0 = cam.getWorldPoint(0, 0);
      const px = cam.getWorldPoint(100, 0);
      const py = cam.getWorldPoint(0, 100);
      screen = { x: (d.x - p0.x) / ((px.x - p0.x) / 100), y: (d.y - p0.y) / ((py.y - p0.y) / 100) };
    }
    const rec = w.map.rooms[w.currentRoom()?.id ?? 0];
    return {
      pick: pick ? { ...pick, screen } : null, cleared: rec.cleared,
      drones: w._sim.drones.map((x: any) => x.hp), authored: !!w._sim.authored,
      player: { x: w.player.wx, y: w.player.wy },
      status: g.scene.getScenes(true).map((s: any) => s.sys.settings.key)
    };
  });
  if (info.cleared) { console.log('CLEARED at', Date.now() - t0, 'ms shots', shots); break; }
  if (!info.pick) { console.log('no living enemy', JSON.stringify(info)); await page.waitForTimeout(300); continue; }
  if (info.pick.d > 4.5) {
    const dx = info.pick.x - info.player.x, dy = info.pick.y - info.player.y;
    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : (dy > 0 ? 'KeyS' : 'KeyW');
    await page.keyboard.down(key); await page.waitForTimeout(280); await page.keyboard.up(key);
    continue;
  }
  await page.mouse.move(box.x + (info.pick.screen.x * box.w) / 1280, box.y + (info.pick.screen.y * box.h) / 720);
  await page.mouse.down(); await page.waitForTimeout(320); await page.mouse.up(); shots++;
}
console.log(JSON.stringify(await dump('after-fight'), null, 1));
await browser.close();
