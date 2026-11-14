// AI-NATIVE-02 C3-b — browser-side link client for the rendered world.
//
// This module only SPEAKS the loopback bridge protocol:
//   - handshake after an explicit human authorization,
//   - push the post-commit observation,
//   - heartbeat,
//   - poll for the next external intent and hand it to the World,
//   - ACK the intent with the real post-commit tick.
//
// It never imports the simulation core, never advances ticks, never writes
// scene state and never logs the bridge token.

import {
  WORLD_LIMITS, WORLD_PROTOCOL_VERSION,
  type WorldActionBatchV1, type WorldObservationV1
} from './worldProtocol';

export interface ExternalLinkClientOptions {
  readonly bridgeUrl: string;
  readonly token: string;
  readonly session: string;
  readonly epoch: number;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface ExternalClientObservation {
  readonly schema: string;
  readonly protocolVersion: number;
  readonly epoch: number;
  readonly tick: number;
  readonly roomId: number | null;
  readonly player: { x: number; y: number; hp: number; maxHp: number; aimYaw: number; weaponKey: string; ammo: number; magazine: number };
  readonly drones: ReadonlyArray<{ id: number; kind: string; x: number; y: number; hp: number; state: string }>;
  readonly projectiles: ReadonlyArray<{ id: number; side: 'player' | 'enemy'; kind: string; x: number; y: number; vx: number; vy: number; damage: number; lifetime: number }>;
  readonly availableActions: readonly ('move' | 'stop' | 'aim' | 'fire' | 'interact')[];
}

export interface ExternalNextIntent {
  readonly actionId: string;
  readonly requestId: string;
  readonly applyByTick: number;
  readonly action: {
    readonly type: 'move' | 'stop' | 'aim' | 'fire' | 'interact';
    readonly actionId: string;
    readonly dir?: { x: number; y: number };
    readonly target?: { x: number; y: number };
    readonly ticks?: number;
  };
}

export class ExternalLinkClient {
  private readonly options: Required<Pick<ExternalLinkClientOptions, 'bridgeUrl' | 'token' | 'session' | 'epoch'>> & {
    fetchImpl: typeof fetch;
    timeoutMs: number;
  };
  private closed = false;
  /** All in-flight requests; degrade/dispose aborts them synchronously. */
  private readonly inFlight = new Set<AbortController>();
  /** The bridge owns the session id/epoch; the handshake response replaces the
   *  locally proposed values so every later request uses the real ones. */
  private liveSession: string;
  private liveEpoch: number;

  constructor(options: ExternalLinkClientOptions) {
    this.options = {
      bridgeUrl: options.bridgeUrl.replace(/\/$/, ''),
      token: options.token,
      session: options.session,
      epoch: options.epoch,
      fetchImpl: options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args)),
      timeoutMs: options.timeoutMs ?? 4000
    };
    this.liveSession = options.session;
    this.liveEpoch = options.epoch;
  }

  get session(): string { return this.liveSession; }
  get epoch(): number { return this.liveEpoch; }
  get isClosed(): boolean { return this.closed; }

  /** Abort every in-flight request WITHOUT closing the client, so a yield can
   *  still be sent. Late resolutions are ignored by the caller's generation
   *  check and can never heartbeat / ACK / re-attach in a new epoch. */
  abortInFlight(): void {
    for (const controller of this.inFlight) controller.abort();
    this.inFlight.clear();
  }

  /**
   * Complete the bridge handshake. The bridge requires an explicit
   * `authorized: true` flag, which only the human authorization path sets.
   */
  async handshake(): Promise<{ ok: true; session: string; epoch: number } | { ok: false }> {
    const response = await this.request(`${this.options.bridgeUrl}/world-link/handshake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION })
    });
    if (!response || !response.ok) return { ok: false };
    const payload = (await response.json()) as { ok?: boolean; session?: string; epoch?: number };
    if (!payload || payload.ok !== true || !payload.session || typeof payload.epoch !== 'number') {
      return { ok: false };
    }
    this.liveSession = payload.session;
    this.liveEpoch = payload.epoch;
    return { ok: true, session: payload.session, epoch: payload.epoch };
  }

  /** Push the post-commit observation to the bridge. */
  async pushObservation(observation: ExternalClientObservation): Promise<boolean> {
    const body = { session: this.liveSession, epoch: this.liveEpoch, observation };
    return this.post('/world-link/observation', body);
  }

  async heartbeat(): Promise<boolean> {
    return this.post('/world-link/heartbeat', { session: this.liveSession, epoch: this.liveEpoch });
  }

  /** Fetch the next external intent, if any. */
  async nextIntent(): Promise<ExternalNextIntent | null> {
    const url = `${this.options.bridgeUrl}/world-link/next-action?session=${encodeURIComponent(this.liveSession)}&epoch=${this.liveEpoch}`;
    const response = await this.request(url, { method: 'GET' });
    if (!response || !response.ok) return null;
    const payload = (await response.json()) as { ok?: boolean; action?: ExternalNextIntent | null };
    if (!payload || payload.ok !== true) return null;
    return payload.action ?? null;
  }

  /** ACK an intent with the real post-commit tick. */
  async ackIntent(
    requestId: string,
    actionId: string,
    result: 'applied' | 'rejected',
    appliedTick?: number,
    code?: string
  ): Promise<boolean> {
    const body = {
      session: this.liveSession,
      epoch: this.liveEpoch,
      requestId,
      actionId,
      result,
      ...(result === 'applied' ? { appliedTick } : {}),
      ...(code ? { code } : {})
    };
    return this.post('/world-link/action-ack', body);
  }

  /** Tell the bridge the human took over / the link is done. */
  async yieldLink(reason: string): Promise<boolean> {
    return this.post('/world-link/yield', {
      session: this.liveSession, epoch: this.liveEpoch, reason
    });
  }

  async close(): Promise<boolean> {
    if (this.closed) return true;
    this.closed = true;
    return this.post('/world-link/close', { session: this.liveSession });
  }

  private async post(path: string, body: unknown): Promise<boolean> {
    const response = await this.request(`${this.options.bridgeUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return !!response && response.ok;
  }

  private async request(url: string, init: RequestInit): Promise<Response | null> {
    const controller = new AbortController();
    this.inFlight.add(controller);
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.options.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          // The token travels in the Authorization header only — never in a URL,
          // a query string, a log line or a screenshot.
          authorization: `Bearer ${this.options.token}`
        }
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      this.inFlight.delete(controller);
    }
  }
}

/** Protocol version the browser link speaks. */
export const EXTERNAL_CLIENT_PROTOCOL_VERSION = WORLD_PROTOCOL_VERSION;

/** Heartbeat cadence the bridge expects. */
export const EXTERNAL_CLIENT_HEARTBEAT_MS = WORLD_LIMITS.HEARTBEAT_MS;

export type { WorldActionBatchV1, WorldObservationV1 };
