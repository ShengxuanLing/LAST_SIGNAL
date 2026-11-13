// AI-NATIVE-02 C1 — static rewiring gate.
//
// Proves the Phaser-facing adapters call the single pure rule module and that
// the old inline rule bodies are gone, without pretending this is a complete
// centralised SimulationCore (that is C2).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (relative: string): string => readFileSync(path.resolve(relative), 'utf8');

describe('C1 rewiring: Phaser adapters call sim/rules', () => {
  it('Player delegates movement, aim, weapon spec and damage', () => {
    const src = read('src/entities/Player.ts');
    expect(src).toContain("from '../world/sim/rules'");
    expect(src).toContain('stepPlayerMovement(');
    expect(src).toContain('aimYawFromGrid(');
    expect(src).toContain('buildWeaponSpec(');
    expect(src).toContain('damageAfterArmor(');
    // No duplicated inline anisotropic / weapon-spec / armour bodies.
    expect(src).not.toContain('const tx = sx / (IsoMath.TILE_W / 2)');
    expect(src).not.toContain('const reduction = 1 - Math.min(0.75');
    expect(src).not.toContain("w.kind === 'scatter' ? 5 : 1");
  });

  it('Enemy delegates drone FSM, enemy hit and shared movement/attack helpers', () => {
    const src = read('src/entities/Enemy.ts');
    expect(src).toContain("from '../world/sim/rules'");
    expect(src).toContain('stepDroneAi(');
    expect(src).toContain('resolveEnemyHit(');
    expect(src).toContain('axisSlideToward(');
    expect(src).toContain('rangedAttackDescriptor(');
    expect(src).toContain('legacyStateMachine');
    expect(src).not.toContain('const reduction = 1 - Math.min(0.75');
    expect(src).not.toContain('this.stateMachine(dt, player)');
  });

  it('World delegates projectile creation, advance and swept hit', () => {
    const src = read('src/world/World.ts');
    expect(src).toContain("from './sim/rules'");
    expect(src).toContain('createProjectileData(');
    expect(src).toContain('advanceProjectile(');
    expect(src).toContain('projectileHitsTarget(');
    expect(src).not.toContain('private segmentPointDistance(');
    expect(src).not.toContain('const crit = this.rng.float() < spec.critChance');
  });

  it('control.ts uses IsoMath via the shared movement budget (F-09)', () => {
    const src = read('src/ai-native/control.ts');
    expect(src).toContain('IsoMath.TILE_W');
    expect(src).toContain('screenVelocityToGridVelocity(');
    expect(src).toContain('gridDirectionToScreenDirection(');
    expect(src).not.toContain('tileW = 64, tileH = 32');
  });
});
