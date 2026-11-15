// AI-NATIVE-02 P3-b Owner-auth fix — BROWSER-ONLY pairing secret holder.
//
// The raw human-entered pairing key and the bridge-issued session capability
// live only in ECMAScript #private fields. They are not enumerable, do not
// appear in JSON.stringify, and are cleared on disconnect / failure / teardown.
// No MCP server, agent route, observation DTO or console command can import
// this module's instances: the WeakMap is module-private and keyed by an exact
// object identity supplied by the rendered scene.

const PAIRINGS = new WeakMap<object, OwnerPairing>();

export class OwnerPairing {
  #key: string;
  #cap: string;

  constructor(key: string, cap = '') {
    this.#key = key;
    this.#cap = cap;
  }

  /** One-shot: returns the raw key and clears it from this holder. */
  consumeKey(): string {
    const key = this.#key;
    this.#key = '';
    return key;
  }

  /** The bridge-issued capability is reusable for one authorized session. */
  get cap(): string { return this.#cap; }

  /** Atomically replace the capability (re-authorize) and return the old one. */
  swapCap(next: string): string {
    const previous = this.#cap;
    this.#cap = next;
    return previous;
  }

  clear(): void {
    this.#key = '';
    this.#cap = '';
  }

  /** Defeat dev/diagnostic serialization: no enumerable own properties. */
  toJSON(): Record<string, never> { return {}; }
}

export function stashOwnerPairing(owner: object, key: string): OwnerPairing {
  const pairing = new OwnerPairing(key);
  PAIRINGS.set(owner, pairing);
  return pairing;
}

export function peekOwnerPairing(owner: object): OwnerPairing | null {
  return PAIRINGS.get(owner) ?? null;
}

export function clearOwnerPairing(owner: object): void {
  PAIRINGS.get(owner)?.clear();
  PAIRINGS.delete(owner);
}
