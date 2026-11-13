/**
 * AI-NATIVE-01 P2 — independent Node client (integration verification, not P4).
 *
 * Demonstrates the real production PLAYER path to COMPLETION (lab SEALED door ->
 * Scan -> Jam -> corridor -> relay -> bridge -> east shore), then the trusted
 * dev/test facet (snapshot/restore/replay), and real `cancelAction` cancellation
 * (no AbortSignal) using the handle's actionId. Closes and disposes cleanly.
 *
 * Run: npx vite-node src/ai-native/sessionClient.mts
 */
import { createSessionManager } from './sessions';
import { canonicalState } from './runtime';

const DTO = 'last_signal.ai-native.dto.v1';
const SEED = 0x51a1c1;
let counter = 0;
const hex24 = (): string => String(++counter).padStart(24, '0');
const aid = (): string => `aid_${hex24()}`;
const rid = (): string => `req_${hex24()}`;

function log(...args: unknown[]): void {
  process.stdout.write(`${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
}

async function main(): Promise<void> {
  const manager = createSessionManager({ maxSessions: 4, idleTimeoutMs: 100000, maxSessionWallMs: 100000 });

  // --- Real production PLAYER full route -----------------------------------
  const player = manager.createProductionSession();
  const owner = manager.createOwnerHandle(player.sessionId);
  if (!owner) throw new Error('owner handle missing');
  owner.start();

  const tick = (): number => { const r = player.observe('summary'); return r.ok ? r.value.tick : -1; };
  const self = () => { const r = player.observe('summary'); return r.ok ? r.value.current.self : null; };

  const script: Array<[string | null, Record<string, unknown> | null, number]> = [
    ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 60 }, 60],
    ['scan', { type: 'scan' }, 1],
    ['jam', { type: 'jam', targetId: 'tgt_lab_door_receiver' }, 1],
    ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 40 }, 40],
    ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 100 }, 100],
    [null, null, 1],
    ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 61 }, 61],
    ['move', { type: 'move', direction: { x: 0, y: -1 }, durationTicks: 17 }, 17],
    ['interact', { type: 'interact', targetId: 'tgt_corridor_relay' }, 1],
    [null, null, 95],
    ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 150 }, 150],
  ];
  for (const [type, payload, ticks] of script) {
    const t = tick();
    const actions = type && payload
      ? [{ schema: DTO, protocolVersion: 1, actionId: aid(), actorId: player.actorId, sessionId: player.sessionId, epoch: 0, targetTick: t + 1, type, payload, clientSeq: 0, issuedAtMs: 0, deadlineTick: t + 1 }]
      : [];
    const res = player.step({
      schema: DTO, protocolVersion: 1, requestId: rid(), sessionId: player.sessionId, epoch: 0,
      fromTick: t, ticks, actions, includeObservation: true, observationDetail: 'standard',
    } as never);
    if (!res.ok) { log('STEP REJECTED', type, res.error.code, res.error.messageKey); break; }
  }
  const done = self();
  const summary = player.observe('summary');
  log('production route ->', { tick: tick(), room: summary.ok ? summary.value.roomId : '?', passed: done?.passed, crossed: done?.crossed, completed: done?.completed });

  // --- Real cancelAction (no AbortSignal) ---------------------------------
  const c = manager.createTestSession({ seed: SEED });
  const cOwner = manager.createOwnerHandle(c.sessionId);
  if (!cOwner) throw new Error('owner handle missing');
  cOwner.start();
  const beforeCancel = (() => { const r = c.observe('summary'); return r.ok ? r.value.tick : -1; })();
  const handle = c.waitUntil({ maxTicks: 400, maxWallMs: 100000 });
  const cancel = c.cancelAction(handle.actionId);
  const cancelled = await handle.result;
  const afterCancel = (() => { const r = c.observe('summary'); return r.ok ? r.value.tick : -1; })();
  log('cancelAction ->', { actionId: handle.actionId, cancelOk: cancel.ok, result: cancelled.ok ? cancelled.value.code : 'error', tickStable: beforeCancel === afterCancel });

  // --- Trusted dev/test facet ---------------------------------------------
  c.step({
    schema: DTO, protocolVersion: 1, requestId: rid(), sessionId: c.sessionId, epoch: 0,
    fromTick: afterCancel, ticks: 2,
    actions: [{ schema: DTO, protocolVersion: 1, actionId: aid(), actorId: c.actorId, sessionId: c.sessionId, epoch: 0, targetTick: afterCancel + 1, type: 'move', payload: { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 2 }, clientSeq: 0, issuedAtMs: 0, deadlineTick: afterCancel + 1 }],
    includeObservation: false,
  } as never);
  const snap = c.snapshot();
  if (snap.ok) {
    const hash = canonicalState(snap.value);
    const restored = c.restore(snap.value);
    const replay = c.replay([]);
    log('dev facet ->', { snapshot: snap.value.snapshotId, restoreEpoch: restored.ok ? restored.value.epoch : 'rejected', replayStable: replay.ok ? replay.value.canonicalState === hash : false });
  }

  owner.close();
  cOwner.close();
  manager.dispose();
  log('manager disposed; process can exit cleanly');
}

main().then(() => process.exit(0)).catch((err) => { log('CLIENT ERROR', String(err)); process.exit(1); });
