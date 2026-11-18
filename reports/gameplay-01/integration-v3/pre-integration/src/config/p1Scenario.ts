// GAMEPLAY-01 P1/P4 — authored Demo-01 scenario data contract.
//
// This is DELIBERATELY small and authored-scene-only. Old rooms have no
// scenario: `World.p1Scenario` stays null and every legacy behaviour is
// unchanged. The combat/perception/shooting/relay causality lives in
// src/world/sim; this module only describes the authored room.
import type { MapData, Room, Vec2 } from '../types';
import { SIGNAL_TUNING } from '../signal/signalTuning';
import { routeMatches, type RelayState, type RouteWhen } from '../signal/relay';

export const P1_DEMO_ID = 'p1' as const;
export type P1DemoId = typeof P1_DEMO_ID;
/** Fixed menu seed; worker verification may start the same demo with other seeds. */
export const P1_DEMO_SEED = 20261117;

export interface P1Route {
  target: number;
  when: RouteWhen;
  label: string;
  /** Authored portal cell; the World presents it, the Headless completes on it. */
  portal?: Vec2;
}

export interface P1Scenario {
  id: P1DemoId;
  /** The authored combat/route room (the run's start room in Demo-01). */
  roomId: number;
  routes: [P1Route, P1Route];
  /** Authored initial relay state: ACTIVE, so the linked danger is real. */
  initial: { manualEnabled: true; powered: true };
  /** Distinct authored player start and device cells (no same-tile overlap). */
  playerStart?: Vec2;
  relay: Vec2;
  drones: Array<{ x: number; y: number }>;
}

/** The route that is usable for the CURRENT relay state. JAMMED matches neither;
 *  this is the authored-scene alternative to the legacy "only ACTIVE opens" gate. */
export function p1RouteFor(relay: RelayState | null, routes: readonly P1Route[]): P1Route | null {
  if (!relay) return null;
  return routes.find((route) => routeMatches(relay, route.when)) ?? null;
}

/** Shared authored-scene builder used by both the formal World and Headless.
 *  It mutates only the authored room graph/room kind; no renderer/Phaser. */
export interface P1BuildContext {
  map: MapData;
  /** Grid-cell walkability probe (0.5 radius), supplied by the owner. */
  isWalkable: (x: number, y: number, radius: number) => boolean;
}

function roomCenter(room: Room): Vec2 {
  return { x: room.gx + room.w / 2, y: room.gy + room.h / 2 };
}

function closestWalkable(
  room: Room,
  target: Vec2,
  isWalkable: P1BuildContext['isWalkable'],
  avoid?: readonly Vec2[]
): Vec2 {
  let best: Vec2 = { x: target.x, y: target.y };
  let bestD = Infinity;
  for (let y = room.gy; y < room.gy + room.h; y += 1) {
    for (let x = room.gx; x < room.gx + room.w; x += 1) {
      // Probe the CELL CENTRE with the real radius; probing the integer corner
      // accepts cells whose neighbours are walls (the old portal bug).
      if (!isWalkable(x + 0.5, y + 0.5, 0.5)) continue;
      const p = { x: x + 0.5, y: y + 0.5 };
      // A second route must not reuse the first route's cell when it can avoid it.
      const blocked = avoid?.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1.5) ?? false;
      const d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2 + (blocked ? 10000 : 0);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  return best;
}

/** Two walkable sentry cells away from the distinct player spawn and relay. */
function sentrySpots(
  room: Room,
  relay: Vec2,
  player: Vec2,
  variant: number,
  isWalkable: P1BuildContext['isWalkable']
): Vec2[] {
  const candidates: Vec2[] = [];
  for (let y = room.gy; y < room.gy + room.h; y += 1) {
    for (let x = room.gx; x < room.gx + room.w; x += 1) {
      if (!isWalkable(x + 0.5, y + 0.5, 0.5)) continue;
      if (Math.hypot(x + 0.5 - player.x, y + 0.5 - player.y) < 3.5) continue;
      if (Math.hypot(x + 0.5 - relay.x, y + 0.5 - relay.y) < 1.5) continue;
      const p = { x: x + 0.5, y: y + 0.5 };
      if (candidates.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < 2)) continue;
      candidates.push(p);
    }
  }
  if (candidates.length === 0) return [{ ...relay }, { ...relay }];
    const start = variant % candidates.length;
  const picks: Vec2[] = [];
  for (let k = 0; k < candidates.length && picks.length < 2; k++) {
    const c = candidates[(start + k) % candidates.length];
    if (picks.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 2)) continue;
    picks.push(c);
  }
  if (picks.length === 0) picks.push(candidates[0]);
  if (picks.length === 1) picks.push(candidates[Math.min(1, candidates.length - 1)]);
  return [picks[0], picks[1]];
}

/** P4 layout: relay distinct from the player, near the authored route portals,
 *  so the portal-jam distance is a real layout fact rather than a teleport. */
function relaySpot(
  room: Room,
  player: Vec2,
  portals: readonly Vec2[],
  isWalkable: P1BuildContext['isWalkable']
): Vec2 {
  let best: Vec2 = { ...player };
  let bestScore = Infinity;
  for (let y = room.gy; y < room.gy + room.h; y += 1) {
    for (let x = room.gx; x < room.gx + room.w; x += 1) {
      if (!isWalkable(x + 0.5, y + 0.5, 0.5)) continue;
      const p = { x: x + 0.5, y: y + 0.5 };
      if (Math.hypot(p.x - player.x, p.y - player.y) < 1.5) continue;
      // Prefer cells within the real jam range of the route portals; score is
      // the worst portal distance, then the sum, so both routes stay reachable.
      const distances = portals.map((q) => Math.hypot(p.x - q.x, p.y - q.y));
      const worst = distances.length ? Math.max(...distances) : 0;
      const sum = distances.reduce((a, b) => a + b, 0);
      const score = worst * 100 + sum + (worst > SIGNAL_TUNING.JAM_RANGE ? 10000 : 0);
      if (score < bestScore) { bestScore = score; best = p; }
    }
  }
  return best;
}

export function buildP1Scenario(ctx: P1BuildContext): P1Scenario | null {
  const room = ctx.map.rooms[0];
  if (!room) return null;
  const seen = new Set<number>([room.id]);
  const targets: Room[] = [];
  const consider = (candidate: Room | undefined): void => {
    if (!candidate || seen.has(candidate.id)) return;
    if (candidate.kind === 'boss' || candidate.kind === 'extraction') return;
    seen.add(candidate.id);
    targets.push(candidate);
  };
  for (const id of room.connectedTo) consider(ctx.map.rooms[id]);
  for (const candidate of ctx.map.rooms) consider(candidate);
  if (targets.length < 2) return null;

  const variant = ctx.map.seed >>> 0;
  const li = variant % targets.length;
  const a = targets[li];
  const b = targets[(li + 1) % targets.length];
  for (const target of [a, b]) {
    if (!room.connectedTo.includes(target.id)) room.connectedTo.push(target.id);
    if (!target.connectedTo.includes(room.id)) target.connectedTo.push(room.id);
  }
  room.kind = 'combat';

  const playerStart = closestWalkable(room, roomCenter(room), ctx.isWalkable);
  const portalA = closestWalkable(room, roomCenter(a), ctx.isWalkable);
  const portalB = closestWalkable(room, roomCenter(b), ctx.isWalkable, [portalA]);
  const relay = relaySpot(room, playerStart, [portalA, portalB], ctx.isWalkable);
  const drones = sentrySpots(room, relay, playerStart, variant, ctx.isWalkable);

  return {
    id: P1_DEMO_ID,
    roomId: room.id,
    routes: [
      { target: a.id, when: 'RELAY_ACTIVE', label: a.kind.toUpperCase(), portal: portalA },
      { target: b.id, when: 'RELAY_INACTIVE', label: b.kind.toUpperCase(), portal: portalB }
    ],
    initial: { manualEnabled: true, powered: true },
    playerStart,
    relay,
    drones
  };
}
