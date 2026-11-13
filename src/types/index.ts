// Shared domain types for LAST SIGNAL.
export type Vec2 = { x: number; y: number };

export type Direction =
  | 'up' | 'down' | 'left' | 'right'
  | 'up-left' | 'up-right' | 'down-left' | 'down-right';

export interface HealthComponent { max: number; current: number; }

export interface EntityBase {
  id: number; pos: Vec2; vel: Vec2; radius: number; alive: boolean;
}

export interface Stats {
  maxHp: number; hp: number; speed: number; armor: number; damage: number;
  critChance: number; critDamage: number; xpGain: number; pickupRange: number;
  dashCooldown: number; dashDuration: number; aimYaw: number;
  cooldownReduced: number; pierceCount: number; hpRegen: number;
}

export interface PlayerData extends Stats {
  level: number; xp: number; xpToNext: number; currency: number;
  weaponKey: string; weapons: WeaponState[]; upgrades: UpgradeProgress[];
  abilities: string[];
}

export interface WeaponState {
  key: string; level: number; ammo: number; magazine: number; reloading: boolean; reloadTimer: number;
}

export type WeaponKind = 'pulse' | 'scatter' | 'plasma' | 'arc';

export interface WeaponDef {
  key: string; kind: WeaponKind; name: string; description: string;
  baseDamage: number; baseRate: number; baseSpread: number;
  baseProjectileSpeed: number; baseRange: number; magazine?: number; reloadTime?: number;
  critBase: number; icon: string;
  levelDamage: (lvl: number) => number;
  levelRate: (lvl: number) => number;
  levelRange: (lvl: number) => number;
}

export type EnemyKind = 'drone' | 'stalker' | 'sentinel' | 'hunter' | 'boss_warden' | 'sentry' | 'shiver' | 'slag';

export type EnemyStateName =
  | 'idle' | 'patrol' | 'detect' | 'chase' | 'attack' | 'reposition' | 'stun' | 'dead';

export interface EnemyStats {
  maxHp: number; speed: number; damage: number; armor: number;
  aggroRange: number; attackRange: number; attackCooldown: number;
  xpValue: number; currencyValue: number; reachEnemy: boolean; ranged: boolean;
}

export interface EnemyData {
  kind: EnemyKind; stats: EnemyStats; state: EnemyStateName; stateTimer: number;
  targetId: number | null; patrolPoints: Vec2[]; patrolIndex: number;
  hitFlash: number; stunTimer: number; spawnRoom: number;
}

export type TileType = 'floor' | 'wall' | 'debris' | 'lava' | 'water' | 'spawn';

export interface Tile { x: number; y: number; type: TileType; height: number; }

export type RoomKind =
  | 'start' | 'combat' | 'resource' | 'elite' | 'shop' | 'event' | 'boss' | 'extraction';

export interface Room {
  id: number; kind: RoomKind; gx: number; gy: number; w: number; h: number;
  connectedTo: number[]; cleared: boolean; spawned: boolean;
}

export interface MapData {
  seed: number; width: number; height: number;
  tiles: Tile[][]; rooms: Room[]; doorways: Vec2[]; roomsOrder: number[];
  deck?: number;
}

export type ItemKind = 'health' | 'currency' | 'upgrade' | 'weapon' | 'ability' | 'restore';

export interface LootDrop {
  x: number; y: number; kind: ItemKind; key: string; amount: number; bob: number;
}

export interface ItemDef {
  key: string; kind: ItemKind; name: string; description: string; rarity: number;
}

export interface UpgradeDef {
  key: string; name: string; description: string; maxLevel: number;
  apply: (state: PlayerData, lvl: number) => void; weight: number;
}

export interface UpgradeProgress { key: string; level: number; }

export interface HudData { show: boolean; fps: number; roomIndex: number; roomTotal: number; }

export interface RunCheckpoint {
  id: string;
  seed: number;
  deck?: number;
  roomId: number;
  position: Vec2;
  clearedRooms: number[];
  portalTarget: number | null;
  rngState: number;
  player: PlayerData;
  loot: LootDrop[];
  stats: { kills: number; items: number; damage: number; elapsedSeconds: number; };
}

export interface SaveData {
  version: number; createdAt: string; updatedAt: string;
  permanent: {
    maxHpBonus: number; speedBonus: number; damageBonus: number; critChanceBonus: number;
    armorBonus: number; xpBonus: number; currencyBonus: number;
    unlockedWeapons: string[]; unlockedAbilities: string[];
    cores: number; runs: number; bossesDefeated: number; bestSeed: number;
  };
  settings: {
    masterVolume: number; sfxVolume: number; mouseDpi: number;
    fullscreen: boolean; screenShake: boolean;
    avatar?: 'operator' | 'whale';
  };
  stats: { enemiesKilled: number; itemsCollected: number; damageDealt: number; playTimeSeconds: number; };
  run?: RunCheckpoint;
}

export const SAVE_VERSION = 2;

export interface ProjectileData {
  id: number; ownerId: number; side: 'player' | 'enemy';
  pos: Vec2; vel: Vec2; damage: number; lifetime: number; radius: number;
  crit: boolean; pierce: number; hitSet: Set<number>;
}

export interface HitFx {
  x: number; y: number; text?: string; color: number; life: number; vy: number;
}

export type GameEventType =
  | 'enemy-spawned' | 'enemy-dead' | 'player-hit' | 'player-healed' | 'player-levelup'
  | 'player-death' | 'loot-dropped' | 'loot-collected' | 'weapon-switched' | 'room-cleared'
  | 'room-entered' | 'boss-activated' | 'boss-phase-change' | 'game-paused' | 'game-resumed';

export interface GameEvent { type: GameEventType; payload: any; tick: number; }
