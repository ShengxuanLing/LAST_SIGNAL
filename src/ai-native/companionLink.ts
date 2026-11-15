// AI-NATIVE-02 P3-b A/B — browser-side Companion link (OWNER capability holder).
//
// The bridge-issued Owner session capability lives ONLY in ECMAScript #private
// fields here. It is never sent to the agent, never logged, never part of a
// URL, and cannot be read by JSON.stringify / enumeration / Object.keys.
// The HUMAN pairing key is one-shot: it proves presence at handshake or
// re-authorization and is immediately discarded from this object.
// No Phaser import: the Scene passes plain callbacks.

import { type CompanionSuggestion } from './companionFacet';

export interface CompanionLinkConfig {
  readonly bridgeUrl: string;
  readonly token: string;
  readonly origin: string;
  readonly session: string;
  readonly epoch: number;
  /** Bridge-issued renderer capability from the human handshake. */
  readonly ownerCap: string;
  /** Echo-legal observation from World.echoView(), no hidden fields. */
  readonly observation: () => Record<string, unknown> | null;
  /** Human confirmation enqueues a real core command; returns false if illegal. */
  readonly apply: (kind: string, target?: { x: number; y: number }) => boolean;
  /** Real post-commit tick after the confirmed intent was consumed by core. */
  readonly appliedTick: () => number;
}

export type CompanionLinkState = 'OFF' | 'CONNECTED' | 'FALLBACK:NO_MODEL' | 'READ_ONLY';

export class CompanionLink {
  #cap: string;
  #state: CompanionLinkState = 'OFF';
  #lastError = '';
  #inFlight = false;

  constructor(private readonly config: CompanionLinkConfig) {
    this.#cap = config.ownerCap;
  }

  get status(): CompanionLinkState { return this.#state; }
  get error(): string { return this.#lastError; }
  get session(): string { return this.config.session; }

  /** No enumerable secrets even under dev diagnostics / JSON.stringify. */
  toJSON(): Record<string, never> { return {}; }

  private async post(path: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${this.config.bridgeUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.token}`,
        origin: this.config.origin
      },
      body: JSON.stringify({ ...body, ownerCap: this.#cap })
    });
    return res.json();
  }
  private async get(path: string): Promise<any> {
    const separator = path.includes('?') ? '&' : '?';
    const res = await fetch(`${this.config.bridgeUrl}${path}${separator}ownerCap=${encodeURIComponent(this.#cap)}`, {
      headers: { authorization: `Bearer ${this.config.token}`, origin: this.config.origin }
    });
    return res.json();
  }

  /**
   * HUMAN authorize / re-authorize (Pause menu). Registration needs the
   * bridge-issued capability; re-authorization additionally requires the host
   * pairing key and atomically swaps the capability.
   */
  async authorize(ownerMode: 'human' | 'ai' | 'external' = 'human', ownerKey = ''): Promise<boolean> {
    const reauthorize = ownerKey.length > 0;
    const r = await this.post('/world-link/companion-authorize', {
      session: this.config.session, epoch: this.config.epoch,
      ownerMode, ...(reauthorize ? { reauthorize: true, ownerKey } : {})
    });
    if (!r.ok) {
      this.#lastError = `${r.code ?? 'E_PERMISSION'} ${r.messageKey ?? ''}`;
      this.#state = 'FALLBACK:NO_MODEL';
      this.#cap = '';
      return false;
    }
    if (typeof r.ownerCap === 'string') this.#cap = r.ownerCap;
    this.#state = ownerMode === 'human' ? 'CONNECTED' : 'READ_ONLY';
    return true;
  }

  /** Called from the real rendered frame: push the echo's own perception. */
  async pushObservation(): Promise<void> {
    if (this.#state !== 'CONNECTED' || this.#inFlight) return;
    const observation = this.config.observation();
    if (!observation) return;
    this.#inFlight = true;
    try {
      await this.post('/world-link/companion-observation', {
        session: this.config.session, epoch: this.config.epoch, observation
      });
    } finally { this.#inFlight = false; }
  }

  async pending(): Promise<readonly CompanionSuggestion[]> {
    if (this.#state !== 'CONNECTED') return [];
    const r = await this.get(`/world-link/companion-suggestions?session=${this.config.session}&epoch=${this.config.epoch}`);
    return r.ok ? (r.value as CompanionSuggestion[]) : [];
  }

  /**
   * Owner CONFIRM/REJECT. The bridge validates the renderer capability, and
   * the shared pure validator enforces enum/epoch/tick/TTL; this object has no
   * raw secret to leak. A receipt is posted only after a real core commit.
   */
  async decide(suggestion: CompanionSuggestion, decision: 'confirm' | 'reject'): Promise<boolean> {
    if (this.#state !== 'CONNECTED' || !this.#cap) {
      this.#lastError = 'E_PERMISSION companion.owner_capability_required';
      return false;
    }
    const r = await this.post('/world-link/companion-decision', {
      session: this.config.session, epoch: this.config.epoch,
      suggestionId: suggestion.suggestionId, decision, tick: suggestion.createdAtTick + 1
    });
    if (!r.ok) { this.#lastError = `${r.code} ${r.messageKey}`; return false; }
    if (decision === 'reject') return true;
    if (!this.config.apply(suggestion.kind, suggestion.target ?? undefined)) {
      this.#lastError = 'E_PERMISSION companion.action_not_applicable';
      return false;
    }
    const appliedTick = this.config.appliedTick();
    const receipt = await this.post('/world-link/companion-applied', {
      session: this.config.session, suggestionId: suggestion.suggestionId, appliedTick
    });
    if (!receipt.ok) { this.#lastError = `${receipt.code} ${receipt.messageKey}`; return false; }
    return true;
  }

  setOwnerMode(ownerMode: 'human' | 'ai' | 'external'): void {
    if (this.#state === 'OFF') return;
    this.#state = ownerMode === 'human' ? 'CONNECTED' : 'READ_ONLY';
    void this.post('/world-link/companion-mode', {
      session: this.config.session, epoch: this.config.epoch, ownerMode
    });
  }

  /** Explicit disconnect: NO_MODEL fallback, never a fake connected state. */
  disconnect(): void {
    if (this.#state === 'OFF') return;
    void this.post('/world-link/companion-disconnect', { session: this.config.session });
    this.#cap = '';
    this.#state = 'FALLBACK:NO_MODEL';
  }
}
