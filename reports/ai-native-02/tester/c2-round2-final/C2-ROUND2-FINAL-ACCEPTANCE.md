# AI-NATIVE-02 C2 第二轮事务修复独立验收（0df1514）

- Worker `y6en9ua8phanll8cqi8dd8ru`，专属目录 `reports/ai-native-02/tester/c2-round2-final/`
- 目标冻结提交：`0df1514103f796c361fe1a1bf1985e6c2205f1a1`（父 `a53bfa7036b2f491e354565f53ffcb8e36c40318`），分支 `feat/ai-native-world-integration`
- 隔离：`git archive 0df1514` → `D:/Project/AI-NATIVE-02-snapshots/0df1514`（仅已跟踪文件 + `node_modules` junction）；dev 5287 / preview 5288 均为我自启、自停；探针只写本报告目录。未切共享分支、未改源码/测试/配置；**`stash@{0}`、`stash@{1}` 均未读未恢复**。
- 结论：**本单测试范围内的 C2 第二轮目标契约 PASS（原门保留）；但独立复现了 Reviewer round3 的 4 类事务权威冲突（见 §10），因此不能据此宣布 C2 整体通过，也不能开始 C3b 接线**。C2 最终架构判定仍由 Reviewer 独立负责；本报告不外推整体 C2 通过，也不代表 World/Agent 端到端。P1 生产 preview 有 1 项因 H9 dev/test-only helper 门禁失败，dev server 9/9 PASS（测试环境限制，见 §1 注）。

---

## 1. Gate 一行式（完整输出在 `c2-round2-final/`）

- PASS `npx tsc --noEmit`（快照）退出码 0 → `01-typecheck.log`
- PASS `npm test`（快照）**24 files / 396 tests** → `02-unit.log`
- PASS `npx vite build --outDir …/c2-round2-final/frozen-dist` 13.98s（保留基线 500kB chunk 警告）→ `03-build.log`
- PASS `npm run game:mcp:build`（301.22 kB）→ `03b-mcp-build.log`
- PASS default StationZero MCP smoke：`initialize` + `tools/list` = **6 个 Player 工具** → `04-mcp-smoke.log`
- PASS `PORT=5287 npx playwright test tests/c2-parity.spec.ts --workers=1` → **8 passed (39.9s)** → `05-c2-parity-spec.log`
- PASS `npx vite-node scripts/c2-node-parity.ts` → **8/8** → `06-node-parity.log`
- PASS `npx vite-node scripts/c2-kill-parity.ts` → **13/13** → `07-kill-parity.log`
- PASS（负向对照，预期失败）篡改 rendered XP +1 后 `c2-kill-parity` → `FAIL xp-equals-rendered`、退出码 1 → `09-kill-parity-negative.log`
- PASS `PORT=5287 npx playwright test tests/ai-native-world.spec.ts --workers=1` → **9 passed (1.7m，含五视口)** → `11-p1-9cases-dev.log`
- PASS `PORT=5287 npx playwright test tests/checkpoint.spec.ts --workers=1` → **5 passed** → `12-checkpoint.log`
- PASS `PORT=5287 npx playwright test tests/audit.spec.ts tests/runtime-bugs.spec.ts tests/whale-character.spec.ts --workers=1` → **5 passed (41.3s)** → `18-world-regressions.log`
- PASS `npx vite-node tester-node-authority.ts`（Node 权威契约，**18/18**）→ `13-node-authority-probe.log`
- PASS `node probe-rendered-authority.mjs http://localhost:5288/`（正常 RAF 渲染契约）→ `14-rendered-authority-probe.log`
- PASS `node probe-checkpoint-legacy.mjs http://localhost:5288/`（coreState/旧档）→ `16-checkpoint-legacy-probe.log`
- PASS `node probe-projectile-view.mjs http://localhost:5288/`（只读副本/legacy setter 不写 core）→ `17-projectile-view-probe.log`
- PASS `node probe-normal-run.mjs http://localhost:5288/`（无夹具正式游戏受伤/接管）→ `15-normal-run-probe.log`

> `tests/ai-native-world.spec.ts` 在 production preview(5288) 跑 9 项时 F-01/F-02 失败，原因是它调用 `clearEnemiesForTest()`，该 helper 在 production 按 H9 抛 `dev/test only`；换到快照 dev server(5287，官方预期环境) 后 **9/9 PASS**。这是 H9 的有意门禁/测试环境限制，不是产品回归。

## 2. Node 与 Rendered 真实击杀 parity（我自己重生，不读开发者 JSON）

- 我的 `tests/c2-parity.spec.ts` 运行（dev 5287）重生了两套证据：
  - 普通 parity：`parity-initial/sequence/rendered` → 复制到 `parity-evidence/parity-control/`（MD5 `7192c0fe…/8866514b…/9397fcdd…`）
  - 真实击杀 parity：`kill-initial/sequence/rendered` → `parity-evidence/parity-kill/`（MD5 `1211defb…/6c1130c6…/24196109…`）
- 击杀 rendered 证据：`finalTick=284`、`xp=26`、`currency=4`、`dronesLeft=0`、`targetsLeft=0`，事件含 `enemy-hit/enemy-died/currency-gained/xp-gained/player-healed`；B6 用 **normal `stepFrame` 累加器路径**（不是 `stepSimulationTicksForTest`）生成。
- `scripts/c2-node-parity.ts` Node 重放：8/8 PASS；`scripts/c2-kill-parity.ts`：13/13 PASS（canonical/events/finalTick/XP/currency/removal/post-kill shot）。
- **负向篡改**：把 rendered `xp` +1 后，脚本 `FAIL xp-equals-rendered` 且退出码 1 → 检查不是空校验。
- 说明：本报告的 `kill-initial/sequence/rendered` 只来自我这次 dev 运行；未使用开发者 `reports/ai-native-02/c2-fixes-round2/parity-kill/` 里的 JSON。

## 3. Node 权威契约（18/18）

- `hunter` / `stalker` / `sentinel`：真实 core 弹丸命中、`enemy-hit`/`enemy-died`、`xp-gained`，目标从 `state.targets` 移除；stalker 另有 `currency-gained` 记录（RNG 决定，非固定）；`sentinel` 24 XP。
- `drone`：FSM 下命中/死亡/`enemy-died`/XP；`boss_warden`：命中/死亡、`player-levelup`、固定 **+120 currency**、boss 奖励 XP。
- `registerTarget` 深拷贝：修改 input 不影响 core；调用方对象不是权威。
- snapshot 深拷贝：修改 snapshot 的 HP/坐标/nextProjectileId 不触碰活 core；弹丸 ID 唯一且 `nextProjectileId` 前进；target IDs 唯一。
- 同帧多致命伤害：3 次排队 → **1 次 player-hurt、1 次 player-death**；blocked（invuln）→ **无 player-hurt/death、HP 不变**。
- 真实击杀后 XP/等级/`xpToNext` 更新、RNG 前进；同 state+sequence 两次运行 canonical/events 逐字相等；RNG 后续射击顺序由 kill parity 13/13 与 negative 覆盖。

## 4. Rendered 正常帧契约（`probe-rendered-authority`）

- 真实 RAF：100ms 采样 tick 增量 7/7/7/7/6，确认正常帧推进。
- 真实鼠标射击 + 正常帧下，`hunter/stalker/sentinel/drone` 均 **实际命中并死亡**，非 Boss `hitFlash` 捕获到 0.10–0.133，XP 分别 +18/+12/+24/+8；无 console/pageerror。
- 只读 setter 迁移：`e.wx=...`、`e._hp=1` 不改变 core target（`coreUnchanged=true`、`enemyGetterReadOnly=true`）；stalker 在 3 格内 **实际移动（moved=true）且攻击使玩家 HP 下降（attacked=true）**；非 Boss 命中闪烁见上。
- Boss：真实射击使 boss HP 2334/2400 下降；设置 phase 2/attackTimer=0（夹具）后，**Boss 激光 3 发 enemy 弹丸与玩家 1 发存活弹丸同帧并存**，ID 全部唯一；再用 `enqueueTargetHp(boss,1)`（合法 core 命令夹具）后真实瞄准射击，Boss 死亡/`bossGone=true`。
- Pause / Inventory / Level-up：暂停 900ms tick Δ0、恢复 600ms Δ27；背包 900ms Δ0、关闭恢复 Δ26；升级弹层 900ms Δ0、选卡关闭后 Δ56；均 <60 tick 的 1s 追赶阈值（无 catch-up）。

## 5. Checkpoint / 旧档

- `tests/checkpoint.spec.ts` 5/5（装备、升级、损失 recap、checkpoint 恢复、死亡清 run）。
- `tests/c2-parity.spec.ts` H3/F-08 8/8 中通过：core tick/rng/nextProjectileId 恢复、传入 frame 深拷贝不别名。
- 独立 `probe-checkpoint-legacy`：coreState 存在时 restore 后 tick/rng/pid 完全等于捕获值；删除 `coreState` 的 legacy frame 仍 `restoreCheckpoint=true`、tick 重置为 0、RNG 由 seed 重派生、普通帧继续推进且无 console error。**旧档兼容通过**。

## 6. 无夹具正式游戏冒烟（不是 Agent 战斗）

- `probe-normal-run`（不刷新无敌帧、不写 HP/坐标、不注入 seed）：100×200ms 采样，真实 HP **100→47** 自然受伤；经历 **combat→elite 跨房间**；AI 持有 100/100 采样；2 次自然升级；墙碰撞 100/100 walkable、maxStep 1.99。
- 真实输入 `KeyD` / 鼠标开火 / `KeyF` 三种夺回全部 PASS（reason=human-input）；pause OFF 复核 PASS。短演示未死亡（HP 47），不宣称 P2 战斗胜利。

## 7. 跨房间 / P1 五视口

- P1 `shared control path` 用例在 dev 上通过，其操作日志包含 AI 从 combat 房到 elite 房；我的无夹具 run 也记录 `rooms: ["combat","elite"]`，不是固定 drone 场景。
- P1 五视口 `1920x1080/1366x768/1280x720/1024x768/800x600` 在 dev **全 PASS**；production preview 受 `clearEnemiesForTest` H9 门禁影响 F-01/F-02 1 项失败（见 §1 注）。

## 8. 范围、限制与判定

| 项 | 结论 |
| --- | --- |
| C2 第二轮事务契约（本单范围） | **PASS，未发现新硬阻断**：目标命中/死亡、Boss 激光与玩家弹丸并存、深拷贝/ID、同帧单死亡、blocked 静默、非 Boss 闪烁、奖励/等级/RNG、正常帧 parity、负向篡改、checkpoint/旧档、无追赶 |
| C2 最终架构 | **不由本报告判定**：Reviewer 独立负责；本单只验证 0df1514 的目标契约，不外推“C2 全量通过” |
| C3b / World / Agent | **未接、未宣称**：C3b 仍冻结；无真实 World/Scene/Agent 端到端；所有战斗证据为自动化 fixture/正常帧测试，不是 Agent 战斗 |
| 浏览器范围 | 27 个官方用例（P1 9 + c2-parity 8 + checkpoint 5 + audit/runtime-bugs/whale 5），**未跑全量 44**；主线契约已被定向覆盖 |
| 已知限制 | 非 drone FSM 仍为 legacy 决策细节；`World.rng` 与 core RNG 仍是两条流（只承诺 core crit+击杀掉落顺序）；Boss 激光/攻击在 adapter 层调用 core 事务而非 tick 内命令；P1 生产 preview 的 `clearEnemiesForTest` 属 H9 有意门禁；sentinel 需更长射击时间（测试时序，非缺陷）；Boss hitFlash 采样在 900ms 后为 0，但 HP 实际下降（命中已证） |

## 9. 复现

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse 0df1514          # 0df1514103f796c361fe1a1bf1985e6c2205f1a1
mkdir -p D:/Project/AI-NATIVE-02-snapshots/0df1514
git archive 0df1514 | tar -x -C D:/Project/AI-NATIVE-02-snapshots/0df1514
powershell -NoProfile -Command "New-Item -ItemType Junction -Path 'D:\Project\AI-NATIVE-02-snapshots\0df1514\node_modules' -Target 'D:\Project\LAST_SIGNAL\node_modules'"
cd D:/Project/AI-NATIVE-02-snapshots/0df1514
npx tsc --noEmit && npm test
npx vite build --outDir "D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-round2-final/frozen-dist" --emptyOutDir
npm run game:mcp:build
# dev 5287 + preview 5288（本报告运行时）
node node_modules/vite/bin/vite.js --port 5287 --strictPort
node node_modules/vite/bin/vite.js preview --outDir "<frozen-dist>" --port 5288 --strictPort
PORT=5287 npx playwright test tests/c2-parity.spec.ts --workers=1
npx vite-node scripts/c2-node-parity.ts
npx vite-node scripts/c2-kill-parity.ts
PORT=5287 npx playwright test tests/ai-native-world.spec.ts --workers=1
PORT=5287 npx playwright test tests/checkpoint.spec.ts --workers=1
# Node 探针：cp probe-node-authority.ts 到快照根运行后删除
# 渲染/旧档/只读视图/无夹具探针在仓库根 node 运行，BASE=http://localhost:5288/
```


## 10. Reviewer round3 诊断的独立复现（补充证据，不替换 §1–§9 的通过门）

在冻结 `0df1514` 的 production preview(5288) 与 dev(5287) 上，用独立探针（`probe-authority-conflicts.mjs`、`diagnostic-conflicts-log.json`）复现：

| 诊断 | 我的独立实测 | 判定 |
| --- | --- | --- |
| **击杀可见掉落被自动结算改变旧玩法** | 真实 mouse 击杀 hunter：XP 0→18、currency 0→4 立即由 core 奖励；`world.loot` 前后/过程中始终 **0**（无可见掉落加入）。房间/手动 `spawnLoot` 的货币掉落仍可见、可拾取：spawn 后 `loot=1` 且 sprite visible，250ms 后 `loot=0`、currency 4→14 | **复现**：击杀奖励改为不可见自动结算，旧“可见掉落→拾取”循环被改变 |
| **paused / 零 dt 直接写 core** | ESC 暂停后 tick=155 不变；`addCurrency(123)` → currency 14→137；`healPlayer(10)` → HP 88→98；`applyUpgradeChoice('speed',1)` → upgrades 0→1、speed 220→237.6；**tick 仍 155** | **复现**：adapter 直接 core 写入不经过 tick/事务/事件 |
| **legacy spawn* 在 paused/tick 不变时改 core 且无事件** | 暂停中 `spawnEnemy('drone')` → sim.drones 0→1；`spawnEnemyProjectile` → sim.projectiles 1→2；tick 仍 155；未经过 `stepFrame`，无 `SimEvent` | **复现**：spawn 在 tick 外注册 core 实体 |
| **`stepFrame(0)` 吸收 loot 并写 core** | 暂停中在玩家位置 `spawnLoot(currency 10)` → loot 0→1；`stepFrame(0, neutral)` 后 loot 1→0、currency 137→147、**tick 仍 155** | **复现**：零 dt 的 legacy 更新路径会结算掉落并直接写 core |
| **production/test 构建真实区别** | production(5288)：`clearEnemiesForTest` / `resetProjectilesForTest` / `stepSimulationTicksForTest` 均抛 **`dev/test only`**；dev(5287)：三者均 `ok`。P1 preview 的 F-01/F-02 失败正是调用该 dev-only helper，dev 上 P1 9/9 PASS | **复现**：这是 H9 的测试构建门禁，不是 gameplay 回归；但说明 production P1 全量不能直接作为通过证据 |

这些冲突不否定 §1–§9 中已实际通过的契约（命中/死亡/Boss 激光/ID/深拷贝/同帧单死亡/blocked/非 Boss 闪烁/奖励 RNG/checkpoint/parity/无追赶），但**否定了“事务权威已完整收口”**：paused/zero-dt/adapter spawn 仍可绕过 tick 写 core，击杀可见掉落被自动结算改变旧玩法。C3b 不应据此接线；需 round3 修复后重验。
