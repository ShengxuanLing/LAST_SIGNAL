// P3-a fix — legacy enemy target selection (pure, no Phaser).

import { describe, expect, it } from 'vitest';
import { chooseNearestActor, type ActorTargetView } from './actorTarget';

const player = (x: number, y: number): ActorTargetView => ({
  actorId: 0, kind: 'player', x, y, hp: 100, alive: true
});
const echo = (x: number, y: number, hp = 100): ActorTargetView => ({
  actorId: 1, kind: 'echo', x, y, hp, alive: hp > 0
});

describe('chooseNearestActor', () => {
  it('picks the nearer living actor, including a non-player actor', () => {
    const picked = chooseNearestActor({ x: 0, y: 0 }, [player(9, 0), echo(2, 0)]);
    expect(picked?.kind).toBe('echo');
    expect(picked?.actorId).toBe(1);
  });

  it('keeps the player on a distance tie and when no echo exists', () => {
    expect(chooseNearestActor({ x: 0, y: 0 }, [player(3, 0), echo(3, 0)])?.kind).toBe('player');
    expect(chooseNearestActor({ x: 0, y: 0 }, [player(3, 0)])?.kind).toBe('player');
  });

  it('skips dead candidates and re-selects the player after echo death', () => {
    expect(chooseNearestActor({ x: 0, y: 0 }, [player(9, 0), echo(1, 0, 0)])?.kind).toBe('player');
    expect(chooseNearestActor({ x: 0, y: 0 }, [player(0, 9), echo(1, 0, 0)])?.kind).toBe('player');
  });

  it('returns null when every candidate is dead', () => {
    expect(chooseNearestActor({ x: 0, y: 0 }, [])).toBeNull();
    expect(chooseNearestActor({ x: 0, y: 0 }, [{ ...player(1, 1), alive: false, hp: 0 }])).toBeNull();
  });
});
