# GAMEPLAY-01 — P4 balance evaluation (v4 frozen evidence)

Date: 2026-11-19. Author: Orca developer `q331nefqzzh4gzn0hdbmnxwh` (documentation only).
Status: **evaluation of already-executed evidence; no tuning was performed.**
HUMAN ACCEPTANCE PENDING — nobody has played this build by hand, and nothing here is a
human-experience measurement.

## 0. What this document is, and the frozen data it reads

| item | value |
|---|---|
| product under test | **v4 frozen** (`manifest.v4.json`): `src/world/World.ts` `349544bf…`, `src/world/sim/core.ts` `f71523e1…`, plus the other eight manifest files |
| rendered evidence (3 seeds × 2 modes = 6 groups) | `D:/Project/LAST_SIGNAL/reports/gameplay-01/tester/p4-final/run4-v4-final/evidence/p4-route-{20261117,20261118,20261119}-{HumanOnly,HumanEcho}.json` |
| rendered layout evidence | `…/run4-v4-final/evidence/p4-layout-3seeds.json` |
| rendered reject / no-connection evidence | `…/run4-v4-final/evidence/p4-reject-noconn.json` |
| P4 nine rendered spec result (6 route runs + reject + checkpoint/replay + layout) | `…/run4-v4-final/logs/p4-nine.log.txt` → 9/9 passed |
| P1 seven rendered spec result (includes route B via manual relay OFF) | `…/run4-v4-final/logs/p1-seven.log.txt` → 7/7 passed |
| Headless matrix (12 runs, 3 seeds × 4 variants) | `D:/Project/LAST_SIGNAL/.cindy-worktrees/serene-leakey/reports/gameplay-01/developer/p4-recovery/runs/202611*-*.json` |
| Headless metric definitions | `…/p4-recovery/runs/README.md`; corrected-field smoke `…/runs/driver-v2-smoke-20261117-human-echo.json` |
| surrounding gates (not re-run here) | `run11-final-155/logs/1-unit-default.log.txt` (859/859, 73 files), `4-full-playwright.log.txt` (155/155), `5-parity.log.txt` |

Runner labels: rendered = **agent** (real menu/keys/mouse, NON-BLIND driver), fixtures = seed
override / auto-Owner confirm; Headless = scripted intents. **No `human` runner exists in any
row.** Headless completion is a **route projection** (room cleared + route target + player at the
portal radius); it is not a room transition.

Test-generation boundary: these six per-seed JSON records were produced by run4's P4 test
bytes (`839e91fb`), with the same v4 product sources. The final run11 re-ran all six route
cases successfully on the final test bytes; the table here deliberately uses the retained
run4 per-seed records rather than presenting them as run11 per-seed JSON.

## 1. Rendered per-seed, per-mode results (n = 1 run per cell)

| seed | mode | route taken | fight time | shots | HP at fight start | door↔relay (tiles) | jam cost: actual / net | ECHO scan cost | Headless parity (ticks) |
|---|---|---|---|---|---|---|---|---|---|
| 20261117 | HumanOnly | 0 → 1 | 1302 ms | 3 | 100 | 1.00 | 25 / 22 | — | 60 |
| 20261117 | HumanEcho | 0 → 1 | 1909 ms | 4 | 94 | 1.00 | 25 / 22 | 10 (echo 100→90) | 60 |
| 20261118 | HumanOnly | 0 → 2 | 1245 ms | 2 | 94 | 2.00 | 25 / 22 | — | 60 |
| 20261118 | HumanEcho | 0 → 2 | 1720 ms | 3 | 94 | 2.00 | 25 / 22 | 10 (echo 100→90) | 60 |
| 20261119 | HumanOnly | 0 → 5 | 1225 ms | 2 | 100 | 1.41 | 25 / 22 | — | 60 |
| 20261119 | HumanEcho | 0 → 5 | 1208 ms | 2 | 100 | 1.41 | 25 / 22 | 10 (echo 100→90) | 60 |

- **Completion rate: 6/6** rendered route runs, each `map.rooms[id].cleared === true`,
  `coreClearEvents === 1`, and Headless/World parity `true` (same seed, same clear tick 60).
- **Route B** (relay INACTIVE): not part of these six rendered cells (they all take the ACTIVE
  route). It is covered by `tests/gameplay-01.spec.ts` test 3 ("manual relay OFF (R) selects the
  other authored route", 7/7 in run4) and by the three Headless route-B runs below.
- **Damage taken: N/A.** The rendered evidence records HP at fight start (`94` or `100` — i.e. some
  chip damage before the measured fight) but **not** the HP after the fight, so no damage number is
  reported rather than a made-up 0.
- **Energy (actual vs net):** every rendered run jams twice — once at spawn (25, before-tick
  energy, `regenEvents: 0`) and once at the door (25) → **50 of 100 energy spent**; the recorded
  **net** delta is 22 per jam (regen dilutes it). The ECHO scan is a real event cost of **10**
  (echo 100 → 90), and the accepted-proposal audit row is `enqueued` → `applied`.
- **Signal action counts (rendered):** 2 jams per run; 0 player scans; 1 ECHO scan in HumanEcho;
  0 relay toggles (route A needs none).
- **Jam bookkeeping:** expiry restores the route after ~320 ticks (`recovered.tickDelta`
  319–322); the portal is `null` while JAMMED and `F` does not change the room (`afterF.unchanged`).

## 2. Headless matrix (12 runs, same seeds/modes, scripted intents)

| seed | mode | route | ticks | damage taken | HP end | kills | scans | jams | relay events | suggestions accept / reject / fail | accept → effect |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 20261117 | human-only | 0→1 ACTIVE | 110 | 0 | 100 | 2 | 0 | 0 | 1 (device/normalise) | — | — |
| 20261117 | human-only route B | 0→2 INACTIVE | 92 | 0 | 100 | 2 | 0 | 0 | 1 (manual R) | — | — |
| 20261117 | human-echo | 0→1 ACTIVE | 238 | 0 | 100 | 2 | 1 | 0 | 1 | 1 / 1 / 0 | 1 tick |
| 20261117 | human-echo reject-only | 0→1 ACTIVE | 237 | 0 | 100 | 2 | 0 | 0 | 1 | 0 / 1 / 0 | — |
| 20261118 | human-only | 0→2 ACTIVE | 114 | 0 | 100 | 2 | 0 | 0 | 1 | — | — |
| 20261118 | human-only route B | 0→5 INACTIVE | 109 | 0 | 100 | 2 | 0 | 0 | 1 (manual R) | — | — |
| 20261118 | human-echo | 0→2 ACTIVE | 242 | 0 | 100 | 2 | 1 | 0 | 1 | 1 / 1 / 0 | 1 tick |
| 20261118 | human-echo reject-only | 0→2 ACTIVE | 241 | 0 | 100 | 2 | 0 | 0 | 1 | 0 / 1 / 0 | — |
| 20261119 | human-only | 0→5 ACTIVE | 109 | 0 | 100 | 2 | 0 | 0 | 1 | — | — |
| 20261119 | human-only route B | 0→3 INACTIVE | 96 | 0 | 100 | 2 | 0 | 0 | 1 (manual R) | — | — |
| 20261119 | human-echo | 0→5 ACTIVE | 237 | 0 | 100 | 2 | 1 | 0 | 1 | 1 / 1 / 0 | 1 tick |
| 20261119 | human-echo reject-only | 0→5 ACTIVE | 236 | 0 | 100 | 2 | 0 | 0 | 1 | 0 / 1 / 0 | — |

Reading rules (from `runs/README.md`, unchanged):

- `ticks` are 60 Hz core ticks; the human-echo rows include a **scripted 125-tick wait** after the
  human refuses a proposal. The v2 smoke run quantifies it: 238 total = **113 active + 125
  scripted**, so the ECHO tick difference is scripted waiting, **not** a cost of cooperation.
  Rows without the v2 fields have `ticksExcludingScriptedHold = N/A` (field added later).
- `damage taken = 0` in all 12 runs is the scripted long-range fire result; **not** a balance sample.
- `relay events` counts `signal-relay-changed`; in human-only rows it is the device/normalise event,
  in route-B rows the single manual `R`. It is not "toggles per run" in the player sense.
- human-only = **no ECHO connection was created** (a no-connection sample, not a disconnect test).

## 3. Signal economy against the real gates (existing, not presets)

| gate | real value / behaviour | source / test |
|---|---|---|
| energy cost | scan 10, jam 25, max 100, regen 5/s | `src/signal/signalTuning.ts` |
| insufficient energy | `E_ENERGY_INSUFFICIENT` blocks scan/jam | `src/signal/signalCore.ts:99,111`; `src/world/sim/signalCombat.test.ts:142` |
| cooldown | scan 120 ticks, jam 480 ticks → `E_COOLDOWN` | `signalCore.ts:99,111`; `src/signal/signalCore.test.ts:68,85,180`; rendered runs show `jamCD 97–106` after use |
| evidence expiry | `EVIDENCE_TTL_TICKS 300`, `expireEvidence`, event `signal-evidence-expired` | `signalCore.ts:143-149`; `core.ts:250` |
| visibility | perception is radius + explored + line of sight; hidden/far/other-room projectiles are excluded from observations | `src/ai-native/worldPerception.ts`; `tests/c3b-external-link.spec.ts:486` |

**No resource preset is live.** The P5 variant idea (`docs/gameplay/P5_VARIANTS_PLAN.md`) is a
plan only; the authored scene uses the existing `drone`, loot and terminal mechanics unchanged.

## 4. What these numbers do and do not show

- Fights are **short**: 1.2–1.9 s, 2–4 shots, one room, two linked drones. The whole authored
  decision is the door/relay interaction, not a long encounter.
- Sample size is **one run per rendered cell** (n = 6) plus 12 Headless runs; there is **no**
  variance estimate and **no** human data. No statistical claim is made about human experience.
- The six rendered cells all take route A; route B is proven separately (P1 manual-OFF test +
  3 Headless route-B runs), and both branches complete solo on all three seeds.
- The ECHO is **not** shown to be better: wall-clock fight times overlap (1208–1909 ms) with
  different starting HP, and the ticks difference is scripted waiting. No direction is claimed.

## 5. Balance decision for this round

**No numeric change is made.** Reasons, tied to the evidence above:

1. Every rendered cell and every Headless run completes; there is no unwinnable or trivially
   broken cell that a number change would fix.
2. The signal economy already behaves consistently with its gates (2 × 25 jam = half the bar,
   regen visible as net 22, scan 10 with a real 120-tick cooldown), and the two routes are legal
   without the ECHO.
3. The encounter is too short (2–4 shots) and the sample too small (n = 1 per cell) to justify
   tuning: any change would invalidate the frozen v4 acceptance evidence without a measured target.
4. The known tightness (route separation 2.0–4.1 tiles, door 1.0–2.0 tiles) is a **layout** fact
   already accepted by the product decision (natural standing jam), not a balance number.

This is a decision **not to tune**, not a claim that the level is tuned. P5 balance/tuning, more
variants, and any human-experience judgement remain open.

## 6. Limits carried forward

- Rendered completion: 3 seeds × 2 modes, one run each, **agent (non-blind)** — not human.
- Damage taken / end HP: **N/A** in rendered evidence; Headless 0-damage rows are not a sample.
- Route B rendered entry is covered by the P1 spec and Headless runs, not by the six P4 cells.
- ECHO comparison is observational only; owner confirmation in scripted runs is a fixture.
- Overall GAMEPLAY remains **not** a whole PASS; HUMAN ACCEPTANCE PENDING.
