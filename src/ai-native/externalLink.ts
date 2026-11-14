// AI-NATIVE-02 C3-b — external agent link state for the RENDERED world.
//
// Pure TypeScript: no Phaser, no DOM, no timers, no RNG. The rendered browser
// owns the only SimulationState; this module only tracks the authorization
// state machine, the external intent queue and the commit receipts.
//
// Invariants enforced here:
//  - A session is created ONLY by an explicit human authorization.
//  - External input becomes a legal PlayerIntent; it never writes coordinates,
//    HP, loot or scene state directly.
//  - A receipt is 'applied' only when the intent was actually committed by the
//    core tick (real post-commit tick), never while it is still queued.
//  - Every takeover / pause / death / scene exit cancels pending external
//    intents (YIELDED) and bumps the epoch, so stale intents can never apply.

import type { PlayerIntent } from './control';

export type ExternalLinkStatus =
  | 'DISCONNECTED'
  | 'AUTHORIZING'
  | 'CONNECTED'
  | 'YIELDED'
  | 'LOST';

export type ExternalActionStatus = 'queued' | 'applied' | 'rejected' | 'expired' | 'cancelled';

export interface ExternalActionReceipt {
  readonly actionId: string;
  readonly requestId: string;
  readonly status: ExternalActionStatus;
  /** The core tick that actually applied the intent (post-commit). */
  readonly appliedTick?: number;
  readonly code?: string;
}

export interface ExternalIntentCommand {
  readonly actionId: string;
  readonly requestId: string;
  readonly intent: PlayerIntent;
  /** Core tick after which the intent expires if not applied. */
  readonly applyByTick: number;
  readonly ttlTicks: number;
}

export type ExternalLinkYieldReason =
  | 'takeover' | 'pause' | 'death' | 'scene-exit' | 'disconnect' | 'heartbeat-loss'
  | 'level-up' | 'inventory';

export interface ExternalLinkSnapshot {
  readonly status: ExternalLinkStatus;
  readonly epoch: number;
  readonly session: string | null;
  readonly pendingCount: number;
  readonly lastAction: string | null;
  readonly lastAppliedTick: number | null;
  readonly humanAuthorized: boolean;
}

export interface ExternalLinkOptions {
  /** Maximum number of intents that may be queued at once. */
  readonly maxPending?: number;
  /** Maximum number of receipts retained (bounded). */
  readonly maxReceipts?: number;
  readonly sessionIdFactory?: () => string;
}

export const EXTERNAL_LINK_LIMITS = Object.freeze({
  MAX_PENDING: 8,
  MAX_RECEIPTS: 32,
  DEFAULT_TTL_TICKS: 120,
  MAX_TTL_TICKS: 600
});

let sessionCounter = 0;

/** Deterministic-ish session id that never contains a token or secret. */
export function newExternalSessionId(): string {
  sessionCounter += 1;
  return `ext-${Date.now().toString(36)}-${sessionCounter.toString(36)}`;
}

export class ExternalLinkState {
  private _status: ExternalLinkStatus = 'DISCONNECTED';
  private _epoch = 1;
  private _session: string | null = null;
  private _humanAuthorized = false;
  private readonly pending = new Map<string, ExternalIntentCommand>();
  private readonly receipts = new Map<string, ExternalActionReceipt>();
  private readonly maxPending: number;
  private readonly maxReceipts: number;
  private readonly sessionIdFactory: () => string;
  private _lastAction: string | null = null;
  private _lastAppliedTick: number | null = null;

  constructor(options: ExternalLinkOptions = {}) {
    this.maxPending = options.maxPending ?? EXTERNAL_LINK_LIMITS.MAX_PENDING;
    this.maxReceipts = options.maxReceipts ?? EXTERNAL_LINK_LIMITS.MAX_RECEIPTS;
    this.sessionIdFactory = options.sessionIdFactory ?? newExternalSessionId;
  }

  get status(): ExternalLinkStatus { return this._status; }
  get epoch(): number { return this._epoch; }
  get session(): string | null { return this._session; }
  get humanAuthorized(): boolean { return this._humanAuthorized; }
  get pendingCount(): number { return this.pending.size; }

  /**
   * A session exists only after an explicit HUMAN authorization.
   * `humanAuthorized` must be true; an agent can never self-authorize.
   */
  authorize(humanAuthorized: boolean): { ok: true; session: string; epoch: number } | { ok: false; code: string } {
    if (!humanAuthorized) return { ok: false, code: 'E_PERMISSION' };
    if (this._status === 'CONNECTED') return { ok: false, code: 'E_TICK_CONFLICT' };
    this._session = this.sessionIdFactory();
    this._epoch += 1;
    this._humanAuthorized = true;
    this._status = 'AUTHORIZING';
    return { ok: true, session: this._session, epoch: this._epoch };
  }

  /**
   * The bridge handshake succeeded: the link is live. The bridge is the
   * authority for the session id and the epoch, so the rendered side ADOPTS
   * them (the local proposal is only a placeholder until now).
   */
  connected(session: string, epoch: number): boolean {
    if (this._status !== 'AUTHORIZING') return false;
    if (!session || !Number.isInteger(epoch) || epoch < 0) return false;
    this._session = session;
    this._epoch = epoch;
    this._status = 'CONNECTED';
    return true;
  }

  /**
   * Queue a legal external intent. Returns a receipt-like result:
   *  - 'queued' means the intent will be applied by a later core tick;
   *  - 'rejected' means it was refused (unknown/stale epoch, cap, bad id).
   */
  enqueueIntent(command: ExternalIntentCommand, currentTick: number): ExternalActionReceipt {
    const { actionId, requestId } = command;
    if (this._status !== 'CONNECTED') {
      return this.record({ actionId, requestId, status: 'rejected', code: 'E_LINK_UNAVAILABLE' });
    }
    if (this.pending.has(actionId) || this.receipts.has(actionId)) {
      // Same action id twice: idempotent, never applied twice.
      const prior = this.receipts.get(actionId);
      return prior ?? this.record({ actionId, requestId, status: 'rejected', code: 'E_TICK_CONFLICT' });
    }
    if (this.pending.size >= this.maxPending) {
      return this.record({ actionId, requestId, status: 'rejected', code: 'E_RESOURCE_LIMIT' });
    }
    if (command.applyByTick <= currentTick) {
      return this.record({ actionId, requestId, status: 'expired', code: 'E_TIMEOUT' });
    }
    this.pending.set(actionId, command);
    this._lastAction = actionId;
    return this.record({ actionId, requestId, status: 'queued' });
  }

  /** The intent that should be executed by the next rendered frame. */
  takeNextIntent(): ExternalIntentCommand | null {
    for (const command of this.pending.values()) return command;
    return null;
  }

  /** The core tick actually applied an intent: the receipt becomes 'applied'. */
  commitApplied(actionId: string, appliedTick: number): ExternalActionReceipt | null {
    const command = this.pending.get(actionId);
    if (!command) return null;
    this.pending.delete(actionId);
    this._lastAppliedTick = appliedTick;
    return this.record({
      actionId, requestId: command.requestId, status: 'applied', appliedTick
    });
  }

  /** The intent could not be executed (illegal/expired): the receipt says so. */
  commitRejected(actionId: string, code: string, appliedTick: number): ExternalActionReceipt | null {
    const command = this.pending.get(actionId);
    if (!command) return null;
    this.pending.delete(actionId);
    this._lastAppliedTick = appliedTick;
    return this.record({ actionId, requestId: command.requestId, status: 'rejected', code, appliedTick });
  }

  /** Expire intents whose apply-by tick has passed. */
  expireOverdue(currentTick: number): void {
    for (const [actionId, command] of [...this.pending.entries()]) {
      if (command.applyByTick <= currentTick) {
        this.pending.delete(actionId);
        this.record({ actionId, requestId: command.requestId, status: 'expired', code: 'E_TIMEOUT' });
      }
    }
  }

  /**
   * Any human takeover / pause / death / scene exit cancels every pending
   * external intent and bumps the epoch, so stale intents cannot apply and the
   * agent is told the link yielded.
   */
  yield(reason: ExternalLinkYieldReason): {
    epoch: number;
    cancelled: ExternalActionReceipt[];
    reason: string;
  } {
    const cancelled: ExternalActionReceipt[] = [];
    for (const [actionId, command] of [...this.pending.entries()]) {
      this.pending.delete(actionId);
      cancelled.push(this.record({
        actionId, requestId: command.requestId, status: 'cancelled', code: 'E_LINK_UNAVAILABLE'
      }));
    }
    this._epoch += 1;
    if (reason === 'disconnect' || reason === 'heartbeat-loss') this._status = 'LOST';
    else this._status = 'YIELDED';
    return { epoch: this._epoch, cancelled, reason };
  }

  /** Heartbeat loss / EOF / SIGINT: the link degrades, control stays human. */
  disconnect(): void {
    this.yield('disconnect');
    this._status = 'LOST';
    this._humanAuthorized = false;
    this._session = null;
  }

  reset(): void {
    this.pending.clear();
    this.receipts.clear();
    this._status = 'DISCONNECTED';
    this._epoch += 1;
    this._session = null;
    this._humanAuthorized = false;
    this._lastAction = null;
    this._lastAppliedTick = null;
  }

  receipt(actionId: string): ExternalActionReceipt | null {
    return this.receipts.get(actionId) ?? null;
  }

  snapshot(): ExternalLinkSnapshot {
    return {
      status: this._status,
      epoch: this._epoch,
      session: this._session,
      pendingCount: this.pending.size,
      lastAction: this._lastAction,
      lastAppliedTick: this._lastAppliedTick,
      humanAuthorized: this._humanAuthorized
    };
  }

  private record(receipt: ExternalActionReceipt): ExternalActionReceipt {
    this.receipts.set(receipt.actionId, receipt);
    while (this.receipts.size > this.maxReceipts) {
      const oldest = this.receipts.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.receipts.delete(oldest);
    }
    return receipt;
  }
}
