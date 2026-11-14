// AI-NATIVE-02 C3-b — rendered external-link controller (C3-b fix).
//
// Owns the browser side of the loopback bridge link:
//   1. the HUMAN authorizes (the UI button), then the bridge handshake runs;
//   2. every rendered frame pushes the POST-COMMIT observation;
//   3. the next external intent is polled and converted into a legal
//      PlayerIntent for the existing core tick;
//   4. after the tick that executed it, the receipt is ACKed with the REAL
//      post-commit tick.
//
// Lifecycle invariants (reviewer blocking issue 2):
//  - every async operation captures a LOCAL client reference + epoch +
//    generation token and re-validates after EVERY await;
//  - degrade/dispose bump the generation, null the client and abort all
//    in-flight requests, so a late continuation can never heartbeat, ACK,
//    push an observation or re-attach in a new epoch;
//  - beforeFrame/afterFrame never overlap their commit/read of an action;
//  - an action's `ticks` is delivered for that many REAL core ticks. The core
//    tick counter (not the RAF frame counter) owns the duration.
//
// ACK semantics (documented, not over-claimed): `applied` means the LEGAL
// INTENT was committed to the core for the requested number of ticks. It does
// NOT guarantee a hit, a kill or a displacement: walls, cooldown, ammo and
// the real collision rules still decide the effect, exactly as for a human.

import { ExternalLinkClient, type ExternalClientObservation } from './externalLinkClient';
import { ExternalLinkState, EXTERNAL_LINK_LIMITS, type ExternalActionReceipt } from './externalLink';
import type { PlayerIntent } from './control';
import type { World } from '../world/World';
import { buildExternalObservation } from './externalObservation';
import { WORLD_LIMITS } from './worldProtocol';

export type ExternalLinkDegradeReason =
  | 'takeover' | 'pause' | 'death' | 'scene-exit' | 'disconnect' | 'heartbeat-loss'
  | 'level-up' | 'inventory';

export interface ExternalLinkControllerOptions {
  readonly world: World;
  readonly bridgeUrl: string;
  readonly token: string;
  /** Human-authored authorization. An agent can never call this with true. */
  readonly authorize: () => void;
  readonly onStatus?: (status: ExternalLinkStatusView) => void;
  readonly heartbeatMs?: number;
  /** Injectable transport for lifecycle regression tests. */
  readonly fetchImpl?: typeof fetch;
}

export interface ExternalLinkStatusView {
  readonly status: string;
  readonly label: string;
  readonly session: string | null;
  readonly epoch: number;
  readonly pending: number;
  readonly lastAction: string | null;
  readonly lastAppliedTick: number | null;
}

/** A captured lifecycle token. Every await re-validates against it. */
interface LifecycleToken {
  readonly client: ExternalLinkClient;
  readonly epoch: number;
  readonly generation: number;
}

/** Convert a bridge action into a legal PlayerIntent. */
export function intentFromExternalAction(action: {
  type: 'move' | 'stop' | 'aim' | 'fire' | 'interact';
  dir?: { x: number; y: number };
  target?: { x: number; y: number };
}): PlayerIntent {
  if (action.type === 'move') {
    const dir = action.dir ?? { x: 0, y: 0 };
    const len = Math.hypot(dir.x, dir.y) || 1;
    return { move: { x: dir.x / len, y: dir.y / len }, dash: false, fire: false, aim: null, interact: false };
  }
  if (action.type === 'fire') {
    return {
      move: { x: 0, y: 0 }, dash: false, fire: true,
      aim: action.target ?? null, interact: false
    };
  }
  if (action.type === 'aim') {
    return { move: { x: 0, y: 0 }, dash: false, fire: false, aim: action.target ?? null, interact: false };
  }
  if (action.type === 'interact') {
    return { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: true };
  }
  return { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
}

/**
 * `move`/`fire` honour the requested integer tick duration. `aim`, `interact`
 * and `stop` are single legal commits by definition: repeating them would
 * duplicate an interaction or an aim change rather than express a duration.
 */
export function durationForAction(action: { type: string; ticks?: number }): number {
  if (action.type !== 'move' && action.type !== 'fire') return 1;
  const value = action.ticks ?? 1;
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(WORLD_LIMITS.MAX_ACTION_TICKS, Math.floor(value)));
}

export class ExternalLinkController {
  private client: ExternalLinkClient | null = null;
  private generation = 0;
  private lastHeartbeatMs = 0;
  private readonly heartbeatMs: number;
  private disposed = false;
  private beforeBusy = false;
  private afterBusy = false;
  /** Last error from the bridge handshake, for a real UI error message. */
  private _lastError: { code: string; messageKey: string } | null = null;
  /** Credentials live ONLY here while the connection is alive. */
  private bridgeUrl: string;
  private token: string;
  /** In-flight teardown (yield+close). Re-authorize waits for it so the bridge
   *  cannot see a half-closed old session and answer 409 duplicate handshake. */
  private teardown: Promise<void> | null = null;

  constructor(private readonly options: ExternalLinkControllerOptions) {
    this.heartbeatMs = options.heartbeatMs ?? 1000;
    this.bridgeUrl = options.bridgeUrl;
    this.token = options.token;
  }

  get connected(): boolean { return this.client !== null; }
  get state(): ExternalLinkState { return this.options.world.externalLink; }
  get lastError(): { code: string; messageKey: string } | null { return this._lastError; }

  /** Capture the session token at the START of an async operation. */
  private capture(): LifecycleToken | null {
    const client = this.client;
    if (this.disposed || !client) return null;
    return {
      client,
      epoch: this.options.world.externalLink.epoch,
      generation: this.generation
    };
  }

  /** Re-validate after EVERY await. No optional chaining can hide this race. */
  private live(token: LifecycleToken): boolean {
    const world = this.options.world;
    return !this.disposed
      && this.generation === token.generation
      && this.client === token.client
      && !token.client.isClosed
      && world.externalLink.status === 'CONNECTED'
      && world.externalLink.epoch === token.epoch
      && world.player.control.owner === 'external';
  }

  /**
   * Human authorization: creates the local link state and performs the bridge
   * handshake. Returns false when the bridge is not reachable.
   */
  async authorizeHuman(): Promise<boolean> {
    const authorized = this.options.world.externalLink.authorize(true);
    if (!authorized.ok) {
      this._lastError = { code: 'E_PERMISSION', messageKey: 'world.authorization_required' };
      return false;
    }
    this.options.authorize();
    const generation = ++this.generation;
    if (!this.bridgeUrl || !this.token) {
      this._lastError = { code: 'E_PERMISSION', messageKey: 'world.authorization_required' };
      return false;
    }
    const client = new ExternalLinkClient({
      bridgeUrl: this.bridgeUrl,
      token: this.token,
      session: authorized.session,
      epoch: authorized.epoch,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {})
    });
    const handshake = await client.handshake();
    // A degrade/dispose may have happened while the handshake was in flight.
    if (this.disposed || this.generation !== generation) {
      this.options.world.externalLink.disconnect();
      this._lastError = { code: 'E_LINK_UNAVAILABLE', messageKey: 'world.handshake_cancelled' };
      return false;
    }
    if (!handshake.ok) {
      this.options.world.externalLink.disconnect();
      this._lastError = { code: 'E_LINK_UNAVAILABLE', messageKey: 'world.bridge_unreachable' };
      this.emit();
      return false;
    }
    // The bridge owns the session id/epoch: adopt them on both sides.
    if (!this.options.world.externalLink.connected(handshake.session, handshake.epoch)) {
      this.options.world.externalLink.disconnect();
      this._lastError = { code: 'E_STALE_EPOCH', messageKey: 'world.stale_epoch' };
      this.emit();
      return false;
    }
    this.client = client;
    this._lastError = null;
    this.options.world.player.control.enableExternal();
    this.emit();
    return true;
  }

  /** Called once per rendered frame AFTER the core tick ran. */
  async afterFrame(): Promise<void> {
    if (this.afterBusy) return; // never overlap a commit/read with another frame
    this.afterBusy = true;
    try {
      const token = this.capture();
      if (!token || !this.live(token)) return;
      const world = this.options.world;

      // 1) Drain REAL post-commit completions and ACK each with its real tick.
      const completions = world.externalLink.drainCompleted();
      for (const completion of completions) {
        if (!this.live(token)) return; // late callback: never ACK a new epoch
        const r: ExternalActionReceipt = completion.receipt;
        const applied = r.status === 'applied';
        const tick = r.completedTick ?? r.appliedTick ?? world.sim.tick;
        await token.client.ackIntent(
          completion.requestId, completion.actionId,
          applied ? 'applied' : 'rejected', tick,
          applied ? undefined : (r.code ?? 'E_LINK_UNAVAILABLE')
        );
        if (!this.live(token)) return;
        if (applied) {
          // HUD LAST comes from the actual core commit, not from a queue.
          world.player.control.noteExternalAction(completion.actionId, tick);
        }
      }

      // 2) Push the post-commit, perception-cropped observation.
      if (!this.live(token)) return;
      await token.client.pushObservation(this.observation());
      if (!this.live(token)) return; // reviewer race: degrade during the await

      // 3) Heartbeat keeps the session alive; loss degrades to human control.
      const now = Date.now();
      if (now - this.lastHeartbeatMs >= this.heartbeatMs) {
        this.lastHeartbeatMs = now;
        const alive = await token.client.heartbeat();
        if (!this.live(token)) return; // late callback must not degrade a new epoch
        if (!alive) this.degrade('heartbeat-loss');
      }
      this.emit();
    } finally {
      this.afterBusy = false;
    }
  }

  /**
   * Poll the bridge for the next intent and START it for the next core ticks.
   * Called BEFORE the core tick of the next frame.
   */
  async beforeFrame(): Promise<void> {
    if (this.beforeBusy) return; // never overlap two polls / two starts
    this.beforeBusy = true;
    try {
      const token = this.capture();
      if (!token || !this.live(token)) return;
      const world = this.options.world;
      const active = world.externalLink.activeExecution;
      if (active) {
        // STOP PREEMPTION: a queued `stop` immediately cancels the ACTIVE
        // action (no need to wait for its remaining ticks) and is then a real
        // 1-tick neutral commit. Other queued actions keep their FIFO order.
        const peek = await token.client.nextIntent(active.actionId);
        if (!this.live(token)) return;
        if (!peek || peek.action.type !== 'stop') return; // normal FIFO
        world.externalLink.preemptActive(world.sim.tick, 'E_PREEMPTED');
        if (!this.live(token)) return;
        const stopIntent = intentFromExternalAction(peek.action);
        const stopReceipt = world.enqueueExternalIntent({
          actionId: peek.actionId,
          requestId: peek.requestId,
          intent: stopIntent,
          applyByTick: peek.applyByTick,
          ttlTicks: EXTERNAL_LINK_LIMITS.MAX_TTL_TICKS,
          durationTicks: 1
        });
        if (!this.live(token)) return;
        if (stopReceipt.status === 'queued') {
          world.externalLink.beginExecution(world.sim.tick, token.epoch);
        }
        return;
      }
      const next = await token.client.nextIntent();
      if (!this.live(token)) return; // late callback: never start a stale action
      if (!next) return;
      const durationTicks = durationForAction(next.action);
      const intent = intentFromExternalAction(next.action);
      const receipt = world.enqueueExternalIntent({
        actionId: next.actionId,
        requestId: next.requestId,
        intent,
        applyByTick: next.applyByTick,
        ttlTicks: EXTERNAL_LINK_LIMITS.MAX_TTL_TICKS,
        durationTicks
      });
      if (!this.live(token)) return;
      if (receipt.status === 'queued') {
        // `beginExecution` binds the epoch and checks the execution deadline.
        world.externalLink.beginExecution(world.sim.tick, token.epoch);
      }
    } finally {
      this.beforeBusy = false;
    }
  }

  /** Human takeover / pause / death / scene exit: cancel ALL in-flight work. */
  degrade(reason: ExternalLinkDegradeReason): void {
    const world = this.options.world;
    // 1) Invalidate every in-flight async continuation BEFORE touching state.
    this.generation += 1;
    world.externalLink.yield(reason); // cancels active + pending + completions
    world.player.control.disableExternal(reason);
    // 2) Detach and abort the local client; never reuse it after this point.
    const client = this.client;
    this.client = null;
    if (client) {
      client.abortInFlight();
      // Close the bridge session too, so the next explicit HUMAN AUTHORIZE can
      // create a fresh session. Without the click nothing reconnects.
      const closed = client.yieldLink(reason).catch(() => undefined)
        .then(() => client.close().catch(() => undefined))
        .then(() => undefined)
        .finally(() => {
          client.forgetCredentials();
          if (this.teardown === closed) this.teardown = null;
        });
      this.teardown = closed;
    }
    // Credentials are dropped as soon as the live connection is gone.
    this.forgetCredentials();
    this.emit();
  }

  /** Remove credentials from this controller and from any global config. */
  forgetCredentials(): void {
    this.token = '';
    this.bridgeUrl = '';
    const g = globalThis as unknown as { __externalLinkConfig?: unknown };
    if (g.__externalLinkConfig !== undefined) delete g.__externalLinkConfig;
  }

  async dispose(reason: 'scene-exit' | 'disconnect' = 'scene-exit'): Promise<void> {
    this.disposed = true;
    this.generation += 1;
    const world = this.options.world;
    world.externalLink.yield(reason);
    world.player.control.disableExternal(reason);
    const client = this.client;
    this.client = null;
    if (client) {
      client.abortInFlight();
      await client.close().catch(() => undefined);
    }
    // Wait for any teardown started by an earlier degrade().
    if (this.teardown) await this.teardown.catch(() => undefined);
    this.forgetCredentials();
  }

  /** Perception-cropped observation (no full map, seed, RNG or hidden state). */
  private observation(): ExternalClientObservation {
    const world = this.options.world;
    const view = world.observationView();
    const sim = world.sim;
    return buildExternalObservation({
      epoch: world.externalLink.epoch,
      tick: sim.tick,
      view,
      playerData: {
        weaponKey: world.player.data.weaponKey,
        weapons: world.player.data.weapons
      },
      aimYaw: sim.player.aimYaw,
      drones: sim.drones.filter((d) => d.hp > 0).map((d) => ({
        id: d.id, kind: d.data.kind, x: d.x, y: d.y, hp: d.hp, state: d.data.state
      })),
      targets: sim.targets.filter((t) => t.hp > 0).map((t) => ({
        id: t.id, kind: t.kind, x: t.x, y: t.y, hp: t.hp
      })),
      projectiles: sim.projectiles.map((p) => ({
        id: p.id, side: p.side, kind: p.kind, pos: p.pos, vel: p.vel,
        damage: p.damage, lifetime: p.lifetime
      })),
      // SAME finite radius + explored + LOS predicate used for the player.
      isPerceivable: (x, y) => world.isPerceivablePosition(x, y)
    });
  }

  private emit(): void {
    const snapshot = this.options.world.externalLink.snapshot();
    this.options.onStatus?.({
      status: snapshot.status,
      label: snapshot.status === 'CONNECTED' ? 'EXTERNAL AGENT CONNECTED'
        : snapshot.status === 'LOST' ? 'EXTERNAL LINK LOST'
        : snapshot.status === 'YIELDED' ? 'EXTERNAL LINK YIELDED'
        : 'EXTERNAL NOT CONNECTED',
      session: snapshot.session,
      epoch: snapshot.epoch,
      pending: snapshot.pendingCount,
      lastAction: snapshot.lastAction,
      lastAppliedTick: snapshot.lastAppliedTick
    });
  }
}
