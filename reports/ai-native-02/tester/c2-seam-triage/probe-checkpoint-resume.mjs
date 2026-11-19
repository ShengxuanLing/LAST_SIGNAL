// Triage probe: checkpoint.spec.ts:185 — does the checkpoint contain the upgrade and the
// 42 currency after the pick, and does RESUME restore the same run/position/HP/currency
// WITHOUT generating extra resources? Read-only inspection + the product's own buttons.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5291/';
const out = { meta: { url: BASE, target: '5f49b24', case: 'checkpoint.spec.ts:185' }, steps: [], findings: [] };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const readSave = () => page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}'));
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const g = window.__game, m = g.scene.getScene('MainMenuScene');
  const o = m.scene.start.bind(m.scene);
  m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...(d || {}), seed: 424242 }) : o(k, d);
});
await page.mouse.click(640, 340);
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const { world } = (window).__game.scene.getScene('GameScene');
  world.player.reset(world.portal.wx, world.portal.wy);
  world.resetSimulationAccumulator();
  world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  world.tryInteract(world.player);
  world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
});
await page.waitForFunction(() => (window).__game.scene.getScene('GameScene').world.enemies.length > 0);
const afterClear = await page.evaluate(() => {
  const { world } = (window).__game.scene.getScene('GameScene');
  const live = world.simFixture;
  for (const e of world.enemies) e.sprite.destroy();
  world.enemies = [];
  world.spawnLoot(world.player.x, world.player.y, 'currency', 'currency', 42);
  world.player.addXp(30);
  world.resetSimulationAccumulator();
  world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  return {
    currency: world.player.data.currency, upgrades: world.player.data.upgrades.length,
    pending: live.pendingCommands.map((c) => c.type), tick: live.tick,
    loot: live.loot.length, lootViews: world.loot.length
  };
});
out.steps.push({ name: 'after-fixture', detail: afterClear });
await page.waitForFunction(() => (window).__game.scene.isActive('LevelUpScene'), { timeout: 10000 });
// pick the first card like the test helper does
const btn = await page.evaluate(() => {
  const ls = (window).__game.scene.getScene('LevelUpScene');
  return ls.buttons[0] ? { x: ls.buttons[0].x, y: ls.buttons[0].y } : null;
});
await page.mouse.click(Math.round(btn.x), Math.round(btn.y));
await page.waitForTimeout(500);
const afterPick = await page.evaluate(() => {
  const { world } = (window).__game.scene.getScene('GameScene');
  const live = world.simFixture;
  return {
    upgrades: world.player.data.upgrades, upgradesCount: world.player.data.upgrades.length,
    currency: world.player.data.currency, pending: live.pendingCommands.map((c) => c.type),
    tick: live.tick, levelUpActive: (window).__game.scene.isActive('LevelUpScene'),
    loot: live.loot.length, lootViews: world.loot.length
  };
});
out.steps.push({ name: 'after-pick', detail: afterPick });
await page.evaluate(() => {
  const w = (window).__game.scene.getScene('GameScene').world;
  w.resetSimulationAccumulator();
  w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
});
await page.waitForTimeout(600);
const save = await readSave();
out.steps.push({ name: 'checkpoint-save', detail: { run: save.run ? { currency: save.run.player?.currency, upgrades: save.run.player?.upgrades, hp: save.run.player?.hp, clearedRooms: save.run.clearedRooms?.length, id: save.run.id } : null } });

// Resume through the menu and compare run identity / position / hp / currency.
const before = await page.evaluate(() => {
  const gs = (window).__game.scene.getScene('GameScene');
  if (!gs || !gs.world) return { unavailable: true, hasScene: !!gs, active: (window).__game.scene.getScenes(true).map((s) => s.sys.settings.key) };
  const w = gs.world;
  const live = w.simFixture;
  return { pos: { x: live.player.x, y: live.player.y }, hp: w.player.data.hp, currency: w.player.data.currency, loot: live.loot.length };
});
await page.reload();
await page.waitForFunction(() => (window).__game.scene.isActive('MainMenuScene'));
const menuLabels = await page.evaluate(() => (window).__game.scene.getScene('MainMenuScene').children.list.filter((c) => c.type === 'Text').map((c) => c.text));
const clickByLabel = async (needle) => {
  const pos = await page.evaluate((n) => {
    const g = window.__game;
    for (const s of g.scene.getScenes(true)) {
      const t = s.children.list.find((c) => c.type === 'Text' && (c.text || '').trim().startsWith(n));
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  }, needle);
  if (!pos) return false;
  await page.mouse.click(pos.x, pos.y);
  return true;
};
const clicked = await clickByLabel('RESUME CHECKPOINT');
out.steps.push({ name: 'resume-click', detail: { clicked, menuLabels } });
await page.waitForTimeout(1500);
const after = await page.evaluate(() => {
  const gs = (window).__game.scene.getScene('GameScene');
  if (!gs || !gs.world) return { unavailable: true, hasScene: !!gs, active: (window).__game.scene.getScenes(true).map((s) => s.sys.settings.key) };
  const w = gs.world;
  const live = w.simFixture;
  return { pos: { x: live.player.x, y: live.player.y }, hp: w.player.data.hp, currency: w.player.data.currency, loot: live.loot.length, upgrades: w.player.data.upgrades.length, tick: live.tick };
});
out.steps.push({ name: 'after-resume', detail: { before, after } });
out.findings.push({
  name: 'checkpoint-currency-and-upgrade-restore',
  detail: {
    save: out.steps.find((s) => s.name === 'checkpoint-save').detail,
    before, after,
    noExtraResources: { lootBefore: before.loot, lootAfter: after.loot, currencyBefore: before.currency, currencyAfter: after.currency }
  }
});
out.errors = errors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-seam-triage/triage-checkpoint-resume.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
