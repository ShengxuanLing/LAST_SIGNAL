// P3-b A — production Agent MCP surface must contain NO Owner authority.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('dist-mcp');

function agentBundleText(): string {
  const entry = resolve(root, 'companionMcpServer.mjs');
  // The gate builds the MCP bundle BEFORE running this test (cold start).
  expect(existsSync(entry), 'npm run game:mcp:build must run first').toBe(true);
  const parts = [readFileSync(entry, 'utf8')];
  const chunks = resolve(root, 'chunks');
  if (existsSync(chunks)) {
    for (const file of readdirSync(chunks)) {
      if (file.endsWith('.mjs')) parts.push(readFileSync(resolve(chunks, file), 'utf8'));
    }
  }
  return parts.join('\n');
}

describe('official Companion MCP agent surface', () => {
  it('registers only observe/suggest/status/memory; no confirm/owner interface', () => {
    const text = agentBundleText();
    for (const name of ['echo_observe', 'echo_suggest', 'echo_status', 'echo_memory']) {
      expect(text).toContain(name);
    }
    for (const forbidden of [
      'echo_confirm', 'echo_reject', 'companion-confirm', 'companion-decision',
      'createOwnerCapability', 'mintOwnerAuthority', 'OWNER_AUTHORITIES',
      'CompanionOwnerLedger', 'ownerSecret', 'companionLink'
    ]) {
      expect(text.includes(forbidden), `agent bundle leaks ${forbidden}`).toBe(false);
    }
  });
});
