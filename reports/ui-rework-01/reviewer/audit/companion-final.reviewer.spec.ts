// UI-REWORK-01 · reviewer-only companion evidence (read-only w.r.t. src/tests).
//
// Proves, against a REAL loopback bridge and the REAL masked Owner form:
//  - B3: the rendered first row (▶) is bound to its suggestionId; CONFIRM/REJECT
//        act on that id only, and a stale id is refused instead of silently
//        switching to a different pending[0];
//  - B4: focus is not stolen while a pending proposal exists (periodic refresh);
//  - B1/R8: "ENABLE / RE-AUTHORIZE" on a LIVE link reaches the atomic
//        re-authorize path (same CompanionLink, old pending cancelled) and never
//        builds a second link;
//  - honest degradation: a wrong Owner key ends in the real FALLBACK state and
//        the UI reports that state instead of claiming "unchanged".
//
// The Owner capability lives in ECMAScript #private fields and is never read,
// logged or screenshot-captured here.
import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { WorldGateway } from '../../../../src/ai-native/worldGateway';
import { startWorldBridge } from '../../../../src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../../../../src/ai-native/ownerAuthFixture';

const PORT = Number(process.env.PORT ?? 5466);
const ORIGIN = `http://localhost:${PORT}`;
const TOKEN = randomBytes(24).toString('hex');
const OUT = 'reports/ui-rework-01/reviewer/audit';

const FLAT = `(s) => {
  const out = [];
  const walk = (list) => { for (const c of list) { if (c.type === 'Container' && Array.isArray(c.list)) { walk(c.list); continue; } out.push(c); } };
  walk(s.children.list);
  return out;
}`;

async function toCss(page: any, lx: number, ly: number) {
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const r = c!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  return { x: box.x + (lx * box.w) / 1280, y: box.y + (ly * box.h) / 720 };
}

async function clickText(page: any, label: string): Promise<void> {
  const logical = await page.evaluate(({ label, flatSrc }) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    if (!s || !g.scene.isActive('PauseScene')) return null;
    const flat = eval(flatSrc)(s);
    const cands = flat.filter((c: any) => c.type === 'Text' && c.visible !== false && String(c.text || '').includes(label));
    if (!cands.length) return null;
    const hit = cands.find((c: any) => c.input && c.input.enabled !== false) || cands[0];
    return { x: hit.x, y: hit.y };
  }, { label, flatSrc: FLAT });
  expect(logical, `visible text "${label}"`).not.toBeNull();
  const p = await toCss(page, logical!.x, logical!.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(320);
}

async function openPause(page: any): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'), { timeout: 12000 });
  await page.waitForTimeout(420);
}

async function bootRun(page: any): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(400);
  const newRun = await page.evaluate((flatSrc) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('MainMenuScene');
    const flat = eval(flatSrc)(s);
    const t = flat.find((c: any) => c.type === 'Text' && c.visible !== false && String(c.text || '').trim().startsWith('NEW RUN'));
    return t ? { x: t.x, y: t.y } : null;
  }, FLAT);
  expect(newRun).not.toBeNull();
  const p = await toCss(page, newRun!.x, newRun!.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 12000 });
  await page.waitForTimeout(900);
}

async function llmPage(page: any): Promise<void> {
  await clickText(page, 'AI & COMPANION');
  await clickText(page, 'LLM COMPANION');
}

async function fillOwnerForm(page: any, bridgeUrl: string, ownerKey: string): Promise<void> {
  await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 12000 });
  await page.fill('input[name="bridgeUrl"]', bridgeUrl);
  await page.fill('input[name="token"]', TOKEN);
  await page.fill('input[name="ownerKey"]', ownerKey);
  await page.click('[data-testid="external-link-form"] button[type="submit"]');
}

async function focusState(page: any) {
  return page.evaluate((flatSrc) => {
    const s = window.__game.scene.getScene('PauseScene');
    const flat = eval(flatSrc)(s);
    const focused = flat.filter((c: any) => c.type === 'Rectangle' && c.visible !== false && c.lineWidth === 3 && c.strokeColor === 16777215)
      .map((c: any) => `${Math.round(c.x)},${Math.round(c.y)}`);
    const llmText = s.llmPending ? String(s.llmPending.text) : null;
    return { focused, selected: s.selectedSuggestionId ?? null, llmText, decideEnabled: s.decideEnabled };
  }, FLAT);
}

test.describe('UI-REWORK-01 final companion evidence', () => {
  test('pending id binding, no focus steal, real reauth, honest fallback', async ({ page }) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    const gateway = new WorldGateway();
    const bridge = await startWorldBridge({
      gateway, token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH,
      allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
    });
    const suggest = async (id: string, session: string, epoch: number) => {
      const r = await fetch(`${bridge.url}/world-link/companion-suggest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          session, epoch, requestId: `req_${id.slice(4)}`, suggestionId: id,
          kind: 'move', reason: 'perceived_hostile'
        })
      });
      const body = await r.json().catch(() => null);
      return { status: r.status, body };
    };
    const linkState = async () => page.evaluate(() => {
      const l = (window as any).__game.scene.getScene('GameScene').companionLink;
      const s = (window as any).__game.scene.getScene('PauseScene');
      return {
        session: l ? l.session : null, epoch: l ? l.epoch : null, status: l ? l.status : 'OFF',
        state: s?.llmState ? String(s.llmState.text) : null,
        notice: s?.llmNotice ? String(s.llmNotice.text) : null,
        formStatus: document.querySelector('[data-testid="external-link-status"]')?.textContent ?? null
      };
    });

    try {
      await bootRun(page);
      // echo + a drone inside its perception so the observation really shows a hostile
      await page.evaluate(() => { (window as any).__game.scene.getScene('GameScene').world.enableEcho(); });
      await page.waitForFunction(() => !!(window as any).__game.scene.getScene('GameScene').world.echoActor);
      await page.evaluate(() => {
        const w = (window as any).__game.scene.getScene('GameScene').world;
        const e = w.echoActor;
        w.spawnEnemy('drone', e.x + 1, e.y, w.currentRoom()?.id ?? 0, 1);
      });
      await page.waitForTimeout(350);

      await openPause(page);
      await llmPage(page);
      await clickText(page, 'ENABLE / RE-AUTHORIZE');
      await fillOwnerForm(page, bridge.url, TEST_OWNER_KEY);
      await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').companionStatus === 'CONNECTED', { timeout: 25000 });
      const connected = await linkState();
      expect(connected.status).toBe('CONNECTED');
      console.log('[evidence] authorized', JSON.stringify({ status: connected.status, session: connected.session, epoch: connected.epoch }));
      await page.screenshot({ path: `${OUT}/companion-connected.png` });

      // ---- B3: two real suggestions; the ▶ row must be bound to its id
      const A = 'sug_' + 'a'.repeat(24);
      const B = 'sug_' + 'b'.repeat(24);
      const sa = await suggest(A, connected.session!, connected.epoch!);
      expect(sa.status, JSON.stringify(sa.body)).toBe(200);
      const sb = await suggest(B, connected.session!, connected.epoch!);
      expect(sb.status, JSON.stringify(sb.body)).toBe(200);

      await page.waitForFunction(() => !!(window as any).__game.scene.getScene('PauseScene').selectedSuggestionId, { timeout: 20000 });
      const shown = await focusState(page);
      console.log('[evidence] pending rendered', JSON.stringify({ selected: shown.selected, lines: shown.llmText }));
      expect(shown.selected).toBe(A);
      expect(shown.llmText!.split('\n')[0].startsWith('▶')).toBe(true);
      expect(shown.llmText!).toContain('MOVE');
      expect(shown.decideEnabled).toBe(true);
      await page.screenshot({ path: `${OUT}/companion-pending.png` });

      // ---- B4: focus must not be stolen by the periodic refresh
      const focusBefore = await focusState(page);
      await page.waitForTimeout(3200);
      const focusAfter = await focusState(page);
      console.log('[evidence] focus with pending', JSON.stringify({ before: focusBefore.focused, after: focusAfter.focused }));
      expect(focusAfter.focused, 'focus must not move while a proposal is pending').toEqual(focusBefore.focused);
      expect(focusAfter.focused.length).toBe(1);
      const confirmCenter = await page.evaluate(() => {
        const s: any = (window as any).__game.scene.getScene('PauseScene');
        const b = (s.uiButtons || []).find((x: any) => String(x.label.text).startsWith('CONFIRM FIRST'));
        return b ? `${Math.round(b.rect.x)},${Math.round(b.rect.y)}` : null;
      });
      expect(focusAfter.focused[0], 'focus stays on the first control, not CONFIRM').not.toBe(confirmCenter);

      // ---- B3: CONFIRM acts on the ▶ id only → that row disappears, the other stays
      await clickText(page, 'CONFIRM FIRST PROPOSAL');
      await page.waitForTimeout(1600);
      const afterConfirm = await focusState(page);
      console.log('[evidence] after confirm', JSON.stringify({ selected: afterConfirm.selected, lines: afterConfirm.llmText }));
      expect(afterConfirm.selected, 'remaining ▶ row must be the OTHER suggestion').toBe(B);
      const rowsAfter = afterConfirm.llmText!.split('\n').filter((l) => l.includes('MOVE'));
      expect(rowsAfter.length, 'exactly one suggestion must remain (the unconfirmed one)').toBe(1);
      expect(afterConfirm.llmText!.startsWith('▶')).toBe(true);

      // ---- B3 guard: a stale id must be refused, never silently switched
      await page.evaluate(() => {
        const s: any = (window as any).__game.scene.getScene('PauseScene');
        s.selectedSuggestionId = 'sug_' + '0'.repeat(24);
        s.decide(true);
      });
      await page.waitForTimeout(1200);
      const guard = await focusState(page);
      const footerText = await page.evaluate(() => String((window as any).__game.scene.getScene('PauseScene').llmFooter?.text ?? ''));
      console.log('[evidence] stale-id guard', JSON.stringify({ footer: footerText, selected: guard.selected }));
      expect(footerText).toContain('PROPOSAL CHANGED OR EXPIRED');
      // nothing was decided: the real proposal is still listed and still pending
      expect(guard.llmText ?? '', 'the untouched proposal must still be listed').toContain('MOVE');
      // ...and the follow-up click fails CLOSED (it must never fall back to pending[0])
      await clickText(page, 'CONFIRM FIRST PROPOSAL');
      await page.waitForTimeout(1200);
      const afterStaleClick = await focusState(page);
      const footer2 = await page.evaluate(() => String((window as any).__game.scene.getScene('PauseScene').llmFooter?.text ?? ''));
      console.log('[evidence] stale-view follow-up', JSON.stringify({ footer: footer2, selected: afterStaleClick.selected, listed: afterStaleClick.llmText }));
      expect(afterStaleClick.llmText ?? '', 'a stale view must not confirm anything').toContain('MOVE');
      expect(footer2).toContain('NO SELECTED PROPOSAL');

      // ---- B1/R8: re-authorize a LIVE link must be the atomic swap on the SAME link
      const before = await page.evaluate(() => {
        const l: any = (window as any).__game.scene.getScene('GameScene').companionLink;
        l.__auditMark = 'same-object';
        return { mark: l.__auditMark, status: l.status };
      });
      expect(before.status).toBe('CONNECTED');
      await clickText(page, 'ENABLE / RE-AUTHORIZE');
      const title = await page.locator('[data-testid="external-link-form"] div').first().textContent();
      expect(title, 'live link must open the COMPANION pairing form').toContain('COMPANION');
      await fillOwnerForm(page, bridge.url, TEST_OWNER_KEY);
      await page.waitForFunction(() => {
        const gs: any = (window as any).__game.scene.getScene('GameScene');
        const s: any = (window as any).__game.scene.getScene('PauseScene');
        return s && !document.querySelector('[data-testid="external-link-form"]') && gs.companionLink && gs.companionLink.status === 'CONNECTED';
      }, { timeout: 25000 });
      await page.waitForTimeout(900);
      const afterReauth = await page.evaluate(() => {
        const l: any = (window as any).__game.scene.getScene('GameScene').companionLink;
        const s: any = (window as any).__game.scene.getScene('PauseScene');
        return { mark: l.__auditMark ?? null, status: l.status, selected: s.selectedSuggestionId, text: s.llmPending ? String(s.llmPending.text) : null };
      });
      console.log('[evidence] reauth (same key)', JSON.stringify({ mark: afterReauth.mark, status: afterReauth.status, text: afterReauth.text }));
      expect(afterReauth.mark, 're-authorize must keep the SAME CompanionLink (no second link)').toBe('same-object');
      expect(afterReauth.status).toBe('CONNECTED');
      expect(afterReauth.text, 'old pending suggestions must be cancelled by the re-authorize').toContain('No pending proposal');
      expect(afterReauth.selected).toBeNull();
      await page.screenshot({ path: `${OUT}/companion-reauthorized.png` });

      // the swapped capability still works: the renderer publishes a fresh
      // observation (as it does on pause) and the agent's suggestion is accepted
      const epochNow = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').companionLink.epoch);
      const C = 'sug_' + 'c'.repeat(24);
      let sc = await suggest(C, connected.session!, epochNow);
      for (let i = 0; i < 6 && sc.status !== 200; i++) {
        await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').companionLink.pushObservation());
        await page.waitForTimeout(700);
        sc = await suggest(C, connected.session!, epochNow);
      }
      console.log('[evidence] post-reauth suggest', JSON.stringify({ status: sc.status, body: sc.body }));
      expect(sc.status, JSON.stringify(sc.body)).toBe(200);
      await page.waitForFunction((id) => (window as any).__game.scene.getScene('PauseScene').selectedSuggestionId === id, C, { timeout: 20000 });

      // ---- honest fallback: a wrong Owner key must not be reported as "unchanged"
      await clickText(page, 'ENABLE / RE-AUTHORIZE');
      const wrongKey = 'b'.repeat(64);
      await fillOwnerForm(page, bridge.url, wrongKey);
      await page.waitForTimeout(2600);
      const failed = await linkState();
      console.log('[evidence] reauth (wrong key)', JSON.stringify({ status: failed.status, state: failed.state, notice: failed.notice, formStatus: failed.formStatus }));
      expect(failed.status, 'wrong key must degrade the real link, not keep it connected').not.toBe('CONNECTED');
      expect(failed.formStatus ?? '').toContain('RE-AUTH FAILED');
      expect(failed.formStatus ?? '').toMatch(/FALLBACK|READ_ONLY|OFF/);
      expect(failed.state ?? '').not.toContain('CONNECTED');
      await page.screenshot({ path: `${OUT}/companion-wrongkey.png` });

      // The intentional wrong-key probe makes the bridge answer 403, which the
      // browser logs as a failed resource load. That is the honest failure path,
      // not a UI defect: assert no OTHER console/page error happened.
      const unexpected = errors.filter((e) => !/403|Failed to load resource|owner_capability_required/.test(e));
      console.log('[evidence] console errors', JSON.stringify({ total: errors.length, unexpected }));
      expect(unexpected, unexpected.join(' | ')).toEqual([]);
    } finally {
      await bridge.close();
      gateway.dispose();
    }
  });
});
