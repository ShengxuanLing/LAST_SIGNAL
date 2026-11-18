// Versioned local persistence with safe defaults and validation.
// Never silently destroys existing valid save data; recovers from invalid/outdated saves.
import { SAVE_KEY, SAVE_VERSION, DEFAULT_SETTINGS } from '../config/game';
import { WEAPON_LIST } from '../config/weapons';
import { AVATARS, type Avatar, type RunCheckpoint, type SaveData } from '../types';
import { validateCheckpoint } from './RunCheckpoint';

export const PERMANENT_TALENTS = [
  { key: 'maxHpBonus', label: 'VITALITY', effect: '+20% BASE HP' },
  { key: 'damageBonus', label: 'POWER', effect: '+10% BASE DAMAGE' },
  { key: 'armorBonus', label: 'ARMOR', effect: '+1 ARMOR' }
] as const;
export const PERMANENT_TALENT_CAP = 5;
type PermanentTalent = typeof PERMANENT_TALENTS[number]['key'];

function emptySave(): SaveData {
  const now = new Date().toISOString();
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    permanent: {
      maxHpBonus: 0, speedBonus: 0, damageBonus: 0, critChanceBonus: 0,
      armorBonus: 0, xpBonus: 0, currencyBonus: 0,
      unlockedWeapons: ['pulse'], unlockedAbilities: [],
      cores: 0, runs: 0, bossesDefeated: 0, bestSeed: 0
    },
    settings: { ...DEFAULT_SETTINGS },
    stats: { enemiesKilled: 0, itemsCollected: 0, damageDealt: 0, playTimeSeconds: 0 }
  };
}

const PERMANENT_NUMBERS = [
  'maxHpBonus', 'speedBonus', 'damageBonus', 'critChanceBonus',
  'armorBonus', 'xpBonus', 'currencyBonus', 'runs', 'bossesDefeated', 'bestSeed'
] as const;
const SETTINGS_NUMBERS = ['masterVolume', 'sfxVolume', 'mouseDpi'] as const;
const STATS_NUMBERS = ['enemiesKilled', 'itemsCollected', 'damageDealt', 'playTimeSeconds'] as const;

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validSetting(key: typeof SETTINGS_NUMBERS[number], value: unknown): value is number {
  return nonnegative(value) && (key === 'mouseDpi' ? value > 0 : value <= 1);
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isAvatar(value: unknown): value is Avatar {
  return AVATARS.some((avatar) => avatar === value);
}

export function validate(data: any): data is SaveData {
  if (!data || typeof data !== 'object') return false;
  if (data.version !== SAVE_VERSION) return false;

  const p = data.permanent;
  if (!p || typeof p !== 'object' || !Number.isSafeInteger(p.cores) || p.cores < 0) return false;
  for (const k of PERMANENT_NUMBERS) {
    if (!nonnegative(p[k])) return false;
  }
  if (!stringList(p.unlockedWeapons) || !stringList(p.unlockedAbilities)) return false;

  const s = data.settings;
  if (!s || typeof s !== 'object') return false;
  for (const k of SETTINGS_NUMBERS) {
    if (!validSetting(k, s[k])) return false;
  }
  if (typeof s.fullscreen !== 'boolean' || typeof s.screenShake !== 'boolean') return false;
  if (s.avatar !== undefined && !isAvatar(s.avatar)) return false;

  const st = data.stats;
  if (!st || typeof st !== 'object') return false;
  for (const k of STATS_NUMBERS) {
    if (!nonnegative(st[k])) return false;
  }
  return true;
}

export class SaveSystem {
  private useStorage: () => Storage | null;
  // In-memory settings cache so per-frame callers (HUD) don't re-parse the full
  // localStorage blob (which includes the run checkpoint) every frame.
  private settingsCache: SaveData['settings'] | null = null;

  constructor(opts: { useStorage?: () => Storage | null } = {}) {
    this.useStorage = opts.useStorage ?? (() => {
      try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
    });
  }

  canPersist(): boolean {
    return !!this.useStorage();
  }

  load(): SaveData {
    const result = this._load() ?? emptySave();
    this.settingsCache = { ...result.settings };
    return result;
  }

  private _load(): SaveData | null {
    const store = this.useStorage();
    if (!store) return null;
    let raw: string | null = null;
    try { raw = store.getItem(SAVE_KEY); } catch { return null; }
    if (!raw) return emptySave();
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch {
      // Corrupt JSON: keep the existing save, return defaults for this session.
      return emptySave();
    }
    if (!validate(parsed)) {
      // Outdated / invalid structure: upgrade with existing numeric values where present.
      return this._upgrade(parsed);
    }
    if (parsed.run !== undefined && !validateCheckpoint(parsed.run)) delete parsed.run;
    return parsed;
  }

  private _upgrade(parsed: any): SaveData {
    const base = emptySave();
    const p = parsed?.permanent ?? {};
    const s = parsed?.settings ?? {};
    const st = parsed?.stats ?? {};
    base.permanent.cores = Number.isSafeInteger(p.cores) && p.cores >= 0 ? p.cores : 0;
    for (const key of PERMANENT_NUMBERS) {
      if (nonnegative(p[key])) base.permanent[key] = p[key];
    }
    for (const key of ['unlockedWeapons', 'unlockedAbilities'] as const) {
      if (Array.isArray(p[key])) base.permanent[key] = p[key].filter((item: unknown) => typeof item === 'string');
    }
    for (const key of SETTINGS_NUMBERS) {
      if (validSetting(key, s[key])) base.settings[key] = s[key];
    }
    base.settings.fullscreen = typeof s.fullscreen === 'boolean' ? s.fullscreen : base.settings.fullscreen;
    base.settings.screenShake = typeof s.screenShake === 'boolean' ? s.screenShake : base.settings.screenShake;
    if (isAvatar(s.avatar)) base.settings.avatar = s.avatar;
    for (const key of STATS_NUMBERS) {
      if (nonnegative(st[key])) base.stats[key] = st[key];
    }
    // A run checkpoint is independent of the save's version/schema. If the save
    // was outdated/invalid but the embedded run still validates, keep it so a
    // version bump never silently destroys an in-progress run.
    if (parsed?.run !== undefined && validateCheckpoint(parsed.run)) {
      base.run = parsed.run;
    }
    base.createdAt = typeof parsed?.createdAt === 'string' ? parsed.createdAt : base.createdAt;
    return base;
  }

  save(data: SaveData): boolean {
    const store = this.useStorage();
    if (!store) return false;
    data.updatedAt = new Date().toISOString();
    // Validate before writing; do not overwrite a valid file with a broken one.
    if (!validate(data) || (data.run !== undefined && !validateCheckpoint(data.run))) return false;
    try {
      store.setItem(SAVE_KEY, JSON.stringify(data));
      this.settingsCache = { ...data.settings };
      return true;
    } catch {
      // Storage full or unavailable — failure is non-fatal to gameplay.
      return false;
    }
  }

  /** Cached read of settings; avoids re-parsing localStorage (incl. the run) each frame. */
  getSettings(): SaveData['settings'] {
    return this.settingsCache ?? this.load().settings;
  }

  /** Force a re-read of settings from storage (call after a settings change has been saved). */
  refreshSettings(): void {
    this.load();
  }

  updateSettings(changes: Partial<SaveData['settings']>): boolean {
    const save = this._load();
    if (!save) return false;
    Object.assign(save.settings, changes);
    return this.save(save);
  }

  writeCheckpoint(run: RunCheckpoint, expectedId: string | null | undefined): boolean {
    const save = this._load();
    if (!save) return false;
    // Contract:
    //  - expectedId === undefined  -> replace ANY existing on-disk run (new run / first write).
    //  - expectedId === null       -> only create a checkpoint if the slot is still empty.
    //  - expectedId is a string     -> only write when save.run?.id === expectedId
    //                                 (guards against writing over a different active run).
    if (expectedId !== undefined && (save.run?.id ?? null) !== expectedId) return false;
    save.run = run;
    return this.save(save);
  }

  finishRun(id: string, won: boolean, seed: number, stats: RunCheckpoint['stats']): boolean {
    const save = this._load();
    if (!save || save.run?.id !== id) return false;
    delete save.run;
    save.permanent.runs += 1;
    save.stats.enemiesKilled += stats.kills;
    save.stats.itemsCollected += stats.items;
    save.stats.damageDealt += stats.damage;
    save.stats.playTimeSeconds += stats.elapsedSeconds;
    if (won) {
      save.permanent.cores += 1;
      save.permanent.bossesDefeated += 1;
      save.permanent.bestSeed = Math.max(save.permanent.bestSeed, seed);
      save.permanent.unlockedWeapons = [...new Set([...save.permanent.unlockedWeapons, ...WEAPON_LIST.map((weapon) => weapon.key)])];
    }
    return this.save(save);
  }

  buyTalent(key: PermanentTalent): boolean {
    const save = this._load();
    if (!save || save.permanent.cores < 1 || save.permanent[key] >= PERMANENT_TALENT_CAP) return false;
    save.permanent.cores -= 1;
    save.permanent[key] += 1;
    return this.save(save);
  }

  discardCheckpoint(id: string): void {
    const save = this._load();
    if (!save || save.run?.id !== id) return;
    delete save.run;
    this.save(save);
  }

  clear(): void {
    const store = this.useStorage();
    if (!store) return;
    try {
      store.removeItem(SAVE_KEY);
      this.settingsCache = null;
    } catch { /* Storage may be unavailable. */ }
  }
}

export const saveSystem = new SaveSystem();
