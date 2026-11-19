// GAMEPLAY-01 P1-A real-browser smoke (fixture: scripted input; not human).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5499';
const BASE = `http://localhost:${PORT}/`;
const OUT = path.resolve('reports/gameplay-01/developer/p1');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const dump = () => page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const s = w.signalView();
  return {
    active: g.scene.isActive('GameScene'),
    scen: w.p1Scenario,
    signal: s,
    linked: w.sim.drones.filter((d) => d.relayDeviceId === 'relay_main').map((d) => ({ id: d.id, hp: d.hp, x: +d.x.toFixed(2), y: +d.y.toFixed(2) })),
    drones: w.sim.drones.map((d) => ({ id: d.id, hp: d.hp, link: d.relayDeviceId ?? null })),
    room: w.currentRoom(),
    cleared: w.currentRoom() ? w.map.rooms[w.currentRoom().id].cleared : null,
    objective: w.roomObjective,
    portal: w.portal ? { target: w.portal.targetRoom, wx: w.portal.wx, wy: w.portal.wy } : null,
    hp: w.player.data.hp,
    tick: w.sim.tick,
    enemyProjectiles: w.sim.projectiles.filter((p) => p.side === 'enemy').map((p) => ({ id: p.id, owner: p.ownerId }))
  };
});

try {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(600);
  const pos = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MainMenuScene');
    const t = s.children.list.find((c) => c.type === 'Text' && String(c.text || '').includes('DEMO 01'));
    if (!t) return null;
    const b = t.getBounds();
    return { x: b.centerX, y: b.centerY };
  });
  if (!pos) throw new Error('DEMO 01 button not found');
  await page.mouse.click(pos.x, pos.y);
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(1500);
  const start = await dump();
  await page.screenshot({ path: path.join(OUT, 'demo-A-start-1280x720.png') });
  await page.waitForTimeout(3500);
  const after = await dump();
  await page.screenshot({ path: path.join(OUT, 'demo-A-after-1280x720.png') });
  fs.writeFileSync(path.join(OUT, 'demo-A-dump.json'), JSON.stringify({ start, after, errors }, null, 2));
  console.log(JSON.stringify({ start, after, errors }, null, 2).slice(0, 6000));
} catch (e) {
  console.log('ERROR', String(e).split('\n')[0]);
  fs.writeFileSync(path.join(OUT, 'demo-A-dump.json'), JSON.stringify({ error: String(e), errors }, null, 2));
} finally {
  await browser.close();
}
