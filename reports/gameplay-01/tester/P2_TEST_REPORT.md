# GAMEPLAY-01 · P2 (ECHO local cooperation) — tester report (v3 frozen tree)

> Stage status: **P2 targeted + full new CI chain are green on the frozen v3 tree**.
> This is an ENGINEERING result for the frozen source generation below — **not** whole-project
> PASS and **not** human acceptance (`HUMAN ACCEPTANCE PENDING`); the real Magpie ECHO model
> chain still waits for the reviewer's security PASS.

## 0. Snapshot (every number below belongs to this tree)

| item | value |
|---|---|
| Isolated tree | `D:\tmp\ls-p2-v3-accept` (own `git clone`, own `npm ci`, real `node_modules`, no junction) |
| Base commit | `2c4584c` (+ the 10 P2 v3 sources; content-equal to the staged `87a0fac` for those files) |
| P2 sources | manifest `reports/gameplay-01/developer/p2/final/manifest.json` whitelist, **10/10 SHA256 verified** |
| Test snapshot | `tests/gameplay-02-echo-coop.spec.ts` `efef833c8a6c620674c10b2c3b5b3991b98800b48aad03f31859dc7c538c1724`; also `gameplay-01` `e1c01a95…`, `ai-native-world` `ef1d2e92…`, `ui-menu-layout` `8aa12c9e…` |
| Artifacts | **none borrowed**: no `dist-mcp`, no `reports/ai-native-02/signal/parity` at start; both produced in this tree |
| Env | runs used `PORT=5173` + second Vite on `5199` (canvas.spec hard constraint), `LS_SHOT_DIR`/`LS_AI_EVIDENCE_DIR` → `reports/gameplay-01/tester/p2-v3/run2/*`, logs carry workdir/spec/devRoot/commit |
| Known-bad v2 | `D:\tmp\ls-p2-accept` kept untouched as the restore counterexample (`p2-v2-known-bad.md`) |

## 1. New CI chain — all gates, same tree

| # | command | result | log |
|---|---|---|---|
| 1 | `npm run typecheck` (unfiltered, full output) | **PASS** 0 error | `reports/gameplay-01/tester/p2-v3/run2/logs/typecheck-unfiltered.log` |
| 2 | `npm test` | **PASS 794/794** (68 files) | `…\run2\logs\ci-chain.log` |
| 3 | `npm run test:mcp-surface` (builds MCP first) | **PASS 1/1** | `…\run2\logs\surface.log` |
| 4 | `npm run build` | **PASS** | `…\run2\logs\build.log` |
| 5 | dual Vite (5173 + 5199) + `npx playwright test --workers=1` | **PASS 131/131 (19.6m)**, skip 0, did-not-run 0 | `…\run2\logs\e2e-full.log` |
| 6 | fresh rendered export (mtime 23:40) + `npm run test:parity` | **PASS 3/3** | `…\run2\logs\parity.log` |

Grouping is reported as it is: 794 unit/rule (755 P1-era + 39 P2) + 1 MCP surface + 3 parity, plus 131 E2E.
Nothing from P1 history (125 non-green) is mixed in; the P1 `vs01` boundary assertions were not relaxed.

## 2. `tests/gameplay-02-echo-coop.spec.ts` — 6 cases, all real bodies (no skip / no env gate)

Targeted run: `PASS 6/6 (1.2m, skip 0)` → `…\run2\logs\targeted.log`; in the full chain all 6 also pass.

1. **single pending** — real menu: `ENABLE ECHO` → resume until the core echo actor exists and the tick advances → reopen `LOCAL COOPERATION`; the real `LOW-RISK COOPERATION` switch flips the flag; two real `CONFIRM (HUMAN)` clicks in one paused window leave **one** queue entry and the same pending action.
2. **REJECT LOCAL** — retires the pending local proposal and queues nothing.
3. **default OFF / owner gate** — fresh run OFF; human can enable and the choice is persisted in the real save; after the real `AI & COMPANION → AI CONTROL` path makes `owner === 'ai'`, the switch is refused.
4. **rawsim restore (Node side)** — the confirmed-but-uncommitted action is restored through the formal `HeadlessWorld.fromSimulationState`: `echoPendingLocal = { restored: true, kind, proposalId: null }` (conservative busy, unknown provenance), a new local confirm (old id and an arbitrary new id) is **false**, the queue keeps exactly the saved command, and one real tick executes the restored action **exactly once** (`signal-scanned` ×1, `energy = ENERGY_MAX − SCAN_COST`), then queue and busy marker clear with **no fabricated applied receipt**. No private guard field name is asserted.
5. **five viewports** (800/1024/1280/1366/1920) — proposal/WAITING text ≥ 10 CSS px, legal parent/child exceptions (same-control rect+label, non-interactive panel containing children), no intersection between two different interactive boxes, nothing clipped.
6. **old save** — a legacy-shaped save loads unchanged and cooperation defaults OFF with no invented proposal.

Why case 4 is Node-side: `World.restoreCheckpoint()` only accepts a full `RunCheckpoint` and `captureCheckpoint()` refuses to capture while commands are pending, so the confirmed-but-uncommitted frame can only be expressed as a raw sim. The earlier browser attempt failed with `restore succeeded = false` purely because `w.sim` was passed where a `RunCheckpoint` was expected — that log is marked **harness-shape** (`p2-v3/run1`), not a product bug.

## 3. Fixtures / runners (explicit)

- `runner: agent` = automated real mouse/keyboard in the browser; **no human played** anything here.
- `fixture` labels appear where a dev/test seam is used: `HeadlessWorld.fromSimulationState` (case 4) and the seed override (P1 spec). Case 4 is headless-only and proves the decision/queue contract, not a browser user flow.
- `autoOwner` is **not** used in this file. No cooperation proposal is ever invented; every accepted action comes from the model-free local policy with a real human-path confirm click.
- Real Magpie (`group/elisa`) ECHO chain: **not run** — waiting for the reviewer's security PASS; nothing here is a model run.

## 4. Remaining / not claimed

- Whole-project PASS is **not** claimed; P3–P5, the in-game real model chain and human acceptance remain open.
- P1 history (`125 non-green`, the later 7-case and HUD rounds) is preserved unchanged and is not folded into these numbers.
- The browser save→reload→CONTINUE cooperation case (queue not persisted; safe checkpoint semantics) is prepared as a plan in this report but **not implemented** in the spec yet; it must use a legitimate `RunCheckpoint`, never `w.sim`.
- Shared old `reports/**` were not written; all generated parity/screenshots live in the clone or `reports/gameplay-01/tester/p2-v3/**`.

## 5. One line per gate (recap)

- `npm run typecheck` → PASS(0) → `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\p2-v3\run2\logs\typecheck-unfiltered.log`
- `npm test` → PASS 794/794 → `…\run2\logs\ci-chain.log`
- `npm run test:mcp-surface` → PASS 1/1 → `…\run2\logs\surface.log`
- `npm run build` → PASS(0) → `…\run2\logs\build.log`
- `npx playwright test --workers=1`（dual Vite 5173+5199）→ PASS 131/131（skip 0）→ `…\run2\logs\e2e-full.log`
- `npm run test:parity`（fresh export 23:40）→ PASS 3/3 → `…\run2\logs\parity.log`
- targeted P2 spec → PASS 6/6（skip 0）→ `…\run2\logs\targeted.log`

---

## 6. Addendum — browser save/reload boundary (this round)

New snapshot: `tests/gameplay-02-echo-coop.spec.ts`
sha256 **`62e7d19abbbbb3a80adf6cdcc3b702d2a8feaf7ada25580a5b6111dcf76df20d`**
(7 tests; previous `efef833c…` had 6). Diff: case 6 rewritten (legacy-save must remove
**only** the new optional cooperation fields from a product-written save) and case 7 added
(real save + reload + CONTINUE boundary). No src change.

### 6.1 Result (final, this round)

New spec sha256 **`315078430983165ec995fa3e93e469ce38ff06c2d883a8c5054c965d86f873b6`** (7 tests).

| case | result | log |
|---|---|---|
| 6 legacy save (only the new optional fields removed) | **PASS ×3** | `reports/gameplay-01/tester/p2-v3/run8/logs/case67-run{1,2,3}.log` |
| 7 real save + reload + CONTINUE boundary | **PASS ×3** | same logs (both cases ran in the same targeted command) |
| whole P2 spec (7 cases) | **PASS 7/7 (1.6m, skip 0)** | `…/run8/logs/full-spec.log` |
| `npm run typecheck` (unfiltered, full output) | **PASS 0 error** | `…/run8/logs/typecheck.log` |

### 6.2 What the new cases prove

**Case 6 — legacy-but-valid save**: the product writes a REAL save (after the authored room
is cleared by real play, because `captureCheckpoint` refuses an uncleared room), then only
`permanent.echoCooperationOptIn` is removed. `CONTINUE` must still load the run, cooperation
must default **OFF**, and no proposal may be invented. A rejected arbitrary save would NOT
count (the fixture starts from a product-written valid save).

**Case 7 — real save + reload boundary (distinct from the rawsim restore case)**:
1. safe checkpoint written FIRST (queue empty at that moment),
2. a local action confirmed while paused → **queue 1, nothing applied**,
3. page reload → real `CONTINUE`,
4. assertions: same room and same authored demo restored, **no queued command survives**,
   **no busy/restored marker is invented**, **no applied receipt is fabricated**, and the
   relay/energy match the **saved** state (energy compared with the regen-tolerant
   invariant, never with a hard-coded literal).

### 6.3 Harness fixes made along the way (all in the test file only)

- `clearRoomByRealPlay()` — the authored room is cleared by REAL play (player-reachable
  jam-first strategy, real mouse aim, real movement keys; no enemy clearing, no teleport,
  no heal) because the product only captures checkpoints in a cleared room.
- `ensurePause()` / idempotent `openEchoPage()` — the pause overlay may already be open.
- Level-up overlay closed through the real card selection before touching the pause root.
- The jam wait is a measurement, not a hard requirement (the strategy continues un-jammed).
- Relay/energy compared against the **saved** state instead of a literal ACTIVE.

### 6.4 What is still not claimed

- The earlier 131/131 full chain belongs to the **previous** spec snapshot (`efef833c…`);
  this round changed the test file (7 cases) and the full 131-case suite was explicitly
  **not** re-run, so the new 7-case set is verified by its own targeted runs (7/7 ×1 + the
  two new cases ×3) and by a clean unfiltered typecheck.
- Case 4 (rawsim restore) stays the **Node-side** formal entry; it is not a browser save.
- No product verdict was changed by any of the intermediate reds — all of them were harness
  preconditions/mis-shaped comparisons, and every intermediate log is kept.

---

## 7. Evidence archival correction (v3 review finding)

The v3 reviewer is right that the historical `efef833c…` spec **bytes** no longer exist:
that version was edited forward into `62e7d19a…` → `31507843…` before any copy was archived.
No reconstruction was attempted.

| item | status | evidence |
|---|---|---|
| run8's 7/7 result | **log-verifiable** | `reports/gameplay-01/tester/p2-v3/run8/source-snapshot/logs/full-spec.log.txt` (header records `specSha=315078430983165e`) |
| run8's exact spec bytes | **verifiable (archived)** | `reports/gameplay-01/tester/p2-v3/run8/source-snapshot/tests/gameplay-02-echo-coop.spec.ts` — SHA256 `315078430983165ec995fa3e93e469ce38ff06c2d883a8c5054c965d86f873b6`, identical to the run header |
| the earlier `efef833c…` 131/131 run | **log-verifiable, byte-UNVERIFIABLE** | `.../p2-v3/run2/logs/e2e-full.log` (131 passed) — the spec bytes at that moment were later edited and no copy survives; the number stands as recorded, it is not recomputed and the new bytes are not passed off as that run |
| new reproducible snapshot | **run9: PASS 7/7** | `.../p2-v3/run9/logs/p2-full.log` + `run9/source-snapshot/{tests/,HASHES.txt}` — sha BEFORE run = AFTER run = archived = `31507843…` |

`HASHES.txt` records the spec hash before the run, after the run and of the archived copy;
all three are equal. The newer `2f343cb3…` file is the P3 **label-variant adaptation** and is
never claimed as P2 bytes (`../p3/run*/source-snapshot/`).

### 7.1 Archival rule now in force

`reports/gameplay-01/tester/ARCHIVE_RULE.md`: every gate-run directory carries
`source-snapshot/{tests,src,HASHES.txt,SNAPSHOT.md,logs/*.log.txt}` copied **from the run
tree**, hashed before/after; since `*.log` is gitignored, a durable `*.log.txt` copy is kept
inside the run directory. P3 runs already follow this (`p3/run1`, `p3/run2`).

## 8. Energy proof for case 7 — attempt, blocker, and the deterministic path

Reviewer M1 (saved 81 @ tick 138 → sample 85 @ tick 185 cannot exclude "scan −10 then
regen") is valid. The band-based fix is rejected for the reason given: a two-sided tolerance
can still let "scan + regen" through.

**What was implemented** (spec sha `072ae0a2d64b29e8…`, tree `D:\tmp\ls-p2-v3-accept`):
a read-only probe around the formal `World.restoreCheckpoint` + `World.stepFrame` that calls
the originals unchanged and records, at the instant restore returns, `{tick, echoEnergy,
pendingCommands, appliedAudit, relay}` plus the event types of the first tick after it
(`signal-scanned` must be 0). Assertions use **exact equality** at that instant
(`energy === savedEnergy`, `queue === []`, `appliedAudit === 0`) and the later sample is a
separate observation labelled *regen*, never "no cost paid".

**Blocker measured (twice)**: the GameScene world does not exist on the main menu, and the
restore runs inside `GameScene.create()` when CONTINUE is clicked, so a probe installed
before CONTINUE times out (`probe.patched === false`, 8 s) and one installed after CONTINUE
is too late. Logs: `reports/gameplay-01/tester/p2-v3/run11/logs/case7.log(.txt)`.
Instrumenting the product to expose a hook was explicitly out of scope (no src changes).

**Deterministic path that needs no product change** (next edit, same file):
start a `requestAnimationFrame` sampler *before* the CONTINUE click; it records the **first
frame in which the world exists** (`tick`, `energy`, `queue`, `audit`, `relay`) and installs
the `stepFrame` wrapper at that same frame to count `signal-scanned` events. Assertions:
- if that first frame still has `tick === savedTick` → `energy === savedEnergy` exactly;
- otherwise `energy === savedEnergy + 5 * (tick − savedTick) / TPS` (the product's documented
  regen law, an exact prediction rather than a tolerance band);
- and zero `signal-scanned` events from that frame up to the sampling window.

`run8`/`run9` remain the archived, reproducible P2 snapshots (`31507843…`); `run11` is kept
as the failed-probe evidence and is not claimed as green.

## 9. Case-7 energy proof — SOLVED (class-prototype instrumentation)

Method (no product change): before CONTINUE, `page.evaluate` dynamically
`import('/src/world/World.ts')` (path passed as a variable so TS does not statically resolve
it), then wraps `World.prototype.restoreCheckpoint` and `World.prototype.stepFrame` with
read-only wrappers that `apply(this, args)` and return the original value unchanged (no extra
tick, no argument change). On the restore return they record, synchronously,
`{tick, echoEnergy, pendingCommands, appliedAudit, relay}` from the real instance and the
saved-checkpoint fields; the `stepFrame` wrapper collects every `signal-*` event from the
restore onward. The prototype identity is asserted (`gs.world instanceof World` from the
same Vite module), the wrappers are restored afterwards in a `.catch`-guarded evaluate, and
the instrumentation is recorded as a read-only fixture (not `none`).

Result — spec sha256 `9b5900aa1059972895c945d426653796d61eaef1a84b7f4e17b323b6bddef6ce`:

| run | command | result | log |
|---|---|---|---|
| case 7 ×2 | `-g "7) real save"` | **PASS 2/2** | `p2-v3/run13/logs/case7-run{1,2}.log(.txt)` |
| whole P2 spec | `tests/gameplay-02-echo-coop.spec.ts` | **PASS 7/7 (1.5m, skip 0)** | `p2-v3/run13/logs/p2-full.log(.txt)` |
| `npm run typecheck` (unfiltered) | — | **PASS 0 error** | `p2-v3/run13/logs/typecheck.log(.txt)` |
| P3 synced copy, case 7 | `PORT=5492 -g "7) real save"` | **PASS 1/1** | `p3/run4/logs/case7.log(.txt)` |

Assertions at the restore instant are **exact**: `energy === savedEnergy`, `queue === []`,
`appliedAudit === 0`, `relay === savedRelay`, and zero `signal-scanned` events from the
restore to the sampling window. Hashes before/after/archived all equal (`run13/source-snapshot/HASHES.txt`).
The failed probe attempts (`run11`, `run12`) are kept; `run8`/`run9` (`31507843…`) are
untouched.
