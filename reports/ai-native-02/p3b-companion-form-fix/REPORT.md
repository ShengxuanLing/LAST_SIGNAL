# P3-b Companion form fix (real UI authorization)

**Scope:** fix the real in-game companion authorization broken at `7fd4a2e`:
the Pause "LLM COMPANION > ENABLE / RE-AUTHORIZE" path only stashed the owner
key and called `authorizeCompanionFromConfig()`, which read `globalThis.__externalLinkConfig`
for bridgeUrl/token. In a fresh page there is no such global, so the form
silently returned false (host pre-injected E2E/smoke masked the breakage).

## Fix (no global for normal UI)

- `GameScene.authorizeCompanion(bridgeUrl, token, ownerKey)` takes the masked
  form values DIRECTLY. `authorizeCompanionFromConfig()` is kept only as a
  compat wrapper for pre-injected host config; normal UI never relies on it.
- `PauseScene.openExternalLinkForm('companion')` passes the form's
  `bridgeUrl`/`token`/`ownerKey` straight to `authorizeCompanion(...)`;
  secrets are cleared from the DOM after submit, the raw owner key lives only
  in the private `OwnerPairing`/`#private` holder.
- RE-AUTHORIZE on a live link uses `GameScene.reauthorizeCompanion(ownerKey)`
  (atomic capability swap; old cap invalidated + pending suggestions cancelled;
  wrong key does not break the active connection). A fresh session requires an
  explicit new Owner grant.

## Agent `echo_status` readonly

- `companion-status` GET (and `companion-memory`, `companion-observation` GET)
  are token-only, no Origin and no `ownerCap` required — the official Agent
  MCP/console can call `echo_status`/`echo_memory`/`echo_observe` with just the
  token/lease. Owner MUTATIONS (authorize/mode/observation POST/decision/
  applied/disconnect) still require Origin + issued capability.
- `companion-suggestions` GET (Owner suggestion read) still requires the
  capability.

## Real fallback / receipt

- `CompanionLink` has a bounded heartbeat; on bridge close / lease loss it
  degrades to `FALLBACK:NO_MODEL`, clears pending work. HUD reflects NO MODEL.
- `companion-applied` receipt is posted by `GameScene` only AFTER a real core
  tick consumed the confirmed intent (`world.sim.tick > enqueuedTick`), never
  early and never while paused with no tick. This removes a premature 409.

## Tests

- New real-form E2E: `tests/p3b-companion-owner.spec.ts` — masked form →
  CONNECTED → Agent token-only suggest → Agent confirm refused → Owner CONFIRM
  → close pause → real core tick fires an echo projectile → disconnect.
  Plus a lease-loss test: close the bridge → HUD degrades to COMPANION NO MODEL.
- Updated legacy E2E fixtures to the independent Owner pairing key
  (`TEST_OWNER_KEY`/`TEST_OWNER_KEY_HASH`) without weakening attack negatives:
  `c3b-external-link`, `c3b-hard-disconnect`, `c3b-link-form`,
  `c3c-bridge-reclaim`.
- Unit: 673/673; ownerAuth C1–C8 attack chains unchanged and passing.

## Boundaries

- No merge/push/stash. No HP/resource tampering in tests; the Owner-confirm
  helper is a fixture (the form/UI confirmation is the real path).
- This does NOT claim an LLM suggestion was run; it is the real in-game form +
  Agent interface test only.
