/**
 * AI-NATIVE-02 P3-b A — official COMPANION SDK REPL (NO confirm command).
 *
 * The Lead/agent keeps ONE MCP server process (same session/lease) and chooses
 * each suggestion autonomously; Owner confirmation happens ONLY in the real
 * game UI. All tool I/O is logged as REDACTED JSONL (token/secret never logged).
 *
 *   LAST_SIGNAL_WORLD_BRIDGE_URL=... LAST_SIGNAL_WORLD_TOKEN=... \
 *     npx vite-node scripts/p3b-companion-console.mts
 *   ... --smoke   # startup -> listTools -> observe -> status -> quit
 */
import { createInterface } from 'node:readline';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const args = process.argv.slice(2);
const smoke = args.includes('--smoke');
const logPath = resolve(args[args.indexOf('--log') + 1] ?? 'reports/ai-native-02/p3b/evidence/companion-io.jsonl');
const bridgeUrl = (process.env.LAST_SIGNAL_WORLD_BRIDGE_URL ?? '').replace(/\/$/, '');
const tokenFile = process.env.LAST_SIGNAL_WORLD_TOKEN_FILE ?? '';
let token = process.env.LAST_SIGNAL_WORLD_TOKEN ?? '';

const REDACT_KEYS = /token|authorization|bridgeurl|secret|password|apikey|ownerSecret/i;
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
function fail(message: string): never { process.stderr.write(`FAIL ${message}\n`); process.exit(1); }
const hex = (n = 12): string => randomBytes(n).toString('hex');

async function main(): Promise<void> {
  if (!token && tokenFile) token = (await readFile(tokenFile, 'utf8')).trim();
  if (!bridgeUrl || !token) fail('LAST_SIGNAL_WORLD_BRIDGE_URL and token are required (token never printed)');
  const server = resolve(process.cwd(), 'dist-mcp/companionMcpServer.mjs');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: bridgeUrl, LAST_SIGNAL_WORLD_TOKEN: token } as never,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'companion-console', version: '0.1.0' });
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  for (const forbidden of ['confirm', 'reject', 'step', 'dev', 'owner']) {
    if (names.some((n) => n.includes(forbidden))) fail(`console surface includes forbidden ${forbidden}`);
  }
  process.stdout.write(`CONNECTED companion | tools=${names.join(',')}\n`);
  await writeLog({ event: 'connect', tools: names, bridgeUrl: '<redacted>' });

  const call = async (tool: string, toolArgs: Record<string, unknown> = {}): Promise<any> => {
    const started = Date.now();
    const result = await client.callTool({ name: tool, arguments: toolArgs });
    const body = (result.structuredContent as Record<string, unknown> | undefined) ?? { ok: false, code: 'E_SCHEMA' };
    await writeLog({ tool, args: toolArgs, result: body, ms: Date.now() - started });
    return body;
  };
  const print = (body: unknown): void => { process.stdout.write(`${JSON.stringify(body)}
`); };

  if (smoke) {
    const observe = await call('echo_observe');
    const status = await call('echo_status');
    const memory = await call('echo_memory');
    print({ observe: observe.ok, status: status.ok, memory: memory.ok });
    await client.close();
    process.stdout.write('COMPANION_CONSOLE_SMOKE_PASS\n');
    return;
  }

  const help = 'observe | suggest <kind> <reason> [x y] [ttlTicks] | status | memory | quit\n'
    + 'kinds: move aim fire scan jam | reasons: perceived_hostile perceived_relay no_perceived_target objective_blocked\n'
    + 'CONFIRM/REJECT are NOT available here: the human Owner confirms inside the game UI.';
  process.stdout.write(`${help}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const shutdown = (): void => { rl.close(); void client.close().finally(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  rl.on('line', (raw) => {
    const [command, ...rest] = raw.trim().split(/\s+/);
    if (!command) return;
    void (async () => {
      try {
        switch (command) {
          case 'help': process.stdout.write(`${help}\n`); return;
          case 'observe': print(await call('echo_observe')); return;
          case 'status': print(await call('echo_status')); return;
          case 'memory': print(await call('echo_memory')); return;
          case 'suggest': {
            const [kind, reason, x, y, ttl] = rest;
            if (!kind || !reason) { process.stdout.write('suggest <kind> <reason> [x y] [ttlTicks]\n'); return; }
            const target = x !== undefined && y !== undefined ? { x: Number(x), y: Number(y) } : undefined;
            print(await call('echo_suggest', {
              requestId: `req_${hex()}`, suggestionId: `sug_${hex()}`,
              kind, reason, ...(target ? { target } : {}),
              ...(ttl ? { ttlTicks: Number(ttl) } : {})
            }));
            return;
          }
          case 'quit': shutdown(); return;
          case 'confirm':
          case 'reject':
            process.stdout.write('OWNER-ONLY: use the in-game Pause COMPANION panel.\n');
            return;
          default: process.stdout.write('unknown command\n');
        }
      } catch (error) {
        process.stdout.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
      }
    })();
  });
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
