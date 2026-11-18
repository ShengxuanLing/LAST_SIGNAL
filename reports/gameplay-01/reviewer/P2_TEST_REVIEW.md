# GAMEPLAY-01 · P2 test-evidence review (frozen v3 tree + tester report)

Reviewer: independent read-only pass. No `src/`, `tests/`, config or evidence of others was modified; no
commit; no model calls; the tester clone (`D:\tmp\ls-p2-v3-accept`) and the v2 counterexample clone were only
read. All reviewer runs happened in reviewer-owned snapshots under `D:\tmp\gp01-p2t3` with
`process.cwd = D:\tmp\gp01-p2t3`, reviewer port `5492`, and evidence written only under
`reports/gameplay-01/reviewer/p2-test/`.

Stage scope: **P2 test evidence only**. Not whole-GAMEPLAY PASS, not P3–P5, not human acceptance
(`HUMAN ACCEPTANCE PENDING`).

---

## 0. Verdict

| item | result |
|---|---|
| 6 frozen ECHO cooperation cases | **PASS** — independently re-executed 6/6 on the manifest-verified P2 v3 sources |
| 131-case E2E set, skip 0 / did-not-run 0 | **PASS** (log-verified, reconstruction not byte-identical — see E1) |
| 794 unit + 1 MCP surface + 3 parity | **PASS** (log-verified; 39 P2 unit cases recounted 19+17+3) |
| Positive/negative assertions not weakened | **PASS** with 4 minor scope notes (§3) |
| Single pending (one queue entry) | **PASS** (real clicks; `[] → ['signal-scan'] → ['signal-scan']`, same `proposalId`) |
| Formal headless restore honesty | **PASS** (`fromSimulationState`, `restored:true/proposalId:null`, exactly 1 `signal-scanned`, exact `ENERGY_MAX − SCAN_COST`, no fabricated applied receipt) |
| UI overlap exceptions not overly permissive | **PASS for interactive conflicts**; narrower than the UI-REWORK audit on text–text and ancestor visibility |
| Old-save legality (only new optional fields missing) | **PASS** — legitimate save, not "rejection counted as success" |
| **E1** frozen spec bytes not archived | **ISSUE (evidence hygiene)** — claimed `efef833c…` is not reproducible from any surviving copy |
| **E2** unfrozen 7th case | **ISSUE (bookkeeping)** — present in worktree *and* tester tree after the run; correctly excluded from the 131 |

Blocking for the P2 stage: **none for engineering**. E1 must be fixed for the record (archive the spec bytes per
run); E2 only needs the historical 6-case baseline to stay the frozen one.

---

## 1. Evidence-hygiene findings (the two things the numbers do not show)

### E1 — the bytes behind the 6-case / 131 claims no longer exist (**historical set only; closed for the new run**)

| what | value |
|---|---|
| hash claimed in the report | `efef833c8a6c620674c10b2c3b5b3991b98800b48aad03f31859dc7c538c1724` |
| worktree 23:56 / 23:59 / 00:47 | `62e7d19abbbb…` → `01d259ff3117…` → `2f343cb347f3…` (7 cases throughout — still being edited) |
| tester clone 23:56 / 23:59 | `154f4af68879…` → `01d259ff3117…` (7 cases) |
| 7th case removed from current bytes | `bbb1a8a8186a3c64…` — still ≠ `efef833c…` |

Reconstruction cannot reach the claimed hash, and the E2E log proves the run predates the current file: the log's
case 6 is titled *"an old save without cooperation fields loads unchanged and defaults to OFF"*, while the file now
says *"a legacy save (only the new optional cooperation fields removed) still CONTINUEs and defaults OFF"*. So the
file was edited **after** the run (untracked file, no git object, no copy under `p2-v3/run2/`), and both surviving
copies are the *later* revision. It kept moving during this review (three different hashes in under an hour), so no
reviewer can pin the executed bytes; that is the finding, not a product defect.

Consequence: the 6 executed cases are verifiable (titles + pass/fail in the log, and behaviour re-verified below),
but the claim "this exact file passed" is not. Fix: copy the spec (and its hash) into `p2-v3/runN/` at run time.

**Update (v7 spec, run8):** the tester now freezes the 7-case spec `315078430983165e` and records it in the log
header itself (`full-spec.log`: `specSha=315078430983165e`), so the new run is pinned to its bytes. The old
`efef833c` six-case set that produced the 131 remains unrecoverable and stays accepted *history*; it can never be
regenerated, which is why 131 must be quoted as 6-case and the 7-case run as a separate number. See §7.

```
npm test            → PASS 794/794 → D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\p2-v3\run2\logs\ci-chain.log
playwright (131)    → PASS 131/131 → D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\p2-v3\run2\logs\e2e-full.log
```

### E2 — the unfrozen 7th case

`tests/gameplay-02-echo-coop.spec.ts` currently has 7 `test(` blocks; case 7 ("real save + reload: a confirmed-but-
uncommitted local action is never persisted nor executed") is the tester's new, unfrozen case. The 131 run contains
**exactly 6** `gameplay-02` records and no case 7, so the historical count is clean:

```
grep -c "gameplay-02-echo-coop.spec.ts" e2e-full.log → 6
grep -c "real save + reload"            e2e-full.log → 0
```

131 = 125 (pre-P2 E2E) + 6, arithmetic consistent with the log's per-test listing. Nothing to correct; the 7th case
must not be folded into the frozen 131 when it is accepted.

---

## 2. Gate-by-gate (tester logs, re-read and re-counted)

| # | check | command / evidence | result | log |
|---|---|---|---|---|
| 1 | typecheck | `npm run typecheck` unfiltered | PASS 0 error | `reports/gameplay-01/tester/p2-v3/run2/logs/typecheck-unfiltered.log` |
| 2 | unit | `npm test` → 68 files, 794 tests | PASS 794/794 | `…\run2\logs\ci-chain.log` |
| 3 | P2 unit share | recount of the 3 P2 test files | 19 + 17 + 3 = **39** (matches report) | `src/ai-native/echoCoop.test.ts` etc. |
| 4 | MCP surface | `npm run test:mcp-surface` | PASS 1/1 | `…\run2\logs\surface.log` |
| 5 | build | `npm run build` | PASS | `…\run2\logs\build.log` |
| 6 | E2E | dual Vite 5173+5199, `playwright --workers=1` | PASS 131/131, skip 0, did-not-run 0, flaky 0 (grep count 0) | `…\run2\logs\e2e-full.log` |
| 7 | parity freshness | export mtime `23:40` < parity run `23:51:30`, same tree (`RUN v2.1.9 D:/tmp/ls-p2-v3-accept`) | PASS 3/3 | `…\run2\logs\parity.log` |
| 8 | parity is a hard gate | test throws `Parity product unreadable` and validates the rendered product carries signal events (no mtime-only pass) | PASS | `src/ai-native/signalRenderedHeadlessParity.test.ts:56,59,116` |
| 9 | targeted P2 | `PASS 6/6 (1.2m)` | PASS 6/6 | `…\run2\logs\targeted.log` |
| 10 | no skip / todo as pass | `test.skip`/`describe.skip`/`test.todo` count in the spec | 0 real ones (only documenting comments) | `tests/gameplay-02-echo-coop.spec.ts` |
| 11 | P2 sources honest | reviewer re-hash of the tester tree, all 10 manifest paths | **10/10 sha256 == manifest** | `reports/gameplay-01/developer/p2/final/manifest.json` |
| 12 | artifacts not borrowed | `dist-mcp/` present in tester tree (built `23:1x`), parity products produced `23:40` there; own `node_modules` (`node_modules/.package-lock.json` `23:14`) | PASS | `D:\tmp\ls-p2-v3-accept` |

Timeline is internally consistent: `23:22` typecheck/targeted → `23:26` unit+surface → `23:27` build/E2E start →
`23:40` rendered export → `23:47` E2E finish (19.6 m) → `23:51` parity.

---

## 3. Assertion-strength audit (are the pass lines weakened?)

Read all six bodies end to end. No negative assertion was relaxed, and every case asserts the *positive* product
effect and the *absence* of the wrong one. Case-by-case:

1. **single pending** — flips the real switch, waits for a real local proposal, clicks `CONFIRM (HUMAN)` twice in
   one paused window. Asserts queue grows by at most one, the second click adds nothing, the pending action survives
   and is *the same* action. Honest but not maximal: the queue delta is a bound (`before ≤ after ≤ before+1`), not
   `=== before+1` — a silent no-op would still pass this line (the pending-action assertions would not).
2. **REJECT LOCAL** — asserts `pendingLocal === null` **and** `queue` unchanged (`toEqual(before)`). Good.
3. **default OFF / owner gate** — fresh run OFF, real switch ON, saved into the real save, `owner === 'human'`
   preserved; then the real AI menu makes the owner `ai` and the refusal is asserted. The refusal probe goes through
   the product method in page context (`setEchoCooperationOptIn(false) === false`) rather than a menu click; labelled
   as such in the record. Acceptable, worth noting as a partial UI-path check.
4. **rawsim restore** — formal `HeadlessWorld.fromSimulationState`, no private guard name asserted:
   `{restored:true, kind, proposalId:null}`, `proposeLocalEcho() === null`, both the saved id and an arbitrary new id
   refused, queue preserved *exactly*, one real tick → exactly **one** `signal-scanned` with
   `energy === ENERGY_MAX − SCAN_COST`, queue drained, busy cleared, and **no** `scan/applied` receipt invented.
   This is the anti-"restore counts as success" guard and it is not weakened.
5. **five viewports** — 10 CSS px floor, no clipping, no interactive-vs-interactive intersection. Exceptions are
   same-control rect+label (`±2/±3 px`), a non-interactive panel fully containing a child, and a 1 px overlap slack;
   an *interactive inside interactive* still fails. Not overly permissive for control conflicts. Two narrower-than-
   the-audit gaps: pairs where neither box is interactive are skipped (text–text overlap unchecked), and visibility
   uses each element's own `visible` flag, not ancestor visibility.
6. **old save** — legitimate compatibility test, explicitly *not* "rejection as success": boot a real run, let the
   product write its own valid checkpoint, delete **only** `permanent.echoCooperationOptIn` (and `echoLowRisk` if
   present), reload, click the real `CONTINUE`, and require `GameScene` active + `echoCooperation === false` +
   `pendingLocal === null`. A schema rejection would fail the test.

---

## 4. Independent re-execution (reviewer-owned snapshot, frozen bytes)

Method: worktree tree copied to `D:\tmp\gp01-p2t3` (own `node_modules` junction), then the **10 P2 v3 sources
overwritten with the tester-tree copies whose sha256 match the developer manifest 10/10**; the spec reduced to the
6 historical cases (case 7 removed); own Vite on `5492`; evidence under `reports/gameplay-01/reviewer/p2-test/`.

| run | composition | result | log |
|---|---|---|---|
| attempt 1 | `git archive 87a0fac` snapshot | FAIL (setup) — Vite could not resolve `../ui/feedback`; my snapshot, not the product | `reports/gameplay-01/reviewer/p2-test/run.log` |
| attempt 2 | copy of the tester tree at copy time | FAIL (setup) — port 5492 still held by attempt 1's server, so the browser got a broken module graph | `reports/gameplay-01/reviewer/p2-test/run2.log` |
| run 3 | worktree tree + `87a0fac` blob sources | 5 passed / 1 failed — `REJECT LOCAL` label absent (that generation predates the label) | `reports/gameplay-01/reviewer/p2-test/run3.log` |
| run 4 | same as 3 (control) | **6 passed (1.4 m)** | `reports/gameplay-01/reviewer/p2-test/run4.log` |
| **run 5** | **manifest-verified P2 v3 sources (10/10), 6-case spec** | **6 passed (1.4 m), skip 0** | `reports/gameplay-01/reviewer/p2-test/run5-frozen.log` |

```
npx playwright test -c _review/pw.p2t.config.ts --workers=1  → PASS 6/6 → D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p2-test\run5-frozen.log
```

Recording header of run 5 (cwd, port, spec hash, source hashes before/after unchanged):

```
cwd=D:\tmp\gp01-p2t3   devRoot=http://localhost:5492/   (port owner = reviewer)
spec 6-case sha256=bbb1a8a8186a3c64…   (≠ report's efef833c…, see E1)
src sha256(12) before=after: echo.ts 5408830f9774, worldHeadless.ts d5b2c5107d5e, PauseScene.ts ed323491252d, World.ts 37cf6ffb81db
```

Machine records from the independent run (`reports/gameplay-01/reviewer/p2-test/evidence-frozen/p2-echo-coop.json`):

```
single-pending : queue [] → ['signal-scan'] → ['signal-scan']; pending id local_66_1 twice
reject         : pendingAfter null; queue [] → []
lowrisk gate   : flag true, saved true, owner 'human'; non-human refused true
restore        : busy {restored:true, proposalId:null, kind:'scan', acceptedTick:null, roomGeneration:0}; queue ['signal-scan']
viewports      : 1920/1366/1280/1024/800 → tooSmall [], out [], overlaps []
legacy save    : continued true, optIn false, pending null, removed ['permanent.echoCooperationOptIn']
```

Screens: `reports/gameplay-01/reviewer/p2-test/shots-frozen/p2-{1..6}-*.png` (6).

Boundary of this rerun: it reproduces the six cases and their assertions, **not** the tester's 131-suite context,
and (because of E1) not the tester's exact spec bytes. It is one targeted run, no full 794 rerun.

---

## 5. Not covered by these tests (must not be read as PASS)

- Browser save → reload → `CONTINUE` with a **confirmed-but-uncommitted** cooperation action: still a plan in the
  report, no test (case 4 is Node/headless only). The core "pending commands are not persisted, safe checkpoint wins"
  boundary therefore has no browser-level evidence yet.
- Real Magpie `group/elisa` ECHO chain — separate reviewer stage (`REAL_MODEL_ECHO_REPORT.md`).
- P3 display candidate, P4 route comparison, P5, and any human playtest — untouched here; the report itself keeps
  `HUMAN ACCEPTANCE PENDING` and does not claim whole-project PASS.
- `autoOwner` fixtures: none used in this spec (states it honestly); every accepted action came from a real
  human-path confirm click driven by automation, i.e. **agent, not human**.

## 6. One line per check

- frozen P2 sources (tester tree → manifest) → PASS 10/10 → `D:\Project\LAST_SIGNAL\reports\gameplay-01\developer\p2\final\manifest.json`
- `npm test` → PASS 794/794 → `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\p2-v3\run2\logs\ci-chain.log`
- `npm run test:mcp-surface` → PASS 1/1 → `…\run2\logs\surface.log`
- `npm run build` → PASS → `…\run2\logs\build.log`
- E2E 131 → PASS 131/131 (skip 0, did-not-run 0) → `…\run2\logs\e2e-full.log`
- parity (fresh export 23:40, gate 23:51) → PASS 3/3 → `…\run2\logs\parity.log`
- targeted P2 → PASS 6/6 → `…\run2\logs\targeted.log`
- reviewer independent 6/6 on manifest-verified sources → PASS 6/6 → `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p2-test\run5-frozen.log`
- frozen spec bytes reproducible → **FAIL (E1)** — claimed `efef833c…` unrecoverable; both surviving copies are the later 7-case revision (`01d259ff…`)

---

## 7. Addendum — frozen 7-case spec `31507843…` and `run8` (supersedes §4 numbers for cases 6–7)

`P2_TEST_REPORT.md` is now `2393effc…` (§6 = new spec evidence). The frozen spec is
`tests/gameplay-02-echo-coop.spec.ts` = `315078430983165ec995fa3e93e469ce38ff06c2d883a8c5054c965d86f873b6`
(7 cases, tester tree; reviewer re-hashed it 1:1). `efef833c…` stays the *old six-case* set that corresponds to the
131-case full chain — the two sets must never be quoted interchangeably.

### 7.1 Gate lines (tester, run8)

- `npx tsc --noEmit` → PASS (empty output after the banner) → `reports/gameplay-01/tester/p2-v3/run8/logs/typecheck.log`
- `npx playwright test` (full 7-case spec, `PORT=5491`, `specSha=315078430983165e`) → **PASS 7/7 (1.6 m)** → `…\run8\logs\full-spec.log`
- cases 6+7, three consecutive runs → **PASS 2/2 ×3** (35.7 s / 35.5 s / 28.3 s) → `…\run8\logs\case67-run{1,2,3}.log`
- 131-case chain unchanged and still 6-case → `…\run2\logs\e2e-full.log` (6 `gameplay-02` records, 0 `real save + reload`)

Failure history is kept, not retried away: `run3…run7/logs/*` still contain the red runs (run6 red on
`relay === 'ACTIVE'`, run7 red on `energy === savedEnergy`). That is the honest record and it is also where §7.3
comes from.

### 7.2 Reviewer independent re-run of the two new/changed cases

Snapshot `D:\tmp\gp01-p2t3`: worktree tree + **manifest-verified P2 v3 sources (10/10 sha256 ==
`developer/p2/final/manifest.json`)** + the frozen 7-case spec `31507843…`; reviewer port `5492`; no shared cwd.

```
npx playwright test -c _review/pw.p2t.config.ts --workers=1 --grep "6\)|7\)" → PASS 2/2 (32.4 s)
→ D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p2-test\run6-case67.log
```

Machine record (`reports/gameplay-01/reviewer/p2-test/evidence-case67/`):

```
legacy-save : continued true, optIn false, pending null, removedFields ['permanent.echoCooperationOptIn']
case 7      : saved @tick 138 energy 81 room 0 demo p1 (pendingCommands 0 before save)
              confirm kind 'scan' ok true → queue ['signal-scan'] (1), applied false
              after reload+CONTINUE @tick 185: room 0, demo p1 (same), queue [], pending null,
              appliedAudit 0, relay JAMMED == savedRelay, energy 85
```

### 7.3 Case 6 — legitimate old-save test (confirmed)

Boots a real run, lets the **product** write its own checkpoint (`saveCheckpoint()` → `true`, `save.run` present),
deletes **only** `permanent.echoCooperationOptIn` (plus `echoLowRisk` when present), reloads, clicks the real
`CONTINUE`, and requires `GameScene` active + `echoCooperation === false` + `pendingLocal === null`. A schema
rejection would fail the test, so "rejection counted as success" cannot happen. The room is cleared first because the
product refuses to checkpoint an uncleared room — that precondition is asserted, not assumed.

### 7.4 Clearing helper is non-blind (confirmed)

`clearRoomByRealPlay` is closed-loop, not a blind script: each iteration reads the live enemy list and distance from
`w.enemies`/`w.player.wx`, presses a **real** directional key chosen from the actual delta, and once within 4.5 units
aims the **real mouse** at the projected enemy screen position (`getWorldPoint` accounting for camera zoom) and holds
the real button for 360 ms. It never calls an enemy-kill, teleport or heal seam, and it bails with
`{ cleared: false }` after `maxMs` instead of forcing the state — so case 6/7 cannot reach a cleared room by cheating.

### 7.5 Case 7 — checkpoint / confirm / reload boundary (confirmed, one weak invariant)

Order is exactly the documented contract and each step is asserted:

1. `pendingCommands.length === 0` **before** the checkpoint (the product refuses to capture with a pending command,
   so the safe checkpoint must be the empty-queue one) — asserted, not assumed.
2. `saveCheckpoint() === true`, `pendingCommands` still 0.
3. cooperation ON via the real switch, real proposal appears, confirm → `queue === ['signal-scan']` (1),
   `applied === false` while paused.
4. real `page.reload()` → real `CONTINUE` → same `roomId` (0) and same authored `demo` (`p1`), `queue === []`,
   `pendingLocal === null`, `appliedAudit === 0`, ECHO hp restored (non-null).
5. `relay === savedRelay` (not a hard-coded `'ACTIVE'`).

Separation from the rawsim case is correct and explicit: case 4 is `HeadlessWorld.fromSimulationState` (Node, raw sim,
unknown provenance), case 7 is the product `saveCheckpoint()` + real reload (browser, real checkpoint). Neither
pretends to be the other, and case 7 never passes `w.sim` where a `RunCheckpoint` is expected.

**M1 (minor, actionable) — the energy assertion is regen-permeable and cannot detect the failure it names.**
`REGEN_PER_SEC = 5`, `SCAN_COST = 10`. After CONTINUE the run keeps ticking (~47 ticks = ~4 s in the record), so regen
adds ≈5/s. One executed scan would show `saved − 10 + regen ≈ saved − 5 … saved + 2`, and the test asserts only
`after.energy >= savedEnergy − 1` and `> savedEnergy − SCAN_COST` — both of which a real scan also satisfies. The
record shows `81 → 85`, i.e. regen alone already hides a full scan. The historical line was worse-in-the-other-way
(`toBe(savedEnergy)` at run7, which regen can never satisfy), so the relaxation was forced, but as written the check
proves nothing. Fix: make it two-sided against elapsed regen —
`after.energy <= savedEnergy + ceil(elapsedMs/1000 * REGEN_PER_SEC) + 1` (no cost was paid) **and**
`after.energy >= savedEnergy - 1` (no negative). The strong detectors in this case remain `relay === savedRelay`,
`queue === []`, `pendingLocal === null` and `appliedAudit === 0` — those are sound.
Minor note on `relay`: comparing to `savedRelay` instead of the old hard-coded `'ACTIVE'` is *more* correct (a jammed
relay is a legal saved state, and the record was `JAMMED`), not a weakening.

### 7.6 Assertion-strength delta vs §3

- No previously-passing negative assertion was removed in the 7-case spec; case 7 adds `queue`/`pending`/`appliedAudit`/
  `room`/`demo` negatives that §3 did not have for the browser boundary.
- One genuine weakening is M1 (energy, §7.5). One justified re-basing is `relay` (§7.5).
- Case 7's confirm step calls `w.confirmLocalEchoProposal(id)` in page context rather than clicking the button, while
  the record line reads `fixtures: 'none for the boundary'`. Case 1 already covers the real-click path, so this is a
  labelling nuance, not a gap: the record should say one product-method confirm.

### 7.7 Still not covered

Browser save→reload for a **pending** command on the rawsim path (case 4 remains Node-only), real model chain, P3/P4/P5,
human playtest. Verdict unchanged: P2 engineering evidence **PASS**; M1 is the only code-level follow-up.

---

## 8. Final closure — spec `9b5900aa…` (M1 prototype probe) reviewed independent-read-only

Spec under review: `tests/gameplay-02-echo-coop.spec.ts` =
`9b5900aa1059972895c945d426653796d61eaef1a84b7f4e17b323b6bddef6ce`
(archived copy `tester/p2-v3/run13/source-snapshot/tests/…` = worktree = value given by the Lead, all three equal).
Previous `31507843…` is the same 7 cases without the probe; `efef833c…`/131 stay the old six-case history and are not
touched by this round.

### 8.1 Diff scope (31507843 → 9b5900aa) — exactly three hunks, no assertion removed

1. `clickLabelVariant()` + `LABEL_VARIANTS` (new helper, P3 renamed `REJECT LOCAL`→`REJECT`); case 2 now resolves the
   label through it. No assertion changes in case 2.
2. Case 7 confirm: a `FIXTURE` comment plus `provenance: 'product-boundary call (real click covered by case 1)'` on the
   record — the labelling nit from §7.6 is closed.
3. Case 7 save→reload boundary: read-only prototype instrumentation replaces the two regen-permeable energy
   lower-bounds. Cases 1,3,4,5,6 are byte-identical in behaviour.

### 8.2 Gate lines (one per command → result → absolute log)

- run13 `npx playwright test` (full 7, `PORT=5491`, `specSha=9b5900aa…`, workdir `/d/tmp/ls-p2-v3-accept`) → **PASS 7/7 (1.5 m)** → `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\p2-v3\run13\logs\p2-full.log` (+ permanent `.txt` in `run13\source-snapshot\logs\`)
- run13 case 7, two consecutive runs → **PASS 1/1 (16.9 s, 16.0 s)** → `…\run13\logs\case7-run1.log`, `case7-run2.log`
- run13 `npx tsc --noEmit` (unfiltered) → **PASS**, no diagnostics after the banner → `…\run13\logs\typecheck.log`
- run13 archived hashes → `before/after/archived = 9b5900aa…`, `match=YES` → `…\run13\source-snapshot\HASHES.txt`
- reviewer independent, **case 7 only** (`D:\tmp\gp01-p2t3`, manifest-verified P2 v3 sources 10/10, spec `9b5900aa`, port 5492, not 5491/5492-shared/5199) → **PASS 1/1 (19.4 s)** → `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p2-run13-case7.log`; record → `…\reviewer\p2-run13-evidence\p2-echo-coop.json`; shot → `…\reviewer\p2-run13-shots\p2-7-save-reload.png`

Not run, as ordered: full suite again, 794 unit, build, model chain, P4/P5.

### 8.3 Probe correctness — checked against the claims

| Claim | How it is enforced in the spec | Evidence (tester run13 / my run) |
|---|---|---|
| installed **before** CONTINUE, on the same module the scene instantiates | `await import('/src/world/World.ts')` after reload, before the CONTINUE click; `gs.world instanceof World` asserted `true` | `sameWorldModule: true` / `true` |
| wraps the formal entry `restoreCheckpoint` | wrapper calls `origRestore.apply(this, args)` and returns its value | `restore.ok === true`, `restore.tick 148`, `savedArg.coreState.tick 148` (run13); `154 / 154` (mine) |
| **no extra tick** | tick is sampled inside the wrapper, immediately after the original returns | restore tick == arg tick in both runs (`148==148`, `154==154`) |
| synchronous snapshot of energy/relay/queue/applied | all four read in the same synchronous block after `origRestore` returns | energy `80 == savedEnergy 80` (run13), `81 == 81` (mine); `queue []`; `appliedAudit 0`; `relay 'JAMMED' == savedRelay` |
| checkpoint really carried no pending command | `args[0].coreState.pendingCommands.length` recorded as `savedArg.queue` | `savedArg.queue: 0` in both runs |
| restores to a sample with `signal-scanned = 0` | `stepFrame` wrapper keeps the original return and accumulates `signal-*` events from the restore onward; `scanned.filter(==='signal-scanned')` must be `[]` | `scanned: []` (run13), `scanned: []` (mine) |
| the wrapper observes the REAL tick path | `World.stepFrame` is the per-frame entry the scene calls (`src/scenes/GameScene.ts:516` → `world.stepFrame(delta,intent)`), returning `SimEvent[]` (`src/world/World.ts:1817`) | static confirmation + `firstTickEvents` populated (`[]`, i.e. a quiet first tick) |
| no relaxed / swallowed / fabricated data | old `>= saved-1` / `> saved-SCAN_COST` replaced by exact equality at the restore instant + event scan; the later 1 s sample is kept only as an observation (`>= savedEnergy`) | diff §8.1 |

M1 is therefore **closed for real**: a scan that actually executed restores `energy = saved − 10` and emits
`signal-scanned`; both are now asserted at the instant of restore rather than inferred from a drifting later sample.
`REGEN_PER_SEC = 5` no longer participates in the proof.

### 8.4 Same-source safe checkpoint vs rawsim (semantics stay separate)

Case 7 drives the **product** boundary end to end: `saveCheckpoint()` on the paused, cleared room → real `page.reload()`
→ real `CONTINUE` → the formal `World.restoreCheckpoint(RunCheckpoint)` (now *observed*, not assumed, via the probe:
`args[0].coreState` present) → real `stepFrame` ticks. Case 4 remains the Node/rawsim path
(`HeadlessWorld.fromSimulationState`, unknown provenance) and case 7 never passes `world.sim` where a checkpoint is
expected. The two are not interchangeable evidence and are not presented as one.

### 8.5 Residual nits (non-blocking, no action required to commit)

- **N1** The comment says the prototype “is restored in finally”; there is no `try/finally`. The restore is a separate
  `page.evaluate(...).catch(() => undefined)` placed after the post-CONTINUE snapshot and before the assertions. On a
  throw between instrumentation and that call the wrapper stays installed for the rest of that page context (case 7 is
  the last test and each test gets a fresh context, so the practical impact is nil). Fix is one-line: wrap the CONTINUE
  flow in `try { … } finally { await restore(); }` — or reword the comment.
- **N2** `savedArg.queue` and `tick == savedArg.tick` are captured and recorded but not asserted. Adding
  `expect(restore.savedArg.queue).toBe(0)` and `expect(restore.tick).toBe(restore.savedArg.tick)` would turn the two
  strongest observations into assertions (both already pass in both runs).
- **N3** `probe.restore` records only the **first** `restoreCheckpoint` call; a second restore (if the scene ever did
  two) would not be inspected.
- **N4** `firstTickEvents` is `[]` in both runs, so the meaningful detector is the accumulator, not the “first tick”.
  That is fine as written; the assertion name slightly over-promises.
- **N5** The record's `fixtures` string still reads “none for the boundary; …”, while `confirmed.provenance` in the same
  record says “product-boundary call”. One of the two should be reworded so the record is internally consistent.

### 8.6 Verdict

No blocking finding: the new spec is the same seven cases plus a read-only probe; it imports the very module the scene
instantiates, calls the original methods with the original arguments and returns their values, records the four
invariants synchronously at the restore instant, asserts `instanceof` identity, restores the prototype before asserting,
and replaces the regen-permeable energy check with an exact-instant equality plus a `signal-scanned` scan on the real
`stepFrame` path. **The test bytes `9b5900aa…` may be committed as the P2 test baseline.** 131 keeps its 6-case
provenance; the 7-case number is `9b5900aa…` (7/7, 1.5 m). P2 engineering evidence stays PASS; GAMEPLAY overall,
human acceptance, P4 route comparison and P5 remain open, and P3 adaptation is a separate track (not reviewed here).
