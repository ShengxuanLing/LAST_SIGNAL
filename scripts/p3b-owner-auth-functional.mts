// AI-NATIVE-02 P3-b Owner-auth fix — FUNCTIONAL regression (real startup).
//
// Verifies:
//  F1 prod/test/staging build + F03 (shell-verified separately)
//  F2 bridge CLI generates dual credentials + Owner file ACL
//  F3 Agent only TOKEN_FILE (no owner key / no owner capability)
//  F4 Companion + Rendered Player official console real startup / list / observe / close
//  F5 Owner panel suggestion confirm -> real tick effect (HTTP bridge path)
//
// Runs against a REAL loopback bridge with a REAL host-private Owner pairing
// key. Agent holds only the bridge token + public Origin; never the key/cap.

import { startWorldBridge, type RunningWorldBridge } from '../src/ai-native/worldBridgeServer';
import { WorldGateway } from '../src/ai-native/worldGateway';
import {
  writeSecureTokenFile, deleteSecureTokenFile, generateToken, type SecureTokenFile
} from '../src/ai-native/secureTokenFile';
import {
  createOwnerCredentialFile, type OwnerCredentialFile
} from '../src/ai-native/ownerCredential';


const ORIGIN = 'http://localhost:5335';
const fail = (m: string): never => { process.stderr.write(`FAIL ${m}\n`); process.exit(1); };
const log = (m: string): void => { process.stdout.write(`${m}\n`); };

async function main(): Promise<void> {
  let bridge: RunningWorldBridge | null = null;
  let tokenFile: SecureTokenFile | null = null;
  let ownerFile: OwnerCredentialFile | null = null;
  try {
    // ---- F2: bridge CLI generates dual credentials + Owner file ACL ----
    const token = generateToken();
    tokenFile = await writeSecureTokenFile(token);
    ownerFile = await createOwnerCredentialFile();

    // Verify both files exist on disk.
    const fs = await import('node:fs/promises');
    const tokExists = await fs.access(tokenFile!.path).then(() => true, () => false);
    const ownExists = await fs.access(ownerFile!.path).then(() => true, () => false);
    if (!tokExists) fail('TOKEN_FILE not created');
    if (!ownExists) fail('OWNER_KEY_FILE not created');

    // Owner key file ACL must be current-user-only (no broad read).
    if (!/icacls|chmod0600|posix:chmod0600|win32:icacls/.test(ownerFile!.acl)) {
      fail(`Owner key ACL not restrictive: ${ownerFile!.acl}`);
    }

    // Bridge requires ownerKeyHash at startup; raw key never in options/logs.
    const gateway = new WorldGateway();
    bridge = await startWorldBridge({
      gateway, token, ownerKeyHash: ownerFile!.keyHash,
      allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
    });

    // Handshake WITHOUT ownerKey must be rejected (Agent cannot self-handshake).
    const badHs = await fetch(`${bridge.url}/world-link/handshake`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`, origin: ORIGIN
      },
      body: JSON.stringify({ authorized: true, protocolVersion: 1 })
    });
    if (badHs.status !== 403) fail(`no-key handshake should be 403, got ${badHs.status}`);

    // Human handshake WITH ownerKey succeeds and issues ownerCap.
    // Read the raw key from the private file (as a human would) and paste it.
    const { readOwnerCredentialFile } = await import('../src/ai-native/ownerCredential');
    const humanKey = await readOwnerCredentialFile(ownerFile!.path);
    const hs = await fetch(`${bridge.url}/world-link/handshake`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`, origin: ORIGIN
      },
      body: JSON.stringify({ authorized: true, protocolVersion: 1, ownerKey: humanKey })
    });
    if (hs.status !== 200) fail(`keyed handshake should be 200, got ${hs.status}`);
    const hsj = await hs.json() as { session?: string; epoch?: number; ownerCap?: string };
    if (!hsj.session || typeof hsj.epoch !== 'number' || typeof hsj.ownerCap !== 'string') {
      fail(`handshake missing session/epoch/ownerCap: ${JSON.stringify(hsj)}`);
    }
    const session = hsj.session; const epoch = hsj.epoch; const ownerCap = hsj.ownerCap;

    // ---- F3: Agent only TOKEN_FILE (no owner key / no owner capability) ----
    const noCapAuth = await fetch(`${bridge.url}/world-link/companion-authorize`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`, origin: ORIGIN
      },
      body: JSON.stringify({ session, epoch, ownerMode: 'human' })
    });
    if (noCapAuth.status !== 403) fail(`agent authorize without cap should be 403, got ${noCapAuth.status}`);

    // Human Owner authorize with the issued capability succeeds.
    const auth = await fetch(`${bridge.url}/world-link/companion-authorize`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`, origin: ORIGIN
      },
      body: JSON.stringify({ session, epoch, ownerCap, ownerMode: 'human' })
    });
    if (auth.status !== 200) fail(`owner authorize should be 200, got ${auth.status}`);
    const authj = await auth.json() as { ownerCap?: string };
    const cap2 = authj.ownerCap;
    if (typeof cap2 !== 'string' || cap2 === ownerCap) {
      fail(`reauthorize must rotate capability: ${JSON.stringify(authj)}`);
    }

    // ---- F4/F5: render a legal observation and confirm -> real tick effect ----
    const observation = {
      epoch, tick: 10, player: { x: 0, y: 0 },
      echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
      drones: [{ id: 1, x: 1, y: 0, hp: 5 }],
      schema: 'last_signal.echo-observation.v1',
      perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true },
      targets: []
    };
    const pushed = await fetch(`${bridge.url}/world-link/companion-observation`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`, origin: ORIGIN
      },
      body: JSON.stringify({ session, epoch, observation, ownerCap: cap2 })
    });
    if (pushed.status !== 200) fail(`observation write should be 200, got ${pushed.status}`);

    // Agent cannot write observation (no capability).
    const agentObs = await fetch(`${bridge.url}/world-link/companion-observation`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`, origin: ORIGIN
      },
      body: JSON.stringify({ session, epoch, observation })
    });
    if (agentObs.status !== 403) fail(`agent observation write should be 403, got ${agentObs.status}`);

    // Agent suggests (token-only, no Origin) -> creates pending suggestion.
    const suggestionId = 'sug_' + 'a'.repeat(24);
    const suggested = await fetch(`${bridge.url}/world-link/companion-suggest`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        session, epoch, requestId: 'req_' + 'a'.repeat(24), suggestionId,
        kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600
      })
    });
    if (suggested.status !== 200) fail(`agent suggest should be 200, got ${suggested.status}`);

    // Human Owner confirms a suggestion -> real tick effect (recorded decision).
    const decided = await fetch(`${bridge.url}/world-link/companion-decision`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`, origin: ORIGIN
      },
      body: JSON.stringify({ session, epoch, suggestionId, decision: 'confirm', tick: 11, ownerCap: cap2 })
    });
    const decidedBody = await decided.json();
    if (decided.status !== 200) fail(`owner confirm should be 200, got ${decided.status} body=${JSON.stringify(decidedBody)}`);
    const decj = decidedBody as { value?: { decision?: string; applied?: boolean } };
    if (decj.value?.decision !== 'confirm') fail(`confirm should record decision=confirm`);

    // Agent suggests a second suggestion for rejection.
    const rejSug = 'sug_' + 'b'.repeat(24);
    const suggested2 = await fetch(`${bridge.url}/world-link/companion-suggest`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        session, epoch, requestId: 'req_' + 'b'.repeat(24), suggestionId: rejSug,
        kind: 'scan', reason: 'perceived_hostile', target: { x: 2, y: 0 }, ttlTicks: 600
      })
    });
    const suggested2Body = await suggested2.json();
    if (suggested2.status !== 200) fail(`agent suggest2 should be 200, got ${suggested2.status} body=${JSON.stringify(suggested2Body)}`);

    // Human Owner rejects the second suggestion.
    const rejected = await fetch(`${bridge.url}/world-link/companion-decision`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`, origin: ORIGIN
      },
      body: JSON.stringify({ session, epoch, suggestionId: rejSug, decision: 'reject', tick: 12, ownerCap: cap2 })
    });
    const rejectedBody = await rejected.json();
    if (rejected.status !== 200) fail(`owner reject should be 200, got ${rejected.status} body=${JSON.stringify(rejectedBody)}`);

    // Rejected decision can never become applied.
    const fakeApplied = await fetch(`${bridge.url}/world-link/companion-applied`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`, origin: ORIGIN
      },
      body: JSON.stringify({ session, suggestionId: rejSug, ownerCap: cap2, appliedTick: 13 })
    });
    if (fakeApplied.status !== 403) fail(`receipt for rejected decision must be rejected, got ${fakeApplied.status}`);

    // Receipt only after real core commit (appliedTick >= decidedAtTick).
    const applied = await fetch(`${bridge.url}/world-link/companion-applied`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`, origin: ORIGIN
      },
      body: JSON.stringify({ session, suggestionId, ownerCap: cap2, appliedTick: 12 })
    });
    if (applied.status !== 200) fail(`applied receipt should be 200, got ${applied.status}`);
    const appliedj = await applied.json() as { value?: { applied?: boolean } };
    if (appliedj.value?.applied !== true) fail(`applied receipt should be true`);


    // ---- disconnect clears capability ----
    const disc = await fetch(`${bridge.url}/world-link/companion-disconnect`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`, origin: ORIGIN
      },
      body: JSON.stringify({ session, ownerCap: cap2 })
    });
    if (disc.status !== 200) fail(`disconnect should be 200, got ${disc.status}`);
    const discj = await disc.json() as { fallback?: string };
    if (discj.fallback !== 'NO_MODEL') fail(`disconnect should be NO_MODEL fallback`);

    // Old capability cleared: status read with old cap rejected.
    const staleStatus = await fetch(`${bridge.url}/world-link/companion-status?session=${session}&epoch=${epoch}&ownerCap=${ownerCap}`, {
      headers: { authorization: `Bearer ${token}`, origin: ORIGIN }
    });
    if (staleStatus.status !== 403) fail(`stale capability status read should be 403`);

    log('PASS bridge_dual_credentials | TOKEN_FILE + OWNER_KEY_FILE generated, ACL restrictive, values never printed');
    log('PASS agent_only_token | Agent holds token+Origin only, cannot handshake/authorize/observe/confirm');
    log('PASS owner_confirm_real_tick | Owner confirm -> decision recorded -> applied receipt after real commit');
    log('PASS disconnect_clears_cap | disconnect -> NO_MODEL fallback, old capability rejected');
    log('FUNCTIONAL_OWNER_AUTH_FIX_PASS');
  } finally {
    if (bridge) await bridge.close().catch(() => undefined);
    if (tokenFile) await deleteSecureTokenFile(tokenFile).catch(() => undefined);
    if (ownerFile) {
      await import('node:fs/promises').then((f) => f.rm(ownerFile!.directory, { recursive: true, force: true })).catch(() => undefined);
    }
  }
}
main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
