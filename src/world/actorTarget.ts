// AI-NATIVE-02 P3-a fix — legacy enemy actor targeting (pure).
//
// Legacy hunter/stalker/sentinel/Boss may choose EITHER the protagonist or the
// ECHO. They receive a read-only target view and a legal damage command facade;
// they never get a writable Player/echo object and never write core state.

export interface ActorTargetView {
  readonly actorId: number;
  readonly kind: 'player' | 'echo';
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly alive: boolean;
}

export interface ActorCombatPort {
  /** The chosen living actor, readable only. */
  readonly target: ActorTargetView;
  /** Queue a legal hit for the chosen actor; returns true when it will land. */
  hurtTarget(amount: number, fromX: number, fromY: number): boolean;
}

/**
 * Nearest living candidate by grid distance. Ties keep the earlier candidate,
 * so a run without echo always resolves to the player exactly as before.
 */
export function chooseNearestActor(
  self: { x: number; y: number },
  candidates: readonly ActorTargetView[]
): ActorTargetView | null {
  let best: ActorTargetView | null = null;
  let bestD = Infinity;
  for (const candidate of candidates) {
    if (!candidate.alive || candidate.hp <= 0) continue;
    const d = Math.hypot(candidate.x - self.x, candidate.y - self.y);
    if (d < bestD) { best = candidate; bestD = d; }
  }
  return best;
}


/** Legacy direct test/Scene calls may pass a Player-like object instead of a port. */
export interface PlayerLikeCombat {
  x: number; y: number;
  hurt(amount: number, fromX: number, fromY: number): boolean;
  data?: { hp?: number };
}

export function toCombatPort(value: ActorCombatPort | PlayerLikeCombat): ActorCombatPort {
  if ('target' in value) return value as ActorCombatPort;
  const player = value as PlayerLikeCombat;
  return {
    target: {
      actorId: 0, kind: 'player', x: player.x, y: player.y,
      hp: player.data?.hp ?? 1, alive: true
    },
    hurtTarget: (amount, fromX, fromY) => player.hurt(amount, fromX, fromY)
  };
}
