// C3c history/replay fix: event objects are immutable value DTOs, snapshots
// deep-copy nested history, and `replay()` aligns on the frame's event baseline
// so a mid-run boundary frame is compared over the SAME interval.

import { describe, expect, it } from 'vitest';
import { HeadlessWorld, neutralIntent, type HeadlessRunStep } from './worldHeadless';

function fireSteps(aim: { x: number; y: number }, ticks = 1): HeadlessRunStep[] {
  return [{ ticks, intent: { ...neutralIntent(), fire: true, aim } }];
}

function firstDrone(world: HeadlessWorld) {
  const obs = world.observation();
  return obs.drones.find((d) => d.hp > 0) ?? null;
}

describe('C3c history — core events are immutable value DTOs', () => {
  it('a projectile-spawned event never changes when the projectile moves/hits', () => {
    const world = new HeadlessWorld({ seed: 424242 });
    const drone = firstDrone(world)!;
    const events = world.runSteps(fireSteps({ x: drone.x, y: drone.y }), 5);
    const spawned = events.find((e) => e.type === 'projectile-spawned') as any;
    expect(spawned, 'a projectile spawned').toBeTruthy();
    const before = JSON.stringify(spawned);
    // Run enough ticks for the projectile to travel, hit and be destroyed.
    world.runSteps([{ ticks: 80, intent: neutralIntent() }], 200);
    expect(JSON.stringify(spawned), 'spawn-time payload preserved').toBe(before);
  });

  it('a loot-dropped event never changes when the loot bobs/is collected', () => {
    const world = new HeadlessWorld({ seed: 424242 });
    const neutral = neutralIntent();
    let lootEvent: any = null;
    for (let i = 0; i < 400 && !lootEvent; i += 1) {
      const drone = firstDrone(world);
      if (!drone) break;
      const ev = world.runSteps([
        { ticks: 1, intent: { ...neutral, fire: true, aim: { x: drone.x, y: drone.y } } },
        { ticks: 2, intent: neutral }
      ], 2000);
      lootEvent = ev.find((e) => e.type === 'loot-dropped') ?? null;
    }
    expect(lootEvent, 'a real loot drop happened').toBeTruthy();
    const before = JSON.stringify(lootEvent);
    world.runSteps([{ ticks: 40, intent: neutral }], 200);
    expect(JSON.stringify(lootEvent), 'drop-time payload preserved').toBe(before);
  });
});

describe('C3c history — snapshot/restore/fromFrame isolation', () => {
  function midRun() {
    const world = new HeadlessWorld({ seed: 424242 });
    const drone = firstDrone(world)!;
    world.runSteps([
      { ticks: 10, intent: { ...neutralIntent(), fire: true, aim: { x: drone.x, y: drone.y } } },
      { ticks: 10, intent: neutralIntent() }
    ], 200);
    const frame = world.snapshot();
    const before = JSON.stringify(frame);
    return { world, frame, before };
  }

  it('mutating the live world does not change a saved frame (events/state/commands/ledger)', () => {
    const { world, frame, before } = midRun();
    world.runSteps([{ ticks: 60, intent: neutralIntent() }], 200);
    expect(JSON.stringify(frame)).toBe(before);
  });

  it('mutating the input frame after restore does not change the live world', () => {
    const { world, frame } = midRun();
    const restored = world.restore(frame);
    expect(restored.ok).toBe(true);
    const tick = world.inspect().tick;
    const hp = (world.inspect().player as { hp: number }).hp;
    (frame as any).sim.tick = 99999;
    (frame as any).sim.player.data.hp = -1;
    (frame as any).events.length = 0;
    (frame as any).actionLog.push({ tick: 1, actionId: 'x', requestId: 'y', appliedTick: 1 });
    expect(world.inspect().tick).toBe(tick);
    expect((world.inspect().player as { hp: number }).hp).toBe(hp);
    expect(world.snapshot().events.length).toBeGreaterThan(0);
  });

  it('fromFrame is isolated from the input frame', () => {
    const { frame, before } = midRun();
    const copy = HeadlessWorld.fromFrame(frame, false);
    (frame as any).events.length = 0;
    (frame as any).sim.tick = -5;
    expect(copy.snapshot().events.length).toBeGreaterThan(0);
    expect(JSON.stringify(frame)).not.toBe(before);
  });
});

describe('C3c history — replay baseline offset', () => {
  function midRunWorld(): { world: HeadlessWorld; frame: any; continuation: HeadlessRunStep[] } {
    const world = new HeadlessWorld({ seed: 424242 });
    const drone = firstDrone(world)!;
    world.runSteps([
      { ticks: 10, intent: { ...neutralIntent(), fire: true, aim: { x: drone.x, y: drone.y } } },
      { ticks: 10, intent: neutralIntent() }
    ], 200);
    const frame = world.snapshot();
    const continuation: HeadlessRunStep[] = [{ ticks: 15, intent: neutralIntent() }];
    world.runSteps(continuation, 200);
    return { world, frame, continuation };
  }

  it('replays a MID-RUN boundary frame over the same interval (sameState/sameEvents)', () => {
    const { world, frame, continuation } = midRunWorld();
    const replay = world.replay(frame, continuation);
    expect(replay.ok).toBe(true);
    expect(replay.sameState).toBe(true);
    expect(replay.sameEvents).toBe(true);
    expect(replay.firstDivergence).toBeNull();
    expect(replay.baselineEvents).toBe((frame.events as unknown[]).length);
    expect(replay.historyPreserved).toBe(true);
    expect(replay.eventsTruncated).toBe(false);
  });

  it('tampering the baseline history is detected at the exact index', () => {
    const { world, frame, continuation } = midRunWorld();
    const tampered = JSON.parse(JSON.stringify(frame));
    // Change a numeric fact in the first historical event.
    tampered.events[0] = { type: 'player-moved', position: { x: 123.456, y: 789.012 } };
    const replay = world.replay(tampered, continuation);
    expect(replay.sameEvents).toBe(false);
    expect(replay.historyPreserved).toBe(false);
    expect(replay.firstDivergence).toBe(0);
  });

  it('a different continuation is detected in the NEW segment, not at 0', () => {
    const { world, frame, continuation } = midRunWorld();
    const baseline = (frame.events as unknown[]).length;
    const different: HeadlessRunStep[] = [{ ticks: 15, intent: { ...neutralIntent(), move: { x: 1, y: 0 } } }];
    const replay = world.replay(frame, different);
    expect(replay.sameEvents).toBe(false);
    expect(replay.historyPreserved).toBe(true);
    expect(replay.firstDivergence).not.toBeNull();
    expect(replay.firstDivergence as number).toBeGreaterThanOrEqual(baseline);
  });

  it('a tick0/start frame still replays all steps exactly', () => {
    const world = new HeadlessWorld({ seed: 424242 });
    const frame = world.snapshot();
    const steps: HeadlessRunStep[] = [{ ticks: 20, intent: { ...neutralIntent(), move: { x: 1, y: 0 } } }];
    world.runSteps(steps, 200);
    const replay = world.replay(frame, steps);
    expect(replay.sameState).toBe(true);
    expect(replay.sameEvents).toBe(true);
    expect(replay.firstDivergence).toBeNull();
    expect(replay.baselineEvents).toBe(0);
  });
});
