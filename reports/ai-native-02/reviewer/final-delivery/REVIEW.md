# 最终交付小补丁 d1f29d1 — 独立审查与报告口径抽查

- 被测：`d1f29d1aa25ecf0fb461e756948de979019b3a26`（父 `c2a31af609b8305ce5917d88d0a425a4af24a29c`，已解析完整 hash）
- 隔离：`git archive d1f29d1` → `D:\review-final\snap`，**2049 tracked 文件**，`git ls-tree -r d1f29d1`（blob sha1/路径）vs 快照内 `git hash-object` → **diff 0 行**
- 边界：只读源码/测试/配置/报告；未读 WIP/stash；未改任何仓库文件；未 merge/push/reset；未覆盖旧证据；自有端口 **5535**（启动前确认空闲、启动后核对命令行、结束只 kill 自己 PID，0 残留）；他人 **5173**（PID 22692）与 **5199**（PID 23920）均为开发者自有 dev server，未触碰；secret 零日志

## 结论

**代码可交付（本补丁范围）。** 两个直接 spawn 分支的 `bumpSimVersion()` 位置正确；快照失效语义与“旧快照不可变 / 最新快照=canonical live / 常规 tick 一致”都被真实 UI 规格与我的独立复跑同时证实；queued 路径不提前写、不会重复实体；端口默认值未改且 `PORT` 生效；最终交付文档的关键数字（743/743 unit、88/88 E2E、83/85 首败保留、c3c 16/16）与日志/哈希一致。**真人验收仍未发生**（见第 5 节），这是唯一不能由代码或自动化关闭的项。

## 1) 补丁本体（逐点）

| 点 | 结论 | 依据 |
|---|---|---|
| `spawnEnemy` 的 `bumpSimVersion()` 位置 | **正确** | `World.ts` 中该调用位于 `this.enemies.push` + `registerDrone/registerTarget` + `attachSim*` **之后**（函数末尾），因此下一帧 `world.sim` 反映的是最终状态；`bumpSimVersion()` 同时清 `simSnapshotCache` 与 `playerDataSnapshotCache`（`World.ts:474-478`） |
| `spawnBoss` 的 `bumpSimVersion()` 位置 | **正确** | 位于 `registerTarget` + `boss.attachSimTarget` 之后 |
| 旧冻结 snapshot 不可变 | **成立** | `sim` getter 返回 `deepFreeze(JSON.parse(JSON.stringify(_sim)))`（`:182-187`），新 spawn 只清缓存不改旧对象；规格断言 `beforeUnchanged`+`beforeFrozen` 且 `beforeDrones===0`（我的复跑 1/1 通过） |
| 新 snapshot 最新且与常规 tick 一致 | **成立** | 规格断言 `after !== before`、`afterHasId`、`snapshotMatchesLive`（canonical 相等）、随后真实 `stepFrame` 后 `tickSnapshotMatchesLive` + `tickHasDrone` |
| queued 路径不提前写 | **不变** | queued 路径是 core `room-enter` 命令在 `processCommands` 内提交，再由 `enemy-spawned` 事件驱动 `spawnEnemyFromCore`（提交后）；本补丁只在**直接** spawn 后加缓存失效，未改任何排队时序 |
| 无重复实体 | **成立** | 直接路径用 `registerDrone/registerTarget`（只 push state，**不发事件**），因此不会二次触发 `enemy-spawned`；queued 路径 `spawnEnemyFromCore` 首行 `if (this.enemies.some(e => e._id === event.id)) return;` 幂等；两条路径共用 `enemyIdCounter` 分配 id，无碰撞 |
| 测试断言是否放松 | **未放松** | 补丁只新增 `tests/world-sim-cache.spec.ts`（15 条具体断言：数量、真实 id、冻结、canonical 相等、tick 后一致），并把 `boss-room`/`canvas` 的 URL 改为 `PORT ?? 默认`；没有删改任何既有断言 |
| 端口默认值 | **未改** | `boss-room.spec.ts`：`PORT ?? 5173`；`canvas.spec.ts`：`PORT ?? 5199`；`playwright.config.ts` 仍 `PORT ?? 5173` |
| `PORT` 真的生效 | **成立** | 我在自有 5535 上跑这三个 spec 全绿；其中 `canvas` 的旧默认是 5199（该端口上跑着开发者的 dev server），我的运行没有落到 5199 仍通过，说明确实用了 `PORT` |

## 2) 我的独立门禁（都在冻结快照 + 自有 5535 上跑）

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit` | exit 0，0 字节 |
| `PORT=5535 npx playwright test tests/world-sim-cache.spec.ts --workers=1` | **1 passed** |
| `PORT=5535 npx playwright test tests/boss-room.spec.ts --workers=1`（`LS_SHOT_DIR` 指向临时目录，避免污染 tracked 截图） | **1 passed** |
| `PORT=5535 npx playwright test tests/canvas.spec.ts --workers=1` | **1 passed** |
| `npx vite-node scripts/c3c-rendered-headless-parity.mts`（对**提交里的** `rendered.json`+`sequence.json`） | **16/16 PASS**，`finalTick=26`，与提交内 `rendered.json` 的 `finalTick:26` 一致 |
| git 状态（审查结束） | HEAD=`d1f29d1…`、`git status -uno` **0 行**、`main` **不是** ancestor（未合并）、tracked **2049**、`tests/*.spec.ts` **32** |

> **可复现性记录（非阻断）**：c3c Node 门需要 `reports/ai-native-02/c3c/parity/initial.json`，该文件 **untracked**（`rendered.json`/`sequence.json` 才是 tracked）。我从工作区把这份证据只读拷进快照后才跑通。即“干净 clone → 直接跑 c3c Node 门”会因缺 `initial.json` 失败，必须先重跑导出。这与 Signal parity 是同一类“输入未入库”的性质，建议在 runbook 里写明顺序。

## 3) 报告口径抽查（与实际 hash / 日志对照）

| 文档 | 抽查点 | 结论 |
|---|---|---|
| `FINAL-STATUS.md` | HEAD `d1f29d1`、tree `aff2506…`、分支、`origin/main c221551`、ahead 72/behind 10、`MAIN_ANCESTOR=NO`、tracked dirty 0、2049 tracked、未 push/PR | **全部与 `final-git-state.log` 及我复核时的实际 git 状态一致**（我另外独立确认 main 不是 ancestor、dirty 0、2049 tracked） |
| `GATES.md` #4 | “全量单测 743/743（64 files）” | **日志真实**：`fix-final-unit.log` 内 `Test Files 64 passed`、`Tests 743 passed` |
| `GATES.md` #17 | “最终完整 E2E 88/88（32 spec，8.0m），首跑即绿” | **日志真实**：`final-e2e-5411-fixed.log` 有 88 条 `[chromium] ›` 行、末行 `ok 88 …`、汇总 `88 passed (8.0m)`；`tests/` 确有 32 个 spec 文件 |
| `GATES.md` 历史失败 | “修复前 83/85，首败保留” | **保留且不覆盖**：`final-e2e-5411.log` = `2 failed / 83 passed (7.9m)`，两条失败正是文档所述：① `ai-native-world.spec.ts`（已知 flake，`retry-ai-native-world.log` 隔离复跑 `1 passed`）② `c3c-headless-parity.spec.ts`（夹具缓存，`RED-world-sim-cache.log` 为最小复现，失败信息 `next world.sim sees the spawned drone`） |
| `GATES.md` #9/#10 | RED→GREEN | **真实**：RED 1 failed（同上错误串），GREEN 1 passed；我的独立复跑也 1 passed |
| `GATES.md` #11/#12 | c3c 导出 + Node 16 门 | **真实**：`GREEN-c3c-parity-export.log` 1 passed；`GREEN-c3c-node-parity-final.log` 16 条 PASS 但 `finalTick=25`（**重生成前**的夹具）；真正对得上提交内夹具的是 `POSTFIX-c3c-node-parity.log`（16 条 PASS、`finalTick=26`）。两阶段都在，没有把旧结果冒充新结果 |
| `GATES.md` #13/#14 | boss-room / canvas 在 5411 且未动 5173/5199 | **一致**：两日志各 1 passed；`5173`/`5199` 的监听者确为仓库自身 dev server（PID 22692/23920），与文档描述一致 |
| `GATES.md` #1–#3、#5–#8、#19、#20 | typecheck/build/mcp/F-03/三个 smoke/secret/清理 | **字符串与日志逐条对上**：`F03_PRODUCTION_GATE_PASS`、`WORLD_MCP_SMOKE_PASS`、`HEADLESS_MCP_SMOKE_PASS`、`COMPANION_CONSOLE_SMOKE_OK`、`built in 8.32s`/`1.13s`；`fix-dev-cleanup.log` 末尾 `PORT_5411_FREE` |
| `PHASE-CLOSURE.md` | 验收映射、`c2a31af` 为 Task C 双复核基线、`d1f29d1` 仅缓存/PORT、NOT RUN 四条真人项 | **口径正确**：与我这轮及前几轮的复核结论一致（Task C 已知阻断已闭环；真人验收未发生）；引用的 `reports/ai-native-02/signal-fix/FIX-REPORT-5.md` 确实存在 |
| `PR-DRAFT.md` | 标题/摘要/hash/branch/origin-main/“未合并未 push 未建 PR”/review focus | **一致**：hash、tree、分支、main sha 与 git 实际值相同；未合并未 push 属实；review focus 三条（origin 唯一产出、人类 R 全局、stale 需显式世代+房号）正好对应 `c2a31af` 的实际实现 |
| `NON-BLOCKING-LIMITS.md` | 限制清单 | 与我历轮记录的同名限制一致（含 receipt 语义、parity 未覆盖 origin 等） |

> 我**没有**重跑全量单测与全量 E2E（按指令避免双倍与 CPU 饥饿）：743/743 与 88/88 属于**日志真实性审核**，不是我这轮的实跑结论；我自己实跑的是 tsc、cache spec、boss-room、canvas 与 c3c Node 门。

## 4) 边界确认

- `git status --porcelain -uno` = **0 行**（审查前后均为 0，我未改任何 tracked 文件；我唯一新增的是本报告目录，untracked）。
- `main` 不是 HEAD 的 ancestor（`git merge-base --is-ancestor main HEAD` = NO）→ **未合并**；无 push、无 PR（`origin/main` 仍为 `c221551…`）。
- 旧模型/失败证据目录未动（`lead-*`、`RED-*`、`final-e2e-5411.log` 等）；tracked 的 `reports/ai-native-02/c3c/parity/rendered.json` 我只读、未写。
- 端口：只启动/清理了我自己的 5535；5173/5199 的进程在审查前后都在（未被我触碰）。

## 5) 可交付结论与真人验收限制

**可交付（代码层面）**
- `d1f29d1` 与 tree `aff2506…` 冻结一致（2049 文件逐 blob 校验）；补丁只做缓存失效 + 端口参数化 + 一条新回归 spec + 重生成 c3c 夹具。
- 缓存失效语义正确且被真实 UI 覆盖（旧快照冻结、新快照=canonical live、真实 tick 一致）；queued 路径与直接路径无重复实体。
- 前端/协议/权限面在本补丁内零改动，因此前序 `c2a31af` 的双复核结论继续有效（我不重开 Signal/架构）。
- 交付文档的数字与实际日志/哈希一致，历史失败保留、未被覆盖或美化。

**真人验收仍为 NOT RUN（不可由代码关闭）**
1. 真人 Owner CONFIRM / AUTHORIZE（现有全部为 UI 自动点击夹具与自动化点击）。
2. 真人从 NEW RUN 完整试玩 Player / ECHO / Signal 链路。
3. 真人跨房操作（人类 R 已有真实浏览器自动化覆盖，但无真人录像/签字）。
4. 真人可读性/理解验收（五视口、HUD 文案）。

**已知非阻断限制（不扩张，仅记录）**
1. c3c Node 门依赖 untracked `initial.json`，干净 clone 需先重跑导出。
2. Companion 被 core 拒绝的 toggle 仍会产生 `applied` 收据（“投递确认”语义，且该分支不发事件 → 无痕迹），与 scan 越界同源，属既有语义。
3. rendered parity 的 `sequence` 未记录 `originRoomId`；当前 parity 场景用直发 enqueue（无 origin）故不受影响。
4. 历史 flake（`ai-native-world.spec.ts` 死亡结算）以隔离复跑记录，未做稳定性量化。
