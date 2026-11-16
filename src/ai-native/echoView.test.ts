// P3-a fix — ONE shared echo observation projection (Node + Rendered).

import { describe, expect, it } from 'vitest';
import { buildEchoObservation } from '../world/echoView';
import { echoPlayerData } from '../world/sim/core';
import type { SimEchoState } from '../world/sim/core';

function echo(x: number, y: number): SimEchoState {
  return {
    actorId: 1, x, y, data: echoPlayerData(),
    dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0, aimYaw: 0
  };
}

const alwaysVisible = () => true;
const neverOpaque = () => false;

describe('buildEchoObservation', () => {
  it('includes perceived non-drone targets and Boss public state', () => {
    const view = buildEchoObservation({
      echo: echo(0, 0), player: { x: 2, y: 0 }, tick: 7,
      drones: [{ id: 1, x: 1, y: 0, hp: 20 }],
      targets: [
        { id: 2, kind: 'hunter', x: 2, y: 1, hp: 60, isBoss: false },
        { id: 3, kind: 'boss_warden', x: 3, y: 0, hp: 900, isBoss: true }
      ],
      isExplored: alwaysVisible, isOpaque: neverOpaque
    });
    expect(view.drones.map((d) => d.id)).toEqual([1]);
    expect(view.targets.map((t) => t.id)).toEqual([2, 3]);
    expect(view.targets.find((t) => t.isBoss)).toMatchObject({ kind: 'boss_warden', hp: 900 });
    expect(JSON.stringify(view)).not.toContain('rngState');
    expect(JSON.stringify(view)).not.toContain('seed');
  });

  it('drops dead, hidden, unexplored and out-of-radius actors', () => {
    const view = buildEchoObservation({
      echo: echo(0, 0), player: { x: 0, y: 0 }, tick: 0,
      drones: [{ id: 1, x: 40, y: 0, hp: 20 }, { id: 2, x: 1, y: 0, hp: 0 }],
      targets: [
        { id: 3, kind: 'hunter', x: 1, y: 0, hp: 0, isBoss: false },
        { id: 4, kind: 'sentinel', x: 1, y: 1, hp: 20, isBoss: false }
      ],
      isExplored: (x) => x < 0.5,
      isOpaque: neverOpaque
    });
    expect(view.drones).toHaveLength(0);
    expect(view.targets).toHaveLength(0);
  });

  it('a wall blocks a target behind it', () => {
    const view = buildEchoObservation({
      echo: echo(0, 0), player: { x: 0, y: 0 }, tick: 0,
      drones: [], targets: [{ id: 5, kind: 'stalker', x: 4, y: 0, hp: 20, isBoss: false }],
      isExplored: alwaysVisible,
      isOpaque: (x) => x > 1 && x < 3
    });
    expect(view.targets).toHaveLength(0);
  });
});
