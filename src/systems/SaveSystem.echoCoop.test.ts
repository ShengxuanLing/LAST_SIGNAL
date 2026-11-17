import { describe, expect, it } from 'vitest';
import { SAVE_KEY } from '../config/game';
import { SaveSystem, validate } from './SaveSystem';

function memoryStorage(): { store: Storage } {
  const map = new Map<string, string>();
  const store: Storage = {
    get length() { return map.size; },
    clear: () => { map.clear(); },
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, v); }
  };
  return { store };
}

// P2: the low-risk cooperation switch is an explicit human preference.
// Legacy/old saves without the field must stay OFF (not consented).
describe('P2 echoCooperationOptIn persistence', () => {
  it('a legacy save without the field loads as OFF', () => {
    const { store } = memoryStorage();
    const system = new SaveSystem({ useStorage: () => store });
    const data = system.load();
    delete (data.permanent as { echoCooperationOptIn?: boolean }).echoCooperationOptIn;
    expect(validate(data)).toBe(true);
    store.setItem(SAVE_KEY, JSON.stringify(data));
    const loaded = system.load();
    expect(loaded.permanent.echoCooperationOptIn ?? false).toBe(false);
    expect(loaded.permanent.echoCooperationOptIn).not.toBe(true);
  });

  it('a malformed value is rejected by validation and upgraded to OFF', () => {
    const { store } = memoryStorage();
    const system = new SaveSystem({ useStorage: () => store });
    const data = system.load();
    (data.permanent as unknown as { echoCooperationOptIn: unknown }).echoCooperationOptIn = 'yes';
    store.setItem(SAVE_KEY, JSON.stringify(data));
    expect(validate(data)).toBe(false);
    const loaded = system.load();
    expect(loaded.permanent.echoCooperationOptIn).toBe(false);
  });

  it('an explicit ON persists across load; OFF persists too', () => {
    const { store } = memoryStorage();
    const system = new SaveSystem({ useStorage: () => store });
    const data = system.load();
    data.permanent.echoCooperationOptIn = true;
    expect(system.save(data)).toBe(true);
    expect(system.load().permanent.echoCooperationOptIn).toBe(true);
    const again = system.load();
    again.permanent.echoCooperationOptIn = false;
    expect(system.save(again)).toBe(true);
    expect(system.load().permanent.echoCooperationOptIn).toBe(false);
  });
});
