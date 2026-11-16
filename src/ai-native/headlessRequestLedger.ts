// AI-NATIVE-02 C3c fix — bounded request ledger for the headless Player surface.
//
// Guarantees:
//  - a requestId is NEVER re-executed after its response cache entry is evicted
//    (the id is tombstoned and rejected with E_RETRY_AFTER_EVICTION);
//  - the dedup set has a HARD bound: when full, NEW requests are rejected
//    atomically (no advance, no charge), never evicted to make room;
//  - `action` and `step` share ONE requestId namespace, so reusing an id across
//    domains cannot bypass dedup;
//  - the response cache may evict (memory bound) without weakening dedup.

export type RequestDomain = 'action' | 'step';

export type LedgerCheck =
  | { kind: 'new' }
  | { kind: 'same'; response: unknown | undefined }
  | { kind: 'error'; code: 'E_ID_PAYLOAD_MISMATCH' | 'E_RETRY_AFTER_EVICTION'; messageKey: string };

export interface LedgerStats {
  readonly requests: number;
  readonly responses: number;
  readonly evicted: number;
  readonly maxRequests: number;
  readonly maxResponses: number;
}

interface RequestRecord {
  readonly domain: RequestDomain;
  readonly fingerprint: string;
}

export const HEADLESS_REQUEST_LIMITS = Object.freeze({
  MAX_REQUESTS: 256,
  MAX_RESPONSES: 128,
  MAX_EVICTED: 512
});

export class HeadlessRequestLedger {
  private readonly used = new Map<string, RequestRecord>();
  private readonly responses = new Map<string, unknown>();
  private readonly responseOrder: string[] = [];
  private readonly evicted = new Set<string>();
  private readonly evictedOrder: string[] = [];

  constructor(
    private readonly maxRequests: number = HEADLESS_REQUEST_LIMITS.MAX_REQUESTS,
    private readonly maxResponses: number = HEADLESS_REQUEST_LIMITS.MAX_RESPONSES,
    private readonly maxEvicted: number = HEADLESS_REQUEST_LIMITS.MAX_EVICTED
  ) {}

  /** Peek without charging quota. */
  check(requestId: string, domain: RequestDomain, fingerprint: string): LedgerCheck {
    const record = this.used.get(requestId);
    if (!record) {
      if (this.evicted.has(requestId)) {
        return { kind: 'error', code: 'E_RETRY_AFTER_EVICTION', messageKey: 'world.request_evicted' };
      }
      return { kind: 'new' };
    }
    if (record.domain !== domain || record.fingerprint !== fingerprint) {
      return { kind: 'error', code: 'E_ID_PAYLOAD_MISMATCH', messageKey: 'world.request_payload_mismatch' };
    }
    return { kind: 'same', response: this.responses.get(requestId) };
  }

  /** Charge one dedup slot. MUST only be called for a `new` check. */
  reserve(requestId: string, domain: RequestDomain, fingerprint: string): { ok: true } | { ok: false; code: 'E_RESOURCE_LIMIT'; messageKey: string } {
    if (this.used.has(requestId)) return { ok: true };
    if (this.used.size >= this.maxRequests) {
      return { ok: false, code: 'E_RESOURCE_LIMIT', messageKey: 'world.request_quota' };
    }
    this.used.set(requestId, { domain, fingerprint });
    return { ok: true };
  }

  /** Store the replayable response (bounded; eviction tombstones the id). */
  store(requestId: string, response: unknown): void {
    this.responses.set(requestId, response);
    this.responseOrder.push(requestId);
    while (this.responseOrder.length > this.maxResponses) {
      const oldest = this.responseOrder.shift();
      if (oldest === undefined) break;
      if (!this.responses.has(oldest)) continue;
      this.responses.delete(oldest);
      this.tombstone(oldest);
    }
  }

  private tombstone(requestId: string): void {
    if (this.evicted.has(requestId)) return;
    this.evicted.add(requestId);
    this.evictedOrder.push(requestId);
    while (this.evictedOrder.length > this.maxEvicted) {
      const oldest = this.evictedOrder.shift();
      if (oldest !== undefined) this.evicted.delete(oldest);
    }
  }

  /** Epoch rebind / close: a new epoch starts with a clean request namespace. */
  clear(): void {
    this.used.clear();
    this.responses.clear();
    this.responseOrder.length = 0;
    this.evicted.clear();
    this.evictedOrder.length = 0;
  }

  stats(): LedgerStats {
    return {
      requests: this.used.size,
      responses: this.responses.size,
      evicted: this.evicted.size,
      maxRequests: this.maxRequests,
      maxResponses: this.maxResponses
    };
  }
}
