# -*- coding: utf-8 -*-
from pathlib import Path
p = Path('src/entities/Enemy.ts')
s = p.read_text(encoding='utf-8')

s = s.replace("""<<<<<<< HEAD
  private moveToPlayer(dt: number, player: ActorTargetView): void {
    const stats = this.data.stats;
    const next = axisSlideToward({ x: this.wx, y: this.wy }, { x: player.x, y: player.y }, stats.speed, dt,
      (x, y) => this.world.isWalkable(x, y));
    this.world.enqueueTargetMove(this._id, next.x, next.y);
=======
  private canMove(x: number, y: number, radius = this.getRadius()): boolean {
    return this.world.canMoveInRoom(x, y, radius, this.data.spawnRoom);
  }

  private moveToPlayer(dt: number, player: Player): void {
    const stats = this.data.stats;
    const dx = player.x - this.x, dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    let vx = dx / d * stats.speed, vy = dy / d * stats.speed;
    if (this.canMove(this.wx + vx * dt, this.wy)) this.wx += vx * dt;
    if (this.canMove(this.wx, this.wy + vy * dt)) this.wy += vy * dt;
>>>>>>> origin/feat/sector-dungeon
""", """  private canMove(x: number, y: number, radius = this.getRadius()): boolean {
    return this.world.canMoveInRoom(x, y, radius, this.data.spawnRoom);
  }

  private moveToPlayer(dt: number, player: ActorTargetView): void {
    const stats = this.data.stats;
    const next = axisSlideToward({ x: this.wx, y: this.wy }, { x: player.x, y: player.y }, stats.speed, dt,
      (x, y) => this.canMove(x, y));
    this.world.enqueueTargetMove(this._id, next.x, next.y);
""")

s = s.replace("""<<<<<<< HEAD
    const next = axisSlideToward({ x: this.wx, y: this.wy }, target, stats.speed * 0.5, dt,
      (x, y) => this.world.isWalkable(x, y));
    this.world.enqueueTargetMove(this._id, next.x, next.y);
=======
    let vx = dx / d * stats.speed * 0.5, vy = dy / d * stats.speed * 0.5;
    if (this.canMove(this.wx + vx * dt, this.wy)) this.wx += vx * dt;
    if (this.canMove(this.wx, this.wy + vy * dt)) this.wy += vy * dt;
>>>>>>> origin/feat/sector-dungeon
""", """    const next = axisSlideToward({ x: this.wx, y: this.wy }, target, stats.speed * 0.5, dt,
      (x, y) => this.canMove(x, y));
    this.world.enqueueTargetMove(this._id, next.x, next.y);
""")

s = s.replace("""<<<<<<< HEAD
    const away = { x: 2 * this.x - player.x, y: 2 * this.y - player.y };
    const next = axisSlideToward({ x: this.wx, y: this.wy }, away, stats.speed, dt,
      (x, y) => this.world.isWalkable(x, y));
    this.world.enqueueTargetMove(this._id, next.x, next.y);
=======
    // move away from player, perpendicular preferred
    const player = this.world.player;
    const dx = this.x - player.x, dy = this.y - player.y;
    const d = Math.hypot(dx, dy) || 1;
    let vx = dx / d * stats.speed, vy = dy / d * stats.speed;
    if (this.canMove(this.wx + vx * dt, this.wy)) this.wx += vx * dt;
    if (this.canMove(this.wx, this.wy + vy * dt)) this.wy += vy * dt;
>>>>>>> origin/feat/sector-dungeon
""", """    const away = { x: 2 * this.x - player.x, y: 2 * this.y - player.y };
    const next = axisSlideToward({ x: this.wx, y: this.wy }, away, stats.speed, dt,
      (x, y) => this.canMove(x, y));
    this.world.enqueueTargetMove(this._id, next.x, next.y);
""")

s = s.replace("""<<<<<<< HEAD
      const shot = rangedAttackDescriptor({ x: this.x, y: this.y }, { x: player.x, y: player.y }, GAME.PIXEL_TO_TILE);
      this.world.spawnEnemyProjectile(this.id, this.x, this.y, stats.damage, shot.velocity);
=======
      // ranged projectile: spawn at the enemy and travel toward the player in grid space
      const a = Math.atan2(player.y - this.y, player.x - this.x);
      const speed = 160 / GAME.PIXEL_TO_TILE;
      const offsets = this.data.kind === 'sentry' ? [-0.22, 0.22] : this.data.kind === 'shiver' ? [-0.3, 0, 0.3] : [0];
      for (const offset of offsets) {
        this.world.spawnEnemyProjectile(this.id, this.x, this.y, stats.damage,
          { x: Math.cos(a + offset) * speed, y: Math.sin(a + offset) * speed });
      }
>>>>>>> origin/feat/sector-dungeon
""", """      const shot = rangedAttackDescriptor({ x: this.x, y: this.y }, { x: player.x, y: player.y }, GAME.PIXEL_TO_TILE);
      const a = Math.atan2(shot.velocity.y, shot.velocity.x);
      const speed = Math.hypot(shot.velocity.x, shot.velocity.y);
      const offsets = this.data.kind === 'sentry' ? [-0.22, 0.22] : this.data.kind === 'shiver' ? [-0.3, 0, 0.3] : [0];
      for (const offset of offsets) {
        this.world.spawnEnemyProjectile(this.id, this.x, this.y, stats.damage,
          { x: Math.cos(a + offset) * speed, y: Math.sin(a + offset) * speed });
      }
""")

# Drop the sector legacy hit method: core owns HP for registered targets.
start = s.index('<<<<<<< HEAD\n  stun(seconds: number): void {')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n  stun(seconds: number): void {', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
s = s[:start] + '  stun(seconds: number): void {' + s[end + len('  stun(seconds: number): void {'):]

p.write_text(s, encoding='utf-8')
print('Enemy sector patched')
