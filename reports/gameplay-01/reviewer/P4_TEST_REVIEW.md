# GAMEPLAY-01 · P4 v4 测试增量独立复核（reviewer）

审查者：独立只读。日期：2026-11-18。范围：**tester 的 P4 v4 测试增量**（`run4-v4-final`，4 个 spec 的 diff + 全量/定向运行证据）。
不重跑全量；不改 src/tests；无模型调用；未 commit/push；未使用 tester 5199/5492 及其 clone；自有快照与端口已释放。

## 0. 冻结输入与字节（逐项核对）

| 项 | 值 |
|---|---|
| 快照 | `reports/gameplay-01/tester/p4-final/run4-v4-final/`（`spec-snapshot/`、`diff/tests.diff` 1506 行、`logs/`、`evidence/`、`shots/`、`source-snapshot/`） |
| 基线 | HEAD `3819621c5faab56b114b6e5a560f8fe78c17709d`（主仓 feat 分支 HEAD） |
| manifest | `manifest.v4.json` sha256 `bfafe089…f3ac`；10/10 源与 4/4 文档逐项相同；仅 `World.ts` 与 v3 不同（`3ff4f7e3` → `349544bf`） |
| 4 个 spec 实测 sha256 | P1 `a7db1885…`、P4 `839e91fb…`、P2 `53690495…`、probes `22ae61f7…`（与 HASHES.txt 及报告表一致） |
| **历史 byte 条纹（此处明确，不允许 exact-bytes 冒充历史 full）** | P4 `17fe4a09…` → v3 全量 150/155；P4 `50e74fdc…` → v3 P4 九 9/9；P4 `839e91fb…` → v4 P4 九 9/9；P2 `fbe7ca78…` → **v4 全量 153/155 的字节**；P2 `53690495…` → **v4 P2 7/7 定向跑的字节，始于全量之后** |

运行时间线（日志头，已核）：完整单元套件始于 15:39Z → B7 隔离重跑始于 15:52Z → 全量 Playwright 始于 15:54:15Z（23.2m，约 16:17 结束）→ P2 新字节 7/7 定向始于 16:21:15Z。故 `53690495` 绝不可能是 153/155 全量的字节；报告中此关系已正确写明（HASHES.txt “historical byte mapping”、测试表行 19、P4_TEST_REPORT.md v4 节脚注），此处再次确认。

## 1. Gate（测试表复核，命令 → 结果 → 绝对日志）

| gate | 命令 | 结果 | 日志 |
|---|---|---|---|
| 完整单元 | `npm test`（v4 树，73 文件） | **FAIL 857/859**（B7 两条壁钟超时，见 §3） | `…/run4-v4-final/logs/unit-npm-test.log.txt` |
| B7 隔离重跑 | `npx vitest run src/ai-native/runtime.test.ts -t B7`（5494 已停） | **PASS 4/4（8.2s；36 条被 -t 过滤，非 skip）** | `…/run4-v4-final/logs/unit-b7-isolated.log.txt` |
| typecheck | `npx tsc --noEmit` | **PASS（0 `error TS`）** | `…/run4-v4-final/logs/typecheck.log.txt` |
| build | `npm run build` | **PASS exit 0** | `…/run4-v4-final/logs/build.log.txt` |
| mcp surface | `npm run test:mcp-surface` | **PASS 1/1** | `…/run4-v4-final/logs/mcp-surface.log.txt` |
| parity | `npm run test:parity`（fresh export） | **PASS 3/3** | `…/run4-v4-final/logs/parity.log.txt` |
| 完整 Playwright | `PORT=5199 npx playwright test --workers=1` | **FAIL 153/155, exit 1**（2 P2 readiness：`gameplay-02-echo-coop.spec.ts:527` case6 legacy save、`:590` case7 real save+reload；v3 的两条 legacy 门户回归在此次运行中**已通过**） | `…/run4-v4-final/logs/full-e2e.log.txt` |
| P4 九（3 seed × 2 模式） | `… gameplay-04-coop-level.spec.ts` | **PASS 9/9 (2.5m)** | `…/run4-v4-final/logs/p4-nine.log.txt` |
| P1 七 | `… gameplay-01.spec.ts` | **PASS 7/7 (1.5m)** | `…/run4-v4-final/logs/p1-seven.log.txt` |
| R1/R2/R2b 探针 | `… gameplay-04-headless-restore.spec.ts` | **PASS 7/7** | `…/run4-v4-final/logs/r1-r2-probes.log.txt` |
| Portal 定向 | `echo-portal-migration` + `signal-human-crossroom` | **PASS 3/3** | `…/run4-v4-final/logs/portal-targeted.log.txt` |
| P2 新字节定向 | `… gameplay-02-echo-coop.spec.ts`（`sha256=53690495…`） | **PASS 7/7 (1.6m)** | `…/run4-v4-final/logs/p2-seven-new-bytes.log.txt` |

**两个数字均保留**：run3-v3-final 全量 **150/155**（P2 `fbe7ca78…`）；run4-v4-final 全量 **153/155**（同 P2 `fbe7ca78…` 字节）。`53690495…` **只对应 7/7 定向跑，绝不与 153/155 全量混淆**。

## 2. 测试 diff 审查（`diff/tests.diff`，1506 行）

| 文件 | 增/删 | 实质 |
|---|---|---|
| `tests/gameplay-01.spec.ts` | +204 / −76 | `tapKey()` 真按键（keydown→等一帧→keyup，解决 `press()` JustDown 丢边）；`bootDemo` readiness：`world && sim.tick > 0 && cameras.main && p1Scenario !== undefined`（固定 900ms 改为状态等待，**不放宽断言**）；门位自然 Jam（exact cost，从已提交 `signal-jammed` 事件负载读 25，F 阻断，expiry 恢复，走远拒绝）；原 `>JAM_RANGE` 门距断言按裁决替换（F7）；**六条旧 expect 逐条对照：四条语义保留，两条被更强断言替换/反转，无删除** |
| `tests/gameplay-02-echo-coop.spec.ts` | +15 / −3 | `clearRoomByRealPlay` readiness：等 `world && sim.tick > 0 && cameras.main`；scene restart 后重取 `gs?.world`，对 `!w` 返回 `notReady`，再等 200ms 继续；战斗断言本身不变；**无 `skip`/`.only`/断言弱化/超时放宽** |
| `tests/gameplay-04-coop-level.spec.ts` | +998 / −0 | 新：`clearEvents.length === 1`（渲染侧精确一次，v3 仅 `>0`）；ECHO 确认→`applied` 同 pid，tick 差 `1..2`（同构器相位说明已标注，三种实测均为 1）；单 commit 计数 `commitCount === 1`；成本取事件负载 `pre−energy === SCAN_COST`，非净差；`modelState` 不再读（改用 `companionStatus`；连接样本明确标“无连接样本，非断线测试”）；新增门内自然 Jam 分支（spawnJam + 真走到门位 + 真按 Y + expiry + 真换房） |
| `tests/gameplay-04-headless-restore.spec.ts` | +162 / −0 | 与 v3 逐字相同（R1/R2 探针） |

**没有 `test.skip`/`test.only`/`xit`/`fixme`；无 playwright.config 改动；全量命令无 `--grep`/`--ignore` 覆盖。** 全量命令：`PORT=5199 npx playwright test --workers=1 --reporter=line`（见 full-e2e.log.txt 头）。

## 3. 你要求逐项核查

### 3.1 per-iteration readiness guard：真等 `GameScene.world`/`cameras` 有效；scene restart 后停输入/重取对象

P2 `clearRoomByRealPlay`（`:217-270`）：在每轮循环前 `waitForFunction(() => !!gs?.world && gs.world.sim.tick > 0 && !!gs.cameras?.main)`；采样函数内部 `const w = gs?.world; ... if (!w || !gs.cameras?.main) return { notReady: true, ... }`；收到 `notReady` 后 `waitForTimeout(200)` 继续下一轮。P1 `bootDemo` 同模式。此为**等待就绪而非吞错误**：不就绪时不采样，所有断言都在就绪后的快照（`snap()`）上做；scene restart（CONTINUE/reload）后会重新等就绪。PASS。

### 3.2 P4 `clearEvents===1` / echo 事件成本 10 / 同 pid 下一 tick commit

- 渲染侧：`expect(clearEvents.length, 'the core emitted exactly ONE room-cleared commit for this room').toBe(1)`（**恰一次**，证据 `coreClearEvents: 1`，三种全部为 1）。
- ECHO（3 种全为 scan）：`enqueued@T` → `applied@T+1`（三种实测均为 1 个 tick，断言允许 `1..2`，同构器相位说明已标注）；`commitCount === 1`（此确认在窗口内恰一次）；`commit.pre! − commit!.energy! === TUNE.SCAN_COST`（100→90，**事件负载**，非净差）；`chargedActorId: 1`（渲染侧 echo actor id，与 headless 的 `-2` 不同，故用 actor-agnostic `signalCommitAny`）；非战斗状态变化按 kind 断言（scan：evidence 增加）。
- 证据：`evidence/p4-route-*-HumanEcho.json` 中 `echoEnergy`（confirmTick/receiptTick/receiptTicks/actualCost/commitsInWindow/chargedActorId/eventPreEnergy/eventEnergy/netPlayerDelta）与 `echo.audit`（`[{result:'enqueued',tick:T},{result:'applied',tick:T+1}]`）。**正确、真实、可追溯**。
- headless 侧：`clearEvents.length > 0`（**不够强**，仅 >0；渲染侧恰 `===1`；dev 源测试 `worldHeadlessRestoreSafety.test.ts` 已对 headless 断言恰一次，此处留给 P4 全量时加强，不阻断本轮）。

### 3.3 `modelState` 死记录

已删除：不再读 `signalView().modelState`（永远 null）；改用 `companionStatus`；连接样本显式标记为“无连接样本，非断线测试，P2 保留断线证据”。PASS。

## 4. default B7 两红（unit 857/859）的有限推断

- `runtime.test.ts` **内容与基线 `3819621` 逐字节相同**（仅 CRLF 端不同，`diff` 空）：**20s/15s 预算原封不动，未放宽**（Lead 要求“原15/20严格保留”得到满足）。
- 两条失败均出现在完整 `npm test` 期间（此时两个 Vite 服务器 5199/5494 同时运行，启动日志 `vite-5199.log` / `vite-5494.log`）；B7 隔离重跑（5494 已停）`4/4，8.2s`。
- **推断只能是“有负载相关性”**：单元套件在双服务器负载下两次触发壁钟预算，停止一台服务器后通过；**不能推断“是负载导致”**，也不能推断“不是产品逻辑**。有限推断，属未修的 load-risk，不计入 P4 产品回归，也不在 v4 gate 之内。
- 原 15/20 预算严格保留 ✓（见上）。

## 5. 原 15/20 / 150/155 / 153/155 的边界

- `runtime.test.ts` 预算：原样，未碰。
- 两个全量记录均保留：v3 全量 **150/155**（P2 `fbe7ca78…`，2 legacy 门户回归 + 3 readiness）；v4 全量 **153/155**（同 P2 `fbe7ca78…` 字节）。v4 相对 v3 的变化：**两条 legacy 门户回归由 FAIL 变 PASS**（P4_V4_REVIEW 闭环 R1/R2）；其余两条失败（P2 test6 legacy save readiness、P2 test7 real save+reload readiness）在 v4 全量中**仍然失败**。v4 的 2 failed 与 v3 的 2 门户失败**不是**同一组，不得互相回填。——readiness 问题未在全量中消失（孤立跑皆绿，说明是全量并发/时序问题，非产品断言弱化）。
- P4 测试增量本身（9 条）：v3 全量 9/9 → v4 全量 9/9（P4 spec 字节从 `50e74fdc…` 变为 `839e91fb…`，加了门内自然 Jam 分支与 exact-once 断言，9/9 保持绿）。

## 6. 判定

- P4 测试增量（4 个 spec 的 diff）：**可接受**。diff 仅为：真按键、readiness 等状态（不吞错、不跳、不放宽断言）、门位自然 Jam + exact-cost 事件负载、clearEvents===1、ECHO 确认→applied 同 pid 下一 tick + 单 commit + 事件负载成本、modelState 读改为 companionStatus。无 `skip`/`.only`/断言放宽；P1/P2 diff 与 v3 的同等内容一致。
- 完整 153/155 中的 2 P2 readiness 失败（case6 legacy save、case7 real save+reload）属 harness 时序，孤立绿，**不应被计入产品质量**，但全量再跑前应视为“已知例外”；v3 的两条 legacy 门户回归已由 P4_V4_REVIEW 闭环（单源 `World.ts` 修复，我独立红→绿复现）。
- **整体工程：尚不可结论 PASS**。Load-risk（B7 两红）未根因定位；P5 未实现；human acceptance `PENDING`；Tester 尚需按“最终有依据流程”在另一树跑完整新版 profile（停自身 devservices→`npm test -- --maxWorkers=2` 全 859→surface/build→dual Vite 5199→最新 P2 字节冻结后完整 155→fresh parity）。
- 本人已争取 CPU/端口隔离（自有端口 5498/5497，均已释放）；此处仅做静态审计，**不重跑全量**，后续若 Tester 回送新日志，可再核数不重跑。

## 勘误（本次纠正）
- v4 全量失败分类曾误写为“2 真产品 + 3 harness readiness”，经 Lead 重读 `run4-v4-final/logs/full-e2e.log.txt` 尾部纠正：**2 failed 恰为 P2 `gameplay-02-echo-coop.spec.ts:527`（case6 legacy save）与 `:590`（case7 real save+reload）两条 readiness 失败**；v3 的两条 legacy 门户回归在此次运行中**已通过**（v3 run3 才是 150/155 = 门户 2 + readiness 3）。P4_V4_REVIEW 的“spec red v3，green v4”记录不变，不被本段覆盖；定向补绿不得回填任何 full 记录。正确记录：`run4-v4-final/logs/full-e2e.log.txt` 尾部列出 `2 failed`，即 `gameplay-02-echo-coop.spec.ts:527:3` 与 `:590:3`，`153 passed (23.2m)`，`exit_code=1`。

---

## 7. run5（v4 final）追加判定 — ECHO next-tick 断言收紧为 after？不成立，属**弱化**；契约可在零产品改动下测

审查者只读，独立 cwd；未跑 full155/859、未起 devserver/端口、未改 src/tests、未 commit/push。输入：`reports/gameplay-01/tester/p4-final/run5-v4-final/`（`HASHES-pre-run.txt`、`diff/tests.diff`、`spec-snapshot/`、`logs/`、`evidence/`、`source-snapshot/`）。主仓 `d55e502` 的 `src/world/World.ts`=`349544bf…`、`src/world/sim/core.ts`=`f71523e1…`、`src/ai-native/worldHeadless.ts`=`7382d6f0…`，与 run5 树冻结源逐字节相同（sha 相等），故下列行号即 run5 树行号。

### 7.1 断言改动（逐字，唯一 hunk）

`diff/tests.diff` → `tests/gameplay-04-coop-level.spec.ts` 712–718（run4 `839e91fb` = run5 旧断言；run5 `8ccc3b29` = 新断言）：

- 旧（`spec-snapshot` 之外，run4/aborted 尝试的 :718）：
  `expect(receiptTicks! >= 1 && receiptTicks! <= 2, 'the receipt lands on the next processed core tick (measured 1-2; got …)').toBe(true);`
- 新（run5 `spec-snapshot/gameplay-04-coop-level.spec.ts:718`）：
  `expect(receiptTicks!, 'the receipt is after the confirmation (measured … tick(s))').toBeGreaterThanOrEqual(1);`

**判定：这是弱化，不是“收紧”。** 上界被去掉后，`after` 对任何延迟都通过（第 3、第 15 个 tick 甚至下一帧之后都算 PASS），而“next processed core tick”契约恰恰要求“**第一个**被处理的 core tick”。不过旧断言 `<=2` 本身也**标定错误**：一帧可连跑最多 15 个固定 tick（`core.ts:41-43`：`TICK_MS=1000/60`、`MAX_FRAME_DELTA_MS=250`、`MAX_TICKS_PER_FRAME=15`；`World.ts:1858-1860` 截断），所以 1..2 在负载下必红（aborted 尝试实测 `got 3`，`logs/full-e2e-attempt1-aborted.log.txt:109,117-118`）。正确做法不是删上界，而是把上界改成**架构上界 15**并补“首个推进 tick 的批次”断言。

### 7.2 四个 tick 来源（代码定位，均已在主仓冻结字节上核对）

| 观测 | 来源 | 时点 |
|---|---|---|
| `enqueuedTick`（确认） | `World.ts:798`（headless `worldHeadless.ts:589`）`tick: this._sim.tick` | 确认调用时、任何 tick 之前 |
| 真实核心事件 `signal-scanned` | `core.ts:1371` `processCommands`（每 tick 的第一条语句；`state.tick++` 在 `core.ts:1387`） | 排干批次里的**第一个** tick |
| `audit.tick`（applied） | `World.ts:510-516` `settlePendingLocalSignal` ← `World.ts:1899` `applySimEvents`（在 `stepSimulationTicks` **整批之后**） | 排干帧结束时（headless 同构：`worldHeadless.ts:771-773`，整批之后） |
| 驱动 `postStepFrame _sim.tick` | 接线器 `if (ev.length) __p4Batches.push({pre, ev, tick: w.sim.tick})`（run5 spec :202） | 帧结束时 |

结论：`receiptTicks == 排干该命令的那一帧的固定 tick 数 == commitBatchTick − enqueuedTick`。3 是**采样相位**（该帧跑了 3 个 tick），不是“第 3 个 tick 才执行”。渲染端与 headless 端同为“批后结算”，因此同一现象在两端都会出现。

### 7.3 确定性探针（只读，无产品/测试改动，无端口）

`reports/gameplay-01/reviewer/run5-echo-tick-probe.ts`（sha `6678ba4b…`）→ 日志 `run5-echo-tick-probe.log.txt`（sha `e1301c43…`），`vite-node` 单进程，0 devserver：

| case | 排干批 tick | scans in batch | auditGap | echo 事件成本 | 说明 |
|---|---|---|---|---|---|
| A1 | 1 | 1 | 1 | 10 | 单 tick 批：首 tick 执行、恰好 1 事件 |
| A2 | 0 → 1 | 0 → 1 | 1 | 10 | **frozen（0 tick）时不执行**：pending 仍在、仅 `enqueued` 行；恢复首个 tick 立刻执行 |
| A3 | 3 | 1 | **3** | 10 | 复现“got 3”：执行仍在首 tick，gap 只是批 tick 数 |
| A4 | 15 | 1 | **15** | 10（净值 9） | 上限 15 处仍首 tick 执行；净值被批内 regen 污染，故必须读事件负载 |

（A4 的 `echoEnergyDelta=9` 印证：净差会少 1，事件负载才是 10。）既有 dev 先例：`src/ai-native/worldHeadlessEchoCoop.test.ts:40`“human confirm commits a real core scan on the next tick”已用 `runSteps([{ticks:1}])` 断言单事件——即“首 tick”证据无需新 hook。

### 7.4 可测方案（0 产品改动；测试改动建议交 Tester 决定）

1. **恢复有界契约**：`expect(receiptTicks).toBeGreaterThanOrEqual(1)` + `expect(receiptTicks).toBeLessThanOrEqual(15)`（架构上界 = `SIM_TUNING.MAX_TICKS_PER_FRAME`），不是无界 after。注意该 spec 的 `TUNE` 是**手抄字面量**（`:38` `const TUNE = { SCAN_COST: 10, … }`），并未从 `src/signal/signalTuning` 或 `src/world/sim/core` 导入；既然它已 `import { HeadlessWorld } from '../src/ai-native/worldHeadless'`（`:29`），建议顺带把 `SIM_TUNING.MAX_TICKS_PER_FRAME` 从 `../src/world/sim/core` 导入，并把 `TUNE` 换成 `SIGNAL_TUNING`（`src/signal/signalTuning.ts:13,21` 已有 `SCAN_COST: 10`、`JAM_RANGE: 6`）以消掉手抄漂移——现字面量与源值虽一致，但源值改动时该 spec 会静默失效。
2. **首个推进批次**（对“被延迟一帧”也 airtight）：把接线器改成**无条件**记录 `{preTick, postTick: w.sim.tick, ev}`（现为 `if (ev.length)`，0-event 帧被丢弃）；断言“确认后第一个 `postTick > preTick` 的 stepFrame 批次里恰有 1 个 `signal-scanned`，且 `postTick − enqueuedTick ≤ 15`”。无产品改动。
3. **确定性 headless twin**（同 seed、同一 spec 内或引用 dev 测试）：确认→`runSteps([{ticks:1}])`→该批恰好 1 个 scan、`applied.tick === enqueued.tick + 1`、成本取事件负载=10、`commitCount===1`。这是“首个 processed core tick”的直接证明，不绕模拟。
4. **paused 窗口（可选，页面级）**：`GameScene.update` 在 `paused` 时直接 return（`scenes/GameScene.ts:506`），`onPause`（`:965`，重置累加器 `:982`）与 `onResume`（`:986`，重置累加器 `:987`）各重置一次，暂停期间不累加时间。故可：暂停中走产品边界确认→等 >20 帧断言 `sim.tick` 不变、无 scan 事件、仅 `enqueued` 行→恢复→第 2 条断言成立。**不需要产品 hook**；若 Lead 仍要 hook，请先批。

**结论：核心第 3 tick 才执行不成立（探针 A2/A3/A4 反驳）。** 该改动不应以现状合入；按 1+2+3 恢复“首个 processed tick + 有界 gap + 单 commit”即可，零产品改动。

### 7.5 run5 gate 与两个新驱动失败的静态归因

run5 日志（`logs/full-e2e-final.log.txt`，153 passed 22.8m，`exit_code=1`）2 failed：
- `gameplay-04-coop-level.spec.ts:579:5`（seed 20261119 HumanEcho，断言在 `:659`：`signalCommit('signal-jammed')` 为 null）；
- `gameplay-02-echo-coop.spec.ts:595:3`（case7，断言在 `:608`：`clearRoomByRealPlay` 120 s 后 `cleared=false`）。

| run5 记录 | 结果 | 日志 |
|---|---|---|
| gap 修复定向（6 条 route） | PASS 6/6 (2.0m)，18:53Z | `logs/p4-echo-gap-fix-targeted.log.txt` |
| full 155 | FAIL 153/155，22.8m，19:20Z（上两条） | `logs/full-e2e-final.log.txt` |
| seed19 孤立重跑（同字节） | **PASS 1/1 (21.2s)**，19:28Z | `logs/diag-p4-seed19-echo-isolated.log.txt` |
| P2 case7 孤立重跑（同字节） | **FAIL 1/1**，19:29Z，`:608` 同一断言 | `logs/diag-p2-test7-isolated.log.txt` |
| P2 七条定向（同字节，full 之前） | PASS 7/7 (1.5m)，16:44Z | `logs/p2-seven-targeted.log.txt` |
| aborted 尝试（旧 `839e91fb`） | 红于 `:718` `measured 1-2; got 3` | `logs/full-e2e-attempt1-aborted.log.txt:109` |

（run4 的 153/155 记录仍只对 run4 `fbe7ca78…` 有效；run5 的 2 failed 是另一组，不回填。）

**seed19 Jam event null — 静态归因**：单帧 Y 无事件**只能证明“未提交”**，不能证明 load：(i) 若产品拒绝（range/LOS/energy/cooldown），核心仍会发 `ok:false` 的 `signal-jammed`，而这里连事件都没有 → 更可能是命令未入队或当帧未排干；(ii) 孤立重跑同字节 PASS → 非确定性，与输入边沿/所有权回夺时序相符，但**不构成 load 证据**。缺的观测（精确）：按键前后 `sim.pendingCommands`（是否出现 `signal-jam`）、`echoAudit.recent()` 在该时刻是否有 local-confirm/rejected 行、`control.owner` 与 `takeoverFromHumanInput()` 结果、`playerJamCD`/`p1JamRemainingTicks`/能量、`KeyY` 的 down/up 帧号与 `signalKeyCooldown`、按压窗口内 `__p4Batches` 条数与 `postTick`、`relay` 前后态。失败运行不落 `evidence/*.json`（只有通过样本），这也是缺口。

**P2 case7 120 s 不清 — 静态归因**：120 s 超时**只证明“窗口内未清”**。且同字节 16:44Z 定向 7/7 PASS、19:29Z 孤立 FAIL → 非 load 相关（孤立亦红），属复现性不稳定的行为差异；驱动本身缺死亡判别：`clearRoomByRealPlay` 不查 `GameOverScene`/`hp<=0`，玩家阵亡后循环仍空转到 120 s，最终只报 `cleared:false`，会把“阵亡”误报为“未清”。缺的观测（精确）：`hp` 时间线与 `GameOverScene`/`runStatus`、`enemies` 数量与各 hp 时间线、开战 `relay` 态与那次 KeyY 的结果（是否被拒、拒因）、每发是否真开火（`fireHeld`/冷却/弹丸数）、遮罩是否挡住开火（`pointerDownOnUi`）、`map.rooms[id].spawned/cleared` 时间线、`sim.tick` 是否持续推进、玩家与最近敌距离轨迹。因此这两条**均不足以定“非产品”**；seed19 至少需要 pending/audit/owner 三观测，case7 至少需要死亡+伤害两条时间线。

### 7.6 本节点判定

- ECHO next-tick 改动：**弱化，不可按现状作为契约证据**；按 7.4 的 1+2+3（可含 4）可在**零产品改动**下恢复“首个 processed tick + 有界 gap + 单 commit”，无需 hook。
- 两个新失败：**均未被证明为非产品**；seed19 需要 pending/audit/owner 观测，case7 需要 death/damage 时间线；120 s 与单帧 Y 都不是归因证据。
- 未重跑 full/859；本节点为静态审计 + 单文件只读探针（无端口、无 devserver、无 src/tests 改动）。

---

## 8. run6（`after-spec` P4 `aa9ee012` / P2 `b26b58d7`）— 输入消费语义修复复核：**先补 1 处断言再开完整 E2E**

审查者只读：未跑 full 155/859、未起 devserver、未用任何端口、未改 src/tests/config、未 commit/push、未动 Tester 隔离树与服务。输入目录 `D:/Project/LAST_SIGNAL/reports/gameplay-01/tester/p4-final/run6-v4-inputs/`（`HASHES-INPUTS.txt`、`before-spec/`、`after-spec/`、`diff/`、`logs/`、`evidence/`、`source-snapshot/`）。run5 的 153/155 与本轮定向结果并列保留，不互相回填。

### 8.1 冻结与字节（逐文件 sha256，实算）

| 检查 | 结果 | 路径 |
|---|---|---|
| `sha256sum after-spec/*.spec.ts` = `HASHES-INPUTS.txt` | **PASS** P4 `aa9ee012…b7363c`、P2 `b26b58d7…cf1e8`、P1 `a7db1885…a3743`、headless-restore `22ae61f7…7e4bf55` | `…/run6-v4-inputs/after-spec/` |
| `sha256sum /d/tmp/ls-p4-v4/tests/*.spec.ts`（被测树实际字节） | **PASS** 四个与 after-spec 逐字节相同（`/d/tmp/ls-p4-v4` HEAD `3819621`，branch `p4-v4`） | `D:/tmp/ls-p4-v4/tests/` |
| `source-snapshot` 10 文件 vs `manifest.v4.json` vs 主仓 `d55e502` | **PASS** 三方同 sha：core `f71523e1…`、World `349544bf…`、worldHeadless `7382d6f0…`、p1Scenario `76367087…`、relay `6fc7ba40…`＋5 测试文件 | `…/run6-v4-inputs/source-snapshot/src/`、`…/developer/p4-recovery/manifest.v4.json`、`D:/Project/LAST_SIGNAL/src/` |
| 主仓工作树 `tests/gameplay-04-coop-level.spec.ts` | **不计入**：主仓仍是旧字节（`aa6b2298…`，晚于 run5 未同步）。被测字节只存在于 `/d/tmp/ls-p4-v4`，这一点必须写清，不能拿主仓文件当“已测证据” | `D:/Project/LAST_SIGNAL/tests/` |

### 8.2 P4 门位 Y 驱动（`diff/gameplay-04-coop-level.spec.ts.diff`：+155 / −4（4 行是旧 `tapKey+waitForTimeout` 段），逐项）

| 要求 | 实测代码位置 | 判定 |
|---|---|---|
| 每次 Y 只一次 `keydown` | `after-spec/gameplay-04-coop-level.spec.ts:761` 单次 `keyboard.down('KeyY')`；全文无第二次 down | **PASS** |
| 按住直到真实 tick 且 `signal-jammed` 出现 | `:762-768` `waitForFunction`：`sf` 中存在 `signal-jammed` 且存在 `ticks>0` 的 stepFrame，`{timeout:5000}` | **PASS（但条件偏松，见 8.4-③）** |
| keyup 一定发生（finally） | `:773-777` `finally { 等一真实帧(>f0, 4000ms) 后 keyboard.up('KeyY') }` | **PASS**；唯一瑕疵：finally 里 4000ms 若超时会抛出并**覆盖**原始错误信息（可诊断性，不是契约问题） |
| 不重试、不第二次 Y、无源改 | 无 catch 重试；失败分支 `:771-772` 记录 `p4-jam-input-timeout-*`（`pre`+`trace`+`snap`）后 `throw` | **PASS** |
| 前置条件 = core 判据 | `:306-342` `jamPreconditions`：GameScene active/唯一/未暂停/无升级遮罩/world+camera/relay ACTIVE/jamCD=0/energy≥25/距离≤6/LOS 按 0.25 步长取半径 0.5 采样 | **PASS**（与 `core` 的 `signalLegality` 同法）；证据 `evidence/p4-route-20261119-HumanEcho.json` `jamInput.pre.checks` 11 项全 true，`distance=1.601`、`energy=100` |
| 不额外推进 tick、不额外 step | 接线器 `:280-303` 只包 `w.stepFrame`（记 `t0/t1/ticks/queueBefore/After/energy/ev/loopFrame`），不调用第二次；`orig` 即已有 event tap 包装（`if (ev.length)` 只影响 `__p4Batches`，不影响本 trace） | **PASS** |
| 成本 25 与 F 禁止不得弱化 | `:789` `before−energy === TUNE.JAM_COST`（=25，取事件负载）；`:790-792` relay 必须为 JAMMED 且 `portal/routeTarget` 必须为 null；`:799` F 后房间号不变；`:808-811` 到期恢复 ACTIVE+portal+routeTarget | **PASS**（`diff` 中 `^-.*expect(` = 0 条，即**没有任何旧断言被删/改**；`grep -c "^-.*expect("` 两个 diff 均为 0） |
| 5 s 事件等待与旧 budget 的关系 | 旧：`tapKey('KeyY')` → 内部只等 **1 个 RAF 帧**（spec `:64` 的 `page.waitForFunction(..., {timeout:4000})`）+ `waitForTimeout(500)`，**没有任何事件等待超时**；新：新增 `5000ms` 事件等待 + 新增 `4000ms` 单帧等待。`test.setTimeout` 前后同为 `300000`（before `:580` / after `:675`），其余 40000/60000/60000/300000/180000 逐项相同 | **PASS：没有任何旧超时被缩短；5 s 是新增上界，不是改动旧值** |

补充事实（对“按住会不会连发 jam”）：`GameScene.ts:524-540` 用 `JustDown` + `signalKeyCooldown`（释放才清零，`:544-549`），一次按下只入队一次 `signal-jam`；`World.playerSignalJam`（`:596`）只入队、不写状态。故“按住”不会重复提交——这既解释了为何该改法安全，也说明它去掉的是“帧内 keyup 导致 `JustDown` 丢失”的边沿风险。

### 8.3 回执契约（本次核心）：**audit 是批末采样；但新断言并未锁住“首个处理批”**

代码链（主仓 `d55e502`，等于被测源）：
- 确认时写 `enqueued` 行的 tick = `this._sim.tick`（`World.ts:797-800`），即**排干批的起始 tick**；
- 每 tick 的第一条语句就是 `processCommands`（`core.ts:1371`），它**原子排干整个队列**（`core.ts:518-521`：`state.pendingCommands = []` 后再处理），故命令由该批的**第一个** tick 执行；`state.tick++` 在该 tick 末尾（`core.ts:1387`）；
- `applySimEvents` 在 `stepSimulationTicks` **整批之后**调用（`World.ts:1899`），`case 'signal-scanned'` → `settlePendingLocalSignal`（`World.ts:2021-2026`）写 `applied` 行的 tick = 批末 `sim.tick`（`World.ts:510-516`）。

因此**结构性恒等式**：`receiptTicks(applied−enqueued) == 排干批的 tick 数 == commitBatchTicks`；执行发生在 `enqueuedTick` 这个 tick 计数器上，`+1` 只是同一 tick 的 `tick++`。所谓“第 3 个 tick 才执行”不成立，“audit applied 1038”只是批末采样。

两次独立运行的 trace 完全一致地满足该恒等式（不是单次巧合）：

| 运行/文件 | enqueued | 排干批 | 批 tick 数 | queueBefore | 事件 | applied | receiptTicks |
|---|---|---|---|---|---|---|---|
| 通过轮 `evidence/p4-route-20261119-HumanEcho.json`（P4 `aa9ee012`，3/3 那次） | 1034 | 1034→1035 | 1 | `["signal-scan"]` | `signal-scanned#1`、`signal-energy#1` | 1035 | 1 |
| 诊断轮 `evidence/p4-receipt-diag-20261119-HumanEcho.json`（**旧 spec `6a8085f5`，EXIT=1**） | 1037 | 1037→1038 | 1 | `["signal-scan"]` | 同上 | 1038 | 1 |

诊断轮另有一条 `1039→1041 ticks=2` 的批（该批 `queueBefore=[]`），说明“一帧可跑多 tick”，与 `core.ts:41-43` 的 `MAX_TICKS_PER_FRAME=15` 一致；它**不**是“命令延迟”。

**但断言层仍不 airtight。** 现锚点只有（`after-spec/gameplay-04-coop-level.spec.ts:865-873`）：

1. `receiptTicks >= 1`（**无上界**）；
2. `commitBatchTicks >= 1`；
3. `queueHeldMoreThanOneBatch === false`（`:570` 定义 = 排干批之前存在 `queueBefore` 非空的批）；
4. `queueBeforeCommitOrder === ['signal-scan']`（+ 既有 `commitCount === 1`）。

反例（可构造、且正是我们要防的回归类）：若产品把确认后的入队推迟 3 帧（`enqueued` 行仍在确认时打 1034，命令却在 4 个批之后才进队列），则 1、2、4 全过，3 也为 `false`（中间批 `queueBefore` 为空）——**四项全绿而契约已破**。缺的正是“批序号”那句：`firstBatchWithCommit` 与“确认后第一个 `ticks>0` 的批”是否相同，当前从未断言。

**最小修改（0 产品改动、无新字段，数据已在 `receiptSemantics.batches` 里）**：

```ts
// 确认行 tick 即排干批的起点；第一个“真正推进了 tick”的批必须就是提交批
const enq = enqueuedRow!.tick;
const firstProcessing = echo.receiptSemantics!.batches.findIndex(
  (b: any) => b.ticks > 0 && b.t0 >= enq);
expect(echo.receiptSemantics!.firstBatchWithCommit,
  'the command is drained by the FIRST batch that processes a tick after the confirmation')
  .toBe(firstProcessing);
// audit 是批末采样：applied−enqueued 必须恰等于该批 tick 数（不是“≥1 的任意以后”）
expect(receiptTicks, 'the applied row is stamped at the END of the draining batch')
  .toBe(echo.receiptSemantics!.commitBatchTicks);
// 架构上界（可保留 7.4 建议的 SIM_TUNING 导入写法）
expect(echo.receiptSemantics!.commitBatchTicks!).toBeLessThanOrEqual(15);
```

说明：`ticks > 0` 必须留在 `firstProcessing` 里——0 tick 的帧不排干任何命令（探针 A2 已证），否则会把“0 tick 帧 + 下一批提交”误判为延迟。反之 `queueHeldMoreThanOneBatch`（第 3 项）**唯一可能的触发场景也只有 0-tick 帧**，所以它今天既抓不到真延迟、又可能在 60Hz 抖动下**假红**（一条 dt≈16.6ms 的帧即可）；建议按上面 `ticks>0` 语义重定义，或直接以第 1 项取代。若产品走 `externalLink.activeExecution` 的分帧路径（`World.ts:1884/1894` 两次 `stepSimulationTicks` 共用一次 `applySimEvents`），`receiptTicks === commitBatchTicks` 会因合并结算而偏离，届时保留 `<= 15` 兜底即可——本 spec 未开外链，不受影响。

### 8.4 三处记录/可诊断性问题（不改断言也必须改口径）

1. **`logs/p4-receipt-semantics-diag.log.txt` 是 EXIT=1，不能当绿**：`P4_sha=6a8085f5…`，红在 `:863` `processedTicksUntilCommit` undefined（字段名写错）。它是 `evidence/p4-receipt-diag-20261119-HumanEcho.json` 的来源（字段集无 `commitBatchTicks`/`queueAfterCommit`，与 `aa9ee012` 的 `receiptSemantics` 不同，可据此定源）。该 JSON 只能当“失败轮的观测”，**不能当通过门**；通过门是 `logs/p4-jam-input-3x-final.log.txt`（P4 `aa9ee012`，3 passed 1.1m，`EXIT=0`）那次写出的 `evidence/p4-route-*.json`。
2. **`HASHES-INPUTS.txt` 口径**：该文件把上面这次 EXIT=1 的诊断放在 `## targeted results on these bytes` 段落下（“P4 receipt diagnostics (one run) -> …”），未标 EXIT=1。同一段里另两行（P4 3/3、P2 2/2）确有 `EXIT`；建议把诊断行显式标为 `EXIT=1 (failed probe, observation only)`，避免下游把 1037/1038 当“已验证通过”。
3. **`jamInput` 的等待条件偏松**：`sf.some(jamEvent) && sf.some(ticks>0)` 是两条独立存在性判断，不要求“同一批”。实际证据里 `ticksBeforeEvent=2` 且整窗只有 1 个 `signal-jammed#0`（`jamInput.stepFrames`），加上 `JustDown` 一次性语义，结论不受影响；但若要和 8.3 同口径，可加一句“含该事件的批 `ticks>0` 且该批 `queueBefore` 含 `signal-jam`、整窗 `signal-jammed#0` 计数为 1”。

### 8.5 P2 清房驱动（`diff/gameplay-02-echo-coop.spec.ts.diff`：+109 / −38（删掉的是 4 段固定 sleep 与那次 swallow 等待），逐项）

| 要求 | 实测 | 判定 |
|---|---|---|
| 每个 move/fire 等到真实 tick 推进 | `after-spec/gameplay-02-echo-coop.spec.ts:228-238` `tickAdvance(from,n,1500ms)`；move `:327/:337` 等 2 tick，fire `:346` 等 3 tick；超时只记 `stall` 事件不吞掉最终失败 | **PASS** |
| 120 s 墙钟未改 | `:219` `maxMs = 120000`；`:314` `started`；`:315` `while (Date.now()-started < maxMs)` | **PASS** |
| 遮罩用真实 click，不 `scene.stop` | `:240-266` `clearOverlay`：取当前非 GameScene 激活场景中第一个 `input.enabled !== false && visible !== false` 的对象，按其 `getBounds()` 中心 `clickLogical`（与同文件 `clickLabel` 同一逻辑坐标约定）；全文无 `scene.stop` | **PASS（有限制，见下）** |
| 空世界/最终失败不被吞 | 无敌人时 `KeyD` 短按后 `continue`（`:323-330`）；超时 `:353` `sample('timeout')` + `return cleared:false`，随后用例 `expect(cleared).toBe(true)` 必红；旧的 `.catch(() => undefined)`（等 JAMMED 的那次 6 s 等待）已删除 | **PASS** |
| 无 clear/heal/teleport/源写 | `grep -n "clearEnemies\|setPlayerPositionForTest\|scene.stop\|\.reset("` → 仅注释命中；`p2-echo-coop.json` 证据 `owner human / paused false / levelUpActive false` | **PASS** |
| 断言是否被削弱 | `grep -c "^-.*expect("` = **0**、`grep -c "^+.*expect("` = **0**（P2 diff 纯驱动重写，未增删断言） | **PASS** |
| 定向证据 | `logs/p2-6-7-tick-driven.log.txt` P2 `b26b58d7`、case 6+7、**2 passed 27.7 s EXIT=0**；`evidence/p2-echo-coop.json` 的 `clearPlay`：case6 `cleared true / 7 inputs / 73 ticks / 1201 ms / 0 stalls / 0 overlays`，case7 `cleared true / 8 inputs / 84 ticks / 1368 ms` | **PASS** |

残留（**不阻断本轮**，但要在记录里写明）：

- **死亡/GameOver 仍未判别**：全程不查 `hp<=0`、不查 `GameOverScene`；玩家阵亡后只会空转到 120 s，最终报 `cleared:false`，把“阵亡”误报为“未清”（正是 run5 case7 无法定性的那个盲点）。
- **`clearOverlay` 无场景白名单**：它会点击**任意**非 GameScene 场景里第一个可交互对象，包括 `GameOverScene`/`PauseScene` 的按钮（可能重开或回菜单，把“失败”变成 `notReady` 空转）。两轮证据里 `overlays: 0`，即**这条新路径从未被执行**，其正确性未经任何运行证明；建议限定 `key === 'LevelUpScene'`，其它场景只记一条 `bail` 理由。
- **“伤害进展”只在计数层**：`sample` 里 `enemy.hp` 恒为 `null`（drone 无 `_data.hp`），证据只有 `enemiesAlive 2→1→0` 与玩家 `hp 100→94→88`。说“记录到伤害进展”时不能指敌方血量曲线。
- **219 行是否必要**：约 6 成是 `sample`/trace（正是它让失败可定性）、2 成 readiness 与 `tickAdvance`、2 成 `clearOverlay`。前 8 成值得保留；`clearOverlay` 这 26 行是唯一“既未被执行、又有副作用面（点任意遮罩按钮）”的部分，属可精简/可加白名单的对象。

### 8.6 Gate（本轮只读；每条命令/检查 → 结果 → 绝对路径）

| 检查 | 结果 | 路径/证据 |
|---|---|---|
| `sha256sum after-spec/*` vs `HASHES-INPUTS.txt` | **PASS** | `D:/Project/LAST_SIGNAL/reports/gameplay-01/tester/p4-final/run6-v4-inputs/HASHES-INPUTS.txt` |
| 被测树实际 installed bytes vs after-spec | **PASS**（4/4 相同） | `D:/tmp/ls-p4-v4/tests/` ↔ `…/run6-v4-inputs/after-spec/` |
| `source-snapshot` 10 文件 vs `manifest.v4.json` vs 主仓 `d55e502` | **PASS**（10/10 三方同 sha） | `…/run6-v4-inputs/source-snapshot/src/`、`…/developer/p4-recovery/manifest.v4.json` |
| `grep -c "^-.*expect("` 两个 diff | **PASS**（0 / 0：无断言被删改） | `…/run6-v4-inputs/diff/*.diff` |
| 超时预算前后对照（`test.setTimeout` + 各 `waitForFunction` 上限） | **PASS**（无一项被缩短；新增 5000/4000 两处上界） | `…/after-spec/gameplay-04-coop-level.spec.ts:675,768,775`、`…/before-spec/gameplay-04-coop-level.spec.ts:580` |
| P4 定向（seed 20261119 HumanEcho ×3） | **PASS 3/3 (1.1m) EXIT=0**（采信 Tester 日志，未重跑） | `…/run6-v4-inputs/logs/p4-jam-input-3x-final.log.txt` |
| P2 定向（case 6+7） | **PASS 2/2 (27.7s) EXIT=0**（采信，未重跑） | `…/run6-v4-inputs/logs/p2-6-7-tick-driven.log.txt` |
| P4 回执诊断 | **FAIL EXIT=1**（旧 spec `6a8085f5`，`:863` 字段名错）——**不得作为绿门** | `…/run6-v4-inputs/logs/p4-receipt-semantics-diag.log.txt` |
| 回执批 trace 与代码顺序一致性（批前排干、批末结算） | **PASS**（两次独立运行均满足 `enqueued==批起点`、`applied==批末`、`receiptTicks==批 tick 数`） | `…/evidence/p4-route-20261119-HumanEcho.json`、`…/evidence/p4-receipt-diag-20261119-HumanEcho.json`；`D:/Project/LAST_SIGNAL/src/world/sim/core.ts:518-521,1371,1387`、`src/world/World.ts:797-800,1899,2021-2026,510-516` |
| “首个处理批”是否被断言 | **FAIL（唯一硬阻断）**：`receiptTicks` 仍无界（`>=1`），且无 `firstBatchWithCommit === 确认后第一个 ticks>0 的批` | `…/after-spec/gameplay-04-coop-level.spec.ts:865-873`、`:561-572` |
| `queueHeldMoreThanOneBatch` 语义 | **FAIL（次要/假红风险）**：唯一可触发场景是 0-tick 帧，抓不到真延迟却可能偶发假红 | `…/after-spec/gameplay-04-coop-level.spec.ts:570` |

### 8.7 判定：**下一完整 E2E 暂不开始；先补 8.3 的 3 行断言（+ 8.4-② 记录标注）**

- 结论：两个驱动的方向对、假设可核、**没有任何旧断言或超时被削弱**（P4 新增 5 条 expect、P2 零增删），定向 3/3 与 2/2 均 `EXIT=0`；但 **ECHO 回执契约仍未锁住**：现四项断言在“确认后延迟若干批才入队/才提交”的回归下仍会全绿，故 run6 只能证明“输入被真实 tick 消费、恰好一次提交”，不能证明“首个处理批”。若现在就冻结字节跑 22 分钟全量，其 ECHO 绿仍要打同一个折扣，将来还得再跑一次。
- 必须改（测试侧；产品侧 0 改动，字段均已记录）：8.3 的 `firstBatchWithCommit === firstProcessing(ticks>0 && t0>=enqueuedTick)` + `receiptTicks === commitBatchTicks`（+ 可选 `<=15`）；顺带按 `ticks>0` 重定义或删除 `queueHeldMoreThanOneBatch`。
- 必须改（记录侧）：`HASHES-INPUTS.txt` 把 EXIT=1 诊断行标注为失败探针；`evidence/p4-receipt-diag-*.json` 标注来源 spec `6a8085f5`/失败轮。
- 建议改（不阻断）：`clearOverlay` 限 `LevelUpScene` 并在 `sample` 里记 `hp<=0`/`GameOverScene`（否则全量里一次阵亡会变成 120 s 空转的难诊断红）；`clearRoomByRealPlay` 返回类型由 `any` 收窄。
- 保留口径：run5 的 153/155 与两个失败原样保留，不回填、不补绿；旧失败的“负载”归因**仍只是推断**（无逐输入旧 trace），本轮新增 trace 能支撑的是“新驱动下输入被真实消费”，不是“旧失败已证非产品”。
- 本节点不给 P4/P2/整 GAMEPLAY PASS；P5、人类试玩、B7 负载风险仍独立待办。

---

## 9. run7（P4 `13a83464` / P2 `4bc6288f`）— 最终 diff 静态审查与计数核对：**两个驱动 diff 可提交；整体仍 1 红（legacy 负载）+ B7 默认档风险 + P5/human 未完成**

审查者只读：未重跑 155、未跑 unit/build/mcp-surface、未起 devserver/端口、未改 src/tests、未 commit/push、未与 Tester 争用 CPU。输入 `D:/Project/LAST_SIGNAL/reports/gameplay-01/tester/p4-final/run7-v4-final/`（`HASHES-PRE-RUN.txt`、`before-spec/`、`after-spec/`、`diff/{gameplay-02,gameplay-04,tests}.diff`、`logs/`、`evidence/`、`source-snapshot/`）。§8 的 EXIT=1 探针口径不变：仅 observation，不是绿门。

### 9.1 冻结与字节（实算，前后各一次）

| 检查 | 结果 | 路径 |
|---|---|---|
| `sha256sum after-spec/*.spec.ts` = `HASHES-PRE-RUN.txt` | **PASS 4/4**：P1 `a7db1885…`、P2 `4bc6288f…`、P4 `13a83464…`、probes `22ae61f7…` | `…/run7-v4-final/HASHES-PRE-RUN.txt` |
| 事后：被测树 `/d/tmp/ls-p4-v4/tests/*` 仍等于 after-spec | **PASS 4/4 逐字节**（HEAD `3819621`，branch `p4-v4`）⇒ 前后未漂移，无需再扩证据 | `D:/tmp/ls-p4-v4/tests/` |
| `source-snapshot` 10 文件 vs `manifest.v4.json` vs 主仓 `d55e502` | **PASS 10/10 三方同 sha**（core `f71523e1`、World `349544bf`、worldHeadless `7382d6f0`、p1Scenario `76367087`、relay `6fc7ba40`＋5 测试） | `…/source-snapshot/src/`、`…/developer/p4-recovery/manifest.v4.json`、`D:/Project/LAST_SIGNAL/src/` |
| 失败用例文件是否被本轮改动 | **否**：`tests/ai-native-world.spec.ts` 在工作树无 diff（`git diff --stat` 不列），sha `ef1d2e92…`，主仓同名文件同 sha（HEAD `d55e502`） | `D:/tmp/ls-p4-v4/tests/ai-native-world.spec.ts` |
| 单位套件是否受本轮 tests 改动影响 | **否**：`vitest.config.ts` `include: ['src/**/*.test.ts']`，`tests/*.spec.ts` 不在单位清单 ⇒ 859 条清单与 tests 字节无关 | `D:/Project/LAST_SIGNAL/vitest.config.ts:6` |

### 9.2 P4 diff（`diff/gameplay-04-coop-level.spec.ts.diff`，+30/−5，`:0` 条断言被删）：§8.3 阻断逐条落实

| 我 §8.3 的要求 | run7 实现（`after-spec/gameplay-04-coop-level.spec.ts`） | 判定 |
|---|---|---|
| 首个处理批序号 === 提交批序号 | `:880-886` `firstProcessing = batches.findIndex(b => b.ticks > 0 && b.t0 >= enqueuedRow.tick)`（`:881-882`）；`expect(firstProcessing).toBeGreaterThanOrEqual(0)`（`:883-884`）；`expect(firstBatchWithCommit).toBe(firstProcessing)`（`:885-886`） | **PASS**：不再允许“任意以后才提交”——提交批必须就是确认后第一个真正推进 tick 的批 |
| gap 有界且等于批 tick 数 | `:887-888` `expect(receiptTicks).toBe(commitBatchTicks)`；`:889-890` `commitBatchTicks >= 1`；`:891-893` `commitBatchTicks <= 15`（`SIM_TUNING.MAX_TICKS_PER_FRAME`） | **PASS**：同时锁住“不等于延迟（gap≠batch ticks 即红）”与架构上界 |
| 0-tick 帧不得算作跨批持有 | `:572` 定义加 `b.ticks > 0` 过滤；断言文案改为“never survives a PROCESSING batch (0-tick frames excluded)” | **PASS**（顺带新增 `batchesWithTicks` 记录） |
| Y 一次按键、同批排干、恰好 1 次 jam | `:767-774` 等待条件改为 `jamJams === 1 && sameBatch`（`:768`/`:771-772`/`:773`），其中 `sameBatch` 要求含 `signal-jammed` 的批同时 `ticks>0` 且 `queueBefore` 已含 `signal-jam` | **PASS**：不再是 §8.4-③ 那两条彼此独立的存在性判断 |
| 不重试/不第二次 Y/keyup 必然 | 与 run6 相同：单次 `keyboard.down('KeyY')` `:764`；失败分支记 trace 后 `throw`；`finally` 等一真实帧再 `up` `:782` | **PASS**（保留的瑕疵：finally 内 4000 ms 超时会覆盖原始错误信息，可诊断性） |

**独立数值复算**（不重跑，用归档证据算）：`evidence/p4-receipt-diag-20261119-HumanEcho.json` → `enqueued=1029`、批序列 `1028→1029, 1029→1030`、`commitBatchTicks=1`、`firstBatchWithCommit=1`；我按断言公式算 `firstProcessing = 1`（`ticks>0 && t0>=1029` 的第一项）⇒ 1===1；`applied(1030) − enqueued(1029) = 1 = commitBatchTicks`；`1 ≤ 15`；`queueHeldMoreThanOneBatch=false`；`queueBeforeCommitOrder=['signal-scan']`。四点全部自洽，且与本轮 **PASS 2/2 EXIT=0** 的日志同字节（`logs/p4-echo-firstbatch-2x.log.txt`，`P4_sha=13a83464…`）。

其余契约**全部保留**（`:0` 条断言被删，逐项核）：jam 事件负载精确 25 `:795`；JAMMED 时 portal/routeTarget 为 null `:797-798`；F 不改房 `:805`；到期恢复 `:814-817`；`coreClearEvents===1` `:720`；ECHO 同 pid（`audit` 过滤 `proposalId===id` `:542`）、单 commit `commitCount===1`、事件负载 10 `:902-904`；`modelState` 死字段未复活（仅注释说明不存在，`:1007`、`:1025`）。证据 `evidence/p4-route-20261119-HumanEcho.json`：`audit` 两行同 `kind:'scan'`、`commit{actorId:1,pre:100,energy:90}` ⇒ 成本 10、`netPlayerDelta:0`（玩家未被扣，记为观测）、`cleared.coreClearEvents:1 / mapFlag:true / liveDrones:0`、`jam.commit 100→75 exact 25`、`route{from:0,to:5}`、`spriteToInteractionPx:0`。

seed 17/18 的“真换 room”**只有全量 PASS 支撑**（该目录只归档 seed19 的 JSON）：每个 route 用例内部都断言 `route.changed===true` 且 `after.room.id === routes[0].target`（`:919-920`），6 条 route 用例在全量里全部 PASS ⇒ 三 seed 均发生真实换房；但不宣称“有三份 JSON”。

### 9.3 P2 diff（`diff/gameplay-02-echo-coop.spec.ts.diff`，+45/−11，`:0` 条断言被删）：§8.5 残留逐条落实

| 我 §8.5 的要求 | run7 实现（`after-spec/gameplay-02-echo-coop.spec.ts`） | 判定 |
|---|---|---|
| 遮罩白名单（只扶 LevelUp） | `:250` 非 `LevelUpScene` 直接 `allowed:false`；`:260` 返回 `bail` 且**不点击** | **PASS** |
| 未知/GM 遮罩不得点、必须显 fail | `:351` `return {cleared:false, died:false, blocked:overlay.bail}`；用例随后的 `expect(cleared.cleared).toBe(true)` 必红 | **PASS（按代码路径；本轮未被执行，见 9.7-1）** |
| 死亡必须与“没清房”区分 | `:314` 采样 `gameOver`；`:344-346` `hp<=0 || gameOver` → `died:true` 并停止驱动（不重开、不点菜单、不治疗）；`:628`、`:707` 两个用例在 `cleared` 之前显式 `expect(cleared.died ?? false).toBe(false)` | **PASS** |
| 敌血不再伪造 | `:277-291` 按位置（≤0.75 tile）匹配同一 sim drone 记真实 hp，否则记 `'notCaptured'` + `hpSource` | **PASS**（证据 `24 → 12 → notCaptured`：击杀一只后最近精灵无匹配 drone，明确不伪造） |
| 120 s 墙钟不加时、输入等真实 tick | `:219` `maxMs=120000` 未变；`:332` `started`、`:335` `while (Date.now()-started < maxMs)` 未变；`tickAdvance`（move 2 / fire 3 tick）未变 | **PASS** |
| 无 clear/heal/teleport/源写 | 无 `clearEnemies`/`setPlayerPositionForTest`/`heal`/`scene.stop`；撤回只能真实点击 | **PASS** |

### 9.4 全量计数与唯一红点分类（`logs/full-e2e-155.log.txt`）

- 头部：`P1=a7db1885… P2=4bc6288f… P4=13a83464… probes=22ae61f7… World=349544bf…`，`dev_servers=5199:up 5494:up`，`PORT=5199 npx playwright test --workers=1`，`started 21:27:02Z`。
- 尾部：**`1 failed` / `154 passed (22.6m)` / `exit_code=1`**。唯一红 = `tests/ai-native-world.spec.ts:272:3`（P1 legacy 共享控制链路），断言在 `:553`：`disabled AI does not move the player (x 116.01757253487142 vs 115.32342141231187)`，差 **0.694**。
- 同字节孤立复跑：`logs/diag-ai-native-world-isolated.log.txt` **1 passed (46.6s) EXIT=0**。
- **分类（与本轮 diff 无关，且不作根因结论）**：该 spec 字节未改（9.1），因此不是这轮 P4/P2 测试改动的回归；全量红 + 同字节孤立绿只构成**负载相关性**证据，**不能**据此判“非产品”，也**不能**判“产品缺陷”。有一处可交给 Developer 的具体观测（不作为结论）：该用例自身注释就承认“human 关闭后，resume 时已入队的意图会由核心在下一 tick 提交，属合法”，随后只等 **1500 ms** 就取 `stationaryStart`，再要求 2500 ms 内零位移；若排空窗口在负载下超过 1500 ms，症状会正是这条 0.694 位移。失败轮该用例的 `record('manual-disable')` 位于断言之后，故**没有**写入任何每帧 owner/pending 观测——归因需要 Developer 自己补 trace。
- 本轮 **其他 154 条全绿**，其中 P2 七条（含 case6/7）与 P4 六条 route + 三条 HumanOnly/Echo + headless R1/R2/R2b 均在列表中通过。
- 未在本轮执行：单位套件（859）、`npm run build`、`test:mcp-surface`。它们只能引用**同源字节**的旧结果（`run5-v4-final/logs/unit-bounded-profile.log.txt` 859/859、`run4-v4-final/logs/{build,mcp-surface}.log.txt`），**不得**写成“run7 本轮通过”。

### 9.5 历史计数的正确分类（两套 153 与本次 154，互不回填）

| 全量 | 冻结测试字节 | 计数 | 红点与分类 | 日志 |
|---|---|---|---|---|
| run3（v3） | P4 `17fe4a09`、P2 `fbe7ca78` | **150/155** | 2 条 legacy 门户（v4 前的**真产品回归**）+ 3 条 readiness（隔离复跑转绿） | `…/run3-v3-final/logs/full-e2e.log.txt` |
| run4（v4 首轮） | P4 `839e91fb`、P2 `fbe7ca78` | **153/155** | **2 条均是 P2 case6/7 的 scene-restart 驱动竞态**（`getWorldPoint` of undefined）。原报告曾误记“2 真产品 + 3 readiness”，Tester 与我的勘误均已改正；该轮 legacy 门户在 v4 上是 **PASS** | `…/run4-v4-final/logs/full-e2e.log.txt` |
| run5（v4） | P4 `8ccc3b29`、P2 `53690495`（**仅定向**） | **153/155** | seed19 HumanEcho（`signal-jammed` 为 null）+ P2 case7（120 s 未清）；两条**均未被证明为非产品**（见 §7.5） | `…/run5-v4-final/logs/full-e2e-final.log.txt` |
| **run7（本轮）** | P4 `13a83464`、P2 `4bc6288f` | **154/155** | 唯一红 = `ai-native-world.spec.ts:272`（legacy，字节未改，同字节孤立绿）⇒ 只有负载相关性 | `…/run7-v4-final/logs/full-e2e-155.log.txt` |

byte 边界依旧成立：`150/155 ↔ fbe7ca78`、`run4 153/155 ↔ fbe7ca78`、`run5 153/155 ↔ 8ccc3b29/53690495`、`run7 154/155 ↔ 13a83464/4bc6288f`；`53690495` 的 7/7 定向**不是**全量；`150/155` 与 `818/70` 也不同源。四个 full 记录互不覆盖，不把定向绿补写成 full 绿。

### 9.6 报告与记录口径核对（`…/tester/p4-final/P4_TEST_REPORT.md` §run7）

| 检查 | 结果 | 依据/路径 |
|---|---|---|
| 计数、冻结 sha、gate 表与日志是否一致 | **PASS**：154/155、`exit 1`、P4 2/2、P2 2/2、typecheck 0、parity 3/3、孤立 1/1 全部对得上 | `…/run7-v4-final/logs/*` |
| 是否把唯一红说成“非产品/已证负载” | **PASS（口径正确）**：只写“只有负载相关性证据，不推断产品缺陷，也不据此改字节或放宽阈值” | 报告 §失败用例段 |
| §8 的 EXIT=1 探针是否被正确隔离 | **PASS**：`run6-v4-inputs/ERRATA.md` 为**新增 sidecar**，原 `HASHES-INPUTS.txt` 未被改写；ERRATA 明确“not part of the green gate”，1037/1038 只作 observation | `…/run6-v4-inputs/ERRATA.md` |
| 是否用 run7 的证据替代 run6 | **PASS**：run7 用的是新字节自有证据；run6 `aa9ee012` 只在 `p4-jam-input-3x-final.log.txt` 下作为历史保留 | 同目录 |
| 单位套件 / build / surface 是否被冒充为本轮 | **PASS（已按同源引用处理）**：run7 全链未跑这三项；报告把 859 归到 `run5` 有界 profile、build/surface 归到 `run4`，并写明默认并发 857/859 保持原样 | `…/run5-v4-final/logs/unit-bounded-profile.log.txt`（`--maxWorkers=2 --minWorkers=1`，73 files / 859 passed）、`…/run4-v4-final/logs/{build,mcp-surface}.log.txt` |
| fresh parity 的“新鲜度” | **PASS，但报告需注明时区**：日志用 UTC（`Z`），文件时间戳是本地 **UTC+1**。导出 `22:42 local = 21:42Z`，由**本次全量**中的 `tests/signal-rendered-parity.spec.ts`（全量第 111 条，`full-e2e-155.log.txt:210`）写出；parity 跑于 `21:56:46Z–21:57:04Z`，故“先导出、后复放”成立 | `…/run7-v4-final/logs/parity-final.log.txt`、`/d/tmp/ls-p4-v4/reports/ai-native-02/signal/parity/*.json`（mtime 22:42 local） |
| `HASHES-PRE-RUN.txt` 的“运行后不变”是否有独立文件 | **部分**：只有运行前一份（mtime `22:26:53 local = 21:26:53Z`，正好在定向 gates 之后、全链 21:27:02Z 之前）；“archived_identical=True”是声明。我补做的现盘复核给出 4/4 相同（9.1），但那是**审查时点**的事后核对，不是运行时刻的自动记录 | `…/run7-v4-final/HASHES-PRE-RUN.txt` |
| 归档 evidence 来自哪一次 | **定向轮**（mtime `21:26:53Z`，早于全链 21:27:02Z）⇒ 证据对应 `P4 2/2 EXIT=0`、`P2 2/2 EXIT=0` 两个绿门；全量轮的 P4 通过只有日志支撑（全量日志中 6 条 route 与 P2 七条均无失败） | `…/run7-v4-final/evidence/` |

### 9.7 残留与建议（不阻断提交，但必须留在记录里）

1. **P2 的死亡/bail 分支本轮未被实际执行**：两次证据 `overlays: []`、无死亡样本，所以“死亡/未知遮罩会显 fail”目前**只在代码路径上成立**（`:344-351` → 返回值 → `:628/:707` 的 `died===false` 与后续 `cleared===true` 必红）。建议后续用一个**负向 fixture**（强制 GameOverScene 或非 LevelUp 遮罩）实测一次，或明确记为“未执行路径”。
2. **敌血曲线仍不完整**：击杀一只后最近精灵匹配不到 sim drone，记 `notCaptured`（诚实标注，不伪造）。若后续要“伤害进展”证据，需要按 id 而非位置匹配。
3. **`queueHeldMoreThanOneBatch` 现已近乎同义反复**：加 `ticks>0` 后，真实产品不可能“在处理批里滞留队列”，故该断言结构性恒真；真正的锁是 9.2 的批序号恒等 + gap 恒等。保留可作可读性，但不应再计为独立证据。
4. **B7 默认档风险未关**：默认并发仍 `857/859`（`runtime.test.ts` 两条壁钟超时，字节与基线相同、预算未放宽），有界档 `859/859` 属另一 profile；两者不能互相冒充。
5. **整体仍非 PASS**：P5 变体未实现（plan-only）、`HUMAN ACCEPTANCE: PENDING`、无模型连接（`OFF` 只是无连接样本，不是断线测试）、无平衡结论。
6. **唯一红等待 Developer 诊断**：我不重跑、不替他归因；`ai-native-world.spec.ts:553` 的 0.694 位移在“同字节孤立绿 + 全量红”下只能记录为负载相关性，且失败轮缺少每帧 owner/pending trace（`record('manual-disable')` 在断言之后）。

### 9.8 Gate 汇总（本轮只读；命令/检查 → 结果 → 绝对路径）

| 检查 | 结果 | 路径 |
|---|---|---|
| `sha256sum after-spec/*` vs `HASHES-PRE-RUN.txt` | **PASS 4/4** | `D:/Project/LAST_SIGNAL/reports/gameplay-01/tester/p4-final/run7-v4-final/HASHES-PRE-RUN.txt` |
| 现盘被测字节 vs after-spec | **PASS 4/4** | `D:/tmp/ls-p4-v4/tests/` |
| `source-snapshot` vs `manifest.v4` vs 主仓 d55e502 | **PASS 10/10** | `…/run7-v4-final/source-snapshot/src/`、`…/developer/p4-recovery/manifest.v4.json` |
| `grep -c '^-.*expect('` 两个 diff | **PASS 0/0**（无断言被删改；P4 新增 4 条、P2 新增 2 条） | `…/run7-v4-final/diff/gameplay-0{2,4}-*.diff` |
| P4 “首个处理批”恒等 + gap 恒等 + `<=15` | **PASS**（代码 `:880-893`；数值复算 1===1、gap 1===1） | `…/after-spec/gameplay-04-coop-level.spec.ts:880-893`、`…/evidence/p4-receipt-diag-20261119-HumanEcho.json` |
| P4 定向 2/2 | **PASS 46.7s EXIT=0**（采信日志，未重跑） | `…/logs/p4-echo-firstbatch-2x.log.txt` |
| P2 遮罩白名单 / 死亡 fail / 120 s 不变 | **PASS（代码）**；分支未被执行（见 9.7-1） | `…/after-spec/gameplay-02-echo-coop.spec.ts:243-264,314,344-351,628,707` |
| P2 定向 2/2 | **PASS 28.5s EXIT=0**（采信，未重跑） | `…/logs/p2-6-7-targeted.log.txt` |
| typecheck（未过滤） | **PASS exit 0**（采信） | `…/logs/typecheck.log.txt` |
| 全量 155 | **FAIL 154/155 exit 1**（唯一红 = legacy `ai-native-world:272`） | `…/logs/full-e2e-155.log.txt` |
| 该红点孤立复跑 | **PASS 1/1 46.6s**（仅作负载相关，不作根因） | `…/logs/diag-ai-native-world-isolated.log.txt` |
| fresh parity（全量之后，导出由本次全量生成） | **PASS 3/3 exit 0** | `…/logs/parity-final.log.txt` |

### 9.9 判定

- **两个驱动的 diff 可以提交**（测试侧）：§8.3 的四处（首处理批恒等、gap===批 tick 数、`<=15`、0-tick 不算跨批）+ §8.4-③ 的同批排干收紧全部落实，`0` 条旧断言被删或放宽；P2 的白名单/死亡诊断/真实 tick 驱动落实，120 s 与零状态写入保持。EXIT=1 的旧探针已用 sidecar 明确隔离，未被当作绿门，也未被 run7 覆盖。
- **整体仍不是 PASS**：full 154/155（1 条 legacy 负载红，等待 Developer 诊断；我不重跑、不归因）、B7 默认档 857/859 风险未关、P5 未实现、人类验收 PENDING、无模型连接与平衡结论。
- 结论只针对 run7 冻结字节 `P4 13a83464 / P2 4bc6288f`；run3 150/155、run4 与 run5 两套 153/155 均原样保留，不互相回填。
