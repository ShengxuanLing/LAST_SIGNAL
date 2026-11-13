// AI-NATIVE-02 P1 — shared control seam for the real World.
//
// This module is the single place that defines *what a player wants to do*
// (PlayerIntent) and *who is allowed to ask for it* (ControlAuthority). It is
// pure TypeScript: no Phaser, no DOM, no timers, no RNG. The Phaser Player
// executes intents through its normal movement / aim / fire / interact code,
// so a local deterministic controller and the human use the exact same legal
// execution path. A controller never writes coordinates or HP directly.
//
// The controller implemented here is a LOCAL DETERMINISTIC DEMO. No external
// LLM / Codex / MCP agent is connected to the rendered World in this phase.

import type { Vec2 } from '../types';
import { screenVelocityToGridVelocity, gridDirectionToScreenDirection } from '../world/sim/rules';
import { IsoMath } from '../core/iso';

export type ControlOwner = 'human' | 'ai';

/** One frame's worth of player intent. `move` is a screen-space direction. */
export interface PlayerIntent {
  /** Screen-space direction, x right / y down. {0,0} means stop. */
  move: Vec2;
  dash: boolean;
  fire: boolean;
  /** Grid-space aim point, or null to keep the current aim. */
  aim: Vec2 | null;
  interact: boolean;
}

export function neutralIntent(): PlayerIntent {
  return { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
}

export interface HumanInputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  dash: boolean;
  fire: boolean;
  interact: boolean;
  /** Aim point already converted to grid space by the pointer adapter. */
  aim: Vec2 | null;
}

/** Human adapter: raw device state -> intent (same DTO the AI produces). */
export function intentFromHumanInput(input: HumanInputState): PlayerIntent {
  return {
    move: {
      x: (input.right ? 1 : 0) - (input.left ? 1 : 0),
      y: (input.down ? 1 : 0) - (input.up ? 1 : 0)
    },
    dash: input.dash,
    fire: input.fire,
    aim: input.aim,
    interact: input.interact
  };
}

// ---------------------------------------------------------------------------
// Movement budget: the real World is anisotropic (screen -> isometric grid).
// These helpers are the single implementation used by Player.applyIntent and
// by the deterministic controller to express "move toward this grid point".
// ---------------------------------------------------------------------------

export interface IntentVelocity { x: number; y: number; }

/** Screen-space unit direction -> the exact grid velocity a human holding that
 *  direction gets from the real Player movement code. Diagonal on-screen input
 *  therefore costs different grid speed per axis — the axis-separated budget is
 *  preserved, not replaced by a uniform speed. */
export function intentToWorldVelocity(move: Vec2, speed: number, tileW = IsoMath.TILE_W, tileH = IsoMath.TILE_H): IntentVelocity {
  return screenVelocityToGridVelocity(move, speed, tileW, tileH);
}

/** Grid-space direction -> screen-space direction that the executor turns back
 *  into that same grid direction (unit budget). Used only to aim movement. */
export function screenDirectionTowardGrid(dx: number, dy: number, tileW = IsoMath.TILE_W, tileH = IsoMath.TILE_H): Vec2 {
  return gridDirectionToScreenDirection(dx, dy, tileW, tileH);
}

// ---------------------------------------------------------------------------
// ControlAuthority — ownership / pause / takeover state machine.
// ---------------------------------------------------------------------------

export type ControlMode = 'HUMAN' | 'AI' | 'PAUSED';

export interface ControlSnapshot {
  owner: ControlOwner;
  aiEnabled: boolean;
  paused: boolean;
  mode: ControlMode;
  /** HUD label that never claims an external agent is attached. */
  modeLabel: string;
  controllerLabel: 'LOCAL DETERMINISTIC';
  agentLinkLabel: string;
  externalAgentConnected: false;
  takeoverCount: number;
  lastTakeoverReason: string | null;
  lastAiAction: string | null;
  lastAiTarget: string | null;
  aiActionCount: number;
  lastAiActionAtSeconds: number | null;
}

export class ControlAuthority {
  private _owner: ControlOwner = 'human';
  private _aiEnabled = false;
  private _paused = false;
  private _takeoverCount = 0;
  private _lastTakeoverReason: string | null = null;
  private _lastAiAction: string | null = null;
  private _lastAiTarget: string | null = null;
  private _lastAiTargetId: number | null = null;
  private _aiActionCount = 0;
  private _lastAiActionAtSeconds: number | null = null;

  get owner(): ControlOwner { return this._owner; }
  get aiEnabled(): boolean { return this._aiEnabled; }
  get paused(): boolean { return this._paused; }

  /** Local demo takeover requested from the Pause menu. Ignored while paused:
   *  the flag flips and the AI starts acting only after resume(). */
  enableAi(nowSeconds = 0): boolean {
    this._aiEnabled = true;
    this._owner = 'ai';
    this._lastAiAction = null;
    this._lastAiTarget = null;
    this._lastAiTargetId = null;
    this._lastAiActionAtSeconds = nowSeconds;
    return true;
  }

  disableAi(reason = 'disabled'): boolean {
    const wasAi = this._owner === 'ai' || this._aiEnabled;
    this._aiEnabled = false;
    this._owner = 'human';
    this._lastAiAction = null;
    this._lastAiTarget = null;
    this._lastAiTargetId = null;
    if (wasAi) this._recordTakeover(reason);
    return wasAi;
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
    this._owner = this._aiEnabled ? 'ai' : 'human';
  }

  /** Human input always wins. Takeover disables the local demo so it cannot
   *  immediately re-grab control from the player. */
  humanTakeover(reason = 'human-input'): boolean {
    if (this._owner !== 'ai') return false;
    this._aiEnabled = false;
    this._owner = 'human';
    this._lastAiAction = null;
    this._lastAiTarget = null;
    this._lastAiTargetId = null;
    this._recordTakeover(reason);
    return true;
  }

  /** Death ends the run; control ownership returning to the human menu is
   *  explicit, so stale AI intents cannot act during the GameOver transition. */
  onDeath(): void {
    this._paused = true;
    this._aiEnabled = false;
    this._owner = 'human';
    this._lastAiAction = null;
    this._lastAiTarget = null;
    this._lastAiTargetId = null;
  }

  onRunEnd(): void {
    this._paused = true;
    this._aiEnabled = false;
    this._owner = 'human';
  }

  onRunStart(): void {
    this._owner = 'human';
    this._aiEnabled = false;
    this._paused = false;
    this._takeoverCount = 0;
    this._lastTakeoverReason = null;
    this._lastAiAction = null;
    this._lastAiTarget = null;
    this._lastAiTargetId = null;
    this._aiActionCount = 0;
    this._lastAiActionAtSeconds = null;
  }

  onSceneExit(): void {
    this._aiEnabled = false;
    this._owner = 'human';
    this._paused = true;
    this._lastAiAction = null;
    this._lastAiTarget = null;
    this._lastAiTargetId = null;
  }

  /** Record the decision the AI actually executed this frame (HUD truth). */
  noteAiDecision(decision: {
    action: string;
    targetId: number | null;
    targetLabel: string | null;
  }, nowSeconds: number): void {
    const actionChanged = decision.action !== this._lastAiAction;
    const targetChanged = decision.targetId !== this._lastAiTargetId;
    this._lastAiAction = decision.action;
    this._lastAiTarget = decision.targetLabel;
    this._lastAiTargetId = decision.targetId;
    this._lastAiActionAtSeconds = nowSeconds;
    if (actionChanged || targetChanged) this._aiActionCount++;
  }

  snapshot(): ControlSnapshot {
    const mode: ControlMode = this._paused ? 'PAUSED' : this._owner === 'ai' ? 'AI' : 'HUMAN';
    return {
      owner: this._owner,
      aiEnabled: this._aiEnabled,
      paused: this._paused,
      mode,
      modeLabel: mode === 'AI' ? 'AI · LOCAL DETERMINISTIC' : mode,
      controllerLabel: 'LOCAL DETERMINISTIC',
      agentLinkLabel: 'LOCAL DETERMINISTIC DEMO · EXTERNAL NOT CONNECTED',
      externalAgentConnected: false,
      takeoverCount: this._takeoverCount,
      lastTakeoverReason: this._lastTakeoverReason,
      lastAiAction: this._lastAiAction,
      lastAiTarget: this._lastAiTarget,
      aiActionCount: this._aiActionCount,
      lastAiActionAtSeconds: this._lastAiActionAtSeconds
    };
  }

  private _recordTakeover(reason: string): void {
    this._takeoverCount++;
    this._lastTakeoverReason = reason;
  }
}
