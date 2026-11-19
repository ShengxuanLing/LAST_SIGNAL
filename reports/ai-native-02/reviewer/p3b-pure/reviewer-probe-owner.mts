import {
  CompanionFacet, CompanionOwnerLedger, createOwnerCapability, isOwnerCapability,
  COMPANION_LIMITS, COMPANION_ACTOR_ID, COMPANION_SCHEMA,
  type CompanionObservationView
} from './src/ai-native/companionFacet';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));

let idCounter = 0;
const sid = () => `sug_${(++idCounter).toString(16).padStart(24, '0')}`;
const SESSION = 'ses_aaaaaaaaaaaaaaaaaaaaaaaa';

const view = (overrides: Partial<CompanionObservationView> = {}): CompanionObservationView => ({
  epoch: 1, tick: 10,
  echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
  player: { x: 2, y: 0 },
  drones: [{ id: 1, x: 1, y: 0, hp: 20 }],
  ...overrides
} as CompanionObservationView);

const facet = (epoch = 1) => new CompanionFacet({ session: SESSION, epoch, suggestionIdFactory: sid });
const propose = (f: CompanionFacet, kind: any = 'move') => {
  f.observe(view());
  const r = f.suggest({ kind, reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600 });
  if (!r.ok) throw new Error(`propose failed: ${r.code} ${r.messageKey}`);
  return r.value;
};
const cap = () => createOwnerCapability(SESSION);

// ---------------------------------------------------------------------------
// 1. OWNER CAPABILITY — module-private Symbol vs PUBLIC factory
// ---------------------------------------------------------------------------
check('createOwnerCapability is a PUBLIC export (any importer can mint)', typeof createOwnerCapability === 'function');
const real = cap();
check('real capability passes isOwnerCapability', isOwnerCapability(real));
check('capability object is frozen', Object.isFrozen(real));
check('capability carries kind=OWNER and the session', real.kind === 'OWNER' && real.session === SESSION);

// Forgery from token / Origin / JSON / plain object / same-description symbol
const fakeSym = Symbol('last_signal.companion.owner.v1');
const globalSym = Symbol.for('last_signal.companion.owner.v1');
for (const [n, forged] of [
  ['token+Origin', { kind: 'OWNER', session: SESSION, token: 'secret', origin: 'http://localhost:5335' }],
  ['plain OWNER object', { kind: 'OWNER', session: SESSION }],
  ['same-description Symbol', { kind: 'OWNER', session: SESSION, [fakeSym]: true }],
  ['Symbol.for global', { kind: 'OWNER', session: SESSION, [globalSym]: true }],
  ['JSON round-trip (symbols dropped)', JSON.parse(JSON.stringify(real))],
  ['string', 'Bearer secret'], ['null', null], ['number', 42],
] as Array<[string, unknown]>) check(`forged ${n} rejected`, !isOwnerCapability(forged));

// CRITICAL: the factory itself is importable => pure module is NOT a security boundary
const agentMinted = createOwnerCapability(SESSION); // simulates an agent-side `import`
check('AGENT-SIDE import of the public factory mints a VALID capability', isOwnerCapability(agentMinted));
const fMint = facet(); const sMint = propose(fMint);
const ledgerMint = new CompanionOwnerLedger(fMint);
const mintDecision = ledgerMint.decide({ capability: agentMinted, suggestionId: sMint.suggestionId, decision: 'confirm', epoch: 1, tick: 11 });
check('agent-minted capability passes ledger.decide (no process boundary)', mintDecision.ok && mintDecision.value.session === SESSION,
  mintDecision.ok ? undefined : { code: mintDecision.code, key: mintDecision.messageKey });

// Capability-object leakage vectors (symbol is enumerable on the frozen object)
const sym = Object.getOwnPropertySymbols(real)[0];
const forgedFromLeak = { kind: 'OWNER', session: SESSION, [sym]: true };
check('symbol extracted from a LEAKED capability forges another valid capability', isOwnerCapability(forgedFromLeak));
check('object spread of a leaked capability forges another valid capability', isOwnerCapability({ ...real }));
check('Object.create(real) inherits the private symbol and passes', isOwnerCapability(Object.create(real)));
info('OWNER_CAPABILITY symbol description', { desc: String(sym), enumerable: Object.prototype.propertyIsEnumerable.call(real, sym) });

// ---------------------------------------------------------------------------
// 2. CompanionOwnerLedger.decide — session / epoch / human / connected / TTL / duplicates
// ---------------------------------------------------------------------------
{
  const f = facet(); const s = propose(f); const L = new CompanionOwnerLedger(f);
  const base = { suggestionId: s.suggestionId, decision: 'confirm' as const, epoch: 1, tick: 11 };
  const r = (over: Record<string, unknown>) => L.decide({ ...base, ...over } as any);
  check('no capability -> E_PERMISSION', !r({ capability: undefined }).ok && (r({ capability: undefined }) as any).code === 'E_PERMISSION');
  check('forged token -> E_PERMISSION', (r({ capability: { token: 'x', origin: 'http://localhost:5335' } }) as any).code === 'E_PERMISSION');
  check('wrong session -> E_PERMISSION', (r({ capability: createOwnerCapability('ses_bbbbbbbbbbbbbbbbbbbbbbbb') }) as any).code === 'E_PERMISSION');
  check('stale epoch -> E_STALE_EPOCH', (r({ capability: cap(), epoch: 99 }) as any).code === 'E_STALE_EPOCH');
  check('NaN tick -> E_SCHEMA', (r({ capability: cap(), tick: Number.NaN }) as any).code === 'E_SCHEMA');
  check('Infinity tick -> E_SCHEMA', (r({ capability: cap(), tick: Number.POSITIVE_INFINITY }) as any).code === 'E_SCHEMA');
  f.setOwnerMode('ai');
  check('ownerMode ai -> E_PERMISSION', (r({ capability: cap() }) as any).code === 'E_PERMISSION');
  f.setOwnerMode('external');
  check('ownerMode external -> E_PERMISSION', (r({ capability: cap() }) as any).code === 'E_PERMISSION');
  f.setOwnerMode('human');
  f.setLink('fallback');
  check('link fallback -> E_LINK_UNAVAILABLE', (r({ capability: cap() }) as any).code === 'E_LINK_UNAVAILABLE');
  f.setLink('connected');
  check('fallback cancelled the suggestion -> E_TARGET_DESTROYED', (r({ capability: cap() }) as any).code === 'E_TARGET_DESTROYED');
}
{
  // duplicate / repeated confirm cannot double-execute
  const f = facet(); const s = propose(f); const L = new CompanionOwnerLedger(f);
  const d1 = L.decide({ capability: cap(), suggestionId: s.suggestionId, decision: 'confirm', epoch: 1, tick: 11 });
  check('first confirm succeeds', d1.ok);
  const d2 = L.decide({ capability: cap(), suggestionId: s.suggestionId, decision: 'confirm', epoch: 1, tick: 12 });
  check('2nd confirm same id -> E_RETRYABLE (no double execution)', !d2.ok && (d2 as any).code === 'E_RETRYABLE');
  const d3 = L.decide({ capability: cap(), suggestionId: s.suggestionId, decision: 'reject', epoch: 1, tick: 13 });
  check('confirm then reject same id -> E_RETRYABLE', !d3.ok && (d3 as any).code === 'E_RETRYABLE');
  check('ledger.list() has exactly ONE decision', L.list().length === 1);
  check('decision frozen', Object.isFrozen(L.list()[0]));
  check('suggestion stays proposed (ledger never executes)', f.pendingSuggestions()[0]?.status === 'proposed');
  const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(f));
  const ledgerProto = Object.getOwnPropertyNames(Object.getPrototypeOf(L));
  for (const forbidden of ['confirm', 'reject', 'execute', 'step', 'stepPlayer', 'restoreSnapshot'])
    check(`no ${forbidden} on facet/ledger prototypes`, !proto.includes(forbidden) && !ledgerProto.includes(forbidden));
  check('decision records actorId=1, epoch=1, decidedAtTick=11', d1.ok && d1.value.actorId === COMPANION_ACTOR_ID && d1.value.epoch === 1 && d1.value.decidedAtTick === 11);
}
{
  // TTL boundary: decide at/after expiresAtTick is refused, list stays empty
  const f = facet(); const s = propose(f); const L = new CompanionOwnerLedger(f);
  const atExpiry = L.decide({ capability: cap(), suggestionId: s.suggestionId, decision: 'confirm', epoch: 1, tick: s.expiresAtTick });
  check('decide at expiresAtTick -> refused', !atExpiry.ok, { code: (atExpiry as any).code });
  info('TTL refusal code (advanceTo evicts first, so E_ACTION_EXPIRED is unreachable)', { code: (atExpiry as any).code });
  check('no decision recorded for expired suggestion', L.list().length === 0);
  check('expired suggestion removed from pending', f.pendingSuggestions().length === 0);
}
{
  // epoch rebind invalidates pending but OLD decisions PERSIST (wiring caveat)
  const f = facet(); const s = propose(f); const L = new CompanionOwnerLedger(f);
  const d = L.decide({ capability: cap(), suggestionId: s.suggestionId, decision: 'confirm', epoch: 1, tick: 11 });
  check('epoch-1 decision recorded', d.ok);
  f.rebindEpoch(2);
  check('rebindEpoch cancels pending suggestions', f.pendingSuggestions().length === 0);
  info('epoch-1 decision still present in list() after rebind (consumer must filter by epoch)', { count: L.list().length, epochs: L.list().map((x) => x.epoch) });
  const stale = L.decide({ capability: cap(), suggestionId: s.suggestionId, decision: 'confirm', epoch: 1, tick: 12 });
  check('old-epoch decide after rebind -> E_STALE_EPOCH', !stale.ok && (stale as any).code === 'E_STALE_EPOCH');
}
{
  // runtime decision value is NOT validated (TS type only)
  const f = facet(); const s = propose(f); const L = new CompanionOwnerLedger(f);
  const d = L.decide({ capability: cap(), suggestionId: s.suggestionId, decision: 'execute' as any, epoch: 1, tick: 11 });
  info('decide() does not runtime-validate decision enum', { ok: d.ok, recorded: d.ok ? (d.value as any).decision : (d as any).code });
}

// ---------------------------------------------------------------------------
// 3. snapshot — bounded, frozen, no auth/hidden state, no restore
// ---------------------------------------------------------------------------
{
  const f = facet();
  const s = propose(f);
  const snap = f.snapshot();
  check('snapshot frozen (deep)', Object.isFrozen(snap) && Object.isFrozen(snap.memory) && Object.isFrozen(snap.pending));
  check('snapshot schema/actor/link/ownerMode', snap.schema === COMPANION_SCHEMA && snap.actorId === COMPANION_ACTOR_ID && snap.link === 'connected' && snap.ownerMode === 'human');
  check('snapshot carries hard bounds', snap.dedupLimit === COMPANION_LIMITS.MAX_DEDUP_RECORDS && snap.suggestionLimit === COMPANION_LIMITS.MAX_UNCONFIRMED && snap.suggestionTtlTicks === COMPANION_LIMITS.SUGGESTION_TTL_TICKS && snap.memoryTtlTicks === COMPANION_LIMITS.MEMORY_TTL_TICKS);
  check('snapshot pending bounded <= 8', snap.pending.length <= COMPANION_LIMITS.MAX_UNCONFIRMED);
  check('snapshot memory bounded <= 16', snap.memory.length <= COMPANION_LIMITS.MEMORY_ENTRIES);
  const text = JSON.stringify(snap);
  for (const hidden of ['seed','rngState','map','capability','OWNER_CAPABILITY','token','origin','hiddenTarget','energy','cooldowns'])
    check(`snapshot has no "${hidden}"`, !text.includes(`"${hidden}"`));
  check('snapshot drops all symbol keys', Object.getOwnPropertySymbols(snap).length === 0);
  check('snapshot.pending[0] stays proposed', snap.pending[0]?.status === 'proposed');
  check('no restoreSnapshot on facet prototype', !Object.getOwnPropertyNames(Object.getPrototypeOf(f)).includes('restoreSnapshot'));
  check('snapshot is diagnostic only: cannot re-arm authority', typeof (f as any).restore !== 'function' && typeof (f as any).loadState !== 'function');
}
{
  // bounded memory + hidden-target injection
  const f = facet();
  // A hidden target smuggled through the SHARED echoView `targets` field:
  const injected = view({
    drones: [{ id: 99, x: 5, y: 0, hp: 40 }],
    targets: [{ id: 77, kind: 'hunter', x: 999, y: 999, hp: 900, isBoss: true } as any]
  });
  const r = f.observe(injected);
  check('observe succeeds', r.ok);
  const mem = f.memory;
  check('memory contains ONLY perceived drones, never echoView.targets', mem.every((e) => e.kind === 'drone') && !mem.some((e) => e.id === 77 || e.id === 999), { mem });
  check('hidden target coordinates never enter memory', !JSON.stringify(mem).includes('999'));
  check('observation drones are distance-cropped to <= 12 tiles', r.ok && r.value.drones.every((d) => Math.hypot(d.x, d.y) <= COMPANION_LIMITS.PERCEPTION_TILES));
  // 40 drones in one observation -> recordMemory caps at 16
  const many = view({ drones: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, x: (i % 10) + 0.5, y: 0.5, hp: 5 })) });
  f.observe(many);
  check('memory hard cap 16 even with 40 perceived drones', f.memory.length <= COMPANION_LIMITS.MEMORY_ENTRIES, { len: f.memory.length });
  // INFO: pure facet trusts caller's crop; no LOS/explored predicate of its own
  const behindWall = view({ drones: [{ id: 5, x: 5, y: 0, hp: 10 }] });
  const rw = f.observe(behindWall);
  info('facet has NO internal LOS/explored check: a hidden drone placed in view.drones is still recorded (wiring must pass the shared cropped EchoView)', { recorded: f.memory.some((e) => e.id === 5), observed: rw.ok });
  // INFO: reason must be observable in CURRENT observation
  const noTarget = f.observe(view({ drones: [] }));
  check('no perceived drones -> no_perceived_target observation', noTarget.ok && noTarget.value.drones.length === 0);
  const badReason = f.suggest({ kind: 'fire', reason: 'perceived_hostile' });
  check('invented perceived_hostile with no drone rejected', !badReason.ok && (badReason as any).messageKey === 'companion.reason_unobserved', badReason.ok ? undefined : { code: (badReason as any).code });
}

console.log(`OWNER_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
