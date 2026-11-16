// P3-a — echo companion intent policy.
//
// Pure, Phaser-free decision layer used by BOTH the rendered World and the
// Node parity driver. It never reads the map, the RNG, the seed or hidden
// entities: the caller passes only the echo's own bounded perception
// (12 tiles + line of sight) and the controller returns a legal
// SimulationIntent for the SAME core tick. It cannot write HP/position.

import type { SimulationIntent } from '../world/sim/core';

export type EchoMode = 'follow' | 'hold' | 'move-to';

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
  arriveTiles: 0.75
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
}

export interface EchoMemoryEntry {
  tick: number;
  id: number;
  x: number;
  y: number;
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
  readonly memory: EchoMemoryEntry[] = [];
  lastIntent: SimulationIntent = neutral();
  /** Set when the last view showed no living echo (dead/despawned). */
  lastAlive = true;

  setMode(mode: EchoMode, target: { x: number; y: number } | null = null): void {
    this.mode = mode;
    this.moveTarget = mode === 'move-to' ? target : null;
    // A mode switch clears intent AND revokes the assist confirmation.
    this.assistConfirmed = false;
    this.suggestion = null;
    this.lastIntent = neutral();
  }

  confirmAssist(): void {
    this.assistConfirmed = true;
    this.suggestion = null;
  }

  /**
   * Full authority reset after checkpoint restore, restart, death or a stale
   * epoch: follow mode, no assist, no suggestion, no memory, neutral intent.
   */
  reset(): void {
    this.mode = 'follow';
    this.moveTarget = null;
    this.assistConfirmed = false;
    this.suggestion = null;
    this.memory.length = 0;
    this.lastIntent = neutral();
    this.lastAlive = true;
  }

  /** Explicit human revoke of assist fire (never automatic). */
  revokeAssist(): void {
    this.assistConfirmed = false;
    this.suggestion = null;
  }

  /**
   * A real room transition invalidates everything the echo learned in the old
   * room: the armed assist, the pending suggestion and the target memory.
   * The human's chosen MOVEMENT mode is preserved on purpose.
   */
  clearForRoomTransition(): void {
    this.assistConfirmed = false;
    this.suggestion = null;
    this.memory.length = 0;
    this.lastIntent = neutral();
    this.moveTarget = null;
    if (this.mode === 'move-to') this.mode = 'follow';
  }

  /** Disconnect / death / takeover: the echo stops acting immediately. */
  clearIntent(): void {
    this.assistConfirmed = false;
    this.suggestion = null;
    this.lastIntent = neutral();
  }

  /** Record only what the echo actually perceived; bounded and expiring. */
  observe(view: EchoView): void {
    const cutoff = view.tick - ECHO_LIMITS.memoryTtlTicks;
    for (let i = this.memory.length - 1; i >= 0; i -= 1) {
      if (this.memory[i].tick < cutoff) this.memory.splice(i, 1);
    }
    for (const drone of view.drones) {
      if (drone.hp <= 0) continue;
      this.memory.push({ tick: view.tick, id: drone.id, x: drone.x, y: drone.y });
    }
    if (this.memory.length > ECHO_LIMITS.memoryEntries) {
      this.memory.splice(0, this.memory.length - ECHO_LIMITS.memoryEntries);
    }
  }

  /** Suggest assist fire; the user must still confirm it. */
  suggest(view: EchoView): 'fire' | null {
    const target = nearest(view.echo, [...view.drones, ...(view.targets ?? [])]);
    this.suggestion = !this.assistConfirmed && target ? 'fire' : null;
    return this.suggestion;
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
    if (this.mode === 'follow') {
      const d = Math.hypot(view.player.x - view.echo.x, view.player.y - view.echo.y);
      if (d > ECHO_LIMITS.standoffTiles) move = unitToward(view.echo, view.player);
    } else if (this.mode === 'move-to' && this.moveTarget) {
      const d = Math.hypot(this.moveTarget.x - view.echo.x, this.moveTarget.y - view.echo.y);
      if (d > ECHO_LIMITS.arriveTiles) move = unitToward(view.echo, this.moveTarget);
      else this.moveTarget = null;
    }
    const fire = this.assistConfirmed && !!target
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
    this.mode = state.mode === 'hold' || state.mode === 'move-to' ? state.mode : 'follow';
    this.moveTarget = state.moveTarget ? { ...state.moveTarget } : null;
    this.assistConfirmed = state.assistConfirmed === true;
    this.memory.length = 0;
    for (const entry of state.memory.slice(-ECHO_LIMITS.memoryEntries)) this.memory.push({ ...entry });
    this.lastIntent = { ...state.lastIntent, move: { ...state.lastIntent.move } };
  }

  /** Short HUD status; never includes hidden state. */
  label(): string {
    const mode = this.mode === 'follow' ? 'FOLLOW' : this.mode === 'hold' ? 'HOLD' : 'MOVE';
    return `ECHO ${mode} · ASSIST ${this.assistConfirmed ? 'ARMED' : 'SAFE'}`;
  }
}
