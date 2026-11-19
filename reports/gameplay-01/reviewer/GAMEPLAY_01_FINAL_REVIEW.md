# GAMEPLAY-01 · 最终独立复核（静态材料 + run11 整链核数）

复核者：reviewer（独立只读）。日期：2026-11-19。
输入：`D:/Project/LAST_SIGNAL/reports/gameplay-01/tester/p4-final/run11-final-155/`（`HASHES-PRE-RUN.txt`、`spec-snapshot/`、`source-snapshot/`、`logs/`、`evidence/`）；主仓 `D:/Project/LAST_SIGNAL`（HEAD `2b67106`，产品源 = v4）。
范围：**不重跑 859/155**，只核真实日志/时间/文件 hash 并独立复算证据数字；产品源只读；未 commit/push。

> 这份文件是**复核者的当前结论**，不是 Lead 的 FINAL 报告。Lead 定稿后我按 §9 的清单再核。

---

## 0. 结论（一句话 + 三条限定）

**P0–P4 的工程交付在冻结字节上"逐阶段 PASS"，整链一次性全绿（unit 859/859 default、typecheck 0、surface 1/1、build 0、full 155/155、fresh parity 3/3）；仍不判"整工程 PASS"。**

三条限定（缺一不可）：

1. **人类验收 PENDING** —— 无真人试玩，所有点击/确认都是 `autoOwner` fixture 或 agent 驱动；没有"人能否理解 ECHO/路线"的证据。
2. **P5 的平衡评价与最终回归已完成，但没有调参结论** —— `docs/gameplay/GAMEPLAY_01_BALANCE.md`（sha `0813c94e…`）记录了 3 seed × 2 mode 渲染 6 组 + Headless 12 组的指标，并以"样本太小、无人类证据"为由**决定不改数值**；这只是"不调参的决定"，不是"已平衡"。**新敌人/资源 preset 属自提提案（`P5_VARIANTS_PLAN.md`）未实现，它不是原书的验收项**（见 §6）。
3. **B7 默认并发只"本次绿"，历史未消除** —— 本次 default profile 在**无 Vite 监听、CPU 28%** 下 859/859；此前同字节在双 Vite 负载下 857/859（两条壁钟超时）。负载相关性仍在，不能说"稳定性问题已根除"。

---

## 0b. 勘误（2026-11-19 二次复核，直接读主仓当前文件后修正）

| 我此前写错/过时 | 现在的事实（我自己核过，不引用他人口述） | 处理 |
|---|---|---|
| "最终测试字节不在主仓（audit `fe43dc48`、aiw `ef1d2e92`）" | 主仓 HEAD **`a487b98`** 已集成：`sha256sum tests/audit.spec.ts` = `6ea30e8b…`、`tests/ai-native-world.spec.ts` = `855eb948…`；`integration-run11/spec-hashes.log.txt` 8/8 PASS；`src/` 相对 `d55e502` 零改动 | **撤回旧说法**（§5-⑧ 已改写为"已闭合"） |
| "渲染换房只证到 seed 20261117；3 seed 只在 Headless" | 主仓 `tester/p4-final/run4-v4-final/evidence/` 有 **6 份** `p4-route-{20261117,18,19}-{HumanOnly,HumanEcho}.json`；我逐份读：`cleared=true`、`coreClearEvents=1`、房间真实切换 **0→1 / 0→1 / 0→2 / 0→2 / 0→5 / 0→5**、`distanceAtPress 0.47–0.89`、HumanEcho `confirmTick→receiptTick` 各 +1、`actualCost=10`、jam `100→75` | **撤回旧说法**（§3-P1/§4 已改写） |
| "P5 未实现" | P5 原文要求的是**平衡记录/最终回归/模型与真人口径**：`docs/gameplay/GAMEPLAY_01_BALANCE.md`（`0813c94e…`）与 `HUMAN_PLAYTEST.md`（`a9fd8a78…`）均已交付，前者含 6 组渲染 + 12 组 Headless 指标与"不调参"的证据理由；**未实现的是自家提案的三个新 preset**，不是原书缺项 | **改写 §0-2/§6**："P5 无调参结论、无长期平衡结论"，而非"P5 全未实现" |
| （新增）v4 真实模型 smoke | 我本单**已实际跑通**：`git archive d55e502` 快照 + 自有 `dist-mcp`，Own 模型 2 次请求（≤6）、1024 tokens、51.4s；产物 `reviewer/real-model-v4/{trace.json,PROVENANCE.md,run-console-transcript.md,echo-1..5.png}` | FINAL 的"最终 v4 额外复核如有交付另列"可据此补一行（见 §A） |

> 仍然成立的旧边界：`P4_TEST_AND_FINAL_LIMITS.md` §2 的"渲染只证 1 seed"是**该文档的过时表述**（它写于 v1），已 BALANCE/6 组 JSON 取代；该文档我没有改（只读）。

**另一处需要 Lead 处理的事实（不是我改文档）**：`a487b98` 里**没有**下列交付文档——它们只存在于工作区（`git ls-files` 报 untracked）：
`reports/gameplay-01/FINAL_REPORT.md`、`docs/gameplay/GAMEPLAY_01_BALANCE.md`（`0813c94e…`）、`docs/gameplay/HUMAN_PLAYTEST.md`（`a9fd8a78…`）、`docs/gameplay/P4_LEVEL_PLAN.md`。
已跟踪的只有 `reports/gameplay-01/TEST_REPORT.md` 与 `reports/gameplay-01/tester/BASELINE_REPORT.md`。
⇒ 如果"交付 = 提交"，这 4 份（含 FINAL 本身）需要 Lead 另行 `git add`；若"交付 = 工作区"，请在 FINAL 里写明"文档未入库"。这是**文档入库范围**问题，不影响工程 PASS 结论。

## 1. 冻结与整链核数（我实算/实读，1 条命令 → 结果 → 绝对路径）

### 1.1 字节（三方一致）

| 项 | 值 | 我的核对 |
|---|---|---|
| `tests/audit.spec.ts` | `6ea30e8b…d6dcea` | `spec-snapshot` = `/d/tmp/ls-p4-v4/tests/` = run10 归档，三处一致 |
| `tests/ai-native-world.spec.ts` | `855eb948…f9538b` | 同上三处一致 |
| `tests/gameplay-01/02/03/04(-headless)` | `a7db1885…` / `4bc6288f…` / `d446a768…` / `13a83464…` / `22ae61f7…` | 同上；`tests/uiNav.ts 1cc431ab…` |
| 产品 10 源 | `core f71523e1`、`World 349544bf`、`worldHeadless 7382d6f0`、`p1Scenario 76367087`、`relay 6fc7ba40` + 5 测试文件 | `source-snapshot` 10/10 = 主仓 = `manifest.v4.json`；`git diff --stat d55e502..2b67106 -- src/` 为空 ⇒ 产品 v4 未变 |
| 主仓测试树（HEAD `a487b98`） | `audit 6ea30e8b…`、`ai-native 855eb948…`（我实算），与 `run11/spec-snapshot/`、`/d/tmp/ls-p4-v4/tests/` 三处一致；`integration-run11/spec-hashes.log.txt` 8/8 PASS | **已集成**（仓库态 = 验证态） |

### 1.2 整链（顺序与时间自洽，全程无重叠）

| # | 命令 | 结果 | 绝对日志 |
|---|---|---|---|
| 1 | `npm test`（**default 并发**，20s/15s 原始预算） | **PASS 73 files / 859 tests, exit 0**, 213.5s；头部 `listeners_5199_5494=0 host_cpu_load_pct=28` | `…/run11-final-155/logs/1-unit-default.log.txt` |
| 2 | `npx tsc --noEmit`（未过滤；`tsconfig` 不含 `tests/`） | **PASS exit 0**（23:18:41→23:18:53Z） | `…/logs/2-typecheck.log.txt` |
| 3a | `npm run test:mcp-surface` | **PASS 1/1 exit 0**（含 `game:mcp:build`） | `…/logs/3a-mcp-surface.log.txt` |
| 3b | `npm run build` | **PASS exit 0**（10.5s） | `…/logs/3b-build.log.txt` |
| 4 | `PORT=5199 npx playwright test --workers=1 --reporter=line`（dual Vite 5199+5494，Vite 于 23:19:27Z 起，run 23:19:29Z 起） | **PASS 155/155, exit 0**, 23.5m；`skipped|did not run|✘` 计数 **0**；`155 passed (23.5m)` | `…/logs/4-full-playwright.log.txt` |
| 5 | `npm run test:parity`（**跑后**重放） | **PASS 3/3 exit 0**；parity 导出 `initial/rendered/sequence.json` 的 mtime = `00:36:07 local = 23:36:07Z`（落在 full run 内，由全量第 111 条 `signal-rendered-parity.spec.ts` 写出），parity 于 23:48:12Z 消费 | `…/logs/5-parity.log.txt` |

时间线无交叠：unit/typecheck/surface/build 全部在 **Vite 起来之前**完成（`vite-5199.log` mtime `00:19:27 local`），这是 B7 本次能绿的关键前提（§5-①）。

---

## 2. 我独立复算的两处 full-run 运行时证据（不照抄 Tester/Lead 的数字）

### 2.1 Boss volley：**full run 真的走了 16→15 的"红路径"并正确归因**

`evidence/boss-volley-events-FULL-RUN.json`（我逐字段复算）：

| 项 | 值 |
|---|---|
| `bossId` / `spawnedTotal` | **4** / **16** |
| `volley` | **15**，owner 全 4，id `[4..18]`，速度直方图 **3×2.5 + 12×1.875**（我用 `hypot(vel)` 复算，与 `speed` 字段一致到 1e-9） |
| `others` | **1**：`{id 3, ownerId 1, kind plasma, source enemy, pos (22.56,44.32), vel (2.17,1.24)}` |
| `pendingBefore` | `["spawn-enemy-projectile"]` ← 旧弹确实在测量前挂在队列里 |
| `preExisting` | core/adapter 都是 **0**（`resetProjectilesForTest()` 双清） |
| `adapterMissing` / `bullets.length` | **0** / **15**，15 发全 `visible`、全在 1280×720 内 |
| 全部 id | `[3..18]` **互不重复**（volley+others 分区无缝） |

⇒ run9 那次"16 vs 15"的形状在 full run 里**真实重现**，而 run10 的归因断言让它在**不吞掉第 16 发**的前提下通过。这是本次整链里信息量最高的一条证据。

### 2.2 AI-disable 窗口：**89 帧 / 153 tick / 3 个真实受击帧**（你写的"4?"是 3）

`evidence/manual-disable-step-trace.json`（`windowStart=1, windowEnd=90`）：

| 项 | 值 |
|---|---|
| 帧数 / 总 tick / 有 tick 的帧 | **89 / 153 / 89**（每帧 1–3 tick，2 tick 占 50 帧 ⇒ 双 Vite 负载下） |
| owner / aiEnabled / lastIntentOwner | 全 `human` / 全 `false` / 全 `human` |
| `intent.move` / fire / interact / **dash** | 全 `(0,0)` / 全 `false` / 全 `false` / 全 `false` |
| 按键 | **0 帧**有任一移动键 |
| `pending` 类型 | 仅 `spawn-enemy-projectile`（legacy 敌人合法开火），**无 `teleport-player`** |
| `aiActionCount` / `takeoverCount` | 恒 **25** / 恒 **1** |
| overlay | 无（`quiet=true`） |
| **`player-hurt` 帧** | **3**（seq 29 / 39 / 53），全部非 blocked；其余 86 帧由 `player-moved` 解释 |
| 位置解释 | **89/89** 帧末位置 = 该帧最后一个真实 writer（或帧首，若 0 writer），我复核残差全 0 |
| wrapper | `installed true` / **`restored true`** |

另：`855eb948` 相对我 run8 批过的 `c33f16c7` 的差量我**本轮亲自核了**（见 §3-P4），是四处收紧，没有放宽。

---

## 3. P0–P4 逐阶段证据链（claim → 证据类别 → 来源 → 复核状态）

证据类别一律标：**fixture**（测试夹具/autoOwner/脚本）/ **agent**（自动化读写 canonical state 驱动）/ **human**（真人）。

| 阶段 | 可下的结论 | 证据（类别/来源） | 我的复核 |
|---|---|---|---|
| **P0** 基线/CI | 单一 CI 命令链、无 secret、纯净安装可跑 | 工程改动 + `npm ci` 日志（`developer/p4-recovery/npm-ci.log.txt`）；`reports/gameplay-01/reviewer/CI_GATE_REQUIREMENTS.md` / `CI_PATCH_REVIEW.md` | PASS（当时逐 hunk 审过） |
| **P1** 场景/路线/门户 | 3 个 seed 都生成可玩变体；门位自然 jam 精确扣 25；JAMMED 关闭路线、F 不改房、到期恢复 | fixture+agent：`tests/gameplay-01.spec.ts:807`（3 seed 正向）、`:343-470`（ACTIVE→JAMMED→expiry、扣费、路线选择）；渲染"真换房"见 P4 行（6/6） | PASS（`P1_A_REVIEW`/`P1_FINAL_REVIEW`/`P1_TEST_REVIEW`） |
| **P2** ECHO 本地协作 | 暂停确认只入队、下一 tick 真实结算、单飞（重复确认失败）、成本取事件负载 10、存档不含未提交命令、restore 三入口单 pending | fixture+agent：`tests/gameplay-02-echo-coop.spec.ts` 7 条；单测 `echoCoop/worldHeadlessEchoCoop/SaveSystem.echoCoop` | PASS（`P2_*` 5 份 + `P4_TEST_REVIEW` §2） |
| **P3** 反馈/可读性 | 5 视口字号 ≥10 CSS px、无遮挡、审计细节折叠、本地页不冒充联网/不伪造 OFFLINE | fixture+agent：`tests/gameplay-03-feedback.spec.ts`（`d446a768`）7 条；HUD 真实 CSS 由 reviewer 探针复算 10.0–10.6 | PASS（`P3_REVIEW`/`P3_V2_REVIEW`/`P3_TEST_REVIEW`；**run32 未由我独立重跑**，见 §5-⑥） |
| **P4** 协作关卡 | 作者路线由 core 单点提交房间清除；门户在格中心、JAMMED 关闭、到期恢复；R1/R2/R2.5 restore 守卫；坏帧拒绝；失败布局零变更 | fixture+agent：`tests/gameplay-04-coop-level.spec.ts`（6 条 route + 3 条）+ `-headless-restore` 7 条；单测 `p1ScenarioLayout/relayRoutes/worldHeadlessDemoRoute/FrameAuthored/RestoreSafety` | PASS（`P4_PRE/V1–V4/TEST_REVIEW` + run8/run9/run10 增量） |
| **P4 最终测试字节** | audit `6ea30e8b` 按 owner 归属 15、others 全记录；ai-native-world `855eb948` 事件级窗口 | 见 §2 | **PASS（本轮新增）** |

P4 的最后两处增量（run10/run11）我本轮补的两句：
- `6ea30e8b`：volley 按 `projectile.ownerId===bossId` 归属、恰好 15、速度直方图 3+12、按 id 取 adapter（`adapterMissing 0`）、0.5 s 只跟同 id、全 payload 断言前落盘。full run 里 others=1 真实触发。
- `855eb948`（相对 `c33f16c7`）：+`intentPresent/movePresent`（缺失 intent 不再记成 neutral）、+`dash===false`、`aiActionCount/takeoverCount` 与 `state()` 采样值交叉相等、位置精度改回 `toBeCloseTo(…,6)`（原 `<=1e-6` 略松）。**净收紧，未删任何断言**（唯一被替换的 `unexplained` 一条被更严格的逐帧 `toBeCloseTo` 取代）。

---

## 4. 原书要求的覆盖 —— 实际来源（不虚构）

| 原书维度 | 实际覆盖 | 真实来源 | 不得声称 |
|---|---|---|---|
| **多种子** | 3 seed（20261117/18/19）在 P1 布局、**P4 渲染路线 ×2 模式（6/6 真换房）**、headless restore ×3 | `tests/gameplay-01.spec.ts:807-812`、`tests/gameplay-04-coop-level.spec.ts:36`、`tests/gameplay-04-headless-restore.spec.ts:26`；**渲染 6 组 JSON（主仓）**：`reports/gameplay-01/tester/p4-final/run4-v4-final/evidence/p4-route-{20261117,18,19}-{HumanOnly,HumanEcho}.json`；单测 `src/signal/relayRoutes.test.ts:84,168`（3+5 seed） | 不能说"所有 seed 在渲染里都走完两条路线"——6 组渲染都走 **路线 A**；路线 B 只有 P1 手动 OFF 用例 + 3 次 Headless。`P4_TEST_AND_FINAL_LIMITS.md` §2 的"渲染只证 1 seed"是**旧文**，已被 BALANCE 与 6 组 JSON 取代 |
| **设备（relay）位置** | 每 seed 由 `buildP1Scenario` 在可行走格上放置，且 device↔player ≥1.5、sentry 间 ≥2、双 portal 分离 ≥1.5 | `src/config/p1Scenario.ts:17-21,86,111,120,142,197`；`relayRoutes.test.ts` | 不能声称"每个 seed 有不同设备类型"——只有一种 relay 设备 |
| **敌位** | 每 seed 2 个既有 `drone`，位置由布局避让规则挑选（`drones: Array<{x,y}>`） | `src/config/p1Scenario.ts:46,111-120` | 不能声称"新敌人种类/新遭遇"——`COOP_LEVEL_DESIGN*.md` §82 自己标 `NOT DONE (P5)` |
| **资源变体** | **没有作者化变体**：资源数量/位置是程序化生成（`roomResourceCount` + `gx+2+(i+1)*2`），kinds 由房间类型/核心 loot 决定 | `src/world/World.ts:1258-1268`、`src/world/sim/core.ts:697-699` | 不能声称"路线各有不同资源预设"；任何"资源变体"若只出现在**单测夹具**（如 supply 购买用例的 `spawn-loot` fixture），必须标 unit fixture，不得写成玩家可见新预设 |
| **离线路径** | (a) 本地协作页 `LOCAL ECHO · OFFLINE` 是真实本地模式、**不**冒充联网；(b) 无模型时 LLM 页 `FALLBACK:NO_MODEL` 诚实渲染（真值来自 `companionStatus`）；(c) P4 `connectionSample` 只是"未连接样本"；(d) 真实 `disconnect` 降级只在 **87a0fac 的 ECHO 实验**里验过 | `tests/gameplay-03-feedback.spec.ts:736-769`、`P3_V2_REVIEW`（`PauseScene.ts:875` 唯一 `FALLBACK:NO_MODEL` 分支）、`tests/gameplay-04-coop-level.spec.ts:959-960`、`reports/…/reviewer/real-model-echo/REAL_MODEL_ECHO_REPORT.md`（87a0fac，**不是 v4**） | 不能说"HumanOnly = 断线测试"，也不能说"v4 上验证过断线"（见 §7-⑨） |

---

## 5. 已知问题：逐条分类（阻断 / 非阻断）

| # | 项 | 现状 | 分类 |
|---|---|---|---|
| ① | **B7 默认并发历史 857/859** | 本次 default 859/859（无 Vite、CPU 28%）；历史同字节在双 Vite 负载下两条壁钟超时；`runtime.test.ts` 字节与基线相同、20s/15s 预算未放宽 | **非阻断（残留风险）**：不能说"已根除"，只能说"本次在低负载下绿"；有界 profile（`--maxWorkers=2 --minWorkers=1`，run5）与 default 是**两个** profile，不能互相冒充 |
| ② | **R3 跨版本 `authored` 身份** | 同版本内 `sim.authored` 与 `World.p1Scenario` 一致；跨版本旧存档的 authored 表不与新 builder 对齐，本轮范围外 | **非阻断（文档化限制）**：`docs/gameplay/P4_RESTORE_CONTRACT.V3.md` §4 |
| ③ | **门户 fallback 保留** | `findWalkableCentreInRoom` 的回退分支仍在（无 fallback 会软锁）；60 房间/10 seed 探针中 0 例触发 | **非阻断**："未触发 ≠ 所有房间可解"；**不要**为消灭 fallback 改成返回 null |
| ④ | **代次/审计"代次差"** | restore 保留目标世界的旧 audit 行、`echoRoomGeneration` 在 restore/工厂两路不一致（7 vs 0）；N1/N2 LOW | **非阻断**：只在"恢复后读旧审计行/跨版本代数比较"时有语义差，不影响已断言契约 |
| ⑤ | **早期记录丢失（保留不掩盖）** | P2 早期 spec `efef833c` 字节不可复现（未跟踪文件被改）、P3 run29/run31 被 run32 取代、run4 的 153/155 归因勘误、run6 EXIT=1 探针（有 `ERRATA.md`）、run8 attempt1（`934bf2d7`）、run9 boss drift 包 | **非阻断（已如实标注）**：FINAL 报告引用时**必须**用最终字节，不能拿定向绿回填历史全量 |
| ⑥ | **P3 run32 未经 Reviewer 独立重跑** | 我独立复现的是 run31 `3544ee6e`；run31→run32 的差量由 Lead 核；run32 自身 7/7 只在 Tester 日志 | **非阻断（口径）**：报告里不能写"run32 被 Reviewer 独立复跑" |
| ⑦ | **两处文档/记录级瑕疵** | P2 spec `53690495` 只用于 7/7 定向（不是 full）；run7 的 153 与 run9 的 154 分别是不同字节 | **非阻断**：已在编号表里分区保留 |
| ⑧ | ~~最终测试字节不在主仓~~ **（本条已撤回，2026-11-19 复核更正）** | 主仓 HEAD **`a487b98`** 已集成 run11 的全部测试：我实算 `tests/audit.spec.ts` = `6ea30e8b…`、`tests/ai-native-world.spec.ts` = `855eb948…`（8/8 与 run11 一致），`git diff d55e502..a487b98 -- src/` 为空，`integration-run11/spec-hashes.log.txt` 8/8 PASS | **已闭合**：仓库态 = 验证态（测试 8 份、产品源 10 份）。此前的"仍为 fe43dc48/ef1d2e92"是**过时事实，作废** |
| ⑨ | **v4 上的真实断线未验** | 真实 ECHO 链（observe→model→suggest→Owner fixture→disconnect→fallback）证据在 **87a0fac**（`REAL_MODEL_ECHO_REPORT.md`）；v4 只有本地/无连接样本 | **非阻断（范围）**：不得把 87a0fac 的链当成 v4 的结论（本轮尽量补一次 v4 smoke，见 §8） |
| ⑩ | **`World.updateRoom` 重复清除块（既存）** | `World.ts:1187-1205` 在 P4 前就存在；作者房间因 core 先提交而不会走到 | **非阻断（既存缺陷）**：非作者房间若接 `onRoomCleared` 指标会双计 |
| ⑪ | **`tests/` 不在 tsconfig** | `tsconfig.json` `include` 只有 `src/scripts/vitest.config/playwright.config` | **非阻断（口径）**：`typecheck 0` 不能当测试文件的类型证据；spec 只经 Playwright 的 esbuild 转译 |

---

## 6. P5 / 平衡 / 人类验收 —— 范围裁定（已按原文更正）

- **P5 原文要的是"平衡记录 + 最终回归 + 模型/真人口径"，这三项的真实状态：**
  - **最终回归**：完成（run11 的 155/155 + 859/859 + parity，见 §1）。
  - **平衡记录**：`docs/gameplay/GAMEPLAY_01_BALANCE.md`（sha `0813c94e…`，9.9 KB）已完成——6 组渲染（3 seed × HumanOnly/HumanEcho，取自 `run4-v4-final/evidence/` 的 6 份 JSON：真实换房 0→1/0→2/0→5、`coreClearEvents=1`、HumanEcho scan 成本 10、jam 100→75）+ 12 组 Headless 指标；**damage 缺失记 N/A 不填 0**；ECHO 未被证明更优；并给出**不调数值**的四条证据理由。
  - **模型/真人口径**：模型侧见 §A（本单 v4 smoke）；真人侧 `docs/gameplay/HUMAN_PLAYTEST.md`（sha `a9fd8a78…`）只是**脚本 + 空结果表**，`HUMAN ACCEPTANCE: PENDING`。
- **没有的东西，必须按"没有"写，而不是写成"任务未完成"：**
  - 无**调参结论**、无**长期难度曲线**、无**人类体验/理解度**、无**跨人类玩家的平衡比较**；样本是每格 n=1。
  - **新敌人/资源 preset 只是 `P5_VARIANTS_PLAN.md` 的自提提案**（三个"既有机制的状态预设"），未实现、未上线；**它不是 GAMEPLAY-01 的验收条款**，不得据此宣称"P5 全部未实现"，也不得把"实现它"追加成新的验收目标。
- **资源/敌位/离线**：资源数量与位置是**程序化生成**（`World.ts:1258-1268`、`core.ts:697-699`），不存在作者化的"资源预设"；低能量/资源边界只在单测/夹具层被观测。任何"资源变体"表述都不得写成玩家可见的新玩法内容。
- **人类验收**：所有确认/拒绝都是 `autoOwner` fixture 或 agent 驱动；`HUMAN ACCEPTANCE: PENDING` 必须与工程门禁分开陈述（工程门禁不因缺人类样本而变红，但也不能因此宣称体验成熟）。

## 7. 最终报告里"不得写"的措辞（在既有 `P4_TEST_AND_FINAL_LIMITS.md` §2 之上追加）

1. 「整工程 PASS / GAMEPLAY-01 验收通过」→ 只能写"逐阶段工程 PASS，人类验收 PENDING"。
2. 「3 seed 都在渲染里走完了两条路线」→ 6 组渲染（3 seed × 2 mode）都走**路线 A**；路线 B 只由 P1 手动 OFF 用例 + 3 次 Headless 覆盖（渲染换房本身 6/6 已证）。Headless `completed` 仍只是投影。
3. 「Headless completed = 换房」→ 它是投影（cleared + routeTarget + 站在 portal 半径内）。
4. 「0 伤害说明平衡/安全」→ 是脚本产物，不是平衡。
5. 「HumanOnly 就是断线测试」→ 只是"未建立连接"。
6. 「v4 上验证了真实模型断线降级」→ 只在 87a0fac 验过（除非 §8 的 smoke 成立）。
7. 「ECHO 花 ~128 tick」→ 那是脚本 125 tick 的等待；真实差异用 `ticksExcludingScriptedHold`。
8. 「Owner 同意了建议」→ 是 fixture 点击。
9. 「P5 变体已实现 / 有资源、敌人预设」→ P5 plan-only；资源是程序化生成，不是预设。
10. 「859/155 在仓库当前状态可复现」→ 最终测试字节尚未落到主仓（§5-⑧）。

---

## 8. bounded real-ECHO v4 smoke（本单第二项任务）—— **已执行并 PASS**

详见 §A / §A.0。约束：≤6 请求（实际 **2**）、`max_tokens 1024`、**51.4 s**（≤5 min）、无重试追绿、无 secret、`autoOwner` fixture ≠ 真人。
真实 provenance 以 **`reviewer/real-model-v4/PROVENANCE.md`**（sidecar）为准：`trace.json` 内的 `snapshot` 字段是 harness 旧字面量 `87a0fac`，**不可引用、未改动原 trace**。

### §A.0 给 Lead 可直接引用的路径与哈希

- 目录：`D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/real-model-v4/`
- `trace.json` sha256 `42426bca84e581a85dfc4b17a74087dff4b3b39182c9d659ceec0d493881d88b`
- `PROVENANCE.md`（真实 provenance：`git archive d55e502`、`World 349544bf…`/`core f71523e1…` 跑前跑后一致、`dist-mcp a593a40e…`、端口 5487、命令、预算）
- `run-console-transcript.md`（控制台转写，明确标注"非原始日志文件"）
- `echo-1..5-*.png`（5 张，仅暂停/LLM 页面）

## 9. 我已替 Lead 核过的点（FINAL/TEST 当前版本）

| 检查 | 结果 |
|---|---|
| 所有数字可指到 `run11/logs/*` 或 `run11/evidence/*` | **PASS**（§1 六门禁 + §2 两处运行时证据） |
| 没有把定向结果回填全量 | **PASS**（FINAL/TEST/BALANCE 均分区保留 150/153/154 与定向绿） |
| 11 项限制齐备 | **FAIL（2 项缺）**：run31↔run32 独立范围、`World.updateRoom` 重复块 → §B-5 |
| 措辞红线（§7 的 10 条） | **PASS**（未出现"整工程 PASS/3seed 渲染全路线/v4 已验证断线/P5 变体已实现"等） |
| P5 口径 | **PASS**（"无调参决定、样本太小、preset 仅提案"） |
| 引用 hash | **PASS**（`audit 6ea30e8b`、`aiw 855eb948`、`P3 d446a768`；无旧 byte 冒充最终） |
| 门禁表可定位性 | **FAIL（1 处）**：第 2–6 行 `.../logs/...` 省略号 → §B-1 |
| Signal 因果表述 | **FAIL（1 处，轻度）**：无弹量断言的子句 → §B-2 |

定稿后我只需复核 §B 那一轮改动即可，不必重扫全文。

## 附录 A — bounded real-ECHO smoke on v4 运行时（本单第二项，已执行 1 次）

**一行命令 → PASS → 绝对产物**

`PORT=5487 npx playwright test -c _review/pw.echo.config.ts`（cwd = `D:/tmp/gp01-v4-echo`）→ **PASS（1 passed / 1.0m；模型请求 2 次 / 上限 6）** → 权威产物 `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/real-model-v4/trace.json`（sha256 `42426bca…d88b`）；控制台转写 `…/real-model-v4/run-console-transcript.md`；5 张截图同目录。

### A.1 运行时与预算（与历史实验分开记账）

| 项 | 值 |
|---|---|
| 快照 | `D:/tmp/gp01-v4-echo` = `git archive d55e502`（**产品 v4**：`World 349544bf…`、`core f71523e1…`，跑前**与跑后**都核过）；自带 `dist-mcp` 构建（`companionMcpServer.mjs a593a40e…`）；`node_modules` 与我早前的 echo 快照共用（`package.json` 仅 CRLF 差异） |
| harness | 复用 87a0fac 那套 `echo_observe → model → echo_suggest → Owner fixture confirm/reject → disconnect` 现成脚本；本轮只改 **OUT 目录**、**maxRequests 12→6**、默认端口 5488→5487。产品源与 `tests/**` 未改，主仓未改 |
| 端口 | reviewer 自有 **5487**（跑完已释放）；Tester 5199/5494 全程未动，跑后仍 LISTENING |
| 预算 | 请求 **2 / ≤6**、`max_tokens = 1024`、wall **51.4 s / ≤5 min**、**无重试追绿**；历史 87a0fac 那 6 条"执行者记录、原始日志被覆盖"的限制**不改**，本次是**新实验、独立记账** |

### A.2 链上实测（逐环节，均为真实运行值）

| 环节 | 实测 |
|---|---|
| 真实入口 | 主菜单 DEMO 01 → resume 后 ECHO 落地 `hp 94 @ (9.39,45.86)`，`comStatus OFF`（未连接） |
| Owner 配对（fixture） | pause → AI & COMPANION → LLM COMPANION → `ENABLE / RE-AUTHORIZE` → 掩码表单（fixture 注入，**未打印/未截图/未进 prompt**）→ `comStatus CONNECTED`（tick 99） |
| 官方观察 `echo_observe` | `ok:true`，observation 只含 echo/player/**drones(按感知)**/targets/relay/energy/cooldowns/memory；**无 seed、无全图、无 dev id、无 Owner key** |
| 模型 → `echo_suggest` | req#1 `chatcmpl-f525a2…` 200 `group/elisa` 2537ms 455/28 tokens，可见输出 `{"kind":"toggle-relay","reason":"perceived_relay","target":{"x":11.5,"y":48.5}}`（target 取自投影里的 relay 坐标）→ `sug_d0565408…` `ok:true` |
| 暂停确认（Owner fixture） | queue = **1**；**二次确认后仍为 1**；暂停期间 tick/energy 不变 |
| resume 后真实结算 | tick 99→243；`signal-relay-changed` **恰好 1 次**（`INACTIVE`, `manualEnabled:false`）；energy 不变（toggle 不扣能，符合 kind） |
| 第二次建议 + 拒绝 | req#2 `chatcmpl-3836d6…` 200 1792ms 876/11 tokens，`{"kind":"scan","reason":"objective_blocked"}` → `sug_4be7996e…`；Owner fixture REJECT → `pendingIntent:false`、**tick 267→267 不前进**、energy/evidence 不变、该 id 不可复活（`stillPending:false, count:0`） |
| 断线降级（fixture `DISCONNECT`） | `comStatus FALLBACK:NO_MODEL`，UI 诚实：`MODEL OFFLINE` / `ONLY A HUMAN HERE CAN CONFIRM` / `No pending proposal.`；无假 `CONNECTED` |
| 离线本地路径 | 本地提案 `local_267_1`（scan）→ 本地确认 → queue 1（真实本地路径，与 owner-external 分开） |
| 脱敏 | trace 内无 `Authorization`/`Bearer`/`api_key`/`OWNER_KEY`/`reasoning_content`/`seed`（仅 `prompt_tokens`/`completion_tokens` 这类计数），5 张截图只含暂停/LLM 页面 |

### A.3 这份 smoke 能主张 / 不能主张

- **能**：v4 运行时上，官方 `echo_observe` → 真实 Magpie 模型 → 官方 `echo_suggest` → Owner fixture 确认/拒绝 → 真实 core tick 结算 → 断线降级 → 离线本地路径，全链一次跑通；模型自行选择 kind（toggle-relay / scan），不是脚本固定；缓存/预算/脱敏合规。
- **不能**：① 不能说"人类验收通过"（Owner 是 fixture）；② 不能说"平衡/难度结论"；③ 不能说"稳定性"（1 次、2 请求）；④ 不能把 87a0fac 的历史链算作 v4（本轮是新快照、新构建、新跑）。
- **记录瑕疵（我方）**：`trace.json.snapshot` 字段仍是 harness 里的旧字面量 `"87a0fac"`，**不可引用**；真实 provenance 见 A.1 的 archive + 源码 hash。

---

## 附录 B — 对 `FINAL_REPORT.md` / `TEST_REPORT.md` 的具体更正建议（我只报，不改他人文档）

> **状态更新（2026-11-19 末次）**：本表 1–7、9、10 项 Lead 已修；仅第 8 项（TEST §7-⑥ 模型调用范围）未改。以 **附录 E** 为当前结论，本表保留为审计轨迹。

| # | 文件/位置 | 现文 | 问题 | 建议改法（给出可定位路径） |
|---|---|---|---|---|
| 1 | FINAL 门禁表第 2–6 行 | `.../logs/2-typecheck.log.txt` 等 | `.../` 是省略号，**不可定位** | 用完整相对路径：`tester/p4-final/run11-final-155/logs/{2-typecheck,3a-mcp-surface,3b-build,4-full-playwright,5-parity}.log.txt`（第 1 行已是对的） |
| 2 | FINAL「Signal 因果」行 | "ACTIVE **新弹** → Jam **新弹为 0**、**旧弹仍伤人**" | 浏览器侧**没有**弹量断言：`tests/gameplay-01.spec.ts:350/450/464` 断言的是 World getter `p1LinkedFireEnabled`（`World.ts:705-710`，等价于 `relay==='ACTIVE'`），配合 core 规则 `attackAllowed → step.attack=null`（`core.ts:1113,1149`）。"旧弹仍伤人"**无专项断言**（`stepProjectiles` 不读 relay，属代码事实） | 改成"core 规则 + 浏览器状态断言"两级表述，并注明"在途弹丸不受闸门影响（代码事实，无专项用例）" |
| 3 | FINAL「Lead 将通过字节精确集成」 | 将来时 | 已发生 | 改为"已于 `a487b98` 集成；`integration-run11/spec-hashes.log.txt` 8/8 PASS；`git diff d55e502..a487b98 -- src/` 为空" |
| 4 | FINAL「最终 v4 的额外复核如有交付另列」 | 未列 | 已有交付 | 补一行引用 §A：`reviewer/real-model-v4/{trace.json(PROVENANCE.md 为准),run-console-transcript.md}`，2 请求/1024 tokens/51.4s，`autoOwner` fixture |
| 5 | FINAL「已知非阻断限制」 | 列表 | 缺两项：**P3 run31↔run32 的独立范围**（我独立复现的是 run31；run32 只由 Lead 核差量）、**`World.updateRoom` 重复清除块**（既存缺陷，非作者房间会双计） | 两条各加一句 |
| 6 | TEST §1 末句 | "`audit` and `ai-native-world` are the two bytes still to be integrated by the Lead" | 过时 | 改为"两处字节已在 `a487b98` 集成（8/8 hash 核对见 `integration-run11/spec-hashes.log.txt`）" |
| 7 | TEST §5「Labelled fixtures」 | "the audit spec's own boss/weapon setup — each is named in the per-record `fixtures` field" | `tests/audit.spec.ts` **没有** `fixtures`/`record(` 字段（grep = 0） | 改成"audit 用例是 dev-test setup（`resetProjectilesForTest`、`spawnBoss`、手动 `stepFrame`），不写 per-record fixtures" |
| 8 | TEST §2 时间/CPU | gate2/3a "23:19"、`host CPU 27 %` | 日志实为 `23:18:41/23:18:58`、`host_cpu_load_pct=28` | 按日志值改（trivial） |
| 9 | TEST §7-⑥ | "No model was called in this round" | 本次 round **reviewer** 跑了 v4 smoke（2 请求） | 限定为"tester 的 run11 未调用模型；reviewer 的 v4 smoke 另列" |
| 10 | BALANCE §0 | 渲染证据列 run4 六组 JSON | 未写测试字节代次 | 补一句"证据来自 run4 测试字节（`839e91fb`），产品同为 v4；run11 复跑 6 例通过但未归档逐 seed JSON" |

## 附录 C — 11 项真实限制 —— 文档覆盖对照（修复前后）

> **状态更新**：修复后 11/11 齐备（见附录 E.2 末段）；下表是修复前审计轨迹。

| # | 限制 | FINAL | TEST | BALANCE/HUMAN |
|---|---|---|---|---|
| 1 | B7 默认并发高负载 857/859 历史 | ✓「已知非阻断限制」+ 门禁段 | ✓ §3、§7-③ | — |
| 2 | R3 跨版本 authored 身份 | ✓ | ✓ §5/§7-⑤ | — |
| 3 | 极端无 centre 格 legacy fallback | ✓ | ✓ §5 | — |
| 4 | restore 保留目标审计/代次 vs factory 冷启动 | ✓ | —（可加） | — |
| 5 | 早期记录丢失（含 6 次不可核模型请求） | ✓ | ✓ §3/§4 | — |
| 6 | **P3 run31↔run32 的独立范围** | **缺** | **缺** | — |
| 7 | 定向绿不得回填历史全量 | ✓ | ✓ §3 | — |
| 8 | **`World.updateRoom` 重复清除块（既存）** | **缺** | **缺** | — |
| 9 | `tests/` 不在 tsconfig ⇒ typecheck 不含测试 | ✓ | ✓ §2 | — |
| 10 | 真实模型版本边界（b6a98e5 / 87a0fac，v4 另列） | ✓ | ✓ §7-⑥ | — |
| 11 | 人类 fixture / HUMAN PENDING | ✓ | ✓ | ✓ |

⇒ 6、8 两项在 FINAL/TEST 里都缺，属**文档缺项（非阻断）**，建议按 §B-5 补。

## 附录 D — 我的最终结论（工程 vs 人类分开）

| 维度 | 结论 | 依据 |
|---|---|---|
| **工程功能范围**（P0–P4 交付行为：路线/门户/JAM/清房单一提交/ECHO 单飞与回执/反馈 UI/恢复契约） | **PASS（有界）** | §3 逐阶段 + run11 155/155 + 6 组渲染 JSON + 我的独立复算（§2） |
| **测试范围**（vitest 859 默认档、Playwright 155、parity、surface、build、typecheck） | **PASS（有界）** | §1 六门禁（run11 日志，我实读时间/计数） |
| **权限/Owner 边界范围**（不新增 surface、不绕过 Owner 协议、本地建议与外部来源不混、无 secret） | **PASS（有界）** | §2.2 事件级证据 + §A v4 smoke（官方 `echo_observe`/`echo_suggest`、无 Owner key/cap/dev 状态进模型日志） |
| **未关闭阻断** | **无** | 11 项限制全部为"已知/有界/文档化"，无功能性阻断 |
| **人类验收 / 体验成熟度** | **PENDING / 不宣称** | 全部 fixture/agent；`HUMAN_PLAYTEST.md` 结果表为空 |
| **P5** | 回归与平衡**记录**已完成；**无调参结论、无长期平衡结论**；新 preset 仅提案 | §6 |

> 一句话：**这是一次有界的工程 PASS（功能/测试/权限），不是"产品体验验收通过"。** 单轮全绿不构成稳定性保证（B7 负载风险保留）。

---

## 附录 E — 终稿复核（2026-11-19 末次，只核文档差异）

复核范围：只读 `FINAL_REPORT.md` / `TEST_REPORT.md` / `GAMEPLAY_01_BALANCE.md` / `HUMAN_PLAYTEST.md` 的这轮改动 + 11 项限制；**未改任何 Lead/Tester 文档，未跑源码/测试/模型/gate，未 commit**。

### E.1 四文最终 SHA（我实算）

| 文档 | sha256 |
|---|---|
| `reports/gameplay-01/FINAL_REPORT.md` | `a3118317e254421368ed77947e3c4720308905825e128a93818fd784bedeb600` |
| `reports/gameplay-01/TEST_REPORT.md` | `84a9f33c2bdbefd0ab9eb8b6fee65b2992dc984e7d90695093a376a2ae9df797` |
| `docs/gameplay/GAMEPLAY_01_BALANCE.md` | `d804253e30fe5da4c6382333892a0290b06e04c17409eccbcf493856505a2977` |
| `docs/gameplay/HUMAN_PLAYTEST.md` | `a9fd8a789fbb4feb6b291c38217ac33b61fc5e4e35b72265e7968567a576e975`（未变） |

### E.2 十条修复逐项核（PASS/FAIL）

| # | 修复项 | 我的核对 | 判定 |
|---|---|---|---|
| 1 | FINAL 门禁表 6 条路径 | `FINAL_REPORT.md:34-39` 全部为 `tester/p4-final/run11-final-155/logs/...`，无省略号 | **PASS** |
| 2 | Signal 证据两层化 | `:23` 明确"core 规则单测及 P1 早期事件探针"验抑制/旧弹/恢复，并声明"最终 E2E 的 `linkedFire` getter 不是弹量断言；旧弹伤害未作为最终版专项用例"。来源我核实过：`src/world/sim/signalLink.test.ts:158-160`（JAMMED 时 0 新弹）+ 我 P1 独立反事实探针（`P1_FINAL_REVIEW.md:39`：jam 时在场 2 发，HP 94→88） | **PASS** |
| 3 | 限制补 P3 run31/run32、`updateRoom` 重复块 | `:76` 两项都在，且写明"本轮未修、未把 callback 双计作为指标" | **PASS** |
| 4 | 工程 PASS / human pending 分开 | `:80` "工程功能、测试、Owner 边界均为有界 PASS，人类验收待定" | **PASS** |
| 5 | v4 模型 smoke + snapshot sidecar | `:56`/`:58`：b6a98e5/87a0fac 不冒充 v4；v4 smoke 2/6、51.4s、`FALLBACK:NO_MODEL`、本地离线建议；`snapshot` 旧字面量不可作版本依据、原 trace 不改写；"单次工程 smoke，不证明真人/平衡/非法输出" | **PASS** |
| 6 | TEST 集成时态 | `TEST_REPORT.md:44-45` "were integrated by the Lead in `a487b98`"；`:148` 同 | **PASS** |
| 7 | TEST audit setup 不用 fixtures 字段 | `:123-124` "explicit dev-test setup … not a per-record `fixtures` field" | **PASS** |
| 8 | TEST 模型调用范围限定到 Tester run11 | **未改**：`:97` 仍是 "No model call was made in run11 (**or any run of this round**)" | **FAIL（1 处，见 E.3）** |
| 9 | TEST CPU 28 / typecheck 时间 | `:27` `host CPU 28 %`；`:55` `23:18:41 → 23:18:53` | **PASS** |
| 10 | BALANCE 明示 run4 字节 `839e91fb`、不冒 run11 六份 JSON | `:27-30` 原话："produced by run4's P4 test bytes (`839e91fb`), with the same v4 product sources… uses run4 per-seed records rather than presenting them as run11 per-seed JSON" | **PASS** |

11 项限制：`FINAL_REPORT.md` 的"已知非阻断限制"段 + 两项覆盖边界段现在**11/11 齐备**（B7 负载、fallback、R3、audit 代次/旧环、丢记录、run31/32、无定向回填、`updateRoom` 重复块、`tests` 不在 tsconfig、模型版本、human fixture）。

无新增夸大：我逐段扫过新增文字，未出现"整工程 PASS / 3 seed 渲染全路线 / v4 已验证断线 / P5 变体已实现 / 平衡已达标"等表述；v4 smoke 与 P5 都带"单次 / 无调参 / 无长期结论"限定。

### E.3 唯一残留的具体主张错误（一条，非阻断）

`TEST_REPORT.md:97-98`：

> `- No model call was made in run11 (or any run of this round). Real-model evidence, where it exists, belongs to earlier reviewer/developer records and is not re-claimed here.`

- **错在**"or any run of this round"：本轮 **reviewer** 已实际跑过一次 v4 真实模型 smoke（2 请求 / 1024 tokens / 51.4 s），产物 `reviewer/real-model-v4/{trace.json,PROVENANCE.md,run-console-transcript.md,harness/}`；`FINAL_REPORT.md:58` 已经正确引用了它。
- **建议改法**（一句话）：`No model call was made in the tester's run11; the only real-model call in this round is the reviewer's separate v4 smoke (2 requests, see reviewer/real-model-v4/), which is not part of run11's gates.`
- 同类但更轻的一处：`FINAL_REPORT.md:30` 仍写"Lead **将**通过字节精确集成"，而 `:80` 已把 `a487b98` 列为已提交门禁 ⇒ 时态不一致，建议"已集成于 `a487b98`"。

### E.4 可复跑性补充（本轮补交）

`reviewer/real-model-v4/harness/` 现已放入**本次实际使用的**脱敏 harness 与 config（逐字节同源，sha 见下），并附 `RUN.md`（快照 `git archive d55e502`、`npm run game:mcp:build`、端口 5487、命令、预算、env、不可复跑缺口）：

| 文件 | sha256 |
|---|---|
| `harness/echo-real-model.echo.spec.ts` | `e88f1d36b9d265992dd201dd94526c71bb42b30e6ab6cf486bd3789935e80773` |
| `harness/pw.echo.config.ts` | `35fbe1a1a5a8f48c93d69a3df89d13fec27aa69c36928f92b5c484c3b14a12a4` |
| `harness/RUN.md` | 跑法 + 不可复跑项（`dist-mcp` 构建产物、`node_modules`、外部 3425 模型服务不存档） |

无 token / Owner key / 请求头被写入（运行期 `randomBytes` 生成 + `ownerAuthFixture` 提供）；未改原 `trace.json`、未重跑、0 新请求。此前 87a0fac 的旧 harness 不会被冒充为本次字节。

### E.5 最终结论（不变）

| 维度 | 结论 |
|---|---|
| 工程功能 / 测试 / 权限（Owner 边界） | **bounded PASS** |
| 未关闭阻断 | **无**（E.3 是一条文档句子的范围错误，不构成工程阻断） |
| P5 | 回归与平衡**评价**已完成；**无调优结论、无长期平衡结论**；新 presets = 未来建议 |
| 人类验收 | **PENDING**（不宣称体验成熟） |

Lead 可据此做最终 docs 提交（`git add` 由 Lead 做，我未 commit / 未 push / 未开 PR）。
