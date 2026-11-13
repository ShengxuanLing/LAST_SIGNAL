// AI-NATIVE-02 P1 — local deterministic controller (honest local demo).
//
// The controller ONLY produces PlayerIntent values. It receives a read-only
// view of the real World (positions, HP, portal, walkability) and never writes
// coordinates, HP, sprites, or scene objects. Every intent it returns is
// executed by the same Player.applyIntent path the human keyboard uses.
//
// No Math.random, no wall clock: decisions are a pure function of the supplied
// view plus loop-local anti-stuck memory. It is NOT an LLM, not Codex, and not
// connected to any external agent — the HUD labels it as a local demo.

import {
  intentToWorldVelocity,
  neutralIntent,
  screenDirectionTowardGrid,
  type PlayerIntent
} from './control';

export interface ControllerActorView {
  id: number;
  kind: string;
  x: number;
  y: number;
  alive: boolean;
}

export interface LocalControllerView {
  /** Player is alive and the world is stepping. */
  ready: boolean;
  player: { x: number; y: number; alive: boolean };
  roomId: number | null;
  enemies: ControllerActorView[];
  boss: ControllerActorView | null;
  /** Position only: the portal's destination is hidden information. */
  portal: { x: number; y: number } | null;
  /** Same predicate the player collision uses; radius is owned by the adapter. */
  canWalk: (x: number, y: number) => boolean;
  timeSeconds: number;
}

export type AiActionKind = 'STOP' | 'MOVE' | 'ENGAGE' | 'TRAVEL' | 'INTERACT' | 'BLOCKED' | 'HOLD';

export interface AiDecision {
  intent: PlayerIntent;
  action: AiActionKind;
  targetId: number | null;
  targetLabel: string | null;
}

export const AI_TUNING = {
  /** Hold position and fire when the target is at most this far (grid tiles). */
  engageRange: 4.2,
  /** Walk no closer than this, so the player is not glued to an enemy. */
  stopRange: 2.6,
  /** Portal interaction distance (World.tryInteract uses < 2.0). */
  portalRange: 1.4,
  /** Candidate steering offsets, checked in order (radians). */
  steerOffsets: [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2],
  /** Collision probe distance in grid tiles. */
  probeDistance: 0.45,
  /** Seconds without meaningful progress before a deterministic detour. */
  stuckSeconds: 0.9,
  detourSeconds: 0.8
};

function squaredDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function rotate(v: { x: number; y: number }, angle: number): { x: number; y: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Nearest actionable hostile; ties resolved by lower id (stable ordering). */
export function pickTarget(view: LocalControllerView): ControllerActorView | null {
  let best: ControllerActorView | null = null;
  let bestDistance = Infinity;
  const consider = (actor: ControllerActorView | null): void => {
    if (!actor || !actor.alive) return;
    const d = squaredDistance(view.player.x, view.player.y, actor.x, actor.y);
    if (d < bestDistance || (d === bestDistance && best && actor.id < best.id)) {
      best = actor;
      bestDistance = d;
    }
  };
  for (const enemy of view.enemies) consider(enemy);
  consider(view.boss);
  return best;
}

export class LocalDeterministicController {
  private lastX: number | null = null;
  private lastY: number | null = null;
  private lastProbeAt = 0;
  private noProgressFor = 0;
  private detourUntil = -Infinity;
  private detourSign = 1;

  reset(): void {
    this.lastX = null;
    this.lastY = null;
    this.lastProbeAt = 0;
    this.noProgressFor = 0;
    this.detourUntil = -Infinity;
    this.detourSign = 1;
  }

  decide(view: LocalControllerView): AiDecision {
    if (!view.ready || !view.player.alive) {
      this.reset();
      return { intent: neutralIntent(), action: 'HOLD', targetId: null, targetLabel: 'NO LIVE PLAYER' };
    }

    const target = pickTarget(view);
    if (target) {
      const distance = Math.hypot(target.x - view.player.x, target.y - view.player.y);
      const aim = { x: target.x, y: target.y };
      const label = `HOSTILE #${target.id} ${target.kind}`;
      if (distance <= AI_TUNING.engageRange) {
        // Stop + fire: the "stop" state is a zero move vector, still executed
        // through the normal movement path (with its collision checks).
        this.reset();
        return {
          intent: { move: { x: 0, y: 0 }, dash: false, fire: true, aim, interact: false },
          action: 'ENGAGE',
          targetId: target.id,
          targetLabel: label
        };
      }
      const direction = this.moveToward(view, target.x, target.y);
      if (direction === null) {
        return {
          intent: { move: { x: 0, y: 0 }, dash: false, fire: true, aim, interact: false },
          action: 'BLOCKED',
          targetId: target.id,
          targetLabel: label
        };
      }
      return {
        intent: { move: direction, dash: false, fire: true, aim, interact: false },
        action: 'MOVE',
        targetId: target.id,
        targetLabel: label
      };
    }

    const portal = view.portal;
    if (portal) {
      const distance = Math.hypot(portal.x - view.player.x, portal.y - view.player.y);
      const label = 'PORTAL';
      if (distance <= AI_TUNING.portalRange) {
        this.reset();
        return {
          intent: { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: true },
          action: 'INTERACT',
          targetId: null,
          targetLabel: label
        };
      }
      const direction = this.moveToward(view, portal.x, portal.y);
      if (direction === null) {
        return { intent: neutralIntent(), action: 'BLOCKED', targetId: null, targetLabel: 'PORTAL' };
      }
      return {
        intent: { move: direction, dash: false, fire: false, aim: null, interact: false },
        action: 'TRAVEL',
        targetId: null,
        targetLabel: label
      };
    }

    this.reset();
    return { intent: neutralIntent(), action: 'STOP', targetId: null, targetLabel: null };
  }

  /** Screen-space steering that walks toward a grid point without leaving walkable tiles. */
  private moveToward(view: LocalControllerView, tx: number, ty: number): { x: number; y: number } | null {
    this.trackProgress(view);
    let base = screenDirectionTowardGrid(tx - view.player.x, ty - view.player.y);
    if (Math.hypot(base.x, base.y) <= 1e-9) return null;

    if (view.timeSeconds < this.detourUntil) {
      base = rotate(base, this.detourSign * Math.PI / 2);
    }

    for (const offset of AI_TUNING.steerOffsets) {
      const dir = rotate(base, offset);
      // Screen direction -> the unit grid direction the executor will get.
      const grid = intentToWorldVelocity(dir, 1);
      const gridMag = Math.hypot(grid.x, grid.y);
      if (gridMag <= 1e-9) continue;
      const probeX = view.player.x + (grid.x / gridMag) * AI_TUNING.probeDistance;
      const probeY = view.player.y + (grid.y / gridMag) * AI_TUNING.probeDistance;
      if (view.canWalk(probeX, probeY)) return dir;
    }
    return null;
  }

  private trackProgress(view: LocalControllerView): void {
    const now = view.timeSeconds;
    if (this.lastX === null || this.lastY === null) {
      this.lastX = view.player.x;
      this.lastY = view.player.y;
      this.lastProbeAt = now;
      return;
    }
    const moved = Math.hypot(view.player.x - this.lastX, view.player.y - this.lastY);
    const elapsed = now - this.lastProbeAt;
    this.lastX = view.player.x;
    this.lastY = view.player.y;
    this.lastProbeAt = now;
    if (moved >= 0.12) {
      this.noProgressFor = 0;
      return;
    }
    this.noProgressFor += Math.max(0, elapsed);
    if (this.noProgressFor >= AI_TUNING.stuckSeconds) {
      this.noProgressFor = 0;
      this.detourUntil = now + AI_TUNING.detourSeconds;
      this.detourSign *= -1;
    }
  }
}
