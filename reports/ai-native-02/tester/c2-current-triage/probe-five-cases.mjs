// Bounded triage for the 5 remaining E2E failures on 59aa852 (one minimal repro each,
// with live state/tick/pending/room/save evidence). Read-only inspection.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5293/';
const out = { meta: { url: BASE, target: '59aa85227dcf3c9dcb87d798aaaa7df15f7a2d6e', code: '3f97990d7871f099ce86848159b2ffeae00bb10e' }, cases: {}, findings: [] };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await page.evaluate(() => {
  const g = window.__game, m = g.scene.getScene('MainMenuScene');
  const o = m.scene.start.bind(m.scene);
  m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...(d || {}), seed: 424242 }) : o(k, d);
});
await page.mouse.click(640, 340);
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
await page.waitForTimeout(1200);
const live = () => page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world, s = w.simFixture;
  return {
    tick: s.tick, pending: s.pendingCommands.map((c) => c.type), hasUncommitted: w.hasUncommittedCommands(),
    hp: w.player.data.hp, currency: w.player.data.currency, xp: w.player.data.xp, level: w.player.data.level,
    upgrades: w.player.data.upgrades.map((u) => ({ key: u.key, level: u.level })),
    dmg: w.player.data.damage, speed: w.player.data.speed, maxHp: w.player.data.maxHp, hpRegen: w.player.data.hpRegen,
    weaponKey: w.player.data.weaponKey, loot: s.loot.length, lootViews: w.loot.length,
    room: w.currentRoom()?.kind ?? null, roomId: w.currentRoom()?.id ?? null,
    rooms: w.map.rooms.map((r) => ({ id: r.id, kind: r.kind, spawned: r.spawned, cleared: r.cleared })),
    aliveEnemies: w.enemies.filter((e) => e.alive).length,
    active: g.scene.getScenes(true).map((x) => x.sys.settings.key), paused: gs.paused
  };
});
const readSave = () => page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}'));

// ===== CASE 1: audit:65 / checkpoint:140 / checkpoint:185 — upgrade level record =====
{
  await page.evaluate(() => {
    const gs = (window).__game.scene.getScene('GameScene'), pl = gs.world.player;
    pl.world.playerDataFixture.xp = 0; pl.world.playerDataFixture.xpToNext = 30; pl.addXp(30);
  });
  await page.waitForTimeout(900);
  const before = await live();
  const btn = await page.evaluate(() => {
    const ls = (window).__game.scene.getScene('LevelUpScene');
    return ls?.buttons?.[0] ? { x: ls.buttons[0].x, y: ls.buttons[0].y } : null;
  });
  await page.mouse.click(Math.round(btn.x), Math.round(btn.y));
  const timeline = [];
  for (let i = 0; i < 24; i++) {
    const s = await live();
    timeline.push({ i, tick: s.tick, pending: s.pending, upgrades: s.upgrades, dmg: s.dmg, hpRegen: s.hpRegen, levelUpActive: s.active.includes('LevelUpScene') });
    await page.waitForTimeout(70);
  }
  const last = timeline[timeline.length - 1];
  const save = await readSave();
  out.cases.upgradeLevelRecord = {
    originalPredicate: 'audit:348 expect(after.upgrades - before.upgrades === 1); checkpoint:157 expect.poll(save.run.player.upgrades).toContainEqual({key, level:1}); checkpoint:227 expect.poll(save.run.player.upgrades.length === 1)',
    before: { upgrades: before.upgrades, dmg: before.dmg, hpRegen: before.hpRegen },
    after: { upgrades: last.upgrades, dmg: last.dmg, hpRegen: last.hpRegen, pending: last.pending, tick: last.tick },
    statApplied: last.dmg !== before.dmg || last.hpRegen !== before.hpRegen,
    levelRecorded: last.upgrades.length > 0,
    saveUpgrades: save.run?.player?.upgrades ?? null,
    verdict: 'PRODUCT BUG: the upgrade stat is applied but player.data.upgrades never records {key,level}; core case apply-upgrade calls applyUpgrade(def,data,level) which only runs def.apply(), while the helper applyUpgradeToPlayer() (which pushes the level) is now unused.'
  };
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

// ===== CASE 2: checkpoint:61 — inventory equip =====
{
  await page.evaluate(() => localStorage.setItem('last_signal_save_v1', JSON.stringify({ permanent: { unlockedWeapons: ['pulse', 'scatter', 'plasma'] } })));
  await page.reload();
  await page.waitForFunction(() => (window).__game.scene.isActive('MainMenuScene'));
  await page.mouse.click(640, 340);
  await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
  await page.waitForTimeout(1200);
  await page.keyboard.press('i');
  await page.waitForTimeout(700);
  const before = await page.evaluate(() => {
    const g = window.__game, ps = g.scene.getScene('PauseScene'), gs = g.scene.getScene('GameScene');
    return {
      weapon: gs.world.player.data.weaponKey,
      labels: ps.children.list.filter((c) => c.type === 'Text' && ['EQUIP', 'EQUIPPED'].includes(c.text)).map((c) => ({ label: c.text, y: c.y })),
      paused: gs.paused, tick: gs.world.simFixture.tick, pending: gs.world.simFixture.pendingCommands.map((c) => c.type)
    };
  });
  await page.mouse.click(420, 242);
  await page.waitForTimeout(120);
  const immediate = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), ps = g.scene.getScene('PauseScene');
    return {
      weapon: gs.world.player.data.weaponKey, pending: gs.world.simFixture.pendingCommands.map((c) => c.type),
      tick: gs.world.simFixture.tick,
      labels: ps.children.list.filter((c) => c.type === 'Text' && ['EQUIP', 'EQUIPPED'].includes(c.text)).map((c) => ({ label: c.text, y: c.y }))
    };
  });
  // legal sync point: one normal tick
  const afterTick = await page.evaluate(() => {
    const gs = (window).__game.scene.getScene('GameScene'), w = gs.world;
    w.resetSimulationAccumulator();
    const ev = w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    return { weapon: w.player.data.weaponKey, pending: w.simFixture.pendingCommands.map((c) => c.type), tick: w.simFixture.tick, events: [...new Set(ev.map((e) => e.type))] };
  });
  const afterTickLabels = await page.evaluate(() => {
    const ps = (window).__game.scene.getScene('PauseScene');
    return ps.children.list.filter((c) => c.type === 'Text' && ['EQUIP', 'EQUIPPED'].includes(c.text)).map((c) => ({ label: c.text, y: c.y }));
  });
  out.cases.inventoryEquip = {
    originalPredicate: 'checkpoint:94 expect.poll(inventory).toEqual({weapon:"scatter", buttons:[EQUIP@186, EQUIPPED@230, EQUIP@274]})',
    before, immediate, afterTick, afterTickLabels,
    verdict: 'CONTRACT MISMATCH (not a product bug in the equip rule): the equip command commits on the next core tick (weaponKey changes), but the PauseScene EQUIP/EQUIPPED label row is only re-rendered by refreshWeapons() which runs at click time — before the commit — so the row never reflects the committed state while the overlay stays open.'
  };
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

// ===== CASE 3: economy:11 — supply terminal cleared-room condition =====
{
  const eco = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await eco.goto(BASE + 'economy.html');
  await eco.waitForFunction(() => !!(window).__game, { timeout: 15000 });
  await eco.waitForTimeout(1200);
  await eco.evaluate(() => {
    const m = (window).__game.scene.getScene('MainMenuScene');
    const o = m.scene.start.bind(m.scene);
    m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...d, seed: 424242 }) : o(k, d);
  });
  await eco.mouse.click(640, 340);
  await eco.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
  await eco.waitForTimeout(800);
  const state = await eco.evaluate(() => {
    const { world } = (window).__game.scene.getScene('GameScene');
    const live = world.simFixture;
    const before = { currency: world.player.data.currency, tick: live.tick, pending: live.pendingCommands.map((c) => c.type) };
    world.player.reset(world.portal.wx, world.portal.wy);
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    world.tryInteract(world.player);
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    const l2 = world.simFixture;
    return {
      before,
      after: { currency: world.player.data.currency, tick: l2.tick, pending: l2.pendingCommands.map((c) => c.type) },
      room: world.currentRoom()?.kind ?? null, roomId: world.currentRoom()?.id ?? null,
      rooms: world.map.rooms.map((r) => ({ id: r.id, kind: r.kind, spawned: r.spawned, cleared: r.cleared })),
      aliveEnemies: world.enemies.filter((e) => e.alive).length,
      terminalRooms: [...(window).__game.scene.getScene('GameScene').world.map.rooms].filter((r) => r.kind === 'shop' || r.kind === 'elite').map((r) => r.id),
      currentIsTerminal: ['shop', 'elite'].includes(world.currentRoom()?.kind ?? '')
    };
  });
  await eco.waitForTimeout(400);
  const ui = await eco.evaluate(() => {
    const d = document.querySelector('dialog');
    return { dialogOpen: !!(d && d.open), bodyHasHint: /Supply terminal/.test(document.body.innerText) };
  });
  const opened = await eco.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 25; i++) {
      const d = document.querySelector('dialog');
      if (d && d.open) return { opened: true, afterMs: i * 100 };
      await sleep(100);
    }
    return { opened: false };
  });
  out.cases.economyTerminal = {
    originalPredicate: 'economy:46 expect(terminal).toBeVisible() (after pressing "g")',
    state, ui, opened,
    safeRoomCondition: 'economy safeRoom(): current room cleared AND no alive enemies AND no room in the map with spawned && !cleared',
    verdict: 'CONTRACT MISMATCH in the test fixture, but the underlying condition is a product rule: the test only advances through the portal, so the destination room still has live enemies and other rooms are spawned&&!cleared, so safeRoom() legitimately returns undefined and the terminal never opens. A legal sync point must actually clear the room (kill the enemies through the real damage path) — adding more stepFrame calls cannot satisfy it.'
  };
  await eco.close();
}

out.errors = errors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-current-triage/triage-five.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
