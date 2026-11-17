// GAMEPLAY-01 P2 FINAL-V2 — repeated local confirm / single-queue proof.
// Fixture/agent-driven clicks; NOT human; no model actor.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5599';
const OUT = path.resolve('reports/gameplay-01/developer/p2/final-v2');
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
  await page.waitForTimeout(400);
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
    const p = w.echoPendingLocal;
    const scene = g.scene.getScene('PauseScene');
    return {
      tick: w._sim?.tick ?? null,
      paused: g.scene.isActive('PauseScene'),
      page: scene?.page ?? null,
      hp: echo?.data?.hp ?? null,
      echo: !!echo,
      energy: sv?.echoEnergy ?? null,
      playerEnergy: sv?.playerEnergy ?? null,
      evidence: sv?.evidence ?? null,
      manualEnabled: sv?.manualEnabled ?? null,
      relay: sv?.relay ?? null,
      pending: p,
      queue: w._sim?.pendingCommands?.length ?? null,
      queueTypes: (w._sim?.pendingCommands ?? []).map((c) => c.type),
      audit: w.echoAudit.last(),
      confirmEnabled: scene?.localConfirm?.enabled ?? null,
      switchEnabled: scene?.localSwitch?.enabled ?? null,
      proposalText: String(scene?.localProposalText?.text ?? ''),
      noticeText: String(scene?.localNoticeText?.text ?? ''),
      owner: w.player.control.owner,
      link: !!gs.companionLink,
      status: gs.companionStatus
    };
  });
}
async function snap(name) { await page.screenshot({ path: path.join(OUT, name) }); }
async function directConfirm() {
  return page.evaluate(() => {
    const w = window.__game.scene.getScene('GameScene').world;
    const p = w.echoPendingLocal;
    const same = p ? w.confirmLocalEchoProposal(p.proposalId) : null;
    const wrong = w.confirmLocalEchoProposal('local_does_not_exist');
    return { same, wrong, pending: w.echoPendingLocal, queue: w._sim.pendingCommands.length, queueTypes: w._sim.pendingCommands.map((c) => c.type), audit: w.echoAudit.last() };
  });
}
async function sampleResume(ms = 1200) {
  await page.evaluate(() => {
    const w = window.__game.scene.getScene('GameScene').world;
    window.__samples = [];
    window.__sampleTimer = setInterval(() => {
      const sv = w.signalView();
      window.__samples.push({
        t: Math.round(performance.now()), tick: w._sim?.tick ?? null,
        energy: sv?.echoEnergy ?? null, evidence: sv?.evidence ?? null,
        manual: sv?.manualEnabled ?? null, audit: w.echoAudit?.last()?.result ?? null
      });
    }, 16);
  });
  await closePause();
  await page.waitForTimeout(ms);
  return page.evaluate(() => {
    clearInterval(window.__sampleTimer);
    window.__sampleTimer = null;
    return window.__samples;
  });
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.clear());
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

  // ---------- SCAN: repeated confirm while paused ----------
  await openLocal();
  const scanBefore = await state();
  say(`SCAN BEFORE: ${JSON.stringify({ tick: scanBefore.tick, prop: scanBefore.proposalText.split('\n')[0], queue: scanBefore.queue, confirm: scanBefore.confirmEnabled })}`);
  await clickText('PauseScene', 'CONFIRM (HUMAN) · LOCAL');
  const scanConfirmed = await state();
  await page.waitForTimeout(700);
  const scanConfirmed2 = await state();
  const directScan = await directConfirm();
  await clickText('PauseScene', 'CONFIRM (HUMAN) · LOCAL'); // disabled; must be a no-op
  const scanAfterUi = await state();
  await snap('scan-waiting-1280x720.png');
  say(`SCAN CONFIRMED: pending=${scanConfirmed.pending?.proposalId} queue=${scanConfirmed.queue} confirm=${scanConfirmed.confirmEnabled} audit=${JSON.stringify(scanConfirmed.audit)}`);
  say(`SCAN CONFIRMED +0.7s: tick=${scanConfirmed2.tick} queue=${scanConfirmed2.queue} pending=${scanConfirmed2.pending?.proposalId} confirm=${scanConfirmed2.confirmEnabled} text=${JSON.stringify(scanConfirmed2.proposalText.split('\n')[0])}`);
  say(`SCAN DIRECT SECOND: same=${directScan.same} wrong=${directScan.wrong} queue=${directScan.queue} pending=${directScan.pending?.proposalId} audit=${JSON.stringify(directScan.audit)}`);
  say(`SCAN UI SECOND CLICK: queue=${scanAfterUi.queue} pending=${scanAfterUi.pending?.proposalId}`);
  const scanSamples = await sampleResume(1200);
  const scanAfter = await state();
  const scanFirstApplied = scanSamples.find((s) => s.evidence !== null && s.evidence > 0) ?? null;
  const scanPre = scanFirstApplied ? scanSamples.filter((s) => s.t < scanFirstApplied.t).at(-1) ?? null : null;
  await snap('scan-after-1280x720.png');
  say(`SCAN AFTER: tick=${scanAfter.tick} energy=${scanAfter.energy} evidence=${scanAfter.evidence} pending=${scanAfter.pending} queue=${scanAfter.queue} audit=${JSON.stringify(scanAfter.audit)}`);
  say(`SCAN COMMIT: first=${JSON.stringify(scanFirstApplied)} preEnergy=${scanPre?.energy} drop=${scanPre && scanFirstApplied ? scanPre.energy - scanFirstApplied.energy : null}`);

  // ---------- TOGGLE: repeated confirm, switch OFF, AI owner, one real flip ----------
  await openLocal();
  const toggleBefore = await state();
  say(`TOGGLE BEFORE: ${JSON.stringify({ tick: toggleBefore.tick, prop: toggleBefore.proposalText.split('\n')[0], manual: toggleBefore.manualEnabled, queue: toggleBefore.queue })}`);
  await clickText('PauseScene', 'CONFIRM (HUMAN) · LOCAL');
  const toggleConfirmed = await state();
  await page.waitForTimeout(700);
  const toggleConfirmed2 = await state();
  const directToggle = await directConfirm();
  await snap('toggle-waiting-1280x720.png');
  say(`TOGGLE CONFIRMED: pending=${toggleConfirmed.pending?.proposalId} queue=${toggleConfirmed.queue} confirm=${toggleConfirmed.confirmEnabled} audit=${JSON.stringify(toggleConfirmed.audit)}`);
  say(`TOGGLE +0.7s: tick=${toggleConfirmed2.tick} queue=${toggleConfirmed2.queue} pending=${toggleConfirmed2.pending?.proposalId} confirm=${toggleConfirmed2.confirmEnabled} text=${JSON.stringify(toggleConfirmed2.proposalText.split('\n')[0])}`);
  say(`TOGGLE DIRECT SECOND: same=${directToggle.same} wrong=${directToggle.wrong} queue=${directToggle.queue} pending=${directToggle.pending?.proposalId} audit=${JSON.stringify(directToggle.audit)}`);

  // Switch ON then OFF while pending: only autonomous intent changes.
  await clickText('PauseScene', 'LOW-RISK COOPERATION: OFF');
  const switchOn = await state();
  await clickText('PauseScene', 'LOW-RISK COOPERATION: ON');
  const switchOff = await state();
  say(`SWITCH WHILE PENDING: on=${switchOn.pending?.proposalId}/${switchOn.queue} off=${switchOff.pending?.proposalId}/${switchOff.queue}`);
  await snap('toggle-switch-off-pending-1280x720.png');

  // Owner -> AI while pending: no new confirm, pending stays, already-human action is not revoked.
  await clickText('PauseScene', 'BACK');
  await clickText('PauseScene', 'BACK');
  await clickText('PauseScene', 'AI CONTROL');
  await page.waitForTimeout(300);
  await clickText('PauseScene', 'ECHO COMPANION');
  await clickText('PauseScene', 'LOCAL COOPERATION');
  await page.waitForTimeout(350);
  const aiPending = await state();
  const directAi = await directConfirm();
  await snap('toggle-ai-owner-pending-1280x720.png');
  say(`AI OWNER PENDING: owner=${aiPending.owner} pending=${aiPending.pending?.proposalId} queue=${aiPending.queue} confirm=${aiPending.confirmEnabled} switch=${aiPending.switchEnabled} directSame=${directAi.same} directWrong=${directAi.wrong} queueAfter=${directAi.queue}`);
  const toggleSamples = await sampleResume(1000);
  const toggleAfter = await state();
  const toggleFirstApplied = toggleSamples.find((s) => s.audit === 'applied') ?? null;
  await snap('toggle-after-1280x720.png');
  const toggleFlipped = toggleBefore.manualEnabled !== toggleAfter.manualEnabled;
  say(`TOGGLE AFTER: tick=${toggleAfter.tick} manual=${toggleAfter.manualEnabled} (before ${toggleBefore.manualEnabled}) flipped=${toggleFlipped} pending=${toggleAfter.pending} queue=${toggleAfter.queue} audit=${JSON.stringify(toggleAfter.audit)} firstApplied=${JSON.stringify(toggleFirstApplied)}`);

  // ---------- DISABLE ECHO while a local action is pending: exact cancel ----------
  // Use a fresh run so the ECHO is certainly alive; the main run's ECHO has taken
  // real sentry damage during the preceding proofs.
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
  await openLocal();
  const preDisable = await state();
  const disableProposal = await page.evaluate(() => window.__game.scene.getScene('GameScene').world.echoLocalProposal?.id ?? null);
  if (!disableProposal) throw new Error('no proposal for disable-pending check');
  await clickText('PauseScene', 'CONFIRM (HUMAN) · LOCAL');
  const disablePending = await state();
  await clickText('PauseScene', 'BACK');
  await clickText('PauseScene', 'DISABLE ECHO');
  await page.waitForTimeout(400);
  const disabled = await state();
  await snap('disable-pending-cancelled-1280x720.png');
  await closePause();
  await page.waitForTimeout(500);
  const disabledAfter = await state();
  say(`DISABLE PENDING: beforeQueue=${disablePending.queue} beforePending=${disablePending.pending?.proposalId} afterPending=${disabled.pending} afterQueue=${disabled.queue} afterTypes=${disabled.queueTypes.join(',')} audit=${JSON.stringify(disabled.audit)} echo=${disabled.echo}`);
  say(`DISABLE AFTER RESUME: echo=${disabledAfter.echo} queue=${disabledAfter.queue} pending=${disabledAfter.pending} audit=${JSON.stringify(disabledAfter.audit)}`);

  const pausedStable = scanBefore.tick === scanConfirmed.tick && scanBefore.tick === scanConfirmed2.tick &&
    scanBefore.hp === scanConfirmed.hp && scanBefore.hp === scanConfirmed2.hp &&
    scanBefore.energy === scanConfirmed.energy && scanBefore.energy === scanConfirmed2.energy &&
    scanBefore.evidence === scanConfirmed.evidence && scanConfirmed.evidence === scanConfirmed2.evidence;
  const scanPending = scanConfirmed.pending?.proposalId === scanBefore.pending?.proposalId ? false : !!scanConfirmed.pending;
  const scanSingle = scanConfirmed.queue === 1 && scanConfirmed2.queue === 1 && directScan.queue === 1 && scanAfterUi.queue === 1 &&
    directScan.same === false && directScan.wrong === false && directScan.audit?.code === 'E_ALREADY_PENDING';
  const scanAppliedOnce = scanAfter.pending === null && scanAfter.queue === 0 && scanAfter.audit?.result === 'applied' &&
    scanAfter.audit?.proposalId === scanConfirmed.pending?.proposalId && scanAfter.evidence === 1 &&
    scanFirstApplied?.evidence === 1 && scanPre && scanPre.energy - scanFirstApplied.energy === 10;
  const togglePending = !!toggleConfirmed.pending && toggleConfirmed.queue === 1 && toggleConfirmed2.queue === 1 && directToggle.queue === 1 &&
    directToggle.same === false && directToggle.wrong === false && directToggle.audit?.code === 'E_ALREADY_PENDING';
  const switchPreserved = switchOn.pending?.proposalId === toggleConfirmed.pending?.proposalId && switchOn.queue === 1 &&
    switchOff.pending?.proposalId === toggleConfirmed.pending?.proposalId && switchOff.queue === 1;
  const aiPreserved = aiPending.owner === 'ai' && aiPending.pending?.proposalId === toggleConfirmed.pending?.proposalId &&
    aiPending.queue === 1 && aiPending.confirmEnabled === false && aiPending.switchEnabled === false &&
    directAi.same === false && directAi.wrong === false && directAi.queue === 1;
  const toggleAppliedOnce = toggleAfter.pending === null && toggleAfter.queue === 0 && toggleFlipped &&
    toggleAfter.audit?.result === 'applied' && toggleAfter.audit?.proposalId === toggleConfirmed.pending?.proposalId;
  const disableCancelled = disablePending.queue === 1 && disablePending.pending?.proposalId === disableProposal &&
    disabled.pending === null && disabled.audit?.result === 'cancelled' && disabled.audit?.code === 'E_ECHO_DISABLED' &&
    disabled.audit?.proposalId === disableProposal && !disabled.queueTypes.includes('signal-scan') && !disabled.queueTypes.includes('toggle-relay') &&
    disabledAfter.echo === false && disabledAfter.queue === 0 && disabledAfter.pending === null;
  const ok = pausedStable && scanPending && scanSingle && scanAppliedOnce && togglePending && switchPreserved && aiPreserved &&
    toggleAppliedOnce && disableCancelled && afterLinkOff(scanAfter) && errors.length === 0;
  function afterLinkOff(s) { return s.link === false && s.status === 'OFF'; }
  const out = {
    ok, label: 'fixture/agent-driven; NOT human; no model actor',
    scan: { before: scanBefore, confirmed: scanConfirmed, confirmed2: scanConfirmed2, direct: directScan, afterUi: scanAfterUi, after: scanAfter, firstApplied: scanFirstApplied, pre: scanPre },
    toggle: { before: toggleBefore, confirmed: toggleConfirmed, confirmed2: toggleConfirmed2, direct: directToggle, switchOn, switchOff, aiPending, directAi, after: toggleAfter, firstApplied: toggleFirstApplied },
    disable: { pre: preDisable, pending: disablePending, after: disabled, afterResume: disabledAfter },
    checks: { pausedStable, scanPending, scanSingle, scanAppliedOnce, togglePending, switchPreserved, aiPreserved, toggleAppliedOnce, disableCancelled, errors },
    samples: { scan: scanSamples, toggle: toggleSamples },
    errors
  };
  fs.writeFileSync(path.join(OUT, 'repeat-confirm.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'repeat-confirm.log'), lines.join('\n') + '\n');
  say(`RESULT: ${ok ? 'PASS' : 'FAIL'} (fixture/agent-driven; not human acceptance)`);
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  say(`ERROR: ${String(e).split('\n')[0]}`);
  say(`PAGE ERRORS: ${errors.slice(0, 3).join(' | ')}`);
  fs.writeFileSync(path.join(OUT, 'repeat-confirm.log'), lines.join('\n') + '\n');
  await browser.close();
  process.exit(1);
}
