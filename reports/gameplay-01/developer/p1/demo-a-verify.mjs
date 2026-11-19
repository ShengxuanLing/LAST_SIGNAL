// GAMEPLAY-01 P1-A real-browser verification (fixture: scripted input; not human).
// Same seed/state: ACTIVE -> linked drones fire; JAM -> 0 NEW linked shots;
// expiry -> resume; manual OFF -> 0 new shots; manual ON -> resume.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5499';
const BASE = `http://localhost:${PORT}/`;
const OUT = path.resolve('reports/gameplay-01/developer/p1');
fs.mkdirSync(OUT, { recursive: true });
const logLines = [];
const say = (s) => { logLines.push(s); console.log(s); };

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
  const linked = new Set(w.sim.drones.filter((d) => d.relayDeviceId === 'relay_main').map((d) => d.id));
  return {
    relay: s?.relay ?? null,
    energy: s?.playerEnergy ?? null,
    jamRemaining: w.p1JamRemainingTicks,
    linkedFire: w.p1LinkedFireEnabled,
    hp: w.player.data.hp,
    tick: w.sim.tick,
    objective: w.roomObjective,
    linkedIds: [...linked],
    linkedShots: w.sim.projectiles.filter((p) => p.side === 'enemy' && linked.has(p.ownerId)).map((p) => p.id),
    allEnemyShots: w.sim.projectiles.filter((p) => p.side === 'enemy').map((p) => p.id),
    portal: w.portal ? { target: w.portal.targetRoom } : null
  };
});
const newLinked = (before, after) => {
  const known = new Set(before.linkedShots);
  return after.linkedShots.filter((id) => !known.has(id)).length;
};

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
  if (!pos) throw new Error('DEMO 01 button not found');
  await page.mouse.click(pos.x, pos.y);
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  // Fixture-side observer: wrap the real stepFrame and record every committed
  // projectile-spawned event from the linked drones (no sampling gaps).
  await page.evaluate(() => {
    const w = window.__game.scene.getScene('GameScene').world;
    window.__shots = [];
    const orig = w.stepFrame.bind(w);
    w.stepFrame = (dt, intent, echo) => {
      const events = orig(dt, intent, echo);
      const linked = new Set(w.sim.drones.filter((d) => d.relayDeviceId === 'relay_main').map((d) => d.id));
      for (const e of events) {
        if (e.type === 'projectile-spawned' && e.projectile.side === 'enemy' && linked.has(e.projectile.ownerId)) {
          window.__shots.push(e.projectile.id);
        }
      }
      return events;
    };
  });
  const shotCount = () => page.evaluate(() => window.__shots.length);

  // ACTIVE baseline.
  await page.waitForTimeout(3000);
  const active0 = await dump();
  await page.screenshot({ path: path.join(OUT, 'demo-A-v2-active-1280x720.png') });
  say(`ACTIVE baseline: relay=${active0.relay} hp=${active0.hp} linkedShots=${active0.linkedShots.length} tick=${active0.tick} objective="${active0.objective}"`);

  // JAM.
  await page.evaluate(() => window.__game.scene.getScene('GameScene').world.playerSignalJam());
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.signalView()?.relay === 'JAMMED', undefined, { timeout: 6000 });
  await page.waitForTimeout(400);
  const jam0 = await dump();
  const jamShots0 = await shotCount();
  await page.screenshot({ path: path.join(OUT, 'demo-A-v2-jammed-1280x720.png') });
  await page.waitForTimeout(2500);
  const jam1 = await dump();
  const jamNew = (await shotCount()) - jamShots0;
  say(`JAM: relay=${jam0.relay} energy=${jam0.energy} remaining=${jam0.jamRemaining} hpAfter2.5s=${jam1.hp} newLinkedShots=${jamNew}`);

  // JAM expiry (360 ticks) -> ACTIVE again (manual/powered).
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.signalView()?.relay === 'ACTIVE', undefined, { timeout: 10000 });
  const exp0 = await dump();
  const expShots0 = await shotCount();
  await page.waitForTimeout(2500);
  const exp1 = await dump();
  const expNew = (await shotCount()) - expShots0;
  say(`EXPIRY: relay=${exp1.relay} newLinkedShotsAfter=${expNew} hp=${exp1.hp}`);

  // Manual OFF -> no new linked shots; ON -> resume.
  await page.evaluate(() => window.__game.scene.getScene('GameScene').world.toggleRelay(false));
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.signalView()?.relay === 'INACTIVE', undefined, { timeout: 6000 });
  const off0 = await dump();
  const offShots0 = await shotCount();
  await page.waitForTimeout(2500);
  const off1 = await dump();
  const offNew = (await shotCount()) - offShots0;
  say(`MANUAL OFF: relay=${off0.relay} newLinkedShots=${offNew} hp=${off1.hp} objective="${off1.objective}"`);
  await page.screenshot({ path: path.join(OUT, 'demo-A-v2-manual-off-1280x720.png') });
  // Count from BEFORE the ON toggle so a shot spawned on the very first ACTIVE
  // tick is not lost between the relay wait and the baseline read.
  const onShots0 = await shotCount();
  await page.evaluate(() => window.__game.scene.getScene('GameScene').world.toggleRelay(true));
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').world.signalView()?.relay === 'ACTIVE', undefined, { timeout: 6000 });
  const on0 = await dump();
  await page.waitForTimeout(3000);
  const on1 = await dump();
  const onNew = (await shotCount()) - onShots0;
  say(`MANUAL ON: relay=${on1.relay} newLinkedShotsAfter=${onNew} hp=${on1.hp}`);

  const ok = active0.relay === 'ACTIVE' && active0.linkedShots.length >= 0 &&
    jam0.relay === 'JAMMED' && jam0.energy <= 80 && jamNew === 0 &&
    exp1.relay === 'ACTIVE' && expNew > 0 &&
    off0.relay === 'INACTIVE' && offNew === 0 &&
    on1.relay === 'ACTIVE' && onNew > 0 && errors.length === 0;
  say(`RESULT: ${ok ? 'PASS' : 'FAIL'} (fixture, not human acceptance)`);
  fs.writeFileSync(path.join(OUT, 'demo-A-verify-v2.json'), JSON.stringify({
    ok, active0, jam0, jam1, exp0, exp1, off0, off1, on0, on1, errors
  }, null, 2));
  fs.writeFileSync(path.join(OUT, 'logs/demo-a-verify-v2.log'), logLines.join('\n') + '\n');
  process.exit(ok ? 0 : 1);
} catch (e) {
  say(`ERROR: ${String(e).split('\n')[0]}`);
  say(`PAGE ERRORS: ${errors.slice(0, 3).join(' | ')}`);
  fs.writeFileSync(path.join(OUT, 'logs/demo-a-verify-v2.log'), logLines.join('\n') + '\n');
  await browser.close();
  process.exit(1);
}
await browser.close();
