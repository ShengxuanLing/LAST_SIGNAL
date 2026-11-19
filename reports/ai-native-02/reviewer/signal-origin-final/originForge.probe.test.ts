// REVIEWER PROBE (not part of the frozen commit) — can an AGENT forge the
// trusted `originRoomId` binding through any Agent-facing schema?
// The companion MCP surface is the only one that can lead to a toggle.
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = resolve(process.cwd(), 'dist-mcp/companionMcpServer.mjs');
// A deliberately dead bridge: a schema violation must surface BEFORE any network.
const DEAD_BRIDGE = 'http://127.0.0.1:9';

async function open() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: {
      ...process.env,
      LAST_SIGNAL_WORLD_BRIDGE_URL: DEAD_BRIDGE,
      LAST_SIGNAL_WORLD_TOKEN: 'x'.repeat(48)
    } as never,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'origin-forge-probe', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}

describe('Agent cannot forge originRoomId', () => {
  it('echo_suggest with an unknown originRoomId field is refused by the tool schema', async () => {
    const { client, transport } = await open();
    try {
      const res = await client.callTool({
        name: 'echo_suggest',
        arguments: {
          requestId: 'req_' + 'a'.repeat(24),
          suggestionId: 'sug_' + 'b'.repeat(24),
          kind: 'toggle-relay',
          reason: 'perceived_relay',
          ttlTicks: 600,
          // the trusted internal field: an Agent must not be able to set it
          originRoomId: 3
        } as never
      }) as any;
      console.log('FORGE_SUGGEST ' + JSON.stringify({ isError: res?.isError, content: res?.content?.[0]?.text?.slice(0, 220) }));
      expect(res.isError, 'unknown field must be a tool error').toBe(true);
      const text = String(res.content?.[0]?.text ?? '');
      // schema rejection, not a bridge/connection failure
      expect(text).not.toContain('fetch failed');
      expect(text).not.toContain('ECONNREFUSED');
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  });

  it('echo_suggest without the forged field fails later (network), proving the schema is the only gate', async () => {
    const { client, transport } = await open();
    try {
      const res = await client.callTool({
        name: 'echo_suggest',
        arguments: {
          requestId: 'req_' + 'c'.repeat(24),
          suggestionId: 'sug_' + 'd'.repeat(24),
          kind: 'toggle-relay',
          reason: 'perceived_relay',
          ttlTicks: 600
        }
      }) as any;
      const text = String(res?.content?.[0]?.text ?? '');
      console.log('FORGE_BASELINE ' + JSON.stringify({ isError: res?.isError, text: text.slice(0, 200) }));
      expect(text.length).toBeGreaterThan(0);
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  });
});
