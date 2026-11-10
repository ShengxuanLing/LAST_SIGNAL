// Versioned local persistence with safe defaults and validation.
// Never silently destroys existing valid save data; recovers from invalid/outdated saves.
import { SaveData, SAVE_VERSION, DEFAULT_SETTINGS } from '../config/game';

const STORAGE_KEY = 'last_signal_save_v1';

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
      runs: 0, bossesDefeated: 0, bestSeed: 0
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
  if (typeof data.version !== 'number') return false;

  const p = data.permanent;
  if (!p || typeof p !== 'object') return false;
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

  const st = data.stats;
  if (!st || typeof st !== 'object') return false;
  for (const k of STATS_NUMBERS) {
    if (typeof (st as any)[k] !== 'number') return false;
  }
  return true;
}

export class SaveSystem {
  private useStorage: () => Storage | null;

  constructor(opts: { useStorage?: () => Storage | null } = {}) {
    this.useStorage = opts.useStorage ?? (() => {
      try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
    });
  }

  canPersist(): boolean {
    return !!this.useStorage();
  }

  load(): SaveData {
    const store = this.useStorage();
    if (!store) return emptySave();
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { raw = null; }
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
    return parsed as SaveData;
  }

  private _upgrade(parsed: any): SaveData {
    const base = emptySave();
    const p = parsed?.permanent ?? {};
    const s = parsed?.settings ?? {};
    const st = parsed?.stats ?? {};
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
    base.stats.enemiesKilled = typeof st.enemiesKilled === 'number' ? st.enemiesKilled : base.stats.enemiesKilled;
    base.stats.itemsCollected = typeof st.itemsCollected === 'number' ? st.itemsCollected : base.stats.itemsCollected;
    base.stats.damageDealt = typeof st.damageDealt === 'number' ? st.damageDealt : base.stats.damageDealt;
    base.stats.playTimeSeconds = typeof st.playTimeSeconds === 'number' ? st.playTimeSeconds : base.stats.playTimeSeconds;
    base.createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString();
    return base;
  }

  save(data: SaveData): boolean {
    const store = this.useStorage();
    if (!store) return false;
    data.updatedAt = new Date().toISOString();
    // Validate before writing; do not overwrite a valid file with a broken one.
    if (!validate(data)) return false;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch {
      // Storage full or unavailable — failure is non-fatal to gameplay.
      return false;
    }
  }

  clear(): void {
    const store = this.useStorage();
    if (!store) return;
    try { store.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

export const saveSystem = new SaveSystem();
