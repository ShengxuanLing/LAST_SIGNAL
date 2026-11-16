# AI-NATIVE-02 P3-b — Owner Authorization Fix

**Report:** reports/ai-native-02/p3b-owner-auth-fix/REPORT.md
**Branch:** feat/ai-native-world-integration (sole writer, no merge/push/stash)
**Commits:** independent small commit (see git log)

## Summary

Fixed the Companion authorization vulnerability (reviewer P3-b A finding B1) so that an Agent holding the bridge token and a public Origin can NEVER self-handshake, self-authorize, overwrite the human's Owner authority, fabricate observations, flip External→Human mode, or confirm/apply decisions. All Renderer mutations now require a bridge-issued Owner session capability, and the initial human proof is a host-private pairing key that never leaves the human UI.

## The vulnerability (fixed)

The previous design let an Agent re-run `companion-authorize` with its own secret and overwrite the human's registration, then self-confirm. `originMatches` only compared the public `Origin` header, which an Agent (local process) can forge. The bridge stored whatever `ownerSecretHash` the caller sent, with no check that the caller already owned the session.

## What changed

### New modules
- `src/ai-native/ownerCredential.ts` — HOST-ONLY. Generates a 32-byte Owner pairing key into a current-user-private file (`mkdtemp` + `hardenOwnerDirectory`/`hardenOwnerFile` from `secureTokenFile`, POSIX 0600 / Windows current-SID-only `icacls`). Returns ONLY path + ACL + `keyHash`; the raw key is never returned, logged, or exposed. `ownerHashEquals` does constant-time digest comparison.
- `src/ai-native/ownerPairing.ts` — BROWSER-ONLY. Holds the raw human pairing key and the bridge-issued session capability in ECMAScript `#private` fields (non-enumerable, absent from `JSON.stringify`), keyed by a module-private `WeakMap`. `stashOwnerPairing` / `peekOwnerPairing` / `clearOwnerPairing` / `swapCap` / `consumeKey`.

### Bridge (`src/ai-native/worldBridgeServer.ts`)
- `WorldBridgeOptions.ownerKeyHash` (sha256 of the host pairing key) is now REQUIRED at bridge start; the raw key never enters options/logs.
- `handshake` requires `ownerKey` (proves human possession of the host-private key). Agent token + forged Origin is NOT enough — no self-handshake path exists. On success the bridge issues ONE `ownerCap` (32-byte random, hash-stored) and returns it ONLY in the renderer response.
- Every renderer mutation — `companion-authorize` (registration + atomic re-authorization swap), `companion-observation` POST, `companion-suggestions` GET, `companion-decision`, `companion-applied`, `companion-mode`, `companion-disconnect`, `heartbeat`, `next-action`, `action-ack`, `yield`, `close` — requires the issued capability (`capOk`, constant-time hash compare). Origin is still checked but is NOT authentication.
- `companion-authorize` re-authorization atomically swaps the capability: the old capability stops working immediately and pending work is cancelled.
- Agent routes (attach, observe, suggest, status, agent-*, etc.) remain token-only and never receive or can forge the Owner capability.

### Companion gateway (`companionGateway.ts`)
- `decide` now uses `validateOwnerDecision` — ONE pure validator shared with `CompanionOwnerLedger` — enforcing strict confirm/reject enum, current & monotonic epoch, `tick >= createdAtTick`, TTL (`E_ACTION_EXPIRED`), no duplicate execution. No route reimplements this logic.
- `markApplied` only succeeds for a `confirm` decision with `appliedTick >= decidedAtTick`; a rejected decision can never become `applied`.

### Companion link (`companionLink.ts`)
- `ownerSecret`/`capability` are now `#private` fields; `toJSON()` returns `{}`. No raw secret survives `JSON.stringify`/enumeration. The human pairing key is one-shot (consumed at handshake), then cleared.

### External link clients (`externalLinkClient.ts`, `externalLinkController.ts`)
- `handshake(ownerKey)` sends the pairing key once and discards it; the issued `ownerCap` is carried on every subsequent renderer request and scrubbed on `forgetCredentials`/`dispose`. The key is never stored in `globalThis.__externalLinkConfig`.

### UI (`GameScene.ts`, `PauseScene.ts`)
- The Pause "EXTERNAL AGENT LINK" and "COMPANION OWNER PAIRING" forms include a masked `ownerPairingKey` field (`type=password`, cleared from the DOM immediately after submit). The raw key lives only in the `ownerPairing` module-private WeakMap / `#private` fields, never in `__externalLinkConfig`.
- `GameScene.authorizeExternalAgent(bridgeUrl, token, ownerKey)`; external protagonist activation sets the companion `READ_ONLY` in the same human action (G4 fix).
- `GameScene.reauthorizeCompanion(ownerKey)` supports atomic re-authorization with capability swap.

### Bridge launcher (`scripts/c3b-bridge.mts`)
- Generates a SEPARATE owner pairing key via `createOwnerCredentialFile()`, prints only `OWNER_KEY_FILE` / `OWNER_KEY_ACL` (path + ACL metadata, never the key), passes `ownerKeyHash` to the bridge, and cleans both private files on stop. The Owner key never enters MCP env / attach / observation / console.

## Verification (gate)

All gates green:

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` | PASS |
| Unit tests | `npm test` | PASS (57 files / 673 tests) |
| MCP build | `npm run game:mcp:build` | PASS |

The 8 Owner/security test files (including the new regression chains) and all legacy bridge tests pass.

## Permanent regression chains (ownerAuth.test.ts)

Each chain is an independent, one-line PASS/FAIL assertion that must stay green:

| Chain | What it proves |
|-------|----------------|
| C1 self-handshake | No human pairing key ⇒ handshake 403 `world.owner_pairing_required` |
| C2 self-authorize | Token + public Origin, no key ⇒ `companion-authorize` 403 |
| C3 reauthorize overwrite | Agent cannot replace the human's capability with its own key ⇒ 403 |
| C4 reauthorize same-key | Same human atomically swaps the capability; old capability immediately 403 |
| C5 fake observation | Agent cannot publish a fabricated Boss/relay observation without the capability ⇒ 403 |
| C6 mode flip | Agent cannot flip external→human to enable confirm ⇒ 403 |
| C7 confirm/applied | Unknown/replayed decisions cannot execute; rejected decisions never become applied |
| C8 disconnect | Explicit `NO_MODEL` fallback; capability cleared, subsequent status reads rejected |

## Constraints honored

- No merge/push/stash; sole writer on `feat/ai-native-world-integration`.
- Owner key never enters Agent/MCP env, attach, observation, or console.
- Origin checked but is not authentication.
- `CompanionGateway.decide` reuses the strict `OwnerLedger` pure validator.
- `markApplied` only after confirm + real core postcommit (`appliedTick >= decidedAtTick`).
- `#private` fields; nothing enumerable or JSON-serializable leaks.
- LLM suggestions never run / never claimed as run; no fake confirmation.
- C2/C3b/C3c frozen; no regression (full suite green).

## Next

Await Reviewer/Tester independent acceptance of this Owner-auth fix before continuing P3-b C (formal Relay cooperation scene).