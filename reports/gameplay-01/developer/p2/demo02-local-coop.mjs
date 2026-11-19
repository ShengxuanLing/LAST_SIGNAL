// GAMEPLAY-01 P2 — Demo-02 offline ECHO local cooperation (fixture/agent-driven;
// NOT human acceptance). Real main menu, real pause UI, real human-click fixture,
// real core scan; no bridge and no fake connected state.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5599';
const BASE = `http://localhost:${PORT}/`;
const OUT = path.resolve('reports/gameplay-01/developer/p2/demo02');
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
async function snap(name) { await page.screenshot({ path: path.join(OUT, name) }); }
async function closePause() {
  for (let i = 0; i < 5; i++) {
    if (!(await page.evaluate(() => window.__game?.scene.isActive('PauseScene')))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => !window.__game.scene.isActive('PauseScene'), { timeout: 8000 });
  await page.waitForTimeout(500);
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
    const lp = w.echoLocalProposal;
    return {
      echo: w.echoActor ? { hp: w.echoActor.data.hp, x: w.echoActor.x, y: w.echoActor.y } : null,
      relay: sv?.relay ?? null,
      echoEnergy: sv?.echoEnergy ?? null,
      playerEnergy: sv?.playerEnergy ?? null,
      evidence: sv?.evidence ?? null,
      echoCooperation: w.echoCooperation,
      proposal: lp ? { id: lp.id, kind: lp.kind, target: lp.target, expiresAtTick: lp.expiresAtTick, roomGeneration: lp.roomGeneration, provenance: lp.provenance, cost: lp.cost } : null,
      audit: w.echoAudit.last(),
      companionLink: !!(gs.companionLink),
      companionStatus: gs.companionStatus,
      owner: w.player.control.owner,
      saveEchoCoop: JSON.parse(localStorage.getItem('last_signal_save_v1') || '{}')?.permanent?.echoCooperationOptIn ?? null,
      paused: g.scene.isActive('PauseScene'),
      page: g.scene.getScene('PauseScene')?.page ?? null,
      localSwitchEnabled: g.scene.getScene('PauseScene')?.localSwitch?.enabled ?? null,
      localConfirmEnabled: g.scene.getScene('PauseScene')?.localConfirm?.enabled ?? null
    };
  });
}

try {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(600);
  await clickText('MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(1200);
  const initial = await state();
  say(`INITIAL: relay=${initial.relay} echo=${initial.echo ? 'present' : 'none'} echoCoop=${initial.echoCooperation} link=${initial.companionLink} status=${initial.companionStatus}`);

  // ECHO is enabled by the human from the real ECHO page; the spawn commits on resume.
  await openEcho();
  await clickText('PauseScene', 'ENABLE ECHO');
  await closePause();
  await page.waitForFunction(() => !!window.__game.scene.getScene('GameScene').world.echoActor, undefined, { timeout: 8000 });
  const enabled = await state();
  say(`ECHO ENABLED: hp=${enabled.echo?.hp} echoCoop=${enabled.echoCooperation}`);

  // Offline local proposal.
  await openLocal();
  const proposalState = await state();
  const proposalText = await page.evaluate(() => String(window.__game.scene.getScene('PauseScene')?.localProposalText?.text ?? ''));
  await snap('demo02-local-proposal-1280x720.png');
  say(`LOCAL PROPOSAL: page=${proposalState.page} proposal=${JSON.stringify(proposalState.proposal)} switch=${proposalState.echoCooperation} confirmEnabled=${proposalState.localConfirmEnabled}`);
  say(`PROPOSAL TEXT: ${proposalText.replace(/\n/g, ' | ')}`);

  // Human click fixture: CONFIRM (HUMAN) · LOCAL while paused.
  await clickText('PauseScene', 'CONFIRM (HUMAN) · LOCAL');
  const confirmedPaused = await state();
  say(`CONFIRMED WHILE PAUSED: audit=${JSON.stringify(confirmedPaused.audit)} proposal=${JSON.stringify(confirmedPaused.proposal)}`);
  await closePause();
  await page.waitForTimeout(700);
  const after = await state();
  await snap('demo02-local-after-scan-1280x720.png');
  say(`AFTER RESUME: relay=${after.relay} evidence=${after.evidence} echoEnergy=${after.echoEnergy} playerEnergy=${after.playerEnergy} audit=${JSON.stringify(after.audit)} link=${after.companionLink} status=${after.companionStatus}`);

  // Audit / offline page after the real core tick.
  await openLocal();
  const auditPage = await state();
  await snap('demo02-local-audit-1280x720.png');
  say(`AUDIT PAGE: audit=${JSON.stringify(auditPage.audit)} proposal=${JSON.stringify(auditPage.proposal)} switch=${auditPage.echoCooperation}`);

  // Switch ON/OFF persists; default OFF; manual mode is not changed.
  await clickText('PauseScene', 'LOW-RISK COOPERATION: OFF');
  const switchedOn = await state();
  say(`SWITCH ON: world=${switchedOn.echoCooperation} save=${switchedOn.saveEchoCoop} switchEnabled=${switchedOn.localSwitchEnabled}`);
  await clickText('PauseScene', 'LOW-RISK COOPERATION: ON');
  const switchedOff = await state();
  say(`SWITCH OFF: world=${switchedOff.echoCooperation} save=${switchedOff.saveEchoCoop}`);

  // Reject the current local proposal (if any): no resource spend, audit rejected.
  const rejectTarget = await page.evaluate(() => {
    const w = window.__game.scene.getScene('GameScene').world;
    const p = w.echoLocalProposal;
    return p ? { id: p.id, kind: p.kind } : null;
  });
  if (rejectTarget) {
    const beforeReject = await state();
    await clickText('PauseScene', 'REJECT LOCAL');
    const rejected = await state();
    say(`REJECT: kind=${rejectTarget.kind} energyBefore=${beforeReject.echoEnergy} energyAfter=${rejected.echoEnergy} audit=${JSON.stringify(rejected.audit)} proposal=${JSON.stringify(rejected.proposal)}`);
  } else {
    say('REJECT: no current proposal (cooldown) — skipped');
  }

  // ai owner: local confirm + switch are read-only.
  await clickText('PauseScene', 'BACK');
  await clickText('PauseScene', 'BACK');
  await clickText('PauseScene', 'AI CONTROL');
  await page.waitForTimeout(400);
  await clickText('PauseScene', 'ECHO COMPANION');
  await clickText('PauseScene', 'LOCAL COOPERATION');
  await page.waitForTimeout(400);
  const aiOwner = await state();
  await snap('demo02-ai-owner-readonly-1280x720.png');
  say(`AI OWNER: owner=${aiOwner.owner} switchEnabled=${aiOwner.localSwitchEnabled} confirmEnabled=${aiOwner.localConfirmEnabled}`);
  await page.evaluate(() => window.__game.scene.getScene('GameScene').toggleAiControl());

  const ok = initial.echo === null && initial.companionLink === false && initial.companionStatus === 'OFF' &&
    enabled.echo !== null && proposalState.proposal?.kind === 'scan' && proposalState.proposal?.provenance === 'local-echo' &&
    proposalState.echoCooperation === false && proposalState.localConfirmEnabled === true &&
    after.evidence !== null && after.evidence > 0 && after.playerEnergy === 100 &&
    after.echoEnergy !== null && after.echoEnergy < 100 && after.companionLink === false && after.companionStatus === 'OFF' &&
    switchedOn.echoCooperation === true && switchedOn.saveEchoCoop === true &&
    switchedOff.echoCooperation === false && switchedOff.saveEchoCoop === false &&
    aiOwner.owner === 'ai' && aiOwner.localSwitchEnabled === false && aiOwner.localConfirmEnabled === false &&
    errors.length === 0;
  say(`RESULT: ${ok ? 'PASS' : 'FAIL'} (fixture/agent-driven; not human acceptance)`);
  fs.writeFileSync(path.join(OUT, 'demo02.json'), JSON.stringify({ ok, initial, enabled, proposalState, proposalText, confirmedPaused, after, auditPage, switchedOn, switchedOff, aiOwner, errors }, null, 2));
  fs.writeFileSync(path.join(OUT, 'demo02.log'), lines.join('\n') + '\n');
  process.exit(ok ? 0 : 1);
} catch (e) {
  say(`ERROR: ${String(e).split('\n')[0]}`);
  say(`PAGE ERRORS: ${errors.slice(0, 3).join(' | ')}`);
  fs.writeFileSync(path.join(OUT, 'demo02.log'), lines.join('\n') + '\n');
  await browser.close();
  process.exit(1);
}
await browser.close();
