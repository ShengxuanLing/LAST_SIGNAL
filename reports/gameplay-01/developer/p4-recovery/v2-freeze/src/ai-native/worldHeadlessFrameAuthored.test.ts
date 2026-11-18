// GAMEPLAY-01 P4 — review F2: the owner frame validator must bound the authored
// scene, and old frames without it must stay compatible.
//
// Before this file existed, `isHeadlessFrame` ignored `sim.authored`, so a
// hostile/corrupt frame with `authored.routes = {}` was ACCEPTED and the next
// `routeState` read threw `routes.find is not a function`. A restored world must
// never be constructible from a frame whose route identity is malformed.
import { describe, expect, it } from 'vitest';
import { HeadlessWorld, NEUTRAL_INTENT, isHeadlessFrame } from './worldHeadless';

const SEED = 20261117;

function demoFrame() {
  const world = new HeadlessWorld({ seed: SEED, demo: true });
  // Commit the authored relay/device so the frame carries the full demo state.
  world.runSteps([{ ticks: 2, intent: NEUTRAL_INTENT }]);
  return world.snapshot();
}

/** Deep clone so each case starts from pristine bytes. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const validFrame = demoFrame();

describe('P4 F2 — isHeadlessFrame bounds the authored scene', () => {
  it('accepts the real demo frame it was produced from', () => {
    expect(isHeadlessFrame(clone(validFrame))).toBe(true);
    const authored = clone(validFrame).sim.authored!;
    expect(authored.id).toBe('p1');
    expect(authored.routes).toHaveLength(2);
  });

  const cases: Array<[string, (frame: any) => void]> = [
    ['authored is not an object', (f) => { f.sim.authored = 'p1'; }],
    ['authored.id is unknown', (f) => { f.sim.authored.id = 'demo03'; }],
    ['routes is not an array', (f) => { f.sim.authored.routes = { target: 1 }; }],
    ['routes is empty', (f) => { f.sim.authored.routes = []; }],
    ['routes has too many entries', (f) => {
      f.sim.authored.routes = [f.sim.authored.routes[0], f.sim.authored.routes[1], f.sim.authored.routes[0]];
    }],
    ['route is not an object', (f) => { f.sim.authored.routes[0] = 7; }],
    ['target is not a number', (f) => { f.sim.authored.routes[0].target = '1'; }],
    ['target is not a map room', (f) => { f.sim.authored.routes[0].target = 999; }],
    ['when is not a route condition', (f) => { f.sim.authored.routes[0].when = 'RELAY_JAMMED'; }],
    ['portal is not an object', (f) => { f.sim.authored.routes[0].portal = 3; }],
    ['portal.x is not a number', (f) => { f.sim.authored.routes[0].portal.x = '11.5'; }],
    ['portal has NaN', (f) => { f.sim.authored.routes[0].portal.x = NaN; }],
    ['portal is infinite', (f) => { f.sim.authored.routes[0].portal.y = Infinity; }],
    ['roomId is not a map room', (f) => { f.sim.authored.roomId = 4242; }],
    ['roomId is not a number', (f) => { f.sim.authored.roomId = null; }],
    ['startRoomId is not a map room', (f) => { f.sim.authored.startRoomId = 4243; }],
    ['startRoomId is missing', (f) => { delete f.sim.authored.startRoomId; }]
  ];

  for (const [name, mutate] of cases) {
    it(`rejects a frame whose ${name}`, () => {
      const frame = clone(validFrame);
      mutate(frame);
      expect(isHeadlessFrame(frame)).toBe(false);
      const target = new HeadlessWorld({ seed: SEED, demo: true });
      const result = target.restore(frame);
      expect(result.ok).toBe(false);
      expect((result as any).code).toBe('E_SNAPSHOT_INVALID');
      // The rejected frame must not have damaged the live world.
      expect(target.routeState).not.toBeNull();
      expect(target.demoScenario).not.toBeNull();
    });
  }

  it('rejects a corrupt frame through fromFrame() as well', () => {
    const frame = clone(validFrame);
    (frame.sim.authored as any).routes = { nope: true };
    expect(() => HeadlessWorld.fromFrame(clone(frame), false)).toThrow(/invalid headless frame/);
  });
});

describe('P4 F2 — legacy frames without an authored scene stay compatible', () => {
  it('an ordinary (non-demo) frame has no authored key and is accepted', () => {
    const plain = new HeadlessWorld({ seed: SEED }).snapshot();
    expect(plain.sim.authored).toBeUndefined();
    expect(isHeadlessFrame(clone(plain))).toBe(true);
    const restored = new HeadlessWorld({ seed: SEED });
    expect(restored.restore(clone(plain)).ok).toBe(true);
    expect(restored.routeState).toBeNull();
    expect(restored.demoScenario).toBeNull();
  });

  it('a P1 demo frame captured before the authored field existed still restores', () => {
    const legacy = clone(validFrame);
    delete (legacy.sim as any).authored;
    expect(isHeadlessFrame(legacy)).toBe(true);
    const restored = new HeadlessWorld({ seed: SEED, demo: true });
    expect(restored.restore(legacy).ok).toBe(true);
    // No authored identity => no route projection; it never throws.
    expect(restored.routeState).toBeNull();
  });

  it('a valid demo frame restores the same route identity, once', () => {
    const frame = clone(validFrame);
    expect(isHeadlessFrame(frame)).toBe(true);
    const world = new HeadlessWorld({ seed: SEED, demo: true });
    expect(world.restore(frame).ok).toBe(true);
    expect(world.demoScenario).toEqual(frame.sim.authored);
    expect(world.routeState!.roomId).toBe(frame.sim.authored!.roomId);
    expect(world.routeState!.target).toBe(frame.sim.authored!.routes[0].target);
  });
});
