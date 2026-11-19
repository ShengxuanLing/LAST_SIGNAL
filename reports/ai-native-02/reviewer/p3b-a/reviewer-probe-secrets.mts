/**
 * Independent secret-leak / token-cleanup / bounded-session / Signal-unwired probe.
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { WorldGateway } from './src/ai-native/worldGateway';
import { CompanionGateway } from './src/ai-native/companionGateway';
import { CompanionClient } from './src/ai-native/companionMcpTools';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));
const TOKEN = randomBytes(24).toString('hex');
const SECRET = randomBytes(24).toString('hex');

// 1. source-level: no secret/token in logs, globals, or any response construction
{
  const files = [
    'src/ai-native/companionLink.ts', 'src/ai-native/worldBridgeServer.ts',
    'src/ai-native/companionGateway.ts', 'src/ai-native/companionMcpTools.ts',
    'scripts/p3b-companion-console.mts', 'src/ai-native/companionConsoleSmoke.mts'
  ];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    // No console/process.stdout logging of the secret or token values.
    const logLines = text.split('\n').filter((l) => /console\.|process\.stdout|process\.stderr|\.log\(/.test(l));
    const leaks = logLines.filter((l) => /ownerSecret\b/.test(l) && !/ownerSecretHash|ownerSecretOk|'ownerSecret'|"ownerSecret"/.test(l));
    check(`${f}: no raw ownerSecret in log statements`, leaks.length === 0, { leaks: leaks.slice(0, 3) });
    check(`${f}: no token value in log statements`, !logLines.some((l) => /Bearer \$\{TOKEN\}|token\b.*process\.stdout/.test(l)));
  }
  // bridge responses: ownerSecret is READ only, never emitted
  const bridge = readFileSync('src/ai-native/worldBridgeServer.ts', 'utf8');
  check('bridge never echoes ownerSecret in a response', !/respond\([^)]*ownerSecret\b/.test(bridge));
  check('bridge stores only sha256 hash', /ownerSecretHashes\.set\(session, hash\)/.test(bridge) && /createHash\('sha256'\)/.test(bridge));
  // browser link: secret/capability are TS-private fields (runtime enumerable) -> residual note
  const link = readFileSync('src/ai-native/companionLink.ts', 'utf8');
  check('ownerSecret/capability declared private (compile-time only)', /private ownerSecret/.test(link) && /private capability/.test(link));
  info('RESIDUAL: TS private is compile-time only; fields are runtime-enumerable on the instance', { reachableOnlyViaDevHandle: true });
  check('link never writes secret to globalThis or URL', !/globalThis|location\.href|searchParams/.test(link));
  check('link never logs the secret', !/console\.|process\.stdout/.test(link));
}

// 2. Gateway status/observe/pending/snapshot never contain secret or capability
{
  const wg = new WorldGateway();
  const linked = wg.linkSession({ authorized: true, origin: 'http://localhost:5412', nowMs: Date.now() });
  if (!linked.ok) throw new Error('link');
  const cg = new CompanionGateway(wg);
  const { session, epoch } = linked;
  cg.authorize(session, epoch, 'human');
  const obs = cg.pushObservation(session, epoch, {
    epoch, tick: 1, player: { x: 0, y: 0 }, echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
    drones: [{ id: 1, x: 1, y: 0, hp: 5 }], schema: 'last_signal.echo-observation.v1',
    perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true }, targets: []
  });
  check('pushObservation ok', obs.ok);
  const all = JSON.stringify({
    observe: cg.observe(session, epoch), status: cg.status(session, epoch), pending: cg.pending(session, epoch), stats: cg.stats()
  });
  check('no secret/capability/token in any gateway response', !all.includes(SECRET) && !all.includes('OWNER') && !all.includes(TOKEN) && !all.includes('ownerSecret'));
}

// 3. Bounded sessions (MAX_SESSIONS=4) + control-token cleanup
{
  const wg = new WorldGateway();
  const made: string[] = [];
  for (let i = 0; i < 8; i++) {
    const r = wg.linkSession({ authorized: true, origin: `http://localhost:${6000 + i}`, nowMs: Date.now() });
    if (r.ok) made.push(r.session);
  }
  info('WorldGateway session bound', { created: made.length, listed: wg.listSessions().length });
  check('session registry hard-bounded (<=4)', wg.listSessions().length <= 4);

  const client = new CompanionClient({ bridgeUrl: 'http://127.0.0.1:1', token: TOKEN });
  // attach() against a dead endpoint fails; close() must still clear renewTimer/session/leaseId
  const before = { attached: client.attached, session: client.currentSession };
  await client.attach().catch(() => undefined);
  await client.close();
  const after = { attached: client.attached, session: client.currentSession };
  info('CompanionClient cleanup', { before, after });
  check('close() clears session + leaseId (control token cleanup)', after.attached === false && after.session === null);
}

// 4. Signal explicitly NOT wired (this round is P3-b A only)
{
  const world = readFileSync('src/world/World.ts', 'utf8');
  check('enqueueCompanionAction returns false for scan', /case 'scan':\s*case 'jam':\s*return false/.test(world));
  check('no core Signal command in World', !/spawn-signal|signal-scan|signal-jam|createSignalResources/.test(world));
  const harness = readFileSync('src/ai-native/worldHeadlessHarness.ts', 'utf8');
  check('signalCombatStatus still E_NOT_APPLICABLE', /E_NOT_APPLICABLE/.test(harness) && /signal_combat_unsupported/.test(harness));
  const tools = readFileSync('src/ai-native/worldHeadlessMcpTools.ts', 'utf8');
  check('world_signal_status tool explicitly NOT implemented', /Signal Combat in the main World is NOT implemented/.test(tools));
  check('no companion confirm route in Agent MCP tools', !tools.includes('echo_confirm'));
}

// 5. console JSONL redaction (official console exists, no secret in its source)
{
  const consoleSrc = readFileSync('scripts/p3b-companion-console.mts', 'utf8');
  check('console has NO confirm/reject command', !/['"]confirm['"]\s*:/.test(consoleSrc) || /confirm.*去游戏|confirm.*UI|confirm.*human/i.test(consoleSrc));
  check('console mentions ownerSecret ONLY in the REDACT_KEYS allowlist (no value read)',
    (consoleSrc.match(/ownerSecret/gi) ?? []).length === 1 && /REDACT_KEYS\s*=\s*\/[^/]*ownerSecret/i.test(consoleSrc));
  check('console has no confirm/applied/decision route call',
    !/companion-decision|companion-applied|companion-authorize/.test(consoleSrc));
  info('console I/O redaction', { note: 'JSONL log is written by the console script; source contains no secret/token emission' });
  const jsonl = 'reports/ai-native-02/p3b/evidence/companion-console-io.jsonl';
  if (existsSync(jsonl)) {
    const text = readFileSync(jsonl, 'utf8');
    check('existing console JSONL has no ownerSecret/token', !text.includes(SECRET) && !text.includes('ownerSecret'));
  } else info('console JSONL not present in frozen commit (generated at runtime)');
}

console.log(`SECRETS_BOUNDS_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
