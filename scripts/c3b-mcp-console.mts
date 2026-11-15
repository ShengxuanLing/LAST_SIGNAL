/**
 * AI-NATIVE-02 C3-c — official WORLD MCP client console (rendered OR headless).
 *
 * ONE MCP server process holds the session(s), so the Lead can keep the SAME
 * session/lease across many commands. Every tool argument and result is written
 * to a JSONL log with credentials REDACTED. No strategy is pre-written: the
 * operator/agent calls `observe`, then CHOOSES an action.
 *
 * Rendered link:
 *   LAST_SIGNAL_WORLD_BRIDGE_URL=... LAST_SIGNAL_WORLD_TOKEN_FILE=... \
 *     npm run game:world:mcp-console
 * Headless same-core (no bridge, no token):
 *   npm run game:world:mcp-console -- --headless
 *   npm run game:world:mcp-console -- --headless --dev
 *
 * One-shot JSON:
 *   ... -- --json '{"tool":"world_observe","args":{}}'
 *
 * Headless REPL extras:
 *   create [seed] | step <ticks> | inspect | snapshot
 *   loadroom <roomId> <kinds> | spawn <kinds> | batch <seeds> <maxTicks>
 *   compare <seeds> <maxTicks> | perf <ticks> <sessions> | exportfailure <reason>
 *   signal | session <id> | epoch <n>
 */
import { createInterface } from 'node:readline';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const value = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const bridgeUrl = (process.env.LAST_SIGNAL_WORLD_BRIDGE_URL ?? '').replace(/\/$/, '');
const tokenFile = process.env.LAST_SIGNAL_WORLD_TOKEN_FILE ?? '';
let token = process.env.LAST_SIGNAL_WORLD_TOKEN ?? '';
const headless = flag('--headless');
const dev = flag('--dev');
const rendered = !headless;
const logPath = resolve(value('--log') ?? 'reports/ai-native-02/c3c/tool-io/session.jsonl');
const jsonArg = value('--json');

const REDACT_KEYS = /token|authorization|bridgeurl|secret|password|apikey/i;
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.test(k) ? '<redacted>' : redact(v);
  }
  return out;
}

async function writeLog(entry: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(redact({ at: new Date().toISOString(), ...entry }))}\n`, 'utf8');
}

function fail(message: string): never {
  process.stderr.write(`FAIL ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (rendered) {
    if (!token && tokenFile) token = (await readFile(tokenFile, 'utf8')).trim();
    if (!bridgeUrl) fail('LAST_SIGNAL_WORLD_BRIDGE_URL is required for the rendered link');
    if (!token) fail('token is required (LAST_SIGNAL_WORLD_TOKEN[_FILE]); never printed');
  }
  const server = headless
    ? resolve(process.cwd(), 'dist-mcp/worldHeadlessMcpServer.mjs')
    : resolve(process.cwd(), 'dist-mcp/worldMcpServer.mjs');
  const serverArgs = headless ? (dev ? ['--dev'] : []) : [];
  const env = headless
    ? { ...process.env }
    : { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: bridgeUrl, LAST_SIGNAL_WORLD_TOKEN: token };

  const transport = new StdioClientTransport({
    command: process.execPath, args: [server, ...serverArgs], env: env as never, stderr: 'pipe'
  });
  const client = new Client({ name: 'world-console', version: '0.2.0' });
  await client.connect(transport);

  let session: string | undefined;
  let epoch: number | undefined;

  const call = async (tool: string, toolArgs: Record<string, unknown> = {}): Promise<any> => {
    const started = Date.now();
    const result = await client.callTool({ name: tool, arguments: toolArgs });
    const body = (result.structuredContent as Record<string, unknown> | undefined)
      ?? { ok: false, code: 'E_SCHEMA' };
    await writeLog({ tool, args: toolArgs, result: body, ms: Date.now() - started });
    if (typeof body.session === 'string') session = body.session as string;
    if (typeof body.epoch === 'number') epoch = body.epoch as number;
    return body;
  };
  const print = (body: unknown): void => { process.stdout.write(`${JSON.stringify(body)}\n`); };
  const needSession = (): string => {
    if (!session) { process.stdout.write('NO SESSION: run "create" (headless) or "list" first\n'); throw new Error('no session'); }
    return session;
  };
  const parseList = (raw: string | undefined, fallback: number[]): number[] => {
    if (!raw) return fallback;
    return raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  };

  const runLine = async (line: string): Promise<boolean> => {
    const [command, ...rest] = line.trim().split(/\s+/);
    if (!command) return true;
    try {
      switch (command) {
        case 'help':
          process.stdout.write(headless
            ? 'create [seed] | list | observe | act <actions-json> [ttlTicks] | step <ticks> | inspect | snapshot | loadroom <roomId> <kinds> | spawn <kinds> | batch <seeds> <maxTicks> | compare <seeds> <maxTicks> | perf <ticks> <sessions> | exportfailure <reason> | signal | session <id> | epoch <n> | close | quit\n'
            : 'list | observe | act <actions-json> [ttlTicks] | raw <tool> <args-json> | status | close | quit\n');
          return true;
        case 'list':
        case 'status':
          print(await call('world_list_sessions')); return true;
        case 'create':
          print(await call('world_headless_create_session', rest[0] ? { seed: Number(rest[0]) } : {})); return true;
        case 'observe':
          print(await call('world_observe', session ? { session } : {})); return true;
        case 'session':
          session = rest[0]; process.stdout.write(`SESSION ${session}\n`); return true;
        case 'epoch':
          epoch = Number(rest[0]); process.stdout.write(`EPOCH ${epoch}\n`); return true;
        case 'act': {
          const actions = JSON.parse(rest[0] ?? '[]');
          const ttl = rest[1] ? Number(rest[1]) : 600;
          const requestId = `req_${Date.now().toString(16).padStart(24, '0').slice(-24)}`;
          print(await call('world_action', {
            session: needSession(), epoch: epoch ?? 1, requestId, actions, ttlTicks: ttl
          }));
          return true;
        }
        case 'step': {
          const ticks = Number(rest[0] ?? 1);
          // Player channel: `step` NEVER sends a direct intent; queue with `act`.
          // Only Dev may pass a strict fixture intent as the second argument.
          const intent = headless && dev && rest[1] ? JSON.parse(rest[1]) : undefined;
          if (rest[1] && !(headless && dev)) {
            process.stdout.write('NOTE: Player step has no direct intent; queue it with "act" first. Ignoring the intent argument.' + String.fromCharCode(10));
          }
          const requestId = `req_${Date.now().toString(16).padStart(24, '0').slice(-24)}`;
          {
            const stepBody = await call('world_headless_step', {
              session: needSession(), epoch: epoch ?? 1, requestId, ticks, ...(intent ? { intent } : {})
            });
            // Keep stdout readable; the full canonical state/events are in the log.
            const { canonicalState: _cs, canonicalEvents: _ce, ...compact } = stepBody;
            print(compact);
          }
          return true;
        }
        case 'inspect':
          print(await call('world_headless_dev_inspect', { session: needSession() })); return true;
        case 'snapshot':
          print(await call('world_headless_dev_snapshot', { session: needSession() })); return true;
        case 'loadroom': {
          const roomId = Number(rest[0]);
          const kinds = (rest[1] ?? 'drone').split(',');
          print(await call('world_headless_dev_load_room', { session: needSession(), roomId, kinds })); return true;
        }
        case 'spawn':
          print(await call('world_headless_dev_spawn_enemies', {
            session: needSession(), kinds: (rest[0] ?? 'drone').split(',')
          })); return true;
        case 'batch':
          print(await call('world_headless_dev_batch', {
            seeds: parseList(rest[0], [424242]), maxTicks: Number(rest[1] ?? 600)
          })); return true;
        case 'compare':
          print(await call('world_headless_dev_compare', {
            seeds: parseList(rest[0], [424242]), maxTicks: Number(rest[1] ?? 600)
          })); return true;
        case 'perf':
          print(await call('world_headless_dev_perf', {
            ticks: Number(rest[0] ?? 1000), sessions: Number(rest[1] ?? 10)
          })); return true;
        case 'exportfailure':
          print(await call('world_headless_dev_export_failure', {
            session: needSession(), reason: rest.join(' ') || 'manual'
          })); return true;
        case 'signal':
          print(await call('world_signal_status')); return true;
        case 'raw': {
          const tool = rest[0];
          const toolArgs = rest[1] ? JSON.parse(rest[1]) : {};
          print(await call(tool, toolArgs)); return true;
        }
        case 'close':
          print(await call('world_close', session ? { session } : {}));
          session = undefined; epoch = undefined;
          return false;
        case 'quit':
        case 'exit':
          return false;
        default:
          process.stdout.write(`UNKNOWN_COMMAND ${command} (try "help")\n`);
          return true;
      }
    } catch (error) {
      process.stderr.write(`COMMAND_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
      return true;
    }
  };

  if (jsonArg) {
    const spec = JSON.parse(jsonArg) as { tool: string; args?: Record<string, unknown> };
    print(await call(spec.tool, spec.args ?? {}));
    await client.close();
    return;
  }

  process.stdout.write(
    `CONNECTED console mode=${headless ? `headless${dev ? ':dev' : ''}` : 'rendered'} server=${server} log=${logPath}\n`
    + (headless
      ? 'Round: "create" -> "observe" -> "act <actions-json>" -> "step <ticks>" -> "observe" (Player MUST queue; step has no intent).\n'
      : 'Round: "observe" -> choose action -> "act <actions-json>" -> "observe".\n')
    + 'queued is NOT applied; observe the new tick and receipt before claiming effect.\n'
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  for await (const line of rl) {
    if (!(await runLine(line))) break;
  }
  rl.close();
  await client.close();
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
