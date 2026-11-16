// AI-NATIVE-02 P3-b A/B — browser-side Companion link (OWNER capability holder).
//
// The bridge-issued Owner session capability lives ONLY in ECMAScript #private
// fields. It never goes in a URL (GET uses the x-owner-cap header; POST uses the
// body), is never logged, and cannot be read by JSON.stringify / enumeration.
// The HUMAN pairing key is one-shot: it proves presence at handshake or
// re-authorization and is immediately discarded. No Phaser import.

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
  readonly apply: (kind: string, target?: { x: number; y: number }, suggestionId?: string) => boolean;
  /** Real post-commit tick after the confirmed intent was consumed by core. */
  readonly appliedTick: () => number;
  /** Renderer gateway-heartbeat interval (well under LOST_AFTER_MS=5s). */
  readonly heartbeatIntervalMs?: number;
}

export type CompanionLinkState = 'OFF' | 'CONNECTED' | 'FALLBACK:NO_MODEL' | 'READ_ONLY';

export class CompanionLink {
  #cap: string;
  #state: CompanionLinkState = 'OFF';
  #lastError = '';
  #inFlight = false;
  #heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  #heartbeatActive = false;
  #heartbeatIntervalMs: number;

  constructor(private readonly config: CompanionLinkConfig) {
    this.#cap = config.ownerCap;
    this.#heartbeatIntervalMs = config.heartbeatIntervalMs ?? 1000;
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
    // Owner capability travels in a dedicated request header, never a URL.
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.token}`,
      origin: this.config.origin
    };
    if (this.#cap) headers['x-owner-cap'] = this.#cap;
    const res = await fetch(`${this.config.bridgeUrl}${path}`, { headers });
    return res.json();
  }

  /** Idempotent: a real renderer gateway heartbeat (POST /world-link/heartbeat)
   *  at a bounded interval renews the RENDERED session so a paused companion
   *  does not expire. It NEVER renews the independent Agent lease. */
  startHeartbeat(): void {
    if (this.#heartbeatActive) return;
    this.#heartbeatActive = true;
    this.#scheduleHeartbeat();
  }
  #scheduleHeartbeat(): void {
    this.#heartbeatTimer = setTimeout(async () => {
      if (!this.#heartbeatActive || this.#state !== 'CONNECTED') { this.#heartbeatActive = false; return; }
      try {
        const r = await this.post('/world-link/heartbeat', {
          session: this.config.session, epoch: this.config.epoch
        });
        if (!r.ok) { this.#setFallback(); return; }
      } catch {
        this.#setFallback();
        return;
      }
      if (this.#heartbeatActive) this.#scheduleHeartbeat();
    }, this.#heartbeatIntervalMs);
  }
  stopHeartbeat(): void {
    this.#heartbeatActive = false;
    if (this.#heartbeatTimer) { clearTimeout(this.#heartbeatTimer); this.#heartbeatTimer = null; }
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

  /**
   * Renderer-only: report a COMMITTED room change so the previous room's
   * proposals (unconfirmed + confirmed-but-unapplied) are retired by a real
   * generation bump. The Agent can never call this: the bridge requires the
   * Owner capability and the game Origin. Returns false when the link is not
   * connected; it never throws and never changes game state.
   */
  async notifyRoom(roomId: number, tick: number): Promise<boolean> {
    if (this.#state !== 'CONNECTED' || !this.#cap) return false;
    try {
      const r = await this.post('/world-link/companion-room', {
        session: this.config.session, epoch: this.config.epoch, roomId, tick
      });
      return r?.ok === true;
    } catch {
      return false;
    }
  }

  /** Push the echo's own committed observation (safe to call immediately after
   *  authorize, without resuming the game tick). */
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
   * Owner CONFIRM/REJECT. The decision tick is the ACTUAL current core tick
   * (config.appliedTick()), never a fabricated createdAtTick+1. Paused and
   * same-as-create is legal (equal); an expired observation is refused by the
   * shared validator. Receipt is posted later by the Scene after the tick.
   */
  async decide(suggestion: CompanionSuggestion, decision: 'confirm' | 'reject'): Promise<boolean> {
    if (this.#state !== 'CONNECTED' || !this.#cap) {
      this.#lastError = 'E_PERMISSION companion.owner_capability_required';
      return false;
    }
    const tick = this.config.appliedTick();
    const r = await this.post('/world-link/companion-decision', {
      session: this.config.session, epoch: this.config.epoch,
      suggestionId: suggestion.suggestionId, decision, tick
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

  /** Post the post-commit receipt once the core consumed the confirmed intent. */
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
