// F-03 build gate, independent: production bundle must expose no game handle;
// `--mode test` bundle must expose it and boot. Screenshots are evidence.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = { checks: [], pages: {}, errors: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const dir = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-final/evidence-build';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });

for (const [label, url] of [['prod', 'http://localhost:5297/'], ['test', 'http://localhost:5298/']]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => ({
    hasGame: typeof window.__game !== 'undefined',
    hasExternalConfig: typeof window.__externalLinkConfig !== 'undefined',
    canvas: !!document.querySelector('canvas'),
    bodyText: (document.body.innerText || '').slice(0, 200)
  }));
  await page.screenshot({ path: `${dir}/${label}-menu.png` });
  out.pages[label] = { url, state, errs };
  if (label === 'prod') {
    check('prod-no-__game', state.hasGame === false, state);
    check('prod-no-console-error', errs.length === 0, errs);
  } else {
    check('test-has-__game', state.hasGame === true, state);
    const active = await page.evaluate(() => window.__game?.scene?.isActive('MainMenuScene') ?? null);
    check('test-boots', active === true, { active });
    const devOnly = await page.evaluate(() => { try { window.__game.scene.getScene('GameScene').world?.stepSimulationTicksForTest?.(0, {}); return 'no-throw'; } catch (e) { return String(e.message); } });
    out.pages.test.devOnly = devOnly;
  }
  await page.close();
}
check('prod-bundle-keeps-token-out-of-dom', !/token=/i.test(out.pages.prod.state.bodyText), out.pages.prod.state.bodyText);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-final/build-gate.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
