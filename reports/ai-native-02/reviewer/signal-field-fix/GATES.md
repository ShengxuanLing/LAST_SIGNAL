# 门禁逐行 — 246469b 现场修复最小补丁（独立复核）

被测：`246469b7d7e82bb469f62f80f293b0702af46588`（父 `363eb173207bb5adaa0a21cd1af348dc92f29827`）
隔离快照：`D:\review-fix\snap`（`git archive 246469b`，2043 tracked，blob 比对 diff=0）
本目录：`D:\Project\LAST_SIGNAL\reports\ai-native-02\reviewer\signal-field-fix\`
环境：自有 dev `strictPort 5372`（Playwright spec 用 `PORT=5372`），用完仅关自己的 vite 进程；5173 等他人端口未动

| # | 结论 | 门禁 | 实际命令 | 结果 | 日志（绝对路径） |
|---|---|---|---|---|---|
| 1 | **PASS** | 目标 hash 解析 + 父提交 | `git rev-parse 246469b; git rev-parse 246469b^` | `246469b7d7e82bb469f62f80f293b0702af46588`，父 `363eb17…` | `…\reviewer\signal-field-fix\logs\gate-typecheck.log` 同批命令 |
| 2 | **PASS** | 隔离快照 = 提交（逐 blob） | `git archive 246469b \| tar -x`；`git ls-tree -r 246469b` vs 快照内 `git hash-object` 全量 | 2043 文件，**diff 0 行** | `…\tracked-blobs-246469b.txt`、`…\tracked-blobs-snapshot.txt` |
| 3 | **PASS** | 类型检查（快照全仓） | `npx tsc --noEmit` | exit 0，无输出（0 字节） | `…\logs\gate-typecheck.log` |
| 4 | **PASS** | MCP 服务端构建 | `npx vite build --config vite.mcp.config.ts` | exit 0，built in 1.25s | `…\logs\gate-mcp-build.log` |
| 5 | **PASS** | 新增 unit（迁移/残敌/诚实性） | `npx vitest run src/world/sim/echoRoomTransition.test.ts src/world/sim/targetRemoval.test.ts src/ai-native/companionInsights.test.ts` | **14/14 passed**（3+2+9），3 文件 | `…\logs\gate-new-units.log` |
| 6 | **PASS** | Owner/权限最小回归 | `npx vitest run ownerAuth companionBridge worldBridgeServer companionGateway companionFacet` | **45/45 passed**（5 文件，含 ownerAuth C1–C8） | `…\logs\gate-owner-auth-regression.log` |
| 7 | **PASS** | 新 portal E2E（含负向控制） | `PORT=5372 npx playwright test tests/echo-portal-migration.spec.ts --project chromium` | **2 passed**（3.8s / 2.8s） | `…\logs\gate-portal-e2e.log` |
| 8 | **PASS** | 合作链 E2E（10 步，回归） | `PORT=5372 npx playwright test tests/signal-coop-e2e.spec.ts --project chromium` | 1 passed（11.4s），STEP1–10 全过，room 3→5 | `…\logs\gate-coop-e2e.log` |
| 9 | **PASS** | 官方 SDK 权限矩阵（回归） | `PORT=5372 npx playwright test tests/signal-sdk-negative.spec.ts --project chromium` | 1 passed（10.7s） | `…\logs\gate-sdk-matrix.log` |
| 10 | **PASS** | 跨端新导出 | `PORT=5372 npx playwright test tests/signal-rendered-parity.spec.ts --project chromium` | 1 passed；三件套重生（2,431,934 / 80,749 / 108,312 B） | `…\logs\gate-parity-export.log` |
| 11 | **PASS** | 跨端重放（字节级硬门禁） | `npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts` | **3/3 passed**（state+events 逐字节、actor 分歧负向、缺文件必红） | `…\logs\gate-parity-replay.log` |
| 12 | **FAIL（产品缺口，阻断）** | 跨房未确认建议是否失效（我的 Node 机制探针） | `npx vitest run src/zz-probe/crossRoomStale.probe.test.ts`（快照内探针，非冻结文件） | 探针**通过**＝缺口**被证实**：迁移后新观察已无 relay（`availableActions.scan=out_of_range`），旧 `scan` 建议仍在 `pending`，`decide(confirm,tick=140)` 返回 **ok / decidedAtTick=140** | `…\logs\probe-cross-room-stale-nodelevel.log`（探针源码 `…\crossRoomStale.probe.test.ts`） |
| 13 | **FAIL（同缺口，Tester 浏览器证据，我核对原始文件）** | 跨房旧建议真实执行 | `cat reports/ai-native-02/tester/signal-field-fix/11-cross-room-suggestion.json 12-cross-room-suggestion.log` | X07 FAIL：`decided=true`、旧目标 `{10,45}`、过门后 `projectiles=1`、`roomId=3`、`staleApplied=true` | `D:\Project\LAST_SIGNAL\reports\ai-native-02\tester\signal-field-fix\12-cross-room-suggestion.log` |
| 14 | **PASS（源码级）** | 缺口根因定位 | 读 `src/world/World.ts:946-952`、`src/ai-native/companionGateway.ts:226-250`、`companionFacet.ts:468-490`、`GameScene.ts:930-936` | World 只清本地 controller/`pendingCompanionIntent`；gateway 作废路径仅 link/mode/epoch/TTL；`decide()` 不重校验 reason 与当前观察；`apply()` 直接 `enqueueCompanionAction` | 源码（`D:\review-fix\snap`，与 #2 快照同 hash） |
| 15 | **PASS（源码级）** | 无 flag 不搬 / 唯一 true 调用点 | `grep -rn "enqueueTeleport\|teleport-player" src` | 仅 3 个产出点：`Player.ensureWalkable`(false)、`Player.reset`(false)、portal(`true,true`, `World.ts:952`) | 同上 |
| 16 | **PASS（源码级）** | 落点可行走 + 确定性 | 读 `core.ts:595-605`、`ensureWalkableFromState`(780-797)、`tileAtFromState`(771-777) | `x+1` 起点 + 确定性螺旋回退（wall/lava/water，半径 0.5，最多 6 格），无 RNG；`state.map` 为全局网格（`mapMinX/mapMinY`），目标房坐标可判定 | 同上 |
| 17 | **PASS（源码级）** | `echo-moved` 事件形状一致 | 读 `core.ts:192` 与 `602-604` | `{actorId, position, velocity, dashTimer, dashStarted}` 逐字段一致 | 同上 |
| 18 | **PASS（源码级）** | dead echo / 缺 echo 不迁移 | 读 `core.ts:595` | `command.migrateEcho === true && state.echo && state.echo.data.hp > 0` → 两者都短路跳过（**冻结提交无对应单测，覆盖缺口**） | 同上 |
| 19 | **PASS** | memory 分型（target≠relay） | 读 `companionFacet.ts:522-528` + `gate-new-units.log` | `kind:'target'`（id `target_<id>_<kind>`）、`'relay'` 仅设备；原错误断言已改正 | `…\logs\gate-new-units.log` |
| 20 | **PASS** | availableActions 半径/能量/CD 与核心一致 | 读 `companionFacet.ts:51-83` vs `signalTuning.ts`/`signalCore.scanBlocker/jamBlocker` | 半径 `<12` / `<6` 严格一致；`< SCAN_COST`、`< JAM_COST`；`scanTicks>0`/`jamTicks>0` → `cooldown`；relay 为合法主体；旧观测（无 energy/cooldowns）退回距离判定 | `…\logs\gate-new-units.log`（含 back-compat 用例） |
| 21 | **PASS** | 残敌分类（真实死亡 vs 夹具删 canonical） | 读 `targetRemoval.test.ts`（2 例）+ 结果 | `hp<=0` 的 target 下一 tick 从 `state.targets` 移除；**活着的 target 不被移除** → 旧“只清渲染层”的夹具残留定性成立 | `…\logs\gate-new-units.log` |
| 22 | **PASS（设计确认）** | 设备是否留原房 | `grep -rn "teleport.*signal\|signal.*teleport" src`；读 `World.ts:779-791` | 无设备迁移代码；`signalDeviceSpawned` 保证一局一设备；`exitOpen` 只取决于该设备状态（全局）→ 留原房是设计；跨房后 echo 不再感知 relay，Signal 建议自然失效（诚实裁剪） | 源码（同 #2 快照） |
| 23 | **NOT RUN（脚本 bug，按指令不循环）** | 我自己的浏览器级跨房探针（scan+toggle 两种 stale） | `PORT=5372 npx playwright test tests/zz-reviewer-stale-suggestion.spec.ts` | 20s 超时于 `waitForFunction(relay==='ACTIVE')`——我忘了在授权后关闭 Pause 再 `toggleRelay`（世界 tick 冻结）；机制证据已由 #12 + #13 覆盖 | `…\logs\probe-cross-room-stale-browser-NOTRUN.log`（源码 `…\zz-reviewer-stale-suggestion.spec.ts.NOTRUN`） |
| 24 | **NOT RUN（按指令不重复无关全量）** | 全量单测 / C2 resume / checkpoint / CD 恢复 / 截图逐张 | — | Tester 报告：727/727、resume 3、checkpoint 1、CD 恢复 5/5；我不重跑 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\tester\signal-field-fix\` |

## 失败行（最相关错误）

1. **#12 我的 Node 探针（缺口被证实）**：`expect(decided.ok).toBe(true)` 通过 → 说明 `decide()` 对已不再被观察的建议返回 ok；日志中最相关输出：`Tests 1 passed (1)`（探针设计为“通过即证实缺口”）。
2. **#13 Tester X07（真实浏览器）**：`FAIL | X07 NEGATIVE: old unconfirmed suggestion cannot mis-execute after portal`，最相关字段：
   `"decideResult":{"found":true,"decided":true,"error":"","kind":"fire","target":{"x":10,"y":45}} … "projectiles":1 … "staleApplied":true`
3. **#23 我的浏览器探针**：`TimeoutError: page.waitForFunction: Timeout 20000ms exceeded`，最相关行：`zz-reviewer-stale-suggestion.spec.ts:176`（授权后未关 Pause 即 `toggleRelay(true)`，属我脚本缺陷，非产品）。
