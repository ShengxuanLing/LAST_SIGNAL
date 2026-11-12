/**
 * AI-NATIVE-01 P1 — headless CLI (LOCAL explicit Dev/test verification process).
 *
 * NOT MCP, NOT a Player Gateway, NOT an AI playthrough. Private frames
 * (snapshot / restore / replay) are available only when the process is started
 * with the explicit `--dev` channel flag; a self-declared `audience` parameter
 * never upgrades authority. `seed`/RNG/`model` internals only ever leave the
 * process on that explicit Dev channel. `observe` is always the whitelist DTO.
 *
 * Start: `npm run game:headless` (= vite-node ... --run --dev).
 * Restricted verification: `vite-node ... --run` (public commands only).
 *
 * stdin: one JSON command per line. stdout: one structured JSON response per
 * line. stderr: audit logs only.
 */
import { createHash } from 'node:crypto';
import { createInterface, type Interface } from 'node:readline';
import {
  HeadlessGame, canonicalEvents, canonicalState, createGame, isRuntimeSnapshot,
  withHashes, type RuntimeHasher,
} from './runtime';

const sha256: RuntimeHasher = (canonical) => `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;

const CLI_LIMITS = Object.freeze({
  MAX_INSTANCES: 16,
  MAX_ID_LENGTH: 32,
  MAX_LINE_BYTES: 16_384,
  MAX_SNAPSHOT_BYTES: 262_144,
  MAX_COMMANDS: 10_000,
  MAX_REPLAY_STEPS: 1000,
  MAX_REPLAY_TICKS: 100_000,
  MAX_SESSION_MS: 300_000,
});
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

interface CliState {
  readonly games: Map<string, HeadlessGame>;
  readonly devMode: boolean;
  closed: boolean;
  commands: number;
}

type Json = Record<string, unknown>;

function isJsonObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function reply(state: CliState, payload: Json): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function fail(state: CliState, id: string | null, code: string, message: string): void {
  reply(state, { ok: false, id, code, message });
}

function log(message: string): void {
  process.stderr.write(`[headless] ${message}\n`);
}

function gameOf(state: CliState, id: unknown): HeadlessGame | null {
  return typeof id === 'string' ? state.games.get(id) ?? null : null;
}

/** Returns true when the CLI should quit and close stdin immediately. */
function handle(state: CliState, input: unknown): boolean {
  if (!isJsonObject(input)) {
    fail(state, null, 'E_SCHEMA', 'command must be a JSON object');
    return false;
  }
  const cmd = input.cmd;
  const id = typeof input.id === 'string' ? input.id : null;
  if (typeof cmd !== 'string') {
    fail(state, id, 'E_SCHEMA', 'cmd must be a string');
    return false;
  }

  if (cmd === 'quit') {
    state.closed = true;
    reply(state, { ok: true, cmd: 'quit', instances: state.games.size });
    return true;
  }

  if (cmd === 'create') {
    if (!id || !ID_PATTERN.test(id)) {
      fail(state, id, 'E_SCHEMA', `create requires id matching ${ID_PATTERN}`);
      return false;
    }
    if (state.games.has(id)) {
      fail(state, id, 'E_SCHEMA', 'instance id already exists');
      return false;
    }
    if (state.games.size >= CLI_LIMITS.MAX_INSTANCES) {
      fail(state, id, 'E_RESOURCE_LIMIT', `at most ${CLI_LIMITS.MAX_INSTANCES} instances`);
      return false;
    }
    const seed = input.seed;
    if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      fail(state, id, 'E_SCHEMA', 'seed must be an integer in 0..0xffffffff');
      return false;
    }
    const game = createGame({ scenario: 'station-zero', seed, mode: 'headless' });
    state.games.set(id, game);
    // seed is NOT echoed: it is private to the Dev channel.
    reply(state, { ok: true, cmd, id, tick: game.tick, instances: state.games.size });
    return false;
  }

  if (cmd === 'close') {
    const game = gameOf(state, id);
    if (!game) { fail(state, id, 'E_SCHEMA', 'unknown instance'); return false; }
    state.games.delete(id as string);
    reply(state, { ok: true, cmd, id, instances: state.games.size });
    return false;
  }

  const game = gameOf(state, id);
  if (!game) { fail(state, id, 'E_SCHEMA', 'unknown instance'); return false; }

  if (cmd === 'step') {
    if (input.actions !== undefined && !Array.isArray(input.actions)) {
      fail(state, id, 'E_SCHEMA', 'actions must be an array (no silent fallback)');
      return false;
    }
    const result = game.step({ actions: input.actions as unknown[] | undefined, ticks: input.ticks as number });
    if (!result.ok) { fail(state, id, result.code, result.message); return false; }
    reply(state, {
      ok: true, cmd, id, tick: result.value.tick, advanced: result.value.advanced,
      status: result.value.status, actionResults: result.value.actionResults,
      events: result.value.events, droppedEvents: result.value.droppedEvents,
    });
    return false;
  }

  if (cmd === 'observe') {
    reply(state, { ok: true, cmd, id, observation: game.observe() });
    return false;
  }

  if (cmd === 'snapshot') {
    if (!state.devMode) {
      fail(state, id, 'E_PERMISSION', 'private frames require the local --dev channel');
      return false;
    }
    const snapshot = withHashes(game.snapshot(), sha256);
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > CLI_LIMITS.MAX_SNAPSHOT_BYTES) {
      fail(state, id, 'E_RESOURCE_LIMIT', 'snapshot too large');
      return false;
    }
    reply(state, { ok: true, cmd, id, snapshot });
    return false;
  }

  if (cmd === 'restore') {
    if (!state.devMode) {
      fail(state, id, 'E_PERMISSION', 'restore requires the local --dev channel');
      return false;
    }
    const snapshot = input.snapshot;
    if (!isRuntimeSnapshot(snapshot)) { fail(state, id, 'E_SNAPSHOT_INVALID', 'snapshot shape is invalid'); return false; }
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > CLI_LIMITS.MAX_SNAPSHOT_BYTES) {
      fail(state, id, 'E_RESOURCE_LIMIT', 'snapshot too large');
      return false;
    }
    // Hashes are MANDATORY. They prove integrity, not Player authorization:
    // source binding (sessionId/seed/rngState) is enforced in game.restore().
    if (typeof snapshot.stateHash !== 'string' || sha256(canonicalState(snapshot)) !== snapshot.stateHash) {
      fail(state, id, 'E_SNAPSHOT_INVALID', 'stateHash missing or mismatch');
      return false;
    }
    if (typeof snapshot.eventsHash !== 'string' || sha256(canonicalEvents(snapshot)) !== snapshot.eventsHash) {
      fail(state, id, 'E_SNAPSHOT_INVALID', 'eventsHash missing or mismatch');
      return false;
    }
    const result = game.restore(snapshot);
    if (!result.ok) { fail(state, id, result.code, result.message); return false; }
    reply(state, { ok: true, cmd, id, tick: result.value.tick, status: result.value.status, epoch: result.value.epoch });
    return false;
  }

  if (cmd === 'replay') {
    if (!state.devMode) {
      fail(state, id, 'E_PERMISSION', 'replay requires the local --dev channel');
      return false;
    }
    if (!Array.isArray(input.steps)) {
      fail(state, id, 'E_SCHEMA', 'steps must be an array (no silent fallback)');
      return false;
    }
    if (input.steps.length > CLI_LIMITS.MAX_REPLAY_STEPS) {
      fail(state, id, 'E_RESOURCE_LIMIT', 'too many replay steps');
      return false;
    }
    let totalTicks = 0;
    for (let i = 0; i < input.steps.length; i += 1) {
      const step = input.steps[i];
      if (!isJsonObject(step)) { fail(state, id, 'E_SCHEMA', `steps[${i}] must be an object`); return false; }
      if (step.actions !== undefined && !Array.isArray(step.actions)) {
        fail(state, id, 'E_SCHEMA', `steps[${i}].actions must be an array`); return false;
      }
      if (typeof step.ticks !== 'number' || !Number.isInteger(step.ticks)) {
        fail(state, id, 'E_SCHEMA', `steps[${i}].ticks must be an integer`); return false;
      }
      totalTicks += step.ticks;
    }
    if (totalTicks > CLI_LIMITS.MAX_REPLAY_TICKS) {
      fail(state, id, 'E_RESOURCE_LIMIT', 'replay tick budget exceeded');
      return false;
    }
    const result = game.replay(game.snapshot(), input.steps as Array<{ actions?: unknown[]; ticks: number }>);
    if (!result.ok) { fail(state, id, result.code, result.message); return false; }
    const hashed = withHashes(result.value.snapshot, sha256);
    reply(state, {
      ok: true, cmd, id, tick: result.value.snapshot.tick,
      stateHash: sha256(result.value.canonicalState),
      eventsHash: sha256(result.value.canonicalEvents),
      events: result.value.snapshot.events.length,
      snapshot: hashed,
    });
    return false;
  }

  if (cmd === 'pause' || cmd === 'resume') {
    const result = cmd === 'pause' ? game.pause() : game.resume();
    if (!result.ok) { fail(state, id, result.code, result.message); return false; }
    reply(state, { ok: true, cmd, id, status: result.value.status, tick: game.tick });
    return false;
  }

  fail(state, id, 'E_SCHEMA', `unknown cmd '${cmd}'`);
  return false;
}

export function runCli(): void {
  const devMode = process.argv.includes('--dev');
  const state: CliState = { games: new Map(), devMode, closed: false, commands: 0 };
  const rl: Interface = createInterface({ input: process.stdin, crlfDelay: Infinity });
  log(`channel=${devMode ? 'dev/test (private frames allowed)' : 'restricted (public commands only)'}; not MCP, not AI playthrough.`);

  const sessionTimer = setTimeout(() => {
    state.closed = true;
    log('session time budget exhausted; closing Dev channel.');
    rl.close();
  }, CLI_LIMITS.MAX_SESSION_MS);
  sessionTimer.unref();

  rl.on('line', (line) => {
    if (state.closed) return;
    const text = line.trim();
    if (text.length === 0) return;
    state.commands += 1;
    if (state.commands > CLI_LIMITS.MAX_COMMANDS) {
      fail(state, null, 'E_RESOURCE_LIMIT', 'command budget exceeded');
      state.closed = true;
      rl.close();
      return;
    }
    if (Buffer.byteLength(text, 'utf8') > CLI_LIMITS.MAX_LINE_BYTES) {
      fail(state, null, 'E_RESOURCE_LIMIT', `JSON line exceeds ${CLI_LIMITS.MAX_LINE_BYTES} bytes`);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      fail(state, null, 'E_SCHEMA', 'invalid JSON line');
      return;
    }
    const shouldQuit = handle(state, parsed);
    if (shouldQuit) rl.close();
  });
  rl.on('close', () => {
    state.games.clear();
    clearTimeout(sessionTimer);
    log('channel closed; instances released; exit 0.');
    process.exitCode = 0;
    // `quit` must not wait for stdin EOF: stdin may still be open in a harness.
    // Defer so queued stdout writes are flushed before exit.
    setImmediate(() => process.exit(0));
  });
}

// Auto-run only when started via the npm script (vite-node ... --run [--dev]);
// importing this module in tests does NOT read stdin. The `audience` field is
// intentionally ignored: channel identity is fixed at process start.
if (process.argv.includes('--run')) {
  runCli();
}
