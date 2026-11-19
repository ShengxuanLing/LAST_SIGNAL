/**
 * Independent P3-b probe: Owner pairing credential ACL + MCP env isolation.
 *
 * Verifies:
 *   1. Owner credential file ACL: Windows current-SID-only (inheritance removed,
 *      grant only to current user SID), no BUILTIN\Users/Authenticated Users.
 *   2. c3b-bridge.mts: generates owner credential file via createOwnerCredentialFile,
 *      prints only OWNER_KEY_FILE/OWNER_KEY_ACL (path+ACL metadata, never the key),
 *      passes ownerKeyHash to bridge, cleans up private files on stop/error.
 *   3. Bridge does not leak ownerKey/ownerCap/ownerKeyHash in attach/observe/status
 *      responses (agent routes never receive the Owner capability).
 *   4. companionMcpTools / companionMcpServer: no Owner factory/confirm/ownerSecret.
 *
 * In-process only; token/key are in-process, never in logs/URLs.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createOwnerCredentialFile } from './src/ai-native/ownerCredential';
import { startWorldBridge } from './src/ai-native/worldBridgeServer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n, d) => console.log('INFO', n, JSON.stringify(d));

const TOKEN = randomBytes(24).toString('hex');

// ============ 1. Owner credential file ACL ============
const cred = await createOwnerCredentialFile();
info('owner credential file', { path: cred.path, directory: cred.directory, acl: cred.acl, keyHashLen: cred.keyHash.length });
const keyRaw = await (await import('node:fs/promises')).readFile(cred.path, 'utf8');
check('credential file raw key is 64 hex', /^[0-9a-f]{64}$/.test(keyRaw), { len: keyRaw.length });
check('keyHash is sha256 of raw key', cred.keyHash === createHash('sha256').update(keyRaw).digest('hex'));
if (process.platform === 'win32') {
  check('ACL reports current-SID-only (no inheritance)', /icacls-inheritance-removed/.test(cred.acl) && /grant-only-current-user-sid/.test(cred.acl), { acl: cred.acl });
  check('ACL does not grant broad users', !/BUILTIN\\\\Users|Authenticated Users|Everyone|\(I\)/.test(cred.acl), { acl: cred.acl });
} else {
  info('POSIX: ACL check via chmod 0600/0700 (skip Windows-specific icacls assertion)');
}

// ============ 2. c3b-bridge.mts source: owner credential handling ============
const bridgeSrc = readFileSync(resolve('scripts/c3b-bridge.mts'), 'utf8');
check('c3b-bridge imports createOwnerCredentialFile', bridgeSrc.includes('createOwnerCredentialFile'));
check('c3b-bridge prints OWNER_KEY_FILE (path only)', bridgeSrc.includes('OWNER_KEY_FILE='));
check('c3b-bridge prints OWNER_KEY_ACL (metadata only)', bridgeSrc.includes('OWNER_KEY_ACL='));
check('c3b-bridge prints OWNER_KEY redacted (never the key)', bridgeSrc.includes("OWNER_KEY=<redacted"));
check('c3b-bridge passes ownerKeyHash to bridge', bridgeSrc.includes('ownerKeyHash: ownerFile.keyHash'));
check('c3b-bridge cleans owner file directory on stop', bridgeSrc.includes('rm(ownerFile!.directory'));
check('c3b-bridge does NOT print raw owner key', !/OWNER_KEY=[0-9a-f]{64}/.test(bridgeSrc));

// ============ 3. Bridge does not leak ownerKey/ownerCap/ownerKeyHash in responses ============
const wg = new (await import('./src/ai-native/worldGateway')).WorldGateway();
const bridge = await startWorldBridge({
  gateway: wg, token: TOKEN, ownerKeyHash: createHash('sha256').update(keyRaw).digest('hex'),
  allowedOrigins: ['http://localhost:5416'], heartbeatIntervalMs: 20
});
const U = bridge.url;
try {
  const hs = await (await fetch(U + '/world-link/handshake', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, origin: 'http://localhost:5416' },
    body: JSON.stringify({ authorized: true, protocolVersion: 1, ownerKey: keyRaw })
  })).json();
  check('human handshake returns ownerCap (renderer-only)', hs.ok === true && !!hs.ownerCap && !!hs.session, { keys: Object.keys(hs) });
  const attach = await (await fetch(U + '/world-link/attach', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ session: hs.session })
  })).json();
  check('agent attach response has NO ownerCap/ownerKey/ownerKeyHash', attach.ok === true && !('ownerCap' in attach) && !('ownerKey' in attach) && !('ownerKeyHash' in attach), { keys: Object.keys(attach) });
  const obs = await (await fetch(U + '/world-link/companion-observation?session=' + hs.session + '&epoch=' + hs.epoch, {
    headers: { authorization: 'Bearer ' + TOKEN }
  })).json();
  check('agent observe response has NO ownerCap/ownerKey/ownerKeyHash', !('ownerCap' in obs) && !('ownerKey' in obs) && !('ownerKeyHash' in obs), { keys: Object.keys(obs) });
} finally { await bridge.close(); }

// ============ 4. companionMcpTools / companionMcpServer: no Owner factory/confirm ============
const mcpSrc = readFileSync(resolve('src/ai-native/companionMcpTools.ts'), 'utf8');
const mcpServerSrc = readFileSync(resolve('src/ai-native/companionMcpServer.ts'), 'utf8');
for (const f of ['createOwnerCapability', 'isOwnerCapability', 'OWNER_CAPABILITY', 'mintOwnerAuthority', 'OWNER_AUTHORITIES', 'CompanionOwnerLedger', 'companion-decision', 'companion-applied', 'companion-authorize', 'echo_confirm', 'echo_reject', 'ownerSecretHash', 'ownerSecret']) {
  check('companionMcpTools has NO ' + f, !mcpSrc.includes(f), { found: mcpSrc.includes(f) });
}
for (const f of ['createOwnerCapability', 'OWNER_CAPABILITY', 'ownerSecret', 'CompanionOwnerLedger', 'echo_confirm', 'echo_reject']) {
  check('companionMcpServer has NO ' + f, !mcpServerSrc.includes(f), { found: mcpServerSrc.includes(f) });
}
check('companionMcpTools registers echo_observe/echo_suggest/echo_status/echo_memory',
  ['echo_observe', 'echo_suggest', 'echo_status', 'echo_memory'].every(t => mcpSrc.includes(t)));

console.log('ACL_MCP_' + (failures === 0 ? 'PASS' : 'FAIL') + ' failures=' + failures);
if (failures > 0) process.exit(1);
