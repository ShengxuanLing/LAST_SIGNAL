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

export interface WeaponFire {
  damage: number; speed: number; critBase: number; critDamage: number;
  critChance: number; pierce: number; lifetime: number; kind: any;
  magazine: number; shots: number; spread: number;
}

export class Player {
  sprite: Phaser.GameObjects.Sprite;
  private _data: PlayerData;
  input: { up: boolean; down: boolean; left: boolean; right: boolean };
  id = 0;
  respawn = false;

  /** Control ownership / pause / takeover state (AI-NATIVE-02 P1). */
  readonly control = new ControlAuthority();
  /** Last intent actually executed this frame (read-only HUD / evidence truth). */
  lastIntent: PlayerIntent = neutralIntent();
  lastIntentOwner: ControlOwner = 'human';
  private aiController = new LocalDeterministicController();
  private lastIntentOwnerSeen: ControlOwner = 'human';
  private _interactQueued = false;
  /** Pending human aim point; committed by the next core tick via intent. */
  private pendingAim: Vec2 | null = null;

  private _wx: number;
  private _wy: number;

  private _fireTimer = 0;
  private _dashTimer = 0;
  private _invuln = 0;
  private _hurtTimer = 0;
  private keys: any = null;
  private cursors: any = null;
  private _aimYaw = 0;
  private whaleEffects?: WhaleCharacterEffects;

  /** C2: read-only frozen snapshot; writes go through World core transactions. */
  get data(): PlayerData { return this.world.hasSimulation ? this.world.playerDataSnapshot : this._data; }
  get wx(): number { return this.world.hasSimulation ? this.world.playerX : this._wx; }
  get wy(): number { return this.world.hasSimulation ? this.world.playerY : this._wy; }
  get fireTimer(): number { return this.world.hasSimulation ? this.world.playerFireTimer : this._fireTimer; }
  get dashTimer(): number { return this.world.hasSimulation ? this.world.playerDashTimer : this._dashTimer; }
  get invuln(): number { return this.world.hasSimulation ? this.world.playerInvuln : this._invuln; }
  get hurtTimer(): number { return this.world.hasSimulation ? this.world.playerHurtTimer : this._hurtTimer; }
  get aimYaw(): number { return this.world.hasSimulation ? this.world.playerAimYaw : this._aimYaw; }

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
    this._data = {
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
    this._aimYaw = 0;
    this._wx = x;
    this._wy = y;
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
  /** C2: visual-only sync after a core tick; no rule state is written here. */
  syncVisual(dt = 0): void {
    const previousX = this.sprite.x;
    const previousY = this.sprite.y;
    this.project();
    this.whaleEffects?.move(dt, this.sprite.x - previousX, this.sprite.y - previousY, this.dashTimer > 0);
    if (this.hurtTimer > 0) this.sprite.setTint(0xff3355);
    else { this.sprite.clearTint(); this.sprite.setAlpha(this.dashTimer > 0 ? 0.7 : 1); }
  }
  get alive(): boolean { return this.data.hp > 0; }
  getRadius(): number { return 0.5; }

  /** If knockback ever leaves the player inside a wall, recover to the nearest walkable cell. */
  private ensureWalkable(): void {
    // Core clamps player movement to walkable cells each tick; no core write here.
    if (!this.world.isWalkable(this.wx, this.wy, this.getRadius())) {
      this.world.enqueueTeleport(this.wx, this.wy, false);
    }
  }

  registerInput(keys: any, cursors: any): void {
    this.keys = keys;
    this.cursors = cursors;
  }

  /** Core command: resets position/HP/invuln; committed at the next core tick.
   *  Position is also set synchronously so immediate readers (e.g. tryInteract)
   *  see the new position before the command commits. */
  reset(x: number, y: number): void {
    this.world.enqueueTeleport(x, y, true);
    this.world.setPlayerPosition(x, y);
    this.project();
  }

  get weapon() { return WEAPONS[this.data.weaponKey] ?? WEAPONS.pulse; }

  equipWeapon(key: string): boolean {
    if (key === this.data.weaponKey || !this.data.weapons.some((weapon) => weapon.key === key)) return false;
    this.world.enqueueEquipWeapon(key);
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
    // Adapter only records the aim point; core commits aimYaw on the next tick.
    this.pendingAim = { x, y };
  }

  private isWalkable(nx: number, ny: number): boolean {
    return this.world.isWalkable(nx, ny, this.getRadius());
  }

  /** C2: sample exactly one intent per rendered frame; core steps it at 60Hz. */
  sampleIntent(): PlayerIntent {
    this.updateKeys();
    this.detectHumanTakeover();
    const intent = this.resolveIntent();
    this.lastIntent = intent;
    this.lastIntentOwner = this.control.owner;
    return intent;
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
    const aim = this.pendingAim;
    this.pendingAim = null;
    return intentFromHumanInput({
      up: this.input.up, down: this.input.down, left: this.input.left, right: this.input.right,
      dash: !!(this.cursors && this.cursors.space && this.cursors.space.isDown),
      fire: this._fireHeld,
      interact,
      aim
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

  /** Dev/interaction adapter used by the F key: queued and executed after a core frame. */
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

  /** Adapter feedback for a core `player-fired` event (no rule execution here). */
  playFireFeedback(kind: string): void {
    if (this.whaleEffects) {
      const aim = this.world.worldToScreen(this.x + Math.cos(this.aimYaw), this.y + Math.sin(this.aimYaw));
      this.whaleEffects.fire(aim.x - this.sprite.x, aim.y - this.sprite.y);
    }
    audio.shoot(kind as any);
  }

  // external fire flag, set by scene on mousedown
  private _fireHeld = false;
  fireHeld(): boolean { return this._fireHeld; }
  setFireHeld(v: boolean): void { this._fireHeld = v; }

  hurt(amount: number, fromX: number, fromY: number): boolean {
    if (!this.alive || this.invuln > 0) return false;
    // B4: never write core player state from the adapter outside a core tick.
    // The World queues the hit; core applies resolvePlayerHit and emits events.
    this.world.enqueuePlayerHit(amount, fromX, fromY);
    return true;
  }

  heal(amount: number): void {
    // Core transaction owns the canonical HP write, committed next tick.
    this.world.enqueueHeal(amount);
  }

  addXp(base: number): void {
    // Core transaction owns XP/level writes and level-up callbacks, committed next tick.
    this.world.addPlayerXpDirectly(base);
  }
}
