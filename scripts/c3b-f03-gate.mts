/**
 * AI-NATIVE-02 / F-03 — production build must NOT expose window.__game.
 *
 * Builds both modes, serves each bundle over loopback HTTP and checks the
 * actual window object in a real browser. The test-mode build must keep the
 * handle for the frozen E2E evidence suite.
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const REPO = process.cwd();
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function log(message: string): void { process.stdout.write(`${message}\n`); }
function fail(message: string): never { process.stderr.write(`FAIL ${message}\n`); process.exit(1); }
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: REPO, encoding: 'utf-8', shell: true });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed: ${result.stderr ?? result.stdout}`);
}

async function serve(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const file = resolve(join(root, path === '/' ? 'index.html' : path.slice(1)));
    if (!file.startsWith(resolve(root))) { res.statusCode = 403; res.end(); return; }
    try {
      const info = await stat(file);
      if (!info.isFile()) { res.statusCode = 404; res.end(); return; }
      const body = await readFile(file);
      res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
      res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const address = server.address();
  assert(address && typeof address === 'object', 'server bound');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((r) => server.close(() => r()))
  };
}

async function windowHasGame(url: string, browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<boolean> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    return await page.evaluate(() => typeof (window as any).__game !== 'undefined');
  } finally { await page.close(); }
}

async function main(): Promise<void> {
  log('BUILD production');
  run('npm', ['run', 'build']);
  log('BUILD test-mode');
  run('npm', ['run', 'build:test']);

  const browser = await chromium.launch({ headless: true });
  try {
    const prod = await serve(resolve(REPO, 'dist'));
    const testBuilt = await serve(resolve(REPO, 'dist-test'));
    try {
      const prodHas = await windowHasGame(prod.url, browser);
      assert(!prodHas, 'production build exposes window.__game');
      log('PASS production_no_game_handle');
      const testHas = await windowHasGame(testBuilt.url, browser);
      assert(testHas, 'test-mode build lost window.__game (frozen E2E evidence needs it)');
      log('PASS test_mode_keeps_game_handle');
    } finally {
      await prod.close();
      await testBuilt.close();
    }
  } finally { await browser.close(); }
  log('F03_PRODUCTION_GATE_PASS');
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
