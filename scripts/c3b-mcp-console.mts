/**
 * AI-NATIVE-02 C3-b — official WORLD MCP client console (round by round).
 *
 * This is the FORMAL tool for a Lead/agent to drive the RENDERED world link
 * through the OFFICIAL MCP server over real stdio protocol frames:
 *   list -> observe -> action(a) -> observe -> action(b) -> ... -> close
 *
 * Each round: the operator/agent calls `observe`, then CHOOSES an action.
 * No strategy is pre-written here. Every tool argument and result is written
 * to a real JSONL log (no token, no secret).
 *
 * Usage:
 *   LAST_SIGNAL_WORLD_BRIDGE_URL=http://127.0.0.1:8787 \
 *   LAST_SIGNAL_WORLD_TOKEN_FILE=<secure file> \
 *   npm run game:world:console
 *
 *   # one-shot JSON call (for scripted rounds):
 *   npm run game:world:console -- --json '{"tool":"world_observe","args":{}}'
 *   npm run game:world:console -- --json '{"tool":"world_action","args":{"requestId":"req_...","actions":[...]}}'
 *
 * REPL commands:
 *   list | observe | act <actions-json> [ttlTicks] | raw <tool> <args-json>
 *   status | help | close | quit
 *
 * Flags:
 *   --rendered        use `mcpServer.mjs --world` instead of worldMcpServer.mjs
 *   --headless        reserved; requires a C3-c headless binary (not built here)
 *   --log <path>      JSONL tool I/O log path
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
const logPath = resolve(value('--log') ?? 'reports/ai-native-02/c3b-fixes/tool-io/session.jsonl');
const rendered = flag('--rendered');
const headless = flag('--headless');
const jsonArg = value('--json');

async function writeLog(entry: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

function fail(message: string): never {
  process.stderr.write(`FAIL ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!token && tokenFile) token = (await readFile(tokenFile, 'utf8')).trim();
  if (!bridgeUrl) fail('LAST_SIGNAL_WORLD_BRIDGE_URL is required');
  if (!token) fail('token is required (LAST_SIGNAL_WORLD_TOKEN[_FILE]); never printed');

  const server = headless
    ? resolve(process.cwd(), 'dist-mcp/worldHeadlessMcpServer.mjs')
    : rendered
      ? resolve(process.cwd(), 'dist-mcp/mcpServer.mjs')
      : resolve(process.cwd(), 'dist-mcp/worldMcpServer.mjs');
  const serverArgs = rendered && !headless ? ['--world'] : [];

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server, ...serverArgs],
    env: {
      ...process.env,
      LAST_SIGNAL_WORLD_BRIDGE_URL: bridgeUrl,
      LAST_SIGNAL_WORLD_TOKEN: token
    } as never,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'c3b-world-console', version: '0.1.0' });
  await client.connect(transport);

  const call = async (tool: string, toolArgs: Record<string, unknown> = {}): Promise<any> => {
    const started = Date.now();
    const result = await client.callTool({ name: tool, arguments: toolArgs });
    const body = result.structuredContent as Record<string, unknown> | undefined;
    await writeLog({ tool, args: toolArgs, result: body, ms: Date.now() - started });
    return body;
  };

  const print = (body: unknown): void => {
    process.stdout.write(`${JSON.stringify(body)}\n`);
  };

  const runLine = async (line: string): Promise<boolean> => {
    const [command, ...rest] = line.trim().split(/\s+/);
    if (!command) return true;
    switch (command) {
      case 'help':
        process.stdout.write('list | observe | act <actions-json> [ttlTicks] | raw <tool> <args-json> | status | close | quit\n');
        return true;
      case 'list':
      case 'status':
        print(await call('world_list_sessions'));
        return true;
      case 'observe':
        print(await call('world_observe'));
        return true;
      case 'act': {
        const actions = JSON.parse(rest[0] ?? '[]');
        const ttl = rest[1] ? Number(rest[1]) : 600;
        const requestId = `req_${Date.now().toString(16).padStart(24, '0').slice(-24)}`;
        print(await call('world_action', { requestId, actions, ttlTicks: ttl }));
        return true;
      }
      case 'raw': {
        const tool = rest[0];
        const toolArgs = rest[1] ? JSON.parse(rest[1]) : {};
        print(await call(tool, toolArgs));
        return true;
      }
      case 'close':
        print(await call('world_close'));
        return false;
      case 'quit':
      case 'exit':
        return false;
      default:
        process.stdout.write(`UNKNOWN_COMMAND ${command} (try "help")\n`);
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
    `CONNECTED console server=${server}${serverArgs.join(' ')} log=${logPath}\n`
    + 'Round: "observe" -> choose action -> "act <actions-json>" -> "observe"\n'
    + 'status=queued is NOT applied; observe the new tick and receipt before claiming effect.\n'
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  let open = true;
  for await (const line of rl) {
    open = await runLine(line);
    if (!open) break;
  }
  rl.close();
  await client.close();
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
