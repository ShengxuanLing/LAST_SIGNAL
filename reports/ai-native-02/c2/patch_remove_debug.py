p='src/entities/Player.ts'
s=open(p,encoding='utf-8').read()
s=s.replace("""import {
  aimYawFromGrid, resolvePlayerHit,
  type PlayerMoveResult, type WeaponFireSpec
} from '../world/sim/rules';""","""import { aimYawFromGrid, resolvePlayerHit } from '../world/sim/rules';""")
s=s.replace("""  /** C1 evidence: last pure-rule results actually applied by this Phaser player. */
  lastMoveStep: PlayerMoveResult | null = null;
  lastWeaponSpec: WeaponFireSpec | null = null;
""","")
s=s.replace("""    this.lastMoveStep = step;
    this.wx = step.position.x;""","""    this.wx = step.position.x;""") if False else s
open(p,'w',encoding='utf-8').write(s)

p='src/entities/Enemy.ts'
s=open(p,encoding='utf-8').read()
s=s.replace("""import {
  axisSlideToward, distanceWithin, rangedAttackDescriptor, resolveEnemyHit,
  type DroneAiResult, type EnemyHitResult
} from '../world/sim/rules';""","""import { axisSlideToward, distanceWithin, rangedAttackDescriptor, resolveEnemyHit } from '../world/sim/rules';""")
s=s.replace("""  /** C1/C2 evidence: last pure drone FSM / hit results applied by this Phaser enemy. */
  lastDroneStep: DroneAiResult | null = null;
  lastHitResult: EnemyHitResult | null = null;
""","")
s=s.replace("""    this.lastHitResult = result;
    if (result.blocked) return false;""","""    if (result.blocked) return false;""")
open(p,'w',encoding='utf-8').write(s)

p='src/world/World.ts'
s=open(p,encoding='utf-8').read()
s=s.replace("""  /** C1/C2 evidence: first core projectile produced by the single pure builder. */
  lastProjectileData: SimProjectile | null = null;
""","")
s=s.replace("""        case 'player-moved':
          this.player.lastMoveStep = event;
          if (event.dashStarted) { this.addShake(4); audio.ui(); }
          break;
        case 'player-fired':
          this.player.lastWeaponSpec = event.spec;
          this.player.playFireFeedback(event.spec.kind);
          break;
        case 'projectile-spawned':
          if (event.projectile.source === 'player') {
            this.lastProjectileData = {
              ...event.projectile, pos: { ...event.projectile.pos }, vel: { ...event.projectile.vel },
              hitIds: [...event.projectile.hitIds]
            };
          }
          break;""","""        case 'player-moved':
          if (event.dashStarted) { this.addShake(4); audio.ui(); }
          break;
        case 'player-fired':
          this.player.playFireFeedback(event.spec.kind);
          break;""")
s=s.replace("""          if (enemy) {
            enemy.lastDroneStep = event.step;
            if (event.step.faceAngle !== null) enemy.sprite.setRotation(event.step.faceAngle);
          }""","""          if (enemy && event.step.faceAngle !== null) enemy.sprite.setRotation(event.step.faceAngle);""")
s=s.replace("""          if (enemy) {
            enemy.lastHitResult = event.hit;
            this.addDamageNumber(enemy.x, enemy.y, event.damage, event.crit);
            this.callbacks.onStats({ enemies: 0, items: 0, dmg: event.damage });
          }""","""          if (enemy) {
            this.addDamageNumber(enemy.x, enemy.y, event.damage, event.crit);
            this.callbacks.onStats({ enemies: 0, items: 0, dmg: event.damage });
          }""")
open(p,'w',encoding='utf-8').write(s)

p='tests/ai-native-world.spec.ts'
s=open(p,encoding='utf-8').read()
s=s.replace("""      lastMoveStep: gs.world.player.lastMoveStep,
      lastWeaponSpec: gs.world.player.lastWeaponSpec,
      lastProjectileData: gs.world.lastProjectileData,
""","")
open(p,'w',encoding='utf-8').write(s)

p='src/world/sim/rewiring.test.ts'
s=open(p,encoding='utf-8').read()
s=s.replace("""  it('Player delegates all mutable state to World.sim and only samples intents', () => {
    const src = read('src/entities/Player.ts');
    expect(src).toContain('this.world.sim');
    expect(src).toContain('sampleIntent()');
    expect(src).toContain('syncVisual()');
    expect(src).toContain('resolvePlayerHit(');
    expect(src).not.toContain('this.applyIntent(');
    expect(src).not.toContain('stepPlayerMovement(');
    expect(src).not.toContain('private tryFire(');
  });""","""  it('Player delegates all mutable state to World.sim and only samples intents', () => {
    const src = read('src/entities/Player.ts');
    expect(src).toContain('this.world.sim');
    expect(src).toContain('sampleIntent()');
    expect(src).toContain('syncVisual()');
    expect(src).toContain('resolvePlayerHit(');
    expect(src).not.toContain('this.applyIntent(');
    expect(src).not.toContain('stepPlayerMovement(');
    expect(src).not.toContain('private tryFire(');
    for (const debug of ['lastMoveStep', 'lastWeaponSpec', 'lastProjectileData', 'lastDroneStep', 'lastHitResult']) {
      expect(src, debug).not.toContain(debug);
    }
  });""")
open(p,'w',encoding='utf-8').write(s)
print('debug mirrors removed')
