import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const events = [];
page.on('console', (m) => events.push(`console.${m.type()}: ${m.text().slice(0, 200)}`));
page.on('pageerror', (e) => events.push(`pageerror: ${e.message}`));
page.on('load', () => events.push('page:load'));
page.on('framenavigated', (f) => { if (f === page.mainFrame()) events.push(`nav: ${f.url()}`); });
await page.goto(url);
await page.waitForFunction(() => !!(window).__game, { timeout: 10000 });
const first = await page.evaluate(() => ({ has: !!(window).__game, keys: Object.keys(window).filter((k) => k === '__game') }));
await page.waitForTimeout(1500);
const second = await page.evaluate(() => ({ has: !!(window).__game, type: typeof (window).__game }));
console.log(JSON.stringify({ url, first, second, events }, null, 2));
await browser.close();
