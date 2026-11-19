// GAMEPLAY-01 P2 — precise pause/commit timing evidence for Demo-02.
// Fixture/agent-driven clicks; NOT human; no model actor.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5599';
const OUT = path.resolve(process.env.OUT_DIR ?? 'reports/gameplay-01/developer/p2/demo02');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function textPos(sceneKey, label) {
  return page.evaluate(({ key, label }) => {
    const g = window.__game;
    const s = g.scene.getScene(key);
    if (!s || !g.scene.isActive(key)) return null;
    const t = s.children.list.find((c) => c.type === 'Text' && c.visible !== false && String(c.text).includes(label));
    if (!t) return null;
    const b = t.getBounds();
    return { x: b.centerX, y: b.centerY };
  }, { key: sceneKey, label });
}
async function clickText(sceneKey, label) {
  const p = await textPos(sceneKey, label);
  if (!p) throw new Error(`text not found: ${label} in ${sceneKey}`);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(350);
}
async function closePause() {
  for (let i = 0; i < 5; i++) {
    if (!(await page.evaluate(() => window.__game?.scene.isActive('PauseScene')))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => !window.__game.scene.isActive('PauseScene'), { timeout: 8000 });
}
async function openEcho() {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(350);
  await clickText('PauseScene', 'AI & COMPANION');
  await clickText('PauseScene', 'ECHO COMPANION');
}
async function openLocal() {
  await openEcho();
  await clickText('PauseScene', 'LOCAL COOPERATION');
  await page.waitForTimeout(400);
}
async function state() {
  return page.evaluate(() => {
    const g = window.__game;
    const gs = g.scene.getScene('GameScene');
    const w = gs.world;
    const sv = w.signalView();
    const echo = w.echoActor;
    const lp = w.echoLocalProposal;
    return {
      simTick: w._sim?.tick ?? null,
      paused: g.scene.isActive('PauseScene'),
      page: g.scene.getScene('PauseScene')?.page ?? null,
      hp: echo?.data?.hp ?? null,
      maxHp: echo?.data?.maxHp ?? null,
      energy: sv?.echoEnergy ?? null,
      playerEnergy: sv?.playerEnergy ?? null,
      evidence: sv?.evidence ?? null,
      audit: w.echoAudit.last(),
      lastFeedbackTick: w.lastSignalFeedback?.tick ?? null,
      proposal: lp ? { id: lp.id, kind: lp.kind, cost: lp.cost, observedTick: lp.observedTick, expiresAtTick: lp.expiresAtTick, roomGeneration: lp.roomGeneration } : null,
      link: !!gs.companionLink,
      status: gs.companionStatus,
      owner: w.player.control.owner
    };
  });
}
async function snap(name) { await page.screenshot({ path: path.join(OUT, name) }); }

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(600);
  await clickText('MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(1200);
  await openEcho();
  await clickText('PauseScene', 'ENABLE ECHO');
  await closePause();
  await page.waitForFunction(() => !!window.__game.scene.getScene('GameScene').world.echoActor, undefined, { timeout: 8000 });
  await page.waitForTimeout(300);

  // Pause point 1 + 2: the simulation must be frozen while paused.
  await openLocal();
  const pausedBefore = await state();
  await page.waitForTimeout(1200);
  const pausedBefore2 = await state();
  say(`PAUSED BEFORE: ${JSON.stringify({ tick: pausedBefore.simTick, hp: pausedBefore.hp, energy: pausedBefore.energy, evidence: pausedBefore.evidence, audit: pausedBefore.audit?.result })}`);
  say(`PAUSED BEFORE +1.2s: ${JSON.stringify({ tick: pausedBefore2.simTick, hp: pausedBefore2.hp, energy: pausedBefore2.energy, evidence: pausedBefore2.evidence, audit: pausedBefore2.audit?.result })}`);

  // Confirm while paused: enqueue only, no core change.
  const proposal = pausedBefore.proposal;
  await clickText('PauseScene', 'CONFIRM (HUMAN) · LOCAL');
  const confirmed = await state();
  await page.waitForTimeout(1200);
  const confirmed2 = await state();
  say(`CONFIRMED PAUSED: ${JSON.stringify({ tick: confirmed.simTick, hp: confirmed.hp, energy: confirmed.energy, evidence: confirmed.evidence, audit: confirmed.audit })}`);
  say(`CONFIRMED PAUSED +1.2s: ${JSON.stringify({ tick: confirmed2.simTick, hp: confirmed2.hp, energy: confirmed2.energy, evidence: confirmed2.evidence, audit: confirmed2.audit })}`);
  await snap('demo02-timing-confirmed-paused-1280x720.png');

  // Sample every frame across the resume boundary; this captures the commit tick.
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const w = gs.world;
    window.__samples = [];
    window.__sampleTimer = setInterval(() => {
      const sv = w.signalView();
      window.__samples.push({
        t: Math.round(performance.now()),
        tick: w._sim?.tick ?? null,
        hp: w.echoActor?.data?.hp ?? null,
        energy: sv?.echoEnergy ?? null,
        evidence: sv?.evidence ?? null,
        audit: w.echoAudit?.last()?.result ?? null,
        feedbackTick: w.lastSignalFeedback?.tick ?? null,
        paused: window.__game.scene.isActive('PauseScene')
      });
    }, 16);
  });

  await closePause();
  await page.waitForTimeout(1600);
  const samples = await page.evaluate(() => {
    clearInterval(window.__sampleTimer);
    window.__sampleTimer = null;
    return window.__samples;
  });
  await snap('demo02-timing-after-resume-1280x720.png');
  const after = await state();
  say(`AFTER RESUME: ${JSON.stringify({ tick: after.simTick, hp: after.hp, energy: after.energy, evidence: after.evidence, audit: after.audit })}`);

  // The first applied sample is the first commit frame.
  const firstApplied = samples.find((s) => s.evidence !== null && s.evidence > 0) ?? null;
  const preApply = samples.filter((s) => firstApplied && s.t < firstApplied.t).at(-1) ?? null;
  const lastSample = samples.at(-1) ?? null;
  const firstHpDrop = samples.find((s) => s.hp !== null && pausedBefore.hp !== null && s.hp < pausedBefore.hp) ?? null;
  const energyDropAtCommit = firstApplied && preApply ? preApply.energy - firstApplied.energy : null;
  const regenAfterCommit = firstApplied && lastSample ? lastSample.energy - firstApplied.energy : null;
  // The PauseScene close tween can leave `paused` true for the first resumed
  // frame. Classify by the real tick instead: <= paused tick is paused; the
  // first tick above it is the first commit frame.
  const pausedSamples = samples.filter((s) => s.tick !== null && s.tick <= (pausedBefore.simTick ?? 0));
  const resumeSamples = samples.filter((s) => s.tick !== null && s.tick > (pausedBefore.simTick ?? 0));
  const pausedTickSet = [...new Set(pausedSamples.map((s) => s.tick))];
  const pausedHpSet = [...new Set(pausedSamples.map((s) => s.hp))];
  const pausedEnergySet = [...new Set(pausedSamples.map((s) => s.energy))];
  const noAppliedWhilePaused = !samples.some((s) => s.tick !== null && s.tick <= (pausedBefore.simTick ?? 0) && s.audit === 'applied');
  const firstAppliedTick = firstApplied?.tick ?? null;
  const firstAppliedHp = firstApplied?.hp ?? null;
  const resumeTickMin = resumeSamples.length ? Math.min(...resumeSamples.map((s) => s.tick).filter((t) => t !== null)) : null;
  const damageAfterResume = !!firstHpDrop && !!firstHpDrop.tick && firstHpDrop.tick > (pausedBefore.simTick ?? 0);
  const damageWhilePaused = pausedBefore.hp !== null && confirmed2.hp !== null && confirmed2.hp < pausedBefore.hp;
  const proposalCost = proposal?.cost?.energy ?? null;
  const pausedStable = pausedBefore.simTick === pausedBefore2.simTick && pausedBefore.hp === pausedBefore2.hp && pausedBefore.energy === pausedBefore2.energy;
  const confirmStable = confirmed.simTick === pausedBefore.simTick && confirmed.hp === pausedBefore.hp && confirmed.energy === pausedBefore.energy && confirmed.evidence === pausedBefore.evidence;
  const confirm2Stable = confirmed2.simTick === pausedBefore.simTick && confirmed2.hp === pausedBefore.hp && confirmed2.energy === pausedBefore.energy && confirmed2.evidence === pausedBefore.evidence;
  const confirmEnqueued = confirmed2.audit?.result === 'enqueued';
  const commitCostOk = proposalCost !== null && energyDropAtCommit === proposalCost;
  const regenObserved = regenAfterCommit !== null && regenAfterCommit > 0;
  const ok = pausedStable && confirmStable && confirm2Stable && confirmEnqueued && noAppliedWhilePaused &&
    commitCostOk && regenObserved && damageAfterResume && !damageWhilePaused &&
    firstAppliedTick !== null && resumeTickMin !== null && firstAppliedTick >= resumeTickMin &&
    after.link === false && after.status === 'OFF' &&
    pausedTickSet.length === 1 && pausedHpSet.length === 1 && pausedEnergySet.length === 1 &&
    errors.length === 0;
  const out = {
    ok,
    label: 'fixture/agent-driven; NOT human; no model actor',
    proposalCost,
    pausedBefore, pausedBefore2, confirmed, confirmed2, after,
    summary: {
      pausedTicks: pausedTickSet, pausedHps: pausedHpSet, pausedEnergies: pausedEnergySet,
      pausedStable, confirmStable, confirm2Stable, confirmEnqueued, noAppliedWhilePaused,
      firstApplied: firstApplied ? { t: firstApplied.t, tick: firstApplied.tick, hp: firstApplied.hp, energy: firstApplied.energy, evidence: firstApplied.evidence, audit: firstApplied.audit, feedbackTick: firstApplied.feedbackTick } : null,
      preApply: preApply ? { t: preApply.t, tick: preApply.tick, energy: preApply.energy, evidence: preApply.evidence } : null,
      energyDropAtCommit, regenAfterCommit,
      firstHpDrop: firstHpDrop ? { t: firstHpDrop.t, tick: firstHpDrop.tick, hp: firstHpDrop.hp } : null,
      damageAfterResume, damageWhilePaused,
      firstAppliedTick, resumeTickMin,
      lastSample: lastSample ? { t: lastSample.t, tick: lastSample.tick, hp: lastSample.hp, energy: lastSample.energy, evidence: lastSample.evidence } : null
    },
    samples,
    errors
  };
  fs.writeFileSync(path.join(OUT, 'demo02-timing.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'demo02-timing.log'), lines.join('\n') + '\n');
  say(`TIMING SUMMARY: ${JSON.stringify(out.summary)}`);
  say(`RESULT: ${ok ? 'PASS' : 'FAIL'} (fixture/agent-driven; not human acceptance)`);
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  say(`ERROR: ${String(e).split('\n')[0]}`);
  say(`PAGE ERRORS: ${errors.slice(0, 3).join(' | ')}`);
  fs.writeFileSync(path.join(OUT, 'demo02-timing.log'), lines.join('\n') + '\n');
  await browser.close();
  process.exit(1);
}
