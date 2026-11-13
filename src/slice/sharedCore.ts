/**
 * AI-NATIVE-01 P1 — shared slice movement + progression core.
 *
 * Pure TypeScript (no Phaser / DOM). The browser `SliceScene` and the Node
 * headless runtime both call these functions, so movement speed/anisotropy,
 * the 5-point AABB footprint and axis-separated collision cannot diverge, and
 * the pass-door / enter-corridor / crossing decisions live in one place.
 *
 * Tick ordering is NOT reimplemented here: `SliceModel.tickOnce()` already
 * calls its `onTick` callback at the room-correct point (lab: movement before
 * expiry; corridor: expiry/bridge resolve before movement). This module only
 * supplies that callback body and the post-step progression decision.
 */
import { ROOM } from './room';
import { SLICE } from './tuning';
import type { SliceModel, SliceSnapshot } from './rules';

export interface MovementIntent {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export const NO_MOVEMENT: Readonly<MovementIntent> = Object.freeze({
  up: false, down: false, left: false, right: false,
});

/**
 * Map a logical direction to the same W/A/S/D intent the Scene uses.
 * `up/down/left/right` are the raw iso keys (diagonal); `north/south/east/west`
 * are exact grid-axis directions (two keys) for headless action chains.
 */
export type MovementDirection =
  | 'up' | 'down' | 'left' | 'right'
  | 'north' | 'south' | 'east' | 'west';

export function directionToIntent(direction: MovementDirection): MovementIntent {
  switch (direction) {
    case 'up': return { up: true, down: false, left: false, right: false };
    case 'down': return { up: false, down: true, left: false, right: false };
    case 'left': return { up: false, down: false, left: true, right: false };
    case 'right': return { up: false, down: false, left: false, right: true };
    case 'east': return { up: false, down: true, left: false, right: true };
    case 'west': return { up: true, down: false, left: true, right: false };
    case 'south': return { up: false, down: true, left: true, right: false };
    case 'north': return { up: true, down: false, left: false, right: true };
  }
}

/**
 * One logic tick of movement at the fixed slice speed. Uses the SAME iso
 * direction mapping and axis-separated `model.canStand` collision as the
 * original SliceScene.stepMovement; position stays authoritative in the model.
 */
export function stepMovement(model: SliceModel, intent: MovementIntent): void {
  const p = stepMovementAt(model, intent, model.position.x, model.position.y);
  model.setPlayerPos(p.x, p.y);
}

/**
 * One logic tick of movement for an EXPLICIT actor position (human or ECHO).
 * Same iso mapping / anisotropic step / axis-separated collision as the human
 * path; the caller owns where the resulting position is stored.
 */
export function stepMovementAt(model: SliceModel, intent: MovementIntent, x: number, y: number): { x: number; y: number } {
  const dir = { x: 0, y: 0 };
  if (intent.up) { dir.x -= 1; dir.y -= 1; }
  if (intent.down) { dir.x += 1; dir.y += 1; }
  if (intent.left) { dir.x -= 1; dir.y += 1; }
  if (intent.right) { dir.x += 1; dir.y -= 1; }
  let px = x;
  let py = y;
  const len = Math.hypot(dir.x, dir.y);
  if (len > 0) {
    const step = SLICE.MOVE_SPEED * (SLICE.TICK_MS / 1000);
    const dx = (dir.x / len) * step;
    const dy = (dir.y / len) * step;
    if (model.canStandAt(px + dx, py)) px += dx;
    if (model.canStandAt(px, py + dy)) py += dy;
  }
  return { x: px, y: py };
}

export interface SliceTransitions {
  passedDoor: boolean;
  enteredCorridor: boolean;
  crossedEast: boolean;
  failed: boolean;
  canCheckpoint: boolean;
  guardHp: number;
}

export interface TransitionHooks {
  /**
   * Called immediately BEFORE entering the corridor. The browser Scene uses it
   * to persist the safe laboratory exit; the headless runtime needs no save.
   */
  readonly beforeEnterCorridor?: (model: SliceModel) => void;
}

/**
 * Post-step progression decision, matching the original Scene.update() order:
 * pass-door (markPassed) -> enter corridor (optionally after a save hook) ->
 * failed -> crossing. Storage/UI side effects stay in the caller.
 */
export function resolveTransitions(
  model: SliceModel,
  previous: SliceSnapshot,
  hooks: TransitionHooks = {},
): SliceTransitions {
  const position = model.position;
  let passedDoor = false;
  let enteredCorridor = false;
  let crossedEast = false;

  if (!model.inCorridor && !model.passed && position.x > ROOM.eastThresholdX) {
    model.markPassed();
    passedDoor = true;
  }
  if (!model.inCorridor && model.passed &&
      Math.hypot(position.x - ROOM.exit.x, position.y - ROOM.exit.y) < 0.45) {
    hooks.beforeEnterCorridor?.(model);
    enteredCorridor = model.enterCorridor();
  } else if (model.failed) {
    // reported via `failed`
  } else if (!previous.corridor?.crossed) {
    const corridor = model.snapshot().corridor;
    if (corridor?.crossed) crossedEast = true;
  }

  const snapshot = model.snapshot();
  return {
    passedDoor,
    enteredCorridor,
    crossedEast,
    failed: model.failed,
    canCheckpoint: model.canCheckpoint,
    guardHp: snapshot.corridor?.guardHp ?? 0,
  };
}
