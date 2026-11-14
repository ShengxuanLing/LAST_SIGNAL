/**
 * AI-NATIVE-02 C3-b — minimal official WORLD client console.
 *
 * This is an INTERFACE tool for a human/agent operator to go round by round:
 * observe -> choose an action -> see the queue receipt -> observe again.
 * It never runs a strategy, never advances the rendered game and never claims
 * to be an LLM playthrough. The rendered browser is the only SimulationState.
 *
 * Environment (token is never printed):
 *   LAST_SIGNAL_WORLD_BRIDGE_URL   e.g. http://127.0.0.1:8787
 *   LAST_SIGNAL_WORLD_TOKEN        or
 *   LAST_SIGNAL_WORLD_TOKEN_FILE   path to the restricted token file
 *
 * Commands on stdin:
 *   observe                      print the latest perception-cropped observation
 *   move <x> <y> <ticks>         queue a directional move intent
 *   fire <x> <y> <ticks>         queue a fire intent at a grid target
 *   aim <x> <y>                  queue an aim intent
 *   stop                         queue a neutral stop
 *   interact                     queue an interact intent
 *   status                       print the attached session/epoch
 *   close                        disconnect the agent side (rendered -> HUMAN)
 *   quit                         exit without force-closing the bridge
 *
 * Action/request ids are generated with the protocol's exact patterns.
 */
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { WorldClient } from '../src/ai-native/worldClient';
import type { WorldActionBatchV1 } from '../src/ai-native/worldProtocol';

const bridgeUrl = (process.env.LAST_SIGNAL_WORLD_BRIDGE_URL ?? '').replace(/\/$/, '');
const tokenFile = process.env.LAST_SIGNAL_WORLD_TOKEN_FILE ?? '';
let token = process.env.LAST_SIGNAL_WORLD_TOKEN ?? '';

const hex = (bytes: number): string => randomBytes(bytes).toString('hex');
const actionId = (): string => `aid_${hex(12)}`;
const requestId = (): string => `req_${hex(12)}`;

function out(value: unknown): void {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  if (!token && tokenFile) token = (await readFile(tokenFile, 'utf8')).trim();
  if (!bridgeUrl || !token) {
    process.stderr.write('FAIL: LAST_SIGNAL_WORLD_BRIDGE_URL and token (env or TOKEN_FILE) are required\n');
    process.exit(2);
  }
  const client = new WorldClient({ bridgeUrl, token });
  const handshake = await client.handshake();
  if (!('ok' in handshake)) {
    process.stderr.write(`FAIL attach: ${handshake.code} ${handshake.messageKey}\n`);
    process.exit(2);
  }
  out(`ATTACHED session=${handshake.session} epoch=${handshake.epoch} (agent side only; HUMAN authorized the link)`);
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
          out('observe | move <x> <y> <ticks> | fire <x> <y> <ticks> | aim <x> <y> | stop | interact | status | close | quit');
          return;
        case 'status':
          out({ session: client.sessionId, epoch: client.currentEpoch, attached: client.sessionId !== null });
          return;
        case 'observe': {
          const result = await client.observe();
          if (!result.ok) { out({ ok: false, ...result }); return; }
          const o = result.observation;
          out({
            tick: o.tick, roomId: o.roomId,
            player: o.player,
            perceived: o.drones.map((d) => ({ id: d.id, kind: d.kind, x: d.x, y: d.y, hp: d.hp })),
            projectiles: o.projectiles.length,
            availableActions: o.availableActions
          });
          return;
        }
        case 'close': {
          const ok = await client.close();
          out({ closed: ok, note: 'rendered game returns to HUMAN control; no automatic re-take' });
          return;
        }
        case 'quit':
        case 'exit':
          shutdown();
          return;
        case 'move':
        case 'fire':
        case 'aim':
        case 'stop':
        case 'interact': {
          let action: WorldActionBatchV1['actions'][number];
          if (command === 'move') {
            const [x, y, ticks] = args.map(Number);
            action = { type: 'move', actionId: actionId(), dir: { x, y }, ticks };
          } else if (command === 'fire') {
            const [x, y, ticks] = args.map(Number);
            action = { type: 'fire', actionId: actionId(), target: { x, y }, ticks };
          } else if (command === 'aim') {
            const [x, y] = args.map(Number);
            action = { type: 'aim', actionId: actionId(), target: { x, y } };
          } else if (command === 'interact') {
            action = { type: 'interact', actionId: actionId() };
          } else {
            action = { type: 'stop', actionId: actionId() };
          }
          const receipt = await client.submit(requestId(), [action]);
          out(receipt);
          out('NOTE: status=queued is NOT applied. The rendered core commits on a real tick; observe again to see the new tick.');
          return;
        }
        default:
          out(`UNKNOWN_COMMAND ${command} (try "help")`);
      }
    })();
  });
}

main().catch((error) => {
  process.stderr.write(`FAIL world console: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
