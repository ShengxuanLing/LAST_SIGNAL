// AI-NATIVE-02 P3-b A — browser-side Companion link (OWNER capability holder).
//
// The owner capability and the random owner secret live ONLY here, inside the
// rendered game. They are never sent to the agent, never logged and never part
// of a URL. The bridge independently verifies sha256(secret) on CONFIRM.
// No Phaser import: the Scene passes plain callbacks.

import { type CompanionSuggestion } from './companionFacet';

/** Browser-only: exact object identities minted by the human UI. */
const OWNER_AUTHORITIES = new WeakSet<object>();
function mintOwnerAuthority(): object {
  const proof = Object.freeze({ kind: 'OWNER' });
  OWNER_AUTHORITIES.add(proof);
  return proof;
}
function isOwnerAuthority(proof: unknown): boolean {
  return typeof proof === 'object' && proof !== null && OWNER_AUTHORITIES.has(proof);
}

export interface CompanionLinkConfig {
  readonly bridgeUrl: string;
  readonly token: string;
  readonly origin: string;
  readonly session: string;
  readonly epoch: number;
  /** Echo-legal observation from World.echoView(), no hidden fields. */
  readonly observation: () => Record<string, unknown> | null;
  /** Human confirmation enqueues a real core command; returns false if illegal. */
  readonly apply: (kind: string, target?: { x: number; y: number }) => boolean;
}

export type CompanionLinkState = 'OFF' | 'CONNECTED' | 'FALLBACK:NO_MODEL' | 'READ_ONLY';

export class CompanionLink {
  private ownerSecret: string | null = null;
  private capability: object | null = null;
  private state: CompanionLinkState = 'OFF';
  private lastError = '';
  private inFlight = false;

  constructor(private readonly config: CompanionLinkConfig) {}

  get status(): CompanionLinkState { return this.state; }
  get error(): string { return this.lastError; }
  get session(): string { return this.config.session; }

  private async post(path: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${this.config.bridgeUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.token}`,
        origin: this.config.origin
      },
      body: JSON.stringify(body)
    });
    return res.json();
  }
  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.config.bridgeUrl}${path}`, {
      headers: { authorization: `Bearer ${this.config.token}`, origin: this.config.origin }
    });
    return res.json();
  }

  private async sha256(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** HUMAN authorize (Pause menu). Creates the browser-only owner capability. */
  async authorize(): Promise<boolean> {
    const secret = [...crypto.getRandomValues(new Uint8Array(24))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const ownerSecretHash = await this.sha256(secret);
    const r = await this.post('/world-link/companion-authorize', {
      session: this.config.session, epoch: this.config.epoch,
      ownerSecretHash, ownerMode: 'human'
    });
    if (!r.ok) { this.lastError = `${r.code ?? 'E_PERMISSION'} ${r.messageKey ?? ''}`; this.state = 'FALLBACK:NO_MODEL'; return false; }
    this.ownerSecret = secret;
    this.capability = mintOwnerAuthority();
    this.state = 'CONNECTED';
    return true;
  }

  /** Called from the real rendered frame: push the echo's own perception. */
  async pushObservation(): Promise<void> {
    if (this.state !== 'CONNECTED' || this.inFlight) return;
    const observation = this.config.observation();
    if (!observation) return;
    this.inFlight = true;
    try {
      await this.post('/world-link/companion-observation', {
        session: this.config.session, epoch: this.config.epoch, observation
      });
    } finally { this.inFlight = false; }
  }

  async pending(): Promise<readonly CompanionSuggestion[]> {
    if (this.state !== 'CONNECTED') return [];
    const r = await this.get(`/world-link/companion-suggestions?session=${this.config.session}&epoch=${this.config.epoch}`);
    return r.ok ? (r.value as CompanionSuggestion[]) : [];
  }

  /**
   * Owner CONFIRM/REJECT. The symbol-based capability is checked locally, and
   * the secret is checked by the bridge. The agent has neither.
   */
  async decide(suggestion: CompanionSuggestion, decision: 'confirm' | 'reject'): Promise<boolean> {
    if (!this.capability || !isOwnerAuthority(this.capability) || !this.ownerSecret) {
      this.lastError = 'E_PERMISSION companion.owner_capability_required';
      return false;
    }
    if (this.state !== 'CONNECTED') return false;
    const r = await this.post('/world-link/companion-decision', {
      session: this.config.session, epoch: this.config.epoch,
      suggestionId: suggestion.suggestionId, decision, tick: suggestion.createdAtTick + 1,
      ownerSecret: this.ownerSecret
    });
    if (!r.ok) { this.lastError = `${r.code} ${r.messageKey}`; return false; }
    if (decision === 'confirm' && !this.config.apply(suggestion.kind, suggestion.target ?? undefined)) {
      return false; // scan/jam not wired until P3-b B
    }
    await this.post('/world-link/companion-applied', {
      session: this.config.session, suggestionId: suggestion.suggestionId,
      ownerSecret: this.ownerSecret
    });
    return true;
  }

  setOwnerMode(ownerMode: 'human' | 'ai' | 'external'): void {
    if (this.state === 'OFF') return;
    this.state = ownerMode === 'human' ? 'CONNECTED' : 'READ_ONLY';
    void this.post('/world-link/companion-mode', {
      session: this.config.session, epoch: this.config.epoch, ownerMode
    });
  }

  /** Explicit disconnect: NO_MODEL fallback, never a fake connected state. */
  disconnect(): void {
    if (this.state === 'OFF') return;
    void this.post('/world-link/companion-disconnect', { session: this.config.session });
    this.ownerSecret = null;
    this.capability = null;
    this.state = 'FALLBACK:NO_MODEL';
  }
}
