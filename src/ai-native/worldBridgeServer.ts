// AI-NATIVE-02 C3-a — loopback HTTP bridge (no simulation state, no stepping).
//
// Only 127.0.0.1, a one-time handshake token, an explicit authorized=true flag
// and an exact game Origin can create a rendered link. The bridge forwards
// observations/actions to WorldGateway; it never imports the core or mutates a
// Scene. Tokens are never included in URLs, responses or logs.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WORLD_LIMITS, WORLD_PROTOCOL_VERSION } from './worldProtocol';
import type { ErrorCodeV1 } from './protocol';
import type { WorldGateway } from './worldGateway';

export interface WorldBridgeOptions {
  readonly gateway: WorldGateway;
  readonly token: string;
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
}

type Json = Record<string, unknown>;

export async function startWorldBridge(options: WorldBridgeOptions): Promise<RunningWorldBridge> {
  if (!options.token || options.token.trim().length < 16) throw new Error('world bridge token too short');
  if (options.allowedOrigins.length === 0 || options.allowedOrigins.some((o) => o === '*' || !/^https?:\/\/[^/]+$/.test(o))) {
    throw new Error('world bridge requires exact game origins, not wildcard');
  }
  const allowed = new Set(options.allowedOrigins);
  const bodyMax = options.bodyMaxBytes ?? WORLD_LIMITS.MAX_PAYLOAD_BYTES;
  const linkedByOrigin = new Map<string, string>();
  const server: Server = createServer((req, res) => { void handle(req, res); });

  const closeBridge = async (): Promise<void> => {
    clearInterval(reaper);
    await new Promise<void>((resolve) => {
      const anyServer = server as any;
      if (typeof anyServer.closeAllConnections === 'function') anyServer.closeAllConnections();
      server.close(() => resolve());
    });
    options.gateway.dispose();
    linkedByOrigin.clear();
  };

  const reaper = setInterval(() => {
    // LOST sessions stay in linkedByOrigin so a duplicate handshake cannot
    // silently create a new control link; explicit close/authorize is needed.
    options.gateway.reapExpired(Date.now());
  }, Math.max(20, options.heartbeatIntervalMs ?? WORLD_LIMITS.HEARTBEAT_MS));
  reaper.unref?.();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin)) {
      respond(res, 403, { ok: false, code: 'E_PERMISSION', messageKey: 'world.origin_denied' });
      return;
    }
    applyCors(res, origin);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (!authorized(req, options.token)) {
      respond(res, 401, { ok: false, code: 'E_PERMISSION', messageKey: 'world.auth_required' });
      return;
    }
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname === '/world-link/handshake' && req.method === 'POST') return handshake(req, res, origin);
    if (pathname === '/world-link/observation' && req.method === 'POST') return observation(req, res);
    if (pathname === '/world-link/heartbeat' && req.method === 'POST') return heartbeat(req, res);
    if (pathname === '/world-link/next-action' && req.method === 'GET') return nextAction(req, res);
    if (pathname === '/world-link/action-ack' && req.method === 'POST') return actionAck(req, res);
    if (pathname === '/world-link/yield' && req.method === 'POST') return yieldLink(req, res);
    if (pathname === '/world-link/close' && req.method === 'POST') return closeLink(req, res);
    respond(res, 404, { ok: false, code: 'E_NOT_APPLICABLE', messageKey: 'world.route_unknown' });
  }

  async function handshake(req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    if (body.authorized !== true || body.protocolVersion !== WORLD_PROTOCOL_VERSION) {
      respond(res, 403, { ok: false, code: 'E_PERMISSION', messageKey: 'world.authorization_required' });
      return;
    }
    const existing = linkedByOrigin.get(origin);
    if (existing) {
      const current = options.gateway.listSessions().find((s) => s.session === existing);
      if (current && current.status !== 'closed') {
        respond(res, 409, { ok: false, code: 'E_PERMISSION', messageKey: 'world.duplicate_handshake' });
        return;
      }
      linkedByOrigin.delete(origin);
    }
    const linked = options.gateway.linkSession({ authorized: true, origin, nowMs: Date.now() });
    if (!linked.ok) {
      respond(res, linked.code === 'E_RESOURCE_LIMIT' ? 429 : 403, linked);
      return;
    }
    linkedByOrigin.set(origin, linked.session);
    respond(res, 200, {
      ok: true,
      protocolVersion: WORLD_PROTOCOL_VERSION,
      session: linked.session,
      epoch: linked.epoch,
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
    const result = options.gateway.pushObservation(session, epoch, body.observation, Date.now());
    if (!result.ok) return respond(res, statusFor(result.code), result);
    respond(res, 200, { ok: true, tick: result.tick });
  }

  async function heartbeat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    const epoch = asInt(body.epoch);
    if (!session || epoch === null) return badRequest(res);
    if (!originMatches(req, options.gateway, session)) return originDenied(res);
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
    const result = options.gateway.yieldSession(session, epoch, reason, Date.now());
    if (!result.ok) return respond(res, statusFor(result.code), result);
    respond(res, 200, { ok: true, epoch: result.epoch, status: 'yielded' });
  }

  async function closeLink(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res, bodyMax);
    if (!body) return;
    const session = asString(body.session);
    if (!session) return badRequest(res);
    const result = options.gateway.closeSession(session, Date.now());
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
  return { url: `http://127.0.0.1:${address.port}`, port: address.port, close: closeBridge };
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
    case 'E_PERMISSION': return 403;
    case 'E_RESOURCE_LIMIT': return 429;
    case 'E_TIMEOUT': return 504;
    case 'E_LINK_UNAVAILABLE': return 503;
    default: return 400;
  }
}
