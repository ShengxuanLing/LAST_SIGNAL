/**
 * C3c owner-file fix — REAL console startup smoke.
 *
 * The previous bug was a syntax error in `scripts/c3b-mcp-console.mts` that
 * `tsc` did not cover and only surfaced when the script was actually launched.
 * This smoke starts the REAL child process (not just a typecheck/bundle) for:
 *   - `--headless` Player: create -> observe -> quit
 *   - `--headless --dev`: help entry + create(seed) -> quit
 *   - Rendered link: bridge + human handshake -> help/status -> quit
 * and asserts the process prints the expected output and is reaped on `quit`.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { startWorldBridge } from './worldBridgeServer';
import { WorldGateway } from './worldGateway';
import { WORLD_PROTOCOL_VERSION } from './worldProtocol';

const REPO = process.cwd();
const VITE_NODE = resolve(REPO, 'node_modules/vite-node/dist/cli.mjs');
const CONSOLE = resolve(REPO, 'scripts/c3b-mcp-console.mts');

function log(message: string, data?: unknown): void {
  process.stdout.write(`${message}${data === undefined ? '' : ` | ${JSON.stringify(data)}`}\n`);
}
function fail(message: string, data?: unknown): never {
  process.stderr.write(`FAIL ${message}${data === undefined ? '' : ` | ${JSON.stringify(data)}`}\n`);
  process.exit(1);
}
function assert(condition: unknown, message: string, data?: unknown): asserts condition {
  if (!condition) fail(message, data);
}

interface RunResult { code: number | null; stdout: string; stderr: string; reaped: boolean }

async function runConsole(args: string[], input: string, env: Record<string, string> = {}, timeoutMs = 20_000): Promise<RunResult> {
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath, [VITE_NODE, CONSOLE, ...args],
    { env: { ...process.env, ...env } as never, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += String(d); });
  child.stderr.on('data', (d) => { stderr += String(d); });
  child.stdin.write(input);
  child.stdin.end();
  const reaped = await new Promise<boolean>((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), timeoutMs);
    child.on('exit', () => { clearTimeout(timer); resolveExit(true); });
  });
  if (!reaped) { try { child.kill('SIGKILL'); } catch { /* ignore */ } }
  return { code: child.exitCode, stdout, stderr, reaped };
}

async function main(): Promise<void> {
  // ---- 1) headless Player: create -> observe -> quit ----
  const player = await runConsole(['--headless'], 'create\nobserve\nquit\n');
  assert(player.reaped, 'player console reaped after quit', player.stderr);
  assert(player.code === 0, 'player console exit code 0', { code: player.code, stderr: player.stderr });
  assert(player.stdout.includes('CONNECTED console mode=headless'), 'player console started', player.stdout.slice(0, 200));
  assert(player.stdout.includes('"ok":true') && player.stdout.includes('"session"'), 'player create/observe succeeded');
  assert(!player.stderr.includes('Unterminated'), 'player console has no syntax error', player.stderr);
  log('PASS console_headless_player', { code: player.code });

  // ---- 2) headless Dev: help + create(seed) -> quit ----
  const dev = await runConsole(['--headless', '--dev'], 'help\ncreate 424242\nquit\n');
  assert(dev.reaped && dev.code === 0, 'dev console reaped/exit 0', { code: dev.code, stderr: dev.stderr });
  assert(dev.stdout.includes('create [seed]') && dev.stdout.includes('step <ticks>'), 'dev help lists create/step', dev.stdout.slice(0, 300));
  assert(dev.stdout.includes('424242'), 'dev create accepted the explicit seed', dev.stdout.slice(-300));
  log('PASS console_headless_dev_help', { code: dev.code });

  // ---- 3) Rendered link: bridge + human handshake -> help/status -> quit ----
  const token = randomBytes(24).toString('hex');
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token, allowedOrigins: ['http://localhost:5335'] });
  try {
    const hs = await fetch(`${bridge.url}/world-link/handshake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, origin: 'http://localhost:5335' },
      body: JSON.stringify({ authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION })
    });
    assert(hs.ok, 'human handshake for the rendered console');
    const rendered = await runConsole([], 'help\nstatus\nquit\n', {
      LAST_SIGNAL_WORLD_BRIDGE_URL: bridge.url,
      LAST_SIGNAL_WORLD_TOKEN: token
    });
    assert(rendered.reaped && rendered.code === 0, 'rendered console reaped/exit 0', { code: rendered.code, stderr: rendered.stderr });
    assert(rendered.stdout.includes('CONNECTED console mode=rendered'), 'rendered console started', rendered.stdout.slice(0, 200));
    assert(rendered.stdout.includes('list | observe | act'), 'rendered help entry lists the tools', rendered.stdout.slice(0, 300));
    assert(rendered.stdout.includes('"attached":true') || rendered.stdout.includes('"session"'), 'rendered status works');
    log('PASS console_rendered_help', { code: rendered.code });
  } finally {
    await bridge.close();
  }

  log('WORLD_CONSOLE_SMOKE_PASS');
}

main().catch((error) => fail('console startup smoke', error instanceof Error ? error.message : String(error)));
