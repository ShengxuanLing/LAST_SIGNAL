// Versioned local persistence with safe defaults and validation.
// Never silently destroys existing valid save data; recovers from invalid/outdated saves.
import { SAVE_KEY, SAVE_VERSION, DEFAULT_SETTINGS } from '../config/game';
import { WEAPON_LIST } from '../config/weapons';
import type { RunCheckpoint, SaveData } from '../types';
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
];
const SETTINGS_NUMBERS = ['masterVolume', 'sfxVolume', 'mouseDpi'];
const STATS_NUMBERS = ['enemiesKilled', 'itemsCollected', 'damageDealt', 'playTimeSeconds'];

export function validate(data: any): data is SaveData {
  if (!data || typeof data !== 'object') return false;
  if (data.version !== SAVE_VERSION) return false;

  const p = data.permanent;
  if (!p || typeof p !== 'object' || !Number.isSafeInteger(p.cores) || p.cores < 0) return false;
  for (const k of PERMANENT_NUMBERS) {
    const v = (p as any)[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  if (!Array.isArray(p.unlockedWeapons) || !Array.isArray(p.unlockedAbilities)) return false;

  const s = data.settings;
  if (!s || typeof s !== 'object') return false;
  for (const k of SETTINGS_NUMBERS) {
    if (typeof (s as any)[k] !== 'number') return false;
  }
  if (typeof s.fullscreen !== 'boolean' || typeof s.screenShake !== 'boolean') return false;
  if (s.avatar !== undefined && s.avatar !== 'operator' && s.avatar !== 'whale') return false;

  const st = data.stats;
  if (!st || typeof st !== 'object') return false;
  for (const k of STATS_NUMBERS) {
    if (typeof (st as any)[k] !== 'number') return false;
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
    const result = this._load();
    this.settingsCache = result.settings;
    return result;
  }

  private _load(): SaveData {
    const store = this.useStorage();
    if (!store) return emptySave();
    let raw: string | null = null;
    try { raw = store.getItem(SAVE_KEY); } catch { raw = null; }
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
    base.permanent.maxHpBonus = typeof p.maxHpBonus === 'number' ? p.maxHpBonus : base.permanent.maxHpBonus;
    base.permanent.speedBonus = typeof p.speedBonus === 'number' ? p.speedBonus : base.permanent.speedBonus;
    base.permanent.damageBonus = typeof p.damageBonus === 'number' ? p.damageBonus : base.permanent.damageBonus;
    base.permanent.critChanceBonus = typeof p.critChanceBonus === 'number' ? p.critChanceBonus : base.permanent.critChanceBonus;
    base.permanent.armorBonus = typeof p.armorBonus === 'number' ? p.armorBonus : base.permanent.armorBonus;
    base.permanent.xpBonus = typeof p.xpBonus === 'number' ? p.xpBonus : base.permanent.xpBonus;
    base.permanent.currencyBonus = typeof p.currencyBonus === 'number' ? p.currencyBonus : base.permanent.currencyBonus;
    base.permanent.unlockedWeapons = Array.isArray(p.unlockedWeapons) ? p.unlockedWeapons : base.permanent.unlockedWeapons;
    base.permanent.unlockedAbilities = Array.isArray(p.unlockedAbilities) ? p.unlockedAbilities : base.permanent.unlockedAbilities;
    base.permanent.runs = typeof p.runs === 'number' ? p.runs : base.permanent.runs;
    base.permanent.bossesDefeated = typeof p.bossesDefeated === 'number' ? p.bossesDefeated : base.permanent.bossesDefeated;
    base.permanent.bestSeed = typeof p.bestSeed === 'number' ? p.bestSeed : base.permanent.bestSeed;
    base.settings.masterVolume = typeof s.masterVolume === 'number' ? s.masterVolume : base.settings.masterVolume;
    base.settings.sfxVolume = typeof s.sfxVolume === 'number' ? s.sfxVolume : base.settings.sfxVolume;
    base.settings.mouseDpi = typeof s.mouseDpi === 'number' ? s.mouseDpi : base.settings.mouseDpi;
    base.settings.fullscreen = typeof s.fullscreen === 'boolean' ? s.fullscreen : base.settings.fullscreen;
    base.settings.screenShake = typeof s.screenShake === 'boolean' ? s.screenShake : base.settings.screenShake;
    if (s.avatar === 'operator' || s.avatar === 'whale') base.settings.avatar = s.avatar;
    base.stats.enemiesKilled = typeof st.enemiesKilled === 'number' ? st.enemiesKilled : base.stats.enemiesKilled;
    base.stats.itemsCollected = typeof st.itemsCollected === 'number' ? st.itemsCollected : base.stats.itemsCollected;
    base.stats.damageDealt = typeof st.damageDealt === 'number' ? st.damageDealt : base.stats.damageDealt;
    base.stats.playTimeSeconds = typeof st.playTimeSeconds === 'number' ? st.playTimeSeconds : base.stats.playTimeSeconds;
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
      this.settingsCache = data.settings;
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
    this.settingsCache = this.load().settings;
  }

  writeCheckpoint(run: RunCheckpoint, expectedId: string | undefined): boolean {
    const save = this.load();
    // Contract:
    //  - expectedId === undefined  -> replace ANY existing on-disk run (new run / first write).
    //  - expectedId is a string     -> only write when save.run?.id === expectedId
    //                                 (guards against writing over a different active run).
    if (expectedId !== undefined && save.run?.id !== expectedId) return false;
    save.run = run;
    return this.save(save);
  }

  finishRun(id: string, won: boolean, seed: number, stats: RunCheckpoint['stats']): boolean {
    const save = this.load();
    if (save.run?.id !== id) return false;
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
    const save = this.load();
    if (save.permanent.cores < 1 || save.permanent[key] >= PERMANENT_TALENT_CAP) return false;
    save.permanent.cores -= 1;
    save.permanent[key] += 1;
    return this.save(save);
  }

  discardCheckpoint(id: string): void {
    const save = this.load();
    if (save.run?.id !== id) return;
    delete save.run;
    this.save(save);
  }

  clear(): void {
    const store = this.useStorage();
    if (!store) return;
    try { store.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }
}

export const saveSystem = new SaveSystem();
