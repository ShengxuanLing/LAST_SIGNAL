# P3 ECHO 第二 Actor 接缝 —— 最小可实现范围（只读评估）

- 分支 `feat/ai-native-world-integration`；本单**未改任何源码**，只做只读评估。
- 基线事实：`82734f6`（C3c）冻结验收中；Lead 真实单 drone MCP 遭遇已由 Reviewer 关闭最小 Agent 子项（`reports/ai-native-02/reviewer/lead-live/REVIEW.md`），**不是待审**。
- 本文件不构成“整套架构”，只给**最小 P3-a / P3-b** 的可实施扩展、范围、风险与演示步骤。

## 0. 当前真实状态（决定能做/不能做）

| 事实 | 依据 |
| --- | --- |
| 主 World 只有一个权威 `SimulationState`，tick 唯一写入 | `src/world/sim/core.ts:963 stepSimulationTicks`（`processCommands → stepPlayer → stepDrones → stepProjectiles → stepLoot → tick++`） |
| 玩家移动/开火/受击是**模块私有**、硬编码 `state.player` | `stepPlayer`(699)、`stepPlayerFire`(629)、`applyCorePlayerHit`(795)、`tickPlayerTimers`(610) |
| 纯规则已存在且可复用 | `src/world/sim/rules.ts`：`stepPlayerMovement`、`buildWeaponSpec`、`createProjectileData`、`advanceProjectile`、`resolveEnemyHit`、`resolvePlayerHit`、`aimYawFromGrid` |
| 主 World **没有** Signal / energy / scan / jam | `core.ts` 无相关字段；`scan/jam` 只在 StationZero `src/slice/rules.ts`（不同场景） |
| 已有“echo”概念但仅在 StationZero 隔离测试 | `src/ai-native/coop.ts`（`echo-coop-test`，不是正式 World） |
| 观察裁剪是玩家中心 | `World.observationView()`(449) + `worldObservation/worldPerception`（12 格 + 已探索 + LOS） |
| 存档只保存玩家核心 + `coreState` | `RunCheckpoint`/`CoreCheckpointState`（`src/types/index.ts:96`），`World.captureCheckpoint/restoreCheckpoint` |
| HUD 右列固定 7 行，五视口测试逐项断言不重叠 | `tests/ai-native-world.spec.ts:167`（`txtWeapon…txtAgentLink`） |

**结论**：ECHO 不需要也不应该另造一套 World/战斗规则；最小正确做法是**把玩家 actor 的 step/fire/hit 抽成“对任意 actor 状态生效”的纯函数**，再给 echo 一个独立 `SimEchoState` 走同一 tick。

## 1. P3-a：纯 Actor + 可见确定性 fallback（建议先做）

### 1.1 状态扩展（core，最小）

```ts
// src/world/sim/core.ts（新增）
export interface SimEchoState {
  actorId: 1;                 // 独立 actorId（玩家固定 0）
  x: number; y: number;
  hp: number; maxHp: number; armor: number;
  weaponKey: 'pulse';         // 复用既有武器；pulse ammo=-1 是既有语义，不新增 Energy
  angleYaw?: never;           // 用 aimYaw
  aimYaw: number;
  fireTimer: number;
  invuln: number; hurtTimer: number;
  ammo: number; magazine: number;   // pulse = -1/-1
  cooldownReduced: number; damage: number; critChance: number; critDamage: number; pierceCount: number;
  mode: 'follow' | 'hold' | 'moveTo' | 'assist';
  downAtTick: number | null;  // 0=up；死亡/倒地不删除 actor
}
export interface SimulationState {
  // ...现有字段
  echo?: SimEchoState;        // **可选**：缺省时 C2 canonical 完全不变
}
```

关键：`echo?` 可选，`canonicalSimulationState` **仅当存在时**才把 `echo` 加入 JSON。这样 C2 冻结 fixtures/parity 不变；有 echo 的会话才有新 hash。

### 1.2 纯函数抽取（不复制规则）

把现有私有实现改成“接收 actor 参数”的通用函数，玩家与 echo 共用：

```ts
// core.ts
export interface ActorCombatState { x; y; hp; maxHp; armor; aimYaw; fireTimer; invuln; hurtTimer;
  weaponKey; ammo; magazine; cooldownReduced; damage; critChance; critDamage; pierceCount; }

export function stepActorMovement(state, actor, intent, dt, radius = PLAYER_RADIUS): {moved, dashStarted}
  // 内部就是 stepPlayerMovement + isWalkableFromState(state,x,y,radius)
export function stepActorFire(state, actor, intent, rng, events, ownerId: number, source: 'player'|'echo'): void
  // 内部与 stepPlayerFire 完全同一段（weaponCooldown/createProjectileData/toSimProjectile）
export function applyActorHit(state, actor, fromX, fromY, damage, events, actorName: 'player'|'echo'): void
  // 内部与 applyCorePlayerHit 同一段（resolvePlayerHit）
export function tickActorTimers(actor, dt): void
```

`stepPlayer` 改为调用这些函数（行为逐字节一致，C2 回归保护）；新增 `stepEcho(state, echoIntent, rng, events)` 在 tick 循环 `stepPlayer` 之后调用。**没有新战斗公式**。

Projectile：echo 子弹 `side:'player'`（与敌方碰撞逻辑复用）、`source:'echo'`、`ownerId:1`；`stepProjectiles` 不动，仅 `enemy-hit` 事件可选加 `byActor: 0|1` 供 HUD 归因（additive，不带位置/HP 篡改）。

### 1.3 观察 / 权限 / 记忆

- `World.echoObservationView()`：以 echo 为中心，复用 `buildWorldObservation` + 同一 `isPerceivable`（**不改裁剪半径/规则**）。echo 看不到玩家私有数据，也看不到未探索房间。
- echo **不是** `ControlOwner`（保持 `human|ai|external`）；它是世界内第二 actor。任何 UI/MCP 都不能直接写 echo 位置/HP，只能提交 `EchoIntent`（与 `SimulationIntent` 同形）。
- 记忆：`src/ai-native/echo.ts` 的纯 ring buffer（≤16 条，TTL ticks，存 perceived 目标/房间），无全图。

### 1.4 确定性 fallback（LLM 不每帧移动）

```ts
// src/ai-native/echo.ts（纯函数，无 Phaser）
export function echoFallbackIntent(input: {
  echo: {x;y}; player: {x;y}; mode: SimEchoState['mode'];
  targets: Array<{id;x;y;hp}>; memory; tick;
}): SimulationIntent
// follow: 距玩家 > 2.5 tile 时朝玩家移动，否则 neutral
// hold: neutral
// moveTo: 朝记忆中的目标点，到达后 hold
// assist: 朝记忆中的最近 perceived 敌人开火（aim=目标，fire=true），无目标则 neutral
```
调用频率：**每 6 tick（100ms）最多一次**，其余 tick 复用上次 intent；断线/无模型 → 永久 fallback，不阻塞 tick。

### 1.5 渲染 / HUD（五视口）

- 临时美术：`src/core/EchoSprite.ts` 用 `Phaser.Graphics` 生成独特形状纹理（**code-native，不做 AI 美术**）；`World` 只负责 `setPosition` 同步（与 `coreProjectileViews` 同一模式）。
- HUD 新增右列一行 `txtEcho`（`ECHO FOLLOWING · HP 24` / `SUGGEST: FOCUS FIRE` / `ECHO DOWN`）；目标线用 `Graphics` 短线（echo→当前 assist 目标），可在设置里关闭。
- **必须**改 `tests/ai-native-world.spec.ts`：`hudRects` 名单加 `txtEcho`、右列期望 7→8，仍断言不重叠 + 最小行 ≥10 CSS px + 五视口。这是**有意更新**，不是放宽断容。

### 1.6 存档 / 死亡 / 场景迁移 / 模式切换

- `CoreCheckpointState` 新增可选 `echo?: {x,y,hp,maxHp,armor,weaponKey,ammo,magazine,aimYaw,fireTimer,invuln,hurtTimer,mode,downAtTick}`；`RunCheckpoint` 校验（类型/范围/长度）与 `cloneCheckpoint` 深拷贝。
- 玩家死亡：`echo.mode='hold'`，不删除；Run 结束/场景退出：不写回永久存档。
- 场景迁移（room-enter/teleport）：echo 通过 `teleport-echo` 命令跟随，同 tick 提交，无直接坐标写。
- 模式切换（pause/level-up/inventory）：只暂停 tick，echo 不单独推进；恢复只解冻（延续 C2 “resume 不强制 tick”）。

## 2. P3-b：合法 Companion 网关 + 建议/确认 + 有限记忆

- **Facet**：在 `sessions.ts` 模式上新增 `CompanionHandle`（`observe`/`suggest`/`confirm`/`status`），与 Player/Owner/Test 严格隔离；Player 面 MCP 工具 `echo_observe` / `echo_suggest` / `echo_confirm`（Player 权限），**不提供** seed/fixture/HP 写。
- **建议**：`EchoSuggestion { id, kind:'moveTo'|'focusFire'|'hold', target{id,x,y}|null, reason, confidence, expiresAtTick }`。只有**人类确认**后才转为 `EchoIntent`；未确认/过期不发。确认命令走 core tick（`echo-intent` 命令），不是直接执行。
- **记忆**：同一 ring buffer 暴露给 `echo_observe` 的 `knownTargets`（有 TTL/上限），不泄漏全图。
- **断线安全**：Companion 断开 → 立即 `fallback`（follow/hold），不自动重连、不自动接管玩家；epoch 复用 C3-a 语义（旧 epoch 拒绝）。
- **LLM 节奏**：模型只在 `echo_suggest` 调用时参与；移动/开火由确定性 fallback 或已确认建议驱动，**不做每帧推理**。

## 3. 真正支持 / 不支持（不要伪造）

- ✅ 支持：独立 `actorId=echo`、独立位置/HP/冷却/观察/权限/记忆；沿用真实 physics/fire/damage；`pulse` 无限弹药是既有武器语义；临时 sprite 用 code-native 形状。
- ⛔ 主 World **无 Signal、无 energy**：`scan`/`jam`/`decoy` **不可伪造**。后续若需要，只能**最小整合**现有 `src/slice/rules.ts` 的纯 Signal（scan 冷却/证据/jam 计时），并作为显式玩法变更单独立项；**本单不发明**。
- ⛔ 不给 echo：玩家 `PlayerData` 共享、免费技能/升级、Purchase Ledger 写入、Owner/Dev 工具、`set-player-data`。
- ⛔ 敌人 AI 仍只追玩家（P3-a）。让 drone 选择 echo 作为目标属于**规则变更**，需 Lead 明确批准后放 P3-b（加 pure 函数 + 单测 + parity）。

## 4. 变更范围与风险

| 范围 | 文件 | 预估 |
| --- | --- | --- |
| core actor 抽取 + echo step | `src/world/sim/core.ts` | ~180–240 行（重构 + 新函数） |
| 类型/存档 | `src/types/index.ts`、`src/systems/RunCheckpoint.ts` | ~40 行（可选字段 + 校验） |
| World 适配 | `src/world/World.ts`、`src/core/EchoSprite.ts` | ~120 行（sprite/同步/echo 观察/checkpoint） |
| 纯 AI | `src/ai-native/echo.ts`（新）、`worldObservation.ts` | ~120 行 |
| HUD/场景 | `src/scenes/GameScene.ts` | ~40 行 |
| 测试 | `src/world/sim/echo.test.ts`、`src/ai-native/echo.test.ts`、`tests/p3-echo.spec.ts`、更新五视口 spec | ~250 行 |
| P3-b 网关 | `src/ai-native/companion*.ts`、`sessions.ts`/MCP | 独立小步 |

**风险**
1. **canonical/parity**：`echo` 必须可选，默认不改变既有 hash；若某会话带 echo，需新增 fixture 并重跑 C2 parity。
2. **checkpoint 兼容**：旧存档无 `echo` 必须可读；校验失败要拒绝而不是静默。
3. **单一权威**：echo 位置/HP 只能由 core tick 改；UI/MCP 只能给 intent。
4. **五视口**：加 HUD 行必须同步更新测试名单与列数，不能靠压缩字号硬塞。
5. **战斗平衡**：echo 输出会让清房更快；P3-a 默认 `assist` 只在**人类确认后**开火，避免“免费 DPS”。
6. **观察泄漏**：echo 观察必须走同一 `isPerceivable`，不能复用玩家 center。

## 5. 真实双 Actor 演示步骤（P3-a 可验证）

1. `npm run dev` → NEW RUN → 进入含真实 drone 的房间（或用现有 Dev 夹具 `spawnEnemy('drone', …)`）。
2. 按 `C` 部署 ECHO（P3-a fallback）：HUD 右列出现 `ECHO FOLLOWING · HP …`，场上出现不同形状 sprite。
3. 人类自由移动；echo 保持 2–3 tile 跟随；HUD 显示 FOLLOWING；按 `H` 切 HOLD。
4. 按 `G` 请求建议：HUD 显示 `SUGGEST: FOCUS FIRE <drone>`，显示 echo→目标线；`Y` 确认。
5. 确认后 echo 用同一 `stepActorFire` 对真实 drone 开火；drone HP 下降（读 HUD/observation），击杀计入真实事件。
6. 人类按 ESC 暂停 / 升级 / 背包 / 开门迁移 / 死亡：echo 冻结或 hold，不单独 tick；恢复只解冻。
7. 存档→退出→重进：echo 位置/HP/冷却恢复；`GET /` 五视口截图，右列 8 行不重叠。
8. 断线/无模型：echo 仅 fallback，不静默接管玩家。

## 6. 建议小步与验收

- **P3-a-1（core）**：抽 actor 纯函数 + `SimEchoState?` + `stepEcho`；单测：玩家行为与旧实现逐 tick 一致、echo movement/fire 用同一函数、无 echo 时 canonical 不变。
- **P3-a-2（rendered）**：sprite + follow/hold + HUD 行 + 五视口 + checkpoint 字段；单测/Playwright。
- **P3-a-3（parity/save）**：带 echo 的 canonical/events parity、存档往返、死亡/迁移。
- **P3-b-1（companion facet）**：`CompanionHandle` + MCP `echo_observe/suggest/confirm/status` + 权限/epoch/断线单测。
- **P3-b-2（建议/记忆）**：有界记忆 + 确认后才执行 + 过期/重复 request 不执行。
- **P3-c（可选，单独立项）**：最小整合 `src/slice` 纯 Signal（scan/jam），需 Lead 明确玩法批准；不在本轮。

**验收口径**：type/unit/build/MCP/default 隔离、C2 回归与 parity（无 echo 时 hash 不变；有 echo 时新 fixture）、五视口 HUD、真实双 Actor 演示（drone HP 实际下降 + 击杀事件）、断线 fallback、存档/死亡/迁移。**不宣称 Signal/LLM 自主战斗/完整 P2 完成。**

## 7. 依赖与前置

- 等 `82734f6` 的 C3c 独立结论；若 C3c 有硬阻断先修，不在其上扩张。
- 不 merge/push/stash；P3 实现由 Lead 另行派单后开始，本单不改代码。
