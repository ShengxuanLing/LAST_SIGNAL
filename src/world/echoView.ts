// AI-NATIVE-02 P3-a fix — ONE pure echo observation projection for BOTH the
// rendered World and the headless runtime. No Phaser, no DOM, no state writes.
//
// Everything is centred on the echo itself: bounded grid radius, explored
// rooms and wall line-of-sight. Non-drone targets (including Boss) expose only
// public state; hidden/other-room actors never appear.

import { gridLineOfSight, WORLD_PERCEPTION } from '../ai-native/worldPerception';
import { ECHO_LIMITS, type EchoView, type EchoVisibleTarget } from '../ai-native/echo';
import type { SimEchoState } from './sim/core';

export interface EchoObservationActor {
  id: number;
  x: number;
  y: number;
  hp: number;
}

export interface EchoObservationTarget {
  id: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  isBoss: boolean;
}

export interface EchoObservationInput {
  echo: SimEchoState;
  player: { x: number; y: number };
  tick: number;
  drones: readonly EchoObservationActor[];
  targets: readonly EchoObservationTarget[];
  isExplored: (x: number, y: number) => boolean;
  isOpaque: (x: number, y: number) => boolean;
}

export type EchoObservation = EchoView & { targets: EchoVisibleTarget[] };

function perceives(
  echo: SimEchoState, x: number, y: number,
  isExplored: (x: number, y: number) => boolean,
  isOpaque: (x: number, y: number) => boolean
): boolean {
  return gridLineOfSight({ x, y }, {
    center: { x: echo.x, y: echo.y },
    radiusTiles: ECHO_LIMITS.perceptionTiles,
    isExplored,
    isOpaque,
    stepTiles: WORLD_PERCEPTION.losStepTiles
  });
}

export function buildEchoObservation(input: EchoObservationInput): EchoObservation {
  const { echo, isExplored, isOpaque } = input;
  const drones = input.drones
    .filter((drone) => drone.hp > 0 && perceives(echo, drone.x, drone.y, isExplored, isOpaque))
    .slice(0, 32)
    .map((drone) => ({ id: drone.id, x: drone.x, y: drone.y, hp: drone.hp }));
  const targets: EchoVisibleTarget[] = input.targets
    .filter((target) => target.hp > 0 && perceives(echo, target.x, target.y, isExplored, isOpaque))
    .slice(0, 32)
    .map((target) => ({
      id: target.id, kind: target.kind, x: target.x, y: target.y,
      hp: target.hp, isBoss: target.isBoss
    }));
  return {
    tick: input.tick,
    player: { x: input.player.x, y: input.player.y },
    echo: {
      x: echo.x, y: echo.y, hp: echo.data.hp,
      maxHp: echo.data.maxHp, aimYaw: echo.aimYaw
    },
    drones,
    targets
  };
}
