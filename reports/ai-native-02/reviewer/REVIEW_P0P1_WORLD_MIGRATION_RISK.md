# AI-NATIVE-02 基线风险审查：World / Player / ai-native 接缝（P0/P1 最小迁移）

- 角色：独立审查 Worker（只读源码）。**不是最终签字，不代表任何实现已完成。**
- 基线：`860a0dd78fb741896c2f1433742603dd91e37fc8`（`origin/main`，即 `feat/ai-native-world-integration` 当前 HEAD）。
- 审查对象：仅仓库已提交内容。行号全部按 `git show 860a0dd:<path>` 的提交版本给出。
- 审查时间：2026-11-13。审查时**工作树非干净**，`developer` Worker 正在同一 checkout 实现 P1（见 §6）。本报告的结论只针对 860a0dd 基线，不评价 WIP。
- 证据日志：`reports/ai-native-02/reviewer/`（baseline-git.log、gate-baseline-typecheck.log、gate-baseline-vitest.log）。

---

## 1. 结论摘要

当前 main 的 AI-NATIVE 运行时（`src/ai-native/`）是**独立的 Station Zero 无头核心**，与主 `World` 没有任何共享权威规则。主 `World`/`Player`/`Enemy`/`Boss` 是「Phaser 渲染 + 玩法状态 + 战斗 + 存档」四合一，且是变长 `dt`、含多处 `Math.random()`。因此：

- 「正式 World 可见 AI 接管」不能靠给 `World` 加 `headless` 分支，也不能把战斗规则复制进 runtime；必须先抽出共享的纯权威核，或明确声明只做「意图适配层」。
- Station Zero 的成功不可外推为主 World 可重放。主 World 目前**不具备** AI-NATIVE-01 承诺的确定性/可回放前提。
- 观察投影、控制所有权、reset/死亡/存档语义都需要在主 World 侧**新建**，不能复用现有 `World` 公开字段。

阻断项 2 个（R-01、R-02，直接决定 P1 架构）；高优先 4 个（R-03–R-06）；中低 4 个。所有项都给了开发者可执行检查。

---

## 2. 基线验证门（gate）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `git worktree add --detach <tmp> 860a0dd` + `npm run typecheck` | **PASS**（exit 0） | `reports/ai-native-02/reviewer/gate-baseline-typecheck.log` |
| 同上 + `npx vitest run` | **PASS**（Test Files 13 passed / Tests 292 passed，exit 0） | `reports/ai-native-02/reviewer/gate-baseline-vitest.log` |

说明：为隔离 `developer` 的并发 WIP，门在一个 860a0dd 的临时 detached worktree 中执行（仅 junction `node_modules`，跑完已 `git worktree remove`，未切分支、未提交、未改动主工作树）。**这是基线快照门，不是最终验收。**

---

## 3. 阻断项（发现即停，P1 迁移前必须解决）

### R-01（P1 阻断）主 World 没有纯权威核，模拟/战斗/渲染耦合在一个类里
- 证据：
  - `src/world/World.ts:58` 构造函数强依赖 `Phaser.Scene` 与 `SaveData`；`src/world/World.ts:468` `update(dt)` 直接驱动 player/enemy/boss/projectile/loot/fx/camera/renderer。
  - `src/world/World.ts:381` `spawnProjectile` 在同一函数里算暴击/伤害（`:389` `rng.float()`）并创建 Phaser sprite。
  - `src/entities/Player.ts:155` `update(dt)` 读键盘 → 位移 → `tryFire()`；`src/entities/Player.ts:236` `tryFire()` 组 projectile spec。
  - `src/entities/Enemy.ts:165/184/196/209` 敌人 AI 直接 `world.isWalkable` + `player.hurt`；`src/entities/Boss.ts:142` 召唤用 `Math.random()`。
- 风险：任何「无头 World」若不先抽核，就会把门/桥/感知/战斗再写一遍，形成第二权威；这正是 AI-NATIVE-01 §4.1 明令禁止的「复制规则」。
- 可执行检查（开发者）：
  1. 定义 `WorldCore`（纯 TS，无 Phaser/DOM），独占位置、HP、弹丸、掉落、RNG、房间/门/桥；`step(fixedTick)` 为唯一推进入口。
  2. Phaser 侧只做两件事：采样人类/AI 意图、渲染 core 状态；删除 `World.update` 里的规则计算。
  3. 加 parity 测试：同一初始 core + 同一有序意图序列，`World` 适配器与无头 core 输出一致（至少 position/hp/伤害事件）。
  4. 禁止在 `World`/`Player` 内出现 `if (headless)`。

### R-02（P1 阻断）变长 dt + 非种子随机 + 新局随机 seed ⇒ 主 World 不可重放
- 证据：
  - `src/scenes/GameScene.ts:257-259` 用 `delta/1000` 推进 `world.update`；所有速度/计时/弹丸扫掠都乘 `dt`（`Player.ts`、`Enemy.ts`、`Boss.ts`、`World.ts:468+`）。
  - `src/scenes/GameScene.ts:86` 新局 seed = `Math.floor(Math.random()*1e9)`；`src/world/World.ts:62` 另有自建 RNG；`src/world/World.ts:644` `killBoss` 用 `Math.random()` 布掉落；`src/world/World.ts:433` `spawnLoot` 默认 bob 用 `Math.random()`。
- 风险：AI 动作「同一输入 → 同一结果」在变长 `dt` 下不成立；`reset` 后无法保证同图或新图可复现。若把主 World 直接接到 `SnapshotV1/ReplayV1`，是虚假确定性。
- 可执行检查：
  1. 固定逻辑 tick（先在 core 内定 60Hz 与 frame 上限），`dt` 只用于渲染插值。
  2. 所有玩法随机（暴击、掉落、召唤、bob）走显式 seeded RNG；seed 由 run 显式注入，禁止 `Math.random`。
  3. 明确声明范围：在 core 抽完前，**不得**对外宣称主 World 可 replay/state-hash；仅可声明「意图适配 + 观察投影」。

---

## 4. 高优先风险（P1 迁移前应修）

### R-03（高）`captureCheckpoint` 返回活引用，不能当 AI-Native 快照/证据
- 证据：`src/world/World.ts:685` `player: this.player.data`（对象引用）、`:686` `loot: this.loot.map(({data}) => data)`（数组元素引用）。落盘靠 `SaveSystem` 立即 `JSON.stringify` 才安全，但任何内存持有者（Gateway、AI harness、测试）拿到的是会继续变化的帧。
- 风险：观察/回放/存档一致性被静默破坏；R9「证据与位置/效果/tick 同一原子快照」无法满足。
- 可执行检查：`captureCheckpoint` 深拷贝（或显式不可变信封）；加测试「capture 后继续 update，帧内容不变」。

### R-04（高）主 World 无观察白名单；协议黑名单不含 World 字段
- 证据：`src/ai-native/protocol.ts:213-231` 的隐藏字段黑名单是 Station Zero 口径，含 `state/mapdata/tiles/roomsorder/enteredrooms/enemies/projectiles/loot/patrolpoints/statetimer` 等，但**不含**主 World 的 `boss`、`phase`、`won`、`portal`/`targetRoom`、`spawned`/`cleared`、`currentRoomId`、`spawnRoom`、`_hp`。`World` 的 `map/enemies/boss/projectiles/loot` 均为 public（`World.ts:31-40`）。
- 风险：直接投影 `World` 会泄漏未探索房间、敌人内部与 Boss 阶段；黑名单是「名字匹配」，不能靠它兜底。
- 可执行检查：
  1. 新建 `WorldObservationV1` 白名单 schema（只含当前房间、可见实体、玩家自身、公开计时/资源、已发现连接），以及独立的 `WorldDebugInspectionV1`。
  2. 把 `boss/phase/won/portal/targetRoom/spawned/cleared/currentRoomId/spawnRoom/_hp/hitflash` 加入 World 版黑名单。
  3. 加负向测试：未进入房间的 id、未发现敌人、`boss.phase`、`portal.targetRoom` 在 Player 观察中永不出现。

### R-05（高）控制所有权：runtime 层 actor 只是标签，信任完全依赖调用方
- 证据：
  - `src/ai-native/runtime.ts:813-845` `applyAction` **完全不读** `action.actor`：`move/scan/jam/interact` 一律作用到同一个 `model`（human 的 Energy/门/位置）。
  - `src/ai-native/runtime.ts:522-523` `observe(identity)` 直接信任调用方传入的 `actorId/epoch`。
  - `src/ai-native/runtime.ts:808` `__testSetPosition` 是 public 方法，无 dev/test 门禁（仅注释声明 test-only）。
  - 目前生产路径靠 Gateway 兜住：`src/ai-native/sessions.ts:698` 拒绝 COMPANION step、`:812` 校验 `actorId`、`:1511` 只给 OWNER `pause/resume/reset`。
- 风险：一旦主 World 直接持有 `HeadlessGame`/core（绕开 Gateway），AI 就能以别的 actor 身份观察/操作或瞬移。这与 A-B2「actorId 必须与 AuthContext 绑定」冲突。
- 可执行检查：
  1. 规定「core/`HeadlessGame` 只能由 Gateway 持有」；用 lint/测试断言渲染层与 AI 适配层不 import runtime/`HeadlessGame`。
  2. `__testSetPosition` 改为需显式 test 令牌，或移出公开类。
  3. runtime `step` 在只允许单 actor 的场景里拒绝 `actor:'echo'`，除非显式注册表授权（现在 echo 与 player 同权）。

### R-06（高）reset / 死亡 / 存档边界：reset 复用同一 seed，且 runtime 无 reset
- 证据：
  - `src/ai-native/sessions.ts:665-679` `reset()` 用 `seedOf()`（= 当前 game.seed，`:1419`）新建 game → **同一 seed/同图/同 sessionId/actorId**，只 `epoch+1`、换 `runId`。
  - `src/ai-native/runtime.ts` 无 `reset()`；`HeadlessGame` 的 sessionId/actorId 由 seed 派生（`:41-46`）。
  - 主 World：`src/scenes/GameScene.ts:437-448` 死亡 `finishRun(false)` 清 run、`GameOverScene`；`:449-453` 胜利 `finishRun(true)`；`SaveSystem.finishRun` (`src/systems/SaveSystem.ts:184`) id 不匹配即拒绝——这部分语义正确。
- 风险：主 World 的「新 run」必须换地图 seed；若沿用 Station Zero 的 reset 实现，会变成 replay 同一局。死亡也绝不能被当成 checkpoint 续局（A-B4）。
- 可执行检查：
  1. 明确定义 World `reset`：新 seed（或显式注入）→ 新 runId + 新 epoch + R0；不复用上一局存档。
  2. 加测试：死亡 → `step` 被拒 → `reset` → 新身份/新图/空证据；旧 epoch 请求 `E_STALE_EPOCH`。
  3. 明确「退出/刷新才恢复最近安全点」，与 AI 可调命令区分。

---

## 5. 中/低优先风险

### R-07（中）碰撞谓词不统一 + `ensureWalkable` 6 格传送
- 证据：`src/world/World.ts:145` `isWalkable` 采样 4 角、默认半径 0.5（Player 0.5、敌人击退 0.4）；Station Zero 侧 `src/slice/room.ts` `canFit` 是「中心 + 4 角」、半径 0.35。`src/entities/Player.ts:99` `ensureWalkable` 在卡住时向最近可走格**瞬移最多 6 格**（`:288` 受击后也会调用）。
- 风险：AI `move` 若走不同谓词，会出现「人能过 AI 不能过」或反之；击退 + 瞬移可能绕墙。
- 可执行检查：把半径与采样点抽成单一 `canStand`；AI 动作只能调用它；加测试「AI 永不进墙/永不穿门；瞬移路径不可被 AI 直接触发」。

### R-08（中）瞄准/开火绑定 Phaser pointer 与 camera
- 证据：`src/entities/Player.ts:140` `aimFromPointer` 读 `scene.cameras.main.getWorldPoint(pointer.x,pointer.y)`；无「按网格坐标设向」入口。
- 风险：无头/AI 分支会去伪造 Phaser pointer 或直接写 `aimYaw`，绕过人类同路径。
- 可执行检查：新增 `setAimGrid(x,y)` 适配方法（grid→`aimYaw`），人类指针路径与 AI 路径调用同一射向设置；AI 不得触达 `cameras`。

### R-09（低）`onLoot` 回调声明但从不触发；`statsSnapshot()` 恒返回 0
- 证据：`src/world/World.ts:21` 声明 `onLoot`，但全文件无调用；拾取只走 `onStats`（`:601`）。`src/world/World.ts:725` `statsSnapshot()` 恒 `{0,0,0}`。`src/scenes/GameScene.ts:101` `onLoot: () => {}`。
- 风险：若 AI-Native 以 `onLoot` 或 `statsSnapshot` 为事件/统计来源，会永远为空。
- 可执行检查：要么删除误导性接口，要么在 `collectLoot`/击杀处真正触发并加测试。

### R-10（流程红线）三类冒充必须持续排除
- 本地确定性控制器（`localController.ts` 类型工作）**不是**真实 LLM；浏览器自动化**不是** Headless；开发者自测**不是**独立验收。
- 可执行检查：验收证据必须能区分「外部 agent 经正式 Player/MCP 通道」与「本地控制器」；`control.ts` 的自述注释（本地 demo、非 LLM）应保留并有对应测试/日志标签；Headless 结论只能来自 Node 进程的 core 回放，不能来自 Phaser 截图或浏览器脚本。

---

## 6. 审查时工作树状态（非验收）

审查时 `git status` 非干净，`developer` 的并发 WIP 包括：`M src/world/World.ts`、`M src/entities/Player.ts`、`M src/scenes/GameScene.ts`、`M src/scenes/PauseScene.ts`、`?? src/ai-native/control.ts`、`?? src/ai-native/localController.ts`、`?? src/ai-native/control.test.ts`、`?? tests/ai-native-world.spec.ts`。文件哈希见 `reports/ai-native-02/reviewer/baseline-git.log`。

这些 WIP **不属于本报告的审查结论**，也不构成最终验收；它们只说明开发者正在向 `control.ts` 的「纯意图 + 人类/AI 同一执行路径」方向铺路，与本报告 R-01/R-05/R-08 的方向一致。实现审查将另行派发。

---

## 7. 给开发者的最小检查清单（P1 迁移）

1. [ ] `WorldCore` 纯 TS 抽核完成前，不宣称主 World 确定性/replay。
2. [ ] 主 World 所有随机走 seeded RNG，seed 显式注入；删 `Math.random()`。
3. [ ] 固定逻辑 tick；`dt` 只做渲染插值。
4. [ ] AI 与人类共用同一 `canStand` + 同一射向入口；AI 不触达 Phaser pointer/camera。
5. [ ] `captureCheckpoint` 深拷贝，或改名为「活视图」并禁止外发。
6. [ ] 新建 `WorldObservationV1` 白名单 + 补 World 字段黑名单 + 负向测试。
7. [ ] core/`HeadlessGame` 只由 Gateway 持有；`__testSetPosition` 加门禁。
8. [ ] `reset` = 新 seed + 新 runId + 新 epoch + R0；死亡不可续局；旧 epoch 拒绝。
9. [ ] 保留「本地控制器 = demo、非 LLM」标签，验收证据区分外部 agent 与本地控制器。
