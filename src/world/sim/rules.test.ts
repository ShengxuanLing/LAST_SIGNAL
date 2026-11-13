// AI-NATIVE-02 C1 — Node unit tests for the shared pure rules.
//
// Uses the real MapGenerator (fixed seed), real WEAPONS / ENEMY_STATS / GAME /
// RNG config. Covers blocked movement, aim, fire, swept hit, damage and death.
// No Phaser, no DOM, no fake gameplay.

import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { GAME, basePlayerData } from '../../config/game';
import { WEAPONS } from '../../config/weapons';
import { ENEMY_STATS } from '../../config/enemies';
import { IsoMath } from '../../core/iso';
import { RNG } from '../../core/random';
import { MapGenerator, assignRoles } from '../MapGenerator';
import type { MapData, Tile, Vec2 } from '../../types';
import {
  advanceProjectile, aimYawFromGrid, axisSlide, buildWeaponSpec, createProjectileData,
  damageAfterArmor, gridDirectionToScreenDirection, projectileHitsTarget,
  resolveEnemyHit, screenVelocityToGridVelocity, stepDroneAi, stepPlayerMovement
} from './rules';

function realMap(): MapData {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  return map;
}

function mapTileAt(map: MapData) {
  let minX = Infinity, minY = Infinity;
  for (const row of map.tiles) {
    for (const tile of row) {
      minX = Math.min(minX, tile.x);
      minY = Math.min(minY, tile.y);
    }
  }
  return (x: number, y: number): Tile => {
    const gx = Math.floor(x) - minX;
    const gy = Math.floor(y) - minY;
    if (gy < 0 || gy >= map.tiles.length) return { x: gx, y: gy, type: 'wall', height: 0 };
    const row = map.tiles[gy];
    if (!row || gx < 0 || gx >= row.length) return { x: gx, y: gy, type: 'wall', height: 0 };
    return row[gx];
  };
}

function mapIsWalkable(map: MapData) {
  const tileAt = mapTileAt(map);
  const blocked = (x: number, y: number): boolean => {
    const t = tileAt(x, y);
    return t.type === 'wall' || t.type === 'lava' || t.type === 'water';
  };
  return (x: number, y: number, radius = 0.5): boolean => {
    const samples: Vec2[] = [
      { x: x - radius, y: y - radius }, { x: x + radius, y: y - radius },
      { x: x - radius, y: y + radius }, { x: x + radius, y: y + radius }
    ];
    return !samples.some((s) => blocked(s.x, s.y));
  };
}

function droneStats() {
  const d = ENEMY_STATS.drone;
  return {
    speed: d.speed / 64,
    aggroRange: d.aggroRange / 64,
    attackRange: d.attackRange / 64,
    attackCooldown: d.attackCooldown,
    damage: d.damage,
    ranged: d.ranged,
    reachEnemy: d.reachEnemy
  };
}

function pulseSpec(magazine = -1) {
  const data = basePlayerData();
  return buildWeaponSpec({
    weapon: WEAPONS.pulse,
    damageMultiplier: data.damage,
    critChance: data.critChance,
    critDamage: data.critDamage,
    pierceCount: data.pierceCount,
    magazine,
    pixelToTile: GAME.PIXEL_TO_TILE
  });
}

describe('C1 pure module contract', () => {
  it('has no Phaser / DOM / wall-clock / Math.random dependency', () => {
    const src = readFileSync(path.resolve('src/world/sim/rules.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"]phaser['"]/);
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/);
    expect(src).not.toMatch(/Math\.random/);
    expect(src).toContain('IsoMath.TILE_W');
  });

  it('uses IsoMath tile constants for the anisotropic budget (F-09)', () => {
    const right = screenVelocityToGridVelocity({ x: 1, y: 0 }, 64);
    expect(right.x).toBeCloseTo(64 / IsoMath.TILE_W, 6);
    expect(right.y).toBeCloseTo(-64 / IsoMath.TILE_W, 6);
    const diag = screenVelocityToGridVelocity({ x: 1, y: 1 }, 64);
    expect(Math.hypot(diag.x, diag.y)).not.toBeCloseTo(Math.hypot(right.x, right.y), 6);
    const screen = gridDirectionToScreenDirection(3, 1);
    expect(screen.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(screen.y).toBeCloseTo(Math.SQRT1_2, 6);
  });
});

describe('C1 movement / collision / aim on a real generated room', () => {
  it('axisSlide refuses a wall cell from the real map but accepts a floor step', () => {
    const map = realMap();
    const isWalkable = mapIsWalkable(map);
    const tileAt = mapTileAt(map);
    let floor: Vec2 | null = null;
    let wallDirection: Vec2 | null = null;
    for (const row of map.tiles) {
      for (const tile of row) {
        if (tile.type !== 'floor' && tile.type !== 'spawn') continue;
        if (!isWalkable(tile.x, tile.y, 0.5)) continue;
        for (const d of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]) {
          if (tileAt(tile.x + d.x, tile.y + d.y).type === 'wall') {
            floor = { x: tile.x, y: tile.y };
            wallDirection = d;
            break;
          }
        }
        if (floor) break;
      }
      if (floor) break;
    }
    expect(floor, 'found a real floor tile with an adjacent wall').not.toBeNull();
    const blocked = axisSlide(floor!, wallDirection!, 1, (x, y) => isWalkable(x, y, 0.5));
    expect(blocked.x).toBeCloseTo(floor!.x, 6);
    expect(blocked.y).toBeCloseTo(floor!.y, 6);
    const free = axisSlide(floor!, { x: 0, y: 0 }, 1, (x, y) => isWalkable(x, y, 0.5));
    expect(free.x).toBeCloseTo(floor!.x, 6);
  });

  it('stepPlayerMovement uses the shared velocity and dash rules', () => {
    const step = stepPlayerMovement({
      position: { x: 4, y: 4 },
      move: { x: 1, y: 0 },
      dash: false,
      speed: 220,
      dt: 0.1,
      dashTimer: 0,
      dashDuration: 0.16,
      isWalkable: () => true
    });
    const expected = screenVelocityToGridVelocity({ x: 1, y: 0 }, 220);
    expect(step.velocity).toEqual(expected);
    expect(step.position.x).toBeCloseTo(4 + expected.x * 0.1, 6);
    expect(step.position.y).toBeCloseTo(4 + expected.y * 0.1, 6);
    expect(step.dashStarted).toBe(false);
    const dash = stepPlayerMovement({
      position: { x: 4, y: 4 }, move: { x: 1, y: 0 }, dash: true,
      speed: 220, dt: 0.1, dashTimer: 0, dashDuration: 0.16, isWalkable: () => true
    });
    expect(dash.dashStarted).toBe(true);
    expect(dash.dashTimer).toBeCloseTo(0.16, 6);
  });

  it('aimYawFromGrid is the single aim entry', () => {
    expect(aimYawFromGrid({ x: 0, y: 0 }, { x: 3, y: 1 })).toBeCloseTo(Math.atan2(1, 3), 6);
    expect(aimYawFromGrid({ x: 2, y: 2 }, { x: 2, y: 2 })).toBeNull();
  });
});

describe('C1 real pulse weapon / projectile / hit / death', () => {
  it('buildWeaponSpec uses real WEAPONS.pulse and covers other weapons without regression', () => {
    const pulse = pulseSpec();
    expect(pulse.damage).toBe(WEAPONS.pulse.baseDamage);
    expect(pulse.speed).toBe(WEAPONS.pulse.baseProjectileSpeed / GAME.PIXEL_TO_TILE);
    expect(pulse.lifetime).toBe(WEAPONS.pulse.baseRange / WEAPONS.pulse.baseProjectileSpeed);
    expect(pulse.shots).toBe(1);
    expect(pulse.kind).toBe('pulse');
    const scatter = buildWeaponSpec({
      weapon: WEAPONS.scatter, damageMultiplier: 1, critChance: 0.1, critDamage: 1.5,
      pierceCount: 0, magazine: 8, pixelToTile: GAME.PIXEL_TO_TILE
    });
    expect(scatter.shots).toBe(5);
    expect(scatter.magazine).toBe(8);
    const plasma = buildWeaponSpec({
      weapon: WEAPONS.plasma, damageMultiplier: 1, critChance: 0.1, critDamage: 1.5,
      pierceCount: 3, magazine: -1, pixelToTile: GAME.PIXEL_TO_TILE
    });
    expect(plasma.pierce).toBe(5); // 3 + plasma bonus
  });

  it('createProjectileData uses the real RNG and produces a real pulse bullet', () => {
    const spec = pulseSpec();
    const rng = new RNG(12345);
    const data = createProjectileData({
      id: 7, ownerId: 0, side: 'player', origin: { x: 5, y: 5 }, angle: 0,
      spec, rng, shotIndex: 0, shotCount: spec.shots, pixelToTile: GAME.PIXEL_TO_TILE
    });
    expect(data.pos.x).toBeCloseTo(5 + 16 / GAME.PIXEL_TO_TILE, 6);
    expect(data.vel.x).toBeCloseTo(spec.speed, 6);
    expect(data.lifetime).toBe(spec.lifetime);
    expect(data.radius).toBe(0.2);
    expect(data.damage).toBe((data.crit ? spec.critDamage : 1) * spec.damage);
    expect(data.hitSet.size).toBe(0);
  });

  it('advanceProjectile + swept hit + resolveEnemyHit kills a real drone', () => {
    const spec = pulseSpec();
    const bullet = createProjectileData({
      id: 1, ownerId: 0, side: 'player', origin: { x: 0, y: 0 }, angle: 0,
      spec, rng: new RNG(999), shotIndex: 0, shotCount: 1, pixelToTile: GAME.PIXEL_TO_TILE
    });
    const previous = { ...bullet.pos };
    const advance = advanceProjectile({
      pos: bullet.pos, vel: bullet.vel, lifetime: bullet.lifetime, dt: 0.1,
      tileAt: () => ({ x: 0, y: 0, type: 'floor', height: 0 }),
      mapWidth: 100, mapHeight: 100
    });
    expect(advance.expired).toBe(false);
    expect(advance.hitWall).toBe(false);
    const target = { x: 1, y: 0 };
    expect(projectileHitsTarget(previous, advance.pos, target, 0.5, bullet.radius)).toBe(true);
    expect(projectileHitsTarget({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 5 }, 0.5, bullet.radius)).toBe(false);
    const wall = advanceProjectile({
      pos: { x: 1, y: 0 }, vel: { x: 1, y: 0 }, lifetime: 1, dt: 0.1,
      tileAt: () => ({ x: 0, y: 0, type: 'wall', height: 0 }),
      mapWidth: 100, mapHeight: 100
    });
    expect(wall.hitWall).toBe(true);
    expect(wall.expired).toBe(true);

    const d = ENEMY_STATS.drone;
    const hit = resolveEnemyHit({
      hp: 10, position: { x: 1, y: 0 }, armor: d.armor, stunTimer: 0,
      damage: spec.damage, source: { x: 0, y: 0 },
      isWalkable: () => true, pixelToTile: GAME.PIXEL_TO_TILE
    });
    expect(hit.blocked).toBe(false);
    expect(hit.hp).toBeLessThanOrEqual(0); // drone dies
    expect(hit.hitFlash).toBe(0.15);
    expect(hit.knockbackApplied).toBe(true);
    const stunned = resolveEnemyHit({
      hp: 10, position: { x: 1, y: 0 }, armor: d.armor, stunTimer: 0.2,
      damage: spec.damage, source: { x: 0, y: 0 },
      isWalkable: () => true, pixelToTile: GAME.PIXEL_TO_TILE
    });
    expect(stunned.blocked).toBe(true);
    expect(stunned.hp).toBe(10);
    expect(damageAfterArmor(12, ENEMY_STATS.sentinel.armor)).toBeCloseTo(12 * (1 - 8 / 88), 6);
  });
});

describe('C1 drone FSM (real ENEMY_STATS.drone)', () => {
  const base = {
    dt: 0.1,
    position: { x: 0, y: 0 },
    player: { x: 20, y: 0 },
    stats: droneStats(),
    state: 'idle' as const,
    stateTimer: 1,
    wanderTimer: 1,
    attackTimer: 0,
    patrolPoints: [{ x: 10, y: 0 }],
    patrolIndex: 0,
    targetId: null,
    isWalkable: () => true,
    pixelToTile: GAME.PIXEL_TO_TILE
  };

  it('idle -> patrol, patrol advances toward a real waypoint, blocked by walls', () => {
    const idle = stepDroneAi({ ...base, state: 'idle', stateTimer: -0.1 });
    expect(idle.state).toBe('patrol');
    const patrol = stepDroneAi({ ...base, state: 'patrol' });
    expect(patrol.position.x).toBeGreaterThan(0);
    expect(patrol.state).toBe('patrol');
    const blocked = stepDroneAi({ ...base, state: 'patrol', isWalkable: () => false });
    expect(blocked.position.x).toBe(0);
  });

  it('detects, chases and emits a real ranged attack descriptor', () => {
    const nearPlayer = { x: 3, y: 0 };
    const detect = stepDroneAi({ ...base, state: 'detect', stateTimer: 0.2, player: nearPlayer });
    expect(detect.stateTimer).toBeCloseTo(0.1, 6); // original double decrement
    expect(detect.targetId).toBe(0);
    const chase = stepDroneAi({ ...base, state: 'chase', player: nearPlayer });
    expect(chase.position.x).toBeGreaterThan(0);
    expect(chase.faceAngle).not.toBeNull();
    const attack = stepDroneAi({ ...base, state: 'attack', player: nearPlayer, attackTimer: 0 });
    expect(attack.attack?.kind).toBe('ranged');
    expect(attack.attack?.damage).toBe(ENEMY_STATS.drone.damage);
    expect(Math.hypot(attack.attack!.velocity!.x, attack.attack!.velocity!.y))
      .toBeCloseTo(160 / GAME.PIXEL_TO_TILE, 6);
    expect(attack.attackTimer).toBe(ENEMY_STATS.drone.attackCooldown);
    const cooling = stepDroneAi({ ...base, state: 'attack', player: nearPlayer, attackTimer: 0.5 });
    expect(cooling.attack).toBeNull();
  });

  it('stun double-decrements and exits to chase', () => {
    const stun = stepDroneAi({ ...base, state: 'stun', stateTimer: 0.05 });
    expect(stun.stateTimer).toBeCloseTo(-0.05, 6);
    expect(stun.state).toBe('chase');
  });
});
