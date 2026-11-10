# LAST SIGNAL 0.2.0 — Signal 系统技术设计与架构审计（PHASE 2）

> 本阶段只完成设计审计，未授权实现
> 本文是 `0.1.0` → `0.2.0` 的**技术设计提案与架构审计**，**不实现任何功能**。
> 当前项目版本 `0.1.0`（`package.json`），技术栈 Vite 5 + TypeScript 5 + Phaser 3.90（CANVAS），
> 定位为 2.5D 等距射击 Roguelite + Signal Manipulation + Native AI Agent Co-op。
> 本文是 6 份 `0.2.0` 设计文档中的 Signal 主题文档，统一事实基座为 workspace 下的 `audit/FACTS.md`。
> **本阶段唯一交付物为 `docs/` 下 6 个新建设计文档；本文只写自身，不写 6 个文档之外的任何文件；不改源码、不装依赖、不初始化 Git、不提交 commit**。
> 不修改任何游戏源码、不修改 `docs/STYLE_GUIDE.md`、不写 `dist/` / `test-results/` /
> `tests/screens/` / `node_modules/`、不安装依赖、不初始化 Git、不提交 commit。

**状态标签约定（全文统一）**：`【已实现】` = `0.1.0` 现状事实；`【需扩展】` = 在已有文件/类型上加能力；
`【需新建】` = 全新文件/模块/测试（当前不存在）；`TBD — Requires User Decision` = 需要用户拍板，
并在末尾 `## 待用户确认事项` 写明具体问题。**本文所有 Signal 内容一律属于 `0.2.0` 设计提案，
绝不代表 `0.1.0` 已实现。**

**阶段编号（严格按 FACTS §7.1）**：

| 阶段 | 定位 | 与本文关系 |
| --- | --- | --- |
| PHASE 0 — 工程基线 | Git 初始化（PHASE 0 Task 0.1，本阶段未授权，需用户确认后执行）、CI/基线回归固化、**坐标/半径/屏震根因修复**、生产包分包 | **PHASE 0 是 PHASE 2 的硬前置**：半径单位混用不解决，Signal 半径与 falloff 会失真 |
| PHASE 1 — 可玩闭环与内容深度 | 真实读档与局内快照、首房到 Boss 胜利 E2E、8 种房间玩法差异、武器/升级差异化、世界观 | 与 Signal 房间类型、`extraction` 是否启用相邻，但不属于本文实现范围 |
| **PHASE 2 — Signal 系统核心** | Signal 数据模型、确定性传播/falloff、Scan/Jam/Decoy、Signal Energy、敌人感知接入 FSM、环境设施状态、Signal 专属测试房间、单元与运行时测试 | **本文全部设计内容归属此阶段** |
| PHASE 3 / 4 / 5 | Agent Bridge / Human–Agent Co-op / 0.2.0 集成发布 | 仅作口径对齐：`observe_signals` / `action_signal`、Mode A 默认无 AI 可独立运行 |
| 版本节奏 | `0.2.0-beta` = PHASE 2 | 具体日期 `TBD — Requires User Decision` |

---

## 1. 现状基线（【已实现】事实，逐字核对结论）

1. **当前源码里没有任何 signal 相关实现**【已实现】：经逐字核对与检索，`src/` 中 `signal` 字样仅出现在
   `src/config/game.ts` 的 `SAVE_KEY = 'last_signal_save_v1'`、`src/systems/SaveSystem.ts` 的
   `STORAGE_KEY`、UI 文案（`LAST SIGNAL`、`SIGNAL LOST. SIGNAL REMAINS.`、`SIGNAL LOST`、
   `EXTRACT COMPLETE`）以及注释中；**没有任何信号数据结构、传播、能力、能量或测试**。
2. **不存在的东西（严禁写成已有）**【已实现】（指"经核实当前不存在"这一事实）：目录
   `src/systems/signal/`、`src/systems/agent/`、`src/bridge/` 等；类/接口 `SignalSystem`、
   `SignalBus`、`SignalManager`、`SignalComponent`、`SignalEnergy`、`ScanAbility`、`JamAbility`、
   `DecoyAbility`；配置 `SIGNALS` / `SIGNAL_TYPES` / `SIGNAL_ENERGY`；测试
   `tests/signal.spec.ts`、`src/systems/signal/*.test.ts`；任何 `emit('signal:*')` 事件。
   本文出现这些名称时**一律标注 `【需新建】` 且为提案路径/名称**。
3. `src/types/index.ts`【已实现】导出 `Vec2, Direction, HealthComponent, EntityBase, Stats,
   PlayerData, WeaponState, WeaponKind, WeaponDef, EnemyKind, EnemyStateName, EnemyStats,
   EnemyData, TileType, Tile, RoomKind, Room, MapData, ItemKind, LootDrop, ItemDef, UpgradeDef,
   UpgradeProgress, HudData, SaveData, SAVE_VERSION = 1, ProjectileData, HitFx, GameEventType,
   GameEvent`；**没有 Signal 类型**。
4. `src/core/eventbus.ts`【已实现】：`class EventBus`（`on/emit/emitDeferred/flush/has/clear`）与单例
   `export const gameBus = new EventBus()`；`gameBus` 在整个 `src/` 与 `tests/` 中**只有定义处一次出现，
   没有任何 import、订阅或发布**；`emitDeferred()` / `flush()` 无外部调用者；`GameEventType` 与
   `GameEvent` 在 `src/types/index.ts` 仅声明未使用。当前真正的解耦机制是 `WorldCallbacks`
   （`src/world/World.ts` 导出：`onLevelUp / onDeath / onRoomCleared / onRoomEntered / onLoot /
   onStats / onBossWin`），由 `GameScene.create()` 构造并传给 `new World(this, map, save, callbacks)`。
   `World` 内 `roomClearedHandlers`、`statsSnapshot()` 未使用，`GameScene` 的 `onLoot: () => {}` 为空实现。
5. `src/entities/Enemy.ts`【已实现】：`private detects(player: Player): boolean {
   return this.distanceTo(player) <= this.data.stats.aggroRange; }` 是**唯一感知入口**，纯欧氏距离
   （`distanceTo()` 用 `player.x - this.x`、`player.y - this.y`，即 `wx/wy` 网格坐标），
   **无视线 / 遮挡 / 噪声 / 信号概念**。
6. `src/config/weapons.ts`【已实现】：`WEAPONS` 有 `pulse / scatter / plasma / arc` 四把，
   `WeaponDef` 字段固定为 `key, kind, name, description, baseDamage, baseRate, baseSpread,
   baseProjectileSpeed, baseRange, magazine?, reloadTime?, critBase, icon, levelDamage(l),
   levelRate(l), levelRange(l)`，**没有任何 signal 字段**；`Player.tryFire()` 只调用
   `World.spawnProjectile()`（另有一次 `audio.shoot(w.kind)` 音效），**没有任何信号发射**。
7. `src/world/MapGenerator.ts`【已实现】：`assignRoles()` 只赋 `start / boss / elite / resource /
   shop / event / combat` 共 7 种；`RoomKind` 声明 8 种字面量，`extraction` **从未被赋值、
   没有任何游戏逻辑**（`GameOverScene` 只有结算文案 `'EXTRACT COMPLETE'`）；`event` 与 `combat`
   在玩法上无差异。`GameScene.buildMap()` 在 `generate()` 已调用 `assignRoles` 之后**又显式调用一次**。
8. `src/config/enemies.ts`【已实现】：`ENEMY_STATS` 的 `aggroRange` 以 screen-px 书写
   （`drone 340 / stalker 300 / sentinel 240 / hunter 420 / boss_warden 99999`），
   `Enemy` 构造里 `stats.aggroRange /= 64` 转为网格单位。
9. `src/core/random.ts`【已实现】：`RNG`（Mulberry32，`fromSeed()` / `seed()` / `float()` / `int()` /
   `range()` / `boolean()` / `pick()` / `pickWeighted()` / `shuffle()`）+ `dist()` / `distSq()` /
   `clamp()` / `lerp()` / `nowMs()`（后者是 `performance.now()`）。`MapGenerator` 用 `new RNG(seed)`，
   `World` 用 `new RNG(map.seed * 7919 + 1)`；`MapData.seed` 保存种子，
   `GameScene.create(config: {seed?, isNewRun?})` 设置 `this.seed`。
10. 测试现状【已实现】：`src/core/runtime.test.ts`（Vitest，7 tests）、`tests/audit.spec.ts`
    （2 tests，`PORT=5173`、`SEED=424242`、`LS_SHOT_DIR`、`window.__game`、`gridToScreen()`、
    `worldState()`）、`tests/canvas.spec.ts`（1 test，硬编码 `http://localhost:5199/`）、
    `tests/gameplay.spec.ts`（1 test，`PORT=5173`）。**没有任何 Signal 测试**。

---

## 2. ★ 坐标铁律（PHASE 0 前置 / PHASE 2 强制约束，单独成节强调）

> **本节是全文最高优先级约束。任何 Signal 设计违反本节即视为无效。**

**铁律**：Signal 的**一切**距离、传播、falloff、半径、感知阈值、**一律使用 `wx/wy` 网格坐标
（tile-world units）**，与 `World.worldToScreen()` / `World.screenToWorld()` / `World.tileAt()` /
`World.isWalkable()` 所使用/输入的**同一个坐标系**。
**禁止混用屏幕像素、等距投影坐标、或 `World.worldToScreen()` 的输出**作为 Signal 距离计算的输入。

### 2.1 真实坐标链（【已实现】）

- `Player` / `Enemy` / `Boss` 都持有公开 `wx/wy`，`get x()` / `get y()` 返回它们【已实现】。
- `src/core/iso.ts`【已实现】：`isoToScreen(x,y) = { x:(x-y)*32, y:(x+y)*16 }`，
  `screenToIso()` 为逆变换，`IsoMath.TILE_W=64` / `TILE_H=32`；
  `World.worldToScreen(x,y)` = `isoToScreen(x,y)` + `WorldRenderer._offX/_offY`，
  `World.screenToWorld(sx,sy)` = `screenToIso(sx-_offX, sy-_offY)`。
  **`worldToScreen()` 的输出是显示空间（含地图偏移），不是网格坐标，Signal 绝对不能在它上面算距离。**
- `World.tileAt(worldX, worldY)`【已实现】：`gx = Math.floor(worldX) - _minX`、
  `gy = Math.floor(worldY) - _minY`，越界返回 `{type:'wall',height:0}`；
  `World.isWalkable(worldX, worldY, radius=0.5)`【已实现】：采样外接方 4 个角点，
  任一 `tileAt()` 为 `wall` / `lava` / `water` 即返回 false。
- `Enemy.detects()` 的 `distanceTo()`、`Enemy.moveToPlayer()` / `moveAlongPatrol()` /
  `reposition()`、`World.updateProjectiles()` 的命中判定、`World.tryInteract()` 的
  `Math.hypot(dx,dy) < 22`【已实现】：**全部在 `wx/wy` 网格坐标上计算**。
  `Player.aimFromPointer()` 先把 `cam.getWorldPoint()` 结果送入 `world.screenToWorld()` 得到网格点，
  再算 `aimYaw`；`World.addDamageNumber()` / `addHitFx()` 接收网格坐标、内部才转显示空间。

### 2.2 既有单位换算约定（【已实现】）

- `GAME.PIXEL_TO_TILE = 64`（`src/config/game.ts`，注释明确："Combat speed/range fields in configs
  are authored in screen-px; divide by this to express them in tile-world units"）。
- 配置里的速度/射程**以 screen-px 书写、运行时除以 64 转 tile-world**【已实现】：
  `Player.tryFire()` 的 `speed: w.baseProjectileSpeed / GAME.PIXEL_TO_TILE` 与
  `lifetime: w.baseRange / w.baseProjectileSpeed`；
  `Enemy` 构造的 `stats.speed /= 64; stats.aggroRange /= 64; stats.attackRange /= 64`；
  `Enemy.doAttack()` / `Boss.toTilesPerSecond()` 的 `160 / GAME.PIXEL_TO_TILE`；
  `World.spawnProjectile()` 的 `px = x + Math.cos(a) * 16 / GAME.PIXEL_TO_TILE`。
- **Signal 提案约束**【需新建】：`Signal.radius`、falloff 的距离参数、感知阈值、设施作用半径
  **必须直接写成网格单位**；若为了沿用配置习惯而用 screen-px 书写，则**必须**在入口显式
  `/ GAME.PIXEL_TO_TILE` 并在类型/注释中标注，禁止把 `WEAPONS.baseRange`（如 `pulse 520`、
  `arc 240`）或 `ENEMY_STATS.aggroRange`（如 `hunter 420`）**未经换算**直接当作网格半径填充。

### 2.3 PHASE 0 必须先解决的历史遗留（FACTS §4.1）

- **碰撞半径单位混用**【已实现】（指该缺陷现状存在、根因未修）：`Player.getRadius()=0.5`、
  `Enemy.getRadius()=0.5`、`Boss.getRadius()=3.0` 是网格单位；但
  `World.spawnProjectile()` 把 `ProjectileData.radius` 设为 `5` / `6`（像素量级）、
  `World.spawnEnemyProjectile()` 设为 `6`，而 `World.updateProjectiles()` 直接比较
  `e.getRadius() + p.data.radius`。**两套单位混用，根因未修。**
- 屏震同源问题【已实现】：`GameScene.update()` 传 `cam.shake(100, world.shakeAmount * 8)`，
  Phaser 期望 intensity 为视口比例，靠 `WorldRenderer._clampCameraShake()` 在 `prerender`
  钩子里裁剪到 ±8px 兜底，**根因未修**。
- **结论**：Signal 的 `radius` 与 falloff 是纯几何量，一旦与上述混用半径共用比较运算，
  确定性重放与感知阈值都会失真。因此 **"坐标 / 半径 / 屏震根因修复"必须在 PHASE 0 完成并固化基线
  回归后，才允许进入 PHASE 2 的 Signal 实现**。具体修复方案（统一到网格单位，还是给
  `ProjectileData.radius` 增加显式单位语义）为 `TBD — Requires User Decision`。
- 附加审查点【需扩展】：`WorldRenderer._buildTexture()` 内部把 `t.type !== 'wall'` 的格子视作
  walkable（因此 `lava` / `water` 在渲染层被视为可走），而 `World.isWalkable()` 明确阻挡
  `wall/lava/water`。**Signal 的墙壁判定只认 `World.tileAt()` / `World.isWalkable()` 的真实判定，
  不得复用渲染器的 walkable 集合。**

---

## 3. Signal 数据模型（PHASE 2，【需新建】）

**统一字段（逐字采用，不得改名、不得增删）**：
`id / sourceId / type / position / intensity / radius / createdAt / duration / faction / metadata`。

> 提案类型名（如 `Signal`、`SignalType`、`SignalFaction`）与文件位置均为 `【需新建】`；
> 建议置于 `src/types/index.ts`【需扩展】或新建 `src/systems/signal/` 内的类型文件【需新建】，
> 二选一为 `TBD — Requires User Decision`。**当前两类文件/类型都不存在。**

### 3.1 字段定义、取值范围、生命周期与序列化约束

| 字段 | 建议类型（提案） | 取值范围 / 单位（提案） | 语义 | 生命周期 | 序列化约束 |
| --- | --- | --- | --- | --- | --- |
| `id` | `number`（或 `string`，`TBD — Requires User Decision`） | 正整数、全局单调递增、生命周期内唯一 | 信号唯一标识；用于确定性排序、去重、重放日志 | 创建时分配，永不变；过期后不复用 | JSON number 且为安全整数；重放后顺序一致 |
| `sourceId` | `number \| string \| null`（`TBD — Requires User Decision`） | `0` = `Player.id`；正整数 = `Enemy._id`（`World.id()` / `enemyIdCounter` 从 1 起）；设施/环境用独立 id 或 `null` | 发射者；用于去重键与 faction 归属，**不是** `id` | 创建时确定，不可变 | 不得与 `id` 同命名空间混用；`null` 必须显式写出，不可省略 |
| `type` | 7 类候选名的字符串字面量联合（`TBD — Requires User Decision`） | 仅允许枚举内取值；是否允许运行时扩展为 `TBD — Requires User Decision` | 决定 falloff 系数、敌人语义、faction 默认值 | 创建时确定，不可变 | 必须是字符串；禁止存函数/枚举对象 |
| `position` | `Vec2`（复用 `src/types/index.ts` 的 `{ x: number; y: number }`） | **`wx/wy` 网格坐标（tile-world units）**；有限数；不得为屏幕像素或 `worldToScreen()` 输出 | 信号源点；传播距离以 `Math.hypot(dx,dy)` 计算 | 创建时确定；中继是否产生新信号为 `TBD — Requires User Decision` | 纯对象、两个有限 number；不得带 `Phaser`/class 实例 |
| `intensity` | `number` | 建议 `[0,1]` 归一化或 `[0,100]`（`TBD — Requires User Decision`）；`0` 视为无效；必须 `Number.isFinite` | 源强度；经 falloff 与遮挡后得到有效值 `I_eff` | 创建时确定；衰减只发生在派生计算中，不改原值 | 禁止 `NaN` / `Infinity` / 字符串 |
| `radius` | `number` | **网格单位（tile-world）**，`>= 0`；`0` 的语义（仅自身 tile / 无效 / 单点）为 `TBD — Requires User Decision` | falloff 作用半径、感知阈值比较范围 | 创建时确定，不可变 | 有限 number；严禁直接填 screen-px 配置值（见 §2.2） |
| `createdAt` | `number` | 建议**逻辑 tick 序号**（整数）或 `World.clock` 语义的逻辑秒（`TBD — Requires User Decision`） | 创建时刻，与 `duration` 共同决定过期 | 创建时写入，不可变 | **禁止** `Date.now()` / `performance.now()` / `nowMs()`；必须为确定性逻辑时间 |
| `duration` | `number` | `>= 0`，单位与 `createdAt` 一致；`0` = 单 tick 瞬发 / 永不过期 / 无效，`TBD — Requires User Decision` | 存活时长；过期规则 `now >= createdAt + duration` | 创建时确定；过期即移出活动集合 | 有限 number；与 `createdAt` 同单位 |
| `faction` | `'player' \| 'enemy' \| 'neutral'`（建议，`TBD — Requires User Decision`） | 三值或其它取值域待定 | 决定谁能感知、Jam 对哪一方生效 | 创建时确定，不可变 | 字符串；不得复用 `ProjectileData.side`（只有 `'player' \| 'enemy'`） |
| `metadata` | `Record<string, JsonValue>`（建议，`TBD — Requires User Decision`） | 仅 JSON 安全的标量 / 数组 / 纯对象；键名白名单与体积上限 `TBD — Requires User Decision` | 扩展载荷候选：`roomId`、`weaponKey`、`charge`、`relayHop`、`decoyTargetId` 等（**均为提案键名**） | 随信号创建；是否允许传播中追加为 `TBD — Requires User Decision` | **禁止** `Set` / `Map` / `Phaser.GameObjects.*` / 函数 / `Date` / `undefined` / 循环引用；`JSON.stringify` 往返必须无损 |

**生命周期（提案）**【需新建】：创建（能力 / 武器 / 敌人 / 设施）→ 在固定 tick 边界入活动集合
（按 `id` 稳定排序）→ 每 tick 计算 falloff、遮挡、叠加与去重 → 供 `Enemy.detects()` 等消费 →
`now >= createdAt + duration` 时按确定性顺序移除 → 可选写入 JSON 重放日志。
建议把 tick 处理插在 `World.update(dt)` 中 `player.update(dt)` 之后、`enemies` FSM 之前
（当前 `World.update(dt)` 顺序为：玩家 → 敌人 → 弹丸 → 掉落 → FX → `updateRoom()` → 相机 → 光照），
使同一 tick 内 FSM 看到的是同一份信号快照；插入点为 `TBD — Requires User Decision`。

**序列化补充约束**【需新建】：`SaveData`【已实现】只有 `version / createdAt / updatedAt / permanent /
settings / stats`，`SAVE_VERSION = 1`，**没有任何局内快照字段（无 seed / 房间 / 玩家 HP / 敌人状态）**；
因此"Signal 是否进存档、是否升级 `SAVE_VERSION`、重放日志是否落盘"均为
`TBD — Requires User Decision`。重放日志必须是纯 JSON，可逐 tick 比对，不得序列化
`Phaser.Scene` / `World` 内部对象（与 PHASE 3 的公开 DTO 白名单口径一致）。

### 3.2 与现有 `ProjectileData` / `Tile` / `Room` / `Vec2` 的关系（`src/types/index.ts`）

| 现有类型（【已实现】真实字段） | 与 Signal 的关系（提案） |
| --- | --- |
| `ProjectileData = { id, ownerId, side, pos, vel, damage, lifetime, radius, crit, pierce, hitSet }`，其中 `hitSet: Set<number>` | **Signal 不是弹丸**：无 `vel` / `damage` / `crit` / `pierce` / `hitSet` / 精灵。`sourceId` 只类比 `ownerId`（`Player.id = 0`），但设施与环境没有弹丸对应物，需独立 id 空间（`TBD — Requires User Decision`）。`ProjectileData.radius` 现为 `5`/`6`（像素量级，见 §2.3），**Signal.radius 绝不能沿用该量纲**。`hitSet` 是 `Set`，**JSON 不安全**，正好作为 `metadata` 禁用 `Set/Map` 的反面依据。`lifetime` 是倒计时秒，Signal 用 `createdAt + duration` 的绝对逻辑时间，两者语义不同 |
| `Tile = { x, y, type: TileType, height }`；`TileType = 'floor' \| 'wall' \| 'debris' \| 'lava' \| 'water' \| 'spawn'` | Signal 的 `position` 必须能经 `Math.floor()` 落到 `World.tileAt()` 的格子（与 `tileAt()` 内部 `gx/gy` 算法一致）。墙壁/遮挡判定**只能**由 `World.tileAt()` 返回的 `Tile.type` 与 `World.isWalkable()` 的 `wall/lava/water` 判定得出（`TBD — Requires User Decision`：`debris` / `spawn` 是否衰减）。越界时 `tileAt()` 返回 `{type:'wall'}`，天然视为阻挡 |
| `Room = { id, kind, gx, gy, w, h, connectedTo, cleared, spawned }`；`RoomKind` 8 种字面量 `start / combat / resource / elite / shop / event / boss / extraction` | `Room` **没有任何 signal 字段**【已实现】。房间级信号建议以 `metadata.roomId` 引用 `Room.id`（【需扩展】或【需新建】，`TBD — Requires User Decision`）；是否给 `Room` 增加设施/信号字段为 `TBD — Requires User Decision`。`World.currentRoom()` 按玩家 `wx/wy` 判定房间，`World.updateRoom()` 按 `EnemyData.spawnRoom` 统计存活敌人，二者都是网格/房间 id 语义 |
| `Vec2 = { x: number; y: number }` | 直接复用为 `position` 的类型，但 `Vec2` **不带单位标注**【已实现】；必须靠代码注释/文档锁死"网格单位"，是否引入带品牌（branded）的 `GridVec2`（【需新建】）为 `TBD — Requires User Decision` |
| `GameEvent { type: GameEventType; payload: any; tick: number }`、`GameEventType` | 二者【已实现】仅声明未使用；其 `tick: number` 字段与本文"逻辑 tick 时间"提案同向，但事件通道选择未定（见 §13），不得据此认定已有信号事件 |

---

## 4. 7 类信号（PHASE 2，【需新建】）

**统一候选命名（逐字采用 FACTS §7.2）**：
`player-noise` / `weapon-discharge` / `scan` / `jam` / `decoy` / `enemy-emission` / `environment-beacon`。

> **具体命名与枚举：`TBD — Requires User Decision`**。需要用户决定的具体问题见 §4.2，
> 并汇总于 `## 待用户确认事项`。下表所有数值**只是量级示例，不是平衡结论**，
> 全部 `TBD — Requires User Decision`；`radius` 一律为**网格单位（tile-world）**，
> `duration` 与 `intensity` 单位同 §3.1 的待决项。

### 4.1 逐类语义（提案）

| 候选 `type` | 来源（真实落点 → 提案挂载点） | `faction`（建议） | 典型 `intensity` / `radius` / `duration`（示例，全部 `TBD — Requires User Decision`） | 对敌人的语义（提案） | 状态 |
| --- | --- | --- | --- | --- | --- |
| `player-noise` | `Player.update()` 的移动与冲刺（`dashTimer`、`world.addShake(4)`）；`World.spawnEnemy()` 生成时不产生 | `player` | `0.2` / `3` tiles / `0.3` | 抬高范围内敌人的有效 `aggroRange`，使 `patrol` case 的 `detects()` 命中并 `enterDetect()` | `【需扩展】` + `TBD — Requires User Decision` |
| `weapon-discharge` | `Player.tryFire()` → `World.spawnProjectile()`；**一次扳机一个信号**，`scatter` 的 `shots:5` 不得发 5 个 | `player` | `0.8` / `8` tiles / `0.5` | 高优先级远距离吸引；按 `type` 与武器种类给不同 falloff 系数（`TBD — Requires User Decision`） | `【需扩展】` + `TBD — Requires User Decision` |
| `scan` | 三大能力之一（【需新建】能力模块），以玩家 `wx/wy` 为 `position` | `player` | `1.0` / `12` tiles / `0.2` | 原则上**不改变**敌人目标与 `detects()`，只产出观测结果；是否让敌人察觉 Scan 为 `TBD — Requires User Decision` | `【需新建】` + `TBD — Requires User Decision` |
| `jam` | 三大能力之一（【需新建】），作用于目标区域 | `player` | `0.9` / `6` tiles / `3` | 压低范围内敌人有效 `aggroRange` / 抬高感知阈值，使 `Enemy.detects()` 返回 false；是否复用 `Enemy.stun()` / `reposition` 为 `TBD — Requires User Decision` | `【需新建】` + `TBD — Requires User Decision` |
| `decoy` | 三大能力之一（【需新建】），生成伪目标 | `player`（或 `neutral`，`TBD — Requires User Decision`） | `0.7` / `5` tiles / `5` | 让敌人 `data.targetId` 由 `0` 改指向诱饵 id，**改变追击/朝向目标**；是否计入 `World.updateRoom()` 清房统计为 `TBD — Requires User Decision` | `【需新建】` + `TBD — Requires User Decision` |
| `enemy-emission` | `Enemy.doAttack()`（`World.spawnEnemyProjectile()`）、`Boss` 攻击、`World.spawnEnemy()` 生成时刻（提案挂载点） | `enemy` | `0.5` / `4` tiles / `0.4` | 主要供玩家/后续 `observe_signals` 观测；是否影响友方敌人行为（增援/警戒）为 `TBD — Requires User Decision` | `【需扩展】` + `TBD — Requires User Decision` |
| `environment-beacon` | 环境设施状态机（【需新建】，见 §9）；也可由静态环境源产生 | `neutral` | `0.6` / `10` tiles / 周期广播（`duration` 语义 `TBD — Requires User Decision`） | 中继/屏蔽区域语义；被 `jam` 屏蔽后是否改 faction、是否仍可被感知为 `TBD — Requires User Decision` | `【需新建】` + `TBD — Requires User Decision` |

### 4.2 需要用户决定的命名与枚举问题（全部 `TBD — Requires User Decision`）

1. 是否固定使用上述 **kebab-case 字符串字面量联合**（`'player-noise' | ... | 'environment-beacon'`），
   还是改用数字常量枚举 / `const enum` / 带命名空间的 `signal.*`？`type` 是否允许运行时扩展（新设施、Mod）？
2. 是否**完整保留 7 类**：`player-noise` 与 `weapon-discharge` 是否合并为单一"噪声"类；
   `enemy-emission` 是否按 `EnemyKind`（`drone/stalker/sentinel/hunter/boss_warden`）细分；
   `environment-beacon` 是否拆成"发射 / 中继 / 屏蔽"三类；`boss_warden` 是否需要专属类别？
3. 类型声明落在 `src/types/index.ts`（【需扩展】）还是新建 `src/systems/signal/` 内类型文件（【需新建】）？
4. `faction` 取值域是否为 `'player' | 'enemy' | 'neutral'` 三值；`decoy` 归 `player` 还是 `neutral`；
   Jam 命中后的 `environment-beacon` 归谁？
5. `intensity` 量纲是 `0..1` 还是 `0..100`，是否与 Signal Energy 同量纲（§5）；
   `radius` / `duration` 是否统一为"网格单位 / 逻辑秒（或 tick）"？

---

## 5. Signal Energy（PHASE 2，【需新建】/【需扩展】）

**统一口径（逐字采用 FACTS §7.2）**：上限 `100`、恢复 `5`。

**现状**【已实现】：`PlayerData` = `Stats` + `level / xp / xpToNext / currency / weaponKey /
weapons: WeaponState[] / upgrades: UpgradeProgress[] / abilities: string[]`，**没有能量字段**；
`SaveData.permanent.unlockedAbilities` 只是解锁列表，无局内数值；`GameScene.refreshHud()` 无能量显示。
因此能量状态属于 `【需扩展】`（`PlayerData` / `Player.update()` / `GameScene` HUD）
或 `【需新建】`（独立能量模块）；字段命名与存放位置 `TBD — Requires User Decision`。

**提案骨架**（全部为设计，不是实现）：

| 项 | 提案 | 状态 |
| --- | --- | --- |
| 上限 | `100`（统一口径，固定） | `【需扩展】` |
| 恢复 | `5`；建议用**固定 tick** 恢复而非直接 `* dt`，避免变长帧造成重放漂移 | `TBD — Requires User Decision`（单位：每秒 / 每 tick / 每房间） |
| 消耗 | 由 Scan / Jam / Decoy 各自的消耗表决定；不足时能力失败（见 §6 失败条件） | `TBD — Requires User Decision` |
| 打断 | 是否可被 `Player.hurt()`、玩家受击、切武器（`Q`/`E`）、暂停（`GameScene.paused`）打断；打断是否退还已扣能量 | `TBD — Requires User Decision` |
| 暂停/结算 | 暂停、`LevelUpScene`、`GameOverScene` 期间是否继续恢复 | `TBD — Requires User Decision` |
| 跨房间/跨局 | `World.tryInteract()` 传送后是否清零；是否进入 `SaveData`（现 `SAVE_VERSION = 1`、无局内快照） | `TBD — Requires User Decision` |
| 升级影响 | 是否纳入现有 12 项 `UPGRADES`（`src/config/upgrades.ts`）或新增 Signal 专属升级 | `TBD — Requires User Decision` |
| HUD | 是否在 `GameScene.setupHud()` / `refreshHud()` 增加能量条（`lockHud()` 需同步登记锚点） | `【需扩展】` + `TBD — Requires User Decision` |

---

## 6. Scan / Jam / Decoy 三大能力（PHASE 2，【需新建】）

> **本节所有参数（消耗、半径、持续、冷却、失败条件、阈值系数、键位）一律 `TBD — Requires User Decision`。**
> 三大能力当前**都不存在**；`GameScene.create()` 已占用的输入为 `ESC / I / F / Q / E / SPACE /
> pointerdown / pointerup`，能力键位必须另行确认。

### 6.1 能力规则提案

| 能力 | 规则（提案） | 对 `ENEMY_STATS.aggroRange` 与 `Enemy.detects()` 的影响（提案） | 状态 |
| --- | --- | --- | --- |
| **Scan（扫描）** | 以玩家 `wx/wy` 为 `position` 发一条 `scan` 信号，按 §8 的 falloff 收集范围内敌人/设施，输出公开 DTO 白名单结果（与 PHASE 3 `observe_signals` 对齐） | **不改配置常量、不改 `detects()` 的比较式**，只读；是否附带"轻微提升敌人警觉"为 `TBD — Requires User Decision` | `【需新建】` + `TBD — Requires User Decision` |
| **Jam（干扰）** | 在目标网格点发 `jam` 信号，持续期内对范围内敌人计算 `effectiveAggroRange`（在 `detects()` 内对 `data.stats.aggroRange` 做运行时乘性/加性修正） | **禁止改写 `ENEMY_STATS` 配置常量**（`Enemy` 构造里已 `/= 64`），只改 `detects()` 中的有效阈值；使 `distanceTo(player) <= effectiveAggroRange` 为 false，触发 `chase → patrol`、`attack → chase` | `【需扩展】` + `TBD — Requires User Decision` |
| **Decoy（诱饵）** | 在目标网格点发 `decoy` 信号并分配伪目标 id；敌人 `data.targetId` 不再写死 `0`，`moveToPlayer()` / `facePlayer()` / `doAttack()` 经【需扩展】的目标解析层读取目标 | **不改 `aggroRange` 数值**；改的是"感知谁 / 追谁"，`detects()` 需同时返回目标或由解析层给出 | `【需新建】` + `TBD — Requires User Decision` |

### 6.2 参数表（全部待用户拍板）

| 参数 | Scan | Jam | Decoy |
| --- | --- | --- | --- |
| Energy 消耗 | `TBD — Requires User Decision` | `TBD — Requires User Decision` | `TBD — Requires User Decision` |
| 半径（**网格单位**） | `TBD — Requires User Decision` | `TBD — Requires User Decision` | `TBD — Requires User Decision` |
| 持续 | `TBD — Requires User Decision` | `TBD — Requires User Decision` | `TBD — Requires User Decision` |
| 冷却 | `TBD — Requires User Decision` | `TBD — Requires User Decision` | `TBD — Requires User Decision` |
| 失败条件 | `TBD — Requires User Decision`（候选：Energy 不足 / 冷却中 / 目标点 `isWalkable()` 为 false / 越界 / `paused` / 玩家已死亡） | 同左 | 同左 |
| 是否共享全局冷却 / 是否可叠加 | `TBD — Requires User Decision` | `TBD — Requires User Decision` | `TBD — Requires User Decision` |
| 键位与 Agent 入口 | `TBD — Requires User Decision`（是否与 PHASE 3 `action_signal` 共用一套参数 schema） | 同左 | 同左 |

### 6.3 与 `aggroRange` 的真实换算（【已实现】事实，提案只在此之上叠加）

`ENEMY_STATS`（`src/config/enemies.ts`）以 screen-px 书写，`Enemy` 构造里 `stats.aggroRange /= 64`：

| 敌人 | 配置 `aggroRange`（screen-px） | 运行时网格值（tile-world） |
| --- | ---: | ---: |
| `drone` | 340 | 5.3125 |
| `stalker` | 300 | 4.6875 |
| `sentinel` | 240 | 3.75 |
| `hunter` | 420 | 6.5625 |
| `boss_warden` | 99999 | 1562.484375 |

`Boss` 是**独立类、不继承 `Enemy`**（`src/entities/Boss.ts`），由 `World.spawnBoss()` 生成，
因此 **Boss 是否受 Jam/Decoy 影响、`99999` 特大 `aggroRange` 如何解释** 为
`TBD — Requires User Decision`。三大能力的所有半径/阈值修正必须在上述**网格值**上运算（§2 铁律）。

---

## 7. 敌人感知阈值与现有 FSM 集成点（PHASE 2，【需扩展】）

### 7.1 唯一感知入口（【已实现】真实实现）

```
private detects(player: Player): boolean {
  return this.distanceTo(player) <= this.data.stats.aggroRange;
}
```

`Enemy.detects()` 是**唯一感知入口**【已实现】：`distanceTo()` 用 `player.x - this.x` /
`player.y - this.y`（即 `wx/wy` 网格坐标），纯欧氏距离，**无视线、遮挡、噪声、信号概念**。
提案（【需扩展】）：保持"单一入口"不变，把当前 tick 的信号快照作为**只读输入**传入
（或由【需新建】的感知查询层提供），在入口内部把 `data.stats.aggroRange` 换成
`effectiveAggroRange`，并把被感知目标交给目标解析层；**不得在 FSM 各 case 里另起一套距离判断**，
也不得把 `worldToScreen()` 的输出引入该入口。

**提案伪代码（不是现有实现）**：

```
// 【需扩展】仅示意，非 0.1.0 代码
effectiveAggroRange(e, signals, tick) =
  clamp(e.data.stats.aggroRange * (1 - jamLevel * kJam) * (1 + noiseLevel * kNoise), 0, cap)
detects(player) = distanceTo(resolvedTarget) <= effectiveAggroRange(...)
   && perceivedIntensity >= perceptionThreshold
```

其中 `kJam` / `kNoise` / `cap` / `perceptionThreshold` / 阈值是否按 `EnemyKind` 区分
全部 `TBD — Requires User Decision`。

### 7.2 `Enemy.stateMachine()` 的 7 个 case 逐一点名（【已实现】现状 → 【需扩展】提案）

| 真实 case | 现状（【已实现】） | Signal 集成提案（【需扩展】） |
| --- | --- | --- |
| `idle` | 计时到 → `patrol` | 是否监听 `environment-beacon` 而提前转 `patrol`：`TBD — Requires User Decision` |
| `patrol` | `moveAlongPatrol()`；计时到 → `idle`；`if (this.detects(player)) this.enterDetect(player)` | `player-noise` / `weapon-discharge` / `decoy` 经 `detects()` 触发 `enterDetect()` 的主入口 |
| `detect` | `stateTimer -= dt`；`targetId = 0`；计时到 → `chase`；`!detects()` → `idle` | `targetId` 改由目标解析层给出（诱饵 id）；`0.5` 秒 `stateTimer` 是否被 Jam 缩短为 `TBD — Requires User Decision` |
| `chase` | `!detects()` → `patrol`（`stateTimer=1.5`）；否则 `moveToPlayer()`；`inRange(attackRange)` → `attack` | Jam 使 `detects()` 为 false → `patrol`；Decoy 使 `moveToPlayer()` 追伪目标 |
| `attack` | `detects()` 时 `facePlayer()` + `doAttack()` + `stateTimer=0.4`；否则 → `chase` | 诱饵状态下是否对伪目标 `doAttack()`、是否仍生成 `World.spawnEnemyProjectile()`：`TBD — Requires User Decision` |
| `reposition` | `reposition()`；计时到 → `detects() ? 'chase' : 'patrol'` | Jam 结束后经此 case 回落到 `patrol`；是否新增"信号搜索"行为为 `TBD — Requires User Decision` |
| `stun` | 计时到 → `chase` | 由 `Enemy.stun()` 进入；Jam 是否复用 `stun` 或仅压制感知：`TBD — Requires User Decision` |

### 7.3 其余真实集成点逐一点名

| 真实名称（【已实现】） | 现状事实 | Signal 提案 |
| --- | --- | --- |
| `Enemy.enterDetect()` | `targetId = 0`、`state = 'detect'`、`stateTimer = 0.5` | 【需扩展】改为写入解析出的目标 id，并可由 `decoy` 指向伪目标 |
| `Enemy.data.stateTimer` | `update(dt)` 与各 case 递减 | 【需扩展】信号造成的警觉/失能时长复用该计时器，不用墙钟时间 |
| `Enemy.data.targetId` | 类型 `number \| null`；构造为 `null`；`enterDetect()` 与 `detect` case **都只写 `0`**（`Player.id = 0`） | 【需扩展】见 §7.4 |
| `Enemy.data.stunTimer` | `hit()` 中 `stunTimer > 0` 时直接 return false | 【需扩展】Jam 是否映射到 stun 语义为 `TBD — Requires User Decision` |
| `Enemy.data.spawnRoom` | 构造时写入 `room`；`World.updateRoom()` 用它统计房间内存活敌人 | 【需扩展】诱饵/设施**不得**塞进 `world.enemies`，否则 `r.spawned && inRoom.length === 0` 的清房判定失效 |
| `Enemy.stun()` | `stunTimer = seconds`、`state = 'stun'`、`stateTimer = seconds` | 【需扩展】Jam 是否调用、或仅改 `detects()` 阈值：`TBD — Requires User Decision` |
| `World.spawnEnemy()` | `new Enemy(...)` → `e._id = this.enemyIdCounter++` → `initHp()` → `enemies.push(e)` | 【需扩展】`sourceId` / `targetId` 的 id 命名空间须与 `_id` 对齐；诱饵 id 是否复用 `World.id()` 为 `TBD — Requires User Decision` |
| `World.updateRoom()` | `currentRoom()` → `onEnterRoom()`；按 `spawnRoom` 统计存活敌人，清零后 `r.cleared = true` 并回调 | 【需扩展】Signal 测试房间的设施/信号是否影响清房、是否按房间裁剪信号为 `TBD — Requires User Decision` |
| `WorldCallbacks.onRoomEntered` / `onRoomCleared` | `GameScene.create()` 中构造，消费方是 `GameScene.onRoomEntered()` / `onRoomCleared()` | 【需扩展】进入 Signal 房间时初始化设施与基准信号；清房时关闭设施并结束周期广播 |

### 7.4 `EnemyStateName` 的 `'dead'` 与 Jam / Decoy 改目标（**不得虚构**）

- `EnemyStateName`【已实现】在 `src/types/index.ts` 声明 8 个名字：
  `'idle' | 'patrol' | 'detect' | 'chase' | 'attack' | 'reposition' | 'stun' | 'dead'`。
  **`'dead'` 只在类型里声明，`Enemy.stateMachine()` 的 switch 没有 `'dead'` case，
  源码中没有任何赋值为 `'dead'` 的地方**。敌人死亡由 `World.killEnemy()` 处理：
  `e._hp = 0`、`e.sprite.destroy()`、从 `enemies` 数组移除。
  Signal 设计**不得假设 `'dead'` 状态可用**；若需要"信号致盲 / 设施失效 / 敌人失联"状态，
  必须新增状态名并同步 `EnemyStateName` 与 `stateMachine()`（【需扩展】，命名 `TBD — Requires User Decision`）。
- **Jam / Decoy 如何改变目标**：`data.targetId` 构造为 `null`，`enterDetect()` 与 `detect` case
  **当前只写 `0`**（`Player.id = 0`）【已实现】。提案：
  - **Jam** 不改目标，只压低 `effectiveAggroRange` / 抬高感知阈值，使 `detects()` 返回 false，
    从而让 `chase → patrol`、`attack → chase` 自然发生；
  - **Decoy** 分配伪目标 id（`TBD — Requires User Decision`：是否复用 `World.id()` / `enemyIdCounter`，
    是否为真实实体，是否进 `world.enemies`），把 `targetId` 从 `0` 改为该 id；
    由于 `moveToPlayer(dt, player)` / `facePlayer(player)` / `doAttack(player)` 目前**只接受 `Player`**，
    必须【需扩展】引入目标解析层（`resolveTarget(targetId) -> { x, y }`），否则改了 `targetId` 也不会
    改变任何行为。`x/y` 必须是 `wx/wy` 网格坐标（§2 铁律）。
  - 伪目标若进入 `world.enemies`，会破坏 `World.updateRoom()` 的清房统计与
    `WorldCallbacks.onRoomCleared`；**建议伪目标只存在于 Signal 子系统的纯数据集合中**
    （【需新建】），该结论为设计建议、落实方式 `TBD — Requires User Decision`。

---

## 8. 确定性传播与 falloff（PHASE 2，【需新建】）

### 8.1 固定 tick 与时间基准（提案）

- `GameScene.update(time, delta)`【已实现】用 `const dt = Math.max(0, delta) / 1000` 调 `World.update(dt)`，
  帧长可变；**直接用变长 `dt` 累加会让重放漂移**。
- 提案【需新建】：设固定 `TICK_HZ`（`TBD — Requires User Decision`），用累加器把 `dt` 量化为整数
  `tickIndex`；每 tick 以固定顺序处理：过期清理 → 新信号入队 → falloff/遮挡/叠加计算 →
  FSM 消费 → 写重放日志。`createdAt` 建议直接等于 `tickIndex`、`duration` 用 tick 数
  （或统一逻辑秒，二选一 `TBD — Requires User Decision`）。
- `World.clock`【已实现】在 `World.update(dt)` 里 `this.clock += dt`，可作为"逻辑秒"候选，但
  仍是浮点累加；若选它必须同时固定 tick 量化。

### 8.2 距离、falloff 与阈值公式（提案，全部基于 `wx/wy`）

```
// d 为网格距离（tile-world units），receiver 为敌人的 wx/wy 或设施网格坐标
d = Math.hypot(signal.position.x - receiver.wx, signal.position.y - receiver.wy)
f(d) = max(0, 1 - d / signal.radius)                        // 候选：线性
     // 其它候选：smoothstep(1 - d/r)、1/(1 + (d/k)^2)、exp(-d/k)
I_eff = clamp(signal.intensity * f(d) * Π(遮挡衰减系数), 0, cap)
感知命中：I_eff >= perceptionThreshold  或  d <= effectiveAggroRange（见 §7.1）
```

`src/core/random.ts` 已导出 `dist()` / `distSq()` / `clamp()` / `lerp()`【已实现】，
建议直接复用（【需扩展】仅指调用，不改动该文件）。
**falloff 函数选型（线性 / smoothstep / 反平方截断 / 指数）与常数 `k`、`cap`、
`perceptionThreshold`、是否按 `type` / `EnemyKind` 给系数表** 全部
`TBD — Requires User Decision`。`radius = 0` 时 `f(d)` 的除零语义为 `TBD — Requires User Decision`。

### 8.3 墙壁影响（**必须落到真实判定上**）

提案【需新建】：从 `signal.position` 到 `receiver(wx,wy)` 之间按 `step <= 0.5` 网格单位采样：

```
for each sample s (网格坐标):
    t = World.tileAt(s.x, s.y)                       // 越界自动返回 {type:'wall'}
    if (!World.isWalkable(s.x, s.y, 0.5)) {         // 真实判定：wall / lava / water
        attenuation *= attenuationFor(t.type)
    }
```

- `World.tileAt()`【已实现】返回 `Tile`，`TileType` 为 `floor/wall/debris/lava/water/spawn`；
  `World.isWalkable()`【已实现】采样 4 角点，**仅** `wall` / `lava` / `water` 返回 false；
  越界时 `tileAt()` 返回 `{type:'wall'}` 的 `Tile`，因此越界天然被阻挡。
- `wall` / `lava` / `water` 各自衰减系数（完全阻断 vs 部分衰减）、`debris` / `spawn` 是否也衰减、
  是否用射线步进还是 BFS、`step` 取值、是否缓存遮挡结果，全部 `TBD — Requires User Decision`。
- **禁止**改用 `WorldRenderer._buildTexture()` 内的 `walkable`（`t.type !== 'wall'`，会把
  `lava` / `water` 当可走）来做遮挡判定（见 §2.3）。

### 8.4 确定性 RNG 与固定 seed（复用 `src/core/random.ts`）

- 【已实现】`RNG` 是 Mulberry32，API：`RNG.fromSeed()` / `new RNG(seed)` / `seed()` /
  `float()` / `int()` / `range()` / `boolean()` / `pick()` / `pickWeighted()` / `shuffle()`。
  `MapGenerator` 用 `new RNG(seed)`；`World` 用 `new RNG(map.seed * 7919 + 1)`；
  `MapData.seed` 保存种子，`GameScene` 有 `this.seed`；`tests/audit.spec.ts` 用 `SEED = 424242`。
- 提案【需新建】：Signal 子系统持有**独立 RNG 流**，由 `map.seed` 派生（如
  `RNG.fromSeed((map.seed ^ 常量) >>> 0)`，**派生公式为 `TBD — Requires User Decision`**），
  避免消耗 `MapGenerator` / `World` 的随机序列而改变既有地图与掉落结果。
- **禁止**在 Signal 路径使用 `Math.random()`（现状 `World.spawnLoot()` / `World.killBoss()` /
  `Boss.summonDrones()` / `LevelUpScene.choose()` 中使用，属非确定性，但不在 Signal 子系统内）、
  `Date.now()` / `performance.now()` / `nowMs()`；`createdAt` 不得取墙钟时间。
- RNG 只用于明确的随机项（如抖动、命中判定）；**falloff / 遮挡 / 叠加本身必须是纯函数**，
  是否允许 RNG 参与传播为 `TBD — Requires User Decision`。

### 8.5 tick、`createdAt` / `duration` 过期、叠加与去重（提案）

- 过期【需新建】：`tickIndex >= createdAt + duration` 时，在**该 tick 的处理开始前**按 `id` 升序移除；
  `duration = 0` 表示"单 tick 瞬发 / 永不过期 / 无效"三选一为 `TBD — Requires User Decision`。
  必须保证同一 tick 内所有消费者看到**同一份**信号快照，不得边遍历边删除。
- 叠加与去重【需新建】：
  - 去重键候选：`(sourceId, type, tickIndex, quantize(position))`；
    典型场景：`scatter` 的 `World.spawnProjectile()` 一次展开 `shots:5` 颗弹丸，
    **只能产生 1 条 `weapon-discharge`**；同一设施周期广播在相邻 tick 不得重复累计。
  - 叠加候选：取 `max`（默认建议）/ 求和后 clamp / 对数和；是否跨 `faction` 叠加、
    是否按 `type` 分组、`cap` 取值，全部 `TBD — Requires User Decision`。
  - 中继（`environment-beacon`）是否生成"新 `id` 的子信号"还是只放大原信号，
    为 `TBD — Requires User Decision`。
- 确定性重放要求【需新建】：
  1. 相同 `seed` + 相同有序输入序列 + 相同 tick 数 → 信号集合（含 `id` 顺序、`position`、
     `intensity`、`I_eff`、过期顺序）与敌人 `state` / `targetId` 完全一致；
  2. 所有集合按 `id` 稳定排序后遍历（现状 `World.update()` 的 `for (const e of this.enemies)`
     与 `World.killEnemy()` 的 `filter()` 会改变数组顺序，Signal 侧不得依赖该顺序）；
  3. 不使用 `Set` / `Map` 作为可序列化输出（对照 `ProjectileData.hitSet: Set<number>`）；
  4. 不依赖对象键的插入顺序、不依赖浮点无限累加（用整数 tick 计数）；
  5. 重放日志为纯 JSON，可逐 tick 做字符串/结构比对；单测用 `toBeCloseTo` 处理浮点。

---

## 9. 环境设施状态（PHASE 2，【需新建】/【需扩展】）

### 9.1 现状落点（【已实现】）

- `src/world/MapGenerator.ts` 的 `assignRoles(_gen, rooms, _order)`【已实现】：按 `roomDepth()` 的
  BFS 深度排序，`byDepth[0].kind='start'`、最深为 `boss`（并把 `w/h` 提到至少 `13×11`）、
  `byDepth[floor(len/2)]` 为 `elite`，其余 `combat` 房间用确定性 hash
  `h=(id*2654435761 + depth*40503)>>>0, roll=(h%100)/100` 分出 `resource` / `shop` / `event`。
  `RoomKind`【已实现】声明 8 种：`start / combat / resource / elite / shop / event / boss / extraction`。
  **`extraction` 只是类型字面量，从未被赋值、无任何逻辑**；`event` 与 `combat` 玩法无差异；
  `GameOverScene` 只有文案 `'EXTRACT COMPLETE'`。**本设计不得把 `extraction` 写成已有玩法。**
- `World.spawnForRoom(r)`（当前为 `private`）【已实现】只按 `elite`（`4+depth`）、`shop`（1）、
  其他（`2+depth`）区分敌人数量；`World.onEnterRoom(room)`（当前为 `private`）只对
  `resource` / `shop` 调 `spawnResourceLoot()`、对 `boss` 调 `spawnBoss()`。
- `World.placePortal(r)`（当前为 `private`）【已实现】：用 `this.rng.pick(unvisited)` 选目标房间，
  用 `this.isWalkable(cx, cy, 8)` 与 `this.tileAt(cx, cy).type !== 'wall'` 找落点，
  再用 `worldToScreen(best.x, best.y)` 放置 `icon_pause` 精灵，并把 `portal.wx/wy` 存为**网格坐标**；
  `World.tryInteract(player)`【已实现】用 `Math.hypot(dx,dy) < 22`（网格距离）判定交互后
  `player.reset(cx, cy)` 传送（由 `GameScene` 的 `F` 键触发）。
- `WorldRenderer._buildTexture()`【已实现】：一次性把地板/墙/静态装饰烘焙到 `'worldLayer'`
  canvas 纹理（`layer.setDepth(-1)`）；其中 `_drawDecor()` 用 `room.id` 派生的 LCG 为
  `resource` / `shop` 画 3 个静态 props、为所有非 `start` 房间画 debris 圆点。
  **静态装饰没有任何运行时状态**，不能承载设施状态机。

### 9.2 设施状态机提案（【需新建】，全部 `TBD — Requires User Decision`）

- 设施类型候选：信号**发射器 / 中继器 / 屏蔽器**（命名与数量 `TBD — Requires User Decision`）。
- 状态候选：`OFFLINE / IDLE / EMITTING / RELAYING / JAMMED / DISABLED`
  （**状态命名、是否允许并发状态、是否为 `EnemyStateName` 之外的新类型**
  全部 `TBD — Requires User Decision`）。
- 转移驱动（提案）：固定 tick、`createdAt + duration` 过期、`jam` 信号命中、
  `WorldCallbacks.onRoomEntered` / `onRoomCleared`、`World.tryInteract()` 的交互。
- 设施状态必须是**纯数据**（不持有 `Phaser.GameObjects.Sprite` / `Phaser.Scene`），
  以便单测与确定性重放；动态表现建议【需扩展】`WorldRenderer` 增加动态层，或【需新建】
  独立精灵层，**不得把运行时状态塞回 `_buildTexture()` 的静态烘焙**（选哪种 `TBD — Requires User Decision`）。
- 落点清单（全部 `0.2.0` 提案）：
  `【需扩展】` `MapGenerator.assignRoles()`（新房间分配策略；须保持 `guaranteeReachable()` 为 true、
  注意 `GameScene.buildMap()` 当前**重复调用** `assignRoles()`）、
  `【需扩展】` `RoomKind`（8 种字面量是否新增，名称 `TBD — Requires User Decision`）、
  `【需扩展】` `World.placePortal()` / `World.tryInteract()`（交互半径 `22` 网格单位与 Signal 半径
  单位一致性待审）、
  `【需扩展】` `WorldRenderer._buildTexture()` 的 `_drawDecor()` 静态装饰（是否给新房间画静态标记，`TBD — Requires User Decision`）、
  `【需新建】` 设施数据结构与状态机模块（路径为提案，当前 `src/systems/signal/` 等目录都不存在）。
- 待决：设施是否可被攻击/破坏、是否计入 `World.updateRoom()` 的清房条件、
  是否写入 `Room` / `MapData`、`extraction` 是否用于撤离玩法（属 PHASE 1 内容差异化的
  `TBD — Requires User Decision`）——全部 `TBD — Requires User Decision`。

---

## 10. 武器–Signal 映射（PHASE 2，【需扩展】，不得假设已有能力）

### 10.1 先以现有配置与开火路径为依据（【已实现】逐字事实）

`src/config/weapons.ts` 的 `WEAPONS` 有 4 把，`WeaponDef` 的真实字段为
`key, kind, name, description, baseDamage, baseRate, baseSpread, baseProjectileSpeed, baseRange,
magazine?, reloadTime?, critBase, icon, levelDamage(l), levelRate(l), levelRange(l)`：

| 武器 | `baseDamage` | `baseRate` | `baseSpread` | `baseProjectileSpeed` | `baseRange` | `magazine` | `reloadTime` | `critBase` | `kind` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `pulse` | 12 | 6 | 0.02 | 720 | 520 | 无 | 无 | 0.1 | `pulse` |
| `scatter` | 6 | 2.2 | 0.5 | 560 | 260 | 8 | 1.1 | 0.05 | `scatter` |
| `plasma` | 42 | 1.4 | 0 | 380 | 480 | 无 | 无 | 0.15 | `plasma` |
| `arc` | 10 | 3.5 | 0.08 | 900 | 240 | 无 | 无 | 0.2 | `arc` |

另有 `WEAPON_LIST`、`weaponDps(def, level, cooldownReduction)`、`clampLevel(l)`（1..10）【已实现】。
**`WeaponDef` 没有任何 signal 字段**（没有 `intensity` / `radius` / `signalType` / `energyCost` 等）【已实现】。

`src/entities/Player.ts` 的 `private tryFire()`【已实现】流程：检查 `fireHeld()` / `alive` /
`fireTimer` / `WeaponState` 弹匣与装填 → `fireTimer = fireCooldown()` → 扣弹药 →
**只调用一次** `this.world.spawnProjectile(0, this.x, this.y, this.aimYaw, { damage, speed,
critBase, critDamage, critChance, pierce, lifetime, kind, magazine, shots, spread }, 'player')`
（另有 `audio.shoot(w.kind)` 音效）；**没有任何信号发射、没有 Energy 检查、没有能力调用**。
`World.spawnProjectile()`【已实现】按 `spec.shots` 展开多发（`scatter` 为 `5`），
`pos` 为 `x/y + 16 / GAME.PIXEL_TO_TILE`，`radius` 为 `5` / `6`（像素量级，见 §2.3）。

> **结论**：武器–Signal 映射属于 `【需扩展】`（给 `WeaponDef` / `src/config/weapons.ts` /
> `Player.tryFire()` 加字段与挂钩）或 `【需新建】`（独立映射表 / 信号发射模块），
> 并标 `TBD — Requires User Decision`；**绝不能写成 `0.1.0` 已有能力**。

### 10.2 映射提案（全部待用户拍板）

| 武器 | 候选 `type` | 候选触发时机 | 候选 `intensity` / `radius`（网格） / `duration` | 状态 |
| --- | --- | --- | --- | --- |
| `pulse` | `weapon-discharge` | 每次 `tryFire()` 成功 | `TBD — Requires User Decision` | `【需扩展】` + `TBD — Requires User Decision` |
| `scatter` | `weapon-discharge`（高强度短半径） | **一次扳机 1 条**，不得按 5 颗弹丸发 5 条 | `TBD — Requires User Decision` | `【需扩展】` + `TBD — Requires User Decision` |
| `plasma` | `weapon-discharge`（长半径） | 每次 `tryFire()` 成功；`pierce +2` 是否影响 falloff 为 `TBD — Requires User Decision` | `TBD — Requires User Decision` | `【需扩展】` + `TBD — Requires User Decision` |
| `arc` | `weapon-discharge`（链式是否多发信号） | 每次 `tryFire()` 成功 | `TBD — Requires User Decision` | `【需扩展】` + `TBD — Requires User Decision` |

**需要用户决定的具体问题**（全部 `TBD — Requires User Decision`）：

1. 是给 `WeaponDef` **新增 signal 字段**（【需扩展】`src/types/index.ts` + `src/config/weapons.ts`），
   还是新建独立映射表 `src/config/signals.ts`（【需新建】，路径为提案、当前不存在）？
2. 信号强度是否随武器等级用现有 `levelDamage(l)` / `levelRate(l)` / `levelRange(l)` 缩放？
   `weaponDps()` 是否要同步纳入 signal 指标？
3. `weapon-discharge` 是否消耗 Signal Energy（§5）？`scatter` 的 `shots:5` 去重键如何定义（§8.5）？
4. 敌方 `World.spawnEnemyProjectile()` 与 `Boss` 弹幕是否也产生 `enemy-emission`？
   `Boss` 是独立类，不经过 `Player.tryFire()`。
5. 发射挂钩放在 `Player.tryFire()` 内、`World.spawnProjectile()` 内，还是【需新建】的信号发射层？
   （`Player.tryFire()` 当前为 `private`，由 `Player.update()` 调用，`GameScene.update()` 驱动 `setFireHeld()`。）
6. 映射的 `radius` 是否允许复用 `baseRange`（**必须**先 `/ GAME.PIXEL_TO_TILE`，见 §2.2），
   还是独立配置网格值？

---

## 11. Signal 专属测试房间 / 测试关卡（PHASE 2，【需新建】/【需扩展】）

**提案**：新增一个受控房间（或独立测试关卡），固定布置墙体、敌人与设施，
用来断言传播、falloff、遮挡、过期、FSM 反应与确定性重放，不依赖随机地图。

| 落点（真实名称） | 现状（【已实现】） | 提案 |
| --- | --- | --- |
| `RoomKind`（`src/types/index.ts`，8 种字面量） | `extraction` 无逻辑、`event` 与 `combat` 无差异 | 【需扩展】新增字面量（名称 `TBD — Requires User Decision`）或复用 `event` / `extraction`；选哪种 `TBD — Requires User Decision` |
| `MapGenerator.assignRoles()` | 只赋 7 种；`GameScene.buildMap()` 重复调用一次 | 【需扩展】在固定 seed 下保证至少 1 间测试房间，且 `guaranteeReachable()` 仍为 true、`roomDepth()` 仍可用 |
| `World.spawnForRoom()`（当前 `private`） | 按 `elite` / `shop` / 其他决定敌人数量 | 【需扩展】测试房间生成**固定数量、固定位置**的敌人与设施，不引入 `Math.random()` |
| `World.onEnterRoom()`（当前 `private`） | 只对 `resource` / `shop` 生成 loot、对 `boss` 生成 Boss | 【需扩展】进入时初始化设施状态机与基准信号；`World.placePortal()` / `World.tryInteract()` 保持既有传送语义 |
| `WorldCallbacks.onRoomEntered` / `onRoomCleared` | 由 `GameScene` 消费 | 【需扩展】作为设施启停与探针提示的钩子；不得影响 `World.updateRoom()` 的清房判定 |
| `WorldRenderer._buildTexture()` / `_drawDecor()` | 一次性静态装饰 | 【需扩展】是否给测试房间加静态标记 / 动态层，`TBD — Requires User Decision` |

**固定 seed 与确定性断言（提案）**：

- 复用 `GameScene.create(config: {seed?, isNewRun?})` 的 `seed` 通道【已实现】；
  `tests/audit.spec.ts` 用 `SEED = 424242`【已实现】。是否另立 Signal 专用 seed 列表、
  是否用 `MapGenerator.reseed()` / `RNG.seed()` 派生子种子，全部 `TBD — Requires User Decision`。
- 断言清单（【需新建】测试中实现）：同一 seed + 同一有序输入 + 同一 tick 数 →
  `id` 序列、`position`（`wx/wy`）、`intensity`、`I_eff`、过期顺序、敌人 `state` / `targetId`
  完全一致；`wall` / `lava` / `water` 遮挡衰减一致；越界 `tileAt()` 返回 `wall` 时一致；
  `scatter` 一次扳机只产生 1 条 `weapon-discharge`；`createdAt + duration` 边界一致；
  Jam 下 `Enemy.detects()` 结果一致；任何时刻不出现 `'dead'` 赋值。
- **回归约束**：不得破坏 `tests/audit.spec.ts` 的 `st.room?.kind === 'start'`、传送到不同房间等断言，
  也不得破坏 `tests/canvas.spec.ts` / `tests/gameplay.spec.ts` / `src/core/runtime.test.ts`；
  Mode A 无 AI 时游戏必须正常运行（与 FACTS §7.4 一致）。

---

## 12. 单元测试 / 运行时测试设计（PHASE 2，【需新建】）

> **下列文件与测试名全部是 `【需新建】` 提案，当前一个都不存在。**
> `tests/signal.spec.ts`、`src/systems/signal/*.test.ts`、任何 Signal 测试都在 FACTS 黑名单中
> （"当前不存在"），**不得写成已有测试**。命令属于后续实现阶段的验收动作，**本阶段不执行**。

### 12.1 Vitest 单元测试（复用 `src/core/runtime.test.ts` 风格）【需新建】

风格依据【已实现】：`import { describe, it, expect } from 'vitest'`，纯逻辑输入，
`toBe` / `toBeCloseTo` / `toEqual` / `not.toBe` 等断言；`vitest.config.ts` 为
`include: ['src/**/*.test.ts']`、`environment: 'node'`（**无 DOM / 无 Phaser**），
因此 Signal 核心必须是与 Phaser 无关的纯函数模块（【需新建】），只有薄适配层接触 `World`。

| 提案文件（【需新建】） | 提案 `describe` / `it` 或 `test` 名（逐字提案，非现有测试） |
| --- | --- |
| `src/systems/signal/signalModel.test.ts` | `describe('Signal data model')`：`it('exposes exactly the ten agreed fields')`、`it('rejects JSON-unsafe metadata such as Set and Map')`、`it('round-trips a signal through JSON without losing createdAt or duration')` |
| `src/systems/signal/signalPropagation.test.ts` | `describe('deterministic propagation')`：`it('is identical across two replays of the same seed and ordered inputs')`、`it('computes falloff in wx/wy grid units, never in screen pixels')`、`it('attenuates a signal behind wall, lava and water tiles via tileAt and isWalkable')`、`it('treats an out-of-bounds tileAt result as a wall')`、`it('expires a signal exactly at createdAt plus duration on a fixed tick')`、`it('emits one weapon-discharge for a five-pellet scatter trigger')`、`it('combines overlapping intensities in a deterministic order')` |
| `src/systems/signal/signalFsm.test.ts` | `describe('Enemy signal perception')`：`it('keeps all perception inside Enemy.detects()')`、`it('jam lowers effective aggroRange without mutating ENEMY_STATS')`、`it('decoy rewrites targetId away from the hard-coded 0')`、`it('never assigns the dead state, which has no FSM case')` |
| `src/systems/signal/signalEnergy.test.ts` | `describe('Signal Energy')`：`it('caps energy at 100 and never goes negative')`、`it('recovers by 5 units per resolved tick')`、`it('rejects an ability when energy is insufficient')` |
| `src/systems/signal/signalRoom.test.ts` | `describe('Signal test room')`：`it('assigns a signal room for a fixed seed and keeps guaranteeReachable true')` |

### 12.2 Playwright 运行时测试（复用 `tests/audit.spec.ts` 探针模式）【需新建】

风格依据【已实现】：`window.__game`（`src/main.ts` 里 `(window as any).__game = game`）、
`page.evaluate()` 取 `GameScene` 与 `gs.world`、`gridToScreen(page, gx, gy)`（由实时相机变换把网格点
换成屏幕点，**只用于鼠标/截图，不得用于 Signal 距离计算 —— 见 §2 铁律**）、
`worldState(page)` 运行时快照、固定 `SEED = 424242`、`PORT = 5173`、
`page.on('console')` / `page.on('pageerror')` 收集错误、`LS_SHOT_DIR` 控制截图目录、
`expect(errors).toEqual([])`。

- 提案 `worldState()` 增加 signal 快照字段属于 `【需扩展】`（当前 `worldState()` 返回
  `active / seed / paused / camAlpha / zoom / grid / sprite / w2s / spriteErr / centerErr /
  enemies / projectiles / loot / xp / level / currency / weapon / upgrades / kills / items / dmg /
  txtHp / txtXp / txtWeapon / txtStats / room / hasPortal / portal`，**没有 signal 字段**）；
  或新增独立探针 `signalState(page)`（【需新建】）。选哪种 `TBD — Requires User Decision`。

| 提案文件（【需新建】） | 提案 `test` 名（逐字提案，非现有测试） |
| --- | --- |
| `tests/signal.spec.ts` | `test('signal test room: fixed-seed emit -> propagation -> FSM reaction with no console errors', ...)`、`test('signal abilities consume energy and never move the player into screen-pixel coordinates', ...)` |
| `tests/signal-room.spec.ts`（可选，`TBD — Requires User Decision`） | `test('fixed-seed signal room is reachable and does not break the existing audit flow', ...)` |

断言建议：信号 `position` 与 `worldToScreen()` 反算一致（用 `screenToWorld()` 校验，仍以网格为准）、
`radius` 为网格单位、穿过 `wall/lava/water` 的 `I_eff` 下降、Jam 后敌人 `state` 从 `chase` 回落、
`targetId` 由 `0` 变为诱饵 id、固定 seed 两次运行信号日志 JSON 相等、无 `pageerror`。

### 12.3 真实测试命令（后续实现阶段执行，本阶段不执行）

| 命令 | 真实含义 / 前置 | 约束 |
| --- | --- | --- |
| `npm run typecheck` | `tsc --noEmit`（`package.json`） | 只读，不写项目产物 |
| `npm test` | `vitest run`；`vitest.config.ts` 的 `include: ['src/**/*.test.ts']`、`environment: 'node'` | 新增单元测试必须放在 `src/**/*.test.ts` 下才会被收集 |
| `npx playwright test` | `playwright.config.ts`：`testDir: './tests'`、`baseURL` 默认 `http://localhost:5173/`、viewport 1280×720 | **需同时启动 `5173` 与 `5199` 两个 Vite dev server**（`tests/canvas.spec.ts` 硬编码 `http://localhost:5199/`，`tests/audit.spec.ts` / `tests/gameplay.spec.ts` 用 `5173`）；设置 `LS_SHOT_DIR` 指向 workspace，并让 `--output` / 截图落在 workspace，避免写入项目 `test-results/`、`tests/screens/`、`dist/` |

补充：`docs/STYLE_GUIDE.md` 不在本次修改范围；本阶段不运行会写入项目文件的构建/测试命令。

---

## 13. 事件通道讨论（与 `ARCHITECTURE_DECISIONS.md` 一致，结论不预设）

**FACTS §4.5 真实结论（【已实现】）**：

- `src/core/eventbus.ts` 的 `EventBus` 与单例 `gameBus` 方法齐全
  （`on / emit / emitDeferred / flush / has / clear`），但 `gameBus` 在整个 `src/` 与 `tests/`
  中**只有定义处一次出现，没有任何消费者**；`emitDeferred()` / `flush()` 无外部调用者。
- `GameEventType`（`enemy-spawned` … `game-resumed`）与 `GameEvent`（`{ type, payload, tick }`）
  在 `src/types/index.ts` **仅声明未使用**。
- **当前真正的解耦机制是 `WorldCallbacks`**【已实现】：`onLevelUp / onDeath / onRoomCleared /
  onRoomEntered / onLoot / onStats / onBossWin`，由 `GameScene.create()` 构造并注入 `World`。
  其它真实通道：Phaser 场景事件 `this.scene.events.emit('boss-phase', this.phase)`（`Boss`）、
  `WorldRenderer` 的 `scene.events.on('prerender', _lightLock)`、`GameScene` 的
  `keydown-ESC / I / F / Q / E` 与 `pointerdown / pointerup`。
  `World.roomClearedHandlers`、`World.statsSnapshot()` 未使用，`GameScene` 的 `onLoot` 为空实现
  （可复用/待清理点，**不得写成已有的 Signal 事件总线**）。

**Signal 事件的两种候选（均为 `0.2.0` 提案）**：

| 方案 | 内容 | 代价 / 风险 | 状态 |
| --- | --- | --- | --- |
| A. 复用 `gameBus` | 【需扩展】`GameEventType` / `GameEvent` 增加 signal 事件名；用 `emit()` / `emitDeferred()` / `flush()` 发布；`GameEvent.tick` 可承载 §8.1 的逻辑 tick | 首次为 `gameBus` 引入消费者，需要定义订阅生命周期、暂停/场景切换时的 `clear()`、事件顺序对重放的影响；`emit()` 复制 handler 集合迭代，顺序需固定 | `【需扩展】` + `TBD — Requires User Decision` |
| B. 新增 Signal 专线 | 【需新建】在 `src/systems/signal/`（提案路径，当前不存在）内置纯数据事件/快照通道，或【需扩展】`WorldCallbacks` 增加 signal 回调 | 多一条与 `gameBus` 并存的通道，需明确谁负责重放日志与 PHASE 3 `observe_signals` 的出参白名单 | `【需新建】` / `【需扩展】` + `TBD — Requires User Decision` |

**决策结论**：复用 `gameBus` **还是**新增专线 —— `TBD — Requires User Decision`，
需要用户决定的具体问题见 `## 待用户确认事项`。
**与 `ARCHITECTURE_DECISIONS.md` 保持一致、结论不矛盾**：该决策在两份文档中同样保持未决，
本文**不预设**"复用"或"新建"的最终结论；FACTS §7.5 把 `src/core/eventbus.ts` 列为"可复用模块"
只说明它可被复用，**不等于本决策已定**。无论选择哪一方案，以下结论一致：
① 本阶段不新增任何消费者、不修改源码；② 不得把 `gameBus` 描述为已有消费者；
③ 当前解耦靠 `WorldCallbacks`；④ Signal 事件必须落在逻辑 tick 上并可确定性重放（§8.1）；
⑤ 与 PHASE 3 的 Observation API `observe_signals` / Action API `action_signal` 口径对齐，
不向 Agent 暴露隐藏信息与 Phaser 内部对象。

---

## 本文件依据的源码文件

**逐字完整读取并复核（项目内）**：

- `src/types/index.ts` — `Vec2 / ProjectileData / Tile / TileType / Room / RoomKind / MapData /
  EnemyData / EnemyStateName / EnemyStats / WeaponDef / SaveData / SAVE_VERSION / GameEventType / GameEvent`
  的真实字段与字面量；`'dead'` 只在类型里声明。
- `src/core/eventbus.ts` — `EventBus` 的 `on/emit/emitDeferred/flush/has/clear` 与 `gameBus` 单例。
- `src/core/random.ts` — `RNG`（Mulberry32）、`seed()/float()/int()/pick()/shuffle()`、
  `dist()/distSq()/clamp()/lerp()/nowMs()`。
- `src/core/iso.ts` — `IsoMath.toScreen()/toWorld()`、`isoToScreen()/screenToIso()`、`TILE_W/TILE_H`。
- `src/core/runtime.test.ts` — 7 个真实 Vitest 测试名与 `describe/it/expect` 风格（现状测试，非 Signal 测试）。
- `src/world/World.ts` — `worldToScreen()/screenToWorld()/tileAt()/isWalkable()`、`_computeBounds()`、
  `worldToScreen` 的 `_offX/_offY`、`spawnProjectile()/spawnEnemyProjectile()/updateProjectiles()`、
  `spawnEnemy()/spawnBoss()/killEnemy()/killBoss()`、`updateRoom()/onEnterRoom()/spawnForRoom()/
  placePortal()/tryInteract()/update()/clock`、`WorldCallbacks`、`RoomInfo`、
  `roomClearedHandlers` / `statsSnapshot()` 未使用。
- `src/world/WorldRenderer.ts` — `_buildTexture()` / `_drawDecor()` 静态装饰、`projector()`、
  `_offX/_offY`、`_clampCameraShake()` / `_lockLightToScreen()` / `updateLight()`、`prerender` 钩子。
- `src/world/MapGenerator.ts` — `generate()` / `assignRoles()` / `roomDepth()` /
  `guaranteeReachable()`、`_placeRooms()` / `_carveCorridors()` / `_buildTiles()`、`MapData.seed`。
- `src/entities/Enemy.ts` — 构造里的 `/= 64`、`detects()` / `distanceTo()` / `stateMachine()` 7 个 case、
  `enterDetect()` / `stun()` / `doAttack()`、`data.stateTimer/targetId/stunTimer/spawnRoom`。
- `src/entities/Player.ts` — `wx/wy`、`get x()/get y()`、`getRadius()`、`aimFromPointer()`、
  `update()`、`tryFire()` / `fireCooldown()` / `setFireHeld()`、`WeaponFire`。
- `src/config/weapons.ts` — `WEAPONS`（4 把）与 `WeaponDef` 全部真实字段、`WEAPON_LIST` /
  `weaponDps()` / `clampLevel()`；确认无任何 signal 字段。
- `src/config/enemies.ts` — `ENEMY_STATS`（5 类）的 `aggroRange` 等真实数值、`ENEMY_TIERS` /
  `pickEnemyKind()` / `scaleStats()` / `clampInt()`。
- `src/config/game.ts` — `GAME.PIXEL_TO_TILE = 64`、`TILE_W/TILE_H`、`DEFAULT_SETTINGS`、
  `SAVE_KEY`、`xpForLevel()`、`basePlayerData()`、screen-px 书写约定的注释。
- `src/scenes/GameScene.ts` — `create(config)` / `buildMap()`（重复调用 `assignRoles()`）/
  `update(time, delta)` / `setupHud()` / `lockHud()` / `refreshHud()` / `refreshMinimap()`，
  `WorldCallbacks` 构造、`onLoot: () => {}` 空实现、键位注册与 `cam.shake(100, world.shakeAmount * 8)`。
- `tests/audit.spec.ts` — `window.__game` 探针、`gridToScreen(page,gx,gy)`、`worldState(page)`、
  `PORT=5173`、`SEED=424242`、`LS_SHOT_DIR`、2 个真实测试名。
- `package.json` / `playwright.config.ts` — 真实脚本 `typecheck=tsc --noEmit` / `test=vitest run` /
  `playwright=playwright test`；`testDir:'./tests'`、`baseURL`、`viewport 1280×720`。

**检索核对（未逐字全文读取，仅核对端口/路径与存在性）**：
`tests/canvas.spec.ts`（硬编码 `http://localhost:5199/`）、`tests/gameplay.spec.ts`（`PORT=5173`）、
`docs/STYLE_GUIDE.md`（存在，本阶段不修改）、`src/config/upgrades.ts` / `src/entities/Boss.ts` /
`src/scenes/GameOverScene.ts` / `src/systems/SaveSystem.ts` / `src/main.ts`（按 FACTS 与检索结果引用，
未写入任何新事实）。

**外部统一事实基座（不在项目内）**：
`C:/Users/Rafae/AppData/Roaming/CindyGlobal/owners/c03ae4f95c31b1567007/bots/bot_1794172471377_k067bc/workspace/audit/FACTS.md`
—— 已完整读取，重点依据 §4.1 坐标体系、§4.3 Enemy FSM、§4.5 eventbus/WorldCallbacks、
§4.6 配置真实字段、§6 不虚构白/黑名单、§7.1 阶段编号、§7.2 Signal 统一口径、§7.5/§7.6 统一答案与格式。

**授权说明**：本阶段唯一交付物为 `docs/` 下 6 个新建设计文档；本文只写自身，不写 6 个文档之外的任何文件；不改源码、不装依赖、不初始化 Git、不提交 commit。
未修改任何游戏源码、未安装依赖、未初始化 Git、未提交 commit、未写入 `dist/` /
`test-results/` / `tests/screens/` / `node_modules/`。

---

## 待用户确认事项

以下每一项均为 `TBD — Requires User Decision`，并写明需要用户决定的具体问题；
本文第 14 项（Signal 事件通道）与 `ARCHITECTURE_DECISIONS.md` 的 ADR-01 / TBD-01 保持一致（同样未决、不预设结论）。

1. **阶段编号对齐**：`TBD — Requires User Decision` —— 用户是否已有既定的 PHASE 定义？
   若有，**请以总计划书原文为准重新对齐阶段编号**（本文按 FACTS §7.1：PHASE 0 前置、PHASE 2 Signal 核心）。
2. **PHASE 0 坐标/半径根因修复方案**：`TBD — Requires User Decision` —— 是把
   `ProjectileData.radius`（现 `5`/`6` 像素量级）统一改成网格单位，还是引入显式单位类型/换算层？
   `GAME.PIXEL_TO_TILE = 64` 与"配置以 screen-px 书写、运行时除以 64"的约定是否继续保留？
   屏震根因是否同批修复？
3. **7 类信号的命名与枚举**：`TBD — Requires User Decision` —— 是否固定采用
   `player-noise / weapon-discharge / scan / jam / decoy / enemy-emission / environment-beacon`
   的 kebab-case 字符串联合？是否保留全部 7 类、是否合并/拆分/为 `boss_warden` 增设类别？
   类型声明放 `src/types/index.ts` 还是新建 `src/systems/signal/` 类型文件？
4. **`faction` / `intensity` / `radius` / `duration` 量纲**：`TBD — Requires User Decision` ——
   `faction` 是否为 `'player' | 'enemy' | 'neutral'` 三值（`decoy` 归哪一方）？
   `intensity` 用 `0..1` 还是 `0..100`、是否与 Signal Energy 同量纲？
   `radius = 0` 与 `duration = 0` 分别表示什么？`createdAt` 用整数 tick 还是逻辑秒？
5. **Signal 数据模型类型与持久化**：`TBD — Requires User Decision` —— `id` / `sourceId` 用
   `number` 还是 `string` / `null`？`metadata` 允许哪些键（白名单）与体积上限？
   Signal 是否需要进 `SaveData`（现 `SAVE_VERSION = 1`、无局内快照）并升级存档版本？
   重放日志是否落盘、格式为何？
6. **Signal Energy 细节**：`TBD — Requires User Decision` —— 恢复 `5` 的单位是每秒、每 tick 还是每房间？
   Scan/Jam/Decoy 的消耗表？是否可被受击 / 暂停 / 切武器打断、打断是否退还能量？
   暂停与升级场景是否继续恢复？传送后是否清零？是否写入存档 / 显示在 HUD？是否受升级影响？
7. **三大能力全部参数**：`TBD — Requires User Decision` —— Scan / Jam / Decoy 各自的消耗、半径
   （网格单位）、持续、冷却、失败条件、是否共享全局冷却、是否可叠加、键位（现有
   `ESC/I/F/Q/E/SPACE/pointer` 已占用）、是否与 PHASE 3 `action_signal` 共用参数 schema？
8. **感知阈值与 Boss**：`TBD — Requires User Decision` —— `effectiveAggroRange` 的
   `kJam` / `kNoise` / `cap` / `perceptionThreshold` 取值与是否按 `EnemyKind` 区分？
   `Boss`（独立类、`boss_warden.aggroRange = 99999`）是否受 Jam/Decoy 影响？
   Jam 是否复用 `Enemy.stun()` / `reposition` case？若需"信号致盲"新状态，状态名是什么
   （**不得复用 `'dead'`**）？
9. **目标解析与 id 分配**：`TBD — Requires User Decision` —— Decoy 的伪目标 id 是否复用
   `World.id()` / `enemyIdCounter`？伪目标是否为真实实体、是否进入 `world.enemies`
   （进入会破坏 `World.updateRoom()` 清房判定）？`moveToPlayer()` / `facePlayer()` /
   `doAttack()` 的目标解析层如何设计？
10. **传播公式与确定性**：`TBD — Requires User Decision` —— falloff 选线性 / smoothstep /
    反平方截断 / 指数？`TICK_HZ` 与 tick 插入点？`wall` / `lava` / `water` 各自的衰减系数，
    `debris` / `spawn` 是否衰减？射线步进 `step` 与是否缓存遮挡？叠加用 `max` / 求和 clamp /
    对数和，去重键如何定义（`scatter` 5 弹丸只发 1 信号）？Signal 子 RNG 的 seed 派生公式？
    是否允许 RNG 参与传播？中继是否生成子信号？
11. **环境设施状态机与房间类型**：`TBD — Requires User Decision` —— 设施类型与状态命名、
    是否可破坏、是否计入清房、是否给 `Room` / `MapData` 加字段、动态表现用
    `WorldRenderer` 扩展层还是独立精灵层？新 `RoomKind` 字面量名称是新增还是复用 `event` /
    `extraction`（后者当前无逻辑）？`extraction` 是否作为撤离玩法纳入 PHASE 1？
    `World.tryInteract()` 的 `22` 网格单位交互半径是否与 Signal 半径统一？
12. **武器–Signal 映射**：`TBD — Requires User Decision` —— 给 `WeaponDef` 加 signal 字段，
    还是新建独立映射表（【需新建】，路径提案 `src/config/signals.ts`，当前不存在）？是否按
    `levelDamage/levelRate/levelRange` 缩放信号？`weapon-discharge` 是否消耗 Energy？
    敌方 `World.spawnEnemyProjectile()` 与 `Boss` 弹幕是否发 `enemy-emission`？
    发射挂钩放在 `Player.tryFire()` / `World.spawnProjectile()` / 新信号层？
    映射 `radius` 是否允许复用 `baseRange`（必须 `/ GAME.PIXEL_TO_TILE`）？
13. **测试房间与测试文件 / 测试名**：`TBD — Requires User Decision` —— Signal 测试房间是否用专用
    seed 列表、`MapGenerator.assignRoles()` 的强制生成策略、是否新建独立测试关卡入口？
    是否采用本文提案的 `src/systems/signal/*.test.ts` 与 `tests/signal.spec.ts` 文件名、
    以及各 `it(...)` / `test(...)` 的真实测试名？运行时探针是【需扩展】`worldState(page)`
    还是【需新建】`signalState(page)`？`npx playwright test` 的 `LS_SHOT_DIR` / `--output`
    是否统一指向 workspace？
14. **Signal 事件通道（与 `ARCHITECTURE_DECISIONS.md` 一致）**：`TBD — Requires User Decision` ——
    复用 `gameBus`（并【需扩展】`GameEventType` / `GameEvent`）还是新增 Signal 专线
    （【需新建】`src/systems/signal/` 内通道，或【需扩展】`WorldCallbacks`）？
    需要用户决定：订阅生命周期与 `EventBus.clear()` 时机、暂停/场景切换时事件是否丢弃、
    `emit()` 的 handler 顺序如何保证确定性重放、`GameEvent.tick` 是否就是 §8.1 的逻辑 tick、
    以及该通道如何向 PHASE 3 `observe_signals` 提供公开 DTO 白名单。
    **本文与该文档均不预设结论；不得把 `gameBus` 写成已有消费者，当前解耦靠 `WorldCallbacks`。**
15. **PHASE 0 Task 0.1 授权**：`TBD — Requires User Decision` —— Git 初始化：
    PHASE 0 Task 0.1，本阶段未授权，需用户确认后执行；本文任何测试/CI 设计都不假定 Git 已存在。
