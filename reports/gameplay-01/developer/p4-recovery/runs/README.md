# `runs/` — historical metric runs (kept as produced, NOT re-run)

These JSON files are the **v1 driver output** except `driver-v2-smoke-*.json`.
They are kept byte-for-byte on purpose: evidence must not be rewritten to look better.

## Which file is what

| Files | Produced by | Metric semantics |
|---|---|---|
| `2026111[7-9]-human-only.json` | v1 driver | route A, solo, no ECHO connection |
| `2026111[7-9]-human-echo.json` | v1 driver | route A, ECHO enabled, one refused + one accepted suggestion (owner **FIXTURE**) |
| `2026111[7-9]-human-echo-reject.json` | v1 driver | route A, ECHO enabled, every suggestion refused (still completes) |
| `2026111[7-9]-human-only-routeB.json` | v1 driver, `--want RELAY_INACTIVE` | route B via one manual `R` toggle |
| `driver-v2-smoke-20261117-human-echo.json` | **v2 driver** (single smoke) | corrected metric names/definitions below |

## Field names that changed in the v2 driver (read this before quoting a number)

| v1 field (in the 12 old files) | v2 field | Meaning |
|---|---|---|
| `signal.energySpentPlayer` / `energySpentEcho` | `signal.netEnergyChangePlayer` / `netEnergyChangeEcho` | **NET** delta (start − end, regen included). NOT an action cost. |
| — | `signal.actualScanCost` / `actualJamCost` | real cost of the last accepted action, from its own event delta (scan = 10) |
| — | `ticksExcludingScriptedHold` | ticks without the script's 125-tick wait after a human refusal |
| — | `scriptedRejectHoldTicks` | how much of the run was that scripted wait (125) |
| `offLineSimulated: false` (old files) | `connectionState` | `no-echo-connection` for HumanOnly / `echo-enabled-local` otherwise |
| — | `completedKind: 'headless-route-projection'` | `completed` is a Headless projection, not a room transition |
| — | `balanceSample: false` | 0 damage is a recorded fact, not a balance conclusion |

## How to read the old numbers

- `completed: true` = **Headless route projection** (room cleared + route target + player
  inside the portal radius). It is *not* a rendered room transition. Rendered completion is
  proven separately on **one seed** (20261117).
- `damageTaken: 0` in all 12 runs = scripted long-range fire. Not a balance sample.
- `human-echo` ticks (≈ 237) minus `human-only` ticks (≈ 110) ≈ 125 is the **script**
  waiting out the ECHO reject cooldown — not the cost of cooperation. The v2 smoke run
  shows `ticksExcludingScriptedHold` ≈ human-only + 3.
- `human-only` = **no ECHO connection was created**. This is not a disconnect/offline test.
- `energySpent*` in these files is a **net** delta; the real scan cost is in
  `proposals.lastAcceptToEffectDetail.echoEnergyBefore/After` (100 → 90 = `SCAN_COST` 10).
- Owner confirmation is a **FIXTURE**, never a human. `NON-BLIND` means the autopilot read
  canonical coordinates to steer.
