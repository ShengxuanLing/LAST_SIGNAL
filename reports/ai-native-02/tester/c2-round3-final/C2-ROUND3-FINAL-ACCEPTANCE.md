# AI-NATIVE-02 C2 第三轮独立重验（6ac60b2）

- Worker `y6en9ua8phanll8cqi8dd8ru`，专属目录 `reports/ai-native-02/tester/c2-round3-final/`
- 目标冻结提交：`6ac60b2092402e778b6d0b9c9e02a4b0148a1cce`（父 `0df1514103f796c361fe1a1bf1985e6c2205f1a1`），分支 `feat/ai-native-world-integration`
- 隔离：`git archive 6ac60b2` → `D:/Project/AI-NATIVE-02-snapshots/6ac60b2`（仅已跟踪文件 + `node_modules` junction）；dev 5289 / preview 5290 自启自停；探针只写本报告目录。未切共享分支、未改源码/测试/配置；**`stash@{0}`、`stash@{1}` 未读未恢复**；活工作树 `M tests/boss-room.spec.ts` 未纳入；开发者 `reports/ai-native-02/c2-round3/REPORT.md` 未在冻结提交中（未读共享 WIP）。
- 结论：**本单点到的目标契约多数 PASS（日志见 §2），但 C2 整体仍判定为“阻断/未收口”**：发现 **公开 Owner setter 门禁缺陷**（P1 fixture 使用 `ownerSetPlayerData`，不是 transaction-only 安全证明）、**拾取磁吸半径单位不一致**（`pickupRange=90` 被当作网格单位，90 格内的掉落无移动即自动吸附拾取，正常房间内“可见掉落→走近拾取”并不成立）、**房间进入链仍 tick 外直写 core**（`onEnterRoom → spawnForRoom/spawnResourceLoot/placePortal`）、以及 **C1 玩法分布漂移**（房间敌人选择/资源奇偶/传送目标改为确定性公式，elite 池删除 drone；60 seed 实测 300 房间中 240 房间敌人集合不同、120 次资源掉落 60 次类型不同、300 次传送目标 240 次不同）。**C3b 前置不解除**，仍冻结，不接 World/Agent。

---

## 1. Gate 一行式（完整输出在 `c2-round3-final/`）

- PASS `npx tsc --noEmit`（快照）退出码 0 → `01-typecheck.log`
- PASS `npm test`（快照）**24 files / 397 tests** → `02-unit.log`
- PASS `npx vite build --outDir …/c2-round3-final/frozen-dist --emptyOutDir` 11.50s（保留基线 500kB chunk 警告）→ `03-build.log`
- PASS `npm run game:mcp:build`（301.22 kB）→ `03b-mcp-build.log`
- PASS default StationZero MCP smoke：`initialize` + `tools/list` = 6 Player 工具 → `04-mcp-smoke.log`
- PASS `PORT=5290 npx playwright test tests/ai-native-world.spec.ts --workers=1` → **9 passed (1.7m，production preview，含五视口）** → `05-p1-production.log`
- PASS `PORT=5289 npx playwright test tests/c2-parity.spec.ts --workers=1` → **8 passed (36.7s)** → `06-c2-parity-spec.log`
- PASS `npx vite-node scripts/c2-node-parity.ts` → **8/8** → `07-node-parity.log`
- PASS `npx vite-node scripts/c2-kill-parity.ts` → **13/13** → `08-kill-parity.log`
- PASS（负向对照，预期失败）篡改 rendered canonical loot/currency 后 → 2 failures，退出码 1 → `10-kill-parity-negative.log`
- PASS `PORT=5289 npx playwright test tests/checkpoint.spec.ts --workers=1` → **5 passed** → `11-checkpoint.log`
- PASS `PORT=5289 npx playwright test tests/audit.spec.ts tests/runtime-bugs.spec.ts tests/whale-character.spec.ts --workers=1` → **5 passed (38.8s)** → `12-world-regressions.log`
- PASS `npx vite-node tester-node-transactions.ts`（Node 核心：远距击杀掉落/拾取、pending 0 tick、快照、replay；15/15）→ `13-node-transactions-probe.log`
- PASS `node probe-production-transactions.mjs http://localhost:5290/`（production 冻结快照/门禁/队列/掉落/击杀事件；18/18）→ `14-production-transactions-probe.log`
- PASS `node probe-dev-kill-loot.mjs http://localhost:5289/`（dev-only simFixture：远距真实击杀可见掉落→移动拾取）→ `15-dev-kill-loot-probe.log`
- PASS `node probe-rendered-authority.mjs http://localhost:5290/`（正常帧：非 drone/Boss 击杀、Boss 激光、只读 setter、五视口相关 overlay）→ `16-rendered-authority-probe.log`
- PASS `node probe-normal-run.mjs http://localhost:5290/`（无夹具接管/受伤/跨房间，rooms combat→elite→boss）→ `17-normal-run-probe.log`
- PASS `node probe-checkpoint-legacy.mjs http://localhost:5289/`（dev simFixture：coreState 恢复 + legacy 帧）→ `18-checkpoint-legacy-probe.log`
- PASS `node probe-build-gate.mjs http://localhost:5290/ http://localhost:5289/`（生产/测试构建门禁差异）→ `19-build-gate-probe.log`

## 2. 原有诊断复核结果

- **暂停 heal/currency/upgrade/spawn 只入队**：production `stepFrame` 探针：暂停时 `enqueueHeal/enqueueCurrency/enqueueAddXp/enqueueApplyUpgrade/enqueueSpawnLoot/enqueueSpawnEnemy/spawnEnemyProjectile` 后 tick 不变，HP/currency/xp/upgrades/loot/drones/targets/projectiles/位置全部不变，pending=6；`stepFrame(0)` 返回 0 事件且不提交。→ **PASS（已按新契约）**
- **正常 tick 后事件正确且不重复**：一次正常 tick 提交 `player-healed / currency-gained / xp-gained / player-upgraded / loot-dropped / projectile-spawned`，敌人出现、pending 清 0、tick+1；下一次 tick 不再重复奖励事件。→ **PASS**
- **快照嵌套写不影响 core**：production `world.sim` 为 deep-frozen 副本（`Object.isFrozen` 嵌套成立）；对 `player.data.hp`、`pendingCommands`、`loot[0].x` 的嵌套写均不改 live core；`simFixture`/`playerDataFixture` 在 production 抛 `dev/test only`。→ **PASS**
- **旧诊断“paused 直接写 core / stepFrame(0) 拾取”**：`healPlayer/addCurrency/addPlayerXp/applyUpgradeChoice` 仍为立即 core 写；但它们已是 owner/test 边界（见 §4 的 gate 缺陷），且领取掉落改走 `stepLoot`。`stepFrame(0)` 不再拾取/结算。→ 原诊断中的“spawn only enqueue、stepFrame(0) 不拾取”已修复；owner setter 仍公开。

## 3. 可见击杀掉落 / 拾取

- **Node 权威**（`probe-node-transactions`）：远距（>90 格）真实击杀产生 `loot-dropped`，core `loot` 保留、currency 不变、XP 已增；用合法 teleport 命令靠近后下一 tick 产生 `loot-collected`、currency 增加、loot 清空。
- **dev rendered**（`probe-dev-kill-loot`，dev-only `simFixture`）：远距真实击杀 → `enemy-died + loot-dropped ×2`，`w.loot` 有 2 个可见 sprite、currency 仍 0；移动后再拾取 → `currency-gained + loot-collected ×2`、sprite 消失、currency=4。
- **production rendered**（`probe-production-transactions`）：在 >90 格处 spawn 的 currency/health loot 可见（`w.loot`/`w.sim.loot` 各 2），未拾取 currency/HP 不变（HP 80）；再移动（合法 teleport 命令）后 currency 10、HP 100、loot 0。
- **资源房同理**：`spawnResourceLoot` 仍调用 `spawnLoot → enqueueSpawnLoot`，走同一 core 掉落/拾取路径（源码只读复核 + 上述同路径探针）。
- **发现（阻断/限制）**：`stepLoot` 用 `p.data.pickupRange`（=90）作为**网格单位**判断磁吸/拾取；Node 探针在 20 格处放置掉落、玩家不移动，40 tick 内即被自动吸附并 `loot-collected`（currency 0→10）。因此正常房间（尺寸远小于 90 格）里的击杀/资源掉落会立即被拾取，“可见掉落→走近再拾取”只在 >90 格时成立。这是单位不一致导致的玩法收缩，**不能视为已恢复可见掉落循环**。

## 4. Fixture / 构建门禁缺陷（Lead 指定检查项）

- production 与 dev 真实区别：production 的 `simFixture`、`playerDataFixture`、`clearEnemiesForTest`、`resetProjectilesForTest`、`stepSimulationTicksForTest` 全部抛 `dev/test only`；dev 全部可用（`19-build-gate-probe.log`）。
- **公开 Owner setter 绕过规则**：`ownerSetPlayerData`、`ownerMovePlayer`（以及 `ownerResetPlayer`）是 public、无 dev/test 门禁，直接写 `_sim`；production 实测调用后立即改变 HP/位置，无 pending/事务/事件（`flows.gate`：before hp=100/x=8 → after hp=95/x=9）。
- `tests/ai-native-world.spec.ts:791` 的 production P1 fixture 正是 `gs.world.ownerSetPlayerData(upgraded)`。因此 **production P1 9/9 通过不能作为“core 写入全部经事务”的安全证明**；这是门禁缺陷（gate defect），需 dev/test 门禁或改为合法命令。

## 5. Node/rendered parity 与负向

- c2-parity 8/8、node parity 8/8、kill parity 13/13（canonical 含 `loot/nextLootId/pendingCommands/pendingPlayerHits/targets/drones/rngState/tick`）；rendered 事件含 `loot-dropped`、`loot-collected`、`xp-gained`、`currency-gained`、`player-healed`，post-kill shot 存在。
- 负向篡改 rendered canonical loot + currency 后，`node-vs-rendered-state` 与 `currency-equals-rendered` 同时 FAIL、退出码 1 → 检查非空。
- 证据由我在快照 dev server 自己重跑生成（`parity-evidence/`，MD5 见 `09-parity-evidence.log`）。

## 6. P1 五视口与生产观感

- production preview 5290：P1 9/9 PASS（控制流、五视口 HUD、F-04/F-05、F-01/F-02、C1 rendered）。
- 实际打开查看全部五张：`1920x1080`（scale 1.5）、`1366x768`（1.067）、`1280x720`（1）、`1024x768`（0.8，上下黑边）、`800x600`（0.625，上下黑边）；控制行 `CONTROL AI · LOCAL DETERMINISTIC`、`AI ACTION/TARGET`、`LOCAL DETERMINISTIC DEMO · EXTERNAL NOT CONNECTED` 与左下提示均可读、无裁切/遮挡；800x600 最小物理字高约 10.6px。

## 7. 跨房间 / 非 drone / Boss / 队列不卡死

- 无夹具 run：AI 实际经历 `combat → elite → boss` 三房间，真实 HP 最低 45.5、自然回复，100/100 采样 AI 持有；`KeyD`/鼠标/`KeyF` 三种夺回 PASS；pause OFF PASS。→ 队列推进与跨房间无卡死。
- 正常帧 rendered：hunter/stalker/sentinel/drone 实际命中/死亡并带 hitFlash；只读 setter 迁移后旧敌仍移动/攻击；Boss 实际掉血、激光 3 发与玩家 1 发弹丸同帧并存、ID 唯一，最终死亡。
- production 队列：`enqueueSpawnEnemy` 在 tick 边界生成、`spawnEnemyProjectile` 命令生成弹丸并产生 `projectile-spawned`，无死锁。

## 8. Checkpoint 旧档/新档

- `tests/checkpoint.spec.ts` 5/5；c2-parity H3/F-08 通过。
- 独立 dev probe（`simFixture` dev 门禁内）：coreState 捕获/恢复 tick/rng/nextProjectileId 一致；删除 `coreState` 的 legacy 帧仍 restore 成功、tick 归 0、RNG 重派生、普通帧继续推进。

## 9. 整体判定

| 范围 | 结论 |
| --- | --- |
| 本单点到的目标契约（队列边界、快照冻结、一次提交不重复、远距掉落/拾取、parity、checkpoint、跨房间、五视口） | **PASS**（日志见 §1） |
| C2 整体 | **阻断/未收口**：(a) public Owner setter + production P1 fixture 使用 `ownerSetPlayerData`，事务边界可被公开绕过，P1 绿灯不是安全证明；(b) 拾取磁吸半径单位不一致（90 格内自动拾取），可见掉落/走近拾取循环在正常房间不成立 |
| C3b | **继续冻结，不接线**；无 World/Agent 端到端；所有战斗为自动化 fixture/正常帧测试，不是 Agent 战斗 |
| 未覆盖 | 未跑全量 44 E2E（本轮 27 项官方用例 + 探针）；非 drone FSM 决策细节、World.rng/core RNG 双流、Boss 攻击 adapter 层调用等仍为已记录限制 |

## 10. 复现

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse 6ac60b2          # 6ac60b2092402e778b6d0b9c9e02a4b0148a1cce
git archive 6ac60b2 | tar -x -C D:/Project/AI-NATIVE-02-snapshots/6ac60b2
powershell -NoProfile -Command "New-Item -ItemType Junction -Path 'D:\Project\AI-NATIVE-02-snapshots\6ac60b2\node_modules' -Target 'D:\Project\LAST_SIGNAL\node_modules'"
cd D:/Project/AI-NATIVE-02-snapshots/6ac60b2
npx tsc --noEmit && npm test
npx vite build --outDir "D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-round3-final/frozen-dist" --emptyOutDir
npm run game:mcp:build
node node_modules/vite/bin/vite.js --port 5289 --strictPort
node node_modules/vite/bin/vite.js preview --outDir "<frozen-dist>" --port 5290 --strictPort
PORT=5290 npx playwright test tests/ai-native-world.spec.ts --workers=1
PORT=5289 npx playwright test tests/c2-parity.spec.ts --workers=1
npx vite-node scripts/c2-node-parity.ts && npx vite-node scripts/c2-kill-parity.ts
PORT=5289 npx playwright test tests/checkpoint.spec.ts --workers=1
# Node 探针：cp probe-node-transactions.ts 到快照根运行后删除
# 其余探针在仓库根运行：probe-production-transactions.mjs(5290)、probe-dev-kill-loot.mjs(5289)、
# probe-rendered-authority.mjs(5290)、probe-normal-run.mjs(5290)、probe-checkpoint-legacy.mjs(5289)、probe-build-gate.mjs
```


## 11. Lead 同步的 Reviewer round3 结论：我的独立复核（补充，不替换 §1–§10）

Reviewer（`reports/ai-native-02/reviewer/c2-round3/REVIEW.md`）确认核心伤害/掉落参数一致，但指出：房间进入链与 Owner 方法仍在 tick 外直写 core、Owner 方法缺能力门禁、房间敌人选择/传送目标/资源奇偶/elite 池被改为确定性公式导致 C1 分布失配。我用冻结 `6ac60b2` 独立复核如下。

### 11.1 房间进入链：tick 外直写 core（复现）
`probe-room-transition.mjs`（dev-only `simFixture`，合法 `enqueueTeleport` 触发房间切换，来源 `21-room-transition-probe.log` / `room-transition-log.json`）：
- 连续 4 次房间切换（room 0 → 3 → 0 → 3），每步 tick 正常推进（53→55→57→59），**无卡死**；
- 进入新房间的**第一个 tick 内**，core `targets` 由 0 → 3（kind 全部 `hunter`），而 `pendingCommands` 始终为空、`pendingKinds` 无 `spawn-enemy` → **敌人是 `spawnForRoom → spawnEnemy → registerTarget` 直接写入 core，不经 pending 命令**；
- 资源房掉落：`queuedResourceLoot=false`（本轮切到的房间非资源房，源码层面 `spawnResourceLoot → spawnLoot → enqueueSpawnLoot` 已入队，但 `onEnterRoom` 本身仍在 tick 外调用它）；
- `placePortal` 同样在 `onEnterRoom` 内直接执行（portal targetRoom 5 / 3 随房间变化），不经 core tick。

### 11.2 C1 玩法分布漂移（复现，量化）
`probe-c1-distribution-drift.ts`（纯 Node：真实 `MapGenerator` + 真实 `RNG(seed*7919+1)`；C1 规则逐行取自 `0df1514`，round-3 规则取自 `6ac60b2`，60 个 seed / 300 个房间，`22-c1-distribution-drift.log`）：

| 维度 | C1（0df1514） | round-3（6ac60b2） | 实测失配 |
| --- | --- | --- | --- |
| 房间敌人集合 | elite 池 = sentinel/hunter/stalker/**drone**，非 elite 用 `rng.pick([roll, roll+1])` | elite 池 = sentinel/hunter/stalker（**删 drone**），非 elite = `all[(r.id*53+depth*11)%4]`（**无 RNG**） | **240 / 300 房间敌人集合不同**；kind 直方图 C1 sentinel 600/drone 360/hunter 360/stalker 60 → round-3 sentinel 540/**drone 0**/hunter 420/stalker 420 |
| 资源掉落类型 | `rng.int(0,1)`（currency/health 各半） | `(r.id+i)%2`（**无 RNG**） | **60 / 120 次掉落类型不同** |
| 传送目标 | `rng.pick(neighbors)` | `neighbors[0]` | **240 / 300 次目标房间不同** |

示例（seed 1）：room 2 resource 房 C1 = drone×4+sentinel，round-3 = sentinel×5；room 5 elite 房 C1 = hunter/sentinel/drone×2/stalker/hunter×2，round-3 = stalker×7。

### 11.3 结论
- Lead 的判断成立：**玩法分布已被改变**，且不是等价重写（RNG 消费点被移除 → 分布与 C1 大面积失配，200+ seed 规模会持续命中）。
- 我这轮已实测通过的契约（队列边界、快照冻结、一次提交不重复、远距掉落/拾取路径、parity 8/8 + kill 13/13、checkpoint 旧档/新档、五视口、跨房间不卡死）**不覆盖**“房间进入链事务化”和“C1 分布保持”，因此 **不能称 C2 通过、C3b 前置不解除**。
- 我的其他阻断项（§4 Owner setter 公开写、§3 磁吸单位 90 格）仍独立成立。

### 11.4 本轮补充日志
- `21-room-transition-probe.log` / `room-transition-log.json`：房间切换、tick 外直写 core、portal 放置、无卡死。
- `22-c1-distribution-drift.log`：C1↔round-3 敌人/资源/传送分布量化失配。
