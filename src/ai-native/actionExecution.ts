// AI-NATIVE-02 C3c fix — ONE shared action-duration state machine.
//
// Rendered (`ExternalLinkState`) and Headless (`HeadlessWorldManager`) both
// consume an action's `durationTicks` from REAL core ticks. They must not keep
// two copies of the "remaining ticks / completed" rule. This module is the
// single pure implementation of that rule.

export interface TickConsumption {
  /** Real core ticks actually attributed to the action (never > remaining). */
  readonly consumed: number;
  /** Ticks still owed after this consumption (never < 0). */
  readonly remaining: number;
  /** True when the full duration has now been delivered. */
  readonly completed: boolean;
}

/**
 * Consume `coreTicks` from an action that still has `remaining` ticks to
 * deliver. A frame/step may be shorter (partial) or longer (the surplus is not
 * attributed) than the remaining duration.
 */
export function consumeExecutionTicks(remaining: number, coreTicks: number): TickConsumption {
  const safeRemaining = Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : 0;
  const safeTicks = Number.isFinite(coreTicks) ? Math.max(0, Math.floor(coreTicks)) : 0;
  const consumed = Math.min(safeTicks, safeRemaining);
  const next = safeRemaining - consumed;
  return { consumed, remaining: next, completed: next <= 0 };
}
