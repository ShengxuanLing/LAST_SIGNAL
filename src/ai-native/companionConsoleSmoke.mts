/** P3-b A — REAL official Companion MCP console startup smoke (not just build). */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { WorldGateway } from './worldGateway';
import { startWorldBridge } from './worldBridgeServer';
import { TEST_OWNER_KEY_HASH } from './ownerAuthFixture';

const ORIGIN = 'http://localhost:5335';
const TOKEN = randomBytes(24).toString('hex');
const fail = (m: string): never => { process.stderr.write(`FAIL ${m}\n`); process.exit(1); };
const log = (m: string): void => { process.stdout.write(`${m}\n`); };

async function main(): Promise<void> {
  const bridge = await startWorldBridge({
    gateway: new WorldGateway(), token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
  });
  try {
    const post = async (path: string, body: unknown, origin?: string): Promise<any> => {
      const r = await fetch(`${bridge.url}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json', authorization: `Bearer ${TOKEN}`,
          ...(origin ? { origin } : {})
        },
        body: JSON.stringify(body)
      });
      return r.json();
    };
    // Human handshake: proves possession of the host-private pairing key.
    const hs = await post('/world-link/handshake', { authorized: true, protocolVersion: 1, ownerKey: 'a'.repeat(64) }, ORIGIN);
    if (!hs.ok) fail(`handshake: ${JSON.stringify(hs)}`);
    const session = hs.session as string;
    const epoch = hs.epoch as number;
    const ownerCap = hs.ownerCap as string;
    if (typeof ownerCap !== 'string') fail(`no ownerCap in handshake: ${JSON.stringify(hs)}`);
    // Owner authorize registers the issued capability.
    const auth = await post('/world-link/companion-authorize', { session, epoch, ownerCap, ownerMode: 'human' }, ORIGIN);
    if (!auth.ok) fail(`companion-authorize: ${JSON.stringify(auth)}`);
    const cap = auth.ownerCap as string;
    if (typeof cap !== 'string') fail(`no ownerCap in authorize: ${JSON.stringify(auth)}`);
    const observation = {
      epoch, tick: 1, player: { x: 0, y: 0 },
      echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
      drones: [{ id: 1, x: 1, y: 0, hp: 5 }],
      schema: 'last_signal.echo-observation.v1',
      perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true },
      targets: []
    };
    const pushed = await post('/world-link/companion-observation', { session, epoch, observation, ownerCap: cap }, ORIGIN);
    if (!pushed.ok) fail(`companion-observation: ${JSON.stringify(pushed)}`);

    const child = spawn(process.execPath, [
      resolve('node_modules/vite-node/dist/cli.mjs'),
      resolve('scripts/p3b-companion-console.mts'), '--smoke',
      '--log', resolve('reports/ai-native-02/p3b/evidence/companion-console-io.jsonl')
    ], {
      env: {
        ...process.env,
        LAST_SIGNAL_WORLD_BRIDGE_URL: bridge.url,
        LAST_SIGNAL_WORLD_TOKEN: TOKEN
      } as never,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    const reaped = await new Promise<boolean>((done) => {
      const timer = setTimeout(() => done(false), 30_000);
      child.on('exit', () => { clearTimeout(timer); done(true); });
    });
    if (!reaped) { try { child.kill('SIGKILL'); } catch { /* ignore */ } }
    if (!out.includes('CONNECTED companion')) fail(`console startup missing: ${out.slice(0, 200)} ${err.slice(0, 200)}`);
    for (const name of ['echo_observe', 'echo_suggest', 'echo_status', 'echo_memory']) {
      if (!out.includes(name)) fail(`missing tool ${name}: ${out.slice(0, 200)}`);
    }
    for (const forbidden of ['confirm', 'reject', 'owner_decide', 'step_player']) {
      if (out.toLowerCase().includes(forbidden)) fail(`forbidden tool ${forbidden}: ${out.slice(0, 200)}`);
    }
    if (!out.includes('COMPANION_CONSOLE_SMOKE_PASS')) fail(`smoke marker missing: ${out.slice(0, 200)} ${err.slice(0, 200)}`);
    if (child.exitCode !== 0) fail(`console exit ${child.exitCode}`);
    log('PASS companion_console_startup | official SDK REPL, no confirm tool, redacted JSONL');
    log('COMPANION_CONSOLE_SMOKE_OK');
  } finally {
    await bridge.close();
  }
}
main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
