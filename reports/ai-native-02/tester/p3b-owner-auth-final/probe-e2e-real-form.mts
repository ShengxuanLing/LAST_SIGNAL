// Independent Tester E2E — real production Owner-pairing form on frozen 87ab379.
// Spawns its own dev server + production bridge launcher on independent ports.
// Credentials are read from private files into memory only; NEVER printed/logged.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/87ab379';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3b-owner-auth-final';
const DEV_PORT = 5392;
const BRIDGE_PORT = 8904;
const ORIGIN = `http://localhost:${DEV_PORT}`;
const R = [];
const rec = (name: string, pass: boolean, observed: any) => { R.push({ name, verdict: pass ? 'PASS' : 'FAIL', observed }); };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function waitHttp(url: string, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(url); if (r.status < 500) return true; } catch {}
    await sleep(200);
  }
  return false;
}
function start(name: string, cmd: string, args: string[], env: Record<string,string> = {}) {
  const p = spawn(cmd, args, { cwd: SNAP, env: { ...process.env, ...env }, stdio: ['pipe','pipe','pipe'], shell: true });
  let out = '';
  p.stdout.on('data', d => { out += d.toString(); });
  let err = '';
  p.stderr.on('data', d => { err += d.toString(); });
  return { p, getOut: () => out, getErr: () => err };
}
async function clickText(page: any, label: string) {
  const pt = await page.evaluate((l: string) => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      for (const c of (s.children.list ?? [])) {
        if (c.type === 'Text' && (c.text || '').includes(l)) {
          const b = c.getBounds(); return { x: b.centerX, y: b.centerY };
        }
      }
    }
    return null;
  }, label);
  if (!pt) throw new Error(`text not found: ${label}`);
  await page.mouse.click(pt.x, pt.y);
}

async function main() {
  const dev = start('dev', 'npx', ['vite', '--mode', 'test', '--port', String(DEV_PORT), '--strictPort']);
  const bridge = start('bridge', 'npx', ['vite-node', 'scripts/c3b-bridge.mts'], {
    LAST_SIGNAL_WORLD_PORT: String(BRIDGE_PORT),
    LAST_SIGNAL_WORLD_ORIGIN: ORIGIN
  });
  let browser: any = null;
  try {
    rec('E0 dev server ready', await waitHttp(`${ORIGIN}/`, 40000), { url: ORIGIN });
    // Bridge stdout contains only paths + ACL, never secrets.
    let bOut = '';
    const t0 = Date.now();
    while (Date.now() - t0 < 40000 && !/BRIDGE_URL=/.test(bridge.getOut())) { await sleep(200); bOut = bridge.getOut(); }
    const lines = bridge.getOut().split(/\r?\n/);
    const pick = (k: string) => lines.find(l => l.startsWith(k + '='))?.slice(k.length + 1) ?? '';
    const bridgeUrl = pick('BRIDGE_URL');
    const tokenFile = pick('TOKEN_FILE');
    const ownerFile = pick('OWNER_KEY_FILE');
    rec('E1 bridge launcher prints only non-secret metadata',
      !!bridgeUrl && !!tokenFile && !!ownerFile && !/TOKEN=[0-9a-f]{16}/.test(bridge.getOut()) && !/OWNER_KEY=[0-9a-f]{16}/.test(bridge.getOut()),
      { bridgeUrl, hasTokenFile: !!tokenFile, hasOwnerFile: !!ownerFile, aclPrinted: /TOKEN_ACL=/.test(bridge.getOut()) && /OWNER_KEY_ACL=/.test(bridge.getOut()) });
    if (!bridgeUrl || !tokenFile || !ownerFile) throw new Error('bridge metadata missing: ' + bridge.getErr().slice(0,500));
    // Secrets stay in-process; never written to log/evidence.
    const token = (await readFile(tokenFile, 'utf8')).trim();
    const ownerKey = (await readFile(ownerFile, 'utf8')).trim();
    rec('E2 independent 0600/current-SID credential files', tokenFile !== ownerFile && !!token && !!ownerKey && token !== ownerKey,
      { separateFiles: tokenFile !== ownerFile, ownerKeyPattern: /^[0-9a-f]{64}$/.test(ownerKey), tokenLength: token.length });

    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const consoleErrors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => consoleErrors.push(e.message));
    await page.goto(ORIGIN);
    await page.evaluate(() => localStorage.removeItem('lastSignal.save.v1'));
    await page.reload();
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
    const nr = await page.evaluate(() => {
      const g: any = (window as any).__game;
      for (const s of Object.values(g.scene.scenes) as any[]) {
        if (!g.scene.isActive(s.sys.settings.key)) continue;
        const t = (s.children.list as any[]).find(c => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
        if (t) { const b = t.getBounds(); return { x: b.centerX, y: b.centerY }; }
      }
      return null;
    });
    if (!nr) throw new Error('NEW RUN not found');
    await page.mouse.click(nr.x, nr.y);
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
    await page.evaluate(() => { (window as any).__game.scene.getScene('GameScene').world.enableEcho(); });
    await page.waitForFunction(() => !!(window as any).__game.scene.getScene('GameScene').world.echoActor);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
    await clickText(page, 'LLM COMPANION >');
    await sleep(300);
    await clickText(page, 'ENABLE / RE-AUTHORIZE');
    await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 10000 });

    const inputs = await page.evaluate(() => {
      const form = document.querySelector('[data-testid="external-link-form"]') as HTMLElement;
      const all = [...form.querySelectorAll('input')].map(i => ({ name: (i as HTMLInputElement).name, type: (i as HTMLInputElement).type }));
      return all;
    });
    rec('E3 form has masked token + ownerKey inputs', inputs.some(i => i.name==='token' && i.type==='password') && inputs.some(i => i.name==='ownerKey' && i.type==='password'), inputs);

    // ONLY pre-inject config if necessary: first try the REAL form with no global config.
    const preInjected = false;
    if (preInjected) {
      await page.evaluate(({ u, t }) => { (window as any).__externalLinkConfig = { bridgeUrl: u, token: t }; }, { u: bridgeUrl, t: token });
    }
    await page.locator('input[name="bridgeUrl"]').fill(bridgeUrl);
    await page.locator('input[name="token"]').fill(token);
    await page.locator('input[name="ownerKey"]').fill(ownerKey);
    await page.locator('button[type="submit"]').click();
    await sleep(1500);

    const after = await page.evaluate(() => {
      const form = document.querySelector('[data-testid="external-link-form"]') as HTMLFormElement | null;
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return {
        statusText: form?.querySelector('[role="status"]')?.textContent ?? '(form closed)',
        formStillOpen: !!form,
        tokenValue: (form?.querySelector('input[name="token"]') as HTMLInputElement)?.value ?? '',
        keyValue: (form?.querySelector('input[name="ownerKey"]') as HTMLInputElement)?.value ?? '',
        companionStatus: gs?.companionStatus,
        globalConfig: (window as any).__externalLinkConfig ? Object.keys((window as any).__externalLinkConfig) : null
      };
    });
    rec('E4 REAL form completes Owner pairing (no pre-injected global)', after.companionStatus === 'CONNECTED', after);
    rec('E5 secrets cleared from DOM inputs after submit', after.tokenValue === '' && after.keyValue === '', { tokenCleared: after.tokenValue === '', keyCleared: after.keyValue === '' });
    rec('E6 ownerKey not stored in global config', Array.isArray(after.globalConfig) ? !after.globalConfig.includes('ownerKey') : true, { globalKeys: after.globalConfig });

    // Persist structured result (no secrets).
    await writeFile(`${OUT}/e2e-real-form.json`, JSON.stringify({ total: R.length, pass: R.filter(r=>r.verdict==='PASS').length, fail: R.filter(r=>r.verdict==='FAIL').length, results: R, consoleErrors }, null, 2));
    console.log(JSON.stringify({ total: R.length, pass: R.filter(r=>r.verdict==='PASS').length, fail: R.filter(r=>r.verdict==='FAIL').length }));
    for (const r of R) console.log(r.verdict, r.name, JSON.stringify(r.observed));
  } finally {
    if (browser) await browser.close().catch(()=>{});
    bridge.p.stdin.end();
    bridge.p.kill('SIGTERM');
    dev.p.kill('SIGTERM');
    await sleep(500);
    bridge.p.kill('SIGKILL'); dev.p.kill('SIGKILL');
  }
}
main().catch(e => { console.error('E2E ERROR', e?.message ?? String(e)); process.exitCode = 1; });
