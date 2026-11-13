import Phaser from 'phaser';
import { PlayerData, ProjectileData, Vec2 } from '../types';
import { basePlayerData, GAME } from '../config/game';
import { WEAPONS } from '../config/weapons';
import { clamp } from '../core/random';
import { isoToScreen } from '../core/iso';
import { World } from '../world/World';
import { SaveSystem } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';
import { WhaleCharacterEffects, WHALE_TEXTURE } from '../core/WhaleCharacter';
import {
  ControlAuthority, intentFromHumanInput, neutralIntent,
  type ControlOwner, type PlayerIntent
} from '../ai-native/control';
import { LocalDeterministicController } from '../ai-native/localController';
import {
  aimYawFromGrid, buildWeaponSpec, damageAfterArmor, stepPlayerMovement,
  type PlayerMoveResult, type WeaponFireSpec
} from '../world/sim/rules';

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

  /** Control ownership / pause / takeover state (AI-NATIVE-02 P1). */
  readonly control = new ControlAuthority();
  /** Last intent actually executed this frame (read-only HUD / evidence truth). */
  lastIntent: PlayerIntent = neutralIntent();
  lastIntentOwner: ControlOwner = 'human';
  /** C1 evidence: last pure-rule results actually applied by this Phaser player. */
  lastMoveStep: PlayerMoveResult | null = null;
  lastWeaponSpec: WeaponFireSpec | null = null;
  private aiController = new LocalDeterministicController();
  private lastIntentOwnerSeen: ControlOwner = 'human';
  private _interactQueued = false;

  wx: number;
  wy: number;

  private fireTimer = 0;
  private dashTimer = 0;
  private invuln = 0;
  private hurtTimer = 0;
  private keys: any = null;
  private cursors: any = null;
  private aimYaw = 0;
  private whaleEffects?: WhaleCharacterEffects;

  constructor(public world: World, x: number, y: number, private save: ReturnType<SaveSystem['load']>) {
    const stats = basePlayerData();
    stats.maxHp = Math.round(stats.maxHp * (1 + save.permanent.maxHpBonus * 0.2));
    stats.hp = stats.maxHp;
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
    const whale = save.settings.avatar === 'whale';
    this.sprite = world.scene.add.sprite(x, y, whale ? WHALE_TEXTURE : 'player');
    this.sprite.setDepth(100);
    if (whale) {
      this.sprite.setScale(0.61).setOrigin(0.46, 0.91);
      this.whaleEffects = new WhaleCharacterEffects(this.sprite);
    }
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
    this.whaleEffects?.project();
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

  equipWeapon(key: string): boolean {
    if (key === this.data.weaponKey || !this.data.weapons.some((weapon) => weapon.key === key)) return false;
    this.data.weaponKey = key;
    return true;
  }

  aimFromPointer(pointer: Phaser.Input.Pointer): void {
    const cam = this.world.scene.cameras.main;
    const wp = cam.getWorldPoint(pointer.x, pointer.y);
    if (!wp) return;
    // Bullets live in grid space, so invert the display -> iso -> grid chain before
    // computing the aim angle; only then does the shot follow the mouse direction.
    const g = this.world.screenToWorld(wp.x, wp.y);
    this.setAimGrid(g.x, g.y);
  }

  /**
   * Single aim entry: the human pointer adapter converts its screen point to
   * grid space and calls this; the AI intent carries a grid aim point and calls
   * the same method. No pointer/camera object is fabricated for the controller
   * (review R-08).
   */
  setAimGrid(x: number, y: number): void {
    const yaw = aimYawFromGrid({ x: this.wx, y: this.wy }, { x, y });
    if (yaw !== null) this.aimYaw = yaw;
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
    this.detectHumanTakeover();
    const intent = this.resolveIntent();
    this.lastIntent = intent;
    this.lastIntentOwner = this.control.owner;
    this.applyIntent(dt, intent);
  }

  /**
   * Single legal execution path. Human keyboard input and the local
   * deterministic controller both produce a PlayerIntent and land here; the
   * controller never writes coordinates or HP directly.
   */
  private applyIntent(dt: number, intent: PlayerIntent): void {
    const previousX = this.sprite.x;
    const previousY = this.sprite.y;
    // C1: movement / axis-separated collision / dash budget is one pure rule.
    const step = stepPlayerMovement({
      position: { x: this.wx, y: this.wy },
      move: intent.move,
      dash: intent.dash,
      speed: this.data.speed,
      dt,
      dashTimer: this.dashTimer,
      dashDuration: this.data.dashDuration,
      isWalkable: (x, y) => this.isWalkable(x, y)
    });
    this.lastMoveStep = step;
    this.wx = step.position.x;
    this.wy = step.position.y;
    this.dashTimer = step.dashTimer;
    if (step.dashStarted) {
      this.invuln = Math.max(this.invuln, this.data.dashDuration + 0.05);
      this.world.addShake(4);
      audio.ui();
    }

    this.project();
    this.whaleEffects?.move(dt, this.sprite.x - previousX, this.sprite.y - previousY, this.dashTimer > 0);
    // visuals
    if (this.hurtTimer > 0) this.sprite.setTint(0xff3355);
    else { this.sprite.clearTint(); this.sprite.setAlpha(this.dashTimer > 0 ? 0.7 : 1); }

    // Aim: the human pointer adapter and the controller both call setAimGrid,
    // so their shots use the same aimYaw and the same tryFire path.
    if (intent.aim) this.setAimGrid(intent.aim.x, intent.aim.y);
    if (intent.interact) this.world.tryInteract(this);
    this.tryFire(intent.fire);
  }

  /** Resolve this frame's intent from whoever currently owns control. */
  private resolveIntent(): PlayerIntent {
    if (this.control.paused) return neutralIntent();
    const owner = this.control.owner;
    if (owner === 'human' && this.lastIntentOwnerSeen === 'ai') this.aiController.reset();
    this.lastIntentOwnerSeen = owner;
    if (owner === 'ai') {
      const decision = this.aiController.decide(this.world.intentView());
      this.control.noteAiDecision(decision, this.world.clock);
      return decision.intent;
    }
    const interact = this._interactQueued;
    this._interactQueued = false;
    return intentFromHumanInput({
      up: this.input.up, down: this.input.down, left: this.input.left, right: this.input.right,
      dash: !!(this.cursors && this.cursors.space && this.cursors.space.isDown),
      fire: this._fireHeld,
      interact,
      aim: null
    });
  }

  /** Human input wins immediately and disables the local demo (safe takeover). */
  private detectHumanTakeover(): void {
    if (this.control.owner !== 'ai') return;
    const active = this.input.up || this.input.down || this.input.left || this.input.right ||
      this._fireHeld || this._interactQueued ||
      !!(this.cursors && this.cursors.space && this.cursors.space.isDown);
    if (active) {
      this.control.humanTakeover('human-input');
      this.aiController.reset();
    }
  }

  /** Dev/interaction adapter used by the F key: queued and executed in applyIntent. */
  requestInteract(): void { this._interactQueued = true; }

  /** Drop residual held input on pause / resume / death / scene exit. */
  clearHeldInput(): void {
    this.input.up = this.input.down = this.input.left = this.input.right = false;
    this._fireHeld = false;
    this._interactQueued = false;
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

  private tryFire(fireHeld: boolean): void {
    if (!fireHeld || !this.alive) return;
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
    // C1: weapon spec comes from the single pure builder (real WEAPONS config).
    const spec = buildWeaponSpec({
      weapon: w,
      damageMultiplier: this.data.damage,
      critChance: this.data.critChance,
      critDamage: this.data.critDamage,
      pierceCount: this.data.pierceCount,
      magazine: ws.magazine,
      pixelToTile: GAME.PIXEL_TO_TILE
    });
    this.lastWeaponSpec = spec;
    this.world.spawnProjectile(0, this.x, this.y, this.aimYaw, spec, 'player');
    if (this.whaleEffects) {
      const aim = this.world.worldToScreen(this.x + Math.cos(this.aimYaw), this.y + Math.sin(this.aimYaw));
      this.whaleEffects.fire(aim.x - this.sprite.x, aim.y - this.sprite.y);
    }
    audio.shoot(w.kind);
  }

  // external fire flag, set by scene on mousedown
  private _fireHeld = false;
  fireHeld(): boolean { return this._fireHeld; }
  setFireHeld(v: boolean): void { this._fireHeld = v; }

  hurt(amount: number, fromX: number, fromY: number): boolean {
    if (this.invuln > 0 || !this.alive) return false;
    const dmg = damageAfterArmor(amount, this.data.armor);
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
