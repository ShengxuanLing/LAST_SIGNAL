// AI-NATIVE-02 C3-a — loopback HTTP bridge (no simulation state, no stepping).
//
// Only 127.0.0.1, a one-time handshake token, an explicit authorized=true flag
// and an exact game Origin can create a rendered link. The bridge forwards
// observations/actions to WorldGateway; it never imports the core or mutates a
// Scene. Tokens are never included in URLs, responses or logs.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WORLD_LIMITS, WORLD_PROTOCOL_VERSION } from './worldProtocol';
import type { ErrorCodeV1 } from './protocol';
import type { WorldGateway } from './worldGateway';
import { AgentLeaseRegistry } from './agentLease';
import { CompanionGateway } from './companionGateway';
import { ownerHashEquals, OWNER_PAIRING_KEY_PATTERN, ownerKeyHash } from './ownerCredential';

export interface WorldBridgeOptions {
  readonly gateway: WorldGateway;
  readonly token: string;
  /** sha256 of the HOST-ONLY pairing key; never the raw key. */
  readonly ownerKeyHash: string;
  readonly allowedOrigins: readonly string[];
  readonly host?: '127.0.0.1';
  readonly port?: number;
  readonly bodyMaxBytes?: number;
  readonly heartbeatIntervalMs?: number;
}

export interface RunningWorldBridge {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
  /** Bounded lease-registry sizes (diagnostics/tests; no secrets). */
  leaseStats(): ReturnType<AgentLeaseRegistry['stats']>;
}

type Json = Record<string, unknown>;

export async function startWorldBridge(options: WorldBridgeOptions): Promise<RunningWorldBridge> {
  if (!options.token || options.token.trim().length < 16) throw new Error('world bridge token too short');
  if (!ownerHashEquals(options.ownerKeyHash, options.ownerKeyHash)) {
    throw new Error('world bridge requires a sha256 owner pairing key hash');
  }
  if (options.allowedOrigins.length === 0 || options.allowedOrigins.some((o) => o === '*' || !/^https?:\/\/[^/]+$/.test(o))) {
    throw new Error('world bridge requires exact game origins, not wildcard');
  }
  const allowed = new Set(options.allowedOrigins);
  const bodyMax = options.bodyMaxBytes ?? WORLD_LIMITS.MAX_PAYLOAD_BYTES;
  const linkedByOrigin = new Map<string, string>();
  // Independent AGENT lease. The browser heartbeat is NOT allowed to renew it.
  const leases = new AgentLeaseRegistry();
  const companions = new CompanionGateway(options.gateway);
  /**
   * Bridge-issued OWNER session capabilities. The human pairing key is proved
   * ONCE at handshake; every later renderer mutation must present the issued
   * capability. Agent routes never receive it. Re-authorization atomically
   * swaps the capability so the old one stops working immediately.
   */
  const ownerCaps = new Map<string, { hash: string; epoch: number }>();
  const pairingOk = (key: unknown): boolean =>
    typeof key === 'string' && OWNER_PAIRING_KEY_PATTERN.test(key)
      && ownerHashEquals(ownerKeyHash(key), options.ownerKeyHash);
  const capOk = (session: string, cap: unknown, epoch?: number): boolean => {
    const expected = ownerCaps.get(session);
    if (!expected || typeof cap !== 'string' || !/^[0-9a-f]{64}$/.test(cap)) return false;
    if (epoch !== undefined && expected.epoch !== epoch) return false;
    return ownerHashEquals(ownerKeyHash(cap), expected.hash);
  };
  const issueOwnerCap = (session: string, epoch: number): string => {
    const cap = randomBytes(32).toString('hex');
    ownerCaps.set(session, { hash: ownerKeyHash(cap), epoch });
    return cap;
  };
  const ownerDenied = (res: ServerResponse): void => {
    respond(res, 403, { ok: false, code: 'E_PERMISSION', messageKey: 'companion.owner_capability_required' });
  };
  const server: Server = createServer((req, res) => { void handle(req, res); });

  const leaseStats = (): ReturnType<AgentLeaseRegistry['stats']> => leases.stats();

  // ---------- P3-b A: Companion routes ----------
  // Agent routes are token-only (no Origin). Renderer routes additionally
  // require the handshake origin AND, for CONFIRM/APPLIED, the browser-held
  // owner secret. An agent token or a forged Origin can never self-confirm.
  function companionQuery(req: IncomingMessage): { session: string | null; epoch: number | null } {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    return { session: u.searchParams.get('session'), epoch: Number(u.searchParams.get('epoch')) };
  }
  function companionResult(res: ServerResponse, result: unknown): void {
    const r = result as { ok: boolean; code?: string };
    respond(res, r.ok ? 200 : statusFor((r.code ?? 'E_SCHEMA') as ErrorCodeV1), result);
  }
  async function companionAuthorize(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    const epoch = asInt(body.epoch);
    if (!session || epoch === null) return badRequest(res);
    // Origin is checked, but it is NOT authentication. The issued Owner
    // capability is the only proof that can register/re-register authority.
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    if (!capOk(session, body.ownerCap, epoch)) return ownerDenied(res);
    const reauthorize = body.reauthorize === true;
    if (reauthorize && !pairingOk(body.ownerKey)) return ownerDenied(res);
    const mode = body.ownerMode === 'ai' || body.ownerMode === 'external' ? body.ownerMode : 'human';
    const r = companions.authorize(session, epoch, mode, reauthorize);
    if (!r.ok) return companionResult(res, r);
    // Atomic same-Owner swap: the old capability stops working in this tick.
    const ownerCap = issueOwnerCap(session, epoch);
    respond(res, 200, { ok: true, session, epoch, ownerCap, protocolVersion: WORLD_PROTOCOL_VERSION, companion: true });
  }
  async function companionObservation(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    const epoch = asInt(body.epoch);
    if (!session || epoch === null) return badRequest(res);
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    // Only the human's renderer may publish a cropped observation. An Agent
    // token or a forged Origin can never inject a fabricated Boss/relay.
    if (!capOk(session, body.ownerCap, epoch)) return ownerDenied(res);
    companionResult(res, companions.pushObservation(session, epoch, body.observation));
  }
  function companionObservationGet(req: IncomingMessage, res: ServerResponse): void {
    const { session, epoch } = companionQuery(req);
    if (!session || epoch === null) return badRequest(res);
    companionResult(res, companions.observe(session, epoch));
  }
  async function companionSuggest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const r = companions.suggest({
      session: asString(body.session) ?? '',
      epoch: asInt(body.epoch) ?? -1,
      requestId: asString(body.requestId) ?? '',
      suggestionId: asString(body.suggestionId) ?? '',
      kind: body.kind as never,
      reason: body.reason as never,
      target: body.target as { x: number; y: number } | undefined,
      confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
      ttlTicks: typeof body.ttlTicks === 'number' ? body.ttlTicks : undefined
    });
    companionResult(res, r);
  }
  function companionStatus(req: IncomingMessage, res: ServerResponse): void {
    const { session, epoch } = companionQuery(req);
    if (!session || epoch === null) return badRequest(res);
    // echo_status: Agent readonly token/lease可调用，不要求Origin/ownerCap。
    // Owner mutations (authorize/mode/observation/decision/applied/disconnect)
    // stay on their own Origin+cap routes and are unaffected.
    companionResult(res, companions.status(session, epoch));
  }
  function companionMemory(req: IncomingMessage, res: ServerResponse): void {
    const { session, epoch } = companionQuery(req);
    if (!session || epoch === null) return badRequest(res);
    const r = companions.status(session, epoch);
    if (!r.ok) return companionResult(res, r);
    respond(res, 200, { ok: true, session, epoch, memoryEntries: r.value.status.memoryEntries, memoryTtlTicks: 600 });
  }
  function companionSuggestions(req: IncomingMessage, res: ServerResponse): void {
    const { session, epoch } = companionQuery(req);
    const cap = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('ownerCap');
    if (!session || epoch === null) return badRequest(res);
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    // Owner suggestion read: requires the issued capability (Owner UI only).
    if (!capOk(session, cap, epoch)) return ownerDenied(res);
    companionResult(res, companions.pending(session, epoch));
  }
  async function companionDecision(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    const epoch = asInt(body.epoch);
    const tick = asInt(body.tick);
    const suggestionId = asString(body.suggestionId);
    const decision = body.decision === 'confirm' || body.decision === 'reject' ? body.decision : null;
    if (!session || epoch === null || tick === null || !suggestionId || !decision) return badRequest(res);
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    if (!capOk(session, body.ownerCap, epoch)) return ownerDenied(res);
    // The strict enum / epoch / tick / TTL validator lives in companionFacet
    // and is shared with CompanionOwnerLedger. No route may reimplement it.
    companionResult(res, companions.decide({
      session, epoch, suggestionId, decision, tick
    }));
  }
  async function companionApplied(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    const suggestionId = asString(body.suggestionId);
    const appliedTick = asInt(body.appliedTick);
    if (!session || !suggestionId || appliedTick === null) return badRequest(res);
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    if (!capOk(session, body.ownerCap)) return ownerDenied(res);
    companionResult(res, companions.markApplied(session, suggestionId, appliedTick));
  }
  async function companionMode(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    const epoch = asInt(body.epoch);
    if (!session || epoch === null) return badRequest(res);
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    if (!capOk(session, body.ownerCap, epoch)) return ownerDenied(res);
    const mode = body.ownerMode === 'ai' || body.ownerMode === 'external' ? body.ownerMode : 'human';
    companionResult(res, companions.setOwnerMode(session, epoch, mode));
  }
  async function companionDisconnect(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    if (!session) return badRequest(res);
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    if (!capOk(session, body.ownerCap)) return ownerDenied(res);
    companions.disconnect(session);
    ownerCaps.delete(session);
    respond(res, 200, { ok: true, session, fallback: 'NO_MODEL' });
  }

  const closeBridge = async (): Promise<void> => {
    clearInterval(reaper);
    await new Promise<void>((resolve) => {
      const anyServer = server as any;
      if (typeof anyServer.closeAllConnections === 'function') anyServer.closeAllConnections();
      server.close(() => resolve());
    });
    options.gateway.dispose();
    leases.dispose();
    linkedByOrigin.clear();
  };

  const reaper = setInterval(() => {
    const now = Date.now();
    // LOST sessions stay in linkedByOrigin so a duplicate handshake cannot
    // silently create a new control link; explicit close/authorize is needed.
    options.gateway.reapExpired(now);
    // HARD DISCONNECT: a SIGKILL cannot run cleanup, so the independent AGENT
    // lease must expire on a deadline. Cancel pending/executing actions, bump
    // the epoch, close the session and force the rendered game to HUMAN/LOST.
    for (const expiry of leases.reap(now)) {
      companions.onLeaseExpired(expiry.sessionId);
      ownerCaps.delete(expiry.sessionId);
      const view = options.gateway.listSessions().find((s) => s.session === expiry.sessionId);
      if (view) {
        options.gateway.yieldSession(expiry.sessionId, view.epoch, 'agent-lease-expired', now);
        options.gateway.closeSession(expiry.sessionId, now);
      }
      for (const [origin, id] of linkedByOrigin) if (id === expiry.sessionId) linkedByOrigin.delete(origin);
    }
  }, Math.min(
    WORLD_LIMITS.AGENT_REAP_MS,
    Math.max(20, options.heartbeatIntervalMs ?? WORLD_LIMITS.HEARTBEAT_MS)
  ));
  reaper.unref?.();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    const pathname = (req.url ?? '').split('?')[0];
    const method = req.method ?? 'GET';
    // The agent side is a local process (no Origin). Those three routes are
    // token-only. Every renderer route keeps the exact browser Origin check.
    const agentRoute =
      (pathname === '/world-link/attach' && method === 'POST') ||
      (pathname === '/world-link/observation' && method === 'GET') ||
      (pathname === '/world-link/action-submit' && method === 'POST') ||
      (pathname === '/world-link/agent-disconnect' && method === 'POST') ||
      (pathname === '/world-link/agent-renew' && method === 'POST') ||
      (pathname === '/world-link/agent-status' && method === 'GET') ||
      (pathname === '/world-link/companion-observation' && method === 'GET') ||
      (pathname === '/world-link/companion-suggest' && method === 'POST') ||
      (pathname === '/world-link/companion-status' && method === 'GET') ||
      (pathname === '/world-link/companion-memory' && method === 'GET');
    if (typeof origin === 'string') {
      if (!allowed.has(origin)) {
        respond(res, 403, { ok: false, code: 'E_PERMISSION', messageKey: 'world.origin_denied' });
        return;
      }
      applyCors(res, origin);
    } else if (!agentRoute) {
      respond(res, 403, { ok: false, code: 'E_PERMISSION', messageKey: 'world.origin_denied' });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (!authorized(req, options.token)) {
      respond(res, 401, { ok: false, code: 'E_PERMISSION', messageKey: 'world.auth_required' });
      return;
    }
    if (pathname === '/world-link/handshake' && req.method === 'POST' && typeof origin === 'string') return handshake(req, res, origin);
    if (pathname === '/world-link/observation' && req.method === 'POST') return observation(req, res);
    if (pathname === '/world-link/observation' && req.method === 'GET') return observationGet(req, res);
    if (pathname === '/world-link/action-submit' && req.method === 'POST') return actionSubmit(req, res);
    if (pathname === '/world-link/attach' && req.method === 'POST') return attach(req, res);
    if (pathname === '/world-link/agent-disconnect' && req.method === 'POST') return agentDisconnect(req, res);
    if (pathname === '/world-link/agent-renew' && req.method === 'POST') return agentRenew(req, res);
    if (pathname === '/world-link/agent-status' && req.method === 'GET') return agentStatus(req, res);
    if (pathname === '/world-link/heartbeat' && req.method === 'POST') return heartbeat(req, res);
    if (pathname === '/world-link/next-action' && req.method === 'GET') return nextAction(req, res);
    if (pathname === '/world-link/action-ack' && req.method === 'POST') return actionAck(req, res);
    if (pathname === '/world-link/yield' && req.method === 'POST') return yieldLink(req, res);
    if (pathname === '/world-link/close' && req.method === 'POST') return closeLink(req, res);
    if (pathname === '/world-link/companion-authorize' && req.method === 'POST') return companionAuthorize(req, res);
    if (pathname === '/world-link/companion-observation' && req.method === 'POST') return companionObservation(req, res);
    if (pathname === '/world-link/companion-observation' && req.method === 'GET') return companionObservationGet(req, res);
    if (pathname === '/world-link/companion-suggest' && req.method === 'POST') return companionSuggest(req, res);
    if (pathname === '/world-link/companion-status' && req.method === 'GET') return companionStatus(req, res);
    if (pathname === '/world-link/companion-memory' && req.method === 'GET') return companionMemory(req, res);
    if (pathname === '/world-link/companion-suggestions' && req.method === 'GET') return companionSuggestions(req, res);
    if (pathname === '/world-link/companion-decision' && req.method === 'POST') return companionDecision(req, res);
    if (pathname === '/world-link/companion-applied' && req.method === 'POST') return companionApplied(req, res);
    if (pathname === '/world-link/companion-mode' && req.method === 'POST') return companionMode(req, res);
    if (pathname === '/world-link/companion-disconnect' && req.method === 'POST') return companionDisconnect(req, res);
    respond(res, 404, { ok: false, code: 'E_NOT_APPLICABLE', messageKey: 'world.route_unknown' });
  }

  async function handshake(req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    if (body.authorized !== true || body.protocolVersion !== WORLD_PROTOCOL_VERSION) {
      respond(res, 403, { ok: false, code: 'E_PERMISSION', messageKey: 'world.authorization_required' });
      return;
    }
    // HANDSHAKE IS HUMAN-ONLY. The Agent owns the bearer token and can forge
    // Origin, but it never possesses the host-private pairing key. No self-
    // handshake path exists: without a valid key the bridge stops here.
    if (!pairingOk(body.ownerKey)) {
      respond(res, 403, { ok: false, code: 'E_PERMISSION', messageKey: 'world.owner_pairing_required' });
      return;
    }
    const existing = linkedByOrigin.get(origin);
    if (existing) {
      const current = options.gateway.listSessions().find((s) => s.session === existing);
      // Only a LIVE connected link blocks a new authorization. A closed,
      // yielded or LOST (browser reload/crash) session is ATOMICALLY reclaimed:
      // its pending actions, request caches and agent lease are dropped, the
      // session is closed, and a BRAND-NEW session id/epoch is created. The old
      // epoch can never be used again and the same token cannot revive it.
      if (current && current.status === 'connected') {
        respond(res, 409, { ok: false, code: 'E_PERMISSION', messageKey: 'world.duplicate_handshake' });
        return;
      }
      leases.invalidateSession(existing);
      options.gateway.closeSession(existing, Date.now());
      linkedByOrigin.delete(origin);
    }
    const linked = options.gateway.linkSession({ authorized: true, origin, nowMs: Date.now() });
    if (!linked.ok) {
      respond(res, linked.code === 'E_RESOURCE_LIMIT' ? 429 : 403, linked);
      return;
    }
    linkedByOrigin.set(origin, linked.session);
    // Issued ONLY to the renderer response. It is not returned by attach,
    // observation, status or any MCP tool, and cannot be derived from them.
    const ownerCap = issueOwnerCap(linked.session, linked.epoch);
    respond(res, 200, {
      ok: true,
      protocolVersion: WORLD_PROTOCOL_VERSION,
      session: linked.session,
      epoch: linked.epoch,
      ownerCap,
      heartbeatMs: WORLD_LIMITS.HEARTBEAT_MS
    });
  }

  async function observation(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    const epoch = asInt(body.epoch);
    if (!session || epoch === null) return badRequest(res);
    // F3: every operation binds to the handshake origin, not just the shared
    // allow-list + token. A request from a different origin cannot update this
    // session's observation/ACK/yield.
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    if (!capOk(session, body.ownerCap, epoch)) return ownerDenied(res);
    const result = options.gateway.pushObservation(session, epoch, body.observation, Date.now());
    if (!result.ok) return respond(res, statusFor(result.code), result);
    respond(res, 200, { ok: true, tick: result.tick });
  }

  /**
   * Agent-side ATTACH. The rendered browser created the session through the
   * human AUTHORIZE click; the agent may only observe/submit on that same
   * session. It can never create one, and it can never authorize itself.
   */
  async function attach(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const origin = req.headers.origin;
    if (!agentOriginOk(req, options.allowedOrigins)) return originDenied(res);
    const wanted = asString(body.session);
    // Only a session the HUMAN authorized can be attached. A browser must name
    // its own origin's session; a local agent (no Origin) may name the session
    // explicitly, but it still must be a live, human-authorized session.
    let session: string | null = null;
    if (typeof origin === 'string') {
      const own = linkedByOrigin.get(origin) ?? null;
      session = own && (!wanted || wanted === own) ? own : null;
    } else {
      // A local agent with the token may attach to the single live,
      // human-authorized session without having to be told its name.
      const live = [...linkedByOrigin.values()].filter((id) => {
        const v = options.gateway.listSessions().find((x) => x.session === id);
        return v && v.status !== 'closed';
      });
      session = wanted ?? (live.length === 1 ? live[0] : null);
      if (session && !live.includes(session)) session = null;
    }
    const linked = session !== null;
    if (!linked || !session) {
      return respond(res, 403, { ok: false, code: 'E_PERMISSION', messageKey: 'world.authorization_required' });
    }
    const view = options.gateway.listSessions().find((s) => s.session === session);
    if (!view || view.status === 'closed') {
      return respond(res, 404, { ok: false, code: 'E_SESSION_NOT_FOUND', messageKey: 'world.session_unknown' });
    }
    const issued = leases.issue(view.session, view.epoch, Date.now());
    if (!issued.ok) return respond(res, 409, { ...issued });
    respond(res, 200, {
      ok: true,
      protocolVersion: WORLD_PROTOCOL_VERSION,
      session: view.session,
      epoch: view.epoch,
      status: view.status,
      heartbeatMs: WORLD_LIMITS.HEARTBEAT_MS,
      // The MCP process must renew THIS lease; the browser heartbeat cannot.
      leaseId: issued.lease.leaseId,
      leaseVersion: issued.lease.version,
      leaseMs: issued.leaseMs,
      renewMs: issued.renewMs
    });
  }

  /**
   * Agent-side disconnect: the agent drops the link, pending intents are
   * cancelled and the rendered game degrades to HUMAN control (its next
   * heartbeat fails on the closed session). The agent never "closes" the
   * human's ability to authorize again.
   */
  async function agentDisconnect(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    if (!session) return badRequest(res);
    // A local agent with the token may only disconnect a session that the
    // HUMAN created and that is still live on this bridge.
    const live = [...linkedByOrigin.values()].includes(session);
    if (!live) return respond(res, 403, { ok: false, code: 'E_PERMISSION', messageKey: 'world.authorization_required' });
    const leaseId = asString(body.leaseId);
    if (leaseId) leases.release(leaseId);
    const result = options.gateway.closeSession(session, Date.now());
    if (result.ok) leases.invalidateSession(session);
    for (const [origin, id] of linkedByOrigin) if (id === session) linkedByOrigin.delete(origin);
    if (!result.ok) return respond(res, statusFor(result.code), result);
    respond(res, 200, { ok: true, session: result.session, control: 'human' });
  }

  /** Agent lease renewal. ONLY the MCP client renews; the browser heartbeat
   *  is a separate route and can never extend Agent authority. */
  async function agentRenew(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const leaseId = asString(body.leaseId);
    const session = asString(body.session);
    const epoch = asInt(body.epoch);
    if (!leaseId || !session || epoch === null) return badRequest(res);
    const result = leases.renew(leaseId, session, epoch, Date.now());
    if (!result.ok) return respond(res, statusFor(result.code), { ...result });
    respond(res, 200, { ok: true, expiresAtMs: result.lease.expiresAtMs, version: result.lease.version });
  }

  /** Remote truth for `world_list_sessions`: never trust a local cached id. */
  async function agentStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const session = url.searchParams.get('session');
    const leaseId = url.searchParams.get('leaseId');
    if (!session || !leaseId) return badRequest(res);
    if (!agentOriginOk(req, options.allowedOrigins)) return originDenied(res);
    const view = options.gateway.listSessions().find((s) => s.session === session);
    const dead = !view || view.status !== 'connected' || leases.isExpiredSession(session);
    const lease = leases.status(session, leaseId, Date.now());
    const live = !dead && lease.ok && lease.epoch === view!.epoch;
    respond(res, 200, {
      ok: true,
      attached: live,
      session,
      epoch: view?.epoch ?? lease.epoch,
      status: live ? 'connected' : dead ? 'closed' : 'lost',
      leaseStatus: lease.status,
      expiresAtMs: lease.expiresAtMs
    });
  }

  /** Agent-side read of the latest post-commit observation. */
  async function observationGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const session = url.searchParams.get('session');
    const epoch = Number(url.searchParams.get('epoch'));
    if (!session || !Number.isInteger(epoch) || epoch < 0) return badRequest(res);
    if (!agentOriginOk(req, options.allowedOrigins)) return originDenied(res);
    const latest = options.gateway.latestObservation(session, epoch);
    if (latest && typeof latest === 'object' && 'ok' in latest && latest.ok === false) {
      return respond(res, statusFor(latest.code), latest);
    }
    if (!latest) return respond(res, 404, { ok: false, code: 'E_LINK_UNAVAILABLE', messageKey: 'world.no_observation' });
    respond(res, 200, { ok: true, observation: latest });
  }

  /** Agent-side submit: queue-only intents, never a tick advance. */
  async function actionSubmit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    const epoch = asInt(body.epoch);
    const requestId = asString(body.requestId);
    if (!session || epoch === null || !requestId) return badRequest(res);
    if (!agentOriginOk(req, options.allowedOrigins)) return originDenied(res);
    const actions = body.actions;
    if (!Array.isArray(actions)) return badRequest(res);
    const ttl = body.ttlTicks === undefined ? undefined : asInt(body.ttlTicks);
    const result = options.gateway.submitActions({
      sessionId: session, epoch, requestId,
      actions: { actions, ...(ttl === undefined || ttl === null ? {} : { ttlTicks: ttl }) },
      nowMs: Date.now()
    });
    if ('ok' in result && result.ok === false) return respond(res, statusFor(result.code), result);
    respond(res, 200, { ok: true, ...result });
  }

  async function heartbeat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    const epoch = asInt(body.epoch);
    if (!session || epoch === null) return badRequest(res);
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    if (!capOk(session, body.ownerCap, epoch)) return ownerDenied(res);
    // A browser heartbeat must NEVER renew the Agent lease. If the lease has
    // expired, tell the browser explicitly so it degrades to HUMAN / LOST.
    if (leases.isExpiredSession(session)) {
      return respond(res, 503, { ok: false, code: 'E_LINK_UNAVAILABLE', messageKey: 'world.agent_lease_expired' });
    }
    const result = options.gateway.heartbeat(session, epoch, Date.now());
    if (!result.ok) return respond(res, statusFor(result.code), result);
    respond(res, 200, { ok: true });
  }

  async function nextAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const session = url.searchParams.get('session');
    const epoch = Number(url.searchParams.get('epoch'));
    if (!session || !Number.isInteger(epoch) || epoch < 0) return badRequest(res);
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    if (!capOk(session, url.searchParams.get('ownerCap'), epoch)) return ownerDenied(res);
    const afterActionId = url.searchParams.get('after') ?? undefined;
    const result = options.gateway.nextAction({ sessionId: session, epoch, afterActionId, nowMs: Date.now() });
    if (result && 'ok' in result) return respond(res, statusFor(result.code), result);
    respond(res, 200, { ok: true, action: result });
  }

  async function actionAck(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    const epoch = asInt(body.epoch);
    const requestId = asString(body.requestId);
    const actionId = asString(body.actionId);
    const result = body.result;
    const appliedTick = body.appliedTick === undefined ? undefined : asInt(body.appliedTick);
    const code = body.code as ErrorCodeV1 | undefined;
    if (!session || epoch === null || !requestId || !actionId || (result !== 'applied' && result !== 'rejected')) {
      return badRequest(res);
    }
    if (result === 'applied' && appliedTick === null) return badRequest(res);
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    if (!capOk(session, body.ownerCap, epoch)) return ownerDenied(res);
    const ack = options.gateway.ackAction({
      sessionId: session, epoch, requestId, actionId,
      result, ...(appliedTick !== undefined && appliedTick !== null ? { appliedTick } : {}),
      ...(code ? { code } : {}), nowMs: Date.now()
    });
    if ('ok' in ack && ack.ok === false) return respond(res, statusFor(ack.code), ack);
    respond(res, 200, { ok: true, ack });
  }

  async function yieldLink(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    const epoch = asInt(body.epoch);
    const reason = asString(body.reason) ?? 'human-input';
    if (!session || epoch === null) return badRequest(res);
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    if (!capOk(session, body.ownerCap, epoch)) return ownerDenied(res);
    const result = options.gateway.yieldSession(session, epoch, reason, Date.now());
    // A yielded/closed link must also invalidate the AGENT lease; an old
    // process can never renew authority after a human takeover.
    if (result.ok) leases.invalidateSession(session);
    if (!result.ok) return respond(res, statusFor(result.code), result);
    respond(res, 200, { ok: true, epoch: result.epoch, status: 'yielded' });
  }

  async function closeLink(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    if (!session) return badRequest(res);
    // F3/close: closing a session is an authorized operation too. A different
    // allowed origin with the same token must not force-close another session.
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
    if (!capOk(session, body.ownerCap)) return ownerDenied(res);
    const leaseId = asString(body.leaseId);
    if (leaseId) leases.release(leaseId);
    const result = options.gateway.closeSession(session, Date.now());
    if (result.ok) leases.invalidateSession(session);
    for (const [origin, id] of linkedByOrigin) if (id === session) linkedByOrigin.delete(origin);
    if (!result.ok) return respond(res, statusFor(result.code), result);
    respond(res, 200, { ok: true, session: result.session });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('world bridge failed to bind');
  return { url: `http://127.0.0.1:${address.port}`, port: address.port, close: closeBridge, leaseStats };
}

/**
 * The agent side is a local process, not a page: it has no Origin header, so
 * an absent Origin is acceptable when it already proved possession of the
 * token. A page can never strip Origin, so a present Origin must still match
 * the allowlist exactly (this is what stops a hostile tab).
 */
function agentOriginOk(req: IncomingMessage, allowedOrigins: readonly string[]): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return typeof origin === 'string' && allowedOrigins.includes(origin);
}
function originMatches(req: IncomingMessage, gateway: WorldGateway, session: string): boolean {
  const so = gateway.sessionOrigin(session);
  if (so === null) return true; // unknown session is rejected by the gateway itself
  return so === req.headers.origin;
}
function originDenied(res: ServerResponse): void {
  respond(res, 403, { ok: false, code: 'E_PERMISSION', messageKey: 'world.origin_mismatch' });
}
function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice('Bearer '.length), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function applyCors(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}

async function jsonBody(req: IncomingMessage, res: ServerResponse, maxBytes: number): Promise<Json | null> {
  const type = req.headers['content-type'];
  if (typeof type !== 'string' || !type.toLowerCase().startsWith('application/json')) {
    respond(res, 415, { ok: false, code: 'E_SCHEMA', messageKey: 'world.json_required' });
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      respond(res, 413, { ok: false, code: 'E_PAYLOAD_TOO_LARGE', messageKey: 'world.payload_too_large' });
      req.destroy();
      return null;
    }
    chunks.push(buf);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Json;
  } catch {
    respond(res, 400, { ok: false, code: 'E_SCHEMA', messageKey: 'world.json_invalid' });
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null;
}
function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
function badRequest(res: ServerResponse): void {
  respond(res, 400, { ok: false, code: 'E_SCHEMA', messageKey: 'world.request_invalid' });
}
function respond(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
function statusFor(code: ErrorCodeV1): number {
  switch (code) {
    case 'E_SESSION_NOT_FOUND': return 404;
    case 'E_STALE_EPOCH': return 409;
    case 'E_STALE_TICK': return 409;
    case 'E_TICK_CONFLICT': return 409;
    case 'E_PERMISSION': return 403;
    case 'E_RESOURCE_LIMIT': return 429;
    case 'E_TIMEOUT': return 504;
    case 'E_LINK_UNAVAILABLE': return 503;
    default: return 400;
  }
}
