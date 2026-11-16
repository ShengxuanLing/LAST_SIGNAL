# AI-NATIVE-02 C2 独立验收报告（Tester）

- Worker `y6en9ua8phanll8cqi8dd8ru`，专属目录 `reports/ai-native-02/tester/c2-final/`
- 目标冻结提交：`4cf1bc8b26a335661b36016a2ade5b23d87afc37`（父 `ff13ce3b0309148ed0c3cf72bc662ffafb4b4fc7`），分支 `feat/ai-native-world-integration`
- 隔离：`git archive 4cf1bc8` → `D:/Project/AI-NATIVE-02-snapshots/4cf1bc8`（仅该提交已跟踪文件 + `node_modules` junction），自建产物 + 自有端口 **5285（production preview）/ 5286（snapshot dev，c2-parity 需要 `/src` 模块图）**，启动前均确认空闲。**未切共享分支、未改生产源码/已有测试/配置、未读混合 WIP。**
- 结论：**PASS，无阻断**；C2 仅为**首片**（player + drone + pulse + 已迁移弹丸），不是全 World / 全玩法确定性 / Headless / 外部 Agent。
- 复核期间 developer 已开始 C3（活工作树出现未跟踪 `worldGateway*` / `worldBridgeServer*` / `worldProtocol*`），但我的快照文件哈希与产物哈希首尾一致（`00-frozen-state.log` / `13-snapshot-integrity.log` / `16-final-state.log`），结论只绑定 `4cf1bc8`。

## 1. Gate 一行式（完整输出均在 `c2-final/` 日志）

- PASS `npx tsc --noEmit`（快照）退出码 0 → `01-typecheck.log`
- PASS `npm test`（快照）**21 files / 353 tests** → `02-unit.log`
- PASS `npx vite build --outDir …/c2-final/frozen-dist --emptyOutDir` 12.53s（保留基线 500kB chunk 警告）→ `03-build-frozen.log`
- PASS `PORT=5285 LS_AI_EVIDENCE_DIR=…/evidence-p1 npx playwright test tests/ai-native-world.spec.ts --workers=1` → **9 passed (1.8m)** → `05-p1-9cases.log`
- PASS `PORT=5285 … --grep "shared control path" --repeat-each=6 --workers=1` → **6 passed (3.3m)** → `06-p1-shared-control-6x.log`
- PASS `PORT=5286 npx playwright test tests/checkpoint.spec.ts --workers=1`（全 World checkpoint/升级/背包/死亡回归）→ **5 passed (19.7s)** → `07b-checkpoint-devserver.log`
- PASS `PORT=5286 npx playwright test tests/c2-parity.spec.ts --workers=1` → **3 passed (18.6s)** → `08-c2-parity-spec.log`
- PASS `npx vite-node scripts/c2-node-parity.ts` → **8/8 checks, PARITY_PASS** → `09-node-parity.log`
- PASS `npm run game:sim:parity` → **8/8 PASS** → `09b-npm-sim-parity.log`
- PASS（负向对照，预期失败）篡改 rendered canonical 后 `node scripts/c2-node-parity.ts` → `FAIL node-vs-rendered-state`、退出码 1 → `11-node-parity-negative.log`
- PASS `npx vite-node <快照临时探针>`（无 Phaser Node）8 项检查 → `CORE_PROBE_PASS` → `12-core-node-probe.log`
- PASS `node …/probe-rendered-normal-frame.mjs http://localhost:5285/`（只用真实 RAF + 真实键鼠）→ `14-rendered-normal-frame-probe.log`
- PASS `node …/probe-normal-run.mjs http://localhost:5285/`（无夹具自然运行）→ `15-normal-run-probe.log`

> 说明：`tests/checkpoint.spec.ts` 在 production preview（5285）上 5 项中 1 项失败，原因是该 spec 仍用 `constructor.name === 'LevelUpScene'` 找场景，生产构建 minify 类名后返回 null；换到 snapshot dev server（5286，spec 预期环境）后 **5/5 PASS**。这是测试环境兼容性限制，不是产品回归。C2 parity spec 按设计只能在 dev server（`import('/src/...')`）运行。

## 2. 九项 P1 + 五视口 + 重复 6 次

- `shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit` PASS
- HUD `1920x1080 / 1366x768 / 1280x720 / 1024x768 / 800x600` PASS ×5（逻辑 1280x720；几何/字号断言同前轮）
- `F-04/F-05` 覆盖层归属 + UI 点击 vs 夺回 PASS
- `F-01/F-02` 感知半径/遮挡/未探索/bounded canWalk PASS
- `C1: rendered World applies the shared pure rules` PASS
- 小补丁稳健性：同一 `shared control path` 用例 **--repeat-each=6 --workers=1 → 6/6 PASS**（3.3m，无 flaky）。
- 夹具声明核对：该 spec 内 `record('evidence-fixture', …)` 明确声明 i-frames 刷新、第二把武器、感知探针的 `spawnEnemy`/`enteredRooms`/seed 注入等；与“真实运行”证据分开记录（本报告 §4 另有无夹具自然运行）。

## 3. C2 parity：我自己重生证据 + Node 重放 + 负向对照

- 我在 snapshot dev server（5286）重跑 `tests/c2-parity.spec.ts`（3/3 PASS），由该 spec **我自己重生**了 `parity-initial.json` / `parity-sequence.json` / `parity-rendered.json`，不是读开发者 JSON。复制到 `c2-final/parity-evidence/` 并记录 MD5：initial `2a334dab…`、sequence `ee5dcf6a…`、rendered `32a8a882…`。
- 我的 parity 证据：`finalTick=205`，事件类型 `player-moved / drone-step / projectile-spawned / player-fired / enemy-hit / enemy-died / player-hurt / projectile-wall`，`dronesLeft=0`、`projectilesLeft=2`。
- `scripts/c2-node-parity.ts` 在 Node（vite-node，无 Phaser）重放同一 initial/sequence，逐字比较：`node-replay-state/events`、`node-vs-rendered-state/events`、`node-final-tick`、`seed-present`、`rng-state-present`、`real-combat-events` → **8/8 PASS**。
- **负向对照**：把 rendered canonical 的 tick 205 篡改为 206 后重跑，脚本 `FAIL node-vs-rendered-state` 且退出码 1 → 证明该 8 项检查不是空校验。
- 结论：Rendered 受控队列（`stepSimulationTicksForTest`，test-only 路径）与 Node 重放逐字一致；但该受控路径**不能单独证明正常帧路径**，见 §4。

## 4. 正常帧路径（非 test-only）独立验证

`probe-rendered-normal-frame.mjs`：**不调用** `stepFrame` / `stepSimulationTicksForTest` / `resetSimulationAccumulator`，只用真实 RAF + `page.keyboard/mouse` + 只读 evaluate；夹具仅 1 只 spawn drone 与末尾 restore 边界检查。

| 项 | 实测 | 判定 |
| --- | --- | --- |
| 真实 tick 节奏 | 每 100ms 采样 10 次：deltas `[7,7,7,7,7,7,7,7,7]`（9 个非零、max 7），不是一次 60-tick 跳变 | ✅ 真实 RAF 分帧 |
| 真实移动 | 按住 KeyD 500ms：sim Δ=`+1.776/-1.776`，渲染 Δ 完全相同、`sim===rendered` | ✅ |
| 真实战斗 | 真实鼠标脉冲射击：drone HP 降到 4 后被击杀，`sim.drones` 移除、`world.enemies` 移除，`damageDealt=36`、`kills=1`、飞行中 core 弹丸 2 发 | ✅ 正常帧路径驱动 core |
| 暂停不追赶 | ESC 后 1.2s：`tick` 完全冻结（Δ=0）；恢复 600ms：Δ=27（<60 的 1s 追赶阈值） | ✅ |
| restore 输入变异 | `captureCheckpoint → restoreCheckpoint` 后篡改传入 frame 的 HP/坐标：活状态 HP/位置/sim 位置全部不变 | ✅ 深拷贝不别名 |

## 5. 无 Phaser Node 探针（`probe-core-node.ts`，vite-node）

- **真实伤害/死亡**：真实 `MapGenerator(424242)` + `WEAPONS.pulse` + `ENEMY_STATS.drone`；玩家射击 → drone 在 tick 18 被击杀（`enemy-hit`/`enemy-died`）；真实 drone 远程攻击 → **17 次 `player-hurt`、tick 1385 玩家死亡、HP=0**（无任何 HP 写入）。
- **seed 重放**：同 seed + 同 intent 序列两次运行 → canonical state/events 逐字相等；不同 seed → canonical 与 rngState 均不同。
- **固定 tick 分帧等价**：`120 ticks 一次调用` == `120 × 1 tick`（state 与 events 均相等）；`15 ticks` == `3 × 5 ticks`（state 与 events 均相等）。`SIM_TUNING = 60Hz / MAX_TICKS_PER_FRAME=15 / MAX_FRAME_DELTA_MS=250`。
- 该探针只 import `src/world/sim/core`、config 与纯 `MapGenerator`，**不 import Phaser/DOM**；临时探针文件在运行后删除，快照源码 MD5 复核不变（`13-snapshot-integrity.log`）。

## 6. 无夹具短冒烟（自然移动 / 战斗受伤 / 夺回）

`probe-normal-run.mjs`（不刷新无敌帧、不写 HP/坐标、不注入 seed；真实 NEW RUN → ESC → AI CONTROL ON → ESC）：
- 真实 HP **100 → 0** 自然死亡进入 `GameOverScene`（43 次采样，combat 房间，AI 持有 43/43）；真实点 RETRY → 新局 `human / aiEnabled=false / actionCount=0 / takeoverCount=0 / hp=100`。
- 墙碰撞：43/43 采样 walkable、同房间 42 步 max 0.375。
- 三种真实输入夺回 PASS：`KeyD` 移动 / 鼠标开火 / `KeyF` 交互，`reason=human-input`；pause OFF 干净复核 PASS（AI ON → 冻结 → OFF → 恢复后仍 human、不自抢）。
- 非首片玩法回归：`tests/checkpoint.spec.ts` 5/5（dev server）覆盖 real checkpoint 恢复、升级选卡、背包装备、损失 recap、死亡清 run；P1 用例 1/7 覆盖升级弹层内夺回、死亡/重启、checkpoint 深拷贝。

## 7. 结论与限制

**PASS，无阻断。** 但必须区分：
1. **首片 vs 全 World**：C2 只把 player、drone、player/drone 弹丸、tick/seed/rngState 放进 `SimulationState`；Boss、其他 enemy kind、`legacyStateMachine`、`spawnEnemyProjectile`、loot/portal/升级/存档内容仍 legacy；`World.rng` 与视觉 `Math.random()` 未迁移。不是全游戏 seeded RNG / Replay / stateHash。
2. **不是 Headless / 外部 Agent**：`game:headless`/MCP 仍是 Station Zero 规则核心；本轮无真实 LLM/Codex/MCP Agent 接入，HUD/菜单保持 `EXTERNAL NOT CONNECTED`；**LLM 未接入**。
3. **证据性质**：P1 用例 1/7 的 i-frames/第二把武器/seed/感知探针是已声明夹具；C2 parity 的 rendered canonical 由 test-only 受控队列生成（其设计如此），正常帧路径另由我的独立探针验证；无夹具短冒烟是真实受伤/自然死亡，但仍是**自动化 Playwright**，不是真人/真实 Agent 游玩，也不宣称 P2 战斗胜利。
4. 仅 Chromium + 5 个桌面视口；未重跑与 C2 无关的全量 39 项 E2E（按 Lead 要求避免内存/端口开销）；`checkpoint.spec` 不能跑 production preview（constructor.name minify）。
5. `npm run build` 的 500kB chunk 警告为基线既有。
6. 结论只适用于 `4cf1bc8`；复核期间活工作树已出现 C3 未跟踪文件，未纳入验收。

## 8. 复现步骤

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse 4cf1bc8
mkdir -p D:/Project/AI-NATIVE-02-snapshots/4cf1bc8
git archive 4cf1bc8 | tar -x -C D:/Project/AI-NATIVE-02-snapshots/4cf1bc8
powershell -NoProfile -Command "New-Item -ItemType Junction -Path 'D:\Project\AI-NATIVE-02-snapshots\4cf1bc8\node_modules' -Target 'D:\Project\LAST_SIGNAL\node_modules'"
cd D:/Project/AI-NATIVE-02-snapshots/4cf1bc8
npx tsc --noEmit && npm test
npx vite build --outDir "D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-final/frozen-dist" --emptyOutDir
node node_modules/vite/bin/vite.js preview --outDir "<frozen-dist>" --port 5285 --strictPort
node node_modules/vite/bin/vite.js --port 5286 --strictPort
# 另一终端（快照目录）
PORT=5285 LS_AI_EVIDENCE_DIR="D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-final/evidence-p1" \
  npx playwright test tests/ai-native-world.spec.ts --reporter=line --workers=1 --output="D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-final/pw-out-p1"
PORT=5285 npx playwright test tests/ai-native-world.spec.ts --grep "shared control path" --repeat-each=6 --workers=1
PORT=5286 npx playwright test tests/c2-parity.spec.ts --workers=1
PORT=5286 npx playwright test tests/checkpoint.spec.ts --workers=1
npx vite-node scripts/c2-node-parity.ts          # 或 npm run game:sim:parity
# 仓库根执行独立探针
cd D:/Project/LAST_SIGNAL
node reports/ai-native-02/tester/c2-final/probe-rendered-normal-frame.mjs http://localhost:5285/
node reports/ai-native-02/tester/c2-final/probe-normal-run.mjs http://localhost:5285/
# Node core 探针：复制 probe-core-node.ts 到快照根 → npx vite-node tester-c2-core-probe.ts → 删除
```
