// AI-NATIVE-02 P1 — legal world observation whitelist.
//
// The rendered World is not a Headless runtime: it has no snapshot/Replay
// contract. This module only defines the *read-only* view the local
// deterministic controller (or a future external agent adapter) may use.
//
// It is deliberately narrower than World's public fields:
//   - only actors in the player's current room (no unentered-room enemies),
//   - no unspawned room metadata, no portal target room, no boss phase,
//   - no internal AI state, no RNG, no seed, no hint of hidden tiles.
// Coordinates and HP are legal because the player sees the actors and own HP
// on screen. Unknown map/target details are not.

export interface ObservedActorInput {
  id: number;
  kind: string;
  x: number;
  y: number;
  alive: boolean;
  /** Room the actor belongs to (Enemy.data.spawnRoom / Boss.spawnRoom). */
  roomId: number;
}

export interface ObservedBossInput {
  id: number;
  x: number;
  y: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  roomId: number;
}

export interface WorldObservationInput {
  player: { x: number; y: number; alive: boolean; hp: number; maxHp: number };
  roomId: number | null;
  enemies: ObservedActorInput[];
  boss: ObservedBossInput | null;
  /** Portal position is visible; its destination is NOT part of this view. */
  portal: { x: number; y: number; targetRoom: number } | null;
}

export interface ObservedActor {
  id: number;
  kind: string;
  x: number;
  y: number;
  alive: boolean;
}

/** Stable whitelisted projection shared by Player/AI adapters. */
export interface WorldObservationV1 {
  protocolVersion: 1;
  player: { x: number; y: number; alive: boolean; hp: number; maxHp: number };
  roomId: number | null;
  visibleActors: ObservedActor[];
  /** Boss HP is rendered by the HUD, so it is legal observation. */
  boss: { id: number; x: number; y: number; hp: number; maxHp: number } | null;
  portal: { x: number; y: number } | null;
}

export function buildWorldObservation(input: WorldObservationInput): WorldObservationV1 {
  const roomId = input.roomId;
  const visibleActors: ObservedActor[] = [];
  if (roomId !== null) {
    for (const enemy of input.enemies) {
      if (!enemy.alive || enemy.roomId !== roomId) continue;
      visibleActors.push({ id: enemy.id, kind: enemy.kind, x: enemy.x, y: enemy.y, alive: true });
    }
  }
  const boss = input.boss && input.boss.alive && input.boss.roomId === roomId
    ? { id: input.boss.id, x: input.boss.x, y: input.boss.y, hp: input.boss.hp, maxHp: input.boss.maxHp }
    : null;
  return {
    protocolVersion: 1,
    player: { ...input.player },
    roomId,
    visibleActors,
    boss,
    // Intentionally drop targetRoom: it is not rendered to the player.
    portal: input.portal ? { x: input.portal.x, y: input.portal.y } : null
  };
}
