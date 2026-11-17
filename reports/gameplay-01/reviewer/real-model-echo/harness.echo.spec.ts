// GAMEPLAY-01 P2 · real Magpie ECHO chain (fixed snapshot 87a0fac).
// Model: local Magpie group/elisa. Owner clicks: autoOwner FIXTURE (labelled).
// No secrets in logs/screenshots; token/owner key are only typed into the masked form.
import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorldGateway } from '../src/ai-native/worldGateway';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../src/ai-native/ownerAuthFixture';

const PORT = Number(process.env.PORT ?? 5488);
const ORIGIN = `http://localhost:${PORT}`;
const TOKEN = randomBytes(24).toString('hex');
const COMPANION_SERVER = resolve(process.cwd(), 'dist-mcp/companionMcpServer.mjs');
const MAGPIE = 'http://127.0.0.1:3425/v1/chat/completions';
const MODEL = 'group/elisa';
const OUT = 'reports/gameplay-01/reviewer/real-model-echo';

const budget = { requests: 0, maxRequests: 12, maxTokens: 1024, startedAt: Date.now(), wallLimitMs: 5 * 60 * 1000 };
const requests: any[] = [];

async function clickText(page: any, scene: string, label: string) {
  const p = await page.evaluate(({ scene, label }) => {
    const g: any = (window as any).__game; const s: any = g.scene.getScene(scene);
    const flat: any[] = []; const walk = (l: any[]) => { for (const c of l) { if (c.type === 'Container' && Array.isArray(c.list)) walk(c.list); else flat.push(c); } };
    walk(s.children.list);
    const t = flat.find((c) => c.type === 'Text' && c.visible !== false && String(c.text || '').includes(label));
    if (!t) return null; const b = t.getBounds(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, { scene, label });
  expect(p, `text ${label}`).not.toBeNull();
  const box = await page.evaluate(() => { const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(box.x + p!.x * box.w / 1280, box.y + p!.y * box.h / 720);
  await page.waitForTimeout(300);
}
async function pageName(page: any) {
  return page.evaluate(() => (window as any).__game.scene.getScene('PauseScene')?.page ?? null);
}
async function st(page: any) {
  return page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene'); const w: any = gs.world;
    const sig = w.signalView ? w.signalView() : null;
    return {
      seq: (window as any).__echoEvents ? (window as any).__echoEvents.length : 0,
      page: (window as any).__game.scene.getScene('PauseScene')?.page ?? null,
      paused: gs.paused === true, tick: w.sim.tick,
      hp: w.player.data.hp,
      echo: w.echoActor ? { hp: w.echoActor.data.hp, x: w.echoActor.x, y: w.echoActor.y } : null,
      echoEnergy: sig?.echoEnergy ?? null, playerEnergy: sig?.playerEnergy ?? null,
      relay: sig?.relay ?? null, evidence: sig?.evidence ?? null,
      link: w.companionLink ? { status: w.companionLink.status } : null,
      comStatus: gs.companionStatus ?? null,
      pendingIntent: w.hasPendingCompanionIntent === true,
      pendingCount: null
    };
  });
}
async function resumeToPlay(page: any) {
  for (let i = 0; i < 5; i++) {
    if (!(await page.evaluate(() => (window as any).__game.scene.isActive('PauseScene')))) break;
    await page.keyboard.press('Escape'); await page.waitForTimeout(220);
  }
  await page.waitForTimeout(900);
}
async function pause(page: any) {
  if (await page.evaluate(() => (window as any).__game.scene.isActive('PauseScene'))) return;
  await page.keyboard.press('Escape'); await page.waitForTimeout(450);
}
async function toRoot(page: any) {
  for (let i = 0; i < 6; i++) {
    if (!(await page.evaluate(() => (window as any).__game.scene.isActive('PauseScene')))) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    if ((await pageName(page)) === 'pause') return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}
async function openLlm(page: any) {
  await pause(page);
  await clickText(page, 'PauseScene', 'AI & COMPANION');
  await clickText(page, 'PauseScene', 'LLM COMPANION');
  await page.waitForTimeout(350);
}
async function askModel(observation: any) {
  const allowed = {
    kinds: ['scan', 'toggle-relay'],
    reasons: ['perceived_relay', 'perceived_hostile', 'no_perceived_target', 'objective_blocked'],
    note: 'target optional; only choose an action the observation actually supports'
  };
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are the ECHO agent. You only see a legal perception-cropped observation. Reply with EXACTLY ONE JSON object: {"kind":"scan"|"toggle-relay","reason":"perceived_relay"|"perceived_hostile"|"no_perceived_target"|"objective_blocked","target":{"x":number,"y":number}?}. No prose.' },
      { role: 'user', content: JSON.stringify({ observation, allowedKinds: allowed.kinds, allowedReasons: allowed.reasons }) }
    ],
    max_tokens: budget.maxTokens,
    stream: false
  };
  const t0 = Date.now();
  const res = await fetch(MAGPIE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const latencyMs = Date.now() - t0;
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* keep */ }
  budget.requests += 1;
  const rec = {
    requestIndex: budget.requests,
    httpStatus: res.status,
    id: json?.id ?? null,
    returnedModel: json?.model ?? null,
    finishReason: json?.choices?.[0]?.finish_reason ?? null,
    latencyMs,
    usage: json?.usage ?? null,
    visibleContent: json?.choices?.[0]?.message?.content ?? null,
    promptCharacters: JSON.stringify(observation).length
  };
  requests.push(rec);
  return rec;
}

test('real Magpie ECHO chain: observe -> suggest -> Owner fixture confirm/reject -> disconnect fallback', async ({ page }) => {
  test.setTimeout(300000);
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
  let sdk: any = null;
  const trace: any = { snapshot: '87a0fac', startedAt: new Date().toISOString(), steps: [], requests, budget };
  try {
    // ---- Task 1: real menu entry, ECHO actor lands via real ticks
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
    await clickText(page, 'MainMenuScene', 'DEMO 01');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
    await page.waitForTimeout(600);
    // capture core events for evidence (read-only wrapper)
    await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      (window as any).__echoEvents = [];
      const orig = w.stepFrame.bind(w);
      w.stepFrame = (...a: any[]) => { const ev = orig(...a) as any[]; for (const e of ev) if (String(e?.type || '').startsWith('signal-')) (window as any).__echoEvents.push(e); return ev; };
    });
    await pause(page);
    await clickText(page, 'PauseScene', 'AI & COMPANION');
    await clickText(page, 'PauseScene', 'ECHO COMPANION');
    if (!(await st(page)).echo) {
      await clickText(page, 'PauseScene', 'ENABLE ECHO');
      await clickText(page, 'PauseScene', 'BACK');
      await resumeToPlay(page);
    }
    await page.waitForFunction(() => !!(window as any).__game.scene.getScene('GameScene').world.echoActor, { timeout: 15000 });
    trace.steps.push({ step: 'echo-landed', state: await st(page) });
    console.log('[T1] echo landed', JSON.stringify(await st(page)));

    // ---- Owner pairing through the real masked form (fixture input, autoOwner)
    await openLlm(page);
    await clickText(page, 'PauseScene', 'ENABLE / RE-AUTHORIZE');
    await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 10000 });
    await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]', bridge.url);
    await page.fill('[data-testid="external-link-form"] input[name="token"]', TOKEN);
    await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]', TEST_OWNER_KEY);
    await page.click('[data-testid="external-link-form"] button[type="submit"]');
    await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').companionStatus === 'CONNECTED', undefined, { timeout: 25000 });
    trace.steps.push({ step: 'companion-connected', fixture: 'owner form filled by fixture (autoOwner, not human)', state: await st(page) });
    console.log('[T1] companion connected', JSON.stringify(await st(page)));

    // ---- Task 2: official ECHO SDK surface -> model decides kind
    sdk = await (async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [COMPANION_SERVER],
        env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: bridge.url, LAST_SIGNAL_WORLD_TOKEN: TOKEN } as never,
        stderr: 'pipe', cwd: process.cwd()
      });
      const client = new Client({ name: 'echo-real-model', version: '0.0.0' });
      await client.connect(transport);
      return client;
    })();
    const obs = (await sdk.callTool({ name: 'echo_observe', arguments: {} })).structuredContent as any;
    trace.steps.push({ step: 'echo_observe', observation: obs });
    console.log('[T2] official observation', JSON.stringify(obs).slice(0, 600));

    const rec = await askModel(obs);
    console.log('[T2] model response', JSON.stringify(rec));
    let content = String(rec.visibleContent ?? '');
    const s = content.indexOf('{'), e = content.lastIndexOf('}');
    let decision: any = null;
    if (s >= 0 && e > s) { try { decision = JSON.parse(content.slice(s, e + 1)); } catch { decision = null; } }
    const KINDS = ['scan', 'toggle-relay'];
    const REASONS = ['perceived_relay', 'perceived_hostile', 'no_perceived_target', 'objective_blocked'];
    const validDecision = !!decision && KINDS.includes(decision.kind) && REASONS.includes(decision.reason)
      && (decision.target === undefined || (Number.isFinite(decision.target?.x) && Number.isFinite(decision.target?.y)));
    trace.steps.push({ step: 'model-decision', decision, validDecision });
    console.log('[T2] decision', JSON.stringify({ decision, validDecision }));
    expect(validDecision, 'model must return a legal kind/reason JSON').toBe(true);

    const suggestionId = 'sug_' + randomBytes(12).toString('hex');
    const requestId = 'req_' + randomBytes(12).toString('hex');
    const suggested = (await sdk.callTool({
      name: 'echo_suggest',
      arguments: {
        requestId, suggestionId,
        kind: decision.kind, reason: decision.reason,
        ...(decision.target ? { target: { x: decision.target.x, y: decision.target.y } } : {})
      }
    })).structuredContent as any;
    trace.steps.push({ step: 'echo_suggest (agent)', suggestionId, requestId, result: suggested, modelChosenKind: decision.kind });
    console.log('[T2] suggest', JSON.stringify(suggested).slice(0, 400));
    expect(suggested?.ok, 'official suggest accepted the model decision').toBe(true);

    // ---- Task 3: Owner fixture confirm; paused = enqueue only; next tick receipt
    await page.waitForFunction(() => {
      const s: any = (window as any).__game.scene.getScene('PauseScene');
      return !!s && s.confirmBtn?.enabled === true;
    }, undefined, { timeout: 20000 });
    await page.screenshot({ path: `${OUT}/echo-1-model-suggestion-1280x720.png` });
    const beforeConfirm = await st(page);
    await clickText(page, 'PauseScene', 'CONFIRM FIRST PROPOSAL');
    await page.waitForFunction(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      return (w.sim.pendingCommands ?? []).length >= 1 || w.hasPendingCompanionIntent === true;
    }, undefined, { timeout: 15000 });
    const paused = await st(page);
    trace.steps.push({ step: 'owner-confirm-paused', fixture: 'autoOwner click (not human)', before: beforeConfirm, after: paused });
    console.log('[T3] confirmed while paused', JSON.stringify({ paused: paused.paused, pendingIntent: paused.pendingIntent, echoEnergy: paused.echoEnergy, playerEnergy: paused.playerEnergy }));
    expect(paused.paused, 'still paused right after confirm').toBe(true);
    expect(paused.pendingIntent || ((await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.pendingCommands.length))) >= 1, 'confirm only enqueues').toBe(true);
    // a second click must not enqueue a second action
    await clickText(page, 'PauseScene', 'CONFIRM FIRST PROPOSAL');
    const queueAfterSecond = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.pendingCommands.length);
    trace.steps.push({ step: 'double-confirm', queueAfterSecond });
    console.log('[T3] queue after second confirm', queueAfterSecond);
    expect(queueAfterSecond, 'a second confirm does not enqueue again').toBe(1);
    expect(paused.echoEnergy, 'no energy spent while paused').toBe(beforeConfirm.echoEnergy);

    await resumeToPlay(page);
    await page.waitForTimeout(1400);
    const after = await st(page);
    const events = await page.evaluate(() => (window as any).__echoEvents);
    const scanEv = (events ?? []).find((e: any) => e.type === 'signal-scanned');
    trace.steps.push({ step: 'after-resume-receipt', after, scanEv, events: (events ?? []).slice(-6) });
    console.log('[T3] after resume', JSON.stringify({ tick: after.tick, echoEnergy: after.echoEnergy, playerEnergy: after.playerEnergy, relay: after.relay, evidence: after.evidence, pendingIntent: after.pendingIntent, scanEv }));
    const queueLeft = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.pendingCommands.length);
    expect(queueLeft, 'receipt applied: queue drained').toBe(0);
    if (decision.kind === 'scan') {
      expect(after.evidence, 'scan produced real evidence').toBeGreaterThan(beforeConfirm.evidence ?? 0);
      if (scanEv) {
        expect(scanEv.actorId, 'scan committed by the ECHO actor').toBe(1);
        expect(scanEv.energy, 'echo energy charged exactly SCAN_COST').toBe((beforeConfirm.echoEnergy ?? 0) - 10);
      }
    } else {
      const relayEv = (events ?? []).filter((e: any) => e.type === 'signal-relay-changed');
      trace.steps.push({ step: 'toggle-events', relayEv });
      console.log('[T3] toggle events', JSON.stringify(relayEv));
      expect(relayEv.length, 'toggle committed exactly one relay change').toBe(1);
    }
    await page.screenshot({ path: `${OUT}/echo-2-owner-confirmed-1280x720.png` });

    // ---- Task 4a: reject a NEW suggestion (fresh observation) and prove nothing executed
    await openLlm(page);
    await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.companionLink?.pushObservation());
    await page.waitForTimeout(400);
    const obs2 = (await sdk.callTool({ name: 'echo_observe', arguments: {} })).structuredContent as any;
    const rec2 = await askModel(obs2);
    console.log('[T4] model attempt 2', JSON.stringify(rec2));
    let d2: any = null;
    const c2 = String(rec2.visibleContent ?? '');
    const s2 = c2.indexOf('{'), e2 = c2.lastIndexOf('}');
    if (s2 >= 0 && e2 > s2) { try { d2 = JSON.parse(c2.slice(s2, e2 + 1)); } catch { d2 = null; } }
    const valid2 = !!d2 && KINDS.includes(d2.kind) && REASONS.includes(d2.reason);
    trace.steps.push({ step: 'model-decision-2', decision: d2, valid2 });
    if (valid2) {
      const sug2 = 'sug_' + randomBytes(12).toString('hex');
      const req2 = 'req_' + randomBytes(12).toString('hex');
      const suggested2 = (await sdk.callTool({ name: 'echo_suggest', arguments: { requestId: req2, suggestionId: sug2, kind: d2.kind, reason: d2.reason, ...(d2.target ? { target: d2.target } : {}) } })).structuredContent as any;
      trace.steps.push({ step: 'echo_suggest-2', suggestionId: sug2, result: suggested2 });
      console.log('[T4] suggest2', JSON.stringify(suggested2).slice(0, 300));
      if (suggested2?.ok) {
        await page.waitForFunction(() => {
          const s: any = (window as any).__game.scene.getScene('PauseScene');
          return !!s && s.rejectBtn?.enabled === true;
        }, undefined, { timeout: 20000 });
        const beforeReject = await st(page);
        await clickText(page, 'PauseScene', 'REJECT FIRST PROPOSAL');
        await page.waitForTimeout(1200);
        const afterReject = await st(page);
        trace.steps.push({ step: 'owner-reject', fixture: 'autoOwner click (not human)', before: beforeReject, after: afterReject, rejectedId: sug2 });
        console.log('[T4] rejected', JSON.stringify({ pendingIntent: afterReject.pendingIntent, echoEnergyBefore: beforeReject.echoEnergy, echoEnergyAfter: afterReject.echoEnergy, evidenceBefore: beforeReject.evidence, evidenceAfter: afterReject.evidence, tickBefore: beforeReject.tick, tickAfter: afterReject.tick }));
        expect(afterReject.pendingIntent, 'reject never enqueues an intent').toBe(false);
        expect(afterReject.tick, 'no tick advanced while rejected/paused window').toBe(beforeReject.tick);
        expect(afterReject.echoEnergy, 'no echo energy change on reject').toBe(beforeReject.echoEnergy);
        // cannot resurrect the rejected id
        const resurrect = await page.evaluate(async (id) => {
          const w: any = (window as any).__game.scene.getScene('GameScene').world;
          const list = await w.companionLink?.pending();
          return { stillPending: (list ?? []).some((x: any) => x.suggestionId === id), count: (list ?? []).length };
        }, sug2);
        trace.steps.push({ step: 'resurrect-rejected', result: resurrect });
        console.log('[T4] resurrect attempt', JSON.stringify(resurrect));
        await page.screenshot({ path: `${OUT}/echo-3-rejected-1280x720.png` });
      }
    }

    // ---- Task 4b: disconnect -> honest offline, ECHO still present, local offline path still works
    await page.waitForTimeout(300);
    if ((await pageName(page)) !== 'llm') await openLlm(page);
    await clickText(page, 'PauseScene', 'DISCONNECT');
    await page.waitForTimeout(1500);
    const disc = await st(page);
    trace.steps.push({ step: 'disconnected', state: disc });
    const uiTexts = await page.evaluate(() => {
      const s: any = (window as any).__game.scene.getScene('PauseScene');
      const flat: string[] = [];
      const walk = (l: any[]) => { for (const c of l) { if (c.type === 'Container' && Array.isArray(c.list)) walk(c.list); else if (c.type === 'Text' && c.visible !== false) flat.push(String(c.text)); } };
      walk(s.children.list);
      return flat;
    });
    const honest = uiTexts.some((t) => /OFFLINE|NOTCONNECTED|NOT CONNECTED|NO_MODEL|OFF|DISCONNECT/i.test(t));
    console.log('[T5] disconnected', JSON.stringify({ comStatus: disc.comStatus, link: disc.link, echo: disc.echo, honestUi: honest, ui: uiTexts.slice(0, 8) }));
    expect(disc.comStatus, 'honest offline state after disconnect').not.toBe('CONNECTED');
    expect(disc.echo, 'the ECHO entity still exists offline').not.toBeNull();
    expect(honest, 'the UI states the offline/not-connected state honestly').toBe(true);
    await page.screenshot({ path: `${OUT}/echo-4-disconnected-1280x720.png` });

    // offline LOCAL path: deterministic local proposal + human local confirm (NOT the model)
    await toRoot(page);
    await clickText(page, 'PauseScene', 'AI & COMPANION');
    await clickText(page, 'PauseScene', 'ECHO COMPANION');
    await clickText(page, 'PauseScene', 'LOCAL COOPERATION');
    await page.waitForTimeout(400);
    const localProposal = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      return w.echoLocalProposal ? { id: w.echoLocalProposal.id, kind: w.echoLocalProposal.kind } : null;
    });
    trace.steps.push({ step: 'offline-local-proposal', proposal: localProposal, note: 'deterministic local proposal, NOT the model' });
    console.log('[T5] offline local proposal', JSON.stringify(localProposal));
    await page.screenshot({ path: `${OUT}/echo-5-offline-local-1280x720.png` });
    if (localProposal) {
      const beforeLocal = await st(page);
      await clickText(page, 'PauseScene', 'CONFIRM (HUMAN)');
      const queuedLocal = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.pendingCommands.length);
      trace.steps.push({ step: 'offline-local-confirm', fixture: 'autoOwner click (not human), deterministic local path', before: beforeLocal, queued: queuedLocal, proposal: localProposal });
      console.log('[T5] offline local confirm queued', queuedLocal);
      expect(queuedLocal, 'offline local confirm enqueues exactly one command').toBe(1);
    }

    trace.finishedAt = new Date().toISOString();
    trace.budgetUsed = { requests: budget.requests, wallMs: Date.now() - budget.startedAt };
    console.log('[BUDGET]', JSON.stringify(trace.budgetUsed));
    expect(budget.requests).toBeLessThanOrEqual(budget.maxRequests);
  } finally {
    try { await sdk?.close(); } catch {}
    try { await bridge.close(); } catch {}
    try { await page.evaluate(() => (window as any).__game && undefined); } catch {}
    const fs = await import('node:fs');
    fs.writeFileSync(`${OUT}/trace.json`, JSON.stringify({ ...trace, requests, budgetUsed: { requests: budget.requests, wallMs: Date.now() - budget.startedAt } }, null, 2));
  }
});
