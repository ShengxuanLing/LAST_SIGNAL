// Task C fix #3 — bridge route classification for the room-commit notification.
// `/world-link/companion-room` is browser-only: an Agent-shaped request (no
// Origin) must be refused by the OUTER Origin gate, not merely by the handler's
// ownerCap check. A browser-shaped request (allowed Origin + token) reaches the
// handler. No secrets, no browser, no timers.
//
// Run: npx vitest run src/ai-native/companionRoomBoundary.test.ts

import { describe, expect, it } from 'vitest';
import { startWorldBridge, type RunningWorldBridge } from './worldBridgeServer';
import { WorldGateway } from './worldGateway';
import { TEST_OWNER_KEY_HASH } from './ownerAuthFixture';

const TOKEN = 'a'.repeat(48);
const ORIGIN = 'http://localhost:5399';

async function withBridge<T>(fn: (bridge: RunningWorldBridge) => Promise<T>): Promise<T> {
  const bridge = await startWorldBridge({
    gateway: new WorldGateway(), token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH,
    allowedOrigins: [ORIGIN], heartbeatIntervalMs: 1000
  });
  try { return await fn(bridge); }
  finally { await bridge.close(); }
}

function roomBody(): string {
  return JSON.stringify({ session: 'ses_' + 'b'.repeat(24), epoch: 1, roomId: 3, tick: 10, ownerCap: 'f'.repeat(64) });
}

describe('POST /world-link/companion-room is browser-only', () => {
  it('Agent shape (no Origin) is refused by the outer Origin gate with 403', async () => {
    await withBridge(async (bridge) => {
      const res = await fetch(`${bridge.url}/world-link/companion-room`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: roomBody()
      });
      expect(res.status).toBe(403);
      const body = await res.json() as any;
      expect(body).toMatchObject({ ok: false, messageKey: 'world.origin_denied' });
    });
  });

  it('a browser-shaped request (allowed Origin + token) reaches the handler', async () => {
    await withBridge(async (bridge) => {
      const res = await fetch(`${bridge.url}/world-link/companion-room`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: ORIGIN
        },
        body: roomBody()
      });
      // The outer Origin/token gates let it through; the handler rejects the
      // unknown session (it is NOT an outer-gate 403 world.origin_denied).
      const body = await res.json() as any;
      expect(body.ok).toBe(false);
      expect(body.messageKey).not.toBe('world.origin_denied');
      expect(body.messageKey).not.toBe('world.auth_required');
    });
  });
});
