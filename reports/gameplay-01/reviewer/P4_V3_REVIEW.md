# GAMEPLAY-01 · P4 v3（R1/R2 恢复契约）· 独立增量复核

审查者：独立只读。日期：2026-11-18。范围：**v2→v3 增量**（R1 frame 恢复守卫、R2 `fromFrame` 运行时、
恢复契约措辞）。上一轮 `P4_FINAL_REVIEW.md`(v1) 与 `P4_V2_REVIEW.md`(v2) 原样保留，本文只对 v3 字节生效。
无模型调用、无 `src/`/`tests/` 修改、未 commit/push；不代替整体 GAMEPLAY，真人验收仍 `PENDING`。

## 0. 固定输入（先核字节，后谈结论）

| 项 | 值 |
|---|---|
| 候选工作树 | `D:\Project\LAST_SIGNAL\.cindy-worktrees\serene-leakey`，HEAD `3819621c5faab56b114b6e5a560f8fe78c17709d`，`commitsMadeByThisWorker: 0`，未 push |
| manifest | `…\reports\gameplay-01\developer\p4-recovery\manifest.v3.json`（`freeze.state = FROZEN for independent re-review (v3)`） |
| 我的快照 | `git archive 3819621` + v3 十个源 + 四个文档 → `D:\tmp\gp01-p4v3`（`node_modules` 只读 junction） |
| 主仓四 dirty | 未使用、未改动 |
| 冻结归档 | `v1-freeze/`、`v2-freeze/` 均存在，v2 冻结件未被本次覆盖 |
| 端口/浏览器 | 本轮无需浏览器（渲染源与 v1 同字节）；未使用 tester 5199/5492 与开发 5471 |

**14 个交付文件 sha256 与 manifest.v3 逐一相同**，审查前后再核仍不变：

```
core f71523e1  p1Scenario 76367087  worldHeadless 7382d6f0  World 3ff4f7e3  relay 6fc7ba40
relayRoutes.test 097bfc6f  worldHeadlessDemoRoute.test 11c812f7  p1ScenarioLayout.test 8b12cbf2
worldHeadlessFrameAuthored.test 93447a60  worldHeadlessRestoreSafety.test ec4139ff
docs: COOP_LEVEL_DESIGN.P4-UPDATE 7c9a19bf  P5_VARIANTS_PLAN 80094d2d
      P4_TEST_AND_FINAL_LIMITS 3a75fb96  P4_RESTORE_CONTRACT.V3 62986032
```

v2→v3 的实际变更与 manifest 自述一致：**只改** `src/ai-native/worldHeadless.ts` 与
`docs/gameplay/P4_TEST_AND_FINAL_LIMITS.md`，**新增** `worldHeadlessRestoreSafety.test.ts` 与
`P4_RESTORE_CONTRACT.V3.md`，其余源与 v2 逐字节相同。

## 1. Gate（命令 → 结果 → 绝对日志）

| gate | 命令 | 结果 | 日志 |
|---|---|---|---|
| typecheck | `npx tsc --noEmit`（我，快照内） | **PASS 0 `error TS`**, TSC_EXIT=0 | `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p4v3-typecheck.log` |
| 新增 8 + 相关 62 | `npx vitest run worldHeadlessRestoreSafety + relayRoutes + worldHeadlessDemoRoute + p1ScenarioLayout + worldHeadlessFrameAuthored` | **PASS 62/62（5 文件）** | `…\reviewer\p4v3-62tests.log` |
| P2 restore / echo / checkpoint 定向 | `npx vitest run`（echoCoop, worldHeadlessEchoCoop, coop, control, canonicalStability, runCheckpoint, SaveSystem.echoCoop, core, rewiring, parity, echoRoomTransition, signalState, externalLinkDuration, sessions, runtime, protocol, ownerAuth） | **PASS 315/315（17 文件）** | `…\reviewer\p4v3-p2restore.log` |
| 我的 R1/R2 探针 | `npx vitest run src/reviewer/p4v3-probe.test.ts`（仅我的快照） | **PASS 9/9** | `…\reviewer\p4v3-probe.log` |

开发者自测交叉核对（非我的证据）：v3/red-repro **8 failed（v2 字节）**、v3/green-repro **8 passed（v3）**、
v3-boundary **221/221（17 文件）**、v3-typecheck EXIT=0 → 路径 `…\p4-recovery\v3\*.log.txt` 与 `v3\gates\*.log.txt`。
`npm run test:parity`（3/3）我**未**重跑（源未变、非本轮 gate）。

## 2. R1（frame 恢复丢守卫）→ **CLOSED**

我原样复跑了 v2 审查里那条反例（`confirm → snapshot → new World → restore(frame) → 立即 propose+confirm`）：

| 观测 | v2（旧） | v3（现在） |
|---|---|---|
| 恢复后队列 | `['signal-scan']` | `['signal-scan']`（原样） |
| 恢复后守卫 | `null` | `{restored:true, proposalId:null, kind:'scan', acceptedTick:null}` |
| 立即 propose | 返回 `scan` 提案 | **`null`** |
| 立即 confirm | `true` → 队列 `['signal-scan','signal-scan']` | **`false`**，队列仍 `['signal-scan']` |
| 旧 id 直 confirm | — | `false`，队列不动 |

实现依据：`restore()` 在应用 frame 后做 `pendingLocalAction=null` → `echoController.reset()`（旧提案卡直接丢弃）
→ `restoreSignalGuard()`（`worldHeadless.ts:81-99`）复用既有 `findRestoredSignal()` + `setRestoredPending()`，
**不写任何人造 human-local receipt**。

真实执行（下一 tick）实测：`signal-scanned` 恰好 **1** 次、echo 能量 **100→90（cost 10）**、
队列清空、busy 解除、随后可重新提议；审计环里**没有**为这个未知来源命令伪造 `applied/enqueued` 行
（`auditResults: []`，与 P2 v3 的“未知来源不造假 receipt”完全一致）。

## 3. R2（`fromFrame` 运行时缺失）→ **CLOSED**

- `fromFrame()` 现在补 `EchoController` / `EchoAuditRing` / `echoRoomGeneration=0` / pending 字段，
  并调用同一个 `restoreSignalGuard()`（`worldHeadless.ts:1182-1196`）。
- 实测：`fromFrame(...).echoPendingLocal` **不再抛**（v2 是 `Cannot read properties of undefined
  (reading 'restoredPendingKind')`），守卫 `{restored:true, proposalId:null}`、`proposeLocalEcho()` 返回 `null`，
  与 `fromSimulationState` 同值；`replay(frame, steps)` `ok === true`，不崩。

## 4. 其余契约检查（我自己的探针，非开发者测试复制）

| 检查 | 实测 | 判定 |
|---|---|---|
| 混合 player+echo 队列不被误删 | restore 前 `['signal-scan:player','signal-scan:echo']` → restore 后**逐项相同**，一 tick 内两个真实 scan 各执行一次，队列清空 | PASS |
| actor 过滤语义 | **仅 player** 的 queued scan → 恢复后守卫 `null`（不当成 echo pending）；`toggle-relay`（无 actor 字段）→ 保守标 busy `{restored:true,kind:'toggle-relay'}` | PASS（保守，fail-closed） |
| 失败 restore 不改活状态 | 坏 frame → `{ok:false, code:'E_SNAPSHOT_INVALID'}`，`canonicalSimulationState` 前后**逐字节相同**、审计条数不变 | PASS |
| 旧帧兼容（无 `authored`、无 echo） | `restore` 接受、`routeState===null`、守卫 `null`、不抛 | PASS |
| Owner 确认不退化 | `confirmLocalEchoProposal(id, false)` → `false`，队列与守卫均未被改动 | PASS |
| audit 上限 | `cap=32`，写 80 条后 `recent(200)` 仍 ≤32 | PASS |
| 旧 local session 不残留 | 未确认就 snapshot→restore，目标世界 `echoController.localProposal === null`，旧 id confirm `false` | PASS |

## 5. 新发现（LOW，均不阻断；与文档措辞相关）

### N1（LOW）`restore()` 会保留**目标世界旧的审计行**，而三个 factory 路径是空环
实测：先让目标世界自己完成一次确认（审计里出现 `enqueued` + `applied` 两行，pid `local_2_1`），再把另一个
frame restore 进去 → `auditKept: true`，旧的两行仍在（其中包含一条 `applied`）。而
`fromFrame` / `fromSimulationState` 的审计环长度是 **0**。
即：四个入口的**守卫契约一致**（文档 §2 的声称成立），但**审计历史不一致**——restore 路径可能让上一会话的
`applied` receipt 看起来属于恢复后的状态。它不是“虚构”（行是真实发生过的），而是**过期残留**。
建议（二选一，都不改契约）：`restore()` 里同样 `echoAudit.reset()`（或换新环）；或在
`P4_RESTORE_CONTRACT.V3.md` §2 明确“审计历史不随 restore 清空，三个 factory 路径为冷启动审计”。

### N2（LOW）`echoRoomGeneration` 在四个入口不一致
`restore()` 不重置，保留目标世界旧值（我构造 7 后 restore 仍得 7，守卫标记里 `roomGeneration: 7`）；
`fromFrame` / `fromSimulationState` 置 0。守卫本身仍然正确（不重复、不误删），但**同一“契约”在代际字段上
不齐**。建议把 generation 纳入 frame（首选，语义最准），或在 `restore()` 里同样归零并在文档标注。

### R3（保持）跨版本 identity 限制
`P4_RESTORE_CONTRACT.V3.md` §4 已把 `sim.authored` 与 `World.p1Scenario` 的跨版本分叉列为**文档化限制**、
明确“本轮不修、也不声称已闭环”——与我的 v2 结论一致，措辞正确，无需改动。

## 6. 文档核对

- `P4_RESTORE_CONTRACT.V3.md`：**撤回**“所有恢复路径都安全”的旧泛称，改为点名四个 owner-restore 入口
  （`fromSimulationState` / `restore(frame)` / `fromFrame` / `replay`）各自成立的行为，并明确
  `RunCheckpoint`「丢弃未提交命令」是**另一套契约、不要混证**；R3 列为未修限制。**与实测一致，无过度声称。**
- `P4_TEST_AND_FINAL_LIMITS.md`（v3）：T12 改为“每个真实恢复入口”，措辞撤回同上；投影/0 伤害非平衡/
  HumanOnly≠断线/P5 仅计划等口径全部保留。`tests/gameplay-01.spec.ts:578` 旧断言仍标注为 T6 故事、
  由 tester 改写。**PASS**
- 旧 R1 红灯保留：`v3/red-repro.log.txt` 8 failed 仍在，未删；`v1-freeze`/`v2-freeze` 未被覆盖。

## 7. 判定

- **R1 CLOSED、R2 CLOSED**，且是“真反例转绿”：我独立复跑的那条 v2 反例在 v3 上不再产生重复队列，
  守卫为 `restored:true / proposalId:null`，旧 id 与新提案都被拒，队列逐项不变，真实 tick 恰执行一次、
  cost 10、无伪造 receipt。
- 我自己的 gate 全绿：typecheck 0、62/62、定向 315/315、探针 9/9；开发者 red→green（8→8）与 221 边界日志
  已核，红灯保留。
- **建议本地集成**。集成前唯一可选打磨是 N1（restore 的旧审计残留）与 N2（generation 字段不齐）——两者都是
  LOW、都不影响 R1/R2 契约与 P2 安全，可代码修（审计清空 + generation 归零/入 frame）或只改文档口径。
- 口径必须保持：Headless 通关是投影级；3 seeds 非 Rendered；0 伤害非平衡样本；`HumanOnly` 是无连接样本
  而非断线测试；ECHO 确认是 fixture 不是真人；`RunCheckpoint` 与 frame/raw-sim 契约不可混证。
- **整体 GAMEPLAY 仍不是 PASS**：P5（新敌/资源变体、对照指标、3-seed Rendered）与真人验收开放。

## 8. 本轮未验证

- 完整 818 单测、全量 E2E、`npm run build`、`npm run test:parity`（源未变，按 Lead 指示交 tester 正式全链）。
- 渲染层：v3 未改任何渲染源，故未跑浏览器；门位 Jam 成本仍以 v2 文档口径（23–25 净差）与 tester 的 exact-25 为准。
- `v2-freeze` 内部逐文件 hash 我只核了目录存在与 manifest 记录，未与 v2 清单逐条重算（v2 已在本轮前独立审过）。
