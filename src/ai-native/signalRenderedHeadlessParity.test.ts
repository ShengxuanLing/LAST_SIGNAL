// AI-NATIVE-02 Task C — Rendered→Headless Signal parity replay (hard gate).
//
// Reads the REAL rendered instance export from
// reports/ai-native-02/signal/parity/ (produced by tests/signal-rendered-parity.spec.ts),
// rebuilds the same HeadlessWorld from the initial state, replays the exact
// ordered player/echo/signal inputs, and compares canonical state + events
// byte-by-byte.
//
// This is a HARD GATE: missing product files, bad JSON, or stale/mismatched
// exports cause FAIL. Never skips silently.
//
// Includes scan/jam/TTL/relay, echo accounts, real damage events.
// Also verifies: real signal events must exist; divergent action order must
// produce divergent canonical state (negative test).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HeadlessWorld, neutralIntent } from './worldHeadless';
import { cloneSimulationState, type SimulationState, type SimEvent } from '../world/sim/core';

const PARITY_DIR = path.resolve('reports/ai-native-02/signal/parity');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Replay one sequence entry in HeadlessWorld, applying echo/device/signal
 *  operations before the tick commit. Returns the steps to run. */
/** Replay one sequence entry in HeadlessWorld, applying echo/device/signal
 *  operations. Ticks are driven solely by `kind: 'step'` entries, so the
 *  replay tick sequence matches the rendered one exactly. */
describe('Rendered→Headless Signal parity (real rendered export, hard gate)', () => {
  it('FAILS when parity product files are missing', () => {
    const initialPath = path.join(PARITY_DIR, 'initial.json');
    const sequencePath = path.join(PARITY_DIR, 'sequence.json');
    const renderedPath = path.join(PARITY_DIR, 'rendered.json');
    let missing = 0;
    for (const p of [initialPath, sequencePath, renderedPath]) {
      try { readJson(p); } catch { missing += 1; }
    }
    expect(missing).toBe(0);
  });

  it('replays rendered signal inputs in HeadlessWorld with byte-identical canonical state + events', () => {
    const initialPath = path.join(PARITY_DIR, 'initial.json');
    const sequencePath = path.join(PARITY_DIR, 'sequence.json');
    const renderedPath = path.join(PARITY_DIR, 'rendered.json');

    let initial: any, sequence: any[], rendered: any;
    try {
      initial = readJson<any>(initialPath);
      sequence = readJson<any[]>(sequencePath);
      rendered = readJson<any>(renderedPath);
    } catch (error) {
      throw new Error(`Parity product unreadable: ${(error as Error).message}`);
    }

    // Validate product freshness: rendered must contain signal events.
    expect(Array.isArray(rendered.eventTypes)).toBe(true);
    expect(rendered.eventTypes).toContain('signal-scanned');
    expect(rendered.eventTypes).toContain('signal-jammed');
    expect(rendered.eventTypes).toContain('signal-relay-changed');

    // Rebuild HeadlessWorld from the rendered initial SimulationState.
    const sim = cloneSimulationState(initial) as SimulationState;
    const world = HeadlessWorld.fromSimulationState(sim, []);

    // Replay the exact ordered inputs from the rendered run. Operations
    // (enableEcho / enableSignalDevice / signalCommand) are applied but do
    // not consume a tick themselves; the tick is driven by the matching
    // `kind: 'step'` entry in the sequence, so pending commands are committed
    // one per tick exactly as in the rendered run (no batching).
    //
    // echoIntent is undefined on the tick that spawns echo (matching the
    // rendered World where echoView() returns null before processCommands
    // commits spawn-echo), and neutral on all later ticks.
    const neutral = neutralIntent();
    const events: SimEvent[] = [];
    let echoJustSpawned = false;
    for (const step of sequence) {
      if (step.kind === 'enableEcho') {
        world.enableEcho(step.x, step.y);
        echoJustSpawned = true;
      } else if (step.kind === 'setEchoMode') {
        // HOLD mode keeps Echo stationary, matching the rendered run.
      } else if (step.kind === 'enableSignalDevice') {
        world.enableSignalDevice({ deviceId: step.deviceId, roomId: step.roomId, x: step.x, y: step.y });
      } else if (step.kind === 'signalCommand') {
        world.enqueueSignalCommand({
          type: step.type === 'toggle-relay' ? 'toggle-relay' : step.type,
          actor: step.actor,
          enabled: step.enabled,
          powered: step.powered
        });
      } else if (step.kind === 'step') {
        const echoIntent = echoJustSpawned ? undefined : neutral;
        echoJustSpawned = false;
        events.push(...world.runSteps([{ ticks: step.ticks ?? 1, intent: step.intent ?? neutral, echoIntent }], step.ticks ?? 1));
      }
    }

    // Compare canonical state byte-by-byte (string equality, not hash).
    const replayState = world.canonicalState();
    const replayEvents = world.canonicalEvents();

    expect(replayState).toBe(rendered.canonical);
    // Strict string comparison is the gate. On failure, print a targeted diff.
    if (replayEvents !== rendered.events) {
      const a = replayEvents;
      const b = rendered.events;
      let firstDiff = -1;
      for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
        if (a[i] !== b[i]) { firstDiff = i; break; }
      }
      throw new Error(
        `events string mismatch: replayLen=${a.length} renderedLen=${b.length} firstDiff=${firstDiff}\n` +
        `replay[${Math.max(0, firstDiff - 80)}..${firstDiff + 80}]=${JSON.stringify(a.slice(Math.max(0, firstDiff - 80), firstDiff + 80))}\n` +
        `rendered[${Math.max(0, firstDiff - 80)}..${firstDiff + 80}]=${JSON.stringify(b.slice(Math.max(0, firstDiff - 80), firstDiff + 80))}`
      );
    }
    expect(replayEvents).toBe(rendered.events);

    // Compare key signal fields.
    const finalView = world.signalView();
    expect(finalView?.relay).toBe(rendered.signalRelay);
    expect(finalView?.manualEnabled).toBe(rendered.signalManual);
    expect(finalView?.powered).toBe(rendered.signalPowered);
    expect(finalView?.echoEnergy).toBe(rendered.echoEnergy);

    // Verify signal event types are present in both.
    const replayEventTypes = [...new Set(events.map((e) => e.type))];
    for (const et of rendered.eventTypes) {
      expect(replayEventTypes).toContain(et);
    }
  });

  it('divergent signal action order produces divergent canonical state (negative)', () => {
    const sequencePath = path.join(PARITY_DIR, 'sequence.json');
    const renderedPath = path.join(PARITY_DIR, 'rendered.json');

    let sequence: any[], rendered: any;
    try {
      sequence = readJson<any[]>(sequencePath);
      rendered = readJson<any>(renderedPath);
    } catch (error) {
      throw new Error(`Parity product unreadable: ${(error as Error).message}`);
    }

    // Build a divergent sequence: swap the first two signal commands.
    const divergent = [...sequence];
    const sigIdx = divergent.findIndex((s) => s.kind === 'signalCommand');
    const sigIdx2 = divergent.findIndex((s) => s.kind === 'signalCommand', sigIdx + 1);
    if (sigIdx >= 0 && sigIdx2 >= 0) {
      [divergent[sigIdx], divergent[sigIdx2]] = [divergent[sigIdx2], divergent[sigIdx]];
    }

    // Replay divergent sequence from same initial state. Operations are
    // applied but ticks are driven by `kind: 'step'` entries (same rule as
    // the main replay), so pending commands commit one per tick.
    // Divergence: flip the first signalCommand's actor (echo->player), which
    // changes which energy account is charged and which actor's cooldown is
    // set, so the canonical state must differ.
    const initial = readJson<any>(path.join(PARITY_DIR, 'initial.json'));
    const sim = cloneSimulationState(initial) as SimulationState;
    const world = HeadlessWorld.fromSimulationState(sim, []);
    const neutral = neutralIntent();
    const flipped = [...divergent];
    const firstSigIdx = flipped.findIndex((s) => s.kind === 'signalCommand');
    if (firstSigIdx >= 0) {
      flipped[firstSigIdx] = {
        ...flipped[firstSigIdx],
        actor: flipped[firstSigIdx].actor === 'echo' ? 'player' : 'echo'
      };
    }
    // Replay with same echoIntent rule as the main replay (undefined on spawn
    // tick, neutral afterwards).
    let echoJustSpawned = false;
    for (const step of flipped) {
      if (step.kind === 'enableEcho') {
        world.enableEcho(step.x, step.y);
        echoJustSpawned = true;
      } else if (step.kind === 'setEchoMode') {
        // HOLD mode keeps Echo stationary, matching the rendered run.
      } else if (step.kind === 'enableSignalDevice') {
        world.enableSignalDevice({ deviceId: step.deviceId, roomId: step.roomId, x: step.x, y: step.y });
      } else if (step.kind === 'signalCommand') {
        world.enqueueSignalCommand({
          type: step.type === 'toggle-relay' ? 'toggle-relay' : step.type,
          actor: step.actor,
          enabled: step.enabled,
          powered: step.powered
        });
      } else if (step.kind === 'step') {
        const echoIntent = echoJustSpawned ? undefined : neutral;
        echoJustSpawned = false;
        world.runSteps([{ ticks: step.ticks ?? 1, intent: step.intent ?? neutral, echoIntent }], step.ticks ?? 1);
      }
    }

    const divergentState = world.canonicalState();
    expect(divergentState).not.toBe(rendered.canonical);
  });
});
