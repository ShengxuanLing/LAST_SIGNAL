// AI-NATIVE-02 C3-b fix — independent AGENT lease registry.
//
// The browser -> bridge heartbeat keeps the RENDERED link alive. It must NOT
// keep the external Agent's authority alive. This registry owns a separate,
// bounded lease per (session, epoch) held by the MCP process:
//  - the MCP client renews it in the background (survives long LLM inference);
//  - a hard SIGKILL cannot run cleanup, so the bridge reaper EXPIRES the lease
//    on a deadline, cancels pending/executing actions, bumps the epoch and
//    makes the rendered game degrade to HUMAN / LOST;
//  - renewing a lease NEVER extends an action's TTL (actions have their own
//    queuedAtMs / applyByTick deadlines in WorldGateway);
//  - a stale/old process carrying an old leaseId can never renew a newer
//    authorization's lease (explicit leaseId + per-session version).

import { randomBytes } from 'node:crypto';
import { WORLD_LIMITS } from './worldProtocol';

export type AgentLeaseStatus = 'live' | 'expired' | 'superseded' | 'released';

export interface AgentLease {
  readonly leaseId: string;
  readonly sessionId: string;
  readonly epoch: number;
  /** Monotonic per-session version; a re-authorization gets a NEW version. */
  readonly version: number;
  readonly createdAtMs: number;
  readonly renewedAtMs: number;
  readonly expiresAtMs: number;
  readonly status: AgentLeaseStatus;
}

export interface AgentLeaseIssue {
  ok: true;
  lease: AgentLease;
  leaseMs: number;
  renewMs: number;
}

export interface AgentLeaseError { ok: false; code: 'E_RESOURCE_LIMIT' | 'E_STALE_EPOCH' | 'E_TIMEOUT' | 'E_SESSION_NOT_FOUND'; messageKey: string; }

export interface AgentLeaseExpiry {
  readonly sessionId: string;
  readonly epoch: number;
  readonly leaseId: string;
}

export class AgentLeaseRegistry {
  private readonly leases = new Map<string, AgentLease>();
  private readonly bySession = new Map<string, string>();
  private readonly versionBySession = new Map<string, number>();
  private readonly expiredSessions = new Set<string>();

  constructor(private readonly leaseMs: number = WORLD_LIMITS.AGENT_LEASE_MS) {}

  /**
   * ONE live lease per session (single Player permission). A second agent
   * attach is refused explicitly, never silently superseded while live.
   */
  issue(sessionId: string, epoch: number, nowMs: number): AgentLeaseIssue | AgentLeaseError {
    const existingId = this.bySession.get(sessionId);
    if (existingId) {
      const existing = this.leases.get(existingId);
      if (existing && existing.status === 'live' && nowMs <= existing.expiresAtMs) {
        return { ok: false, code: 'E_RESOURCE_LIMIT', messageKey: 'world.agent_already_attached' };
      }
      if (existing) this.leases.set(existingId, { ...existing, status: 'expired' });
      this.bySession.delete(sessionId);
    }
    const version = (this.versionBySession.get(sessionId) ?? 0) + 1;
    this.versionBySession.set(sessionId, version);
    this.expiredSessions.delete(sessionId);
    const lease: AgentLease = {
      leaseId: `les_${randomBytes(12).toString('hex')}`,
      sessionId, epoch, version,
      createdAtMs: nowMs, renewedAtMs: nowMs,
      expiresAtMs: nowMs + this.leaseMs,
      status: 'live'
    };
    this.leases.set(lease.leaseId, lease);
    this.bySession.set(sessionId, lease.leaseId);
    return {
      ok: true, lease,
      leaseMs: this.leaseMs,
      renewMs: WORLD_LIMITS.AGENT_RENEW_MS
    };
  }

  /** Explicit lease identity + version. A late heartbeat from an old process
   *  can NEVER renew a new authorization's lease. */
  renew(leaseId: string, sessionId: string, epoch: number, nowMs: number): { ok: true; lease: AgentLease } | AgentLeaseError {
    const lease = this.leases.get(leaseId);
    if (!lease) return { ok: false, code: 'E_SESSION_NOT_FOUND', messageKey: 'world.agent_lease_unknown' };
    if (lease.status !== 'live' || lease.sessionId !== sessionId || lease.epoch !== epoch) {
      return { ok: false, code: 'E_STALE_EPOCH', messageKey: 'world.agent_lease_stale' };
    }
    if (nowMs > lease.expiresAtMs) {
      this.leases.set(leaseId, { ...lease, status: 'expired' });
      return { ok: false, code: 'E_TIMEOUT', messageKey: 'world.agent_lease_expired' };
    }
    const next: AgentLease = { ...lease, renewedAtMs: nowMs, expiresAtMs: nowMs + this.leaseMs };
    this.leases.set(leaseId, next);
    return { ok: true, lease: next };
  }

  /** Soft shutdown (EOF / SIGINT / world_close). */
  release(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;
    this.leases.set(leaseId, { ...lease, status: 'released' });
    if (this.bySession.get(lease.sessionId) === leaseId) this.bySession.delete(lease.sessionId);
    return true;
  }

  status(sessionId: string, leaseId: string, nowMs: number): {
    ok: boolean; status: AgentLeaseStatus | 'unknown'; epoch: number; expiresAtMs: number;
  } {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.sessionId !== sessionId || this.bySession.get(sessionId) !== leaseId) {
      return { ok: false, status: 'unknown', epoch: -1, expiresAtMs: 0 };
    }
    const live = lease.status === 'live' && nowMs <= lease.expiresAtMs && !this.expiredSessions.has(sessionId);
    return { ok: live, status: live ? 'live' : 'expired', epoch: lease.epoch, expiresAtMs: lease.expiresAtMs };
  }

  /** Deadline reaper. Hard-killed clients cannot run cleanup, so this is the
   *  ONLY reliable path for a SIGKILL. Returns the sessions that expired. */
  reap(nowMs: number): AgentLeaseExpiry[] {
    const out: AgentLeaseExpiry[] = [];
    for (const [leaseId, lease] of [...this.leases.entries()]) {
      if (lease.status !== 'live' || nowMs <= lease.expiresAtMs) continue;
      this.leases.set(leaseId, { ...lease, status: 'expired' });
      if (this.bySession.get(lease.sessionId) === leaseId) this.bySession.delete(lease.sessionId);
      this.expiredSessions.add(lease.sessionId);
      out.push({ sessionId: lease.sessionId, epoch: lease.epoch, leaseId });
    }
    return out;
  }

  /** A fresh HUMAN authorization invalidates any old lease immediately. */
  invalidateSession(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id) {
      const lease = this.leases.get(id);
      if (lease) this.leases.set(id, { ...lease, status: 'superseded' });
      this.bySession.delete(sessionId);
    }
    this.expiredSessions.add(sessionId);
  }

  isExpiredSession(sessionId: string): boolean {
    return this.expiredSessions.has(sessionId);
  }

  liveForSession(sessionId: string, nowMs: number): AgentLease | null {
    const id = this.bySession.get(sessionId);
    if (!id) return null;
    const lease = this.leases.get(id);
    return lease && lease.status === 'live' && nowMs <= lease.expiresAtMs ? lease : null;
  }

  dispose(): void {
    this.leases.clear();
    this.bySession.clear();
    this.versionBySession.clear();
    this.expiredSessions.clear();
  }
}
