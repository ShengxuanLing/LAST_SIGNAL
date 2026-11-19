# AI-NATIVE-02 C2 回归闭环最终独立验收（ae72a67）

- Worker `y6en9ua8phanll8cqi8dd8ru`，专属目录 `reports/ai-native-02/tester/c2-closure-final/`
- 目标冻结：`ae72a67f92c5c9c5ebde9f4163db086911a3106e`（父 `a1d07f7570a92a76061b13024fc063c9a5b8d29d`）；链上代码提交 `c2b0215`→`6eb2ba0`→`3a28d4f`→`a1d07f7`→`ae72a67`
- 隔离：`git archive ae72a67` → `D:/Project/AI-NATIVE-02-snapshots/ae72a67`（全文件哈希见 `00-frozen-state.log`，首尾一致 `15-final-state.log`）；专属 dev 端口 **5294**（自启自停）；未切分支、未改源码/测试/配置、未读 WIP/stash。
- 结论：**我归因的原 5 个失败已独立关闭**；但 **C2 仍不可放行**：Reviewer 的 `onResume()` 强制 +1 tick 已被我独立复现（resume 时间不正确），且 `economy` storage 不可用重试用例已从冻结目标删除（覆盖缺口）。C3b 仍冻结。

## 1. Gate 一行式

- PASS `npx tsc --noEmit`（快照）退出码 0 → `01-typecheck.log`
- PASS `npm test`（快照）**26 files / 429 tests** → `02-unit.log`
- PASS `npx vite build --outDir …/c2-closure-final/frozen-dist` 16.00s → `03-build.log`
- PASS `npm run game:mcp:build`（301.22 kB）→ `03b-mcp-build.log`
- PASS default StationZero MCP smoke = 6 Player 工具 → `04-mcp-smoke.log`
- PASS `PORT=5294 npx playwright test <12 PORT-aware spec files> --workers=1` → **46 passed / 1 failed（5.0m）** → `05-portaware-47.log`
- PASS `scripts/c2-node-parity` 8/8、`scripts/c2-kill-parity` 13/13、`scripts/c2-loot-pickup-parity` 全过、`scripts/c2-room-generation-parity` **C1_ROOM_PARITY_PASS seeds=220 kinds=drone,hunter,sentinel,stalker** → `07-node-parity-scripts.log`
- PASS（负向对照）篡改 kill-rendered xp → `FAIL xp-equals-rendered`、退出码 1 → `14-kill-negative.log`
- PASS（负向对照）ledger 校验：合法/legacy/good 接受；oversized/duplicate/invalid/non-array 拒绝 → `13-negative-controls.log`
- PASS `node probe-ledger-node.ts`（硬配额 64/重复/非法/canonical）→ `08-ledger-node-probe.log`
- PASS `node probe-supply-purchase.mjs`（购买提交/退出重开不重扣/pause-resume）→ `11-supply-purchase.log`
- PASS `node probe-forced-tick.mjs`（onResume 强制 tick + pending 提交 + 升级落盘）→ `10-forced-tick.log`
- PASS `node probe-closure-smoke.mjs`（无夹具接管/暂停零 dt/远近掉落）→ `09-closure-smoke.log`
- PASS `node probe-cli-coldstart.mjs` 3/3 冷启动 → `12-cli-coldstart.log`

### 全量 E2E 49 说明（不冒充全量）
冻结目标 14 文件共 49 项。`tests/canvas.spec.ts`(5199) 与 `tests/boss-room.spec.ts`(5173) 硬编码端口，而 5173/5199 由其他 Worker 的进程占用（PID 22692/23920），无法在不干扰他人的前提下用快照同源码服务接管。**因此本轮只跑 12 文件 47 项 PORT-aware 用例，明确排除 canvas/boss-room，不宣称“全量 49 通过”**。47 项结果：**46 通过 / 1 失败**，唯一失败是 `tests/vs01.spec.ts:131`（Station Zero 切片路由精确坐标断言：一次 `≤2.6` 收到 2.7，一次 `y=10.5` 收到 10.6；复跑 1 次通过、1 次失败 → flaky）。`c2b0215..ae72a67` 未改 `src/slice/` 或 `station-zero.*`，该 flaky 与 C2 无关。

## 2. 原 5 失败复验：全部关闭

| 原失败 | 结果 | 证据 |
| --- | --- | --- |
| `audit.spec.ts:65` 升级数量 | **PASS**（46 项中通过） | `05-portaware-47.log` [10/47] |
| `checkpoint.spec.ts:61` 装备标签 | **PASS** | 同 log [21/47] |
| `checkpoint.spec.ts:140` 升级落盘 | **PASS** | 同 log [22/47] |
| `checkpoint.spec.ts:185` 升级持久/续局 | **PASS** | 同 log [24/47] |
| `economy.spec.ts:11` 清怪+奖励数学 | **PASS** | 同 log [26/47] |
| `purchase-ledger.spec.ts` 新用例 | **PASS** | 同 log [28/47] |

- 升级条目落盘独立复核（`10-forced-tick.log`）：选卡后 live `player.data.upgrades=[{key:'critical',level:1}]`，poll 下一拍 save `run.player.upgrades` 同步出现该条目；i=0 时 `captureCheckpoint=false`（`hasUncommittedCommands()=true`），i=1 时 `uncommitted=false` 且 capture 成功 → 提交屏障生效。
- economy 独立复核：房间在敌人生成前不再被标记 cleared（`c2b0215` 修复）；economy 用例现在真正清怪 + 已知 82 掉落基线，奖励数学 `82+reward-16/-40/-28` 精确断言通过。

## 3. Ledger 与购买事务（独立证据）

- Node `probe-ledger-node.ts`（真实 map/seed）：首购 `repair` ok（currency 1000→984、hp 50→85、ledger=1）；同 tx 重放 → `Duplicate transaction`、currency 不变、ledger 不变；非法 tx → `Invalid transaction id` 且不入账；填满 **PURCHASE_LEDGER_CAP=64** 后新 tx → `Supply ledger full`、ledger 仍 64、首条 `tx-alpha-0001` **从未被驱逐**；canonical 含 `purchaseTransactions`。
- 浏览器 `probe-supply-purchase.mjs`（economy.html；夹具：按测试同法清怪以获得安全终端，已声明）：真实点购买 → 排队 `purchase-supply` 时**尚未扣款**；关闭终端（resume）后 `currency 94→66`（calibration 28）、ledger 1、receipt `Purchased Weapon calibration.`；checkpoint 含 `coreState.purchaseTransactions`；**reload + CONTINUE 后 currency 仍 66（不重扣）、ledger 恢复 1**；随后 pause/resume 不改变 currency/ledger。
- 负向：ledger 校验对 oversized/duplicate/invalid/non-array 全部拒绝；kill parity 篡改后 `xp-equals-rendered` FAIL、退出码 1 → 检查非空。

## 4. Reviewer `onResume` 强制 tick：独立复现（阻断）

`probe-forced-tick.mjs` 直接调用产品真实回调 `GameScene.onResume()`（PauseScene 关闭即走该路径），隔离真实 delta：

| 场景 | 暂停时长 | accumulator | before→after | 强制增量 |
| --- | --- | --- | --- | --- |
| onResume #1 | 0ms | 0 | 76→77 | **+1** |
| onResume #2 | 1200ms | 0 | 77→78 | **+1** |
| onResume #3 | 300ms | 250 | 78→79 | **+1** |

- `onResume()` 内 `resetSimulationAccumulator(); stepFrame(1000/60+1e-6, neutral)`，与真实 delta/accumulator 无关，**每次 resume 固定多推进 1 tick**；`onLevelUpClosed()`（GameScene.ts:536-537）同代码路径。
- 影响：resume 后的仿真时间不正确（与真实暂停时长无关地 +1 tick）；暂停期间排队命令会在这条强制 tick 提交（`probe-forced-tick`：paused 时 `enqueueCurrency(50)` 后 onResume 一次提交、下一次 tick 不重复），但代价是时间步进错误。
- 测试遮蔽：`audit.spec.ts`/`checkpoint.spec.ts` 等在关闭 overlay 后**手动调用 `world.stepFrame(...)` 提交命令**，掩盖了产品自身强制 tick 的行为；不能以 46/47 绿灯外推 resume 时间正确。
- 结论：**Reviewer 阻断成立，C2 不可放行**；需去掉强制 tick，改为让命令在真实 tick 提交（或只在 accumulator 足够时提交），并补 resume 时间语义回归。

## 5. 其他定向结论

- **economy storage 不可用重试用例被删（覆盖缺口）**：`59aa852` 的 `economy.spec.ts` 含 `Storage.prototype.setItem` 抛错 → `Purchase could not be saved. Your credits were kept.` → 恢复后重试的用例；在 `c2b0215`/`ae72a67` 版本中该段被整段删除（`git diff` 证据）。本轮冻结目标已无该回归，属覆盖缺口，需补回（不代开发者修改）。
- **无夹具短 smoke**（`09-closure-smoke.log`）：真实菜单 NEW RUN → 真实暂停菜单 AI CONTROL → `owner=ai/ENGAGE` → 真实 `KeyD` 夺回 human；暂停时 enqueue 只入队、`stepFrame(0)` 0 事件 0 提交、一 tick 才提交；运行中掉落 20/40/85 格**均未被磁吸拾取**（`dist=20/19.71/19.56`，currency 不变），5 格**被拾取**（currency +10）→ D 缺陷已修；升级 live+save 均记录（见 §2）。
- **CLI 冷启动**（`12-cli-coldstart.log`）：3 次冷启动就绪 3.44/3.44/3.45s，`create/observe/quit` 均 ok，quit 后 21/24/28ms 退出、exit 0。
- **五视口**：dev P1 产出的 5 张 HUD 图；实际打开查看 `hud-ai-800x600.png`（scale 0.625，最小物理字高 10.625px）与 `hud-ai-1024x768.png`（0.8，13.6px）——控制列 4 行与左下提示可读、无裁切/遮挡；1920x1080(1.5)、1366x768(1.067)、1280x720(1) 数值亦在 `operation-log-hud-*.json`。

## 6. 放行判定与限制

| 项 | 判定 |
| --- | --- |
| 原 5 失败 + purchase-ledger 新用例 | **关闭**（独立复验通过） |
| 旧 ledger/房间/升级/loot 阻断 | 关闭（与 Reviewer 一致）：room220、kill13、node8、loot parity、ledger 硬配额与负向均通过 |
| **C2 整体放行** | **不放行**：`onResume()`/`onLevelUpClosed()` 强制 +1 tick 与真实 delta 无关（独立复现），resume 时间语义错误；economy storage 失败重试用例缺失 |
| C3b | 仍冻结，不接线 |
| 证据性质 | 本轮全部为自动化测试/探针；夹具：economy 清怪、`simFixture` dev-only 读取、seed 注入等均已在日志声明；非 Agent/真人证据 |
| 未覆盖 | 全量 49（排除硬编码 canvas/boss-room 2 项）；`vs01:131` 为无关 legacy slice flaky（1 通过 1 失败），未计入 C2 结论 |

## 7. 复现

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse ae72a67                     # ae72a67f92c5c9c5ebde9f4163db086911a3106e
git archive ae72a67 | tar -x -C D:/Project/AI-NATIVE-02-snapshots/ae72a67
# node_modules junction; 5294 dev server (strictPort)
npx tsc --noEmit && npm test
npx vite build --outDir ".../c2-closure-final/frozen-dist" --emptyOutDir
PORT=5294 npx playwright test tests/audit.spec.ts tests/c2-parity.spec.ts tests/checkpoint.spec.ts \
  tests/economy.spec.ts tests/gameplay.spec.ts tests/purchase-ledger.spec.ts tests/runtime-bugs.spec.ts \
  tests/supply-transaction.spec.ts tests/vs00.spec.ts tests/vs01.spec.ts tests/whale-character.spec.ts \
  tests/ai-native-world.spec.ts --workers=1
npx vite-node scripts/c2-node-parity.ts && npx vite-node scripts/c2-kill-parity.ts \
  && npx vite-node scripts/c2-loot-pickup-parity.ts && npx vite-node scripts/c2-room-generation-parity.ts
# 探针：probe-ledger-node.ts（cp 到快照根）、probe-supply-purchase / probe-forced-tick /
# probe-closure-smoke / probe-cli-coldstart（仓库根，BASE=http://localhost:5294/）
```
