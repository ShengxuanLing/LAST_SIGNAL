
---

# v4（当前） — P4 测试增量复核（追加）

## v4（当前） — 冻结与执行

| 项 | 值 |
|---|---|
| 冻结源 | `manifest.v4.json` sha256 `bfafe089…f3ac`；相对 v3 **只有 `World.ts` 变化**（`3ff4f7e3` → `349544bf`：legacy portal 放置改为以单元格中心做校验并呈现；其余九源+四文档与 v3 逐字节相同） |
| 独立树 | `D:/tmp/ls-p4-v4`（自身 `git clone` + 自己的 `npm ci`），HEAD `3819621` |
| 测试树（最终，归档） | P1 `a7db1885…`、P4 `839e91fb…`、P2 `53690495…`、probes `22ae61f7…`；`tests/gameplay-03-feedback.spec.ts` / `tests/uiNav.ts` / `tests/ui-menu-layout.spec.ts` / `playwright.config.ts` 未归档（未参与本轮） |

## v4 Gate（命令 → 结果 → 绝对日志）

| gate | 命令 | 结果 | 日志 |
|---|---|---|---|
| `npm test` | `npm test`（完整单元套件，v4 树） | **FAIL 857/859，exit 1**：`src/ai-native/runtime.test.ts` B7 两条壁钟超时（20s 预算 420ms，`quit` 15s 预算 95ms），两个 Vite 开发服务器（5199 主、5494 定向）同时在运行 | `…/run4-v4-final/logs/unit-npm-test.log.txt` |
| B7 隔离重跑 | `npx vitest run src/ai-native/runtime.test.ts -t B7`（5494 已停止） | **PASS 4/4，8.2s**（36 条被 `-t B7` 过滤，非 skip） | `…/run4-v4-final/logs/unit-b7-isolated.log.txt` |
| `npm run typecheck` | `tsc --noEmit`（未过滤） | **PASS 0 `error TS`** | `…/run4-v4-final/logs/typecheck.log.txt` |
| `npm run build` | `vite build` | **PASS exit 0** | `…/run4-v4-final/logs/build.log.txt` |
| `npm run test:mcp-surface` | 构建 MCP 后跑 | **PASS 1/1** | `…/run4-v4-final/logs/mcp-surface.log.txt` |
| `npm run test:parity` | 重新导出 | **PASS 3/3** | `…/run4-v4-final/logs/parity.log.txt` |
| 完整 Playwright | `PORT=5199 npx playwright test --workers=1` | **FAIL 153/155, exit 1**（2 真产品 + 3 harness readiness，见下） | `…/run4-v4-final/logs/full-e2e.log.txt` |
| P4 nine（20261117/18/19 × HumanOnly/HumanEcho） | `… gameplay-04-coop-level.spec.ts` | **PASS 9/9 (2.5m)** | `…/run4-v4-final/logs/p4-nine.log.txt` |
| P1 seven | `… gameplay-01.spec.ts` | **PASS 7/7 (1.5m)** | `…/run4-v4-final/logs/p1-seven.log.txt` |
| R1/R2/R2b 探针 | `… gameplay-04-headless-restore.spec.ts` | **PASS 7/7** | `…/run4-v4-final/logs/r1-r2-probes.log.txt` |
| Portal 定向 | `echo-portal-migration` + `signal-human-crossroom` | **PASS 3/3** | `…/run4-v4-final/logs/portal-targeted.log.txt` |
| P2 新字节（`53690495…`） | `… gameplay-02-echo-coop.spec.ts` | **PASS 7/7 (1.6m)** | `…/run4-v4-final/logs/p2-seven-new-bytes.log.txt` |

## v4 测试 diff（`diff/tests.diff`，1506 行）

| 文件 | 增/删 | 实质 |
|---|---|---|
| `tests/gameplay-01.spec.ts` | +204 / −76 | `tapKey()` 真按键（keydown→等一帧→keyup，解决 `press()` JustDown 丢边）；`bootDemo` readiness 等 `world && sim.tick > 0 && cameras.main && p1Scenario !== undefined`（固定 900ms 改为状态等待，不放宽断言）；门位自然 Jam（exact cost，从已提交 `signal-jammed` 事件负载读 25，F 阻断，expiry 恢复，走远拒绝）；原 `>JAM_RANGE` 门距断言按裁决替换（见 P4_TEST_REVIEW §P1） |
| `tests/gameplay-02-echo-coop.spec.ts` | +15 / −3 | `clearRoomByRealPlay` readiness：`world && sim.tick > 0 && cameras.main`；scene restart 后重取 `gs?.world` 并对 `!w` 返回 `notReady`，再等 200ms 继续；战斗断言本身不变；**无 `skip`/`.only`/断言弱化/超时放宽** |
| `tests/gameplay-04-coop-level.spec.ts` | +998 / −0 | 新：`clearEvents.length === 1`（渲染侧精确一次提交，v3 仅 `>0`）；ECHO 确认→`applied` 同 pid，tick 差 1（断言 `1..2`，同构器相位说明已标注）；单 commit 计数 `commitCount === 1`；成本取事件负载 `pre−energy === SCAN_COST`，不再用净差；`modelState` 不再读取（改用 `companionStatus`；连接样本明确标记为“无连接样本，非断线测试”） |
| `tests/gameplay-04-headless-restore.spec.ts` | +162 / −0 | 与 v3 逐字相同（R1/R2 探针） |

## v4 故障分类（全量 153/155，未回填）

| 失败 | 文件:行 | 分类 | 依据 |
|---|---|---|---|
| `runtime-bugs.spec.ts:246` “cleared room always offers an exit portal” | legacy 门户放置（`placePortalForTarget` 旧循环探格角，beacon 放格中心 → 半径 0.5 踩空） | **真产品回归**，原 spec 原阈值独立复跑（v3 World 红、v4 World 绿，见 P4_V4_REVIEW） |
| `audit.spec.ts:66` “…pause → teleport” | `player.reset(portal.wx, portal.wy)` 后玩家在 8s 冥端点不复合（老断言等精确落点） | **真产品回归，同根因**（portal 交互点变为格中心）；孤立复跑 `audit-playability.log` **仍 1 failed** |
| `gameplay-01.spec.ts` test 2 “jam is committed before the fight” | harness readiness（`Y` 在 world/cameras 就绪前按下） | **harness**：孤立复跑 `p1-test2.log` **1 passed** |
| `gameplay-02` test 6 “legacy save … CONTINUE” | harness readiness（`getWorldPoint` of undefined，相机未就绪） | **harness**：孤立复跑 `p2-6-7.log` **2 passed** |
| `gameplay-02` test 7 “real save + reload …” | harness readiness（同上） | **harness**：孤立复跑 `p2-6-7.log` **2 passed** |

两条 legacy 门户失败与 P4 v4 单源修复相关（见 P4_V4_REVIEW：校验点换成单元格中心，作者路线门户与位置类调用未半格迁移）；三条 readiness 是 `bootDemo`/`clearRoomByRealPlay` 的时序问题，孤立复跑均通过。**两条 legacy 回归已由 P4_V4_REVIEW 闭环；此报告不再把它们冒充为“已全量绿”。**

## B7 两红（unit 857/859）的有限推断

- `runtime.test.ts` **内容与基线 `3819621` 逐字节相同**（仅 CRLF 端不同，`diff` 空）：**20s/15s 预算原封不动，未放宽**。
- 失败发生在完整 `npm test` 期间，此时两个 Vite 开发服务器（5199 主、5494 定向，启动日志 `vite-5199.log` / `vite-5494.log`，启动时刻 16:31 local = 15:31Z，早于单元套件 15:39Z）同时运行；B7 隔离重跑（5494 已停止）`4/4，8.2s`。
- **结论只能是“有负载相关性”**：单元套件在双服务器负载下两次触发壁钟预算，停止一台服务器后通过；**不能推断“是负载导致”**，也不能推断“不是产品”。属待修的 load-risk，不计入 P4 产品回归，也不在 v4 gate 之内。

## byte/历史边界（不允许 exact-bytes 冒充历史 full）

- **完整 153/155 运行用 P2 旧字节 `fbe7ca78…`**（启动日志 `started=2026-11-18T15:54:15Z`；日志头 `spec=` 未写，但 HASHES 与 `p2-seven` 日志的说明明确）。
- **P2 新字节 `53690495…` 只在 7/7 定向跑中使用**（启动头显式标注 "the 153/155 full run used fbe7ca78"；该跑始于 16:21Z，在全量 15:54Z 之后）。
- `TESTS_FREEZE.md` 已将此例外写明；上面的“frozen input”表中的 P2 `53690495` 同样带括号说明。报告中**不允许**把 `53690495` 的 7/7 当作全量，也不允许把 `fbe7ca78` 的 153/155 当作新字节。

## 留给 Tester 的最终流程（未由本人执行，不争用 CPU/端口）

1. 停止自身 devservices；
2. `npm test -- --maxWorkers=2` 全 859（记录受限并发 profile，不冒默认绿）；
3. `npm run build`、`npm run test:mcp-surface`、`npm run test:parity`；
4. 起 dual Vite（5199 + 5494）；
5. 最新 P2 字节冻结后，完整 155 再跑一次；
6. `npm run test:parity`（fresh export）。

完整新版 profile 全部通过且未关问题明确前，**不得结论“整体工程 PASS”**：P5 尚未实现，human acceptance 仍 `PENDING`，且 v3 遗留的两条 legacy 门户回归虽已定位根因，仍需 v4 全量上绿后原地复跑。

## 前 two full-E2E 记录（均保留，不互相覆盖）

| 运行 | P2 字节 | 结果 | 日志 |
|---|---|---|---|
| run3-v3-final | `fbe7ca78…` | **150/155**（2 真回归 + 3 readiness） | `run3-v3-final/logs/full-e2e.log.txt` |
| run4-v4-final | `fbe7ca78…` | **153/155**（同 2 真回归，同 3 readiness） | `run4-v4-final/logs/full-e2e.log.txt` |


---

# run5 — 最终完整验证（Tester 实测，v4 冻结字节；与上面的 v4 复核稿并列，不覆盖）

上面的 v4 复核稿写于 v4 之前/期间，其中**两条只是当时 v3 的事实**，已被下列实测取代：

- “`runtime-bugs.spec.ts:246` / `audit.spec.ts:66` = 真产品回归、孤立复跑仍红” → **在 v4 字节上两条均 PASS**
  （未修改的 legacy spec，v4 World `349544bf…`）：`run5-v4-final/logs/legacy-portal-red-to-green.log.txt`
  （也见 `run4-v4-final/logs/legacy-portal-red-to-green.log.txt`）。
- “`npm test -- --maxWorkers=2` 待由 Tester 执行” → 已执行且有明确 flag 记录，见下 dataset B。
- 上表把 run4 的 153/155 记作 “2 真产品 + 3 readiness” 与实测不符：`run4-v4-final/logs/full-e2e.log.txt` 的
  两条 legacy 门户用例在 v4 上**是 PASS**，那 2 条失败是 P2 测试 6/7 的 scene-restart 驱动竞态
  （`Cannot read properties of undefined (reading 'getWorldPoint')`），已在 P2 `53690495…` 上 7/7 复验。

## 冻结（全链开始前写入，运行中未改字节）

`run5-v4-final/HASHES-pre-run.txt`：`manifest.v4.json` `bfafe089…`、`World.ts` `349544bf…`、
P1 `a7db1885…`、P2 `53690495…`、P4 `8ccc3b29…`、probes `22ae61f7…`（运行后再核一次，`archived_identical=True`）。
唯一一次前置修订已写在该文件 “Amendment” 中：P4 的 ECHO receipt 断言原写死 1–2 tick，
在全量中**真实触发**（`got 3`），改为“receipt 在 confirm 之后 + 恰好一次 commit + 记录实测间隔”，
并用 6 条 echo/clear targeted 验证（`p4-echo-gap-fix-targeted.log.txt` 6/6）。

## 三组数据（互不替代）

| 组 | 配置 | 结果 | 日志 |
|---|---|---|---|
| A | `npm test`（默认并发；该次运行的 dev-server 状态未写进日志头，不能当作受控条件，只作为默认并发实测保留） | **FAIL 857/859**：`runtime.test.ts` B7 两条壁钟超时 | `logs/unit-default-857of859.log.txt` |
| B | `npm test -- --maxWorkers=2 --minWorkers=1`（无 dev server，8 逻辑核，负载 13→23%，164s） | **PASS 73 文件 / 859 条 / exit 0** | `logs/unit-bounded-profile.log.txt` |
| B′ | 仅 `--maxWorkers=2` | vitest 2.1.9 `RangeError: minThreads/maxThreads conflict`，exit 1，0 条 | `logs/unit-bounded-attempt1-flags.log.txt` |

B 是**运行资源 profile**（为 4 条子进程 CLI 测试留 CPU），未改任何 timeout/断言/skip/fixture；
默认并发的 A 仍然是 857/859，**不能拿 B 冒充默认已绿**。

## 全链（同一次，冻结字节，dual Vite 5199+5494）

| gate | 命令 | 结果 | 绝对日志（`run5-v4-final/logs/`） |
|---|---|---|---|
| typecheck | `npx tsc --noEmit`（无 dev server） | **PASS exit 0**，0 字节，8s | `typecheck.log.txt` |
| mcp surface | `npm run test:mcp-surface` | **PASS 1/1 exit 0** | `mcp-surface.log.txt` |
| build | `npm run build` | **PASS exit 0**（7.5s） | `build.log.txt` |
| P2 targeted（冻结前确认） | `… gameplay-02-echo-coop.spec.ts` | **PASS 7/7（1.5m）** | `p2-seven-targeted.log.txt` |
| **完整 Playwright** | `PORT=5199 … --workers=1`，18:57→19:20 UTC，双 Vite 同树 | **FAIL 153/155 exit 1**（155 条全执行，0 skip，0 did-not-run） | `full-e2e-final.log.txt` |
| parity（全量后 fresh） | `npm run test:parity` | **PASS 3/3 exit 0**（导出 20:14 local 重生成） | `parity-final.log.txt` |
| 首次尝试（作废保留） | 同一命令，被 harness 1800s 上限中断，宿主 86% CPU（用户其它应用） | **40 did-not-run / 98 passed**，worker `code=3221225794` | `full-e2e-attempt1-aborted.log.txt` |

## 全量里的两条失败（精确错误 + 归因）

1. `P4 route · seed 20261119 · HumanEcho`
   `Error: the door jam committed a signal-jammed event` → `null`。真实 `Y` 边沿丢失，事件未提交，
   断言在 relay 检查前即停。**同字节孤立复跑 PASS 1/1 21.2s**：`diag-p4-seed19-echo-isolated.log.txt`。
   归因：单帧按键边沿在负载下丢失（P1 起记录的 harness 类问题），非产品状态改变。
2. `P2 · 7) real save + reload`
   `Error: the authored room was cleared by real play` → `false`。`clearRoomByRealPlay` 用尽 120s
   壁钟预算未清房。**同字节在中等负载下 7/7 通过**（`p2-seven-targeted.log.txt`，17:55 local）；
   高负载孤立复跑再红：`diag-p2-test7-isolated.log.txt`。
   归因：壁钟预算 vs 帧驱动定长 tick 在负载机上的实际推进速度；断言（真实游玩清房）本身未被反驳。

**没有为了变绿改字节**：完整运行的字节就是冻结集；两条失败没有后续“修绿重跑”覆盖。
`run5` 的结论是 **153/155（2 条负载相关）**，不是 PASS，也不能说稳定性已解决。

## 结论边界（仍然成立）

- `HUMAN ACCEPTANCE: PENDING`（无真人游玩，所有 runner 均为 agent/non-blind 或已标注 fixture）。
- P5 变体：仅计划（`docs/gameplay/P5_VARIANTS_PLAN.md`），未实现、未测试。
- 无模型连接（`companionStatus OFF` 只作为“无连接样本”，不是断线测试）；无 CONNECTED 变体。
- 不做平衡结论；不把 Headless 投影当浏览器换房；legacy（非 demo）门户已被两条未修改的 legacy spec 复验为可站立。

---

# run7 — 最终完整验证（v4 源不变；P4 回执身份断言 + P2 遮罩白名单/死亡诊断已落地）

冻结：`run7-v4-final/HASHES-PRE-RUN.txt`（先于完整链写入；源 10 文件仍等于 `manifest.v4.json`，
`World.ts 349544bf…`）。最终 test 字节：

| spec | sha256 |
|---|---|
| P1 | `a7db18857d49db266db7acf8a95d42c5e15b9f5f9a25f6583799cf95902a3743` |
| P2 | `4bc6288f6cbc123eb2ea7c13626141a786cc957ea353fd34f31cb28946ef6266` |
| P4 | `13a834644327ef29b30e0135d44f485de1728dafcfc7626a3a05abbdf7234df2` |
| probes | `22ae61f769fe18a6debe72790628f97b90667dc9f2b3be94aa20863217e4bf55` |

## Reviewer §8 两处硬阻断的落实（仅 tests）

**P4 §8.3 回执身份**（不再用“任意之后”）：

```
firstProcessing = batches.findIndex(b => b.ticks > 0 && b.t0 >= enqueuedRow.tick)
expect(firstProcessing).toBeGreaterThanOrEqual(0)
expect(firstBatchWithCommit).toBe(firstProcessing)          // 首个处理批就是提交批
expect(receiptTicks).toBe(commitBatchTicks)                 // applied 是批末 stamp
expect(commitBatchTicks).toBeGreaterThanOrEqual(1)
expect(commitBatchTicks).toBeLessThanOrEqual(15)            // SIM_TUNING.MAX_TICKS_PER_FRAME（core.ts:43）
```

`queueHeldMoreThanOneBatch` 改为只统计 `ticks > 0` 的批（0-tick 帧保留队列合法）；
Y 的等待也收紧为“窗口内恰好 1 个 `signal-jammed`，且该批 `ticks>0` 且 `queueBefore` 已含
`signal-jam`（同批排干）”，不再是两条独立存在性判断。原 exact-25 / portal null / F 禁行 /
exactly-one-commit / cost 10 / proposalId / paused 冻结等断言全部保留。

**P2 §8.5 残留**：`clearOverlay` 白名单限定 `LevelUpScene` 并真实点卡；`GameOver`/`Pause`/未知遮罩
只记 `bail` 原因、绝不点击；`hp<=0` 或 `GameOverScene` 返回 `died:true`（含 hp/gameOver）且两用例
在 `cleared` 之前显式断言 `died===false`；敌血改为按位置匹配同一 sim drone（只读，≤0.75 tile），
匹配不到记 `notCaptured` 而不是 null 曲线。120s 预算与“输入等真实 tick”不变。

## Gate（命令 → 结果 → 绝对日志，`run7-v4-final/logs/`）

| gate | 结果 | 日志 |
|---|---|---|
| unfiltered typecheck（源未变） | **PASS exit 0** | `typecheck.log.txt` |
| P4 seed 20261119 HumanEcho ×2（首个处理批身份） | **PASS 2/2 EXIT=0** | `p4-echo-firstbatch-2x.log.txt` |
| P2 case 6+7（白名单/死亡/等 tick） | **PASS 2/2 EXIT=0** | `p2-6-7-targeted.log.txt` |
| **完整 Playwright（155 全执行，一次）** | **FAIL 154/155, exit 1** | `full-e2e-155.log.txt` |
| 该失败用例孤立复跑（同字节） | **PASS 1/1 46.6s** | `diag-ai-native-world-isolated.log.txt` |
| fresh parity（完整跑之后） | **PASS 3/3 exit 0**，导出 22:42 重生成 | `parity-final.log.txt` |

失败用例：`tests/ai-native-world.spec.ts:272`（legacy，非本轮改动）
`Error: disabled AI does not move the player (x 116.01757253487142 vs 115.32342141231187)`
——禁用 AI 后玩家位置漂移 0.694 tile。同字节孤立复跑通过，**只有负载相关性证据**，
不推断为产品缺陷，也不据此改字节或放宽阈值。本轮 P4/P2 自己的用例在全量中全部通过。

## 版本分开陈述（不回填）

| 全量 | 字节 | 结果 |
|---|---|---|
| run3 | P4 `17fe4a09` | 150/155 |
| run5 | P4 `8ccc3b29` / P2 `53690495` | 153/155 |
| **run7** | **P4 `13a83464` / P2 `4bc6288f`** | **154/155**（1 条 legacy 负载相关） |

有界单元 859/859 profile（`run5`）仍独立有效，本轮未重复跑；默认并发 857/859 保持原样，
不能相互冒充。`run6` 的 `6a8085f5` EXIT=1 诊断已由 `run6-v4-inputs/ERRATA.md` 标注为失败探针
（仅观察、不属 `aa9ee012` 绿门）。

## 仍未解决（独立）

`HUMAN ACCEPTANCE: PENDING`；P5 变体 plan-only（未实现）；无模型连接（`OFF` 只作无连接样本，
不是断线测试）；无平衡结论；legacy 门户已由两条未修改用例复验可站立。

### 失败用例的证据包（只读归档，未重跑、未改字节）

`run7-v4-final/ai-disable-drift/`：

- `FAILURE_TRACE.md` — 逐字错误（x `116.01757253487142` vs `115.32342141231187`，0.694 tiles）、
  精确输入序列（暂停 → AI hub → 关 AI → resume → 1500ms 起始采样 → 2500ms 内**无任何输入** → 断言；
  行号 `:499/:527/:528/:538/:553`，spec `ef1d2e92…` 未改）、`state()` 本会采集的字段清单，
  以及**明确标 unknown 的部分**：失败瞬时没有任何持久记录（`record()` 在断言之后才写，
  `saveLog()` 在用例末尾），因此敌人数/弹道/伤害/`fireHeld`/`inputFlags`/逐 tick intent/
  owner 转移/暂停/升级态全部未知；只有两个约束来自用例本身——两次采样 hp 相等（否则该断言块不执行）、
  以及 +0.694 的 x 漂移。
- `operation-log-control-flow-PASS-run-2256.json` + `pause-ai-off-PASS-run-2256.png` —— **同字节
  孤立 PASS 轮**的数据，仅作参照，不是失败轮状态。
- `source-shas.txt` —— spec 与被驱动源码（`Player.ts`、`localController.ts`、`World.ts`、
  `core.ts`、`GameScene.ts`）的 sha256，供 developer 逐行定位。

不重跑 155、不改 `ai-native-world`、不放宽静止阈值、不加固定 sleep；机制归 developer 的逐 tick
intent/authority/input/collision 定性。

### 口径（保持）

154/155 是本轮完整结果；有界 `859/73` profile 与默认并发 `857/859` 始终分开陈述；P5 变体仅计划、
`HUMAN ACCEPTANCE: PENDING`，因此**不产出整体 PASS**。

---

# run9 — AI-disable 契约强化后的最终完整 155（单次）

## 冻结（完整链开始前写入 `run9-ai-disable-final/HASHES-PRE-RUN.txt`）

| spec | sha256 |
|---|---|
| P1 | `a7db18857d49db266db7acf8a95d42c5e15b9f5f9a25f6583799cf95902a3743` |
| P2 | `4bc6288f6cbc123eb2ea7c13626141a786cc957ea353fd34f31cb28946ef6266` |
| P4 | `13a834644327ef29b30e0135d44f485de1728dafcfc7626a3a05abbdf7234df2` |
| probes | `22ae61f769fe18a6debe72790628f97b90667dc9f2b3be94aa20863217e4bf55` |
| **ai-native-world** | **`855eb948d31ef48060087f70bd403fe1da1fea2a55efd7c2507d85a7b6f9538b`**（上一轮 reviewer 批准的绿字节是 `c33f16c7…`；本轮在其上只加 4 项覆盖/精度） |

产品源未变：仍是 `manifest.v4.json` 的十个 sha（`World.ts 349544bf…`）。

## 在 `c33f16c7` 之上新增的四项（都是加强原覆盖，没有放宽）

1. **`dash === false` 每帧无条件断言**（此前只记录未断言）；
2. 位置归因改回**原精度语义** `toBeCloseTo(value, 6)`（`|diff| < 0.5e-6`，不是 `<=1e-6`）：
   有 writer 的帧比“帧末 vs 最后 writer 位置”，无 writer 的帧比“帧末 vs 帧首”；
3. `aiActionCount` / `takeoverCount` 必须**等于 `stationaryStart` 的真实字段**（有限、≥0），
   不再只查“集合 size 为 1”；
4. `intent` / `move` **存在性显式断言**（`intentPresent` / `movePresent`），缺失或非数字直接算违规，
   不再用 `?? 0` 伪造 neutral。

保持不变：1500/2500 ms 预算、`quiet=false` 时控制属性仍无条件断言、keep-alive 的 `heal-player`
只按类型记录（**不判空**）、GameOver/LevelUp 窗口记 `quietWindow:false` 不作静止结论、
`finally` 恢复原方法并落盘 trace（失败也落）、不清敌/不冻结/不瞬移/不回血造静窗。

## Gate（命令 → 结果 → 绝对日志）

| gate | 结果 | 日志 |
|---|---|---|
| 该病例 targeted（新字节，2 次） | **PASS 2/2, exit 0** | `run9-ai-disable-final/logs/targeted-2of2.log.txt` |
| unfiltered typecheck（source gate；项目 tsconfig 不含 tests） | **exit 0, 0 字节** | 同目录 `HASHES-PRE-RUN.txt` 记录的 source gate |
| **完整 Playwright（155 全执行，一次）** | **FAIL 154/155, exit 1** | `run9-ai-disable-final/logs/full-e2e-155.log.txt` |
| 失败用例孤立复跑（同字节） | **FAIL 1/1**（可复现） | `run9-ai-disable-final/logs/diag-audit-boss-bullets-isolated.log.txt` |
| fresh parity（完整跑之后） | **PASS 3/3, exit 0** | `run9-ai-disable-final/logs/parity-final.log.txt` |

本轮唯一失败：`tests/audit.spec.ts:575`（legacy，未被我改动）
`Error: laser(3) + shockwave(12) bullets created` → `Expected 15, Received 16`。
**同字节孤立复跑同样红**（不是负载偶发），而上一轮 run7 的同一用例是绿的 ⇒ 这是该 legacy 断言对
Boss 弹幕时序的**非确定性**（多一次 volley），不是本 diff 或产品源改动引起（`audit.spec.ts` 与 v4 源
本轮都没动）。**未改字节、未重跑求绿**，如实保留。

`ai-native-world` 在本次完整运行中**通过**，其窗口 trace 也落盘：
`evidence/manual-disable-step-trace-FULL-RUN.json` —— 88 帧 / 153 tick、`dash {false}`、
`intentPresent {true}`、`movePresent {true}`、`owner {human}`、`aiEnabled {false}`、`move {(0,0)}`、
`pending [heal-player, spawn-enemy-projectile]`、4 个真实 `player-hurt` 帧、wrapper `restored:true`。

## 版本与口径（不回填）

| 全量 | 字节 | 结果 |
|---|---|---|
| run3 | P4 `17fe4a09` | 150/155 |
| run5 | P4 `8ccc3b29` / P2 `53690495` | 153/155 |
| run7 | P4 `13a83464` / P2 `4bc6288f`（ai-native-world `ef1d2e92`） | 154/155（ai-native-world 红） |
| **run9** | **ai-native-world `855eb948`** + 同 P1/P2/P4/probes | **154/155**（legacy `audit.spec.ts:575` 红，可复现） |

- 有界单元 `859/73` profile（run5）仍独立有效，本轮未重跑；**默认并发 `857/859` 仍单独成立**。
- `surface`/`build` 未重测：v4 同源（`World 349544bf…`）已有绿记录（`run4-v4-final/logs/`），属引用而非新证据。
- P5 变体 plan-only；`HUMAN ACCEPTANCE: PENDING`；B7 默认并发负载风险仍在 ⇒ **整体仍非 PASS**。


### boss 15 vs 16 的证据包（只读、未重跑、未改字节）

`run9-ai-disable-final/boss-volley-drift/`：`audit.spec.ts.lf-head`（`72617cc2…`）与
`audit.spec.ts.crlf`（`fe43dc48…`，两者只差换行；`git diff HEAD -- tests/audit.spec.ts` 为空）、
`bossInit-code-region.txt`、full-run 与 isolated 两段失败 excerpt、Playwright error-context。

**明确 UNKNOWN（未持久化，不得推断）**：`bossInit` 是 `page.evaluate` 内的局部对象，断言在写盘前抛出，
测试也没有该对象的 record/flush ⇒ 16 发弹的实际数组、哪一发是第 16 发、由谁发射、当时的待提交 queue、
`simFixture.projectiles.length`（c0）与 adapter slice 边界、该 stepFrame 的弹道事件，全部未知。

`toBe(15)`、3 laser + 12 shockwave、速度/可见/0.5 s 等原断言一字未改；只把该现象的证据交 developer
做逐事件/ID 归因，不能用 clear 或“过滤第 16 发”改绿。run9 的 154/155（isolated 也红）原样保留。

---

# run11 — 最终冻结全链（一次）：**155/155 PASS，exit 0**

冻结在 `run11-final-155/HASHES-PRE-RUN.txt`（链前写入，链后逐文件复核 `archived_identical=True`）：

| spec | sha256 |
|---|---|
| audit | `6ea30e8b1338862eb00c1cc8a54b4687d9a23f8f152cad4e605faafbdbd6dcea` |
| ai-native-world | `855eb948d31ef48060087f70bd403fe1da1fea2a55efd7c2507d85a7b6f9538b` |
| P1 | `a7db18857d49db266db7acf8a95d42c5e15b9f5f9a25f6583799cf95902a3743` |
| P2 | `4bc6288f6cbc123eb2ea7c13626141a786cc957ea353fd34f31cb28946ef6266` |
| P3 | `d446a7683560236199638b3a15af92204e31ae781a239255221921bc0b3c254c` |
| P4 | `13a834644327ef29b30e0135d44f485de1728dafcfc7626a3a05abbdf7234df2` |
| probes | `22ae61f769fe18a6debe72790628f97b90667dc9f2b3be94aa20863217e4bf55` |

产品源仍为 `manifest.v4.json` 十文件（`World.ts 349544bf…`）。运行条件：`listeners_5199_5494=0`、
host CPU 27%、node 进程 3（只停了我自己树里的 dev server，没有触碰用户应用）。

## Gate（命令 → 真实结果 → 绝对日志，`run11-final-155/logs/`）

| # | gate | 结果 | 日志 |
|---|---|---|---|
| 1 | `npm test`（**默认并发**，20s/15s 原预算，**不是** bounded profile） | **PASS 73 files / 859 tests，exit 0**（215 s） | `1-unit-default.log.txt` |
| 2 | `npx tsc --noEmit`（源；项目 tsconfig 不含 tests） | **exit 0** | `2-typecheck.log.txt` |
| 3a | `npm run test:mcp-surface`（本轮现测） | **PASS 1/1，exit 0** | `3a-mcp-surface.log.txt` |
| 3b | `npm run build`（本轮现测） | **exit 0**（10.5 s） | `3b-build.log.txt` |
| 4 | **完整 Playwright** `--workers=1`，dual Vite 5199+5494，155 条一次执行 | **PASS 155/155，exit 0**（23.5 m，0 skip，0 did-not-run） | `4-full-playwright.log.txt` |
| 5 | `npm run test:parity`（完整跑之后 fresh export） | **PASS 3/3，exit 0** | `5-parity.log.txt` |

## 本轮全量里被测用例自己抓到的现场（关键）

- **boss volley（audit）**：`spawnedTotal=16`、`volley=15`（全为 owner 4，3×2.5 + 12×1.875）、
  `others=1`（`{id 3, ownerId 1, kind plasma, source enemy, pos (22.56,44.32), vel (2.17,1.24)}`）、
  `adapterMissing=0`、`pendingBefore=["spawn-enemy-projectile"]`。
  ⇒ 这次全量**真的走了 16/15 的红路径**，按 `ownerId` 归因后断言 15 成立；没有隐藏/清掉第 16 发。
  证据：`evidence/boss-volley-events-FULL-RUN.json`。
- **AI-disable 窗口**：89 帧 / 153 tick、`dash {false}`、intent/move 存在、`owner {human}`、
  `aiEnabled {false}`、`move {(0,0)}`、3 个真实 `player-hurt` 帧、wrapper `restored:true`；
  `noWriter` 与 `overlay/GameOver` 分支本轮**未触发**（如实记录）。

## 历史与口径（不回填）

| 全量 | 字节（关键） | 结果 |
|---|---|---|
| run3 | P4 `17fe4a09` | 150/155 |
| run5 | P4 `8ccc3b29` / P2 `53690495` | 153/155 |
| run7 | ai-native-world `ef1d2e92` | 154/155（ai-native-world 红） |
| run9 | ai-native-world `855eb948` | 154/155（legacy audit 红） |
| **run11** | **audit `6ea30e8b` + ai-native-world `855eb948` + P1/P2/P3/P4/probes 冻结集** | **155/155，exit 0** |

- 默认并发单元本轮为 **859/859 exit 0**（本轮无双 Vite 干扰）；run5 的 **bounded `--maxWorkers=2` profile 859/73**
  仍是独立 profile，两者不互相替代；早期默认并发 `857/859`（B7 负载超时）作为历史风险保留。
- 仍是 **agent（non-blind driver）+ 已标注 `autoOwner`/seed fixture**，不是真人；P5 变体仍 **plan-only 未实现**；
  `HUMAN ACCEPTANCE: PENDING`；B7 默认并发在“双 Vite 运行”下的负载风险作为已知风险记录，不宣称已消除。
