// AI-NATIVE-02 C3-b — official MCP-side world client.
//
// This is the AGENT side of the link: an MCP server started with `--world`
// talks to the loopback bridge that the rendered browser is attached to.
//
// It never imports the simulation core, never advances the rendered game and
// never writes scene state: it submits intents and reads observations. The
// browser remains the only authority.

import {
  WORLD_LIMITS, WORLD_PROTOCOL_VERSION,
  parseWorldObservation, worldBatchFingerprint,
  type WorldActionBatchV1, type WorldObservationV1
} from './worldProtocol';

export interface WorldClientOptions {
  readonly bridgeUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface WorldClientHandshake {
  readonly ok: true;
  readonly session: string;
  readonly epoch: number;
  readonly heartbeatMs: number;
}

export interface WorldClientActionResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly messageKey?: string;
  readonly requestId?: string;
  readonly epoch?: number;
  readonly acceptedTick?: number;
  readonly applyByTick?: number;
  readonly replayed?: boolean;
  readonly actions?: ReadonlyArray<{
    readonly actionId: string;
    readonly status: 'queued' | 'applied' | 'rejected' | 'expired';
    readonly applyByTick: number;
    readonly code?: string;
  }>;
}

export class WorldClient {
  private readonly options: Required<Pick<WorldClientOptions, 'bridgeUrl' | 'token'>> & {
    timeoutMs: number;
    fetchImpl: typeof fetch;
  };
  private session: string | null = null;
  private epoch = 0;

  constructor(options: WorldClientOptions) {
    this.options = {
      bridgeUrl: options.bridgeUrl.replace(/\/$/, ''),
      token: options.token,
      timeoutMs: options.timeoutMs ?? 4000,
      fetchImpl: options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
    };
  }

  get sessionId(): string | null { return this.session; }
  get currentEpoch(): number { return this.epoch; }

  /**
   * Attach to a rendered session. The RENDERED side creates the session after
   * the human authorizes it; the agent joins by handshake with the same
   * origin-bound token.
   */
  async handshake(session?: string): Promise<WorldClientHandshake | { ok: false; code: string; messageKey: string }> {
    // ATTACH, never create: the rendered browser created this session when the
    // HUMAN clicked AUTHORIZE. An agent that tried to create would be
    // self-authorizing, which the bridge refuses.
    const response = await this.request('/world-link/attach', {
      method: 'POST',
      body: { protocolVersion: WORLD_PROTOCOL_VERSION, ...(session ? { session } : {}) }
    });
    if (!response.ok) return response as { ok: false; code: string; messageKey: string };
    const payload = (await response.json()) as {
      ok?: boolean; session?: string; epoch?: number; heartbeatMs?: number; code?: string; messageKey?: string;
    };
    if (!payload || payload.ok !== true || !payload.session || typeof payload.epoch !== 'number') {
      return { ok: false, code: payload?.code ?? 'E_SCHEMA', messageKey: payload?.messageKey ?? 'world.handshake_failed' };
    }
    this.session = payload.session;
    this.epoch = payload.epoch;
    return { ok: true as const, session: payload.session, epoch: payload.epoch, heartbeatMs: payload.heartbeatMs ?? WORLD_LIMITS.HEARTBEAT_MS };
  }

  /** Read the latest post-commit, perception-cropped observation. */
  async observe(): Promise<{ ok: true; observation: WorldObservationV1 } | { ok: false; code: string; messageKey: string }> {
    if (!this.session) return { ok: false, code: 'E_SESSION_NOT_FOUND', messageKey: 'world.not_attached' };
    const response = await this.request(
      `/world-link/observation?session=${encodeURIComponent(this.session)}&epoch=${this.epoch}`,
      { method: 'GET' }
    );
    if (!response.ok) return response as { ok: false; code: string; messageKey: string };
    const payload = (await response.json()) as { observation?: unknown };
    const parsed = parseWorldObservation(payload.observation);
    if (!parsed.ok) return { ok: false, code: 'E_SCHEMA', messageKey: 'world.observation_invalid' };
    return { ok: true, observation: parsed.value };
  }

  /** Submit a batch of intents. Idempotent per requestId / actionId. */
  async submit(requestId: string, actions: WorldActionBatchV1['actions'], ttlTicks?: number): Promise<WorldClientActionResult> {
    if (!this.session) return { ok: false, code: 'E_SESSION_NOT_FOUND', messageKey: 'world.not_attached' };
    const body = {
      session: this.session,
      epoch: this.epoch,
      requestId,
      actions,
      ...(ttlTicks !== undefined ? { ttlTicks } : {})
    };
    const response = await this.request('/world-link/action-submit', { method: 'POST', body });
    if (!response.ok) return response as { ok: false; code: string; messageKey: string };
    const payload = (await response.json()) as WorldClientActionResult & { ok?: boolean };
    return payload;
  }

  async heartbeat(): Promise<boolean> {
    if (!this.session) return false;
    const response = await this.request('/world-link/heartbeat', {
      method: 'POST', body: { session: this.session, epoch: this.epoch }
    });
    return response.ok;
  }

  async close(): Promise<boolean> {
    if (!this.session) return true;
    const response = await this.request('/world-link/agent-disconnect', {
      method: 'POST', body: { session: this.session }
    });
    this.session = null;
    return response.ok;
  }

  /** Stable fingerprint of an action batch (idempotency aid for callers). */
  fingerprint(actions: WorldActionBatchV1['actions']): string {
    return worldBatchFingerprint({ actions });
  }

  private async request(
    path: string,
    init: { method: string; body?: unknown }
  ): Promise<Response | { ok: false; code: string; messageKey: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.options.fetchImpl(`${this.options.bridgeUrl}${path}`, {
        method: init.method,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          // The token is only ever an Authorization header value.
          authorization: `Bearer ${this.options.token}`
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
      });
      if (!response.ok) {
        let code = 'E_SCHEMA';
        let messageKey = 'world.request_invalid';
        try {
          const payload = (await response.json()) as { code?: string; messageKey?: string };
          code = payload.code ?? code;
          messageKey = payload.messageKey ?? messageKey;
        } catch { /* keep defaults */ }
        return { ok: false, code, messageKey };
      }
      return response;
    } catch {
      return { ok: false, code: 'E_LINK_UNAVAILABLE', messageKey: 'world.bridge_unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }
}
