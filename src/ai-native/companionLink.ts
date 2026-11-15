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
  /** Human confirmation enqueues a real core command; returns false if illegal.
   *  The receipt is posted LATER by the Scene after the core tick commits it. */
  readonly apply: (kind: string, target?: { x: number; y: number }, suggestionId?: string) => boolean;
  /** Real post-commit tick after the confirmed intent was consumed by core. */
  readonly appliedTick: () => number;
  /** Heartbeat interval in ms (bounded, no unbounded reconnect). */
  readonly heartbeatIntervalMs?: number;
}

export type CompanionLinkState = 'OFF' | 'CONNECTED' | 'FALLBACK:NO_MODEL' | 'READ_ONLY';

export class CompanionLink {
  #cap: string;
  #state: CompanionLinkState = 'OFF';
  #lastError = '';
  #inFlight = false;
  /** Bounded heartbeat: on failure the link degrades to FALLBACK:NO_MODEL. */
  #heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  #heartbeatIntervalMs: number;

  constructor(private readonly config: CompanionLinkConfig) {
    this.#cap = config.ownerCap;
    this.#heartbeatIntervalMs = config.heartbeatIntervalMs ?? 5000;
  }

  get status(): CompanionLinkState { return this.#state; }
  get error(): string { return this.#lastError; }
  get session(): string { return this.config.session; }
  get epoch(): number { return this.config.epoch; }

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
    // Send the capability when present. echo_status / echo_memory ignore it;
    // Owner suggestion reads (companion-suggestions) require it.
    const separator = path.includes('?') ? '&' : '?';
    const cap = this.#cap ? `${separator}ownerCap=${encodeURIComponent(this.#cap)}` : '';
    const res = await fetch(`${this.config.bridgeUrl}${path}${cap}`, {
      headers: { authorization: `Bearer ${this.config.token}`, origin: this.config.origin }
    });
    return res.json();
  }

  /** Start bounded heartbeat: failure degrades to FALLBACK:NO_MODEL. */
  startHeartbeat(): void {
    this.stopHeartbeat();
    this.#heartbeatTimer = setTimeout(async () => {
      try {
        const res = await fetch(`${this.config.bridgeUrl}/world-link/companion-status?session=${this.config.session}&epoch=${this.config.epoch}`, {
          headers: { authorization: `Bearer ${this.config.token}`, origin: this.config.origin }
        });
        if (!res.ok) {
          this.#setFallback();
          return;
        }
        const json = await res.json();
        if (!json.ok || (json.value as any)?.status?.link === 'fallback') {
          this.#setFallback();
          return;
        }
      } catch {
        this.#setFallback();
        return;
      }
      this.#heartbeatTimer = setTimeout(() => this.startHeartbeat(), this.#heartbeatIntervalMs);
    }, this.#heartbeatIntervalMs);
  }

  stopHeartbeat(): void {
    if (this.#heartbeatTimer) {
      clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }

  #setFallback(): void {
    this.stopHeartbeat();
    this.#cap = '';
    this.#state = 'FALLBACK:NO_MODEL';
    this.#lastError = 'E_LINK_UNAVAILABLE companion.link_fallback';
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
    if (ownerMode === 'human') this.startHeartbeat();
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
    if (!this.config.apply(suggestion.kind, suggestion.target ?? undefined, suggestion.suggestionId)) {
      this.#lastError = 'E_PERMISSION companion.action_not_applicable';
      return false;
    }
    // Receipt is posted by the Scene AFTER the core tick actually commits it.
    return true;
  }

  /** Post the post-commit receipt once the core consumed the confirmed intent.
   *  Idempotent on the bridge; called from the rendered frame, never early. */
  async postApplied(suggestionId: string, appliedTick: number): Promise<boolean> {
    if (this.#state !== 'CONNECTED' || !this.#cap) return false;
    const receipt = await this.post('/world-link/companion-applied', {
      session: this.config.session, suggestionId, appliedTick
    });
    return !!receipt.ok;
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
    this.stopHeartbeat();
    if (this.#state === 'OFF') return;
    void this.post('/world-link/companion-disconnect', { session: this.config.session });
    this.#cap = '';
    this.#state = 'FALLBACK:NO_MODEL';
  }
}
