// AI-NATIVE-02 C2 — static ownership / rewiring gate.
//
// Proves the first-slice Phaser adapters read/write World.sim instead of
// keeping shadow player/drone/projectile rules, and that the pure core has no
// Phaser/DOM/Math.random. Node-only deterministic behaviour is tested in
// core.test.ts; rendered parity is tests/c2-parity.spec.ts.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (relative: string): string => readFileSync(path.resolve(relative), 'utf8');

describe('C2 pure core contract', () => {
  it('core.ts and rules.ts have no Phaser / DOM / wall clock / unseeded randomness', () => {
    for (const file of ['src/world/sim/core.ts', 'src/world/sim/rules.ts']) {
      const src = read(file);
      expect(src, file).not.toMatch(/from ['\"]phaser['\"]/);
      expect(src, file).not.toMatch(/\bdocument\b|\bwindow\b/);
      expect(src, file).not.toMatch(/Math\.random|Date\.now|performance\.now/);
    }
    const core = read('src/world/sim/core.ts');
    expect(core).toContain('stepSimulationTicks(');
    expect(core).toContain('canonicalSimulationState(');
    expect(core).toContain('SimEvent');
    expect(core).toContain('TICK_HZ: 60');
  });
});

describe('C2 single-authority adapters', () => {
  it('Player delegates all mutable state to World.sim and only samples intents', () => {
    const src = read('src/entities/Player.ts');
    expect(src).toContain('this.world.sim');
    expect(src).toContain('sampleIntent()');
    expect(src).toContain('syncVisual(');
    expect(src).toContain('enqueuePlayerHit(');
    expect(src).not.toContain('this.applyIntent(');
    expect(src).not.toContain('stepPlayerMovement(');
    expect(src).not.toContain('private tryFire(');
    expect(src).not.toContain('this.data.hp = hit.hp');
    for (const debug of ['lastMoveStep', 'lastWeaponSpec', 'lastProjectileData', 'lastDroneStep', 'lastHitResult']) {
      expect(src, debug).not.toContain(debug);
    }
  });

  it('Enemy drone state is attached to the core, other kinds keep legacy FSM', () => {
    const src = read('src/entities/Enemy.ts');
    expect(src).toContain('attachSimDrone(');
    expect(src).toContain('SimDroneState');
    expect(src).toContain("if (this.data.kind === 'drone') return;");
    expect(src).toContain('legacyStateMachine');
    expect(src).not.toContain('stepDroneAi(');
    // B7: target state is read-only for the adapter; no live setters/hit write.
    expect(src).not.toContain('set wx(');
    expect(src).not.toContain('set wy(');
    expect(src).not.toContain('set _hp(');
    expect(src).not.toContain('hit(damage: number');
    expect(src).toContain('enqueueTargetMove(');
  });

  it('Boss target is read-only for the adapter; target radius keeps the old +1', () => {
    const src = read('src/entities/Boss.ts');
    expect(src).not.toContain('set wx(');
    expect(src).not.toContain('set wy(');
    expect(src).not.toContain('set _hp(');
    expect(src).not.toContain('hit(damage: number');
    expect(src).toContain('enqueueTargetMove(');
    expect(read('src/world/World.ts')).toContain('getRadius() + 1');
  });

  it('B6/B7/H9/H10: rewards, target commands, gated helpers and hit flash are in the core/World', () => {
    const core = read('src/world/sim/core.ts');
    expect(core).toContain('registerTarget');
    expect(core).toContain('const stored: SimTarget = { ...target }');
    expect(core).toContain('awardEnemyKill');
    expect(core).toContain('processCommands');
    expect(core).toContain('pendingCommands');
    const world = read('src/world/World.ts');
    expect(world).toContain('enqueueTargetMove(');
    expect(world).toContain('assertDevTest');
    expect(world).toContain('enemy.data.hitFlash = event.hit.hitFlash');
    expect(world).not.toContain('this.player.addXp(e.data.stats.xpValue)');
    expect(read('src/scenes/LevelUpScene.ts')).toContain('applyUpgradeChoice(');
    expect(read('src/entities/Player.ts')).toContain('Owner-only initialization');
  });

  it('World owns SimulationState, fixed accumulator, typed events and legacy-only update', () => {
    const src = read('src/world/World.ts');
    expect(src).toContain('createSimulationState(');
    expect(src).toContain('stepSimulationTicks(');
    expect(src).toContain('stepFrame(');
    expect(src).toContain('applySimEvents(');
    expect(src).toContain('syncCoreEntities(');
    expect(src).toContain('resetSimulationAccumulator(');
    expect(src).toContain('MAX_TICKS_PER_FRAME');
    expect(src).not.toContain('this.player.update(dt)');
    expect(src).not.toContain('spawnProjectile(ownerId');
  });

  it('GameScene samples one intent and resets accumulator on pause-like overlays', () => {
    const src = read('src/scenes/GameScene.ts');
    expect(src).toContain('sampleIntent()');
    expect(src).toContain('world.stepFrame(delta, intent)');
    expect(src).toContain('resetSimulationAccumulator()');
    expect(src).not.toContain('world.update(dt)');
  });
});
