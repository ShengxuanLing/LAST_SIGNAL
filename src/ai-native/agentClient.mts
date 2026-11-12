/**
 * AI-NATIVE-01 P4 — neutral Player MCP agent client.
 *
 * A thin, strategy-free transport wrapper over the official MCP SDK:
 *   listTools() and callTool() only, with a JSONL record of every request/result.
 * It contains NO route, policy, scenario data or game imports, so a real agent
 * (or a human) can drive a Player session step by step.
 *
 * Usage:
 *   node dist-mcp/mcpServer.mjs                      (server, separate process)
 *   npx vite-node src/ai-native/agentClient.mts [--dev] [--log FILE] [--script FILE]
 *
 * Reads JSONL commands from --script (or stdin):
 *   {"op":"list"}
 *   {"op":"call","name":"game_create_session","arguments":{}}
 *   {"op":"quit"}
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO = process.cwd();
const DEFAULT_SERVER = resolve(REPO, 'dist-mcp/mcpServer.mjs');

export interface NeutralAgentOptions {
  readonly serverPath?: string;
  readonly dev?: boolean;
  readonly logPath?: string | null;
  readonly cwd?: string;
}

export class NeutralAgentClient {
  private readonly client: Client;
  private readonly transport: StdioClientTransport;
  private readonly logPath: string | null;

  constructor(options: NeutralAgentOptions = {}) {
    const serverPath = options.serverPath ?? DEFAULT_SERVER;
    if (!existsSync(serverPath)) throw new Error(`missing MCP server: ${serverPath}; run npm run game:mcp:build`);
    this.logPath = options.logPath === undefined ? resolve(REPO, 'p4-agent-session.jsonl') : options.logPath;
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath, ...(options.dev ? ['--dev'] : [])],
      cwd: options.cwd ?? REPO,
      stderr: 'pipe',
    });
    this.transport.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[mcp-server] ${chunk.toString()}`));
    this.client = new Client({ name: 'last-signal-neutral-agent-client', version: '0.4.0' });
  }

  record(entry: Record<string, unknown>): void {
    const line = `${JSON.stringify(entry)}\n`;
    if (this.logPath) appendFileSync(this.logPath, line, 'utf8');
    process.stdout.write(line);
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<unknown> {
    const started = Date.now();
    const result = await this.client.listTools();
    this.record({ at: new Date().toISOString(), op: 'list', ok: true, elapsedMs: Date.now() - started, tools: result.tools.map((t) => t.name).sort() });
    return result;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; isError: boolean; payload: unknown }> {
    const started = Date.now();
    try {
      const result = await this.client.callTool({ name, arguments: args });
      const payload = result.structuredContent ?? null;
      const ok = result.isError !== true && (payload as { ok?: boolean } | null)?.ok !== false;
      this.record({ at: new Date().toISOString(), op: 'call', name, arguments: args, ok, isError: result.isError === true, elapsedMs: Date.now() - started, result: payload });
      return { ok, isError: result.isError === true, payload };
    } catch (error) {
      this.record({ at: new Date().toISOString(), op: 'call', name, arguments: args, ok: false, isError: true, elapsedMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
      return { ok: false, isError: true, payload: null };
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  get pid(): number | null {
    return this.transport.pid;
  }
}

interface AgentCommand { op?: string; name?: string; arguments?: Record<string, unknown> }

export async function runAgentClient(options: NeutralAgentOptions & { scriptPath?: string | null } = {}): Promise<void> {
  const agent = new NeutralAgentClient(options);
  await agent.connect();
  const run = async (command: AgentCommand): Promise<boolean> => {
    if (command.op === 'list') { await agent.listTools(); return true; }
    if (command.op === 'call') {
      if (typeof command.name !== 'string') { agent['record']({ at: new Date().toISOString(), op: 'error', reason: 'call requires name' }); return true; }
      await agent.callTool(command.name, command.arguments ?? {});
      return true;
    }
    if (command.op === 'quit') return false;
    agent.record({ at: new Date().toISOString(), op: 'error', reason: `unknown op ${String(command.op)}` });
    return true;
  };
  if (options.scriptPath) {
    const lines = readFileSync(options.scriptPath, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      if (!(await run(JSON.parse(line) as AgentCommand))) break;
    }
  } else {
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (!(await run(JSON.parse(line) as AgentCommand))) break;
    }
  }
  const pid = agent.pid;
  await agent.close();
  if (pid) {
    await new Promise((r) => setTimeout(r, 200));
    try { process.kill(pid, 0); process.stderr.write('[agent-client] server still alive\n'); } catch { /* exited */ }
  }
}

function parseArgs(argv: string[]): { dev: boolean; logPath: string | undefined; scriptPath: string | null; serverPath?: string } {
  const dev = argv.includes('--dev');
  const value = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const log = value('--log');
  const script = value('--script');
  const server = value('--server');
  return { dev, logPath: log ?? undefined, scriptPath: script, ...(server ? { serverPath: server } : {}) };
}

// Standalone CLI by default; set P4_AGENT_CLIENT_EMBEDDED=1 when importing the class.
const embedded = process.env.P4_AGENT_CLIENT_EMBEDDED === '1';
if (!embedded) {
  const parsed = parseArgs(process.argv.slice(2));
  runAgentClient({ dev: parsed.dev, logPath: parsed.logPath, scriptPath: parsed.scriptPath, ...(parsed.serverPath ? { serverPath: parsed.serverPath } : {}) })
    .then(() => process.exit(0))
    .catch((error) => { process.stderr.write(`[agent-client] fatal: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
}
