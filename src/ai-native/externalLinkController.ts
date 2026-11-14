// AI-NATIVE-02 C3-b — rendered external-link controller.
//
// Owns the browser side of the loopback bridge link:
//   1. the HUMAN authorizes (the UI button), then the bridge handshake runs;
//   2. every rendered frame pushes the POST-COMMIT observation;
//   3. the next external intent is polled and converted into a legal
//      PlayerIntent for the existing core tick;
//   4. after the tick that executed it, the receipt is ACKed with the REAL
//      post-commit tick.
//
// It never steps the rendered world, never writes scene state and never logs
// the bridge token.

import { ExternalLinkClient, type ExternalClientObservation } from './externalLinkClient';
import { ExternalLinkState, type ExternalActionReceipt } from './externalLink';
import type { PlayerIntent } from './control';
import type { World } from '../world/World';

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

interface PendingExecution {
  readonly actionId: string;
  readonly requestId: string;
  readonly intent: PlayerIntent;
  readonly issuedAtTick: number;
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

export class ExternalLinkController {
  private client: ExternalLinkClient | null = null;
  private executing: PendingExecution | null = null;
  private lastHeartbeatMs = 0;
  private readonly heartbeatMs: number;
  private disposed = false;

  constructor(private readonly options: ExternalLinkControllerOptions) {
    this.heartbeatMs = options.heartbeatMs ?? 1000;
  }

  get connected(): boolean { return this.client !== null; }
  get state(): ExternalLinkState { return this.options.world.externalLink; }

  /**
   * Human authorization: creates the local link state and performs the bridge
   * handshake. Returns false when the bridge is not reachable.
   */
  async authorizeHuman(): Promise<boolean> {
    const authorized = this.options.world.externalLink.authorize(true);
    if (!authorized.ok) return false;
    this.options.authorize();
    const client = new ExternalLinkClient({
      bridgeUrl: this.options.bridgeUrl,
      token: this.options.token,
      session: authorized.session,
      epoch: authorized.epoch
    });
    const handshake = await client.handshake();
    if (!handshake.ok) {
      this.options.world.externalLink.disconnect();
      this.emit();
      return false;
    }
    // The bridge owns the session id/epoch: adopt them on both sides.
    if (!this.options.world.externalLink.connected(handshake.session, handshake.epoch)) {
      this.options.world.externalLink.disconnect();
      this.emit();
      return false;
    }
    this.client = client;
    this.options.world.player.control.enableExternal();
    this.emit();
    return true;
  }

  /** Called once per rendered frame AFTER the core tick ran. */
  async afterFrame(): Promise<void> {
    if (this.disposed || !this.client) return;
    const world = this.options.world;

    // 1) If an external intent was executed by the last tick, ACK it now with
    //    the REAL post-commit tick.
    if (this.executing) {
      const execution = this.executing;
      this.executing = null;
      const applied = world.sim.tick > execution.issuedAtTick;
      if (applied) {
        world.commitExternalIntent(execution.actionId, world.sim.tick);
        await this.client.ackIntent(execution.requestId, execution.actionId, 'applied', world.sim.tick);
      } else {
        // Not committed by a tick: the intent never happened.
        world.rejectExternalIntent(execution.actionId, 'E_STALE_TICK', world.sim.tick);
        await this.client.ackIntent(execution.requestId, execution.actionId, 'rejected', world.sim.tick, 'E_STALE_TICK');
      }
    }

    // 2) Push the post-commit observation (perception-cropped, no map/seed/RNG).
    await this.client.pushObservation(this.observation());

    // 3) Heartbeat keeps the session alive; loss degrades to human control.
    const now = Date.now();
    if (now - this.lastHeartbeatMs >= this.heartbeatMs) {
      this.lastHeartbeatMs = now;
      const alive = await this.client.heartbeat();
      if (!alive) this.degrade('heartbeat-loss');
    }
    this.emit();
  }

  /**
   * Poll the bridge for the next intent and queue it for the next core tick.
   * Called BEFORE the core tick of the next frame.
   */
  async beforeFrame(): Promise<void> {
    if (this.disposed || !this.client) return;
    const world = this.options.world;
    if (world.player.control.owner !== 'external') return;
    if (this.executing) return; // one external intent at a time
    const next = await this.client.nextIntent();
    if (!next) return;
    const intent = intentFromExternalAction(next.action);
    const receipt = world.enqueueExternalIntent({
      actionId: next.actionId,
      requestId: next.requestId,
      intent,
      applyByTick: next.applyByTick,
      ttlTicks: 120
    });
    if (receipt.status === 'queued') {
      this.executing = {
        actionId: next.actionId,
        requestId: next.requestId,
        intent,
        issuedAtTick: world.sim.tick
      };
    }
  }

  /** Human takeover / pause / death / scene exit: cancel pending intents. */
  degrade(reason: ExternalLinkDegradeReason): void {
    const world = this.options.world;
    world.externalLink.yield(reason);
    world.player.control.disableExternal(reason);
    this.executing = null;
    // Close the bridge session too, so the next explicit HUMAN AUTHORIZE can
    // create a fresh session. Without the click nothing reconnects.
    const client = this.client;
    this.client = null;
    if (client) {
      void client.yieldLink(reason).catch(() => undefined).finally(() => {
        void client.close().catch(() => undefined);
      });
    }
    this.emit();
  }

  async dispose(reason: 'scene-exit' | 'disconnect' = 'scene-exit'): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const world = this.options.world;
    world.externalLink.yield(reason);
    world.player.control.disableExternal(reason);
    this.executing = null;
    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = null;
    }
  }

  /** Perception-cropped observation for the agent (no full map, seed or RNG). */
  private observation(): ExternalClientObservation {
    const world = this.options.world;
    const view = world.observationView();
    const player = world.player;
    const weapon = player.data.weapons.find((w) => w.key === player.data.weaponKey);
    const coreDrones = world.sim.drones
      .filter((d) => d.hp > 0)
      .map((d) => ({
        id: d.id, kind: d.data.kind, x: d.x, y: d.y, hp: d.hp, state: d.data.state
      }));
    const coreTargets = world.sim.targets
      .filter((t) => t.hp > 0)
      .map((t) => ({ id: t.id, kind: t.kind, x: t.x, y: t.y, hp: t.hp, state: 'alive' }));
    const perceivedIds = new Set(view.perceivedActors.map((a) => a.id));
    const visible = [...coreDrones, ...coreTargets].filter((a) => perceivedIds.has(a.id));
    return {
      schema: 'last_signal.world.v1',
      protocolVersion: 1,
      epoch: world.externalLink.epoch,
      tick: world.sim.tick,
      roomId: view.roomId,
      player: {
        x: view.player.x, y: view.player.y, hp: view.player.hp, maxHp: view.player.maxHp,
        aimYaw: world.sim.player.aimYaw,
        weaponKey: player.data.weaponKey,
        ammo: weapon?.ammo ?? -1,
        magazine: weapon?.magazine ?? -1
      },
      drones: visible.map((a) => ({
        id: a.id, kind: a.kind, x: a.x, y: a.y, hp: a.hp, state: a.state
      })),
      projectiles: world.sim.projectiles.map((p) => ({
        id: p.id, side: p.side, kind: p.kind, x: p.pos.x, y: p.pos.y,
        vx: p.vel.x, vy: p.vel.y, damage: p.damage, lifetime: p.lifetime
      })),
      availableActions: ['move', 'stop', 'aim', 'fire', 'interact']
    };
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
