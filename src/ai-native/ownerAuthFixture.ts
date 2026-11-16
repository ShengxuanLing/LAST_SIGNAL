// Test/smoke-only deterministic Owner pairing vector. Contains NO production
// credential: every bridge under test is started with this hash explicitly and
// never shares a key with a real host bridge.
import { WORLD_PROTOCOL_VERSION } from './worldProtocol';
export const TEST_OWNER_KEY = 'a'.repeat(64);
export const TEST_OWNER_KEY_HASH = 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb';

export const hsBody = {
  authorized: true,
  protocolVersion: WORLD_PROTOCOL_VERSION,
  ownerKey: TEST_OWNER_KEY
};

export interface HandshakeResult {
  session: string;
  epoch: number;
  ownerCap: string;
}

export async function handshake(
  server: { url: string },
  path = '/world-link/handshake',
  body = hsBody,
  token = TEST_OWNER_KEY_HASH,
  origin = 'http://localhost:5335'
): Promise<HandshakeResult> {
  const res = await fetch(server.url + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      origin
    },
    body: JSON.stringify(body)
  });
  const json = await res.json() as {
    ok?: boolean; session?: string; epoch?: number; ownerCap?: string;
    code?: string; messageKey?: string;
  };
  if (!json.ok || !json.session || typeof json.epoch !== 'number' || typeof json.ownerCap !== 'string') {
    throw new Error(`handshake failed: HTTP ${res.status} ${JSON.stringify(json)}`);
  }
  return { session: json.session, epoch: json.epoch, ownerCap: json.ownerCap };
}
