# P3-b Companion session lifecycle fix

**Scope:** fix the real Companion session lifecycle after the unmasked form
authorization at `ae8b4e2`. Lead observed from a fresh UI pairing:
`echo_observe` first `E_LINK_UNAVAILABLE/no_observation`, then `E_STALE_EPOCH`;
no suggestion could succeed. Root causes were all real (not test-only):

## Root causes and fixes

1. **No observation until a game frame runs.** The rendered frame only called
   `pushObservation()` inside `update()` (every 30 frames), which returns early
   while paused — so after authorization the Agent saw `no_observation`.
   Fix: `GameScene.authorizeCompanion()` pushes the committed echo observation
   immediately after a successful authorize, without resuming the tick.

2. **Pause let the rendered session expire.** `startHeartbeat()` only did a
   `GET /companion-status` at a 5000ms default; it never renewed the gateway
   session, so after `LOST_AFTER_MS=5000` the session was reaped and its epoch
   bumped → `E_STALE_EPOCH`.
   Fix: the heartbeat now performs a real `POST /world-link/heartbeat` with the
   Owner capability every 1000ms (< LOST 5s), is idempotent, and degrades to
   `FALLBACK:NO_MODEL` on failure. It NEVER renews the independent Agent lease,
   so a dead Agent cannot be kept alive by the browser.

3. **Owner capability in the URL.** `CompanionLink.get()` put `ownerCap` in the
   query string. Fix: GET sends a dedicated `x-owner-cap` header (POST still uses
   the body); the bridge reads the header (query kept only as a compat
   fallback); CORS allows the header. The secret never enters a URL/log/screenshot.

4. **Fabricated decision tick.** `decide()` used `suggestion.createdAtTick + 1`.
   Fix: it uses the ACTUAL current core tick (`config.appliedTick()`); paused and
   same-as-create is legal (equal), and an expired observation is refused by the
   shared validator. The `companion-applied` receipt is posted by the Scene only
   after the core tick consumed the intent.

## Permanent E2E (no global config, no manual dev push/step)

`tests/p3b-companion-owner.spec.ts`:
- Real masked form (`bridgeUrl`/`token`/`ownerKey`) → CONNECTED.
- Owner enables echo + spawns a REAL drone while running; then PAUSES for 15s.
- Official Agent SDK (`dist-mcp/companionMcpServer.mjs`, token only) then
  `echo_observe` (ok, includes the real drone), `echo_status` (connected),
  `echo_memory`, `echo_suggest` — all succeed after 15s paused.
- Owner CONFIRM in the paused panel → resume → the next NORMAL core tick fires
  the echo action (real projectile). No forced step/flush.
- Hard-kill test: close the bridge → bounded heartbeat → HUD `COMPANION NO MODEL`.

Legacy E2E fixtures use the independent Owner pairing key and pass without
weakening attack negatives (`c3b-external-link` 9/9, `c3b-hard-disconnect` 1/1,
`c3b-link-form` 3/3 incl. five viewports, `c3c-bridge-reclaim` 2/2).

## Boundaries

- No merge/push/stash. No HP/resource tampering; the drone/echo are real core
  entities, the Owner confirm is the real UI path.
- This is a fixture-driven interface/lifecycle test; it does NOT claim an LLM
  suggestion was run. The real LLM ECHO run stays with the Lead.
