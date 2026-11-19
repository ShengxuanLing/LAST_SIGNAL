// Triage probe: inventory EQUIP commit timing (checkpoint.spec.ts:61 failure).
// Immediate read vs. read after one normal tick. Read-only inspection.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5291/';
const out = { meta: { url: BASE, target: '5f49b24', case: 'checkpoint.spec.ts:61 equip' }, samples: [], findings: [] };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await page.evaluate(() => {
  const g = window.__game, m = g.scene.getScene('MainMenuScene');
  const o = m.scene.start.bind(m.scene);
  m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...(d || {}), seed: 424242 }) : o(k, d);
  localStorage.setItem('last_signal_save_v1', JSON.stringify({ permanent: { unlockedWeapons: ['pulse', 'scatter', 'plasma'] } }));
});
const b = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(b.x + (640 * b.w) / 1280, b.y + (340 * b.h) / 720);
await page.waitForTimeout(1400);
await page.keyboard.press('i');
await page.waitForTimeout(600);
const before = await page.evaluate(() => {
  const g = window.__game;
  const scene = g.scene.getScene('PauseScene');
  const player = g.scene.getScene('GameScene').world.player;
  const live = g.scene.getScene('GameScene').world.simFixture;
  return {
    weapon: player.data.weaponKey,
    buttons: scene.children.list.filter((c) => c.type === 'Text' && ['EQUIP', 'EQUIPPED'].includes(c.text)).map((c) => ({ label: c.text, y: c.y, enabled: c.input?.enabled ?? false })),
    pending: live?.pendingCommands.map((c) => c.type) ?? [], tick: live?.tick ?? null
  };
});
await page.mouse.click(420, 242);
const timeline = [];
for (let i = 0; i < 20; i++) {
  const s = await page.evaluate(() => {
    const g = window.__game;
    const scene = g.scene.getScene('PauseScene');
    const player = g.scene.getScene('GameScene').world.player;
    const live = g.scene.getScene('GameScene').world.simFixture;
    return {
      weapon: player.data.weaponKey,
      labels: scene.children.list.filter((c) => c.type === 'Text' && ['EQUIP', 'EQUIPPED'].includes(c.text)).map((c) => ({ label: c.text, y: c.y, enabled: c.input?.enabled ?? false })),
      pending: live?.pendingCommands.map((c) => c.type) ?? [], tick: live?.tick ?? null,
      paused: g.scene.getScene('GameScene').paused
    };
  });
  timeline.push(s);
  if (s.weapon === 'scatter' && s.labels.some((l) => l.label === 'EQUIPPED' && l.y === 230)) break;
  await page.waitForTimeout(50);
}
out.samples = { before, timeline };
const committed = timeline.findIndex((t) => t.weapon === 'scatter');
out.findings.push({
  name: 'equip-command-committed-on-next-tick-only',
  immediateAfterClick: timeline[0],
  committedAtSampleIndex: committed,
  committedSample: committed >= 0 ? timeline[committed] : null,
  note: committed < 0
    ? 'equip never committed within 1s'
    : 'PauseScene.equipWeapon -> enqueueEquipWeapon (queue only) -> committed by the next core tick; while the inventory overlay is open the game is paused, so the tick does not run and the button row never re-renders to EQUIPPED'
});
out.errors = errors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-seam-triage/triage-checkpoint-equip.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
