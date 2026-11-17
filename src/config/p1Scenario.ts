// GAMEPLAY-01 P1 — authored Demo-01 scenario data contract.
//
// This is DELIBERATELY small and authored-scene-only. Old rooms have no
// scenario: `World.p1Scenario` stays null and every legacy behaviour is
// unchanged. The combat/perception/shooting/relay causality lives in
// src/world/sim; this module only describes the authored room.
import { routeMatches, type RelayState, type RouteWhen } from '../signal/relay';

export const P1_DEMO_ID = 'p1' as const;
export type P1DemoId = typeof P1_DEMO_ID;
/** Fixed menu seed; worker verification may start the same demo with other seeds. */
export const P1_DEMO_SEED = 20261117;

export interface P1Route {
  target: number;
  when: RouteWhen;
  label: string;
}

export interface P1Scenario {
  id: P1DemoId;
  /** The authored combat/route room (the run's start room in Demo-01). */
  roomId: number;
  routes: [P1Route, P1Route];
  /** Authored initial relay state: ACTIVE, so the linked danger is real. */
  initial: { manualEnabled: true; powered: true };
  relay: { x: number; y: number };
  drones: Array<{ x: number; y: number }>;
}

/** The route that is usable for the CURRENT relay state. JAMMED matches neither;
 *  this is the authored-scene alternative to the legacy "only ACTIVE opens" gate. */
export function p1RouteFor(relay: RelayState | null, routes: readonly P1Route[]): P1Route | null {
  if (!relay) return null;
  return routes.find((route) => routeMatches(relay, route.when)) ?? null;
}
