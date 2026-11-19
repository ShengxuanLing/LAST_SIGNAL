/** Independent production three-entry preview smoke on my OWN port 5414. */
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 5414;
let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const server: ChildProcess = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'
], { stdio: 'ignore' });
async function main(): Promise<void> {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) { ready = true; break; } } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  check('production preview started on own port', ready);
  if (!ready) throw new Error('preview did not start');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [path, needle] of [['/', '#game'], ['/economy.html', '#supply-dialog'], ['/station-zero.html', '#game']] as const) {
    await page.goto(`http://127.0.0.1:${PORT}${path}`);
    await page.waitForTimeout(700);
    const r = await page.evaluate((sel) => ({
      hasGame: typeof (window as any).__game !== 'undefined',
      hasDom: !!document.querySelector(sel),
      hasExternalLinkConfig: typeof (window as any).__externalLinkConfig !== 'undefined',
      title: document.title
    }), needle);
    check(`prod ${path}: NO __game`, !r.hasGame);
    check(`prod ${path}: real DOM ${needle}`, r.hasDom, r);
    check(`prod ${path}: no leaked __externalLinkConfig`, !r.hasExternalLinkConfig);
  }
  await browser.close();
  check('no production page errors', errors.length === 0, { errors });
  console.log(`PREVIEW_3ENTRY_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
}
main().catch((e) => { console.log('FAIL exception', String(e)); process.exitCode = 1; }).finally(() => { server.kill('SIGKILL'); });
