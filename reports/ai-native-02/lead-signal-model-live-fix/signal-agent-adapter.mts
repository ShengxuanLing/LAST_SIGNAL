/**
 * AI-NATIVE-02 Task C · Lead 模型 Signal 遭遇 —— 官方 Companion MCP 的“纯透传”适配器
 *
 * 设计原则（与 lead-echo-model-live 的 adapter 一致）：
 *   - 本程序没有任何策略：不循环、不自动建议、不改参数、不重试、不兜底。
 *   - Lead 每行写一条 JSON；tool 行原样 callTool，并把**原始响应**落盘 + 截图。
 *   - Owner 命令是**显式本地命令**（下划线开头），代表“人类在游戏 UI 里点了一下”，
 *     走 owner-bootstrap 的 control 端点做真实点击 / 真实帧；适配器从不写 sim 状态。
 *   - Agent 子进程环境只有 bridgeUrl + token 文件路径；**没有** Owner key / ownerCap /
 *     confirm 能力。
 *
 * 运行（仓库根目录，先启动 owner-bootstrap）：
 *   npx vite-node reports/ai-native-02/lead-signal-model-live/signal-agent-adapter.mts
 *
 * stdin 每行一条 JSON（UTF-8）：
 *   工具（原样透传）：
 *     {"tool":"echo_observe","args":{}}
 *     {"tool":"echo_suggest","args":{"requestId":"req_<24hex>","suggestionId":"sug_<24hex>","kind":"scan","reason":"perceived_relay","ttlTicks":600}}
 *     {"tool":"echo_status","args":{}}
 *     {"tool":"echo_memory","args":{}}
 *   Owner 命令（人类动作，不走模型、不写状态）：
 *     {"_owner_confirm":true}                    真实点击 CONFIRM FIRST PROPOSAL (OWNER)
 *     {"_owner_reject":true}                     真实点击 REJECT FIRST PROPOSAL
 *     {"_owner_resume":{"milliseconds":600}}     关 Pause → 真实帧 N ms → 再开 Pause
 *     {"_owner_enter_portal":{"roomId":5}}       过门（roomId 可省略；等待具体 roomId）
 *     {"_owner_pause":true}                      确保停在 Owner 面板
 *     {"_screenshot":"label"}                    手动截图
 *     {"_shutdown":true}                         清理本次运行（仅自有进程/凭据）
 *   本地（不碰服务）：
 *     {"_help":true}  {"_quit":true}
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createInterface } from 'node:readline';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const REPO = process.cwd();
const OUT = resolve(REPO, 'reports/ai-native-02/lead-signal-model-live-fix');
const TOOL_IO = resolve(OUT, 'tool-io.jsonl');
const SERVER = resolve(REPO, 'dist-mcp/companionMcpServer.mjs');

interface Bootstrap {
  urls: { bridge: string; control: string; game: string };
  credentials: { tokenFile: string; controlTokenFile: string; ownerKeyFile: string };
  commit: string;
  fixtures: Array<{ item: string; why: string; detail?: string }>;
}

const secrets = new Set<string>();
function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const s of secrets) if (s && out.includes(s)) out = out.split(s).join('<redacted>');
    return out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const dst: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'ownerCap' || k === 'x-owner-cap' || k === 'token' || k === 'ownerKey') { dst[k] = '<redacted>'; continue; }
      dst[k] = redact(v);
    }
    return dst;
  }
  return value;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  // 1) 定位运行中的 bootstrap（env 优先，其次读 bootstrap.json）
  let bootstrap: Bootstrap | null = null;
  try {
    bootstrap = JSON.parse(await readFile(resolve(OUT, 'bootstrap.json'), 'utf8')) as Bootstrap;
  } catch { bootstrap = null; }
  const controlUrl = process.env.SIGNAL_RUN_CONTROL_URL ?? bootstrap?.urls.control ?? '';
  const controlTokenFile = process.env.SIGNAL_RUN_CONTROL_TOKEN_FILE ?? bootstrap?.credentials.controlTokenFile ?? '';
  const bridgeUrl = process.env.LAST_SIGNAL_WORLD_BRIDGE_URL ?? bootstrap?.urls.bridge ?? '';
  const tokenFile = process.env.LAST_SIGNAL_WORLD_TOKEN_FILE ?? bootstrap?.credentials.tokenFile ?? '';
  if (!controlUrl || !controlTokenFile || !bridgeUrl || !tokenFile) {
    process.stderr.write('FAIL: 缺少 control/bridge 配置。请先启动 owner-bootstrap.mts，或显式设置 SIGNAL_RUN_CONTROL_URL / SIGNAL_RUN_CONTROL_TOKEN_FILE / LAST_SIGNAL_WORLD_BRIDGE_URL / LAST_SIGNAL_WORLD_TOKEN_FILE\n');
    process.exit(2);
  }
  const controlToken = (await readFile(controlTokenFile, 'utf8')).trim();
  secrets.add(controlToken);
  try { secrets.add((await readFile(tokenFile, 'utf8')).trim()); } catch { /* token 只在子进程里用 */ }

  process.stdout.write(`ATTACHED bridge=${bridgeUrl} control=${controlUrl}\n`);
  process.stdout.write('NO STRATEGY HERE: 每行一条 JSON，tool 行原样 callTool；下划线命令是 Owner 人类动作。\n');

  // 2) 官方 Companion MCP 子进程：环境白名单，绝无 Owner key / cap
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    TEMP: process.env.TEMP ?? '',
    TMP: process.env.TMP ?? '',
    LAST_SIGNAL_WORLD_BRIDGE_URL: bridgeUrl,
    LAST_SIGNAL_WORLD_TOKEN_FILE: tokenFile
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: childEnv as never,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'lead-signal-model-live', version: '0.0.0' });
  await client.connect(transport);
  await appendFile(TOOL_IO, `${JSON.stringify({
    at: new Date().toISOString(),
    event: 'attach',
    server: SERVER,
    bridge: bridgeUrl,
    childEnvKeys: Object.keys(childEnv),
    note: 'Agent 子进程环境只含 bridgeUrl + token 文件路径；无 Owner key / ownerCap / confirm'
  })}\n`);
  process.stdout.write(`childEnvKeys=${Object.keys(childEnv).join(',')}\n`);

  let round = 0;

  const control = async (body: Record<string, unknown>): Promise<any> => {
    const res = await fetch(`${controlUrl}/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${controlToken}` },
      body: JSON.stringify(body)
    });
    return res.json();
  };

  const help = (): void => {
    process.stdout.write([
      '工具行（原样透传，无策略）：',
      '  {"tool":"echo_observe","args":{}}',
      '  {"tool":"echo_suggest","args":{"requestId":"req_...","suggestionId":"sug_...","kind":"scan|jam|toggle-relay|move|aim|fire","reason":"perceived_relay|objective_blocked|perceived_hostile|no_perceived_target","ttlTicks":600}}',
      '  {"tool":"echo_status","args":{}}',
      '  {"tool":"echo_memory","args":{}}',
      'Owner 命令（人类动作，真实点击/真实帧）：',
      '  {"_owner_confirm":true}  {"_owner_reject":true}',
      '  {"_owner_resume":{"milliseconds":600}}',
      '  {"_owner_enter_portal":{"roomId":5}}   // roomId 可省略',
      '  {"_owner_pause":true}  {"_screenshot":"label"}  {"_shutdown":true}',
      '本地：{"_help":true} {"_quit":true}'
    ].join('\n') + '\n');
  };

  const handle = async (raw: string): Promise<void> => {
    const line = raw.trim();
    if (!line) return;
    let msg: any;
    try { msg = JSON.parse(line); } catch {
      process.stdout.write(JSON.stringify({ ok: false, code: 'E_JSON', detail: '每行必须是 JSON' }) + '\n');
      return;
    }

    if (msg._help) { help(); return; }
    if (msg._quit) { process.stdout.write(JSON.stringify({ ok: true, quit: true, note: '服务仍在运行，用 {"_shutdown":true} 清理' }) + '\n'); process.exit(0); }

    if (typeof msg.tool === 'string') {
      const myRound = (round += 1);
      const started = Date.now();
      const args = msg.args ?? {};
      let res: any; let error: string | null = null;
      try {
        res = await client.callTool({ name: msg.tool, arguments: args }) as any;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        res = null;
      }
      const record = {
        round: myRound,
        tool: msg.tool,
        args,
        ms: Date.now() - started,
        error,
        raw: res ? { content: res.content, structuredContent: res.structuredContent, isError: res.isError ?? false } : null
      };
      await appendFile(TOOL_IO, `${JSON.stringify(redact(record))}\n`);
      // 原始响应原样回给 Lead（只做 secret 脱敏）
      process.stdout.write(`${JSON.stringify(redact(record))}\n`);
      // 每轮截图（由 owner-bootstrap 在浏览器里拍）
      const s = await control({ command: '_screenshot', label: `tool-${myRound}-${msg.tool}` }).catch(() => null);
      if (s?.file) process.stdout.write(`${JSON.stringify({ screenshot: s.file })}\n`);
      return;
    }

    const ownerMap: Array<[string, string]> = [
      ['_owner_confirm', '_owner_confirm'],
      ['_owner_reject', '_owner_reject'],
      ['_owner_resume', '_owner_resume'],
      ['_owner_enter_portal', '_owner_enter_portal'],
      ['_owner_pause', '_owner_pause'],
      ['_screenshot', '_screenshot'],
      ['_shutdown', '_shutdown']
    ];
    for (const [key, command] of ownerMap) {
      if (!(key in msg)) continue;
      const params = msg[key];
      const payload: Record<string, unknown> = { command };
      if (key === '_owner_resume') payload.milliseconds = params?.milliseconds ?? 600;
      if (key === '_owner_enter_portal' && params?.roomId !== undefined) payload.roomId = params.roomId;
      if (key === '_screenshot') payload.label = typeof params === 'string' ? params : 'manual';
      const result = await control(payload);
      process.stdout.write(`${JSON.stringify({ ownerCommand: command, result })}\n`);
      if (key === '_shutdown') {
        // 给 owner-bootstrap 留出冲刷录像/删凭据的时间，再退出适配器。
        await new Promise((r) => setTimeout(r, 2500));
        await client.close().catch(() => undefined);
        await writeFile(resolve(OUT, 'adapter-shutdown.json'), JSON.stringify({
          at: new Date().toISOString(), rounds: round, reason: 'adapter _shutdown'
        }, null, 2));
        process.exit(0);
      }
      return;
    }

    process.stdout.write(JSON.stringify({ ok: false, code: 'E_UNKNOWN_LINE', line: redact(line) }) + '\n');
  };

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  // 串行化：一行处理完再处理下一行（不并发调用同一 MCP 会话）。
  let queue: Promise<void> = Promise.resolve();
  rl.on('line', (line) => {
    queue = queue.then(() => handle(line)).catch((e) => {
      process.stdout.write(JSON.stringify({ ok: false, code: 'E_ADAPTER', detail: e instanceof Error ? e.message : String(e) }) + '\n');
    });
  });
  await new Promise<void>((r) => rl.on('close', () => r()));
  await queue;
  await client.close().catch(() => undefined);
}

main().catch((e) => {
  process.stderr.write(`FAIL adapter: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
