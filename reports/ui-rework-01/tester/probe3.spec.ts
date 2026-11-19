import { test } from '@playwright/test';
import { boot, clickText, press } from './probe-helpers';

async function pageName(page: any) {
  return page.evaluate(() => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    return g.scene.isActive('PauseScene') ? (s.page ?? '?') : 'none';
  });
}

test('llm form step by step', async ({ page }) => {
  const log: string[] = [];
  const note = async (tag: string) => log.push(`${tag}=${await pageName(page)}`);
  await boot(page);
  await press(page, 'Escape'); await note('pause');
  await clickText(page, 'PauseScene', 'AI & COMPANION'); await page.waitForTimeout(400); await note('ai');
  await clickText(page, 'PauseScene', 'LLM COMPANION'); await page.waitForTimeout(400); await note('llm');
  await clickText(page, 'PauseScene', 'CONFIRM FIRST PROPOSAL'); await page.waitForTimeout(300); await note('after-confirm');
  await clickText(page, 'PauseScene', 'REJECT FIRST PROPOSAL'); await page.waitForTimeout(300); await note('after-reject');
  await clickText(page, 'PauseScene', 'DISCONNECT'); await page.waitForTimeout(300); await note('after-disconnect');
  await clickText(page, 'PauseScene', 'ENABLE / RE-AUTHORIZE'); await page.waitForTimeout(600); await note('form-open');
  const hasForm = async () => page.evaluate(() => !!document.querySelector('[data-testid="external-link-form"]'));
  log.push(`form=${await hasForm()}`);
  await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]', 'http://127.0.0.1:9'); await note('after-fill-url');
  await page.fill('[data-testid="external-link-form"] input[name="token"]', 'e2e-token-0123456789abcdef'); await note('after-fill-token');
  await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]', 'a'.repeat(64)); await note('after-fill-owner');
  log.push(`form2=${await hasForm()}`);
  await page.click('[data-testid="external-link-form"] button[type="submit"]');
  await page.waitForTimeout(300); await note('after-submit-300ms'); log.push(`form3=${await hasForm()}`);
  await page.waitForTimeout(1500); await note('after-submit-1800ms'); log.push(`form4=${await hasForm()}`);
  const status = await page.evaluate(() => document.querySelector('[data-testid="external-link-status"]')?.textContent ?? null);
  log.push(`status=${status}`);
  console.log('STEPS ' + log.join(' | '));
});
