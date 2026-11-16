// AI-NATIVE-02 C2 — permanent old-vs-new parity harness (not a string gate).
//
// Independent reference formulas copied from the pre-C1 inline behaviour are
// compared against the pure rules. This is intentionally separate from the
// rules' own helpers: a change in both would still fail one side.
// Node/Rendered same-state parity is tests/c2-parity.spec.ts + node-parity.

import { describe, expect, it } from 'vitest';
import { GAME, basePlayerData } from '../../config/game';
import { WEAPONS } from '../../config/weapons';
import { IsoMath } from '../../core/iso';
import type { Tile } from '../../types';
import { RNG } from '../../core/random';
import {
  advanceProjectile, axisSlide, buildWeaponSpec, createProjectileData, damageAfterArmor,
  projectileHitsTarget, resolveEnemyHit, resolvePlayerHit, screenVelocityToGridVelocity,
  segmentPointDistance, stepDroneAi, stepPlayerMovement
} from './rules';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const point = (a: { x: number; y: number }, b: { x: number; y: number }) => close(a.x, b.x) && close(a.y, b.y);

function legacyWeaponSpec(w: any, data: any, magazine: number) {
  return {
    damage: w.baseDamage * data.damage,
    speed: w.baseProjectileSpeed / GAME.PIXEL_TO_TILE,
    critBase: w.critBase,
    critDamage: data.critDamage,
    critChance: data.critChance,
    pierce: data.pierceCount + (w.kind === 'plasma' ? 2 : 0),
    lifetime: w.baseRange / w.baseProjectileSpeed,
    kind: w.kind,
    magazine,
    shots: w.kind === 'scatter' ? 5 : 1,
    spread: w.baseSpread
  };
}

function legacyProjectile(spec: any, angle: number, i: number, shots: number, origin: any, id: number, rng: RNG) {
  const spread = spec.spread ?? 0;
  const a = angle + (shots > 1 ? (i / (shots - 1) - 0.5) * spread * shots : 0);
  const px = origin.x + Math.cos(a) * 16 / GAME.PIXEL_TO_TILE;
  const py = origin.y + Math.sin(a) * 16 / GAME.PIXEL_TO_TILE;
  const crit = rng.float() < spec.critChance;
  return {
    pos: { x: px, y: py },
    vel: { x: Math.cos(a) * spec.speed, y: Math.sin(a) * spec.speed },
    damage: (crit ? spec.critDamage : 1) * spec.damage,
    lifetime: spec.lifetime,
    radius: Math.max((spec.magazine > 0 && spec.kind === 'scatter' ? 5 : 6) / GAME.PIXEL_TO_TILE, 0.2),
    crit,
    pierce: spec.pierce ?? 0
  };
}

describe('C2 permanent old-vs-new rule parity', () => {
  it('damage, armor and weapon specs match the legacy inline formulas', () => {
    for (const armor of [0, 1, 8, 12, 80, 1000]) {
      for (const amount of [0, 1, 6, 12, 42, 999]) {
        const old = Math.max(1, amount * (1 - Math.min(0.75, armor / (armor + 80))));
        expect(damageAfterArmor(amount, armor), `armor ${armor}/${amount}`).toBeCloseTo(old, 9);
      }
    }
    const data = basePlayerData();
    for (const key of Object.keys(WEAPONS)) {
      const w = WEAPONS[key];
      const magazine = w.magazine ?? -1;
      const old = legacyWeaponSpec(w, data, magazine);
      const neu: any = buildWeaponSpec({
        weapon: w, damageMultiplier: data.damage, critChance: data.critChance,
        critDamage: data.critDamage, pierceCount: data.pierceCount, magazine,
        pixelToTile: GAME.PIXEL_TO_TILE
      });
      for (const field of Object.keys(old)) {
        expect(neu[field], `${key}.${field}`).toEqual((old as any)[field]);
      }
    }
  });

  it('projectile creation matches legacy, including one rng.float per shot and state order', () => {
    const data = basePlayerData();
    for (const key of Object.keys(WEAPONS)) {
      const w = WEAPONS[key];
      const spec: any = buildWeaponSpec({
        weapon: w, damageMultiplier: data.damage, critChance: data.critChance,
        critDamage: data.critDamage, pierceCount: data.pierceCount,
        magazine: w.magazine ?? -1, pixelToTile: GAME.PIXEL_TO_TILE
      });
      for (let i = 0; i < spec.shots; i++) {
        const seed = 1000 + i * 7 + key.length;
        const rngOld = new RNG(seed);
        const rngNew = new RNG(seed);
        const old = legacyProjectile(spec, 0.37, i, spec.shots, { x: 10, y: 20 }, 5 + i, rngOld);
        const neu = createProjectileData({
          id: 5 + i, ownerId: 0, side: 'player', origin: { x: 10, y: 20 }, angle: 0.37,
          spec, rng: rngNew, shotIndex: i, shotCount: spec.shots, pixelToTile: GAME.PIXEL_TO_TILE
        });
        expect(point(neu.pos, old.pos), `${key}.${i}.pos`).toBe(true);
        expect(point(neu.vel, old.vel), `${key}.${i}.vel`).toBe(true);
        expect(neu.damage, `${key}.${i}.damage`).toBeCloseTo(old.damage, 9);
        expect(neu.lifetime).toBeCloseTo(old.lifetime, 9);
        expect(neu.radius).toBeCloseTo(old.radius, 9);
        expect(neu.crit).toBe(old.crit);
        expect(neu.pierce).toBe(old.pierce);
        expect(rngNew.snapshot(), `${key}.${i}.rngState`).toBe(rngOld.snapshot());
      }
    }
  });

  it('projectile advance / swept hit / enemy & player hits match legacy formulas', () => {
    const tileAt = (x: number, y: number): Tile => ({ x, y, height: 0, type: x > 50 ? 'wall' : 'floor' });
    for (const dt of [0.016, 0.1, 0.5]) {
      const pos = { x: 10, y: 10 }, vel = { x: 5, y: -3 }, lifetime = 0.4;
      const oldPos = { x: pos.x + vel.x * dt, y: pos.y + vel.y * dt };
      const oldLifetime = lifetime - dt;
      const oldWall = tileAt(oldPos.x, oldPos.y).type === 'wall';
      const oldExpired = oldLifetime <= 0 || oldWall;
      const neu = advanceProjectile({ pos, vel, lifetime, dt, tileAt, mapWidth: 200, mapHeight: 200 });
      expect(point(neu.pos, oldPos)).toBe(true);
      expect(neu.lifetime).toBeCloseTo(oldLifetime, 9);
      expect(neu.hitWall).toBe(oldWall);
      expect(neu.expired).toBe(oldExpired);
    }
    function legacySeg(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      if (l2 <= 1e-9) return Math.hypot(px - ax, py - ay);
      let t = ((px - ax) * dx + (py - ay) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }
    for (const c of [
      { a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, t: { x: 1, y: 0 }, r: 0.5, pr: 0.2 },
      { a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, t: { x: 0, y: 5 }, r: 0.5, pr: 0.2 },
      { a: { x: -3, y: 4 }, b: { x: 5, y: -2 }, t: { x: 1, y: 1 }, r: 0.4, pr: 0.3 }
    ]) {
      expect(segmentPointDistance(c.a.x, c.a.y, c.b.x, c.b.y, c.t.x, c.t.y))
        .toBeCloseTo(legacySeg(c.a.x, c.a.y, c.b.x, c.b.y, c.t.x, c.t.y), 9);
      expect(projectileHitsTarget(c.a, c.b, c.t, c.r, c.pr))
        .toBe(legacySeg(c.a.x, c.a.y, c.b.x, c.b.y, c.t.x, c.t.y) <= c.r + c.pr);
    }
    for (const armor of [0, 8, 80]) {
      for (const stun of [0, 0.2]) {
        for (const walk of [true, false]) {
          const hp = 40, pos = { x: 5, y: 5 }, damage = 30, source = { x: 4, y: 4 };
          const isW = () => walk;
          const oldHp = stun > 0 ? hp : hp - Math.max(1, damage * (1 - Math.min(0.75, armor / (armor + 80))));
          const neu = resolveEnemyHit({ hp, position: pos, armor, stunTimer: stun, damage, source, isWalkable: isW, pixelToTile: GAME.PIXEL_TO_TILE });
          expect(neu.blocked).toBe(stun > 0);
          expect(neu.hp).toBeCloseTo(oldHp, 9);
          expect(neu.hitFlash).toBe(stun > 0 ? 0 : 0.15);
          const pneu = resolvePlayerHit({ hp: 100, position: pos, armor, invuln: stun, damage, source, isWalkable: isW, pixelToTile: GAME.PIXEL_TO_TILE });
          const expectedPlayerHp = stun > 0 ? 100 : Math.max(0, 100 - Math.max(1, damage * (1 - Math.min(0.75, armor / (armor + 80)))));
          expect(pneu.blocked).toBe(stun > 0);
          expect(pneu.hp).toBeCloseTo(expectedPlayerHp, 9);
          expect(pneu.hurtTimer).toBe(stun > 0 ? 0 : 0.2);
        }
      }
    }
  });

  it('movement and drone FSM transitions match legacy behavior', () => {
    const oldMove = (pos: any, move: any, dash: boolean, speed: number, dt: number, dashTimer: number, dashDuration: number, isWalkable: (x: number, y: number) => boolean) => {
      const mag = Math.hypot(move.x, move.y);
      let sp = speed, timer = dashTimer;
      if (timer > 0) { sp = speed * 2.6; timer -= dt; }
      let vx = 0, vy = 0;
      if (mag > 0) {
        const sx = move.x / mag, sy = move.y / mag;
        const tx = sx / (IsoMath.TILE_W / 2), ty = sy / (IsoMath.TILE_H / 2);
        vx = (tx + ty) / 2 * sp; vy = (ty - tx) / 2 * sp;
      }
      let x = pos.x, y = pos.y;
      const nx = x + vx * dt; if (isWalkable(nx, y)) x = nx;
      const ny = y + vy * dt; if (isWalkable(x, ny)) y = ny;
      const started = dash && timer <= 0 && mag > 0;
      if (started) timer = dashDuration;
      return { position: { x, y }, velocity: { x: vx, y: vy }, dashTimer: timer, dashStarted: started };
    };
    for (const c of [
      { pos: { x: 4, y: 4 }, move: { x: 1, y: 0 }, dash: false, speed: 220, dt: 0.1, timer: 0 },
      { pos: { x: 4, y: 4 }, move: { x: 0, y: 1 }, dash: true, speed: 220, dt: 0.1, timer: 0 },
      { pos: { x: 4, y: 4 }, move: { x: 1, y: 1 }, dash: false, speed: 300, dt: 0.016, timer: 0.1 },
      { pos: { x: 4, y: 4 }, move: { x: 0, y: 0 }, dash: true, speed: 220, dt: 0.1, timer: 0 }
    ]) {
      const neu = stepPlayerMovement({ position: c.pos, move: c.move, dash: c.dash, speed: c.speed, dt: c.dt, dashTimer: c.timer, dashDuration: 0.16, isWalkable: () => true });
      const old = oldMove(c.pos, c.move, c.dash, c.speed, c.dt, c.timer, 0.16, () => true);
      expect(point(neu.position, old.position)).toBe(true);
      expect(point(neu.velocity, old.velocity)).toBe(true);
      expect(neu.dashTimer).toBeCloseTo(old.dashTimer, 9);
      expect(neu.dashStarted).toBe(old.dashStarted);
    }
    const stats = { speed: 90 / 64, aggroRange: 340 / 64, attackRange: 200 / 64, attackCooldown: 1.4, damage: 6, ranged: true, reachEnemy: false };
    const base = {
      dt: 0.1, position: { x: 0, y: 0 }, player: { x: 3, y: 0 }, stats,
      stateTimer: 0.2, wanderTimer: 1, attackTimer: 0,
      patrolPoints: [{ x: 10, y: 0 }], patrolIndex: 0, targetId: null,
      isWalkable: () => true, pixelToTile: GAME.PIXEL_TO_TILE
    } as any;
    const detect = stepDroneAi({ ...base, state: 'detect' });
    expect(detect.stateTimer).toBeCloseTo(0.1, 9);
    const attack = stepDroneAi({ ...base, state: 'attack' });
    expect(attack.attack?.kind).toBe('ranged');
    expect(attack.attackTimer).toBe(1.4);
    const stun = stepDroneAi({ ...base, state: 'stun', stateTimer: 0.05 });
    expect(stun.stateTimer).toBeCloseTo(-0.05, 9);
    expect(stun.state).toBe('chase');
    expect(screenVelocityToGridVelocity({ x: 1, y: 0 }, 64).x).toBeCloseTo(64 / IsoMath.TILE_W, 9);
    expect(axisSlide({ x: 0, y: 0 }, { x: 1, y: 0 }, 1, () => false)).toEqual({ x: 0, y: 0 });
  });
});
