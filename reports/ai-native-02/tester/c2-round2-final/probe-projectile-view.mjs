// Independent C2 round-2 probe: the compatibility projectile view is read-only and the
// legacy setter must not clear or mutate core projectiles. Real mouse fire on normal frames.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5288/';
const report = { meta: { url: BASE, target: '0df1514' }, checks: [], flow: {}, errors: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
const box = () => page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
async function clickLogical(lx, ly) { const b = await box(); await page.mouse.click(b.x + (lx * b.w) / 1280, b.y + (ly * b.h) / 720); }
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await clickLogical(640, 340);
await page.waitForTimeout(1200);
// Fire away from the start position into open space; sample while a player bullet exists.
const b = await box();
await page.mouse.move(b.x + b.w * 0.5, b.y + b.h * 0.35);
await page.mouse.down();
let observed = null;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(30);
  const s = await page.evaluate(() => {
    const w = window.__game.scene.getScene('GameScene').world;
    return { core: w.sim.projectiles.map((p) => ({ id: p.id, damage: p.damage, x: p.pos.x })), view: w.projectiles.map((p) => ({ id: p.data.id, damage: p.data.damage, x: p.data.pos.x })) };
  });
  if (s.core.some((p) => p.side !== 'enemy')) { observed = s; break; }
  if (s.core.length > 0) { observed = s; }
}
await page.mouse.up();
check('player-projectile-observed', !!observed && observed.core.length > 0, observed ? { core: observed.core.length } : null);
const mutation = await page.evaluate(() => {
  const w = window.__game.scene.getScene('GameScene').world;
  const before = w.sim.projectiles.map((p) => ({ id: p.id, damage: p.damage, x: p.pos.x }));
  const view = w.projectiles;
  if (view.length > 0) { view[0].data.damage = 999999; view[0].data.pos.x = 999999; }
  const mid = w.sim.projectiles.map((p) => ({ id: p.id, damage: p.damage, x: p.pos.x }));
  w.projectiles = [];
  const after = w.sim.projectiles.map((p) => ({ id: p.id, damage: p.damage, x: p.pos.x }));
  return { before, mid, after, viewIds: view.map((p) => p.data.id), coreIds: w.sim.projectiles.map((p) => p.id) };
});
check('view-mutation-no-core-effect', JSON.stringify(mutation.before) === JSON.stringify(mutation.mid), { before: mutation.before, mid: mutation.mid });
check('legacy-setter-does-not-clear-core', JSON.stringify(mutation.before) === JSON.stringify(mutation.after), { before: mutation.before, after: mutation.after });
report.flow = mutation;
check('ids-unique', new Set(mutation.after.map((p) => p.id)).size === mutation.after.length);
check('no-console-error', report.errors.length === 0, report.errors);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-round2-final/projectile-view-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
