# P2 v2 (single-pending) — KNOWN-BAD restore snapshot (kept as counterexample)

Status: **NOT a final security snapshot.** v1 duplicate-confirm was closed, but the
v2 headless restore path is broken and must not be extrapolated.

- Isolated tree: `D:	mp\ls-p2-accept` (base commit `5aa90d8` + the 10 P2 sources below, own `npm ci`)
- Reviewer evidence: `reports/gameplay-01/reviewer/*headless-restore.log` cases [4][5]:
  restore leaves `queue=1 / pendingGuard=null` → a NEW proposal is accepted → confirm → `queue=2`.
  Mechanism: `fromSimulationState` keeps the core queue but drops the pending guard; deliberate
  clearing of pending commands on restore means a REAL save does not carry a queue at all,
  so the two restoration paths have different semantics (see §"真实 Save 丢 pending").
- Consequence: v2 may be used ONLY to reproduce this restore defect. No P2 full run, no model
  chain, no parity claims on it. v3 (restore-guard fix) will supersede it.

## v2 source hashes (known-bad generation)

- src/ai-native/echo.ts  `4eaa500061aba3673f9bca13635e0d4a1fa579b69472678d564f8c15811c126b`
- src/ai-native/echoAudit.ts  `53fd69c8954c73bf6e01e6daa85a37b931f67889c455801776b381f9e964204c`
- src/ai-native/worldHeadless.ts  `236dff81b2a827a8e3c4162ce818932b37cf12d81e4c382ec412efafe2535393`
- src/scenes/PauseScene.ts  `ed323491252df843618470dabcb2d1a1af90c92384cc1821e2c88df7475a9f72`
- src/systems/SaveSystem.ts  `38437c9dc3c7c7ac2b8fa6ecb2fb089b6d50e2d74ddb9ac328917f35c5e4b26b`
- src/types/index.ts  `3e24ac8b163babae8122248d2561760b73578d6542f88c63a63c7c937542c593`
- src/world/World.ts  `dd7a0fa0b5cd479b5efb5c25fd70f5ee92bd8e0adbcebeaa3d84287c5e2e1961`
- src/ai-native/echoCoop.test.ts  `d32fa5c6c5ee02e20a166ba8ac1fcc86fc9f874561799ca11c102fd48806a5e6`
- src/ai-native/worldHeadlessEchoCoop.test.ts  `ed3bc3f44853ff262915ef14a3293feb224265fb25dcf6d697a3f674bf190bbe`
- src/systems/SaveSystem.echoCoop.test.ts  `443c9ecfe51b6d1760d7e9f8aa1f90edbfe7ba459ce4cb774ae489cc4f7768a1`
