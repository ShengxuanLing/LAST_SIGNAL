/**
 * AI-NATIVE-02 C3c fix — DIRECT official-SDK Player crop negative test.
 *
 * Spawns the REAL `dist-mcp/worldHeadlessMcpServer.mjs` (NO --dev) through the
 * official MCP SDK client and inspects the RAW `structuredContent` AND the raw
 * `content[0].text` of every Player tool result. It does not stringify/delete
 * fields in a console wrapper: this is the actual wire payload.
 *
 * Forbidden anywhere (recursively): canonicalState / canonicalEvents / seed /
 * rngState / map / mapHash / mapSeed / pendingCommands / purchaseTransactions /
 * nextLootId / nextProjectileId / full-map or hidden-target fields.
 *
 * Then it checks the same against the Dev binary to prove we did not over-crop
 * (Dev keeps snapshot/inspect/replay detail).
 */
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = resolve(process.cwd(), 'dist-mcp/worldHeadlessMcpServer.mjs');
const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;

const FORBIDDEN_KEYS = new Set([
  'canonicalState', 'canonicalEvents', 'seed', 'rngState', 'map', 'mapHash', 'mapSeed',
  'pendingCommands', 'purchaseTransactions', 'loot', 'nextLootId', 'nextProjectileId',
  'coreState', 'hiddenTargets', 'targets', 'rooms', 'tiles', 'portal', 'boss', 'perception'
]);
const ALLOWED_TOP_KEYS = new Set([
  'schema', 'ok', 'code', 'messageKey', 'path', 'session', 'epoch', 'tick', 'status',
  'observation', 'requestId', 'acceptedTick', 'applyByTick', 'replayed', 'actions',
  'actionId', 'startedTick', 'appliedTick', 'executedTicks', 'executed', 'applied', 'rejected',
  'fromTick', 'toTick', 'ticks', 'blockTicks', 'eventCount', 'sessions', 'combat',
  'executing', 'events', 'type', 'enemyId', 'crit', 'position', 'projectile', 'offerKey',
  'price', 'amount', 'currency', 'xp', 'key',
  'closed', 'key', 'level', 'kind', 'amount', 'x', 'y', 'hp', 'state', 'id',
  'player', 'drones', 'projectiles', 'availableActions', 'roomId', 'protocolVersion',
  'vx', 'vy', 'side', 'damage', 'lifetime', 'maxHp', 'aimYaw', 'weaponKey', 'ammo', 'magazine'
]);

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

/** Recursively collect every object key. */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) { for (const v of value) allKeys(v, out); return out; }
  if (!value || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push(k);
    allKeys(v, out);
  }
  return out;
}

function assertNoForbidden(value: unknown, where: string): void {
  const keys = allKeys(value);
  const bad = keys.filter((k) => FORBIDDEN_KEYS.has(k));
  assert(bad.length === 0, `${where}: forbidden keys leaked`, [...new Set(bad)]);
  const text = JSON.stringify(value);
  for (const needle of ['canonicalState', 'canonicalEvents', '"rngState"', '"pendingCommands"', '"purchaseTransactions"']) {
    assert(!text.includes(needle), `${where}: forbidden token ${needle}`);
  }
}

function assertTopLevelAllowlisted(body: Record<string, unknown>, where: string): void {
  const extras = Object.keys(body).filter((k) => !ALLOWED_TOP_KEYS.has(k));
  assert(extras.length === 0, `${where}: unexpected top-level keys`, extras);
}

async function open(args: string[]): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [SERVER, ...args], env: { ...process.env } as never, stderr: 'pipe'
  });
  const client = new Client({ name: 'crop-negative', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

/** Call and inspect BOTH raw structuredContent and raw text content. */
async function callRaw(client: Client, name: string, args: Record<string, unknown> = {}, allowOwnerFields = false): Promise<Record<string, any>> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }> | undefined)
    ?.find((c) => c.type === 'text')?.text;
  assert(typeof text === 'string', `${name}: has raw text content`);
  let parsed: unknown;
  try { parsed = JSON.parse(text as string); } catch { fail(`${name}: text content is not JSON`); }
  if (!allowOwnerFields) {
    assertNoForbidden(parsed, `${name}.text`);
    if (result.structuredContent) assertNoForbidden(result.structuredContent, `${name}.structuredContent`);
    const body = (result.structuredContent ?? parsed) as Record<string, any>;
    if (body && typeof body === 'object') assertTopLevelAllowlisted(body, `${name}.structuredContent`);
  } else {
    // Dev surface: still verify the raw text is the real wire payload.
    assert(JSON.stringify(parsed) === JSON.stringify(result.structuredContent), `${name}: dev text == structuredContent`);
  }
  return (result.structuredContent ?? parsed) as Record<string, any>;
}

async function playerSurface(): Promise<void> {
  const client = await open([]);
  try {
    const created = await callRaw(client, 'world_headless_create_session');
    assert(created.ok === true, 'player create', created);
    assert(created.seed === undefined, 'player create has no seed');
    const session = created.session as string;
    const epoch = created.epoch as number;
    const topCreate = Object.keys(created).sort().join(',');
    assert(!topCreate.includes('seed'), 'create top-level has no seed key', topCreate);
    log('PASS player_create_cropped', { session, epoch });

    const observed = await callRaw(client, 'world_observe', { session });
    assert(observed.ok === true && observed.observation.tick === 0, 'player observe', observed);
    const drone = observed.observation.drones[0];
    assert(drone && drone.kind === 'drone', 'player observe sees a real drone');

    const action = await callRaw(client, 'world_action', {
      session, epoch, requestId: rid(1),
      actions: [{ type: 'fire', actionId: aid(1), target: { x: drone.x, y: drone.y }, ticks: 60 }],
      ttlTicks: 600
    });
    assert(action.ok === true && action.actions[0].status === 'queued', 'player action receipt', action);
    log('PASS player_action_receipt_only');

    const step = await callRaw(client, 'world_headless_step', { session, epoch, requestId: rid(2), ticks: 60 });
    assert(step.ok === true && step.ticks === 60, 'player step', step);
    assert(step.canonicalState === undefined, 'player step has NO canonicalState');
    assert(step.canonicalEvents === undefined, 'player step has NO canonicalEvents');
    assert(!('seed' in step) && !('map' in step), 'player step has no seed/map');
    const eventTypes = (step.events ?? []).map((e: any) => e.type);
    assert(!eventTypes.includes('drone-step'), 'player events have no hidden drone FSM');
    assert(!eventTypes.includes('room-generated'), 'player events have no room generation');
    assert(!eventTypes.includes('player-reset'), 'player events have no owner reset');
    log('PASS player_step_cropped', { tick: step.toTick, status: step.status, keys: Object.keys(step).sort() });

    const replay = await callRaw(client, 'world_headless_step', { session, epoch, requestId: rid(2), ticks: 60 });
    assert(replay.replayed === true, 'player step replay');
    assert(replay.canonicalState === undefined && replay.canonicalEvents === undefined, 'replay does not leak canonical');
    log('PASS player_step_replay_cropped');

    const stale = await callRaw(client, 'world_headless_step', { session, epoch: epoch - 1, requestId: rid(3), ticks: 5 });
    assert(stale.ok === false && stale.code === 'E_STALE_EPOCH', 'old epoch error only', stale);
    const ended = await callRaw(client, 'world_headless_step', { session, epoch, requestId: rid(4), ticks: 5 });
    assert(ended.ok === false && ended.code === 'E_NOT_APPLICABLE', 'terminal step error only', ended);

    // Intent audit: unknown keys / hp writes / over-speed must be rejected or
    // clamped. The SDK strict schema rejects extra keys before the manager.
    for (const badIntent of [
      { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false, hp: 99999 },
      { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false, seed: 1 },
      { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false, extra: true },
      { move: { x: 1, y: 0, z: 1 }, dash: false, fire: false, aim: null, interact: false }
    ]) {
      const res = await client.callTool({ name: 'world_headless_step', arguments: { session, epoch, requestId: rid(9), ticks: 1, intent: badIntent } });
      assert(res.isError === true || (res.structuredContent as any)?.ok === false, 'bad intent rejected', badIntent);
    }
    log('PASS player_intent_unknown_fields_rejected');

    const listed = await callRaw(client, 'world_list_sessions');
    assert(listed.ok === true && Array.isArray(listed.sessions), 'player list', listed);
    log('PASS player_list_cropped');

    const closed = await callRaw(client, 'world_close', { session });
    assert(closed.ok === true && closed.closed === true, 'player close', closed);
    const after = await callRaw(client, 'world_observe', { session });
    assert(after.ok === false, 'closed session error only', after);
    log('PASS player_close_cropped');
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function devSurface(): Promise<void> {
  const client = await open(['--dev']);
  try {
    const created = await callRaw(client, 'world_headless_create_session', { seed: 424242 }, true);
    assert(created.ok === true && created.seed === 424242, 'dev create keeps the seed', created);
    const session = created.session as string;
    const epoch = created.epoch as number;
    const step = await callRaw(client, 'world_headless_step', { session, epoch, requestId: rid(1), ticks: 10 }, true);
    assert(step.ok === true, 'dev step', step);
    assert(typeof step.canonicalState === 'string', 'dev step KEEPS canonicalState');
    assert(typeof step.canonicalEvents === 'string', 'dev step KEEPS canonicalEvents');
    const snapshot = await callRaw(client, 'world_headless_dev_snapshot', { session }, true);
    assert(snapshot.ok === true && snapshot.frame?.sim?.map, 'dev snapshot keeps full owner frame');
    const inspect = await callRaw(client, 'world_headless_dev_inspect', { session }, true);
    assert(inspect.ok === true && inspect.inspect.rngState !== undefined, 'dev inspect keeps RNG');
    log('PASS dev_surface_keeps_owner_detail');
    await client.close();
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  await playerSurface();
  await devSurface();
  log('PLAYER_CROP_NEGATIVE_PASS');
}

main().catch((error) => fail('player crop negative', error instanceof Error ? error.message : String(error)));
