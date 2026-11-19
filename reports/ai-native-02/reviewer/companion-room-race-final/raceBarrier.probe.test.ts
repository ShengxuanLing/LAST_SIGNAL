// REVIEWER PROBE (not part of the frozen commit) — deterministic delayed
// ordering checks for c233e5c. Delays are represented by CONTROLLED PROMISES,
// not wall-clock sleeps, so every interleaving is reproducible.
import { afterEach, describe, expect, it } from 'vitest';
import { CompanionLink } from '../ai-native/companionLink';
import { CompanionFacet } from '../ai-native/companionFacet';
import { CompanionGateway } from '../ai-native/companionGateway';
import { WorldGateway } from '../ai-native/worldGateway';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from '../ai-native/ownerAuthFixture';
import { startWorldBridge } from '../ai-native/worldBridgeServer';
import { randomBytes } from 'node:crypto';

const ORIGIN = 'http://localhost:5311';
const A = 3, B = 5, C = 7;
const sugId = (n: number) => 'sug_' + n.toString(16).padStart(24, '0');
const reqId = (n: number) => 'req_' + n.toString(16).padStart(24, '0');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

interface Route { path: string; body: any }
const originalFetch = globalThis.fetch;
const calls: Route[] = [];
let routes: Record<string, any> = {};

function mockFetch(): void {
  calls.length = 0;
  (globalThis as any).fetch = async (url: any, init: any) => {
    const path = (String(url).split('/world-link/')[1] ?? '').split('?')[0];
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ path: '/world-link/' + path, body });
    const handler = routes[path];
    const value = typeof handler === 'function' ? handler(body) : handler ?? { ok: true };
    // Support a bare promise OR an object whose `promise` is controllable.
    const resolved = value && typeof value === 'object' && 'promise' in value ? await value.promise : value;
    return { ok: true, status: 200, json: async () => resolved };
  };
}
afterEach(() => { (globalThis as any).fetch = originalFetch; routes = {}; });

function makeLink(onApply: (kind: string, target?: any, id?: string) => boolean = () => true) {
  return new CompanionLink({
    bridgeUrl: 'http://127.0.0.1:1', token: 't', origin: ORIGIN,
    session: 'ses_probe', epoch: 1, ownerCap: 'cap',
    observation: () => null, apply: onApply, appliedTick: () => 10,
    heartbeatIntervalMs: 3_600_000
  });
}

function oldSuggestion(roomId: number, n = 1): any {
  return {
    schema: 'last_signal.companion.v1', session: 'ses_probe', epoch: 1,
    suggestionId: sugId(n), actorId: 1, kind: 'scan', reason: 'perceived_relay',
    target: null, confidence: null, createdAtTick: 1, expiresAtTick: 1000,
    status: 'proposed', roomId, generation: 1
  };
}

describe('c233e5c local room barrier — deterministic delayed probes', () => {
  it('L1 room POST in flight (4s equivalent): old confirm refused synchronously, zero apply', async () => {
    mockFetch();
    routes['companion-authorize'] = { ok: true, ownerCap: 'cap2' };
    const applied: string[] = [];
    const link = makeLink((_k, _t, id) => { applied.push(id ?? ''); return true; });
    link.enterRoom(A, 10);
    expect(await link.authorize()).toBe(true);

    const roomPost = deferred<any>();
    routes['companion-room'] = roomPost;               // POST never resolves yet
    const notifying = link.notifyRoom(B, 20);          // in flight
    link.enterRoom(B, 20);                             // COMMITTED boundary (sync)
    const decided = await link.decide(oldSuggestion(A), 'confirm');
    expect(decided, 'old proposal refuses immediately').toBe(false);
    expect(link.error).toBe('E_STALE_GENERATION companion.suggestion_room_changed');
    expect(applied, 'apply must never run for the old room').toEqual([]);
    roomPost.resolve({ ok: true });
    await notifying;
    expect(link.roomId).toBe(B);
    expect(link.roomGeneration).toBe(2);
    link.disconnect();
  });

  it('L2 decision POST in flight (6s equivalent) answers ok AFTER a room change: still no apply', async () => {
    mockFetch();
    routes['companion-authorize'] = { ok: true, ownerCap: 'cap2' };
    const applied: string[] = [];
    const link = makeLink((_k, _t, id) => { applied.push(id ?? ''); return true; });
    link.enterRoom(A, 10);
    await link.authorize();

    const decision = deferred<any>();
    routes['companion-decision'] = decision;           // response held
    const deciding = link.decide(oldSuggestion(A, 2), 'confirm');
    link.enterRoom(B, 30);                             // room changes before response
    decision.resolve({ ok: true, value: { suggestionId: sugId(2), decision: 'confirm' } });
    expect(await deciding, 'server ok is irrelevant after authority change').toBe(false);
    expect(applied).toEqual([]);
    expect(link.error).toContain('E_STALE_GENERATION');
    link.disconnect();
  });

  it('L3 pending() response from an abandoned room is never surfaced', async () => {
    mockFetch();
    routes['companion-authorize'] = { ok: true, ownerCap: 'cap2' };
    const link = makeLink();
    link.enterRoom(A, 10);
    await link.authorize();
    const pending = deferred<any>();
    routes['companion-suggestions'] = pending;
    const reading = link.pending();
    link.enterRoom(B, 40);
    pending.resolve({ ok: true, value: [oldSuggestion(A, 3), oldSuggestion(B, 4)] });
    expect(await reading).toEqual([]);
    link.disconnect();
  });

  it('L4 same-generation stale list entry is locally filtered', async () => {
    mockFetch();
    routes['companion-authorize'] = { ok: true, ownerCap: 'cap2' };
    routes['companion-suggestions'] = { ok: true, value: [oldSuggestion(A, 5), oldSuggestion(B, 6)] };
    const link = makeLink();
    link.enterRoom(A, 10);
    await link.authorize();
    link.enterRoom(B, 50);
    const list = await link.pending();
    expect(list.map((s) => s.suggestionId)).toEqual([sugId(6)]);
    link.disconnect();
  });

  it('L5 local generation vs bridge generation: authorize, same-room, disconnect/reauth, A->B->C', async () => {
    const gateway = new WorldGateway();
    const companion = new CompanionGateway(gateway);
    const bridge = await startWorldBridge({
      gateway, token: randomBytes(24).toString('hex'),
      ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20,
      companions: companion
    } as never).catch(async () => null);
    // The bridge constructs its own CompanionGateway, so drive the public one
    // directly for the ledger and compare with a LINK's local counter.
    if (bridge) await bridge.close();
    const linked = gateway.linkSession({ authorized: true, origin: ORIGIN, nowMs: 1000 });
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    const session = linked.session, epoch = linked.epoch;
    companion.authorize(session, epoch, 'human');

    const link = makeLink();
    link.enterRoom(A, 10);                                    // local gen 1
    expect(link.roomGeneration).toBe(1);
    let r = await companion.roomChanged(session, epoch, A, 10, link.roomGeneration);
    expect(r.ok && r.value.generation).toBe(1);               // bridge gen 1

    // same-room repeat: no drift
    link.enterRoom(A, 11);
    r = await companion.roomChanged(session, epoch, A, 11, link.roomGeneration);
    expect(r.ok && r.value.generation).toBe(1);

    // disconnect + reauthorize: lifecycle changes, ROOM generation does not
    link.disconnect();
    await companion.authorize(session, epoch, 'human', true);
    link.enterRoom(A, 12);
    expect(link.roomGeneration, 'reauth must not reset/advance the room barrier').toBe(1);

    // rapid A->B->C, first report delayed: reports applied in C,B,A order
    link.enterRoom(B, 20); link.enterRoom(C, 30);
    expect(link.roomGeneration).toBe(3);
    const rc = await companion.roomChanged(session, epoch, C, 30, 3);
    const rb = await companion.roomChanged(session, epoch, B, 20, 2);   // late
    expect(rc.ok && rc.value.generation).toBe(2);
    expect(rb.ok && rb.value.stale).toBe(true);
    const st = companion.status(session, epoch);
    expect(st.ok && st.value.status.roomGeneration).toBe(2);
    expect(st.ok && st.value.status.roomId).toBe(C);
  });

  it('L6 same-room notify repeated 3x with a confirmed-unapplied decision keeps it confirmed', async () => {
    const gateway = new WorldGateway();
    const companion = new CompanionGateway(gateway);
    const linked = gateway.linkSession({ authorized: true, origin: ORIGIN, nowMs: 1000 });
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    const session = linked.session, epoch = linked.epoch;
    companion.authorize(session, epoch, 'human');
    await companion.roomChanged(session, epoch, A, 9, 1); // seed the start room
    expect(companion.pushObservation(session, epoch, {
      epoch, tick: 10, player: { x: 0, y: 0 },
      echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
      drones: [], targets: [],
      schema: 'last_signal.echo-observation.v1',
      perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true }
    }).ok).toBe(true);
    expect(companion.suggest({
      session, epoch, requestId: reqId(9), suggestionId: sugId(9),
      kind: 'scan', reason: 'no_perceived_target', ttlTicks: 600
    }).ok).toBe(true);
    expect(companion.decide({ session, epoch, suggestionId: sugId(9), decision: 'confirm', tick: 11 }).ok).toBe(true);
    const before = companion.status(session, epoch);
    const genBefore = before.ok ? before.value.status.roomGeneration : -1;
    for (let i = 0; i < 3; i += 1) {
      const repeat = await companion.roomChanged(session, epoch, A, 12 + i, 1);
      expect(repeat.ok && repeat.value.stale, 'same-room repeat is a stale no-op').toBe(true);
    }
    const after = companion.status(session, epoch);
    expect(after.ok && after.value.status.roomGeneration).toBe(genBefore);
    const receipt = after.ok ? after.value.receipts.find((x) => x.suggestionId === sugId(9)) : null;
    expect(receipt).toMatchObject({ status: 'confirmed' });
  });

  it('L7 late markApplied: original generation truthful; foreign generation refused; omitted generation on a stale record', async () => {
    const gateway = new WorldGateway();
    const companion = new CompanionGateway(gateway);
    const linked = gateway.linkSession({ authorized: true, origin: ORIGIN, nowMs: 1000 });
    if (!linked.ok) return;
    const { session, epoch } = linked;
    companion.authorize(session, epoch, 'human');
    await companion.roomChanged(session, epoch, A, 19, 1); // decisions are made in generation 1 / room A

    async function confirmed(id: string, n: number) {
      expect(companion.pushObservation(session, epoch, {
        epoch, tick: n, player: { x: 0, y: 0 },
        echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
        drones: [], targets: [],
        schema: 'last_signal.echo-observation.v1',
        perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true }
      }).ok).toBe(true);
      expect(companion.suggest({
        session, epoch, requestId: reqId(n), suggestionId: id,
        kind: 'scan', reason: 'no_perceived_target', ttlTicks: 600
      }).ok).toBe(true);
      expect(companion.decide({ session, epoch, suggestionId: id, decision: 'confirm', tick: n + 1 }).ok).toBe(true);
    }

    // (a) original-generation late receipt stays truthfully applied
    await confirmed(sugId(11), 20);
    await companion.roomChanged(session, epoch, B, 21, 2);
    const good = companion.markApplied(session, sugId(11), 22, { generation: 1, roomId: A });
    expect(good.ok, JSON.stringify(good)).toBe(true);
    const st = companion.status(session, epoch);
    expect(st.ok && st.value.receipts.find((r) => r.suggestionId === sugId(11))).toMatchObject({
      status: 'applied', appliedTick: 22
    });

    // (b) a receipt claiming another generation is refused
    await confirmed(sugId(12), 30);
    await companion.roomChanged(session, epoch, C, 31, 3);
    const foreign = companion.markApplied(session, sugId(12), 32, { generation: 3, roomId: C });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.code).toBe('E_STALE_GENERATION');

    // (c) legacy/omitted execution on a STALE decision: does it get through?
    await confirmed(sugId(13), 40);
    await companion.roomChanged(session, epoch, A, 41, 4);
    const pre = companion.status(session, epoch);
    console.log('L7 pre=' + JSON.stringify(pre.ok ? {gen: pre.value.status.roomGeneration, room: pre.value.status.roomId, recs: pre.value.receipts.filter(r=>r.suggestionId===sugId(13))} : pre));
    const omitted = companion.markApplied(session, sugId(13), 42);
    console.log('L7 omitted-generation-on-stale=' + JSON.stringify(omitted));
    expect(omitted.ok, 'DOCUMENTS ACTUAL BEHAVIOUR').toBe(true);
  });

  it('L8 tombstone FIFO eviction (512) still refuses an old id', () => {
    const facet = new CompanionFacet({ session: 'ses_tomb', epoch: 1 });
    for (let i = 0; i < 513; i += 1) facet.applyRoomChange(100 + i, i, [sugId(i)]);
    expect(facet.cancelledSuggestionIds().length).toBe(512);
    expect(facet.roomCancellation(sugId(0))).toBeNull();
    expect(facet.expiredSuggestionIds()).toContain(sugId(0));
  });
});
