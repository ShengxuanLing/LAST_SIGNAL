// P3-a — headless echo parity plumbing (owner/dev only).

import { describe, expect, it } from 'vitest';
import { EchoController } from './echo';
import { HeadlessWorld, neutralIntent } from './worldHeadless';

describe('HeadlessWorld echo', () => {
  it('spawns the echo at the next committed tick and only moves with an echoIntent', () => {
    const noEcho = new HeadlessWorld({ seed: 424242 });
    noEcho.runSteps([{ ticks: 5, intent: neutralIntent() }]);
    expect(noEcho.state.echo).toBeUndefined();

    const world = new HeadlessWorld({ seed: 424242 });
    const spawn = world.enableEcho();
    expect(spawn.ok).toBe(true);
    // Enqueue only: no state write before the tick.
    expect(world.state.echo).toBeUndefined();
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect(world.state.echo).toBeTruthy();

    const before = world.state.echo!;
    world.runSteps([{ ticks: 20, intent: neutralIntent() }]);
    const still = world.state.echo!;
    expect(still.x).toBe(before.x);
    expect(still.y).toBe(before.y);

    const controller = new EchoController();
    controller.setMode('hold');
    const view = world.echoView();
    expect(view).not.toBeNull();
    const intent = controller.decide(view!);
    expect(intent.move).toEqual({ x: 0, y: 0 });
    expect(intent.fire, 'no fire without an explicit confirm').toBe(false);
    world.runSteps([{ ticks: 10, intent: neutralIntent(), echoIntent: intent }]);
    const held = world.state.echo!;
    expect(held.x).toBe(still.x);
    expect(held.y).toBe(still.y);
    expect(world.echoShotCount).toBe(0);
  });

  it('echoView is centred on the echo and never on the player', () => {
    const world = new HeadlessWorld({ seed: 424242 });
    world.enableEcho();
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const view = world.echoView();
    expect(view).not.toBeNull();
    expect(view!.echo).toEqual(expect.objectContaining({ hp: 100, maxHp: 100 }));
    expect(view!.player.x).toBe(world.state.player.x);
    // A drone farther than the perception radius is not visible.
    const far = view!.drones.every((drone) =>
      Math.hypot(drone.x - view!.echo.x, drone.y - view!.echo.y) <= 12);
    expect(far).toBe(true);
  });

  it('canonical state includes the echo only after it exists', () => {
    const world = new HeadlessWorld({ seed: 424242 });
    expect(world.canonicalState()).not.toContain('"echo"');
    world.enableEcho();
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect(world.canonicalState()).toContain('"echo"');
  });
});

describe('HeadlessWorld echo observation (shared projection)', () => {
  it('includes non-drone core targets and Boss public state, not hidden ones', () => {
    const world = new HeadlessWorld({ seed: 424242 });
    world.enableEcho();
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const sim = world.state;
    const echo = sim.echo!;
    sim.targets.push({
      id: 77, kind: 'hunter', x: echo.x + 1, y: echo.y, hp: 60, maxHp: 60,
      armor: 0, radius: 0.5, isBoss: false, xpValue: 4, currencyValue: 4
    });
    sim.targets.push({
      id: 78, kind: 'boss_warden', x: echo.x + 2, y: echo.y, hp: 900, maxHp: 900,
      armor: 2, radius: 2, isBoss: true, xpValue: 40, currencyValue: 40
    });
    sim.targets.push({
      id: 79, kind: 'stalker', x: echo.x + 500, y: echo.y, hp: 20, maxHp: 20,
      armor: 0, radius: 0.5, isBoss: false, xpValue: 4, currencyValue: 4
    });
    const allRooms = sim.map.rooms.map((_r) => 0).map((_v, i) => i);
    const restored = HeadlessWorld.fromSimulationState(sim, allRooms);
    const view = restored.echoView();
    expect(view).not.toBeNull();
    expect(view!.targets.map((t) => t.id).sort((a, b) => a - b)).toEqual([77, 78]);
    expect(view!.targets.find((t) => t.isBoss)).toMatchObject({ kind: 'boss_warden', hp: 900 });
    expect(view!.drones.every((d) => Math.hypot(d.x - echo.x, d.y - echo.y) <= 12)).toBe(true);
  });
});
