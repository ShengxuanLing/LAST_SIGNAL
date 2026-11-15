/** Production preview entry smoke: no __game, all three real HTML entries load. */
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 5178;
const fail = (m: string): never => { process.stderr.write(`FAIL ${m}\n`); process.exit(1); };
const log = (m: string): void => { process.stdout.write(`${m}\n`); };

async function main(): Promise<void> {
  const server: ChildProcess = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist', '--port', String(PORT), '--strictPort'
  ], { stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) { ready = true; break; } } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!ready) fail('production preview did not start (run npm run build first)');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const [path, needle] of [
      ['/', '#game'], ['/economy.html', '#supply-dialog'], ['/station-zero.html', '#game']
    ]) {
      await page.goto(`http://localhost:${PORT}${path}`);
      await page.waitForTimeout(700);
      const r = await page.evaluate((sel) => ({
        hasGame: typeof (window as any).__game !== 'undefined',
        hasDom: !!document.querySelector(sel),
        title: document.title
      }), needle);
      if (r.hasGame) fail(`production ${path} exposes __game`);
      if (!r.hasDom) fail(`production ${path} missing ${needle}`);
      log(`PASS production_entry ${path} | no __game | ${needle} present | ${r.title}`);
    }
    await browser.close();
    if (errors.length) fail(`production page errors: ${errors.join(' | ')}`);
    log('PREVIEW_ENTRY_SMOKE_PASS');
  } finally {
    server.kill('SIGKILL');
  }
}
main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
