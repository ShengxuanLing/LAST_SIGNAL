# PR Draft — 不 push，不创建 PR

## Title

`feat(ai-native): complete AI-NATIVE-02 Player, ECHO Companion and Signal collaboration`

## Body

### Summary

This PR delivers the AI-NATIVE-02 integration on `feat/ai-native-world-integration` at code commit `d1f29d1aa25ecf0fb461e756948de979019b3a26`:

- Formal World human/local-AI/external Player share one legal `PlayerIntent` path; fixed-tick authoritative core and Rendered↔Headless canonical parity.
- Formal ECHO companion actor with bounded observation/memory, independent Owner pairing + agent token isolation, official Companion MCP without a confirm tool.
- Optional Signal collaboration: explicit persisted opt-in, real Relay device, T/Y/R player controls, v1/v2 tool authority, ECHO scan/jam/toggle only after independent Owner confirmation, ACTIVE-only portal gating, real cooperation E2E and SDK negative matrix.
- Field fixes after the first Signal model round: echo room migration, truthful memory/availability, room-generation retirement, synchronous room barrier, stale applied evidence, and source-bound Companion toggles that preserve human R global control.
- Final E2E fix: `World.sim` snapshot invalidation for direct spawns, plus PORT-aware boss-room/canvas specs.

### Code commit / branch

- Code HEAD: `d1f29d1aa25ecf0fb461e756948de979019b3a26` (tree `aff25064cf9922ba3cf333ef4fd0dabed65e6972`)
- Branch: `feat/ai-native-world-integration`
- `origin/main`: `c2215518e3a0520370e5e6f61bd9ec9ad4e625d7`
- Not merged, not pushed, no PR created.
- Final-delivery docs are untracked under `reports/ai-native-02/final-delivery/`; no source/test change in this docs phase.

### Verification

- Typecheck, client build, MCP build, F-03 production handle gate: PASS.
- Full unit: 743/743 (64 files, same tree).
- Default Player MCP / Headless MCP / Companion MCP smoke: PASS.
- Final full E2E on own port 5411: **88/88 passed** (32 specs), including boss-room and canvas via `PORT` (old defaults preserved).
- `World.sim` now invalidates after direct `spawnEnemy`/`spawnBoss`; the c3c Rendered export + Node 16-check replay pass.
- Full details: `reports/ai-native-02/final-delivery/GATES.md` and `PHASE-CLOSURE.md`.

### Review focus

- `World.enqueueCompanionAction` is the only producer of internal `originRoomId`; core re-validates it for Companion toggles only.
- Human R / Owner-dev toggle remains global (c233 behavior).
- `CompanionGateway.markApplied` requires explicit original generation+room for stale records.
- Room generation/barrier and stale-receipt semantics.
- `World.sim` cache invalidation after direct spawns and the old-port `PORT` compatibility.

### Known limitations

See `reports/ai-native-02/final-delivery/NON-BLOCKING-LIMITS.md`:

- rejected toggle has no event trace;
- parity does not cover `originRoomId`;
- `c3c-headless-parity` fixed in `d1f29d1` (cache invalidation + regenerated fixture);
- no E2E failures;
- boss-room/canvas old defaults kept, now runnable on an owned port;
- legacy non-drone FSM remains adapter-side;
- no final human acceptance, no cross-machine stability.

### Human acceptance still required

The Owner CONFIRM / Authorize actions in model evidence are automated UI fixtures, not a human sign-off. A real human should run the three demos in `DEMO.md` and accept the result.
