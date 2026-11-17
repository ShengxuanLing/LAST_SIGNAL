// AI-NATIVE-02 P3-b — shared relay/bridge pure rules.
//
// Extracted verbatim from `src/slice/corridor.ts`; the slice now calls these
// functions too, so Relay state/JAM suppression/bridge transition semantics
// cannot diverge between the two worlds. No facility geometry or map lives
// here: transitionTicks / LOS / positions stay in the caller.

export type RelayState = 'ACTIVE' | 'INACTIVE' | 'JAMMED' | 'DISABLED';
export type BridgeState = 'UNAVAILABLE' | 'TRANSITIONING' | 'STABLE' | 'UNSTABLE' | 'DISABLED';

/** Authored-scene route condition. JAMMED is NEITHER (temporary suppression,
 *  not a manual state); the old exit gate semantics are unchanged. */
export type RouteWhen = 'RELAY_ACTIVE' | 'RELAY_INACTIVE';

export function routeMatches(relay: RelayState, when: RouteWhen): boolean {
  return when === 'RELAY_ACTIVE' ? relay === 'ACTIVE' : relay === 'INACTIVE';
}

/** One immutable post-commit relay reading, independent of callback order. */
export interface RelayReading {
  readonly manualEnabled: boolean;
  readonly powered: boolean;
  readonly relay: RelayState;
  readonly effectiveOutput: boolean;
  readonly bridgeFeed: boolean;
  readonly perceptionFeed: boolean;
  readonly bridge: BridgeState;
  readonly bridgePassable: boolean;
  readonly deadline: number;
}

export function relayState(
  manualEnabled: boolean, powered: boolean, jammed: boolean, disposed: boolean
): RelayState {
  if (disposed) return 'DISABLED';
  if (jammed) return 'JAMMED';
  return manualEnabled && powered ? 'ACTIVE' : 'INACTIVE';
}

/** Output is ONLY true for ACTIVE. A JAMMED relay never auto-enables output. */
export function relayOutput(relay: RelayState): boolean {
  return relay === 'ACTIVE';
}

export function nextBridge(
  previous: { bridge: BridgeState; deadline: number },
  output: boolean, tick: number, transitionTicks: number
): { bridge: BridgeState; deadline: number } {
  switch (previous.bridge) {
    case 'UNAVAILABLE':
      return output
        ? { bridge: 'TRANSITIONING', deadline: tick + transitionTicks }
        : { bridge: 'UNAVAILABLE', deadline: 0 };
    case 'TRANSITIONING':
      if (!output) return { bridge: 'UNAVAILABLE', deadline: 0 };
      if (tick >= previous.deadline) return { bridge: 'STABLE', deadline: 0 };
      break;
    case 'STABLE':
      return output
        ? { bridge: 'STABLE', deadline: 0 }
        : { bridge: 'UNSTABLE', deadline: tick + transitionTicks };
    case 'UNSTABLE':
      if (output) return { bridge: 'STABLE', deadline: 0 };
      if (tick >= previous.deadline) return { bridge: 'UNAVAILABLE', deadline: 0 };
      break;
    case 'DISABLED':
      return { bridge: 'DISABLED', deadline: 0 };
  }
  return { bridge: previous.bridge, deadline: previous.deadline };
}

export function buildRelayReading(
  manualEnabled: boolean, powered: boolean, relay: RelayState,
  bridge: BridgeState, deadline: number
): RelayReading {
  const effectiveOutput = relayOutput(relay);
  return Object.freeze({
    manualEnabled, powered, relay, effectiveOutput,
    bridgeFeed: effectiveOutput,
    perceptionFeed: effectiveOutput,
    bridge,
    bridgePassable: bridge === 'STABLE' || bridge === 'UNSTABLE',
    deadline
  });
}

/** Export only works when the relay is ACTIVE; a JAMMED relay blocks progress. */
export function exitOpen(relay: RelayState): boolean {
  return relay === 'ACTIVE';
}
