// Triage probe: ai-native-world.spec.ts:257 (shared control path) — at least 6 targeted runs
// with state evidence (tick, owner, action, level-up overlay, pending commands, errors).
// Read-only inspection of the live run; the game is driven only by real input.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5291/';
const RUNS = Number(process.argv[3] ?? 6);
const out = { meta: { url: BASE, target: '5f49b24', case: 'ai-native-world.spec.ts:257', runs: RUNS }, results: [] };
const browser = await chromium.launch({ args: ['--no-sandbox'] });

for (let run = 0; run < RUNS; run++) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const r = { run, errors, steps: [] };
  try {
    await page.goto(BASE);
    await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
    await page.waitForTimeout(1300);
    await page.evaluate(() => {
      const g = window.__game, m = g.scene.getScene('MainMenuScene');
      const o = m.scene.start.bind(m.scene);
      m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...(d || {}), seed: 424242 }) : o(k, d);
    });
    await page.mouse.click(640, 340);
    await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'), { timeout: 10000 });
    await page.waitForTimeout(1200);
    const st = () => page.evaluate(() => {
      const g = window.__game, gs = g.scene.getScene('GameScene');
      const live = gs.world.simFixture;
      return {
        tick: live.tick, pending: live.pendingCommands.map((c) => c.type),
        owner: gs.world.player.control.owner, aiEnabled: gs.world.player.control.aiEnabled,
        mode: gs.world.player.control.snapshot().mode, action: gs.world.player.control.snapshot().lastAiAction,
        hp: gs.world.player.data.hp, levelUpActive: g.scene.isActive('LevelUpScene'),
        pauseActive: g.scene.isActive('PauseScene'), active: g.scene.getScenes(true).map((s) => s.sys.settings.key),
        drones: live.drones.length, targets: live.targets.length, loot: live.loot.length
      };
    });
    r.steps.push({ name: 'start', detail: await st() });
    // enable AI through the real pause menu
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await page.evaluate(() => {
      const g = window.__game, ps = g.scene.getScene('PauseScene');
      const t = ps.children.list.find((c) => c.type === 'Text' && (c.text || '').startsWith('AI CONTROL'));
      const c = g.canvas.getBoundingClientRect(), s = g.scale;
      const x = c.x + t.x * (c.width / s.width), y = c.y + t.y * (c.height / s.height);
      window.__clickTarget = { x, y };
    });
    const tgt = await page.evaluate(() => window.__clickTarget);
    await page.mouse.click(tgt.x, tgt.y);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    r.steps.push({ name: 'ai-enabled', detail: await st() });
    // sample the AI run for 8 s
    const samples = [];
    for (let i = 0; i < 40; i++) {
      const s = await st();
      samples.push({ i, tick: s.tick, owner: s.owner, action: s.action, hp: s.hp, levelUp: s.levelUpActive, pending: s.pending, loot: s.loot, targets: s.targets });
      if (s.levelUpActive) {
        // real player choice through the level-up overlay
        await page.keyboard.press('1');
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(200);
    }
    r.samples = samples;
    const owners = [...new Set(samples.map((s) => s.owner))];
    const levelUpFrames = samples.filter((s) => s.levelUp).length;
    const pendingMax = Math.max(0, ...samples.map((s) => s.pending.length));
    const stuckTicks = samples.length > 1 ? samples[samples.length - 1].tick - samples[0].tick : 0;
    r.summary = {
      owners, levelUpFrames, pendingMax, stuckTicks,
      hpMin: Math.min(...samples.map((s) => s.hp)), hpMax: Math.max(...samples.map((s) => s.hp)),
      errors: errors.length
    };
    r.verdict = owners.every((o) => o === 'ai') && stuckTicks > 60 && errors.length === 0 ? 'clean' : (owners.includes('human') ? 'ownership-lost' : 'stalled-or-errored');
  } catch (e) {
    r.error = String(e && e.message ? e.message : e);
    r.verdict = 'exception';
  }
  out.results.push(r);
  await page.close();
}
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-seam-triage/triage-ai-world-flaky.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.results.map((r) => ({ run: r.run, verdict: r.verdict, summary: r.summary, error: r.error })), null, 2));
await browser.close();
