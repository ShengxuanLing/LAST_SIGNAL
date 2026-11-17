// P3-a / GAMEPLAY-01 P2 — echo companion intent policy.
//
// Pure, Phaser-free decision/proposal layer used by BOTH the rendered World and
// the formal headless entry. It never reads the map, the RNG, the seed or hidden
// entities: the caller passes only the echo's own bounded perception (12 tiles +
// explored + line of sight) plus, for the low-risk move, a bounded `canWalk`
// probe the caller restricts to the same perception. It never writes HP/position
// /energy.

import type { SimulationIntent } from '../world/sim/core';
import { SIGNAL_TUNING } from '../signal/signalTuning';

export type EchoMode = 'follow' | 'hold' | 'move-to' | 'observe';
export type EchoLocalProposalKind = 'scan' | 'jam' | 'toggle-relay';

export const ECHO_LIMITS = {
  /** Memory is bounded and expires; it is not a second map. */
  memoryEntries: 16,
  memoryTtlTicks: 600,
  /** The echo's own perception radius in grid tiles. */
  perceptionTiles: 12,
  /** Follow standoff distance in grid tiles. */
  standoffTiles: 3,
  /** Fire only at a target the echo already perceives (never through walls). */
  fireRangeTiles: 12,
  /** move-to arrival threshold in grid tiles. */
  arriveTiles: 0.75,
  /** A local proposal is only valid for this many ticks. */
  localProposalTtlTicks: 120,
  /** After a human rejection, do not re-propose for this many ticks. */
  localRejectCooldownTicks: 120,
  /** Low-risk safe move: candidates within this radius of the echo. */
  safeMoveRadiusTiles: 3,
  /** Do not step within this distance of a perceived hostile. */
  safeHostileClearanceTiles: 2
} as const;

export interface EchoVisibleActor {
  id: number;
  x: number;
  y: number;
  hp: number;
}

/** Non-drone / Boss public state, still echo-perceived only. */
export interface EchoVisibleTarget extends EchoVisibleActor {
  kind: string;
  isBoss: boolean;
}

/** The echo's own legal view. Only perceived actors are present. */
export interface EchoView {
  tick: number;
  player: { x: number; y: number };
  echo: { x: number; y: number; hp: number; maxHp: number; aimYaw: number };
  drones: EchoVisibleActor[];
  /** Non-drone / Boss public state; empty when none are perceived. */
  targets?: readonly EchoVisibleTarget[];
  /** Echo-perceived relay (absent when not perceived); no hidden state. */
  relay?: { id: string; x: number; y: number; state: string } | null;
  /** The echo's OWN finite account. */
  energy?: { current: number; max: number };
  cooldowns?: { scanTicks: number; jamTicks: number };
  /** Bounded probe supplied by the caller; must be false outside perception. */
  canWalk?: (x: number, y: number) => boolean;
  /** Low-risk switch state (a saved human preference; default false). */
  autonomyEnabled?: boolean;
  /** Room/generation to bind local proposals; a committed room change bumps it. */
  roomGeneration?: number;
}

/** Local perception memory only; Owner/agent decisions never enter it. */
export interface EchoMemoryEntry {
  tick: number;
  id: number | string;
  kind?: 'drone' | 'relay' | 'target';
  x: number;
  y: number;
  /** Only echo-perception is allowed here. */
  source?: 'echo-perception';
  expiresAtTick?: number;
  roomGeneration?: number;
}

/** A local, non-executing proposal. The human confirms it in the UI. */
export interface EchoLocalProposal {
  id: string;
  kind: EchoLocalProposalKind;
  target: { x: number; y: number } | null;
  reason: string;
  evidenceRef: string;
  observedTick: number;
  expiresAtTick: number;
  roomGeneration: number;
  provenance: 'local-echo';
  expectation: string;
  uncertainty: string;
  cost: { energy: number; resource: 'echo-energy' | 'none' };
  needsConfirm: true;
}

export interface EchoLocalValidation {
  ok: boolean;
  code?: 'E_OWNER_NOT_HUMAN' | 'E_STALE_ID' | 'E_EXPIRED' | 'E_STALE_ROOM' | 'E_REJECTED' | 'E_ALREADY_PENDING';
}

function neutral(): SimulationIntent {
  return { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
}

function unitToward(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

function nearest(actor: { x: number; y: number }, actors: readonly EchoVisibleActor[]): EchoVisibleActor | null {
  let best: EchoVisibleActor | null = null;
  let bestD = Infinity;
  for (const candidate of actors) {
    if (candidate.hp <= 0) continue;
    const d = Math.hypot(candidate.x - actor.x, candidate.y - actor.y);
    if (d < bestD) { best = candidate; bestD = d; }
  }
  return best;
}

export class EchoController {
  mode: EchoMode = 'follow';
  moveTarget: { x: number; y: number } | null = null;
  /** Assist fire requires an explicit user confirm; never auto-enabled. */
  assistConfirmed = false;
  suggestion: 'fire' | null = null;
  /** Local perception memory only (echo-perception source). */
  readonly memory: EchoMemoryEntry[] = [];
  lastIntent: SimulationIntent = neutral();
  /** Set when the last view showed no living echo (dead/despawned). */
  lastAlive = true;
  /** Low-risk cooperation switch (saved human preference; default false). */
  autonomyEnabled = false;
  /** Bound to the committed room/generation; a change invalidates proposals. */
  roomGeneration = 0;
  /** The current local proposal (non-executing; human confirms in the UI). */
  localProposal: EchoLocalProposal | null = null;
  /** A human-confirmed local action waiting for its actual core receipt. */
  pendingLocalProposal: EchoLocalProposal | null = null;
  /** A queued core signal command restored from a raw sim whose source is unknown.
   *  It is a conservative busy marker only: no proposal id, no local receipt. */
  restoredPendingKind: EchoLocalProposalKind | null = null;
  private proposalCounter = 0;
  private nextProposalAllowedTick = -1;
  private lastRejectedId: string | null = null;
  /** Autonomously chosen low-risk move target (never a hidden-map path). */
  private safeTarget: { x: number; y: number } | null = null;

  setMode(mode: EchoMode, target: { x: number; y: number } | null = null): void {
    this.mode = mode;
    this.moveTarget = mode === 'move-to' ? target : null;
    // A mode switch clears intent AND revokes the assist confirmation.
    this.assistConfirmed = false;
    this.suggestion = null;
    this.lastIntent = neutral();
    this.safeTarget = null;
  }

  /** Low-risk switch. OFF clears only autonomously chosen movement, not the mode. */
  setAutonomy(enabled: boolean): void {
    this.autonomyEnabled = enabled;
    if (!enabled) this.safeTarget = null;
  }

  /** A committed room change invalidates memory and local proposals. */
  setRoomGeneration(generation: number): void {
    if (generation === this.roomGeneration) return;
    this.roomGeneration = generation;
    this.memory.length = 0;
    this.localProposal = null;
    this.pendingLocalProposal = null;
    this.nextProposalAllowedTick = -1;
    this.lastRejectedId = null;
    this.safeTarget = null;
  }

  confirmAssist(): void {
    this.assistConfirmed = true;
    this.suggestion = null;
  }

  /**
   * Full authority reset after checkpoint restore, restart, death or a stale
   * epoch: follow mode, no assist, no suggestion, no memory, neutral intent.
   * The saved low-risk switch is owned by the World and is not silently enabled.
   */
  reset(): void {
    this.mode = 'follow';
    this.moveTarget = null;
    this.assistConfirmed = false;
    this.suggestion = null;
    this.memory.length = 0;
    this.lastIntent = neutral();
    this.lastAlive = true;
    this.localProposal = null;
    this.pendingLocalProposal = null;
    this.restoredPendingKind = null;
    this.nextProposalAllowedTick = -1;
    this.lastRejectedId = null;
    this.safeTarget = null;
  }

  /** Explicit human revoke of assist fire (never automatic). */
  revokeAssist(): void {
    this.assistConfirmed = false;
    this.suggestion = null;
  }

  /**
   * A real room transition invalidates everything the echo learned in the old
   * room: armed assist, pending suggestion, target memory and local proposal.
   * The human's chosen MOVEMENT mode is preserved on purpose.
   */
  clearForRoomTransition(): void {
    this.assistConfirmed = false;
    this.suggestion = null;
    this.memory.length = 0;
    this.lastIntent = neutral();
    this.moveTarget = null;
    this.localProposal = null;
    this.pendingLocalProposal = null;
    this.nextProposalAllowedTick = -1;
    this.lastRejectedId = null;
    this.safeTarget = null;
    if (this.mode === 'move-to') this.mode = 'follow';
  }

  /** Disconnect / death / takeover: the echo stops acting immediately. */
  clearIntent(): void {
    this.assistConfirmed = false;
    this.suggestion = null;
    this.lastIntent = neutral();
    this.safeTarget = null;
    this.localProposal = null;
    this.pendingLocalProposal = null;
  }

  /** Mark/clear a raw-sim queued signal with unknown provenance (no fake id). */
  setRestoredPending(kind: EchoLocalProposalKind): void {
    this.restoredPendingKind = kind;
    this.localProposal = null;
  }

  clearRestoredPending(): void {
    this.restoredPendingKind = null;
  }

  /** Record only what the echo actually perceived; bounded and expiring. */
  observe(view: EchoView): void {
    const generation = view.roomGeneration ?? this.roomGeneration;
    const cutoff = view.tick - ECHO_LIMITS.memoryTtlTicks;
    for (let i = this.memory.length - 1; i >= 0; i -= 1) {
      const entry = this.memory[i];
      const expired = entry.tick < cutoff ||
        (entry.expiresAtTick !== undefined && view.tick > entry.expiresAtTick) ||
        (entry.roomGeneration !== undefined && entry.roomGeneration !== generation);
      if (expired) this.memory.splice(i, 1);
    }
    const push = (kind: 'drone' | 'relay' | 'target', id: number | string, x: number, y: number): void => {
      this.memory.push({
        tick: view.tick, id, kind, x, y, source: 'echo-perception',
        expiresAtTick: view.tick + ECHO_LIMITS.memoryTtlTicks, roomGeneration: generation
      });
    };
    for (const drone of view.drones) {
      if (drone.hp <= 0) continue;
      push('drone', drone.id, drone.x, drone.y);
    }
    for (const target of view.targets ?? []) {
      if (target.hp <= 0) continue;
      push('target', target.id, target.x, target.y);
    }
    if (view.relay) {
      // Keep one latest relay observation, never a hidden current state.
      for (let i = this.memory.length - 1; i >= 0; i -= 1) {
        const e = this.memory[i];
        if (e.kind === 'relay' && e.id === view.relay.id) this.memory.splice(i, 1);
      }
      push('relay', view.relay.id, view.relay.x, view.relay.y);
    }
    if (this.memory.length > ECHO_LIMITS.memoryEntries) {
      this.memory.splice(0, this.memory.length - ECHO_LIMITS.memoryEntries);
    }
  }

  /**
   * Produce at most one local, non-executing proposal from the legal view.
   * The human confirms it through the World boundary; nothing is enqueued here.
   */
  propose(view: EchoView): EchoLocalProposal | null {
    this.observe(view);
    // One human-confirmed action may be in flight at a time. A raw-sim restore
    // with an unknown queued signal is also busy (conservative; no fake id).
    if (this.pendingLocalProposal || this.restoredPendingKind) return null;
    const generation = view.roomGeneration ?? this.roomGeneration;
    const relay = view.relay;
    const distance = relay && view.echo ? Math.hypot(relay.x - view.echo.x, relay.y - view.echo.y) : Infinity;
    const energy = view.energy?.current ?? 0;
    const scanCd = view.cooldowns?.scanTicks ?? 0;
    const scanLegal = !!relay && distance < SIGNAL_TUNING.SCAN_RADIUS &&
      energy >= SIGNAL_TUNING.SCAN_COST && scanCd <= 0;
    const toggleLegal = !!relay && distance < SIGNAL_TUNING.JAM_RANGE;
    const legalKind: EchoLocalProposalKind | null = scanLegal ? 'scan' : toggleLegal ? 'toggle-relay' : null;
    // Keep the displayed id only while that exact proposal is still legal and
    // the perceived target has not moved; otherwise refresh (e.g. after a
    // scan cooldown) so the page never offers a stale action.
    if (this.localProposal && view.tick < this.localProposal.expiresAtTick &&
        this.localProposal.roomGeneration === generation) {
      const current = this.localProposal;
      const target = current.target;
      const sameTarget = !!relay && !!target && target.x === relay.x && target.y === relay.y;
      const stillLegal = sameTarget &&
        (current.kind === 'scan' ? scanLegal : current.kind === 'toggle-relay' ? toggleLegal : false);
      if (stillLegal) return current;
      this.localProposal = null;
    } else {
      this.localProposal = null;
    }
    if (!view.echo || view.echo.hp <= 0 || !relay || !legalKind) return null;
    if (view.tick < this.nextProposalAllowedTick) return null;
    const kind = legalKind;
    const id = `local_${view.tick}_${++this.proposalCounter}`;
    this.localProposal = {
      id, kind, target: { x: relay.x, y: relay.y },
      reason: 'perceived_relay',
      evidenceRef: `relay:${relay.id}`,
      observedTick: view.tick,
      expiresAtTick: view.tick + ECHO_LIMITS.localProposalTtlTicks,
      roomGeneration: generation,
      provenance: 'local-echo',
      expectation: kind === 'scan' ? 'reveal relay facts' : 'change relay output / route',
      uncertainty: 'only if still perceived and permitted',
      cost: kind === 'scan'
        ? { energy: SIGNAL_TUNING.SCAN_COST, resource: 'echo-energy' }
        : { energy: 0, resource: 'none' },
      needsConfirm: true
    };
    return this.localProposal;
  }

  /** Pure local-confirm validation (the World adds target-legality + enqueue). */
  validateLocalProposal(id: string, tick: number, roomGeneration: number, ownerHuman: boolean): EchoLocalValidation {
    if (!ownerHuman) return { ok: false, code: 'E_OWNER_NOT_HUMAN' };
    if (this.pendingLocalProposal || this.restoredPendingKind) return { ok: false, code: 'E_ALREADY_PENDING' };
    const proposal = this.localProposal;
    if (!proposal || proposal.id !== id) return { ok: false, code: 'E_STALE_ID' };
    if (this.lastRejectedId === id) return { ok: false, code: 'E_REJECTED' };
    if (tick >= proposal.expiresAtTick) return { ok: false, code: 'E_EXPIRED' };
    if (proposal.roomGeneration !== roomGeneration) return { ok: false, code: 'E_STALE_ROOM' };
    return { ok: true };
  }

  /** Move the displayed proposal into the single in-flight slot. */
  markLocalPending(proposal: EchoLocalProposal): void {
    this.pendingLocalProposal = proposal;
    this.localProposal = null;
    this.lastRejectedId = null;
  }

  /** Clear the in-flight marker only after a real core receipt or explicit cancel. */
  clearLocalPending(): void {
    this.pendingLocalProposal = null;
  }

  consumeLocalProposal(id: string): void {
    if (!this.localProposal || this.localProposal.id !== id) return;
    this.localProposal = null;
    this.lastRejectedId = null;
  }

  rejectLocalProposal(id: string, tick: number): void {
    if (!this.localProposal || this.localProposal.id !== id) return;
    this.lastRejectedId = id;
    this.localProposal = null;
    this.nextProposalAllowedTick = tick + ECHO_LIMITS.localRejectCooldownTicks;
  }

  /** Suggest assist fire; the user must still confirm it. */
  suggest(view: EchoView): 'fire' | null {
    const target = nearest(view.echo, [...view.drones, ...(view.targets ?? [])]);
    this.suggestion = !this.assistConfirmed && target ? 'fire' : null;
    return this.suggestion;
  }

  /** Deterministic low-risk target: perceived, walkable, clear of hostiles. */
  private chooseSafeTarget(view: EchoView): { x: number; y: number } | null {
    if (!view.canWalk || !this.autonomyEnabled) return null;
    const echo = view.echo;
    const hostiles = [...view.drones, ...(view.targets ?? [])].filter((h) => h.hp > 0);
    const candidates: Array<{ x: number; y: number; d: number }> = [];
    const radius = ECHO_LIMITS.safeMoveRadiusTiles;
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const x = echo.x + dx, y = echo.y + dy;
        if (!view.canWalk(x, y)) continue;
        if (Math.hypot(x - view.player.x, y - view.player.y) < ECHO_LIMITS.arriveTiles) continue;
        if (hostiles.some((h) => Math.hypot(h.x - x, h.y - y) < ECHO_LIMITS.safeHostileClearanceTiles)) continue;
        candidates.push({ x, y, d });
      }
    }
    if (!candidates.length) { this.safeTarget = null; return null; }
    if (this.safeTarget) {
      const keep = candidates.find((c) => Math.abs(c.x - this.safeTarget!.x) < 0.5 && Math.abs(c.y - this.safeTarget!.y) < 0.5);
      if (keep && Math.hypot(this.safeTarget.x - echo.x, this.safeTarget.y - echo.y) > ECHO_LIMITS.arriveTiles) return this.safeTarget;
      if (keep) return this.safeTarget; // arrived: hold the spot, do not wander
    }
    candidates.sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y);
    this.safeTarget = { x: candidates[0].x, y: candidates[0].y };
    return this.safeTarget;
  }

  decide(view: EchoView): SimulationIntent {
    this.observe(view);
    this.lastAlive = view.echo.hp > 0;
    if (!this.lastAlive) {
      this.lastIntent = neutral();
      return this.lastIntent;
    }
    const target = nearest(view.echo, [...view.drones, ...(view.targets ?? [])]);
    const aim = target ? { x: target.x, y: target.y } : null;
    let move = { x: 0, y: 0 };
    if (this.mode === 'hold') {
      // HOLD always wins: no automatic movement, no recovery drift.
    } else if (this.mode === 'move-to' && this.moveTarget) {
      const d = Math.hypot(this.moveTarget.x - view.echo.x, this.moveTarget.y - view.echo.y);
      if (d > ECHO_LIMITS.arriveTiles) move = unitToward(view.echo, this.moveTarget);
      else this.moveTarget = null;
    } else if (this.mode === 'follow') {
      const d = Math.hypot(view.player.x - view.echo.x, view.player.y - view.echo.y);
      if (d > ECHO_LIMITS.standoffTiles) move = unitToward(view.echo, view.player);
    } else if (this.mode === 'observe') {
      const safe = this.chooseSafeTarget(view);
      if (safe) {
        const d = Math.hypot(safe.x - view.echo.x, safe.y - view.echo.y);
        if (d > ECHO_LIMITS.arriveTiles) move = unitToward(view.echo, safe);
      }
    }
    const fire = this.mode !== 'observe' && this.assistConfirmed && !!target
      && Math.hypot(target.x - view.echo.x, target.y - view.echo.y) <= ECHO_LIMITS.fireRangeTiles;
    this.lastIntent = { move, dash: false, fire, aim, interact: false };
    return this.lastIntent;
  }

  /** Serializable policy state for parity/demo mid-run restore. */
  snapshotState(): {
    mode: EchoMode; moveTarget: { x: number; y: number } | null;
    assistConfirmed: boolean; memory: EchoMemoryEntry[]; lastIntent: SimulationIntent;
  } {
    return {
      mode: this.mode,
      moveTarget: this.moveTarget ? { ...this.moveTarget } : null,
      assistConfirmed: this.assistConfirmed,
      memory: this.memory.map((entry) => ({ ...entry })),
      lastIntent: { ...this.lastIntent, move: { ...this.lastIntent.move } }
    };
  }

  loadState(state: ReturnType<EchoController['snapshotState']>): void {
    this.mode = state.mode === 'hold' || state.mode === 'move-to' || state.mode === 'observe' ? state.mode : 'follow';
    this.moveTarget = state.moveTarget ? { ...state.moveTarget } : null;
    this.assistConfirmed = state.assistConfirmed === true;
    this.memory.length = 0;
    for (const entry of state.memory.slice(-ECHO_LIMITS.memoryEntries)) this.memory.push({ ...entry });
    this.lastIntent = { ...state.lastIntent, move: { ...state.lastIntent.move } };
  }

  /** Short HUD status; never includes hidden state. */
  label(): string {
    const mode = this.mode === 'follow' ? 'FOLLOW' : this.mode === 'hold' ? 'HOLD'
      : this.mode === 'observe' ? 'OBSERVE' : 'MOVE';
    return `ECHO ${mode} · ASSIST ${this.assistConfirmed ? 'ARMED' : 'SAFE'}`;
  }
}
