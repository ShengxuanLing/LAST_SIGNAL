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
//  - An action's `durationTicks` is consumed by REAL CORE TICKS, not by
//    rendered frames. One frame with N core ticks consumes N; several frames
//    with 1 tick each also consume N.
//  - A receipt is 'applied' only after the full duration was delivered to the
//    core. 'applied' means the legal intent was COMMITTED, not that a hit or a
//    displacement was guaranteed: walls, cooldowns and ammo still decide the
//    real effect, exactly as for a human player.
//  - Every takeover / pause / death / scene exit cancels the active execution
//    and all pending intents (YIELDED) and bumps the epoch, so a stale
//    continuation can never apply, ACK or heartbeat in a new epoch.

import type { PlayerIntent } from './control';
import { WORLD_LIMITS } from './worldProtocol';

export type ExternalLinkStatus =
  | 'DISCONNECTED'
  | 'AUTHORIZING'
  | 'CONNECTED'
  | 'YIELDED'
  | 'LOST';

export type ExternalActionStatus =
  | 'queued' | 'executing' | 'applied' | 'rejected' | 'expired' | 'cancelled';

export interface ExternalActionReceipt {
  readonly actionId: string;
  readonly requestId: string;
  readonly status: ExternalActionStatus;
  /** The core tick that actually COMMITTED the intent (post-commit). */
  readonly appliedTick?: number;
  /** First core tick that consumed this action's intent. */
  readonly startedTick?: number;
  /** Core tick at which the full duration finished (or was cancelled). */
  readonly completedTick?: number;
  /** Number of real core ticks the intent was delivered for. */
  readonly executedTicks?: number;
  /** Requested duration (integer core ticks). */
  readonly durationTicks?: number;
  readonly code?: string;
}

export interface ExternalIntentCommand {
  readonly actionId: string;
  readonly requestId: string;
  readonly intent: PlayerIntent;
  /** Core tick after which the intent expires if not fully delivered. */
  readonly applyByTick: number;
  readonly ttlTicks: number;
  /** Integer core ticks the intent must be delivered for (1..MAX_ACTION_TICKS). */
  readonly durationTicks?: number;
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
  MAX_TTL_TICKS: WORLD_LIMITS.MAX_TTL_TICKS,
  MAX_DURATION_TICKS: WORLD_LIMITS.MAX_ACTION_TICKS
});

export interface ExternalExecution {
  readonly actionId: string;
  readonly requestId: string;
  readonly intent: PlayerIntent;
  readonly startedTick: number;
  readonly durationTicks: number;
  readonly remainingTicks: number;
  readonly applyByTick: number;
  readonly epoch: number;
}

export interface ExternalCompletion {
  readonly actionId: string;
  readonly requestId: string;
  readonly receipt: ExternalActionReceipt;
  readonly epoch: number;
}

let sessionCounter = 0;

/** Deterministic-ish session id that never contains a token or secret. */
export function newExternalSessionId(): string {
  sessionCounter += 1;
  return `ext-${Date.now().toString(36)}-${sessionCounter.toString(36)}`;
}

function clampDuration(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(EXTERNAL_LINK_LIMITS.MAX_DURATION_TICKS, Math.floor(value)));
}

export class ExternalLinkState {
  private _status: ExternalLinkStatus = 'DISCONNECTED';
  private _epoch = 1;
  private _session: string | null = null;
  private _humanAuthorized = false;
  private readonly pending = new Map<string, ExternalIntentCommand>();
  private readonly receipts = new Map<string, ExternalActionReceipt>();
  private readonly completed: ExternalCompletion[] = [];
  private active: ExternalExecution | null = null;
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
  get pendingCount(): number { return this.pending.size + (this.active ? 1 : 0); }
  get hasActive(): boolean { return this.active !== null; }
  get activeExecution(): ExternalExecution | null { return this.active; }

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
   *  - 'queued' means the intent will be applied by later core ticks;
   *  - 'rejected'/'expired' means it was refused.
   * A duplicate actionId returns its prior receipt and NEVER re-executes.
   */
  enqueueIntent(command: ExternalIntentCommand, currentTick: number): ExternalActionReceipt {
    const { actionId, requestId } = command;
    const durationTicks = clampDuration(command.durationTicks);
    if (this._status !== 'CONNECTED') {
      return this.record({ actionId, requestId, status: 'rejected', code: 'E_LINK_UNAVAILABLE' });
    }
    if (this.active?.actionId === actionId || this.pending.has(actionId) || this.receipts.has(actionId)) {
      const prior = this.receipts.get(actionId);
      return prior ?? this.record({ actionId, requestId, status: 'rejected', code: 'E_TICK_CONFLICT' });
    }
    if (this.pending.size >= this.maxPending) {
      return this.record({ actionId, requestId, status: 'rejected', code: 'E_RESOURCE_LIMIT' });
    }
    if (command.applyByTick <= currentTick) {
      return this.record({ actionId, requestId, status: 'expired', code: 'E_TIMEOUT', durationTicks });
    }
    this.pending.set(actionId, { ...command, durationTicks });
    this._lastAction = actionId;
    return this.record({ actionId, requestId, status: 'queued', durationTicks });
  }

  /**
   * Start the FIRST queued action in FIFO order. The epoch is bound here so a
   * later yield/restore can never complete this execution in a new epoch.
   * Returns null when nothing is startable (empty, stale, or deadline too
   * short for the requested duration).
   */
  beginExecution(currentTick: number, epoch: number): ExternalExecution | null {
    if (this._status !== 'CONNECTED' || epoch !== this._epoch || this.active) return null;
    const head = this.pending.values().next();
    if (head.done) return null;
    const command = head.value as ExternalIntentCommand;
    const durationTicks = clampDuration(command.durationTicks);
    this.pending.delete(command.actionId);
    if (command.applyByTick <= currentTick || currentTick + durationTicks > command.applyByTick) {
      // Explicit execution deadline: the action cannot finish inside its TTL.
      this.pushCompletion(command.actionId, command.requestId, epoch, this.record({
        actionId: command.actionId, requestId: command.requestId,
        status: 'expired', code: 'E_TIMEOUT', startedTick: currentTick,
        completedTick: currentTick, executedTicks: 0, durationTicks
      }));
      return null;
    }
    const execution: ExternalExecution = {
      actionId: command.actionId,
      requestId: command.requestId,
      intent: command.intent,
      startedTick: currentTick,
      durationTicks,
      remainingTicks: durationTicks,
      applyByTick: command.applyByTick,
      epoch
    };
    this.active = execution;
    this.record({
      actionId: command.actionId, requestId: command.requestId,
      status: 'executing', startedTick: currentTick, durationTicks
    });
    return execution;
  }

  /** The intent the CURRENT core tick must run (only while an action is active). */
  activeIntent(): PlayerIntent | null {
    return this.active ? this.active.intent : null;
  }

  /** Compatibility accessor: the active command, never a queued one. */
  takeNextIntent(): ExternalIntentCommand | null {
    return this.active
      ? {
          actionId: this.active.actionId, requestId: this.active.requestId,
          intent: this.active.intent, applyByTick: this.active.applyByTick,
          ttlTicks: this.active.applyByTick - this.active.startedTick,
          durationTicks: this.active.durationTicks
        }
      : null;
  }

  /**
   * Consume REAL core ticks. Called once per `stepFrame` with the exact number
   * of ticks the core actually advanced (never with a frame count). Completes
   * the action when its full duration has been delivered, or expires it if the
   * execution deadline passed first.
   */
  advanceExecution(coreTicks: number, currentTick: number, epoch = this._epoch): ExternalCompletion | null {
    const execution = this.active;
    if (!execution) return null;
    if (epoch !== this._epoch || execution.epoch !== this._epoch || this._status !== 'CONNECTED') {
      return this.cancelActive(currentTick, 'E_STALE_EPOCH');
    }
    const consumed = Math.max(0, Math.min(coreTicks, execution.remainingTicks));
    const remaining = execution.remainingTicks - consumed;
    const executedTicks = execution.durationTicks - remaining;
    this.active = { ...execution, remainingTicks: remaining, };
    if (currentTick > execution.applyByTick) {
      return this.cancelActive(currentTick, 'E_TIMEOUT', executedTicks);
    }
    if (remaining > 0) {
      // Progress receipt: still executing, with real started/executed ticks.
      this.record({
        actionId: execution.actionId, requestId: execution.requestId,
        status: 'executing', startedTick: execution.startedTick,
        executedTicks, durationTicks: execution.durationTicks
      });
      return null;
    }
    const receipt = this.record({
      actionId: execution.actionId, requestId: execution.requestId,
      status: 'applied', appliedTick: currentTick,
      startedTick: execution.startedTick, completedTick: currentTick,
      executedTicks, durationTicks: execution.durationTicks
    });
    this._lastAppliedTick = currentTick;
    this.active = null;
    return this.pushCompletion(execution.actionId, execution.requestId, execution.epoch, receipt);
  }

  private cancelActive(currentTick: number, code: string, executedTicks = 0): ExternalCompletion {
    const execution = this.active!;
    const receipt = this.record({
      actionId: execution.actionId, requestId: execution.requestId,
      status: code === 'E_TIMEOUT' ? 'expired' : 'cancelled',
      code, startedTick: execution.startedTick, completedTick: currentTick,
      executedTicks, durationTicks: execution.durationTicks
    });
    this.active = null;
    return this.pushCompletion(execution.actionId, execution.requestId, execution.epoch, receipt);
  }

  private pushCompletion(
    actionId: string, requestId: string, epoch: number, receipt: ExternalActionReceipt
  ): ExternalCompletion {
    const completion: ExternalCompletion = { actionId, requestId, epoch, receipt };
    this.completed.push(completion);
    while (this.completed.length > EXTERNAL_LINK_LIMITS.MAX_RECEIPTS) this.completed.shift();
    return completion;
  }

  /** Drain post-commit completions for ACK. Must be re-validated by the caller. */
  drainCompleted(): ExternalCompletion[] {
    return this.completed.splice(0, this.completed.length);
  }

  /** Legacy completion path (kept for the direct unit API / no-active case). */
  commitApplied(actionId: string, appliedTick: number): ExternalActionReceipt | null {
    if (this.active?.actionId === actionId) {
      const completion = this.advanceExecution(this.active.remainingTicks, appliedTick);
      return completion?.receipt ?? null;
    }
    const command = this.pending.get(actionId);
    if (!command) return null;
    this.pending.delete(actionId);
    this._lastAppliedTick = appliedTick;
    const receipt = this.record({
      actionId, requestId: command.requestId, status: 'applied', appliedTick,
      startedTick: appliedTick, completedTick: appliedTick, executedTicks: 1,
      durationTicks: clampDuration(command.durationTicks)
    });
    this.pushCompletion(actionId, command.requestId, this._epoch, receipt);
    return receipt;
  }

  /** The intent could not be executed (illegal/expired): the receipt says so. */
  commitRejected(actionId: string, code: string, appliedTick: number): ExternalActionReceipt | null {
    if (this.active?.actionId === actionId) {
      const completion = this.cancelActive(appliedTick, code);
      return completion.receipt;
    }
    const command = this.pending.get(actionId);
    if (!command) return null;
    this.pending.delete(actionId);
    this._lastAppliedTick = appliedTick;
    const receipt = this.record({
      actionId, requestId: command.requestId, status: 'rejected', code, appliedTick,
      completedTick: appliedTick, executedTicks: 0,
      durationTicks: clampDuration(command.durationTicks)
    });
    this.pushCompletion(actionId, command.requestId, this._epoch, receipt);
    return receipt;
  }

  /** Expire intents whose apply-by tick has passed. */
  expireOverdue(currentTick: number): void {
    for (const [actionId, command] of [...this.pending.entries()]) {
      if (command.applyByTick <= currentTick) {
        this.pending.delete(actionId);
        this.record({
          actionId, requestId: command.requestId, status: 'expired', code: 'E_TIMEOUT',
          durationTicks: clampDuration(command.durationTicks)
        });
      }
    }
    if (this.active && (this.active.applyByTick <= currentTick || this.active.epoch !== this._epoch)) {
      this.cancelActive(currentTick, 'E_TIMEOUT');
    }
  }

  /**
   * Any human takeover / pause / death / scene exit cancels the ACTIVE
   * execution and every pending intent, clears late completions and bumps the
   * epoch, so stale callbacks can never apply, ACK or heartbeat in a new epoch.
   */
  yield(reason: ExternalLinkYieldReason): {
    epoch: number;
    cancelled: ExternalActionReceipt[];
    reason: string;
  } {
    const cancelled: ExternalActionReceipt[] = [];
    if (this.active) {
      const executedTicks = this.active.durationTicks - this.active.remainingTicks;
      cancelled.push(this.cancelActive(this.active.startedTick, 'E_LINK_UNAVAILABLE', executedTicks).receipt);
    }
    for (const [actionId, command] of [...this.pending.entries()]) {
      this.pending.delete(actionId);
      cancelled.push(this.record({
        actionId, requestId: command.requestId, status: 'cancelled', code: 'E_LINK_UNAVAILABLE',
        durationTicks: clampDuration(command.durationTicks)
      }));
    }
    // Late completions belong to the old epoch; they must never be ACKed.
    this.completed.length = 0;
    this._epoch += 1;
    if (reason === 'disconnect' || reason === 'heartbeat-loss') this._status = 'LOST';
    else this._status = 'YIELDED';
    // A yielded/lost link retains NO session and NO human authorization, so a
    // stale callback cannot attach to it and the agent must wait for a fresh
    // explicit human AUTHORIZE (which creates a NEW session).
    this._session = null;
    this._humanAuthorized = false;
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
    this.completed.length = 0;
    this.active = null;
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
      pendingCount: this.pendingCount,
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
