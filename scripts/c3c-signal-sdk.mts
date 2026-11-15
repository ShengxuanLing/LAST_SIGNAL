/**
 * AI-NATIVE-02 C3-c / Task C — official Signal SDK REPL console.
 *
 * This is an INTERFACE tool for a human/agent operator to exercise the real
 * Signal cooperation loop round by round:
 *   observe -> choose scan/jam/toggle -> see core commit result -> observe again.
 *
 * It runs against a REAL HeadlessWorld (same src/world/sim/core.ts as the
 * rendered game), advancing real fixed-tick core ticks. It never runs a
 * strategy, never claims to be an LLM, never fabricates model output.
 * The model recommendation step is performed by the Lead/operator choosing
 * scan/jam/toggle on the command line; this script only tests the command
 * path and does not impersonate an LLM.
 *
 * Commands on stdin:
 *   observe                  print the latest signal state (canonical headless view)
 *   scan <actor>             queue a signal scan (actor: player|echo) committed on next tick
 *   jam <actor>              queue a signal jam (actor: player|echo) committed on next tick
 *   toggle <enabled>         queue a relay toggle (enabled: true|false) committed on next tick
 *   step <ticks>             advance N real core ticks with neutral intent
 *   status                   print session/epoch/signal summary
 *   help                     list commands
 *   quit / exit              exit
 *
 * Action ids use the protocol's exact patterns. Every signal command is a
 * single-tick core commit on the named actor's energy account; no flush,
 * no direct state write, no bypass of permission/energy/cooldown/LOS/range.
 */

import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { HeadlessWorld, neutralIntent, type HeadlessRunStep } from '../src/ai-native/worldHeadless';

const hex = (bytes: number): string => randomBytes(bytes).toString('hex');
const actionId = (): string => `aid_${hex(12)}`;
const requestId = (): string => `req_${hex(12)}`;

function out(value: unknown): void {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
}

function signalSummary(view: Record<string, unknown> | null): unknown {
  if (!view) return { signal: null, note: 'no relay device — legacy v1 run (portal always open)' };
  return {
    deviceId: view.deviceId,
    roomId: view.roomId,
    x: view.x, y: view.y,
    relay: view.relay,
    manualEnabled: view.manualEnabled,
    powered: view.powered,
    jammedUntilTick: view.jammedUntilTick,
    playerEnergy: view.playerEnergy,
    echoEnergy: view.echoEnergy,
    playerScanCD: view.playerScanCD,
    playerJamCD: view.playerJamCD,
    echoScanCD: view.echoScanCD,
    echoJamCD: view.echoJamCD,
    evidence: view.evidence,
    exitOpen: view.exitOpen,
  };
}

async function main(): Promise<void> {
  // Accept an explicit seed for reproducible scenarios; default seed for smoke.
  const seedArg = process.argv[2];
  const seed = seedArg !== undefined ? Number(seedArg) : 424242;
  if (!Number.isFinite(seed)) {
    process.stderr.write('FAIL: seed must be a number\n');
    process.exit(2);
  }

  const world = new HeadlessWorld({ seed });
  let echoSpawned = false;
  let deviceSpawned = false;

  out(`SIGNAL SDK REPL seed=${seed} (headless, real core ticks)`);
  out('Type "observe" to begin; "help" lists commands.');

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const shutdown = (): void => {
    rl.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  rl.on('line', (raw) => {
    const line = raw.trim();
    if (!line) return;
    void (async (): Promise<void> => {
      const [command, ...args] = line.split(/\s+/);
      switch (command) {
        case 'help':
          out('observe | scan <player|echo> | jam <player|echo> | toggle <true|false> | step <ticks> | status | help | quit');
          return;
        case 'status':
          out({
            session: 'headless-local',
            tick: world.tick,
            echo: world.state.echo ? { x: world.state.echo.x, y: world.state.echo.y, hp: world.state.echo.data.hp } : null,
            signal: signalSummary(world.signalView()),
          });
          return;
        case 'observe': {
          // Ensure echo and device exist for a meaningful observation.
          if (!echoSpawned) {
            world.enableEcho();
            world.runSteps([{ ticks: 1, intent: neutralIntent() }], 1);
            echoSpawned = true;
          }
          if (!deviceSpawned) {
            const echo = world.state.echo!;
            world.enableSignalDevice({ deviceId: 'relay_main', roomId: 0, x: echo.x + 0.5, y: echo.y });
            world.runSteps([{ ticks: 1, intent: neutralIntent() }], 1);
            deviceSpawned = true;
          }
          out({ tick: world.tick, signal: signalSummary(world.signalView()) });
          return;
        }
        case 'scan': {
          const actor = args[0] as 'player' | 'echo' | undefined;
          if (actor !== 'player' && actor !== 'echo') {
            out({ error: 'E_SCHEMA', messageKey: 'signal.actor_required', hint: 'scan <player|echo>' });
            return;
          }
          world.enqueueSignalCommand({ type: 'signal-scan', actor });
          const events = world.runSteps([{ ticks: 1, intent: neutralIntent() }], 1);
          out({ command: 'scan', actor, tick: world.tick, events: events.map((e) => e.type), signal: signalSummary(world.signalView()) });
          return;
        }
        case 'jam': {
          const actor = args[0] as 'player' | 'echo' | undefined;
          if (actor !== 'player' && actor !== 'echo') {
            out({ error: 'E_SCHEMA', messageKey: 'signal.actor_required', hint: 'jam <player|echo>' });
            return;
          }
          world.enqueueSignalCommand({ type: 'signal-jam', actor });
          const events = world.runSteps([{ ticks: 1, intent: neutralIntent() }], 1);
          out({ command: 'jam', actor, tick: world.tick, events: events.map((e) => e.type), signal: signalSummary(world.signalView()) });
          return;
        }
        case 'toggle': {
          const enabled = args[0] === 'true';
          if (args[0] !== 'true' && args[0] !== 'false') {
            out({ error: 'E_SCHEMA', messageKey: 'signal.enabled_required', hint: 'toggle <true|false>' });
            return;
          }
          world.enqueueSignalCommand({ type: 'toggle-relay', enabled });
          const events = world.runSteps([{ ticks: 1, intent: neutralIntent() }], 1);
          out({ command: 'toggle', enabled, tick: world.tick, events: events.map((e) => e.type), signal: signalSummary(world.signalView()) });
          return;
        }
        case 'step': {
          const ticks = Number(args[0]);
          if (!Number.isFinite(ticks) || ticks < 1) {
            out({ error: 'E_SCHEMA', messageKey: 'signal.ticks_required', hint: 'step <ticks>' });
            return;
          }
          const steps: HeadlessRunStep[] = [{ ticks: Math.floor(ticks), intent: neutralIntent() }];
          const events = world.runSteps(steps, Math.floor(ticks));
          out({ command: 'step', ticks: Math.floor(ticks), tick: world.tick, events: events.map((e) => e.type), signal: signalSummary(world.signalView()) });
          return;
        }
        case 'quit':
        case 'exit':
          shutdown();
          return;
        default:
          out(`UNKNOWN_COMMAND ${command} (try "help")`);
      }
    })();
  });
}

main().catch((error) => {
  process.stderr.write(`FAIL signal sdk console: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
