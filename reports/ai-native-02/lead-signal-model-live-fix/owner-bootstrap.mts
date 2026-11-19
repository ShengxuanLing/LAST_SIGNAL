/**
 * AI-NATIVE-02 Task C · Lead 亲自逐轮模型 Signal 遭遇 —— OWNER BOOTSTRAP（运行辅助）
 *
 * 这个脚本只做“人类电脑上本来会做的操作”，不代替模型、不做策略、不写 core 状态：
 *   1. 自己的端口起 Vite（默认 5301，strictPort；绝不复用/触碰原 5173）
 *   2. 起真实 loopback bridge（token / Owner pairing key 只写私有 ACL 文件，打印仅路径）
 *   3. 真实浏览器 NEW RUN → Pause 设置里打开 SIGNAL COLLABORATION → ENABLE ECHO
 *      → 用真实传送门交互进入下一个房间（设备由 World 自己 spawn）
 *   4. 在真实 masked 表单里填 BRIDGE URL / TOKEN / OWNER PAIRING KEY 授权 Companion
 *   5. 保持 Pause 打开，暴露本地 control 端点给 Owner 命令（真实点击 / 真实帧）
 *
 * 允许并逐项披露的夹具（全部写进 bootstrap.json 的 fixtures[]）：
 *   - 把主角摆到传送门上（player.reset(portal.wx, portal.wy)），不是 AI 寻路
 *   - 需要时清掉当前房间的敌人（destroy + world.enemies = []），只为让遭遇可控
 * 明确不做：不预先 scan / jam / toggle / suggest；不调用 stepFrame；不写 sim.signal；
 *          不改 HP / 资源 / 无敌 / 伤害；不读取 Owner key 以外的方式伪造授权。
 *
 * 运行（仓库根目录）：
 *   npx vite-node reports/ai-native-02/lead-signal-model-live/owner-bootstrap.mts
 * 可选环境变量：
 *   SIGNAL_RUN_PORT=5301 SIGNAL_RUN_CONTROL_PORT=5302 SIGNAL_RUN_HEADED=1
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  generateToken, writeSecureTokenFile, deleteSecureTokenFile, type SecureTokenFile
} from '../../../src/ai-native/secureTokenFile';
import { createOwnerCredentialFile, type OwnerCredentialFile } from '../../../src/ai-native/ownerCredential';
import { startWorldBridge, type RunningWorldBridge } from '../../../src/ai-native/worldBridgeServer';
import { WorldGateway } from '../../../src/ai-native/worldGateway';

const REPO = process.cwd();
const RUN_PORT = Number(process.env.SIGNAL_RUN_PORT ?? 5301);
const CONTROL_PORT = Number(process.env.SIGNAL_RUN_CONTROL_PORT ?? RUN_PORT + 1);
const HEADED = process.env.SIGNAL_RUN_HEADED === '1';
const ORIGIN = `http://localhost:${RUN_PORT}`;
const ORIGIN_IP = `http://127.0.0.1:${RUN_PORT}`;
const OUT = resolve(REPO, 'reports/ai-native-02/lead-signal-model-live-fix');
const SHOTS = resolve(OUT, 'screenshots');
const VIDEO = resolve(OUT, 'video');
const OWNER_UI = resolve(OUT, 'owner-ui.jsonl');
const BOOT_LOG = resolve(OUT, 'bootstrap.log');

let shotIndex = 0;
let logChain: Promise<void> = Promise.resolve();
/** 启动失败时也能清理本次自有进程/凭据（只碰本次拥有的）。 */
let emergencyShutdown: ((reason: string) => Promise<void>) | null = null;

function log(line: string): void {
  process.stdout.write(`${line}\n`);
  logChain = logChain.then(() => appendFile(BOOT_LOG, `${new Date().toISOString()} ${line}\n`));
}

/** 只用于日志的脱敏：任何一处出现 token / owner key / ownerCap 都替换掉。 */
const secrets = new Set<string>();
function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const s of secrets) if (s && out.includes(s)) out = out.split(s).join('<redacted>');
    return out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const dst: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (k === 'ownerCap' || k === 'x-owner-cap' || k === 'token' || k === 'ownerKey') { dst[k] = '<redacted>'; continue; }
      dst[k] = redact(v);
    }
    return dst;
  }
  return value;
}

async function jsonl(file: string, record: Record<string, unknown>): Promise<void> {
  await appendFile(file, `${JSON.stringify(redact({ at: new Date().toISOString(), ...record }))}\n`);
}

async function shot(page: Page, label: string): Promise<string> {
  shotIndex += 1;
  const file = resolve(SHOTS, `${String(shotIndex).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path: file });
  log(`[boot] screenshot ${file}`);
  return file;
}

async function waitHttp(url: string, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`dev server did not answer on ${url} within ${timeoutMs}ms`);
}

/** 通过 Phaser Text 中心的真实鼠标点击（和 coop E2E 同一套写法）。 */
async function clickText(page: Page, text: string, what = 'text'): Promise<void> {
  const p = await page.evaluate((label) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    if (!s) return null;
    function findText(list: any[]): { x: number; y: number } | null {
      for (const c of list) {
        if (!c) continue;
        if (c.type === 'Text' && (c.text || '').includes(label)) {
          const b = c.getBounds();
          return { x: b.centerX, y: b.centerY };
        }
        if (c.list && Array.isArray(c.list)) {
          const found = findText(c.list);
          if (found) return found;
        }
      }
      return null;
    }
    return findText(s.children.list);
  }, text);
  if (!p) throw new Error(`cannot find ${what} labelled "${text}" in PauseScene`);
  await page.mouse.click(p.x, p.y);
}

async function pauseActive(page: Page): Promise<boolean> {
  return page.evaluate(() => !!((window as any).__game?.scene.isActive('PauseScene')));
}

async function openPause(page: Page): Promise<void> {
  // Pause 的开/关都走 Phaser Scene 生命周期（tween 150ms + onResume），
  // 紧接着的一次 ESC 有可能被丢，所以这里显式重试，而不是赌一次按键。
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await pauseActive(page)) return;
    await page.keyboard.press('Escape');
    try {
      await page.waitForFunction(() => !!((window as any).__game?.scene.isActive('PauseScene')), undefined, { timeout: 1500 });
      return;
    } catch {
      await page.waitForTimeout(250);
    }
  }
  throw new Error('cannot open PauseScene after 12 attempts');
}

async function closePause(page: Page): Promise<void> {
  // 不依赖 ESC 的焦点行为：先用真实 UI 回到 pause 根菜单，再点 RESUME。
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!(await pauseActive(page))) {
      await page.waitForTimeout(200); // 让 onResume 的帧循环真正恢复
      return;
    }
    // 当前在子面板（settings / echo / companion / inventory）→ 先 BACK/CLOSE
    if (!(await panelHas(page, 'RESUME'))) {
      for (const back of ['BACK', 'CLOSE']) {
        if (await panelHas(page, back)) {
          await clickText(page, back, 'panel back').catch(() => undefined);
          await page.waitForTimeout(350);
          break;
        }
      }
    }
    if (await panelHas(page, 'RESUME')) {
      await clickText(page, 'RESUME', 'resume').catch(() => undefined);
      try {
        await page.waitForFunction(() => !((window as any).__game?.scene.isActive('PauseScene')), undefined, { timeout: 2500 });
        await page.waitForTimeout(200);
        return;
      } catch { /* fall through to ESC */ }
    }
    await page.keyboard.press('Escape');
    try {
      await page.waitForFunction(() => !((window as any).__game?.scene.isActive('PauseScene')), undefined, { timeout: 1500 });
      await page.waitForTimeout(200);
      return;
    } catch {
      await page.waitForTimeout(250);
    }
  }
  throw new Error('cannot close PauseScene (UI RESUME + ESC both failed)');
}

async function panelHas(page: Page, text: string): Promise<boolean> {
  return page.evaluate((label) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    if (!s) return false;
    function find(list: any[]): boolean {
      for (const c of list) {
        if (!c) continue;
        if (c.type === 'Text' && (c.text || '').includes(label)) return true;
        if (c.list && Array.isArray(c.list) && find(c.list)) return true;
      }
      return false;
    }
    return find(s.children.list);
  }, text);
}

/** 确保停在 Companion 面板（有 CONFIRM / REJECT 的 Owner 面板）。 */
async function ensureCompanionPanel(page: Page): Promise<void> {
  await openPause(page);
  if (await panelHas(page, 'CONFIRM FIRST PROPOSAL')) return;
  if (await panelHas(page, 'LLM COMPANION >')) {
    await clickText(page, 'LLM COMPANION >', 'menu entry');
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    if (!s) return false;
    function find(list: any[]): boolean {
      for (const c of list) {
        if (!c) continue;
        if (c.type === 'Text' && (c.text || '').includes('CONFIRM FIRST PROPOSAL')) return true;
        if (c.list && Array.isArray(c.list) && find(c.list)) return true;
      }
      return false;
    }
    return find(s.children.list);
  }, undefined, { timeout: 15000 });
}

/** 只读投影：真实 tick / relay / 两账号能量 / 排队命令 / 房间（绝不写 state）。 */
async function readState(page: Page): Promise<any> {
  const raw = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    if (!gs || !gs.world) return { error: 'no-world' };
    const w = gs.world;
    const s = w.sim.signal;
    const view = w.signalView ? w.signalView() : null;
    const room = w.currentRoom ? w.currentRoom() : null;
    return {
      tick: w.sim.tick,
      roomId: w.currentRoomId,
      roomKind: room ? room.kind : null,
      pauseOpen: g.scene.isActive('PauseScene'),
      companionStatus: gs.companionStatus ?? 'OFF',
      hasEcho: !!w.sim.echo,
      echoPos: w.sim.echo ? { x: w.sim.echo.x, y: w.sim.echo.y } : null,
      echoHp: w.sim.echo ? w.sim.echo.data.hp : null,
      playerHp: w.sim.player ? w.sim.player.data.hp : null,
      enemies: (w.enemies ?? []).length,
      drones: (w.sim.drones ?? []).length,
      hasPortal: !!w.portal,
      portal: w.portal ? { x: w.portal.wx, y: w.portal.wy } : null,
      player: { x: w.sim.player.x, y: w.sim.player.y },
      signal: s ? {
        deviceId: s.deviceId,
        relay: s.relay,
        manualEnabled: s.manualEnabled,
        powered: s.powered,
        jammedUntilTick: s.jammedUntilTick,
        playerEnergy: s.actors.player.energy.energy,
        echoEnergy: s.actors.echo.energy.energy,
        playerScanCD: s.actors.player.cooldowns.scanCooldownTicks,
        playerJamCD: s.actors.player.cooldowns.jamCooldownTicks,
        echoScanCD: s.actors.echo.cooldowns.scanCooldownTicks,
        echoJamCD: s.actors.echo.cooldowns.jamCooldownTicks,
        evidence: s.evidence.length
      } : null,
      exitOpen: view ? view.exitOpen === true : null,
      pendingCommands: (w.sim.pendingCommands ?? []).map((c: any) => c.type),
      session: gs.companionLink ? gs.companionLink.session : null,
      epoch: gs.companionLink ? gs.companionLink.epoch : null
    };
  });
  return raw;
}

async function receipts(token: string, bridgeUrl: string, session: string | null, epoch: number | null): Promise<any> {
  if (!session || !epoch) return { ok: false, code: 'NO_SESSION' };
  const res = await fetch(`${bridgeUrl}/world-link/companion-status?session=${session}&epoch=${epoch}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await res.json() as any;
  if (!body.ok) return { ok: false, code: body.code ?? 'E_LINK_UNAVAILABLE' };
  return {
    ok: true,
    status: body.value?.status?.link ?? body.value?.status?.status ?? null,
    lastObservationTick: body.value?.status?.lastObservationTick ?? null,
    pending: (body.value?.pending ?? []).length,
    receipts: body.value?.receipts ?? [],
    memoryEntries: body.value?.status?.memoryEntries ?? null
  };
}

async function main(): Promise<void> {
  await mkdir(SHOTS, { recursive: true });
  await mkdir(VIDEO, { recursive: true });
  await writeFile(BOOT_LOG, '');
  log(`[boot] repo=${REPO}`);
  log(`[boot] own vite port=${RUN_PORT} origin=${ORIGIN} (原 5173 不参与)`);
  log(`[boot] control port=${CONTROL_PORT}`);

  // ---- 1) 私有凭据（只打印路径/ACL，不打印内容） --------------------------
  const token = generateToken();
  const tokenFile: SecureTokenFile = await writeSecureTokenFile(token);
  const ownerFile: OwnerCredentialFile = await createOwnerCredentialFile();
  const ownerKeyRaw = (await readFile(ownerFile.path, 'utf8')).trim();
  const controlToken = generateToken();
  const controlTokenFile = await writeSecureTokenFile(controlToken);
  secrets.add(token).add(ownerKeyRaw).add(controlToken);
  log(`[boot] TOKEN_FILE=${tokenFile.path} ACL=${tokenFile.acl}`);
  log(`[boot] OWNER_KEY_FILE=${ownerFile.path} ACL=${ownerFile.acl}`);
  log(`[boot] CONTROL_TOKEN_FILE=${controlTokenFile.path}`);
  log('[boot] TOKEN / OWNER PAIRING KEY 内容不写入任何日志、不进入 Agent 环境');

  // ---- 2) 自己的 Vite（strictPort，绝不复用 5173） -------------------------
  const vite = spawn(process.execPath, [resolve(REPO, 'node_modules/vite/bin/vite.js'), '--port', String(RUN_PORT), '--strictPort'], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe']
  });
  vite.stdout?.on('data', (b: Buffer) => log(`[vite] ${b.toString().trim()}`));
  vite.stderr?.on('data', (b: Buffer) => log(`[vite:err] ${b.toString().trim()}`));

  const gateway = new WorldGateway();
  const bridge: RunningWorldBridge = await startWorldBridge({
    gateway,
    token,
    ownerKeyHash: ownerFile.keyHash,
    allowedOrigins: [ORIGIN, ORIGIN_IP],
    heartbeatIntervalMs: 1000
  });
  log(`[boot] BRIDGE_URL=${bridge.url}`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let server: Server | null = null;
  let shuttingDown = false;

  const fixtures: Array<{ item: string; why: string; detail?: string }> = [];
  const milestone: string[] = [];

  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[boot] shutdown start (${reason})`);
    const state = page ? await readState(page).catch(() => null) : null;
    await jsonl(OWNER_UI, { command: '_shutdown', reason, state });
    try { await context?.close(); } catch { /* flush video best-effort */ }
    try { await browser?.close(); } catch { /* ignore */ }
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    try { await bridge.close(); } catch { /* ignore */ }
    await deleteSecureTokenFile(tokenFile);
    await deleteSecureTokenFile(controlTokenFile);
    await import('node:fs/promises').then((fs) => fs.rm(ownerFile.directory, { recursive: true, force: true }));
    if (vite.pid) {
      try { process.kill(vite.pid, 'SIGTERM'); } catch { /* ignore */ }
    }
    await writeFile(resolve(OUT, 'shutdown.json'), JSON.stringify({
      at: new Date().toISOString(), reason, vitePid: vite.pid ?? null,
      credentialsDeleted: true, port: RUN_PORT
    }, null, 2));
    // 夹具披露可能会在 bootstrap.json 写完之后新增（Owner 过门摆位），最后统一落盘。
    await writeFile(resolve(OUT, 'fixtures-final.json'), JSON.stringify({
      at: new Date().toISOString(), fixtures, milestone
    }, null, 2));
    log('[boot] shutdown done (only own processes touched)');
    await logChain;
    process.exit(exitCode);
  };
  emergencyShutdown = (reason: string) => shutdown(reason, 1);

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  await waitHttp(ORIGIN);
  log('[boot] vite is serving');

  // ---- 3) 真实浏览器 ------------------------------------------------
  browser = await chromium.launch({ headless: !HEADED, args: ['--no-sandbox'] });
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: VIDEO, size: { width: 1280, height: 720 } }
  });
  page = await context.newPage();
  page.on('pageerror', (e) => log(`[page:error] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[page:console:error] ${m.text()}`); });

  // 真实 NEW RUN（清掉本地存档，确保是全新 run + 默认未 opt-in）
  await page.goto(ORIGIN);
  await page.evaluate(() => localStorage.removeItem('lastSignal.save.v1'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  const newRun = await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const t = s.children.list.find((c: any) => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  });
  if (!newRun) throw new Error('NEW RUN control not found');
  await page.mouse.click(newRun.x, newRun.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
  await page.waitForTimeout(400);
  const baseline = await readState(page);
  await jsonl(OWNER_UI, { command: '_bootstrap_baseline', state: baseline });
  milestone.push(await shot(page, 'new-run-legacy-no-device'));
  if (baseline.signal) throw new Error('default NEW RUN must not have a signal device');

  // ---- 4) Pause → SETTINGS → SIGNAL COLLABORATION opt-in -------------
  await openPause(page);
  await clickText(page, 'SETTINGS', 'settings entry');
  await page.waitForTimeout(250);
  await clickText(page, 'SIGNAL COLLABORATION · OFF', 'signal opt-in toggle');
  await page.waitForTimeout(250);
  const optInOn = await panelHas(page, 'SIGNAL COLLABORATION · ON');
  if (!optInOn) throw new Error('opt-in toggle did not switch to ON');
  await jsonl(OWNER_UI, { command: '_bootstrap_optin', state: await readState(page), optInOn });
  milestone.push(await shot(page, 'optin-on'));
  await clickText(page, 'BACK', 'settings back');
  await page.waitForTimeout(200);
  await closePause(page);
  log('[boot] SIGNAL COLLABORATION opt-in is ON (saved)');

  // ---- 5) 真实传送门进入下一房间（设备由 World 自己 spawn）----------
  // 顺序说明（必须披露）：先真实过门、再在房间里 ENABLE ECHO。
  // 若先在上一房间启用 echo，它会被墙卡在旧房间（steering 无寻路），
  // 永远感知不到继电器；这不是 teleport，只是把“人类会选的顺序”写清楚。
  const roomBefore = (await readState(page)).roomId;
  const portalPos = (await readState(page)).portal;
  if (!portalPos) throw new Error('no portal in the start room');
  await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    w.player.reset(w.portal.wx, w.portal.wy);
  });
  fixtures.push({
    item: 'player.reset(portal.wx, portal.wy)',
    why: '把主角摆到本房间传送门上，避免脚本寻路（不是 AI 移动）'
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    (window as any).__game.scene.getScene('GameScene').world.player.requestInteract();
  });
  await page.waitForFunction((prev: number) => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const id = gs.world.currentRoomId;
    return id !== prev && id >= 0;
  }, roomBefore, { timeout: 20000 });
  await page.waitForFunction(() => !!(window as any).__game.scene.getScene('GameScene').world.sim.signal, undefined, { timeout: 20000 });
  const entered = await readState(page);
  log(`[boot] entered room ${entered.roomId} (${entered.roomKind}) with relay ${entered.signal?.deviceId}`);

  // 清敌夹具（只在真的存在时执行，逐项披露）
  //
  // FIX（对齐 Lead 现场问题 1）：旧版本只 destroy 渲染层并 w.enemies=[]，于是
  // sim.targets 里仍留着 3 个活着的 hunter，MCP 观察把它们当真实威胁。
  // 现在渲染层与 canonical 状态一起清，两者保持一致；这不是“正常死亡”路径
  // （正常死亡由 core 的 hp<=0 过滤 + enemy-died 事件完成，见
  // src/world/sim/targetRemoval.test.ts），而是明确的清敌夹具。
  if (entered.enemies > 0 || entered.drones > 0) {
    const cleared = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      // w.sim is a frozen deep-copy snapshot for readers; the LIVE core state is
      // w._sim (same object the game ticks). Fixture writes must target _sim.
      const live = w._sim;
      const targetsBefore = live.targets.length;
      const dronesBefore = live.drones.length;
      for (const enemy of w.enemies) { try { enemy.sprite.destroy(); } catch { /* ignore */ } }
      w.enemies = [];
      live.targets = [];
      live.drones = [];
      // Refresh the frozen reader snapshot so observers see the cleared room.
      try { w.bumpSimVersion(); } catch { /* dev-only */ }
      return {
        targetsBefore, dronesBefore,
        targetsAfter: live.targets.length, dronesAfter: live.drones.length,
        echoViewTargets: ((w.echoView() || {}).targets || []).length
      };
    });
    fixtures.push({
      item: `clear room hostiles (renderer + canonical targets/drones): targets ${cleared.targetsBefore}->0, drones ${cleared.dronesBefore}->0`,
      why: '让 Lead 的模型回合在可观察、可控的房间里进行；旧夹具只清渲染层会留下活着的 sim.targets（已被 MCP 观察当成真实威胁）',
      detail: '不动 HP/资源/伤害/无敌；不改 energy；不写 signal；清后 echoView().targets 也应为空'
    });
    if (cleared.targetsAfter !== 0 || cleared.dronesAfter !== 0 || cleared.echoViewTargets !== 0) {
      throw new Error(`clear-enemies fixture is inconsistent: ${JSON.stringify(cleared)}`);
    }
    log(`[boot] cleared hostiles consistently (targets ${cleared.targetsBefore}->0, drones ${cleared.dronesBefore}->0)`);
  }
  const afterEnter = await readState(page);
  if (!afterEnter.signal) throw new Error('relay device did not spawn after real room enter');
  if (afterEnter.signal.relay !== 'INACTIVE') throw new Error(`relay must start INACTIVE, got ${afterEnter.signal.relay}`);
  if (afterEnter.signal.playerEnergy !== 100 || afterEnter.signal.echoEnergy !== 100) {
    throw new Error('both energy accounts must be full before the model turns');
  }
  await jsonl(OWNER_UI, { command: '_bootstrap_room_enter', state: afterEnter });
  milestone.push(await shot(page, 'room-with-relay-inactive'));

  // ---- 6) ENABLE ECHO（此刻已站在继电器房间里；spawn 由真实帧提交）----
  const hasEcho = await page.evaluate(() => {
    const g: any = (window as any).__game;
    return !!g.scene.getScene('GameScene').world.sim.echo;
  });
  if (!hasEcho) {
    log('[step6] open pause → echo panel');
    await openPause(page);
    await clickText(page, 'ECHO COMPANION >', 'echo entry');
    await page.waitForTimeout(250);
    await clickText(page, 'ENABLE ECHO', 'enable echo');
    // ENABLE ECHO 只是入队 spawn-echo；暂停时 tick 冻结，所以先恢复真实帧再回 Pause。
    log('[step6] resume real frames until echo spawns next to the protagonist');
    await closePause(page);
    await page.waitForFunction(
      () => !!((window as any).__game.scene.getScene('GameScene').world.echoActor),
      undefined, { timeout: 20000 }
    );
    await openPause(page);
    await page.waitForTimeout(250);
    milestone.push(await shot(page, 'echo-enabled-in-room'));
    await closePause(page);
    log('[boot] echo enabled via real UI (inside the relay room)');
  } else {
    log('[boot] echo already present (reused)');
  }

  // ---- 6b) 等 echo 真正“看得到”继电器（渲染端同一个 echoView() 投影）----
  const echoWaitMs = Number(process.env.SIGNAL_RUN_ECHO_WAIT_MS ?? 4000);
  const echoDeadline = Date.now() + echoWaitMs;
  let echoSeesRelay = false;
  let lastEchoProbe: any = null;
  while (Date.now() < echoDeadline) {
    lastEchoProbe = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const view = w.echoView();
      return {
        hasRelay: !!(view && view.relay),
        echo: view ? { x: view.echo.x, y: view.echo.y } : null,
        player: view ? { x: view.player.x, y: view.player.y } : null
      };
    });
    if (lastEchoProbe?.hasRelay) { echoSeesRelay = true; break; }
    await page.waitForTimeout(250);
  }
  if (!echoSeesRelay) {
    // 真实 W/A/S/D 走向继电器（真键盘输入，不写坐标）：
    // relay 在房间中心，echo 会跟着主角走，从而真正进入感知半径。
    log('[boot] echo 还没看到继电器，用真实 W/A/S/D 走向房间中心的设备');
    for (let i = 0; i < 14 && !echoSeesRelay; i += 1) {
      const probe = await page.evaluate(() => {
        const w = (window as any).__game.scene.getScene('GameScene').world;
        const s = w.sim.signal;
        return {
          relay: s ? { x: s.x, y: s.y } : null,
          player: { x: w.sim.player.x, y: w.sim.player.y },
          hasRelay: !!(w.echoView() && w.echoView().relay)
        };
      });
      if (probe.hasRelay) { echoSeesRelay = true; break; }
      if (!probe.relay) break;
      const dx = probe.relay.x - probe.player.x;
      const dy = probe.relay.y - probe.player.y;
      const keys: string[] = [];
      if (Math.abs(dx) > 0.6) keys.push(dx > 0 ? 'd' : 'a');
      if (Math.abs(dy) > 0.6) keys.push(dy > 0 ? 's' : 'w');
      if (keys.length === 0) break;
      for (const k of keys) await page.keyboard.down(k);
      await page.waitForTimeout(450);
      for (const k of keys) await page.keyboard.up(k);
      await page.waitForTimeout(200);
      echoSeesRelay = await page.evaluate(() => {
        const w = (window as any).__game.scene.getScene('GameScene').world;
        const v = w.echoView();
        return !!(v && v.relay);
      });
      lastEchoProbe = probe;
    }
    fixtures.push({
      item: 'walk protagonist toward the relay with real W/A/S/D input',
      why: '让 echo 跟着真实移动进入感知半径（真键盘输入，不写坐标、不传送）',
      detail: JSON.stringify(lastEchoProbe)
    });
  }

  log(`[boot] echo perceives relay = ${echoSeesRelay} (probe=${JSON.stringify(lastEchoProbe)})`);
  milestone.push(await shot(page, 'echo-sees-relay'));
  fixtures.push({
    item: 'echo enable order (in-room, real UI)',
    why: '先真实过门、再 ENABLE ECHO，否则 echo 会被墙卡在上一房间而无法感知继电器（无 teleport，无坐标写入）',
    detail: JSON.stringify(lastEchoProbe)
  });
  if (!echoSeesRelay) {
    log('[boot] WARN echo 仍未感知继电器；Lead 可先 _owner_resume 让它继续跟随');
  }

  // ---- 7) 真实 masked 表单授权 Companion（Agent 永远拿不到 Owner key）----
  const authorizeCompanion = async (): Promise<void> => {
    await openPause(page!);
    if (!(await panelHas(page!, 'CONFIRM FIRST PROPOSAL'))) {
      if (await panelHas(page!, 'LLM COMPANION >')) {
        await clickText(page!, 'LLM COMPANION >', 'companion entry');
        await page!.waitForTimeout(250);
      }
    }
    await clickText(page!, 'ENABLE / RE-AUTHORIZE', 'authorize companion');
    await page!.waitForSelector('[data-testid="external-link-form"]', { timeout: 15000 });
    await page!.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]', bridge.url);
    await page!.fill('[data-testid="external-link-form"] input[name="token"]', token);
    await page!.fill('[data-testid="external-link-form"] input[name="ownerKey"]', ownerKeyRaw);
    milestone.push(await shot(page!, 'masked-owner-form-filled'));
    await page!.click('[data-testid="external-link-form"] button[type="submit"]');
    await page!.waitForFunction(
      () => (window as any).__game.scene.getScene('GameScene').companionStatus === 'CONNECTED',
      undefined, { timeout: 20000 }
    );
    await page!.waitForTimeout(600); // 让 renderer 把已提交观察 push 到 bridge
  };
  await authorizeCompanion();
  const authorized = await readState(page);
  const receiptView = await receipts(token, bridge.url, authorized.session, authorized.epoch);
  milestone.push(await shot(page, 'companion-connected-and-paused'));
  log(`[boot] companion CONNECTED session=${authorized.session} epoch=${authorized.epoch} receipts=${JSON.stringify(receiptView.receipts)}`);
  await jsonl(OWNER_UI, { command: '_bootstrap_authorize', state: authorized, receipts: receiptView });

  // ---- 8) 状态断言：什么都没预先做（授权后先快速自检一次）---------
  {
    const check = await readState(page);
    if (!check.pauseOpen) throw new Error('bootstrap must stay paused after authorize');
    if (check.signal.relay !== 'INACTIVE') throw new Error('relay must stay INACTIVE before the model turns');
    if (check.signal.manualEnabled !== false || check.signal.powered !== true) throw new Error('relay manual/power must be untouched');
    if (check.signal.jammedUntilTick !== 0) throw new Error('relay must not be jammed');
    if (check.signal.evidence !== 0) throw new Error('no scan evidence may exist before the model turns');
    if (check.signal.playerEnergy !== 100 || check.signal.echoEnergy !== 100) throw new Error('accounts must stay full');
    if (check.pendingCommands.length !== 0) throw new Error('no signal command may be queued');
    if (check.exitOpen !== false) throw new Error('gated exit must be closed while INACTIVE');
  }

  // ---- 8b) 证明“已有已提交 echo 观察”——只用只读 status（不 attach、不断开会话）----
  // 早期版本在这里跑过一次 echo_observe 然后 client.close()，但正常关闭会走
  // agent-disconnect → 会话关闭，导致后续重新授权拿到 409 duplicate_handshake。
  // 改为读 companion-status 的 lastObservationTick（Agent 只读允许、不占租约）。
  const obsProof = await receipts(token, bridge.url, authorized.session, authorized.epoch);
  await jsonl(OWNER_UI, { command: '_bootstrap_observation_proof', result: obsProof });
  await writeFile(resolve(OUT, 'bootstrap-observation-proof.json'), JSON.stringify(redact(obsProof), null, 2));
  log(`[boot] committed observation proof: lastObservationTick=${obsProof.lastObservationTick ?? null} status=${obsProof.status ?? null}`);
  if (typeof obsProof.lastObservationTick !== 'number' || obsProof.lastObservationTick < 0) {
    throw new Error('bootstrap 结束时 bridge 上必须已有一份已提交的 echo 观察');
  }
  const finalState = await readState(page);
  if (!finalState.pauseOpen) throw new Error('bootstrap must end paused');
  if (finalState.companionStatus !== 'CONNECTED') throw new Error('companion must end CONNECTED');
  if (finalState.signal.relay !== 'INACTIVE') throw new Error('relay must stay INACTIVE before the model turns');
  if (finalState.signal.playerEnergy !== 100 || finalState.signal.echoEnergy !== 100) throw new Error('accounts must stay full');
  if (finalState.signal.evidence !== 0 || finalState.signal.jammedUntilTick !== 0) throw new Error('no scan/jam may exist before the model turns');
  if (finalState.pendingCommands.length !== 0) throw new Error('no signal command may be queued');

  const bootstrap = {
    schema: 'last-signal.lead-signal-run.bootstrap.v1',
    at: new Date().toISOString(),
    repo: REPO,
    commit: await import('node:child_process').then(({ execFileSync }) =>
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim()),
    branch: await import('node:child_process').then(({ execFileSync }) =>
      execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim()),
    ports: { vite: RUN_PORT, control: CONTROL_PORT },
    urls: { game: ORIGIN, bridge: bridge.url, control: `http://127.0.0.1:${CONTROL_PORT}` },
    credentials: {
      tokenFile: tokenFile.path, tokenAcl: tokenFile.acl,
      ownerKeyFile: ownerFile.path, ownerKeyAcl: ownerFile.acl,
      controlTokenFile: controlTokenFile.path,
      note: '只记录路径与 ACL；TOKEN / OWNER PAIRING KEY 明文从不写入任何文件或日志'
    },
    agentEnvAllowlist: ['LAST_SIGNAL_WORLD_BRIDGE_URL', 'LAST_SIGNAL_WORLD_TOKEN_FILE'],
    fixtures,
    echoSeesRelayAtBootstrap: echoSeesRelay,
    milestones: milestone,
    stateAtEndOfBootstrap: finalState,
    observationProof: obsProof,
    receiptsAtEndOfBootstrap: obsProof,
    evidence: { screenshots: SHOTS, video: VIDEO, ownerUiLog: OWNER_UI, bootstrapLog: BOOT_LOG },
    modelActionsPerformed: 0,
    suggestionsMade: 0
  };
  await writeFile(resolve(OUT, 'bootstrap.json'), JSON.stringify(bootstrap, null, 2));
  log('[boot] bootstrap.json written');

  // ---- 9) Owner control 端点（真实点击 / 真实帧；只读记录 state）------
  const authorizedForControl = (req: any): boolean =>
    req.headers.authorization === `Bearer ${controlToken}`;

  const ownerCommand = async (body: any): Promise<any> => {
    if (!page) return { ok: false, code: 'NO_PAGE' };
    const command = String(body.command ?? '');
    const before = await readState(page);
    let result: any = { ok: true };
    try {
      return await runOwnerCommand(command, body, before);
    } catch (error) {
      result = {
        ok: false,
        code: 'E_COMMAND_FAILED',
        command,
        detail: error instanceof Error ? error.message : String(error),
        state: await readState(page).catch(() => null)
      };
      await jsonl(OWNER_UI, { command, params: body, ok: false, result, stateBefore: before });
      log(`[boot] owner command failed: ${command} ${result.detail}`);
      return result;
    }
  };

  const runOwnerCommand = async (command: string, body: any, before: any): Promise<any> => {
    let result: any = { ok: true };

    if (command === '_screenshot') {
      const file = await shot(page, String(body.label ?? 'manual'));
      result = { ok: true, file };
    } else if (command === '_owner_pause') {
      await ensureCompanionPanel(page);
      result = { ok: true };
    } else if (command === '_owner_confirm' || command === '_owner_reject') {
      await ensureCompanionPanel(page);
      const label = command === '_owner_confirm' ? 'CONFIRM FIRST PROPOSAL (OWNER)' : 'REJECT FIRST PROPOSAL';
      const pendingBefore = (await receipts(token, bridge.url, before.session, before.epoch));
      let clicked = true;
      try { await clickText(page, label, command); } catch { clicked = false; }
      if (!clicked) {
        result = { ok: false, code: 'NO_PROPOSAL_BUTTON', detail: '该面板当前没有可点的建议按钮' };
      } else {
        await page.waitForTimeout(400);
        const after = await readState(page);
        const r = await receipts(token, bridge.url, after.session, after.epoch);
        result = {
          ok: true,
          clicked: label,
          pendingBefore: pendingBefore.pending ?? null,
          pendingAfter: r.pending ?? null,
          receipts: r.receipts ?? [],
          queuedCommands: after.pendingCommands,
          note: '决策已记录；Signal 命令在暂停期间保持 queued，必须 _owner_resume 才会被真实 tick 提交'
        };
      }
    } else if (command === '_owner_resume') {
      const ms = Number(body.milliseconds ?? 600);
      if (!Number.isFinite(ms) || ms < 0 || ms > 120000) return { ok: false, code: 'E_ARG' };
      await closePause(page);
      await page.waitForTimeout(ms);
      const during = await readState(page);
      await openPause(page);
      await ensureCompanionPanel(page);
      const after = await readState(page);
      const r = await receipts(token, bridge.url, after.session, after.epoch);
      result = {
        ok: true, resumedMs: ms,
        tickBefore: before.tick, tickDuring: during.tick, tickAfter: after.tick,
        relay: after.signal?.relay ?? null,
        playerEnergy: after.signal?.playerEnergy ?? null,
        echoEnergy: after.signal?.echoEnergy ?? null,
        receipts: r.receipts ?? [],
        queuedCommands: after.pendingCommands
      };
    } else if (command === '_owner_enter_portal') {
      const expected = body.roomId === undefined || body.roomId === null ? null : Number(body.roomId);
      await closePause(page);
      const pre = await readState(page);
      if (!pre.portal) {
        result = { ok: false, code: 'NO_PORTAL', detail: '当前房间没有传送门' };
      } else {
        await page.evaluate(() => {
          const w = (window as any).__game.scene.getScene('GameScene').world;
          w.player.reset(w.portal.wx, w.portal.wy);
        });
        fixtures.push({
          item: '_owner_enter_portal: player.reset(portal.wx, portal.wy)',
          why: 'Owner 命令过门时的摆位夹具（不是 AI 寻路、不改房间结构）'
        });
        await page.waitForTimeout(400);
        await page.evaluate(() => {
          (window as any).__game.scene.getScene('GameScene').world.player.requestInteract();
        });
        try {
          await page.waitForFunction(({ prev, want }: { prev: number; want: number | null }) => {
            const gs: any = (window as any).__game.scene.getScene('GameScene');
            const id = gs.world.currentRoomId;
            if (id === -1 || id === prev) return false;
            return want === null ? true : id === want;
          }, { prev: pre.roomId, want: expected }, { timeout: 25000 });
        } catch {
          result = { ok: false, code: 'ROOM_ID_TIMEOUT', detail: `没有等到具体 roomId（期望 ${expected ?? 'any != ' + pre.roomId}）` };
        }
        const post = await readState(page);
        await openPause(page);
        await ensureCompanionPanel(page);
        const after = await readState(page);
        result = result.ok === false ? { ...result, roomBefore: pre.roomId, roomAfter: post.roomId } : {
          ok: true, roomBefore: pre.roomId, roomAfter: post.roomId, roomKind: post.roomKind,
          relay: after.signal?.relay ?? null,
          playerEnergy: after.signal?.playerEnergy ?? null,
          echoEnergy: after.signal?.echoEnergy ?? null,
          tick: after.tick
        };
      }
    } else if (command === '_shutdown') {
      await jsonl(OWNER_UI, { command: '_shutdown_requested', state: before });
      // respond first, then tear down (the HTTP reply must reach the adapter).
      setTimeout(() => { void shutdown('control _shutdown'); }, 250);
      result = { ok: true, shuttingDown: true };
    } else {
      result = { ok: false, code: 'E_UNKNOWN_COMMAND', accepted: ['_owner_confirm', '_owner_reject', '_owner_resume', '_owner_enter_portal', '_owner_pause', '_screenshot', '_shutdown'] };
    }

    await jsonl(OWNER_UI, {
      command,
      params: body,
      ok: result.ok !== false,
      result,
      stateBefore: before,
      stateAfter: page ? await readState(page).catch(() => null) : null
    });
    return result;
  };

  server = createServer((req, res) => {
    void (async () => {
      if (!authorizedForControl(req)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'E_PERMISSION' }));
        return;
      }
      if (req.method === 'GET' && (req.url ?? '').startsWith('/state')) {
        const state = page ? await readState(page) : null;
        const r = state ? await receipts(token, bridge.url, state.session, state.epoch) : null;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(redact({ ok: true, state, receipts: r })));
        return;
      }
      if (req.method === 'POST' && (req.url ?? '').startsWith('/control')) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        let body: any = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
        const out = await ownerCommand(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(redact(out)));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND' }));
    })();
  });
  await new Promise<void>((r) => server!.listen(CONTROL_PORT, '127.0.0.1', () => r()));
  log(`[boot] control endpoint ready at http://127.0.0.1:${CONTROL_PORT} (Bearer control token file only)`);

  log('[boot] READY. 服务只属于本次运行；用 adapter 发 echo_* 或 _owner_* 命令。');
  log('[boot] 结束时务必发送 {"_shutdown":true}（会关浏览器/桥/vite 并删除私有凭据文件）。');
}

main().catch(async (error) => {
  process.stderr.write(`[boot] FAIL ${error instanceof Error ? error.message : String(error)}\n`);
  try { await emergencyShutdown?.('bootstrap-failed'); } catch { /* already down */ }
  process.exit(1);
});
