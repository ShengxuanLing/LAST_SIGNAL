p='src/world/World.ts'
s=open(p,encoding='utf-8').read()
start=s.index("  update(dt: number): void {")
end=s.index("  /** C1: swept-hit geometry now lives in sim/rules.ts (single implementation). */")
new = '''  /** C2: fixed 60Hz core ticks; render frame delta is only an accumulator input. */
  stepFrame(frameDeltaMs: number, intent: SimulationIntent): void {
    const delta = Math.max(0, Math.min(frameDeltaMs, SIM_TUNING.MAX_FRAME_DELTA_MS));
    this.simAccumulatorMs += delta;
    let ticks = Math.floor(this.simAccumulatorMs / SIM_TUNING.TICK_MS);
    if (ticks > SIM_TUNING.MAX_TICKS_PER_FRAME) {
      ticks = SIM_TUNING.MAX_TICKS_PER_FRAME;
      // Drop the excess instead of catching up on later frames.
      this.simAccumulatorMs = this.simAccumulatorMs % SIM_TUNING.TICK_MS;
    } else {
      this.simAccumulatorMs -= ticks * SIM_TUNING.TICK_MS;
    }
    if (ticks > 0) {
      const events = stepSimulationTicks(this.sim, ticks, intent);
      this.applySimEvents(events);
    }
    this.syncCoreEntities();
    this.updateLegacy(delta / 1000);
  }

  resetSimulationAccumulator(): void { this.simAccumulatorMs = 0; }

  /** Run exactly N core ticks from a controlled intent (no wall clock). */
  stepSimulationTicksForTest(ticks: number, intent: SimulationIntent): SimEvent[] {
    const events = stepSimulationTicks(this.sim, Math.max(0, Math.floor(ticks)), intent);
    this.applySimEvents(events);
    this.syncCoreEntities();
    return events;
  }

  private applySimEvents(events: SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'player-moved':
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
          break;
        case 'drone-step': {
          const enemy = this.enemies.find((e) => e._id === event.droneId);
          if (enemy) {
            enemy.lastDroneStep = event.step;
            if (event.step.faceAngle !== null) enemy.sprite.setRotation(event.step.faceAngle);
          }
          break;
        }
        case 'enemy-hit': {
          const enemy = this.enemies.find((e) => e._id === event.enemyId);
          if (enemy) {
            enemy.lastHitResult = event.hit;
            this.addDamageNumber(enemy.x, enemy.y, event.damage, event.crit);
            this.callbacks.onStats({ enemies: 0, items: 0, dmg: event.damage });
          }
          break;
        }
        case 'enemy-died': {
          const enemy = this.enemies.find((e) => e._id === event.enemyId);
          if (enemy) this.killEnemy(enemy);
          break;
        }
        case 'player-hurt':
          this.player.syncVisual();
          audio.hurt();
          this.addShake(6);
          break;
        case 'player-death':
          this.onPlayerDeath();
          break;
        case 'projectile-wall':
          this.addHitFx(event.x, event.y, 0x88aacc);
          break;
      }
    }
  }

  private syncCoreEntities(): void {
    this.player.project();
    for (const drone of this.sim.drones) {
      const enemy = this.enemies.find((e) => e._id === drone.id);
      if (enemy) enemy.applyVisual();
    }
    const alive = new Set<number>();
    for (const projectile of this.sim.projectiles) {
      alive.add(projectile.id);
      let spr = this.coreProjectileSprites.get(projectile.id);
      if (!spr) {
        const screen = this.worldToScreen(projectile.pos.x, projectile.pos.y);
        spr = this.scene.add.sprite(screen.x, screen.y, this.projSprite(projectile.kind, projectile.side === 'enemy'));
        spr.setDepth(80);
        spr.setScale(projectile.side === 'enemy' ? 1.4 : 1.1);
        if (projectile.side === 'enemy') spr.setTint(0xff5533);
        this.coreProjectileSprites.set(projectile.id, spr);
      }
      const screen = this.worldToScreen(projectile.pos.x, projectile.pos.y);
      spr.setPosition(screen.x, screen.y);
    }
    for (const [id, spr] of this.coreProjectileSprites) {
      if (alive.has(id)) continue;
      if (spr.scene) spr.destroy();
      this.coreProjectileSprites.delete(id);
    }
  }

  private updateLegacy(dt: number): void {
    this.clock += dt;
    for (const e of this.enemies) {
      if (e.data.kind === 'drone') continue; // core owns drone FSM and timers
      e.update(dt, this.player);
      e.applyVisual();
    }
    if (this.boss) this.boss.update(dt, this.player);
    this.updateProjectiles(dt);
    this.updateLoot(dt);
    this.updateFx(dt);
    this.updateRoom();
    this.updateCamera(dt);
    if (this.renderer) this.renderer.updateLight(this.player.wx, this.player.wy);
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 10);
  }

'''
s=s[:start]+new+s[end:]
open(p,'w',encoding='utf-8').write(s)
print('world update replaced')
