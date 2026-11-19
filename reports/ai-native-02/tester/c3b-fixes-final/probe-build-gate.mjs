// F-03 build gate: production AND any custom mode (staging) must not expose the
// game handle; only dev server and --mode test keep it. Screenshots included.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = { checks: [], pages: {} };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const dir = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-fixes-final/evidence-build';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
for (const [label, url] of [['prod', 'http://localhost:5302/'], ['test', 'http://localhost:5303/'], ['staging', 'http://localhost:5304/'], ['dev', 'http://localhost:5301/']]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2400);
  const st = await page.evaluate(() => ({ hasGame: typeof window.__game !== 'undefined', canvas: !!document.querySelector('canvas') }));
  await page.screenshot({ path: `${dir}/${label}-menu.png` });
  out.pages[label] = { url, st, errs };
  if (label === 'prod') check('prod-no-game-handle', st.hasGame === false, st);
  if (label === 'staging') check('staging-no-game-handle', st.hasGame === false, st);
  if (label === 'test') check('test-has-game-handle', st.hasGame === true, st);
  if (label === 'dev') check('dev-has-game-handle', st.hasGame === true, st);
  check(`${label}-boots-canvas`, st.canvas === true, st);
  await page.close();
}
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3b-fixes-final/build-gate.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.checks, null, 2));
await browser.close();
