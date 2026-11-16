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
  /**
   * LOCAL room barrier (no network): bumped synchronously at the committed room
   * boundary, so a suggestion from the previous room is dead for this renderer
   * even while the async /companion-room notification is still in flight.
   */
  #roomId: number | null = null;
  #roomGeneration = 0;
  #roomTick = -1;
  /** Any authority change (authorize / re-authorize / disconnect / room) bumps this. */
  #lifecycle = 0;
  /** Generation/room of the LAST decision this renderer actually applied. */
  #lastApplyGeneration = -1;
  #lastApplyRoomId: number | null = null;

  constructor(private readonly config: CompanionLinkConfig) {
    this.#cap = config.ownerCap;
    this.#heartbeatIntervalMs = config.heartbeatIntervalMs ?? 1000;
  }

  get status(): CompanionLinkState { return this.#state; }
  get error(): string { return this.#lastError; }
  get session(): string { return this.config.session; }
  get epoch(): number { return this.config.epoch; }
  get roomId(): number | null { return this.#roomId; }
  get roomGeneration(): number { return this.#roomGeneration; }
  /** Execution generation of the last applied decision (truth for receipts). */
  get lastApplyGeneration(): number { return this.#lastApplyGeneration; }
  get lastApplyRoomId(): number | null { return this.#lastApplyRoomId; }

  /**
   * SYNCHRONOUS room barrier. Called by the renderer at the committed room
   * boundary BEFORE any HTTP, so the local Owner path can never consume a
   * previous-room proposal during the notification's flight time.
   */
  enterRoom(roomId: number, tick: number): void {
    if (this.#roomId === roomId) {
      if (tick > this.#roomTick) this.#roomTick = tick;
      return;
    }
    this.#roomId = roomId;
    this.#roomGeneration += 1;
    this.#roomTick = Math.max(this.#roomTick, tick);
    this.#lifecycle += 1;
  }

  /** Captured authority; every await must re-validate against it. */
  #capture(): { session: string; epoch: number; roomId: number | null; generation: number; lifecycle: number } {
    return {
      session: this.config.session, epoch: this.config.epoch,
      roomId: this.#roomId, generation: this.#roomGeneration, lifecycle: this.#lifecycle
    };
  }

  #sameAuthority(c: { session: string; epoch: number; roomId: number | null; generation: number; lifecycle: number }): boolean {
    return this.#state === 'CONNECTED' && !!this.#cap
      && c.session === this.config.session && c.epoch === this.config.epoch
      && c.roomId === this.#roomId && c.generation === this.#roomGeneration
      && c.lifecycle === this.#lifecycle;
  }

  /** A proposal is only consumable in the room/generation it was made in. */
  #inCurrentRoom(suggestion: { roomId?: number | null }): boolean {
    if (this.#roomId === null) return true;
    const room = suggestion?.roomId;
    if (room === undefined || room === null) return true;
    return room === this.#roomId;
  }

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
    this.#lifecycle += 1;
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
    this.#lifecycle += 1;
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
    const captured = this.#capture();
    try {
      const r = await this.post('/world-link/companion-room', {
        session: this.config.session, epoch: this.config.epoch, roomId, tick,
        // Monotonic room commit sequence: a delayed report can never roll back.
        roomSeq: this.#roomGeneration
      });
      // A response that arrives after another transition speaks for a dead room.
      return this.#sameAuthority(captured) && r?.ok === true;
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
    const captured = this.#capture();
    const stamped = this.#roomId === null
      ? observation
      : { ...(observation as Record<string, unknown>), roomId: this.#roomId };
    this.#inFlight = true;
    try {
      await this.post('/world-link/companion-observation', {
        session: this.config.session, epoch: this.config.epoch, observation: stamped
      });
    } finally { this.#inFlight = false; }
    void captured; // the gateway rejects observations whose roomId is stale
  }

  async pending(): Promise<readonly CompanionSuggestion[]> {
    if (this.#state !== 'CONNECTED') return [];
    const captured = this.#capture();
    const r = await this.get(`/world-link/companion-suggestions?session=${this.config.session}&epoch=${this.config.epoch}`);
    if (!this.#sameAuthority(captured)) return []; // never surface work from a left room
    if (!r.ok) return [];
    return (r.value as CompanionSuggestion[]).filter((s) => this.#inCurrentRoom(s as { roomId?: number | null }));
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
    // 1) LOCAL BARRIER, before any network: a proposal from a previous room is
    //    dead here immediately, even while the cancel notification is in flight.
    if (!this.#inCurrentRoom(suggestion as { roomId?: number | null })) {
      this.#lastError = 'E_STALE_GENERATION companion.suggestion_room_changed';
      return false;
    }
    const captured = this.#capture();
    const tick = this.config.appliedTick();
    const r = await this.post('/world-link/companion-decision', {
      session: this.config.session, epoch: this.config.epoch,
      suggestionId: suggestion.suggestionId, decision, tick
    });
    // 2) After EVERY await: the authority captured before the request must still
    //    be the live one. A room/epoch/lifecycle change makes this response
    //    unusable: never apply, never enqueue.
    if (!this.#sameAuthority(captured)) {
      this.#lastError = 'E_STALE_GENERATION companion.suggestion_room_changed';
      return false;
    }
    if (!r.ok) { this.#lastError = `${r.code} ${r.messageKey}`; return false; }
    if (decision === 'reject') return true;
    if (!this.#sameAuthority(captured)) {
      this.#lastError = 'E_STALE_GENERATION companion.suggestion_room_changed';
      return false;
    }
    const applyGeneration = captured.generation;
    if (!this.config.apply(suggestion.kind, suggestion.target ?? undefined, suggestion.suggestionId)) {
      this.#lastError = 'E_PERMISSION companion.action_not_applicable';
      return false;
    }
    // Truth for the later receipt: this execution happened in THAT generation.
    this.#lastApplyGeneration = applyGeneration;
    this.#lastApplyRoomId = captured.roomId;
    // Receipt is posted by the Scene AFTER the core tick actually commits it.
    return true;
  }

  /** Post the post-commit receipt once the core consumed the confirmed intent. */
  async postApplied(
    suggestionId: string, appliedTick: number,
    execution?: { generation: number; roomId: number | null }
  ): Promise<boolean> {
    if (this.#state !== 'CONNECTED' || !this.#cap) return false;
    const receipt = await this.post('/world-link/companion-applied', {
      session: this.config.session, suggestionId, appliedTick,
      ...(execution ? { generation: execution.generation, ...(execution.roomId !== null ? { roomId: execution.roomId } : {}) } : {})
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
    this.#lifecycle += 1;
    if (this.#state === 'OFF') return;
    void this.post('/world-link/companion-disconnect', { session: this.config.session });
    this.#cap = '';
    this.#state = 'FALLBACK:NO_MODEL';
  }
}
