// P1-A diagnostic (fixture): inspects linked drone AI/attack after manual ON.
import { chromium } from '@playwright/test';

const PORT = process.env.PORT ?? '5499';
const BASE = `http://localhost:${PORT}/`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const dump = () => page.evaluate(() => {
  const w = window.__game.scene.getScene('GameScene').world;
  const s = w.signalView();
  return {
    relay: s?.relay,
    tick: w.sim.tick,
    hp: w.player.data.hp,
    drones: w.sim.drones.map((d) => ({ id: d.id, hp: d.hp, link: d.relayDeviceId ?? null, state: d.data.state, attackTimer: +d.attackTimer.toFixed(3), x: +d.x.toFixed(2), y: +d.y.toFixed(2), target: d.data.targetId })),
    enemyProj: w.sim.projectiles.filter((p) => p.side === 'enemy').map((p) => ({ id: p.id, owner: p.ownerId })),
    player: { x: +w.player.x.toFixed(2), y: +w.player.y.toFixed(2) }
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
    return t ? { x: t.getBounds().centerX, y: t.getBounds().centerY } : null;
  });
  await page.mouse.click(pos.x, pos.y);
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.evaluate(() => { window.__game.scene.getScene('GameScene').world.player.invuln = 1e9; });
  await page.waitForTimeout(2000);
  console.log('ACTIVE', JSON.stringify(await dump()));
  await page.evaluate(() => window.__game.scene.getScene('GameScene').world.toggleRelay(false));
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.signalView()?.relay === 'INACTIVE', undefined, { timeout: 6000 });
  await page.waitForTimeout(2000);
  console.log('OFF', JSON.stringify(await dump()));
  await page.evaluate(() => window.__game.scene.getScene('GameScene').world.toggleRelay(true));
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.signalView()?.relay === 'ACTIVE', undefined, { timeout: 6000 });
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(500);
    console.log(`ON+${(i + 1) * 0.5}s`, JSON.stringify(await dump()));
  }
} catch (e) {
  console.log('ERROR', String(e).split('\n')[0]);
} finally {
  await browser.close();
}
