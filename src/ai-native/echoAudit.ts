// GAMEPLAY-01 P2 — bounded local echo audit ring.
//
// This is deliberately NOT the echo's perception memory. It records what a
// human-local or external-Owner path requested/executed, with provenance, so an
// agent/owner decision can never pollute the perception memory used by
// EchoController.suggest/decide.

export type EchoAuditProvenance = 'human-local' | 'owner-external';
export type EchoAuditResult = 'enqueued' | 'applied' | 'rejected' | 'cancelled';

export interface EchoAuditEntry {
  tick: number;
  provenance: EchoAuditProvenance;
  action: string;
  target: { x: number; y: number } | null;
  result: EchoAuditResult;
  code?: string;
  /** Ties a human-local receipt/audit row to the exact confirmed proposal. */
  proposalId?: string;
}

export class EchoAuditRing {
  readonly cap: number;
  private entries: EchoAuditEntry[] = [];

  constructor(cap = 32) { this.cap = cap; }

  record(entry: EchoAuditEntry): void {
    this.entries.push({ ...entry, target: entry.target ? { ...entry.target } : null });
    if (this.entries.length > this.cap) this.entries.splice(0, this.entries.length - this.cap);
  }

  recent(count = 8): EchoAuditEntry[] {
    const n = Math.max(0, Math.min(this.cap, Math.floor(count)));
    return this.entries.slice(-n).map((e) => ({ ...e, target: e.target ? { ...e.target } : null }));
  }

  last(): EchoAuditEntry | null {
    const e = this.entries[this.entries.length - 1];
    return e ? { ...e, target: e.target ? { ...e.target } : null } : null;
  }

  reset(): void { this.entries.length = 0; }
}
