# `d1f29d1` 最终缓存修复 + 两未跑 spec 独立定向验收

**结论：PASS（精确 scope）。** `World.sim` 缓存修复经独立自跑确认（新 `world-sim-cache` 1 例 + Boss 直接 spawn 最小补证）；两未跑 spec（`boss-room`、`canvas`）在自有 PORT 真实运行通过并实看截图；c3c parity 新导出 → Node 16 门重放证明 kill/loot/events。**已知功能阻断已清零；真人最终验收 NOT RUN（未做）。** 开发者 `final-e2e-5411-fixed.log` 88/88 与 `fix-final-unit.log` 743/743 为只读审核，非本轮自跑。

## 冻结

- 目标：`d1f29d1aa25ecf0fb461e756948de979019b3a26`（父 `c2a31af609b8305ce5917d88d0a425a4af24a29c`）
- `git archive d1f29d1 | tar -x` → `D:/Project/AI-NATIVE-02-snapshots/d1f29d1`；**2049 文件**
- **tracked blob 比对**：mismatch=0 / 2049；二次解包 diff=0；全量 sha256
- 未改源码/测试/配置/分支，未 merge/push/reset；旧证据不覆盖。自有 dev strictPort **5392**（未用开发者 5411，未动 5173/5199），用完仅清自身；secret 零日志/URL/截图；仓库 tracked evidence（`reports/ai-native-02/c3c/parity/`）未动（导出在快照内）。

## 自跑门禁逐行（`gate-summary.log` 上半部）

| 门 | 命令 | 结果 |
|---|---|---|
| 冻结+tracked blob | `git archive d1f29d1` + `git hash-object` vs `git ls-tree` | 2049 mismatch=0, diff=0 |
| typecheck | `npx tsc --noEmit` | 0 |
| **新 world-sim-cache（1）** | `PORT=5392 playwright test tests/world-sim-cache.spec.ts` | **1 passed** |
| **Boss 直接 spawn 补证（spec 未覆盖 Boss）** | `vite-node probe-boss-cache.mts` | **4/4 PASS** |
| **boss-room（自有 PORT）** | `PORT=5392 LS_SHOT_DIR=... playwright test tests/boss-room.spec.ts` | **1 passed**（实看截图） |
| **canvas（自有 PORT）** | `PORT=5392 playwright test tests/canvas.spec.ts` | **1 passed** |
| **c3c parity 新导出** | `PORT=5392 playwright test tests/c3c-headless-parity.spec.ts` | **1 passed**（快照三件套 08:02 重生） |
| **c3c Node 16 门重放** | `vite-node scripts/c3c-rendered-headless-parity.mts` | **PASS 16/16**：`C3C_RENDERED_HEADLESS_PARITY_PASS finalTick=27 events=59 kills=1 lootLeft=0 currency=4 xp=8` |
| secret 扫描 + 自身清理 | grep 真实 token/ownerKey/cap；只清 5392 | 0 命中；5392 不在监听；5173/5199 未动 |

### 缓存修复细节

- 根因：`World.sim` 是缓存冻结快照（`World.ts` getter），`bumpSimVersion()` 是唯一失效器；`spawnEnemy`/`spawnBoss` 直接写 core 但原先未 bump，导致预热后新 spawn 在下一帧前不可见。
- `d1f29d1` 在两个直接 spawn 分支调用 `bumpSimVersion()`；回归 spec 不读 `_sim`，用公开 `world.sim` 断言。
- **spec 覆盖**：`spawnEnemy(drone)` → 预热后新 `world.sim` 含真实 drone id、旧快照冻结不变、最新快照=canonical live、真实 tick 同步（1 passed）。
- **Boss 补证（spec 只测 drone）**：`probe-boss-cache.mts`（真实浏览器 + 公开 snapshot）4/4：warm `w.sim` 冻结且无 boss target → `w.spawnBoss(room)` → 新 `w.sim` 为新对象且含真实 boss target（id=`w.boss._id`, isBoss）、旧快照 target/drone 数不变且仍冻结 → `w.stepFrame` 后 tick>0 且快照仍含 boss、events 为数组。

### 两未跑 spec 实跑

- **boss-room**：自有 5392 真实加载，截图 `evidence/boss-room/boss-room.png` 显示 `★ THE WARDEN – PHASE 1 ★`、`BOSS ROOM`、`HOSTILES 1`、玩家与 Boss sprite、相机/抖动正常；非误连他人进程（PORT=5392 显式指定，5173/5199 未动）。
- **canvas**：自有 5392 真实 HUD，输出真实值 `HUD {"zoom":0.8,"hp":722,"xp":393,"credits":219,"level":147,"timer":81,"hpBar":1248,"weapon":256,"room":246,"enemies":369,"stats":888}`，通过。

### c3c parity（新导出 → Node 16 门）

快照内重新运行 `tests/c3c-headless-parity.spec.ts` 生成 `initial.json`/`sequence.json`/`rendered.json`（08:02），随后 `scripts/c3c-rendered-headless-parity.mts` 重放：`real-kill-event` / `real-loot-drop` / `real-loot-pickup` / `real-combat-events` 均 PASS，最终 `C3C_RENDERED_HEADLESS_PARITY_PASS finalTick=27 events=59 kills=1 lootLeft=0 currency=4 xp=8`（16/16）。

## 只读审核（开发者日志，非本轮自跑）

| 项 | 内容 | 路径 |
|---|---|---|
| 最终 E2E | `final-e2e-5411-fixed.log` → **88 passed (8.0m)**（32 spec，自有 5411，首跑即绿；含 `ok 88 world-sim-cache`） | `reports/ai-native-02/final-delivery/final-e2e-5411-fixed.log` |
| 全量单测 | `fix-final-unit.log` → **Test Files 64 passed / Tests 743 passed** | `reports/ai-native-02/final-delivery/fix-final-unit.log` |
| GATES | `GATES.md` 20/20 PASS（含 RED→GREEN world-sim-cache、c3c Node 16/16、boss-room/canvas PORT 5411） | `reports/ai-native-02/final-delivery/GATES.md` |
| DEMO 三入口 | `DEMO.md`：A 正式 World AI/人类接管；B Headless Player MCP；C ECHO Companion+Signal opt-in/授权/建议/Owner 确认/开门。步骤可执行；入口文件 `worldHeadlessMcpSmoke.mts`/`c3b-bridge.mts`/`companionMcpServer.ts`/`mcpServer.ts` 存在，`dev`/`game:mcp:build`/`game:world:bridge`/`game:world` 脚本存在 | `reports/ai-native-02/final-delivery/DEMO.md` |

（注意：上述 88/88 与 743/743 是开发者日志只读核对，**不是**本轮 Tester 重跑；本轮只跑了新增/未跑最小集。）

## 已知功能阻断是否清零

**已清零（Task C 已知功能阻断）**，依据：
- 开发者 `PHASE-CLOSURE.md` 2.1 列出已关闭：旧房建议执行、notify in-flight、echo portal migration、memory/availability、房间世代、stale applied、人类 R 跨房控制。
- 本轮独立自跑确认最终缓存修复（`world-sim-cache` + Boss 补证）与两未跑 spec、c3c Node 16 门；前序 c2a31af 已由 Tester 独立复验（人类 R 恢复 + Companion 旧房 toggle 拒绝）。
- 非阻断限制（`NON-BLOCKING-LIMITS.md`）：toggle 被拒无事件痕迹（可观测性）、receipts 表达投递非物理、parity 未覆盖 originRoomId、Signal 多 seed 无独立浏览器门禁、`ai-native-world` 死亡结算已知 flake、单机单平台、非 drone legacy FSM 未迁 Headless 等——均为**已定界非阻断**，未在本轮扩大。

## 真人确认（NOT RUN）

- **真人最终验收未发生**：现有模型证据的 Owner CONFIRM/AUTHORIZE 均为 UI 自动点击夹具，不是真人验收。
- 真人完整试玩（Player/ECHO/Signal 全链）、真人跨房操作录像、真人可读性/理解签字均 **NOT RUN**。
- 模型证据范围保持原样（`lead-live` 单 drone、`lead-headless-cropped` 最小 drone、`lead-echo-model-live` 两轮 fire、`lead-signal-model-live` scan/toggle 最小回合，未覆盖 jam）；不要求新模型/完整 Run。

## 精确可放行 scope

- **可放行**：`World.sim` 缓存失效（spawnEnemy/spawnBoss，旧快照冻结、真实 tick 一致）；新 `world-sim-cache` 1 例；Boss 直接 spawn 补证 4/4；`boss-room`/`canvas` 自有 PORT 真实运行 1/1（截图实看）；c3c parity 新导出 + Node 16 门（kill/loot/events）；typecheck。开发者 88/88 与 743/743 仅作只读日志核对。**已知功能阻断清零。**
- **NOT RUN / 待用户**：真人 Owner 最终确认、真人完整试玩、真人跨房录像、真人可读性签字。这不阻塞自动化交付结论，但真人验收未做必须如实标注。

## 路径

`reports/ai-native-02/tester/final-delivery/`
`00-freeze.log` / `00-all-files.sha256` / `00-archive-diff.log` / `00-tracked-hash-check.log` / `01-typecheck.log` / `02-world-sim-cache.log` / `03-boss-room.log` / `04-canvas.log` / `05-boss-cache.json` / `06-boss-cache.log` / `07-c3c-parity-export.log` / `08-c3c-node-parity.log` / `gate-summary.log` / `evidence/boss-room/boss-room.png` / `evidence/boss-cache.png` / `probe-boss-cache.mts`
（开发者只读日志：`reports/ai-native-02/final-delivery/{final-e2e-5411-fixed.log, fix-final-unit.log, GATES.md, DEMO.md, PHASE-CLOSURE.md, NON-BLOCKING-LIMITS.md}`）
