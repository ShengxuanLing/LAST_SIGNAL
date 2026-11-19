/**
 * Independent production Companion MCP surface probe:
 *  - dist-mcp bundle has NO Owner factory / confirm route / ownerSecret / WeakSet
 *  - official SDK tool list is exactly observe/suggest/status/memory
 *  - no confirm/reject/applied/authorize tool exists in the bundle
 * In-process random token only.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { registerCompanionTools, CompanionClient } from './src/ai-native/companionMcpTools';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));

// 1. static production bundle scan (cold MCP build already done)
const root = resolve('dist-mcp');
const entry = resolve(root, 'companionMcpServer.mjs');
check('companionMcpServer.mjs exists (cold build)', existsSync(entry));
const parts = [readFileSync(entry, 'utf8')];
const chunks = resolve(root, 'chunks');
if (existsSync(chunks)) for (const f of readdirSync(chunks)) if (f.endsWith('.mjs')) parts.push(readFileSync(resolve(chunks, f), 'utf8'));
const bundle = parts.join('\n');
for (const t of ['echo_observe', 'echo_suggest', 'echo_status', 'echo_memory'])
  check(`bundle registers ${t}`, bundle.includes(t));
const forbidden = [
  'createOwnerCapability', 'isOwnerCapability', 'OWNER_CAPABILITY', 'mintOwnerAuthority',
  'OWNER_AUTHORITIES', 'CompanionOwnerLedger', 'companion-decision', 'companion-applied',
  'companion-authorize', 'echo_confirm', 'echo_reject', 'ownerSecretHash',
  'startWorldBridge', 'CompanionLink', 'companionLink'
];
for (const f of forbidden) check(`bundle has NO ${f}`, !bundle.includes(f), { found: bundle.includes(f) });
// The Agent bundle must not even contain a confirm route string
check('bundle has NO confirm-route functionality', !/companion[-_]confirm|owner_decide|decision:\s*'confirm'/.test(bundle));
// WeakSet-based owner authority must be browser-only, never in the agent bundle
check('bundle has NO WeakSet owner identity check', !bundle.includes('OWNER_AUTHORITIES'));
info('bundle size', { bytes: statSync(entry).size, chunks: existsSync(chunks) ? readdirSync(chunks).filter((f) => f.endsWith('.mjs')).length : 0 });

// 2. live SDK tool listing (no network: attach fails, but tools must be registered)
async function liveTools(): Promise<string[]> {
  const client = new CompanionClient({ bridgeUrl: 'http://127.0.0.1:1', token: randomBytes(24).toString('hex') });
  const server = new McpServer({ name: 'reviewer-companion', version: '0.0.0' });
  registerCompanionTools(server, client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const sdk = new Client({ name: 'reviewer-sdk', version: '0.0.0' });
  await Promise.all([server.connect(b), sdk.connect(a)]);
  const list = await sdk.listTools();
  await sdk.close(); await server.close();
  return list.tools.map((t) => t.name);
}
const tools = await liveTools();
const expected = ['echo_observe', 'echo_suggest', 'echo_status', 'echo_memory'];
check('official SDK tool list EXACTLY 4 agent tools', JSON.stringify([...tools].sort()) === JSON.stringify([...expected].sort()), { tools });
for (const f of ['echo_confirm', 'echo_reject', 'echo_decide', 'echo_applied', 'echo_authorize', 'owner_confirm'])
  check(`SDK has NO ${f}`, !tools.includes(f));
// 3. CompanionClient has no confirm/decide/apply method
const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(new CompanionClient({ bridgeUrl: 'x', token: 'y' })));
for (const f of ['confirm', 'decide', 'applied', 'authorize', 'ownerDecide']) check(`CompanionClient has NO ${f}()`, !proto.includes(f));
info('CompanionClient methods', { methods: proto });

console.log(`MCP_SURFACE_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
