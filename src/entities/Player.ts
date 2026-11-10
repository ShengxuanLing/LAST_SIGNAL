import Phaser from 'phaser';
import { PlayerData, ProjectileData, Vec2 } from '../types';
import { basePlayerData, GAME } from '../config/game';
import { WEAPONS } from '../config/weapons';
import { clamp } from '../core/random';
import { IsoMath } from '../core/iso';
import { isoToScreen } from '../core/iso';
import { World } from '../world/World';
import { SaveSystem } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';

export interface WeaponFire {
  damage: number; speed: number; critBase: number; critDamage: number;
  critChance: number; pierce: number; lifetime: number; kind: any;
  magazine: number; shots: number; spread: number;
}

export class Player {
  sprite: Phaser.GameObjects.Sprite;
  data: PlayerData;
  input: { up: boolean; down: boolean; left: boolean; right: boolean };
  id = 0;
  respawn = false;

  wx: number;
  wy: number;

  private fireTimer = 0;
  private dashTimer = 0;
  private invuln = 0;
  private hurtTimer = 0;
  private keys: any = null;
  private cursors: any = null;
  private aimYaw = 0;

  constructor(public world: World, x: number, y: number, private save: ReturnType<SaveSystem['load']>) {
    const stats = basePlayerData();
    stats.maxHp = Math.round(stats.maxHp * (1 + save.permanent.maxHpBonus * 0.2));
    stats.speed *= (1 + save.permanent.speedBonus * 0.08);
    stats.damage += save.permanent.damageBonus * 0.1;
    stats.critChance = clamp(stats.critChance + save.permanent.critChanceBonus * 0.05, 0, 0.8);
    stats.armor += save.permanent.armorBonus;
    // Owned weapons come from the save. 'pulse' is the guaranteed starting
    // weapon and always goes first; every other key must be explicitly unlocked
    // in the save AND be a real WEAPONS entry. Preserve save order, drop dupes,
    // and never grant a weapon that was not unlocked.
    const unlocked = Array.isArray(save.permanent.unlockedWeapons)
      ? save.permanent.unlockedWeapons
      : [];
    const seen = new Set<string>(['pulse']);
    const weaponKeys: string[] = ['pulse'];
    for (const key of unlocked) {
      if (typeof key !== 'string' || seen.has(key)) continue;
      if (!Object.prototype.hasOwnProperty.call(WEAPONS, key)) continue;
      seen.add(key);
      weaponKeys.push(key);
    }
    const weapons = weaponKeys.map((key) => {
      const magazine = WEAPONS[key].magazine ?? -1;
      return { key, level: 1, ammo: magazine, magazine, reloading: false, reloadTimer: 0 };
    });
    const weaponKey = weaponKeys.includes('pulse') ? 'pulse' : weaponKeys[0];
    this.data = {
      ...stats, level: 1, xp: 0, xpToNext: 30, currency: 0,
      weaponKey,
      weapons,
      upgrades: [], abilities: []
    } as PlayerData;
    this.sprite = world.scene.add.sprite(x, y, 'player');
    this.sprite.setDepth(100);
    this.aimYaw = 0;
    this.wx = x;
    this.wy = y;
    this.input = { up: false, down: false, left: false, right: false };
    // Place the sprite at its projected display position on the very first frame.
    this.project();
  }

  get x(): number { return this.wx; }
  get y(): number { return this.wy; }

  project(): void {
    const s = this.world.worldToScreen(this.wx, this.wy);
    this.sprite.setPosition(s.x, s.y);
  }
  get alive(): boolean { return this.data.hp > 0; }
  getRadius(): number { return 0.5; }

  /** If knockback ever leaves the player inside a wall, recover to the nearest walkable cell. */
  private ensureWalkable(): void {
    if (this.world.isWalkable(this.wx, this.wy, this.getRadius())) return;
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = this.wx + dx, ny = this.wy + dy;
          if (this.world.isWalkable(nx, ny, this.getRadius())) {
            this.wx = nx;
            this.wy = ny;
            this.project();
            return;
          }
        }
      }
    }
  }

  registerInput(keys: any, cursors: any): void {
    this.keys = keys;
    this.cursors = cursors;
  }

  reset(x: number, y: number): void {
    this.wx = x;
    this.wy = y;
    this.project();
    this.ensureWalkable();
    this.data.hp = this.data.maxHp;
    this.invuln = 1.0;
    this.fireTimer = 0;
  }

  get weapon() { return WEAPONS[this.data.weaponKey] ?? WEAPONS.pulse; }

  aimFromPointer(pointer: Phaser.Input.Pointer): void {
    const cam = this.world.scene.cameras.main;
    const wp = cam.getWorldPoint(pointer.x, pointer.y);
    if (!wp) return;
    // Bullets live in grid space, so invert the display -> iso -> grid chain before
    // computing the aim angle; only then does the shot follow the mouse direction.
    const g = this.world.screenToWorld(wp.x, wp.y);
    const dx = g.x - this.wx, dy = g.y - this.wy;
    if (Math.hypot(dx, dy) > 1e-4) this.aimYaw = Math.atan2(dy, dx);
  }

  private isWalkable(nx: number, ny: number): boolean {
    return this.world.isWalkable(nx, ny, this.getRadius());
  }

  update(dt: number): void {
    if (this.respawn) return;
    // Recover from an old or rare knockback that left the player outside walkable tiles.
    this.ensureWalkable();
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    // Tick each weapon's reload timer here: tryFire starts a reload when a
    // magazine weapon runs dry, but nothing else ever counts it down, which
    // otherwise leaves that weapon permanently unable to fire. Weapons with
    // magazine <= 0 (e.g. pulse) never enter reloading, so they are untouched.
    for (const ws of this.data.weapons) {
      if (!ws.reloading) continue;
      ws.reloadTimer -= dt;
      if (ws.reloadTimer <= 0) {
        ws.reloading = false;
        ws.reloadTimer = 0;
        ws.ammo = ws.magazine;
      }
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    if (this.data.hpRegen > 0 && this.data.hp < this.data.maxHp) {
      this.data.hp = Math.min(this.data.maxHp, this.data.hp + this.data.hpRegen * dt);
    }

    this.updateKeys();
    let sx = ((this.input.right ? 1 : 0) - (this.input.left ? 1 : 0));
    let sy = ((this.input.down ? 1 : 0) - (this.input.up ? 1 : 0));
    const mag = Math.hypot(sx, sy);
    let speed = this.data.speed;
    let vx = 0, vy = 0;
    if (this.dashTimer > 0) { speed = this.data.speed * 2.6; this.dashTimer -= dt; }
    if (mag > 0) {
      sx /= mag; sy /= mag;
      // screen vector -> world vector via inverse of our iso projection
      const tx = sx / (IsoMath.TILE_W / 2);
      const ty = sy / (IsoMath.TILE_H / 2);
      vx = (tx + ty) / 2 * speed;
      vy = (ty - tx) / 2 * speed;
    }

    // axis-separate sliding collision
    const nx = this.wx + vx * dt;
    if (this.isWalkable(nx, this.wy)) this.wx = nx;
    const ny = this.wy + vy * dt;
    if (this.isWalkable(this.wx, ny)) this.wy = ny;

    this.project();

    // dash
    if (this.cursors && this.cursors.space.isDown
      && this.dashTimer <= 0 && mag > 0) {
      this.dashTimer = this.data.dashDuration;
      this.invuln = Math.max(this.invuln, this.data.dashDuration + 0.05);
      this.world.addShake(4);
      audio.ui();
    }

    this.project();
    // visuals
    if (this.hurtTimer > 0) this.sprite.setTint(0xff3355);
    else { this.sprite.clearTint(); this.sprite.setAlpha(this.dashTimer > 0 ? 0.7 : 1); }

    this.tryFire();
  }

  private updateKeys(): void {
    const k = this.keys;
    const down = (def: any) => def && def.isDown;
    this.input.up = down(k.W);
    this.input.down = down(k.S);
    this.input.left = down(k.A);
    this.input.right = down(k.D);
  }

  private fireCooldown(): number {
    const w = this.weapon;
    const red = Math.min(0.9, this.data.cooldownReduced);
    return (1 / w.baseRate) / (1 - red);
  }

  private tryFire(): void {
    if (!this.fireHeld() || !this.alive) return;
    if (this.fireTimer > 0) return;
    const w = this.weapon;
    let ws = this.data.weapons.find((w2) => w2.key === this.data.weaponKey);
    if (!ws) {
      const def = w;
      ws = { key: this.data.weaponKey, level: 1, ammo: def.magazine ?? -1, magazine: def.magazine ?? -1, reloading: false, reloadTimer: 0 };
      this.data.weapons.push(ws);
    }
    if (ws.magazine > 0) {
      if (ws.reloading) return;
      if (ws.ammo <= 0) { ws.reloading = true; ws.reloadTimer = w.reloadTime ?? 1; return; }
    }
    this.fireTimer = this.fireCooldown();
    if (ws.magazine > 0) ws.ammo--;
    this.world.spawnProjectile(0, this.x, this.y, this.aimYaw, {
      damage: w.baseDamage * this.data.damage,
      speed: w.baseProjectileSpeed / GAME.PIXEL_TO_TILE, critBase: w.critBase, critDamage: this.data.critDamage,
      critChance: this.data.critChance,
      pierce: this.data.pierceCount + (w.kind === 'plasma' ? 2 : 0),
      lifetime: w.baseRange / w.baseProjectileSpeed, kind: w.kind,
      magazine: ws.magazine, shots: w.kind === 'scatter' ? 5 : 1, spread: w.baseSpread
    }, 'player');
    audio.shoot(w.kind);
  }

  // external fire flag, set by scene on mousedown
  private _fireHeld = false;
  fireHeld(): boolean { return this._fireHeld; }
  setFireHeld(v: boolean): void { this._fireHeld = v; }

  hurt(amount: number, fromX: number, fromY: number): boolean {
    if (this.invuln > 0 || !this.alive) return false;
    const reduction = 1 - Math.min(0.75, this.data.armor / (this.data.armor + 80));
    const dmg = Math.max(1, amount * reduction);
    this.data.hp = Math.max(0, this.data.hp - dmg);
    this.hurtTimer = 0.2;
    this.invuln = Math.max(this.invuln, 0.3);
    // Knockback is a small collision-checked nudge. The old 6-tile jump could
    // teleport the player through a wall and leave them permanently stuck.
    const dx = this.wx - fromX, dy = this.wy - fromY;
    const d = Math.hypot(dx, dy) || 1;
    const knockback = 24 / GAME.PIXEL_TO_TILE;
    const nx = this.wx + (dx / d) * knockback;
    const ny = this.wy + (dy / d) * knockback;
    if (this.isWalkable(nx, this.wy)) this.wx = nx;
    if (this.isWalkable(this.wx, ny)) this.wy = ny;
    this.ensureWalkable();
    this.project();
    audio.hurt();
    this.world.addShake(6);
    if (this.data.hp <= 0) this.world.onPlayerDeath();
    return true;
  }

  heal(amount: number): void { this.data.hp = Math.min(this.data.maxHp, this.data.hp + amount); }

  addXp(base: number): number {
    const gained = Math.round(base * this.data.xpGain);
    this.data.xp += gained;
    while (this.data.xp >= this.data.xpToNext) {
      this.data.xp -= this.data.xpToNext;
      this.data.level++;
      this.data.xpToNext = Math.round(30 * Math.pow(this.data.level, 1.3));
      this.world.onLevelUp(this.data.level);
    }
    return gained;
  }
}
