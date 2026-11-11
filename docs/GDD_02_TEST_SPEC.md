# GDD-02 测试规格

> 文档性质：仅测试规格，不含测试源码、不含实现、不含执行结果。
> 权威主规则：[RER](REALITY_ENGINEERING_RULES.md)（规则唯一推荐源）、[VSCC](VERTICAL_SLICE_CAUSAL_CHAINS.md)（因果链）。本文件只给可执行判据，引用而不改写主规则。
> 批准分级：D1/D2 `明确批准`；D4 `仅原则批准`；D3/D5/D6/D7/D8/D9 `仅原则认可`。本文件细则均为 `建议冻结` 的单一推荐值；原型初值等待签核，但不阻塞本轮测试设计。
> 本轮未执行：未运行玩法验收、构建或测试；所有 pass/fail 均为判据，不是结果。

---

## 1. 依据与约定

### 1.1 源码事实（只读校准，路径:行）

| 事实 | 证据 |
| --- | --- |
| `SAVE_VERSION = 2`；主/economy 存储键 `last_signal_save_v1` | `src/types/index.ts:125`、`src/config/game.ts:33` |
| `RunCheckpoint` 字段 `id/seed/roomId/position/clearedRooms/portalTarget/rngState/player/loot/stats`；无 Signal / 模板 / 选择 / 临时余时字段 | `src/types/index.ts:96-107` |
| `SaveData` 可选 `run?`；`permanent` 含 `cores/runs/bossesDefeated/bestSeed/unlockedWeapons/unlockedAbilities` | `src/types/index.ts:109-123`（`run?` 在 `:122`） |
| `RNG.snapshot(): number` / `RNG.restore(state)` | `src/core/random.ts:82-84` |
| `validate(data)` 严格版本、不拒绝未知顶层字段；`_load()` 删非法 `run`；`_upgrade()` 丢未知字段；`save()` 双检后全量覆写 | `src/systems/SaveSystem.ts:40-62`、`:89-106`、`:108-144`、`:145-158` |
| `writeCheckpoint(run, expectedId)` 防覆盖；`finishRun` 清档；`discardCheckpoint` | `src/systems/SaveSystem.ts:171-206`、`:208` |
| `validateCheckpoint` 严格校验 checkpoint 字段 | `src/systems/RunCheckpoint.ts:22-47` |
| 安全房检查点：`captureCheckpoint` 要求 cleared / alive / `!won` / `!boss` / 无存活敌人；写 `rngState` | `src/world/World.ts:674-688` |
| `restoreCheckpoint` 拒绝 boss 房、校验 `portalTarget` 连通、`rng.restore(run.rngState)` | `src/world/World.ts:690-712`、`:710` |
| `tileAt()` 越界返回 `{type:'wall'}`；`isWalkable` 采样 4 角点、阻挡 `wall/lava/water` | `src/world/World.ts:132`、`:145` |
| `tryInteract()`；`spawnEnemyProjectile()`；`updateProjectiles(dt)` 独立推进已出手弹丸 | `src/world/World.ts:311`、`:407`、`:504` |
| `killBoss()` 设 `won=true` 并回调 `onBossWin()` | `src/world/World.ts:635-646` |
| `Enemy.detects()` 唯一感知入口；`doAttack()`；`stun()` | `src/entities/Enemy.ts:145-147`、`:202-216`、`:240` |
| `Boss.hit()` 用 `Math.max(2, damage*reduction)`；三阶段 `0.66/0.33`；`boss-phase` 事件 | `src/entities/Boss.ts:153-170`、`:163` |
| `GameScene.create()` 首帧 `writeCheckpoint(..., undefined)`；`update()` 变长 `dt` + `paused` 早退；`saveCheckpoint()` / `onDeath()` / `onBossWin()` | `src/scenes/GameScene.ts:61-130`、`:110-115`、`:251-255`、`:366-371`、`:428-436`、`:439-458` |
| `GameOverScene`：`won===true` → `EXTRACT COMPLETE`，否则 `SIGNAL LOST`；无二选一 UI | `src/scenes/GameOverScene.ts:9-46`、`:21` |
| `window.__game` 只读探针；`gameBus` 单例无消费者 | `src/main.ts:37`、`src/core/eventbus.ts:71` |
| `ENEMY_STATS.boss_warden`（`maxHp 2400`、`armor 12`、`aggroRange 99999`） | `src/config/enemies.ts:66-78` |
| 现存非确定性 `Math.random()` | `src/entities/Boss.ts:142`、`src/scenes/GameScene.ts:85`、`src/scenes/LevelUpScene.ts:117`、`src/world/World.ts:433`、`:644` |
| 真实测试数 Vitest 15 / Playwright 10（7 spec 文件） | `src/core/runtime.test.ts`、`tests/*.spec.ts` |

> 源码事实数值（`SAVE_VERSION=2`、`maxHp 2400`、`Math.max(2,…)`、15/10 测试数）与章节号、任务号、用例 ID 不是调参值。仅本文件新增的测试 fixture 初值与引用 RER §6 的设计参数标 `Prototype Tuning Values — 原型调参初值`。

### 1.2 用户 Task 覆盖

| 用户 Task | 内容 | 主规则 | 测试族 |
| --- | --- | --- | --- |
| 01 | 概念 / 五层模型 | RER §1、§2 | `G2T-U-41..44`、`G2T-C-07/08` |
| 02 | 四目标状态表（门 / relay / 桥 / 敌人连接） | RER §4.1–§4.4 | `G2T-U-01..40`、`G2T-M-01..04` |
| 03 | 操作矩阵（12 格 + 手动交互） | RER §5 | §3.1、`G2T-U-01..12` |
| 04 | 因果执行顺序、几何、LOS、幂等、失败码 | RER §7、§8.1、§9 + VSCC §2–§4 | `G2T-C-01..10`、`G2T-U-45..48` |
| 05 | Energy 与软锁 | RER §6、§6.1 | `G2T-U-33..37`、`G2T-M-05/06` |
| 06 | 四类信息可见性与 ECHO | RER §10 | §2、`G2T-V-01..08` |
| 07 | 房间因果链、Boss、结尾、存档、验收原则 | VSCC §1–§7 + RER §8.2、§11 | `G2T-E-01..08`、`G2T-P-01..10`、`G2T-S-01..08` |

> Task04 含传播几何；Task05 不含传播。D2 只规定四类目标与禁令；能力种类数、走廊条数、房间尺寸均为 `建议冻结`，不是 D2 收窄结果。

### 1.3 主规则关键合同 → 确定断言交叉表

| # | 新合同要点 | 确定断言（测试 ID） |
| --- | --- | --- |
| 1 | Scan 为玩家中心单次脉冲扣一次 10，揭示范围内全部合法目标，不按目标收费；空扫合法且扣费 | `G2T-V-03/05`、`G2T-U-03`、`G2T-C-05`（同源同 tick 去重在扣费前）；`G2T-U-49`（一次脉冲覆盖多目标，只扣一次 10） |
| 2 | Jam 单目标 25/6s/8sCD；生效中重施 `E_RETRYABLE` 零费；Decoy 点投 20/8s/10sCD、施法及接收半径 5 格、最多 1 源，新源成功才替换旧源 | `G2T-U-01/09/13`、`G2T-U-12`（Decoy 单源替换）、`G2T-C-04`（生效中重施）、`G2T-U-46`（严格 `d<radius`） |
| 3 | 所有几何严格 `d<radius`；技能中心点距离不加碰撞半径；LOS 只读格线 supercover、去两端、墙角两侧格都查、`tile.type` 判定、不按墙距切断模板连接边 | `G2T-U-45..48` |
| 4 | Door 有效封锁不能免费手动开绕谜题（封锁时手动开门 `E_LINK_UNAVAILABLE`）；过期按当前源/意图/占位重算；占位延迟关（`CLOSE_DELAY_TICKS`）不夹人 | `G2T-M-01`、`G2T-U-05/13/29/40`、`G2T-E-01` |
| 5 | Relay `ACTIVE/INACTIVE/JAMMED/DISABLED`；走廊初始 OFF、两岸免费开关自供电；Boss 节点维护封闭不可手动（`E_NOT_APPLICABLE`）；OFF 同一提交重算桥 / 共享感知 / 护盾，不保持上一输出、不回滚历史 | `G2T-M-03`、`G2T-U-02/18/22/34`、`G2T-E-02/03` |
| 6 | Bridge `UNAVAILABLE/TRANSITIONING/STABLE/UNSTABLE/DISABLED`；1.5s 建立与失稳预警；送进入桥前最后一岸固定安全点、扣 20 HP 可正常死亡→重开；无 `PLACEHOLDER`、无 3 次上限、无 `RECOVERY_MAX`；正常送岸是独立事件不是技能失败码 | `G2T-M-02`、`G2T-U-23/39`、`G2T-E-02/03` |
| 7 | Enemy：共享断线不关本地视觉；玩家可见优先诱饵；Jam 压新信息只调查 TTL 旧位置；`DECOYED` 是可观察标记不是第四连接态；位置证据不含可解析隐藏玩家的 `targetId` | `G2T-M-04`、`G2T-U-04/16/24`、`G2T-E-03` |
| 8 | `instanceId` 只实例重建变化；正常状态只增 `revision`，不使现有 Jam 失效；`sceneEpoch` 仅切片装载 / 检查点恢复 / 新局房间重开变化；单目标重生不清整场景效果 | `G2T-C-07/08`、`G2T-U-21/29..32` |
| 9 | P0 过期与 regen、P1 生命周期、P2 快照去重、P3 校验候选、P4 图求解、P5 事务含 Energy 一次提交、P6 AI 物理、P7 反馈；同 tick 旧 Jam 到期 + 新 Jam 成功无中间关门帧 | `G2T-C-09/10`、`G2T-U-17/25` |
| 10 | 合法重复返回原回执 + `replayed=true` 且本次无资源写；不是 `E_DUPLICATE_ACTION`；同 ID 不同载荷 `E_ID_PAYLOAD_MISMATCH`；缓存键 `(sceneEpoch, actorId, requestId)`；epoch/生命周期先于去重；错误码完全取 RER §9 | `G2T-C-03/04/06`、`G2T-U-09..12` |
| 11 | 存档首选独立键 `last_signal_station_zero_save_v2`，保留原主/economy 键；v2 基础 + 可选 reality 扩展、`sliceSchema`/`templateId`/`templateRevision` 判别；安全点保存临时 `remainingTicks`/冷却/regen 同一快照；新 epoch 重绑；是未来建议接口非已支持；不战斗内存档；不自动 Save3 | `G2T-S-01..08` |
| 12 | 选择本局幂等不可撤销、写失败 `E_SAVE_FAILED` 可重试、不读原 `run` 凭空授权；下一局可再次选并替换这一个世界结果 | `G2T-E-06`、`G2T-S-06/07` |
| 13 | Boss 减伤 0.5/1.0 保留 `max(2,…)`；配对 20 次、护甲后单次 20 → 200 vs 400；不强制 TTK 1.2；普通战斗仅 Boss 零 Signal 可胜（门谜题仍需 Jam）；同时死亡失败优先 | `G2T-M-06/07`、`G2T-E-04/05` |
| 14 | 理解证据不能仅 Scan-Jam-通过推断，需预测 / 解释 / 迁移（到期、占位、断源三种结果 + 同构迁移判断） | `G2T-E-01` 第 9 步、`G2T-P-07/09` |
| 15 | 走廊 B 不能用「清怪才产生传送门」门槛封死诱导路线；未击杀敌人留原房间，桥可通行与玩家到岸触发下一房间 | `G2T-E-03` |

### 1.4 测试约定

- **ID**：`G2T-<族>-<两位序号>`；族 = `U`（Vitest 纯逻辑）、`C`（周期/并发/幂等/epoch）、`M`（机制与软锁反例）、`E`（真实浏览器 E2E）、`P`（无提示试玩）、`S`（存档恢复）、`V`（可见性）。
- **七要素（每个用例强制）**：`① ID` / `② 输入初态` / `③ 操作序列与 tick` / `④ 期望状态` / `⑤ 资源与失败码` / `⑥ 观察证据` / `⑦ pass / fail 判据`。
- **失败码**完全取 RER §9：`OK`、`E_NOT_APPLICABLE`、`E_ILLEGAL_TARGET`、`E_LINK_UNAVAILABLE`（当前封锁禁止普通开门）、`E_ENERGY_INSUFFICIENT`、`E_COOLDOWN`、`E_PAUSED`、`E_PERMISSION`、`E_TARGET_DESTROYED`、`E_STALE_GENERATION`、`E_STALE_EPOCH`、`E_ID_PAYLOAD_MISMATCH`、`E_RETRYABLE`（仍在效果期或事务校验失败）、`E_NO_FAR_SHORE`（仅装载期）、`E_CHOICE_CONFLICT`、`E_SAVE_FAILED`。桥安全送岸是独立事件反馈，不是失败码。非法请求零扣费、无冷却变化、无新效果；错误按 epoch → 生命周期 → ID 载荷 → 权限/暂停 → 支持性 → 目标几何 → 目标状态 → Energy → 冷却，返回第一个原因。
- **周期**：P0–P7 是单个逻辑 tick 内部阶段（与开发阶段 P0–P5 无关）。`TICK_HZ=60`、`MAX_FRAME_DELTA_MS=250` / `MAX_TICKS_PER_FRAME=15` 为 `Prototype Tuning Values — 原型调参初值`。`t0` 起始 tick；Effect 创建于 T、持续 D>0 在 T+D 的 P0 移除；瞬发 Scan 不进零时长效果集合。
- **初态 `S0`**：固定模板入口（VSCC §1）装载完成、`sceneEpoch=e0`、走廊 relay `INACTIVE`（初始 OFF、两岸本地开关可用、本地供电）、Boss 护盾节点 `ACTIVE`（维护封闭、默认 ON、不可手动 OFF）、桥 `UNAVAILABLE`、谜题门 `SEALED`、对照门 `CLOSED`、`Energy=100`、`discoveredEndpoints` 为空集、模板边为有向无环图且校验通过（端点 / 控制路径 / 两岸固定安全点 / 门前等待区）。
- **观察记号**：`LOG(...)` 结构化状态日志；`REPLAY(json)` 受控模拟同初始规则状态 / 固定步长 / 权威位置快照序列 / 有序动作 / RNG 状态逐 tick 比对；`DTO(class)` 四类信息出参；`HUD(text)`；`SHOT(name)`；`SNAP(hash)`；`SAVE(json)` 存档快照。
- **fixture 红线**：deterministic fixture 只用于设置（模板 / seed / 初始 Energy / 存档注入 / 敌人摆位 / Boss 数值初值），不代替实际动作验收；`window.__game` 只允许作只读状态探针。

---

## 2. 四类信息（用户指定）与可见性断言

### 2.1 四类访问类别（唯一分类体系，字段级访问政策；`建议冻结`）

> 同一目标可同时具有普通外观记录、Scan 链路记录与 ECHO 事件记录；不把全部字段合并发布。

| 类别 | 玩家 UI 与 ECHO | 判定、失效与 Scan |
| --- | --- | --- |
| Ordinary Visible | 玩家直接看见；ECHO 可读同一公开表现 | 同房间 12 格内且 LOS；离开后停止 live 更新。只给 open/closed/held、承重/预警外观，不直接暴露 SEALED 原因 |
| Scan Revealed | 玩家叠层可见，ECHO 同权限可读 | 扫描范围/LOS 内合法端点与连接子集；8 秒 TTL；当前 LOS/距离失效也停止 live。过期只保留带时刻的已发现摘要，再 Scan 才刷新 |
| ECHO Observable | UI 通过台词表达，ECHO 读取本地接收器事件 | 同房间 12 格内且信号 LOS；可知道粗粒度载波活动/变化，不知道隐藏源精确位置或完整依赖图；已发生事件保留历史，不当作 live 状态 |
| Hidden | 玩家 UI 与 ECHO 均不可读 | 未发现端点、未来阶段、内部计时/巡逻点、seed/RNG、原始 SaveData；Scan 只改变当前可揭示字段，其余仍隐藏 |

> 模板合法端点不自动等于已发现。普通观察建立实体发现，Scan 可新增范围内且 LOS 合法的端点；只读 `World` 内部完整图供求解，不序列化给 ECHO 或 Harness。观察 DTO 仅允许 `targetId` / 可见网格位置 / 公开表现 / `observedAtTick` / `stale` 标记，以及获得 Scan 权限时的 `signalPresent`/`suppressed`/`discoveredLinks`；禁止直接返回 `EnemyData`/`World`/`Phaser.Scene`/raw `targetId`/`SaveData`/模板源对象。Hypothesis 与已观察事实分开，不自动成为 Canonical。

### 2.2 三实例逐主体回答（`建议冻结`）

| 实例 | Ordinary Visible | Scan Revealed | ECHO Observable | Hidden |
| --- | --- | --- | --- | --- |
| 实验室门 | 相同外观、一扇能开另一扇关闭 | 受控门有持续封锁接收、当前压制状态、本地合法连接 | 合法范围先报告载波持续或改变；根据真实 Scan/开门事件形成假设 | 远端源坐标、全图连线、未观察状态 |
| 走廊 relay | 硬件、开关灯、桥承重及敌人可见反应 | 当前输出、桥/敌人已发现端点的关联子集 | 接收一次输出变化事件，可提醒同时有两类变化 | 完整依赖图、墙后未扫描节点、未来后果脚本 |
| Warden | 血条、护盾外观、已进入的阶段 | 护盾来源需 Scan 确认才发布已发现源和当前连接 | 可报告当前载波变化，不能 Scan 前直接报完整来源 | 未触发阶段、阶段阈值脚本、完整护盾图 |

### 2.3 可执行断言（fixture 初值标 `Prototype Tuning Values — 原型调参初值`）

| ID | ② 输入初态 | ③ 操作序列与 tick | ④ 期望状态 | ⑤ 资源与失败码 | ⑥ 观察证据 | ⑦ pass / fail 判据 |
| --- | --- | --- | --- | --- | --- | --- |
| `G2T-V-01` | S0，模板含 4 个未发现端点、1 个已发现端点 | `t0` 请求全部观察 DTO | 只返回有权获知的已发现端点子集；4 个未发现端点不出现；DTO 仅含白名单字段 | `0` / `OK` | `DTO(all)` + `LOG(discoveredEndpoints)` | pass：出参集合 ⊆ 已发现端点、无 `seed`/全图连线/未触发阶段/`EnemyData`/`World` 对象；fail：出现 Hidden 字段或全图 `inputs/outputs` |
| `G2T-V-02` | S0，门 `SEALED`、尚未 Scan | `t0` 读玩家 UI；`t0` 读 ECHO 行 | UI 只见 open/closed/held 外观，不直接暴露 SEALED 原因；ECHO 只报粗粒度载波活动 | `0` / `OK` | `HUD(door)` + `DTO(DOOR)` | pass：无 `linkId`/`sealSignalPresent`/源坐标；fail：未 Scan 即揭示链路或 ECHO 报完整来源 |
| `G2T-V-03` | `G2T-V-02` 终态，`E=100`，范围内有门 + relay + 桥 + 敌人连接 4 个合法目标 | `t1` 一次 `Scan` 脉冲；`t1+1` 读出参 | **一次脉冲扣 10**，揭示 4 个合法目标的 `Scan Revealed` 记录，`discoveredAtTick=t1`、`ttlTicks=480`、`live=true`；不按目标数重复扣费 | 一次 `-10` / `OK` | `DTO(Scan Revealed)` + `LOG(records.count,E,ttlTicksLeft)` | pass：`records.count` = 范围内合法目标数且 `E=90`；fail：每个目标各扣 10 或只揭示第一个目标 |
| `G2T-V-04` | `G2T-V-03` 终态 | `t1+480` 读记录；`t1+481` 读 `live`；`t2` 再 Scan 刷新 | TTL 归零后 `live=false`、带时刻的 discovered 摘要仍在；重扫刷新需新脉冲 | `-10` / `OK`（刷新） | `LOG(live,discoveredAtTick,ttl)` | pass：历史保留、`live` 随 LOS/距离/TTL 停止；fail：历史被删或超 TTL 仍出参、免费刷新 |
| `G2T-V-05` | S0，relay 有 5 个端点但只发现 2 个 | `t0` Scan 脉冲覆盖 relay；`t0+1` 读 `inputs/outputs` | 只含 2 个已发现端点子集；其余 3 个保持 Hidden；不泄漏完整依赖图 | 一次 `-10` / `OK` | `DTO(RELAY)` + `SNAP(endpoints)` | pass：出参端点数 = 2；fail：出现未发现端点或模板边全集 |
| `G2T-V-06` | S0，Boss 护盾节点未 Scan、阶段 2 未触发 | `t0` 读 Boss 出参 | 只知血条/护盾外观/已进入阶段；`shieldSourceLinkId` 为空、无未来阶段列表 | `0` / `OK` | `DTO(BOSS)` | pass：无护盾源、无未来阶段；fail：未 Scan 给出来源或阶段脚本 |
| `G2T-V-07` | `G2T-V-06` 终态 | `t1` Scan 脉冲确认护盾来源；`t2` 触发 `boss-phase` | `shieldSourceLinkId` 仅 `t1` 后可见；`phaseVisible` 仅 `t2` 后为 true | 一次 `-10` / `OK` | `DTO(BOSS)` + `LOG(boss-phase)` | pass：两字段分别按 Scan / 事件解锁；fail：任一提前出现或 ECHO 在 Scan 前报完整来源 |
| `G2T-V-08` | S0，ECHO 脚本表就绪 | `t0..t3` 依次发生门 Jam、桥预警、选择提交 | ECHO 只引用已发生真实事件行 ID；不携带 Hidden 内容、不读全依赖图、不随机拒绝合法操作、不代玩家提交结尾选择 | `0` / `OK` | `LOG(echo.lines)` + `DTO(ECHO Observable)` | pass：行集合 = 3 且无 Hidden 内容；fail：引用未发生事件、携带内部计时/seed 或越权 |

---

## 3. 覆盖矩阵

### 3.1 操作矩阵（RER §5：4 目标 × 3 能力的 12 格；Scan 为一次脉冲，不按目标收费）

| # | 目标 × 能力 | 允许 | 扣费 | 对应测试 ID |
| --- | --- | --- | ---: | --- |
| 1 | `Door × Scan` | true（距离/LOS；揭示当前封锁接收与合法边；8s TTL；冷却后可刷新；不改下游） | 10/脉冲（与其他目标同脉冲只扣一次） | `G2T-V-02/03`、`G2T-U-49` |
| 2 | `Door × Jam` | true（单目标；25/6s/8sCD；压制接收；生效中重施 `E_RETRYABLE` 零费） | 25 | `G2T-U-01/09/13`、`G2T-M-01`、`G2T-E-01` |
| 3 | `Door × Decoy` | false（门不接收诱饵；`E_NOT_APPLICABLE`） | 0 | `G2T-U-07` |
| 4 | `Relay × Scan` | true（揭示当前发射及可扫描端点子集；8s TTL） | 10/脉冲 | `G2T-V-05` |
| 5 | `Relay × Jam` | true（发射 OFF；桥/共享感知/护盾同步重算；不可刷新现有 Jam） | 25 | `G2T-U-18`、`G2T-M-03`、`G2T-E-03` |
| 6 | `Relay × Decoy` | false（设备不进行目标调查；`E_NOT_APPLICABLE`） | 0 | `G2T-U-08` |
| 7 | `Bridge × Scan` | true（揭示承重、预警与已发现控制端；不改承重；8s TTL） | 10/脉冲 | `G2T-U-03` |
| 8 | `Bridge × Jam` | false（桥无直接信号接收器；提示操作中继器；`E_NOT_APPLICABLE`） | 0 | `G2T-U-07` |
| 9 | `Bridge × Decoy` | false（桥不感知诱饵；`E_NOT_APPLICABLE`） | 0 | `G2T-U-07` |
| 10 | `Enemy Link × Scan` | true（揭示当前可观察信息来源类别；不读内部 FSM） | 10/脉冲 | `G2T-U-04` |
| 11 | `Enemy Link × Jam` | true（单目标；25/6s/8sCD；屏蔽新信息；AI 按已有合法信息行动） | 25 | `G2T-U-04/16`、`G2T-M-04` |
| 12 | `Enemy Link × Decoy` | true（合法落点且敌人可接收；20/源；8s/10sCD；最多 1 源，新放置成功才替换旧源） | 20 | `G2T-U-04/12/24`、`G2T-E-03` |

**手动交互（矩阵外，`建议冻结` 细节提案，标提案即可，本轮不另行申请批准）**

| 目标 | 条件 | 影响 | 扣费 | 重复 | 测试 ID |
| --- | --- | --- | ---: | --- | --- |
| 走廊 relay 两岸控制器 | 可达、本地供电 | 按交互键 ON/OFF，零 Energy / 无冷却，影响整组下游，按 `requestId` 幂等 | 0 | 幂等回执 | `G2T-U-02/34`、`G2T-M-03`、`G2T-E-02` |
| 普通门（无有效封锁） | `SEALED` 为 false | 手动开/关（`OPEN`/`CLOSED`），关闭仍受占位保护 | 0 | 幂等回执 | `G2T-U-40`、`G2T-M-01` |
| 谜题门（`SEALED`） | 有效封锁存在 | 手动开门 `E_LINK_UNAVAILABLE`，原意图不变、零 Energy，不能绕谜题 | 0 | 明确失败 | `G2T-U-05/40`、`G2T-E-01` |
| Boss 护盾 relay | 维护封闭 subtype | 普通交互 `E_NOT_APPLICABLE`，不能免费关闭 | 0 | 明确失败 | `G2T-U-06`、`G2T-M-07` |

> Bridge、Enemy Link 没有手动状态修改操作；Boss 节点本地供电不可被玩家破坏；首切片不支持破坏四类设备。空 Scan 仍合法且扣费，反馈「范围内未发现目标」，不能借免费目标探测获知隐藏物。三能力均不能在暂停、死亡、`E_PERMISSION` 时执行。

### 3.2 用户 7.2 十维覆盖矩阵（合法 / 非法 / 重复 / 到期 / 多效 / 销毁 / 暂停 / 重开 / 不足 / 恢复）

> 测试覆盖维度，与 RER §5 的 12 格操作矩阵互不替代。

| 维度 | 门 | relay | 桥 | 敌人连接 |
| --- | --- | --- | --- | --- |
| 合法 | `G2T-U-01` | `G2T-U-02` | `G2T-U-03` | `G2T-U-04` |
| 非法 | `G2T-U-05` | `G2T-U-06` | `G2T-U-07` | `G2T-U-08` |
| 重复 | `G2T-U-09` | `G2T-U-10` | `G2T-U-11` | `G2T-U-12` |
| 到期 | `G2T-U-13` | `G2T-U-14` | `G2T-U-15` | `G2T-U-16` |
| 多效 | `G2T-U-17` | `G2T-U-18` | `G2T-U-19` | `G2T-U-20` |
| 销毁 | `G2T-U-21` | `G2T-U-22` | `G2T-U-23` | `G2T-U-24` |
| 暂停 | `G2T-U-25` | `G2T-U-26` | `G2T-U-27` | `G2T-U-28` |
| 重开 | `G2T-U-29` | `G2T-U-30` | `G2T-U-31` | `G2T-U-32` |
| 不足 | `G2T-U-33` | `G2T-U-34` | `G2T-U-35` | `G2T-U-36` |
| 恢复 | `G2T-U-37` | `G2T-U-38` | `G2T-U-39` | `G2T-U-40` |

---

## 4. 单元测试（`G2T-U-*`、`G2T-C-*`；Vitest `environment:'node'`，纯逻辑、不得 import Phaser）

> `建议冻结`；数值仅 fixture 初值标 `Prototype Tuning Values — 原型调参初值`。全部 pass/fail 为判据。

### 4.1 十维矩阵七要素（§3.2 的 `G2T-U-01..40`）

| ID | ② 输入初态 | ③ 操作序列与 tick | ④ 期望状态 | ⑤ 资源与失败码 | ⑥ 观察证据 | ⑦ pass / fail 判据 |
| --- | --- | --- | --- | --- | --- | --- |
| `G2T-U-01` | S0，门 `SEALED`、有效封锁、`E=100` | `t0` 单目标 `Door×Jam`；`t0+1` 读 | `JAMMED_OPEN`、接收器压制、发射源仍在、`passable=true`；原开门意图不锁死 | `-25` / `OK` | `LOG(state,E,code)` | pass：状态精确且 `E=75`；fail：只播动画、改发射源或重复扣费 |
| `G2T-U-02` | S0，走廊 relay `INACTIVE`（初始 OFF）、有存活源、两岸控制器可达 | `t0` 手动 ON；`t0+1` 读 | `ACTIVE`、`emitOn=true`；桥 `TRANSITIONING`、共享感知连上、护盾按拓扑序同一提交；两岸开关仍可用 | `0` / `OK` | `LOG(emitOn,outputs,lastCommittedTick)` | pass：全改或全不改、`E=100`、无 Energy 消耗；fail：部分下游先改、扣费或自封开关 |
| `G2T-U-03` | S0，桥 `STABLE` | `t0` 一次 Scan 脉冲（同范围还含门/relay/敌人） | 桥 `Scan Revealed` 含承重/预警/已发现控制端；桥状态不变；**只扣一次 10** | 一次 `-10` / `OK` | `DTO(Scan Revealed)` + `SNAP(bridge)` + `LOG(E)` | pass：状态哈希不变、只读、`E=90`；fail：Scan 改桥或按目标重复扣费 |
| `G2T-U-04` | S0，敌人 `LINKED`、玩家不可见、诱饵点合法且可接收 | `t0` `Enemy Link×Decoy`；`t0+1` 读 | 诱饵实际胜出 → 可观察标记 `DECOYED`、连接状态仍 `LINKED`、无强制眩晕、无 `stunTimer`、不改 `stateTimer` | `-20` / `OK` | `LOG(marker,linkState,target)` | pass：标记与连接态分离、玩家可见时仍优先玩家；fail：`DECOYED` 成为第四连接态或强制 stun |
| `G2T-U-05` | S0，门 `SEALED` | `t0` 手动开门；`t0+1` 对自由地形/第 5 类目标发 Jam | 手动开门 `E_LINK_UNAVAILABLE`、原意图不变；Jam 拒绝、无新对象 | `0` / `E_LINK_UNAVAILABLE`、`E_ILLEGAL_TARGET` | `LOG(code,E,effects)` | pass：零扣费 + 明确码 + 有效封锁不可免费绕过；fail：SEALED 被普通开门绕过或静默 |
| `G2T-U-06` | S0，Boss 护盾节点维护封闭；relay 正常 | `t0` 普通交互关闭 Boss 节点；`t0+1` 请求 `ANCHOR/SEVER/RELAY/INVERT` 技能 | Boss 节点 `E_NOT_APPLICABLE`；高级协议 `E_ILLEGAL_TARGET`；状态/HP 不变 | `0` / `E_NOT_APPLICABLE`、`E_ILLEGAL_TARGET` | `LOG(code,E,boss.hp)` | pass：全程无高级协议对象、Boss 输出 ON 不变；fail：免费关闭护盾或出现技能对象 |
| `G2T-U-07` | S0，桥 | `t0` `Bridge×Jam` / `Bridge×Decoy` / `Door×Decoy` / `Relay×Decoy` | 桥状态、门状态不变 | `0` / `E_NOT_APPLICABLE`（各格含理由） | `LOG(code,E,reason)` | pass：明确「不适用+原因」且零扣费；fail：扣费或误改状态 |
| `G2T-U-08` | S0，敌人 | `t0` 对不存在的伪目标 Decoy；`t0+1` 越界/不可走格点 Decoy | 目标不变、不生成伪实体、不按敌人数扣费 | `0` / `E_ILLEGAL_TARGET` | `LOG(code,E,enemies.length)` | pass：`world.enemies` 不增、零扣费；fail：伪实体进入 `world.enemies` 或按敌数扣费 |
| `G2T-U-09` | S0，门 | `t0` 同 `(sceneEpoch,actorId,requestId)` 同载荷两次 Jam | 一个 Jam 效果、门状态一次转换 | 首次 `-25`；重放返回原回执 + `replayed=true`、`resourceWritesThisCall=0`、原 `energyDelta=-25` 保留 | `LOG(effects.count,receipt,E)` | pass：effects=1、`E=75`、原回执未改写；fail：返回 `E_DUPLICATE_ACTION` 或二次扣费 |
| `G2T-U-10` | S0，relay | `t0` 同 `requestId` 手动 ON 两次 | `outputs` 只提交一次 | `0` / `OK` + `replayed=true` | `LOG(lastCommittedTick,receipt)` | pass：一次原子提交；fail：重复事件或重复反馈 |
| `G2T-U-11` | S0，桥 | `t0` 同 `requestId` 两次 Scan 脉冲 | 一条揭示记录，TTL 不叠加 | 一次 `-10` / `OK` + `replayed=true` | `LOG(records.count,ttlTicks)` | pass：TTL=480；fail：TTL 翻倍或二次扣费 |
| `G2T-U-12` | S0，敌人，玩家已有 1 个诱饵源 | `t0` 冷却就绪后新放置 Decoy 成功 | 最多 1 源；新放置成功才替换旧源；旧源效果移除 | `-20` / `OK`；未冷却/失败则 `E_COOLDOWN` / `E_RETRYABLE` 零费 | `LOG(sources.count,oldId,newId)` | pass：源数恒 1 且替换原子；fail：双源并存或失败仍替换旧源 |
| `G2T-U-13` | `G2T-U-01` 终态，Jam 剩余 1 tick、玩家已穿过门、`occupancy=true` | `tD` 到期；`tD+1` 读 | P0 移除 Jam；恢复接收；按当前源/意图/占位重算得 `SAFE_PENDING_CLOSE`；L1 `wx/wy`/`hp`/`projectiles` 不变 | `0` / `OK` | `LOG(state,sealSignalPresent,occupancy)` + `SNAP(L1)` | pass：不回滚、不夹死、安全延迟关；fail：门把玩家挤回或瞬间 `SEALED` |
| `G2T-U-14` | relay 上一条 Jam 效果 | `tD` 最后一个 Jam 到期 | 依据当前源和开关转 `ACTIVE/INACTIVE`；不回放 Jam 前输出序列 | `0` / `OK` | `LOG(inputs,emitOn,manualEnabled)` | pass：按当前输入重算；fail：回放旧输出 |
| `G2T-U-15` | 桥 `UNSTABLE`、`unstableUntilTick=t0+90`、无玩家 | `t0+90` 读 | `UNAVAILABLE`、不扣 HP、无送岸事件 | `0` / `OK` | `LOG(state,hp,events)` | pass：无玩家不扣血、预警期内仍承重；fail：立即扣血或 `PLACEHOLDER` 态 |
| `G2T-U-16` | Decoy 生效中、已出手弹丸 3 个 | `tD` 到期 | 按当前输入重算目标；`projectiles.length` 不因 Decoy 结束减少 | `0` / `OK` | `LOG(projectiles.length,marker)` | pass：弹丸数不减、`DECOYED` 标记清除；fail：弹丸被删/重定向或 Jam 写 `stunTimer` |
| `G2T-U-17` | 门同 tick 多个合法 Jam（不同源、同目标） | `t0` 入队；P4 求未过期效果并集 | 压制取**并集**、不叠加强度；最后一个结束才恢复；P5 只发布最终状态、无中间关门帧 | 各 `-25` / `OK` | `REPLAY(json)` + `LOG(I_eff,effects)` | pass：两次重放逐 tick 相等、取并集；fail：求和或与插入顺序相关 |
| `G2T-U-18` | relay `ACTIVE`、上游 ≥2、1 个坏下游分支 | `t0` Jam（`emitOn=false`）；`t0` P5 提交 | 桥 `UNSTABLE` 预警、共享感知 `sharedConnected=false`、Boss 护盾弱化在同一候选快照按拓扑序求解；坏下游分支整批回滚、状态/扣费/冷却/效果一起回滚 | `-25`；坏分支 `0` / `E_RETRYABLE` | `LOG(outputs,emitOn,snapshot)` + `SNAP` | pass：无半更新、无「保持上一输出」、无历史回滚；fail：部分下游先改或下游保持旧值 |
| `G2T-U-19` | 桥 + relay + 敌人双影响 | `t0` relay 手动 ON | `TRANSITIONING` 与共享感知连上同 tick 落地；不「先过桥后激活敌人」 | `0` / `OK` | `LOG(bridge.state,enemy.sharedConnected,t)` | pass：双影响同 tick 可观测；fail：跨 tick 分裂 |
| `G2T-U-20` | 敌人同时收 Jam + Decoy、玩家可见 | `t0` 两效果入队；P6 求目标 | 优先级「死亡 → Jam → 局部可见玩家 → 可接收诱饵 → 未过期位置证据 → 巡逻」；Jam 时只调查旧位置 | 各 `-25`/`-20` / `OK` | `REPLAY(json)` + `LOG(grade)` | pass：全序确定、共享断线不关本地视觉；fail：共享信息越级强迫攻击 |
| `G2T-U-21` | 门 `JAMMED_OPEN` 且合法 Jam Effect 活跃，`instanceId=i0` | `t0` 连续 3 次正常状态变更（只 `revision+=1`）；`t0+1` 读 | Jam Effect 仍有效、`instanceId=i0`、`revision=3`、无 `E_STALE_GENERATION` | 按操作 / `OK` | `LOG(instanceId,revision,effects)` | pass：状态变更不使合法 Jam 失效；fail：Effect 下 tick 失效或 `instanceId` 自增 |
| `G2T-U-22` | relay 被销毁，下游仍在线 | `t0` 销毁（`DISABLED`）；`t1` P0 移除引用 | 本 tick 消费者仍可见；下游按失联求解、无悬空引用 | `0` / `E_TARGET_DESTROYED` | `LOG(downstream,errors)` | pass：延迟移除且无 `pageerror`；fail：下游保持旧输出或崩溃 |
| `G2T-U-23` | 桥 `UNAVAILABLE`、最后一岸固定安全点已装载期校验 | `t0` 第 N 次（含第 4 次）手动重启 relay | 再走 `UNAVAILABLE → TRANSITIONING → STABLE`，与第 1 次一致、有限 tick 结束 | `0` / `OK` | `LOG(recovery.index,state,t)` | pass：任意次数可恢复、无 `RECOVERY_MAX`/`PLACEHOLDER`；fail：第 4 次卡住或无限等待 |
| `G2T-U-24` | 敌人在 Decoy 生效中被击杀 | `t0` 击杀；`t1` P0 | 诱饵效果按 `(instanceId, epoch)` 失效；无 `'dead'` FSM case 赋值；单目标重生不清整场景效果 | `0` / `E_TARGET_DESTROYED` | `LOG(enemy.state,effects)` | pass：无 `'dead'` 赋值、其他实例不受影响；fail：引用已销毁对象或清整场景效果 |
| `G2T-U-25` | Jam 剩余 tick=3 | `t0` 暂停；`t0..t0+N` 冻结；`tR` 恢复 | `tickIndex` / `Energy` / 冷却 / 全部 TTL / `lastKnownPosition` 冻结 | 暂停期 `0` / `E_PAUSED` | `LOG(tickIndex,remaining,E)` + `LOG(accumulatorMs)` | pass：全冻结、暂停入口清帧累加器、恢复无补帧/无离线补时；fail：暂停期恢复 Energy 或补帧 |
| `G2T-U-26` | relay 下游更新中 | `t0` 暂停 → `tR` 恢复 | 原子提交不被切成两半 | `0` / `E_PAUSED` | `REPLAY(json)` | pass：暂停前后重放一致；fail：半提交 |
| `G2T-U-27` | 桥 `UNSTABLE` 中 | `t0` 暂停 → `tR` 恢复 | `unstableUntilTick` 冻结；恢复后有限推进 | `0` / `E_PAUSED` | `LOG(unstableUntilTick,tickIndex)` | pass：暂停不白送恢复；fail：暂停期自动 `STABLE` |
| `G2T-U-28` | 敌人 `detect` 中 | `t0` 暂停 → `tR` 恢复 | `stateTimer` / 位置证据 TTL 冻结；从原状态继续 | `0` / `E_PAUSED` | `LOG(state,stateTimer,ttl)` | pass：状态不跳变；fail：恢复后直接 `chase` |
| `G2T-U-29` | 门 `JAMMED_OPEN`、`sceneEpoch=e0` | `t0` 场景恢复 → `e1` | 模板初值或最近安全点快照（区别于 Jam 到期）；`instanceId` 按稳定 `targetId` 重绑；旧 `e0` 请求 `E_STALE_EPOCH` | `0` / `E_STALE_EPOCH` | `LOG(epoch,instanceId,revision)` | pass：无跨 epoch 生效；fail：旧 Jam 在新 epoch 生效或误清零冷却 |
| `G2T-U-30` | relay 有活跃输出 | `e0→e1`（新局/房间重开） | 输出按模板初值/快照重建；`instanceId+=1`、`revision=0` | `0` / `E_STALE_EPOCH` | `LOG(outputs,epoch,instanceId)` | pass：无残留；fail：复活已销毁源或串入旧输出 |
| `G2T-U-31` | 桥 `UNSTABLE` | `e0→e1` 重开 | 桥回模板初态 `UNAVAILABLE`、玩家在安全位置 | `0` / `E_STALE_EPOCH` | `LOG(bridge.state,player.pos)` | pass：初态一致；fail：继承旧桥状态或随机传送掩盖不兼容 |
| `G2T-U-32` | 敌人连接活跃、位置证据非空 | `e0→e1` 重开 | `LINKED` 或模板初值、旧指令不投递到新实例 | `0` / `E_STALE_EPOCH` | `LOG(enemy.state,evidence)` | pass：无旧指令残留；fail：旧位置串入新局 |
| `G2T-U-33` | `E=24`（< JAM 25），必经门 | `t0` `Door×Jam` | 明确失败、门不变；玩家在门前无持续伤害/敌人不可进入的等待区，`1 Energy/12 ticks`，0→25 需 300 ticks（5 逻辑秒） | `0` / `E_ENERGY_INSUFFICIENT` | `LOG(code,E,waitTicks)` | pass：零扣费 + 可重试 + 等待有界；fail：扣成负数、锁死或设超时 |
| `G2T-U-34` | `E=0`，走廊 relay 两岸控制器 | `t0` 手动 ON | 仍成功（手动 `cost=0`、本地供电、两岸可达） | `0` / `OK` | `LOG(emitOn,E)` | pass：不因 `E=0` 阻断；fail：要求 Energy 或开关依赖下游电路 |
| `G2T-U-35` | `E=9`（< Scan 10），桥预警 | `t0` Scan 脉冲 | 明确失败；桥承重/预警外观仍属 Ordinary Visible 可见 | `0` / `E_ENERGY_INSUFFICIENT` | `LOG(code,E)` | pass：零扣费 + 可重试；fail：静默失败或免费目标探测 |
| `G2T-U-36` | `E=19`（< Decoy 20） | `t0` Decoy | 明确失败、无源生成、旧源不被替换 | `0` / `E_ENERGY_INSUFFICIENT` | `LOG(code,E,sources.count)` | pass：零扣费 + 可重试；fail：部分效果落地或替换旧源 |
| `G2T-U-37` | `G2T-U-33` 失败后、冷却就绪 | `t0..t0+299` 固定 tick 恢复；`t0+300` 重试 Jam | `E=25` → 合法成功、门 `JAMMED_OPEN` | `-25` / `OK` | `LOG(E,t,state)` | pass：整数累加器无浮点漂移、满值清恢复余数；fail：`dt*5` 累加漂移 |
| `G2T-U-38` | relay `INACTIVE`（源全失） | `t0` 源恢复；`t0+1` | 按当前 `inputs`（`sourceId` 升序、取 `max`、平局按事件 ID）重算；连接恢复不复活已销毁源；不回放历史位置/HP/弹丸 | `0` / `OK` | `LOG(downstream,inputs)` + `SNAP` | pass：无 L1 回滚、无复活；fail：复活已销毁源或回放历史中间态 |
| `G2T-U-39` | 桥 `UNSTABLE` 且有玩家、`hp=100` | `t0+90` 到期；`t0+91` 读 | 一次送到进入桥前最后一岸的固定安全点、`hp=80`、桥 `UNAVAILABLE`；送岸是独立事件反馈，不是技能失败码 | `0` / `OK` + 送岸事件 | `LOG(player.pos,hp,state,events)` | pass：单次流程有限 tick 结束、最多扣 20、`E_SAFE_RECOVERY` 不出现；fail：立即扣血、无限 retry 或假失败码 |
| `G2T-U-40` | 门 `CLOSED`、`manualOpenIntent=false`、无有效封锁；另有 `SEALED` 分支 | 无封锁：`t0` 手动 toggle → `OPEN`；`SEALED`：`t1` 手动开门 → 拒绝 | 无封锁时手动开关有效（关闭仍受占位保护）；`SEALED` 时 `E_LINK_UNAVAILABLE`；断源恢复普通开关能力；封锁恢复占位时先安全待关 | `0` / `OK`、`E_LINK_UNAVAILABLE` | `LOG(resolveDoor,passable,revision)` | pass：`SEALED` 不可免费手动绕过、无封锁可正常开、延迟关不夹人；fail：有效封锁被普通开门绕过或瞬间关门 |

### 4.2 参数 / 五层 / 距离与 LOS 断言（`G2T-U-41..50`）

| ID | ② 输入初态 | ③ 操作序列与 tick | ④ 期望状态 | ⑤ 资源与失败码 | ⑥ 观察证据 | ⑦ pass / fail 判据 |
| --- | --- | --- | --- | --- | --- | --- |
| `G2T-U-41` | S0；构造 Signal→Physical 写请求 | `t0` 尝试把「恢复接收」写回旧位置/HP/弹丸 | L1 不变；设备可改变**当前**碰撞/承重/伤害，禁止恢复 Jam 以前历史物理状态；无 `rewind()` 接口 | `0` / `E_ILLEGAL_TARGET` | `SNAP(L1)` + `LOG(layer)` | pass：无历史物理回滚；fail：L1 被回写 |
| `G2T-U-42` | `E=100` | `t0..tN` 连续恢复 | `0<=current<=100` 封顶、永不为负；满值清恢复余数；暂停/升级/结算冻结 | `0` / `OK`、`E_PAUSED` | `LOG(E,t,state)` | pass：全程 `0<=E<=100`；fail：越界或结算期继续恢复 |
| `G2T-U-43` | S0，跨房间 / 传送 / 新局 | `t0` 跨房间；`t1` 新局 | 跨房间继承资源；新局清临时效果/冷却/恢复余数；房间重试恢复安全点不额外补满 | `0` / `OK` | `LOG(E,cooldown,regenAccumulator,roomId)` | pass：语义逐项成立；fail：传送清零或新局补满 |
| `G2T-U-44` | 受击 / 切武器 / 冷却中 / `E_PAUSED` / `E_PERMISSION` | `t0` 各中断事件 + 能力请求 | 冷却中 `E_COOLDOWN`；非法零扣费、不设冷却；错误按 RER §9 顺序返回第一个原因 | `0` 或按合法扣费 / 相应码 | `LOG(code,E,cooldown)` | pass：每次结果有明确码、错误排序一致；fail：静默或重复扣费 |
| `G2T-U-45` | S0，信号 `radius=6`、接收点 `d=3`、`LOS=1` | `t0` 计算 `I=max(0,1-d/radius)`、`HIT` | `I=0.5`、接收成立；命中只由中心点距离与 falloff/LOS 决定，不加碰撞半径 | `0` / `OK` | `LOG(d,I,HIT)` | pass：无 `target.radius` 扩展参与；fail：出现 `d<=radius+target.radius` 或 `isWalkable(0.5)` 充当视线 |
| `G2T-U-46` | `d===radius`；`radius=0` 或负数配置；Decoy 施法与接收半径 5 格 | `t0` 校验配置，再对正半径求 `HIT` / 接收 | 正半径严格 `d<radius`；`d===radius` → `I=0` 不命中；0或负半径在公式前拒绝，不执行除法；Jam 单目标不按距离改变持续时间 | 拒绝配置不扣费，超距为 `E_ILLEGAL_TARGET` | `LOG(configValidation,HIT,I,dd)` | pass：拒绝非正半径且正半径边界严格小于、无 `NaN`；fail：接受0半径同点命中、边界命中或除零 |
| `G2T-U-47` | 模板含门近墙目标、直线穿墙角、越界端点、`floor/debris/spawn` 格 | `t0` 逐例求 LOS | 先拒越界两端；格线 supercover 枚举经过格、去两端；`wall/lava/water` 阻断、`floor/debris/spawn` 不阻断；穿墙角两侧格都查任一阻断即 `LOS=0`；端点归属 `floor(wx/wy)` 整数/有理格线比较 | `0` / `OK` | `LOG(cells,LOS)` | pass：全部只读 `tile.type`、门不自遮挡、近墙目标不被误挡；fail：门自遮挡或用实体半径采样 |
| `G2T-U-48` | 模板 `Link` 只读逻辑边 + 一次跨墙 Scan 传播 | `t0` 分别求拓扑边与空间传播 | 模板连接边不按墙体距离切断；与玩家施法空间 LOS 分离；图按拓扑序在候选快照内求解、所有下游一次发布 | `-10` / `OK` | `LOG(templateEdges,propagationCells,topoOrder)` | pass：两集合无交叉写入、无环图；fail：拓扑边被技能改写或有环装载未拒绝 |
| `G2T-U-49` | S0，范围内 4 个合法目标 + 1 个未知端点；`E=100` | `t0` 一次 Scan 脉冲；`t0+1` 读 | 揭示 4 个合法目标、未知端点保持 Hidden；只扣一次 10；空扫合法且扣费、反馈「未发现目标」 | 一次 `-10` / `OK` | `DTO(all)` + `LOG(records.count,E)` | pass：`records.count=4 && E=90`；空扫 `E=90` 且无隐藏物泄漏；fail：按目标数扣费或空扫泄露隐藏物 |
| `G2T-U-50` | S0，`E=100`、Jam 生效中 | `t0` 对同目标**新 `requestId`** 重施 Jam；`t0+1` 对 Boss 节点普通交互 OFF | 生效中重施 `E_RETRYABLE` 零费、状态与资源保持提交前值；Boss 节点 `E_NOT_APPLICABLE` | `0` / `E_RETRYABLE`、`E_NOT_APPLICABLE` | `LOG(code,E,effects,boss.emitOn)` | pass：不刷新现有 Jam、不二次扣费、Boss 输出 ON 不变；fail：刷新/扣费或免费关闭 Boss 节点 |

### 4.3 并发 / 幂等 / epoch / 确定性（`G2T-C-01..10`）

| ID | ② 输入初态 | ③ 操作序列与 tick | ④ 期望状态 | ⑤ 资源与失败码 | ⑥ 观察证据 | ⑦ pass / fail 判据 |
| --- | --- | --- | --- | --- | --- | --- |
| `G2T-C-01` | S0，两持有者同 tick 各 1 次合法操作（不同 `requestId`） | `t0` P1→P5 原子事务 | 两次合法各扣一次、生成两个 Effect；`校验→扣费→生成` 在 P5 一次提交；消费者不读半成品 | 各 `-25` / `OK` | `LOG(txn,E,effects,t0)` | pass：扣费次数=生效次数且同 tick；fail：跨 tick 分裂或读到半成品 |
| `G2T-C-02` | 同 tick 1 合法 + 1 非法（不适用格） | `t0` P5 事务 | 非法零扣费 + 明确失败；合法正常；互不污染 | `-25` + `0` / `OK` + `E_NOT_APPLICABLE` | `LOG(txn,codes,E)` | pass：失败零扣费、无部分提交；fail：整体回滚合法请求或非法也扣 |
| `G2T-C-03` | 同 `(sceneEpoch,actorId,requestId)` 同规范化载荷重复到达 | `t0` P1 生命周期 → P2 去重 → P5 | 返回**原完整回执** + `replayed=true`、`resourceWritesThisCall=0`；原 `energyDelta` 保留；不生成新 Effect、不设新冷却 | 首次 `-25`；重放本次写 0 / `OK` | `LOG(receipt,replayed,effects)` | pass：原回执逐字段相同（除 `replayed`/`resourceWritesThisCall`）、无 `E_DUPLICATE_ACTION`；fail：把原 `energyDelta` 改写为 0 或产生新失败码 |
| `G2T-C-04` | 同 `requestId` 不同载荷；另一次 Jam 生效中的新 `requestId` 重施 | `t0` P2 校验 ID 载荷一致性；P3 校验目标状态 | 同 ID 不同载荷 `E_ID_PAYLOAD_MISMATCH`；生效中重施 `E_RETRYABLE`；两者零扣费、状态保持提交前值 | `0` / `E_ID_PAYLOAD_MISMATCH`、`E_RETRYABLE` | `LOG(code,E,effects)` | pass：明确码 + 零费 + 换新 ID 后条件满足可成功；fail：二次执行或静默 |
| `G2T-C-05` | 不同 ID 的同源同 tick 同能力同目标/落点重复（散射类一次扳机） | `t0` P2 排序 → P3 扣费前去重 | 合并为同一 Effect、只产生 1 条信号、不二次扣费；去重发生在扣费前 | 一次扣费 / `OK` | `LOG(event.count,E,t0)` | pass：count=1、`E` 只扣一次；fail：count=5 或二次扣费 |
| `G2T-C-06` | 缓存绑定 `e0`；请求来自 `e1`；另有通过验证后产生的失败 | `t0` P1 生命周期 → P2 去重 | 旧 epoch 请求先 `E_STALE_EPOCH` 挡下、不误命中 `e0` 缓存；缓存按会话生命周期清理；验证后失败也缓存，条件变化用新 ID | `0` / `E_STALE_EPOCH` | `LOG(epoch,cacheHit,seq)` | pass：epoch/实例先于去重；幂等缓存不跨 epoch 误命中；fail：误命中旧缓存 |
| `G2T-C-07` | 目标 `instanceId=i0`、合法 Jam Effect 活跃 | `t0` 5 次正常状态变更 | 只 `revision+=1`（=5）；`instanceId=i0` 不变；Effect 仍有效；请求者不能伪造 caster 坐标（权威位置由游戏读取） | 按操作 / `OK` | `LOG(instanceId,revision,effects,casterGrid)` | pass：无 `E_STALE_GENERATION`、Effect 未失效；fail：`instanceId` 每次状态变更 +1 或坐标可伪造 |
| `G2T-C-08` | 目标实例重建（销毁重生） | `t0` 重建；`t0+1` 旧 `instanceId` 请求 | `instanceId+=1` 仅此一次；旧引用 `E_STALE_GENERATION`；单目标重生不清整场景效果 | `0` / `E_STALE_GENERATION` | `LOG(instanceId,target)` | pass：旧引用不命中新对象、其他实例效果保留；fail：误命中或清整场景 |
| `G2T-C-09` | S0，`frameDeltaMs` 序列含 16ms / 250ms / 1000ms | `t0..tN` 累加器 | `accumulatorMs += min(max(deltaMs,0),250)`；`while` 每帧最多 15 tick；超出上限的整 tick 积压丢弃、保留不足一个 tick 的余数；不做离线补时 | `0` / `OK` | `REPLAY(json)` + `LOG(accumulatorMs,ticksThisFrame)` | pass：超长帧截断、同初始规则状态/固定步长/权威位置快照序列/有序动作/RNG 逐 tick 一致；fail：浮点 `dt` 直接累加或补帧 |
| `G2T-C-10` | S0，P2 权威位置/占位输入 | `t0` 同 tick 读 `playerOnBridge`/`playerInDoorway`；P5/P6 消费 | P2 读同一份权威输入、按 `(tick,操作者ID,requestId)` 排序；移动前采样受控位置、先提交碰撞状态再处理移动；同帧多 tick 各自采样 | 按操作 / `OK` | `REPLAY(json)` + `LOG(occupancySnapshot)` | pass：快照一致、重放一致、无「关闭后又走进门内」；fail：消费者读到不同 occupancy 值 |

---

## 5. 机制与软锁反例（`G2T-M-*`）

**G2T-M-01 门完整状态机 / 有效封锁不可免费绕过**（RER §4.1、VSCC §2）
- ② 初态：S0，谜题门 `SEALED`（有效封锁）、对照门 `CLOSED`、`manualOpenIntent=false`、`occupancy=false`。
- ③ 操作与 tick：`t0` 对 SEALED 手动开门（应拒）；对照门手动开→关；`t1` Jam → `JAMMED_OPEN`；`t2` 玩家穿过（`occupancy=true`）；`tD` Jam 到期；`tD+1` 读；`tD+61` 读（延迟关）；另跑断源 / 源恢复 / 场景卸载 / 新局重开四条支链。
- ④ 期望状态：每 tick 先求有效封锁、再求期望开态；`SEALED` 手动开门 `E_LINK_UNAVAILABLE` 且原意图不变；Jam 不改发射源、不锁死原开门意图；到期恢复接收，按当前源/意图/占位求 `SEALED`/`CLOSED`/`OPEN`/`SAFE_PENDING_CLOSE`；`SAFE_PENDING_CLOSE` 在空出门区后等 `CLOSE_DELAY_TICKS=60` 重算，重新占位重新等待；断源恢复普通开关能力；`DISABLED` 禁新操作、丢弃旧事件；重开用模板初值或最近安全点快照（区别于 Jam 到期），新 epoch。
- ⑤ 资源与失败码：Jam `-25` / `OK`；手动 `0` / `OK` 或 `E_LINK_UNAVAILABLE`；到期 `0` / `OK`。
- ⑥ 观察证据：`LOG(resolveDoor,sealSignalPresent,occupancy,instanceId,revision,t)` + `SNAP(L1)` + `SHOT(door)`。
- ⑦ pass/fail：pass = 六态全序 ∧ 有效封锁不可免费绕过 ∧ 断源允许正常开门 ∧ 占位永不夹人 ∧ L1 无回滚；fail = 瞬间 `SEALED`、夹人、位置/HP 被重写、封锁被普通开门绕过。

**G2T-M-02 桥承重失稳与可反复有限恢复**（RER §4.3）
- ② 初态：S0，桥 `UNAVAILABLE`、最后一岸固定安全点已装载期校验（两岸都有本地控制、无持续伤害、不被可关闭门覆盖、不会被敌人占位阻断）、`hp=100`。
- ③ 操作与 tick：`t0` relay ON → `TRANSITIONING`（建立截止 `<t0+90`）；`t0+30` 断电 → `UNAVAILABLE` 取消建立；`t1` 重建 → `STABLE`；`t2` 输出 OFF → `UNSTABLE`（仍承重、不扣血）；`t2+30` 及时恢复 → `STABLE` 无伤害；`t3` 再失稳到期且有玩家 → 一次送岸；`t4..t7` 第 N 次重启；另跑 `hp=15` 支链与坏模板（`safeShoreTile` 不可用）装载。
- ④ 期望状态：仅 `UNAVAILABLE/TRANSITIONING/STABLE/UNSTABLE/DISABLED`；`TRANSITIONING` 是建立预警、`UNSTABLE` 是失去承重前预警，不混用；`UNSTABLE` 截止且仍 OFF、有玩家 → 一次送到进入桥前最后一岸固定安全点、扣 `BRIDGE_DANGER_HP=20` 后 `UNAVAILABLE`；无玩家不扣血；`hp=0` → 正常死亡 → 清本局 run → 失败/重开；第 N 次同样走 `UNAVAILABLE → TRANSITIONING → STABLE`；坏模板装载期 `E_NO_FAR_SHORE` 拒绝启动，运行时不临时搜索任意格、不报无对岸。非致命送岸不清档。
- ⑤ 资源与失败码：手动重启 `0` / `OK`；送岸是独立事件反馈（不是 `E_SAFE_RECOVERY` 或任何失败码）；坏模板 `0` / `E_NO_FAR_SHORE`（仅装载期）。
- ⑥ 观察证据：`LOG(bridge.state,walkable,hp,recovery.index,t,events)` + `SHOT(bridge)` + `SNAP(player.pos)`。
- ⑦ pass/fail：pass = 单次流程有限 tick 结束 ∧ 任意次数可恢复 ∧ 死亡为合法终局 ∧ 运行时永不报无对岸 ∧ 无 `PLACEHOLDER`/`RECOVERY_MAX`/`E_SAFE_RECOVERY`；fail = 第 4 次卡住 / 立即扣血 / 运行时才报 `E_NO_FAR_SHORE` / 假失败码。

**G2T-M-03 relay 有效发射 OFF 与下游重算**（RER §4.2、§8.1）
- ② 初态：S0，走廊 relay `INACTIVE`（OFF、本地供电、两岸开关可用），Boss 护盾节点 `ACTIVE`（维护封闭、本地源、默认 ON）。
- ③ 操作与 tick：`t0` 走廊开关 ON → `ACTIVE`；`t1` Jam → `JAMMED`、`emitOn=false`；`t1` 读全部下游；`tD` 到期；另跑 `manualOff` / `allSourcesLost` / 多源 / 坏下游分支 / 普通交互关 Boss 节点支链。
- ④ 期望状态：求解优先级「销毁 → 活跃 Jam → `manualEnabled=false` → 无存活输入源 → ACTIVE」；前四种 `emitOn=false`；多源取有效强度 `max`、平局按 `sourceId` 再按事件 ID；增加存活源不能覆盖手动 OFF 或 Jam；`emitOn=false` 在**同一逻辑提交**使桥收到 OFF、共享感知 `sharedConnected=false`、Boss 护盾减弱；各下游用自身安全规则、不保持上一输出、不回滚历史；图按拓扑序在候选快照内求解、所有下游一次发布；Boss 节点普通交互 `E_NOT_APPLICABLE`；坏下游分支连同扣费/冷却/新效果一起回滚 `E_RETRYABLE`；模板结构无效装载期拒绝。
- ⑤ 资源与失败码：Jam `-25` / `OK`；手动 ON/OFF `0` / `OK`（`建议冻结` 提案）；坏下游 `0` / `E_RETRYABLE`；Boss 节点 `E_NOT_APPLICABLE`。
- ⑥ 观察证据：`LOG(relay.state,emitOn,outputs,inputs,t)` + `SNAP(downstream)`。
- ⑦ pass/fail：pass = 四业务态 ∧ 同一快照全改或全不改 ∧ 各目标自身 FSM 决定后果 ∧ 无历史回滚 ∧ Boss 节点不可手动免费关；fail = 「保持下一输出」与「进入默认」并存 / 半提交 / 免费关闭 Boss 节点。

**G2T-M-04 敌人合法信息优先级与攻击边界**（RER §4.4）
- ② 初态：S0，敌人 `LINKED`，玩家可见 / 隐藏、诱饵点、已出手弹丸 3 个、未出手攻击 1 次。
- ③ 操作与 tick：`t0` 玩家可见 + Decoy → 读；`t1` 玩家隐藏 + 诱饵胜出 → 读；`t2` Jam → 读屏蔽通道；`t3` relay OFF → 读本地视觉；`t4` Jam 结束 + 位置证据 TTL；`t5` 断源；`t6` P6 处理未出手攻击。
- ④ 期望状态：连接状态 `LINKED/JAMMED/DISCONNECTED`，`DECOYED` 只是「当前目标来自诱饵」的可观察标记；优先级「死亡 → Jam → 局部可见玩家 → 局部可接收诱饵 → 未过期位置证据 → 巡逻」；局部可见需当前感知半径 + LOS；**共享信息断线不关本地视觉**；Jam 屏蔽**新的**本地视觉/诱饵/共享消息，只能调查 Jam 前已观察的固定位置（不实时追踪隐藏玩家）；位置证据只存 `wx/wy`/`observedAtTick`/`expiresAtTick`，不含可实时解析隐藏玩家的 `targetId`；多条证据取观察 tick 最新者、再按 `senderId` 排序；同 tick 攻击提交前检查合法目标、无当前可攻击目标则取消尚未出手的攻击（不生成弹丸、不扣资源）；已有弹丸继续飞行，Jam 不删弹、不回退伤害、不写 `stunTimer`；玩家重新可见切回玩家。
- ⑤ 资源与失败码：Decoy `-20` / Jam `-25` / `OK`；取消攻击 `0` / `OK`。
- ⑥ 观察证据：`LOG(marker,linkState,sharedConnected,positionEvidence,projectiles.length,attackCancelled)` + `REPLAY(json)`。
- ⑦ pass/fail：pass = 全序确定 ∧ 玩家可见优先 ∧ 共享断线不误作局部失明 ∧ 弹丸数只因命中/过期减少 ∧ 未出手攻击不用上一 tick `targetId`；fail = 旧 `targetId` 实时追踪 / 弹丸回滚 / 强制眩晕 / `DECOYED` 作第四连接态。

**G2T-M-05 软锁反例集（必须证明不会发生）**
- ② 初态：最坏组合（门前耗尽 Energy、桥无安全岸点模板、relay 关闭/Jammed、Jam/Decoy 并发、暂停中到期、重开带旧引用、`E=0` 遇 Warden）。
- ③ 操作与 tick：逐组合跑到稳定态（各 `N` tick）。
- ④ 期望状态：门前等待区无持续伤害且敌人不可进入；Energy 不足可等 300 ticks 恢复；非法请求零扣费且可重试；门/桥安全转换不夹人；桥 `UNSTABLE` 在 `WARN_TICKS` 内结束、`UNAVAILABLE` 可任意次数手动恢复、无次数硬上限；HP 到 0 正常死亡→重开；对象销毁后无悬空 Effect；跨 epoch 无残留；Boss 战 `E=0` 仍能造成伤害；无「无 LLM 就卡住」；无恢复服务 / 无限 fallback；两岸本地开关不受下游供电约束；OFF/Jammed 后仍能操作开关。
- ⑤ 资源与失败码：每个反例必有明确码，禁止静默。
- ⑥ 观察证据：`LOG(code,E,state,t,epoch,instanceId)` 全序列 + `REPLAY(json)`。
- ⑦ pass/fail：pass = 全部反例不成立且每步有码；fail = 任一软锁 / 静默 / 无限等待 / 第 4 次卡住。

**G2T-M-06 Boss 战可零 Signal 获胜（仅 Boss 战，不是整个切片零 Signal）**
- ② 初态：R3 共识核心，玩家常规武器可用，`Energy.current=0`、三能力全部不可用；Boss 护盾 ON（`mult=0.5`）。
- ③ 操作与 tick：真实输入链逐 tick 射击至 `boss._hp<=0`；记录每次 `dmgToBoss = max(2, damageAfterArmor * 0.5)`。
- ④ 期望状态：伤害 >= 2 > 0；Warden HP 单调递减至 0；HP 不恢复、无零伤害免疫、无护盾时间上限；结尾出口解锁。
- ⑤ 资源与失败码：`0` Signal 扣费 / `OK`。
- ⑥ 观察证据：`LOG(boss.hp,dmg,mult,t)` + `SHOT(boss-phase)`。
- ⑦ pass/fail：pass = 零 Signal **Boss 战**可赢 ∧ 伤害 >0；fail = 伤害为 0 / 无限护盾 / 把结论外推为「整个切片零 Signal 可通关」（门九步需 Jam，见 `G2T-E-01`）。

**G2T-M-07 有限减伤与可测量收益 / 出口区分**（RER §8.2、VSCC §6）
- ② 初态：Boss `maxHp=2400`、`armor=12`，`hit()` 用 `Math.max(2, damage*reduction)`（`src/entities/Boss.ts:153-170`）；护盾节点 `linkId` 未 Scan 时 Hidden；护盾乘在护甲后伤害上。
- ③ 操作与 tick：A 组（`mult=0.5`）与 B 组（压制护盾节点 `mult=1.0`）各执行配对固定输入 `PAIRED_HIT_COUNT=20` 次有效命中、护甲后护盾前单次伤害 20、关闭暴击与阶段切换用于单位级对照。另跑 Scan 确认来源、同 tick 双方死亡分支。
- ④ 期望状态：配对实验 A 组总伤害 `20×20×0.5=200`，B 组 `20×20×1.0=400`，`Δ=200>0` 且同输入可复现（主指标）；**不强制全局 TTK 比值门槛**，TTK 不冒充真实游玩收益。护盾是减伤有限 `0.5>0`、非持续期有限、无护盾时间上限；沿用 `MIN_BOSS_DAMAGE=2`；护盾来源仅 Scan 后可见、未触发阶段 Hidden；出口：`boss._hp<=0 && player.alive` → `won=true` 解锁 `EXTRACT COMPLETE`；`player.hp<=0` → `won=false` 锁定 `SIGNAL LOST`；**同 tick 双方死亡失败优先**、结算只提交一次、不重复奖励；未击败 Boss 无法借模板出口撤离。
- ⑤ 资源与失败码：B 组按能力表扣费；非法削弱 / 普通交互关 Boss 节点 `0` + `E_NOT_APPLICABLE` / `E_ILLEGAL_TARGET`。
- ⑥ 观察证据：`LOG(shieldMultiplier,linkId,dmg,boss.hp,mult,t)` 两组 + `REPLAY(json)` + `SNAP`。
- ⑦ pass/fail：pass = 200 vs 400 可复现 ∧ 护盾来源仅 Scan 后可见 ∧ 出口区分与同时死亡失败优先；fail = 只有视觉差异 / Δ=0 / 新增护盾时间上限 / 同时死亡双结尾 / 强制 TTK 1.2 门槛。

---

## 6. 真实浏览器 E2E（`G2T-E-*`；D9 `仅原则认可`，本轮给出可执行断言，未运行）

**E2E 红线（写进每条判据）**
1. 入口 = VSCC §1 固定模板入口（不调用 `MapGenerator.generate/assignRoles`，复用 `World`），真实人类输入链驱动全流程；`fixedSeed` 固定。
2. **不得**用 `player.reset` 传送、改 HP、`boss._hp`、`world.won`、`spawnBoss()+killBoss()` 直杀、`scene.start('GameOverScene')` 伪造结算来**替代**通关。
3. deterministic fixture 只用于设置；实际动作（移动 / Scan / Jam / Decoy / 手动开关 / 射击 / 过桥 / 击败 Warden / 结尾选择）必须由真实输入产生。
4. 每条 E2E 需 `CONSOLE ERRORS: 0`、无 `pageerror`；截图 / 日志 / 产物落项目外。
5. 房间编号：`room2 = R1 观测实验室`、`room3 = R2 失稳走廊`、`room4 = R3 共识核心`、`结尾 = R4`（VSCC §1）。
6. 外部 Bridge / MCP / LLM 属未来接入；本轮按公开 DTO 契约给出断言，不因未实现而留空。
7. D1 边界：零 Signal 获胜仅指 Boss 战（`G2T-M-06` / `G2T-E-04`）；R1 门九步含 Jam，全切片不得标为「零 Signal 通关」。
8. 理解证据不能仅由 Scan-Jam-通过推断；须能预测 / 解释 / 迁移。

| ID | ② 输入初态 | ③ 操作序列与 tick | ④ 期望状态 | ⑤ 资源与失败码 | ⑥ 观察证据 | ⑦ pass / fail 判据 |
| --- | --- | --- | --- | --- | --- | --- |
| `G2T-E-01` | S0 进 R1，两扇外观相同门：对照门 `CLOSED` 可普通打开、谜题门 `SEALED`；无提示 | 真实键鼠走 VSCC §2 九步：①尝试两门（`SEALED` 手动 `E_LINK_UNAVAILABLE`）②主动 Scan 一次脉冲（10，揭示封锁载波/合法连接/当前接收）③玩家或 ECHO 提出假设（假设与事实分开，不自动给完整答案）④对接收器 Jam（25，压制接收、源仍存在）⑤观察 `JAMMED_OPEN` 真实通行性改变 ⑥玩家通过（门区占位为权威位置快照）⑦Jam 到期（源仍在才重新 SEAL，不重造已失联源、不回滚位置/HP/弹丸）⑧当前设备求解（有人 `SAFE_PENDING_CLOSE`、空出延迟关；无封锁按当前意图）⑨**验证理解**：记录能否预测到期/占位/断源三种不同结果并做同构迁移判断 | 第 9 步理解证据含预测 + 解释 + 迁移，不是操作日志；`SEALED` 手动开门被拒；断源允许正常开门；信号封锁不吞掉无封锁时的物理开门意图 | Scan 一次 `-10`、Jam `-25` / `OK`；`E_LINK_UNAVAILABLE`；失败零扣费 | `SHOT(door before/after)` + `DTO(Scan Revealed)` + `LOG(door.state,sealSignalPresent,occupancy,t)` + 预测/迁移记录 + `errors.json` | pass：规则链真实动作与恢复成立 ∧ 零 console error；理解三项由 G2T-P-* 独立评估；fail：fixture 直接开门 / 只动画 / 缺预测或迁移 / 夹死玩家 / 有效封锁被普通开门绕过 |
| `G2T-E-02` | R2 走廊 A：桥 `UNAVAILABLE`、敌人存活、走廊 relay `INACTIVE`（初始 OFF、两岸本地开关可用） | 真实输入 A1–A7（清本地威胁 → 接近两岸控制器手动 ON → `TRANSITIONING` 预警结束 → `STABLE` 承重 → 过桥 → 到岸触发下一房间） | 全程不消耗 Energy；`emitOn=true` 同一提交将输出送桥和共享感知连接（不能「先过桥后激活敌人」）；已清除敌人不复活；relay OFF 时本地视觉仍工作；桥 `TRANSITIONING/STABLE/UNSTABLE/UNAVAILABLE` 全链；桥失稳走承重预警而非立即扣血 | 手动 `0` / `OK`；误关 `0` / `OK` | `LOG(bridge.state,enemy.sharedConnected,E,roomId,t)` + `SHOT(room3)` | pass：A 线全程 `E=100` ∧ 双影响同 tick 可见；fail：需 Energy / 半提交 / 自锁 / 用「清怪才产生传送门」门槛 |
| `G2T-E-03` | 同 R2 模板与 seed，但不先清怪（与 A 可中途切换） | 真实输入 B1–B7（从遮挡侧投 Decoy → 必要时 Jam 关键 Enemy Link → 开启 relay → 仍有活敌时过桥） | 与 A 线**机制上不同**；诱饵实际胜出才调查、可见玩家始终优先、Jammed 只按旧位置调查、已有弹丸继续飞行；桥同样建立；**下一房间由桥可通行与玩家到岸触发，不复用「必须清怪才产生传送门」门槛；未击杀敌人留原房间，回返仍按合法信息行动** | Decoy `-20` / Jam `-25` / 手动 `0`；`E_RETRYABLE` 整批回滚 | `REPLAY(json)` 两组动作序列差异 + `LOG(codes,portalGate,enemiesAlive,t)` | pass：两解序列显著不同且都能到 R3 ∧ 走廊 B 不被清怪 portal 门槛封死 ∧ 失败可恢复；fail：两解实质相同 / 用清怪传送门封死诱导路线 / 一解必失败 |
| `G2T-E-04` | R3，Boss 三阶段阈值 `0.66/0.33`；玩家不使用任何 Signal 能力 | 真实移动 / 射击 / 冲刺逐 tick 打到 `boss._hp<=0` | Boss 战零 Signal 可赢；伤害 >=2；`won=true` → `EXTRACT COMPLETE`；护盾 ON 仍至少 2 伤害 | `0` Signal 扣费 / `OK` | `SHOT(phase1/2/3)` + `LOG(boss.hp,dmg,mult,t)` | pass：零能力击败 Boss ∧ 结尾解锁；fail：直杀 / 改 HP / 绕 Boss 撤离；**不得**把结论写成「整个切片零 Signal 可通关」 |
| `G2T-E-05` | 同 `G2T-E-04`，允许合法压制护盾节点 | 真实能力输入 → Scan 确认来源 → Jam 该 Relay → `mult=1.0` → 逐 tick 与 `G2T-E-04` 比对 | 配对固定输入伤害差可复现；护盾来源仅 Scan 后可见；一次完整 Signal 辅助胜利需记录护盾状态与实际伤害；仍需击败 Warden；不强制 TTK 比值 | 按能力表扣费；非法 `0` + 明确码 | `LOG(shieldMultiplier,linkId,dmg,t)` 两组 + `REPLAY(json)` | pass：Δ 可量化且真实、护盾状态/实际伤害有记录；fail：仅视觉 / Δ=0 / 新增护盾时间上限 / 强制 TTK 1.2 |
| `G2T-E-06` | Warden 已真实击败、玩家存活、胜利会话凭据独立（不来自已删除的 `run`） | 真实点击两个合法不透明选项之一 → 重开（新 run）→ 观察下一局差异 → 下一局再次选择替换世界结果；另跑写失败重试与同局不同选项冲突 | 只验证 RER §11.4 接口合同：本局幂等不可撤销、写失败 `E_SAVE_FAILED` 保留界面并可重试、成功才显示已保存并退出；下一局可再次选择并在成功提交时**替换这一个持久世界结果**；不定义选项字段/叙事；不凭空用任意历史 `runId` 授权 | 结尾 `0`；同局不同选项 `E_CHOICE_CONFLICT`；写失败 `E_SAVE_FAILED` | `SAVE(json)` 前后 + `LOG(run.id,revision,committed)` + `SHOT(ending)` + 下一局 `SHOT` | pass：写入成功 ∧ 幂等 ∧ 失败可重试不伪报 ∧ 下一局可再选并替换 ∧ 旧档未被覆盖 ∧ 不自动升 `SAVE_VERSION`；fail：选项字段写死 / 覆盖旧 `run` / 撤销本局选择 / 自动 Save3 |
| `G2T-E-07` | 完全不启动 Bridge / MCP / Harness；脚本 ECHO 在线 | 真实人类输入 R0→R1（含 Jam 门谜题）→R2→R3 击败 Warden → R4 选择 → 重开 | 无外部 LLM 完整通关；ECHO 只读已发生事件、受本地接收器范围约束、不读 Hidden、至少一次合理目标分歧由真实事件绑定且不阻止玩家合法选择；模型不可用时保留本地观察与人类全部必要操作 | Energy 按表 / `OK` | `LOG(echo.lines,mode,t)` + `SHOT(full-run)` + `CONSOLE ERRORS: 0` | pass：零外部模型完整通关 ∧ 模型不可用时人类仍可完成 ∧ 不标为「零 Signal 通关」；fail：依赖 LLM、断线卡住或写成零 Signal 通关 |
| `G2T-E-08` | 未来 Bridge 已连接（Mode C），进行中动作 `active`；公开 DTO 契约就绪 | `t0` WebSocket 断连 / ping 超时 / stdio 关闭 → `FAULT → OFFLINE` + Mode A；`t1` 人类继续真实输入 | 清除注入意图、在途动作 `cancelled`；**不回滚世界状态**（弹丸 / 敌人 / 掉落 / RNG 已发生副作用保持）；不弹错误、不冻结、不重启场景；人类立即可玩；`YIELDED` 只表示人类 takeover、不改变模式 | 降级期新 Agent 请求 `0` + 明确码；Energy 不因断线变化 | `LOG(state.migration,mode,t)` + `SNAP(world)` + `CONSOLE ERRORS: 0` | pass：安全降级 ∧ 世界状态不回滚 ∧ 人类可继续；fail：冻结 / 重启场景 / 回滚。**本轮只给断言，不声称执行通过** |

---

## 7. 无提示试玩（`G2T-P-*`；D9 `仅原则认可`，本轮给出可执行观察表，未实测）

- 目的：验证规则可被自行发现，而非照提示操作。记录值由试玩填写，本轮不虚构实测数据。无提示试玩可以先实验再解释，不强制每人先 Scan。
- 提示等级（`建议冻结`）：`L0` 无任何提示；`L1` 中性环境复述（不含规则词）；`L2` 非引导确认式提问；`L3` 明确规则教学（仅作污染对照，不计入「自发理解」）。主持人任何含规则词（`Jam` / `中继器` / `信号` / `Scan` / `link`）的话语记为污染事件。
- 规模：`5–8` 人、单会话 `20–30` 分钟、每等级至少 1 会话，均为 `Prototype Testing Suggestion — 原型测试建议`。

| ID | 观察项 | 允许提示等级 | 记录字段（由试玩填写） | 预测要求 | 解释要求 | 迁移要求 | 是否只蒙对判定 | pass / fail 判据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `G2T-P-01` | Scan 自发 | L0 | 首次 Scan 的 tick、触发前所见、是否主持人提示 | 能预测扫描将显示哪类差异 | 能说出「因为 X 所以扫这里」 | 换一扇门后仍复用该判断 | 只按对键却说不出因果 → 只蒙对 | pass：L0 下自发 ∧ 有预测/解释/迁移；fail：L3 后才 Scan 或只蒙对 |
| `G2T-P-02` | Jam 对象 | L0–L1 | 目标选择、之前 Scan 读数、尝试过的错误目标 | 预测 Jam 后门状态 | 解释目标选择可追溯到 Scan 读数 | 断源条件下预测不同结果 | 随机命中正确目标但无依据 → 只蒙对 | pass：选择可追溯、能预测到期/占位/断源三种结果；fail：无依据命中 |
| `G2T-P-03` | relay 双影响 | L0–L2 | 是否体现「恢复桥同时改变共享感知」、发现时刻 tick | 能预测「再 ON 一次会怎样」并被验证 | 说明两类变化来自同一提交 | 换一走廊仍能预测 | 只过桥未察觉第二影响 → 不算理解 | pass：双影响被自发识别或经非引导提问识别；fail：需 L3 明说 |
| `G2T-P-04` | 不同解 | L0–L2 | 两解动作序列、发现顺序、是否复用同一串输入 | 预测路线 B 不需要清怪 | 能说明两解机制差异 | 同构房间复用判断 | 换皮重放不算不同解 | pass：机制不同的第二解；fail：仅同一解换皮 |
| `G2T-P-05` | ECHO 信息差 | L0–L2 | ECHO 行、玩家反应、是否改变决策 | 预测 ECHO 能/不能报什么 | 能指出「ECHO 知道我不知道的 X」 | 换事件后仍判断正确 | 只是照读提示不算 | pass：信息差影响决策、不把 ECHO 当全知提示器；fail：假设自动升格为事实 |
| `G2T-P-06` | 提问污染审计 | L0–L3 | 主持人每句话、是否含禁用词、污染发生 tick | — | — | — | 污染后成功不计入自发理解 | pass：L0–L2 段无污染；fail：出现污染却计入通过 |
| `G2T-P-07` | 理解证据 = 预测 / 解释 / 迁移（RER §13 Q6） | L0–L2 | 假设文本、对到期/占位/断源三种结果的预测、支持证据、证伪证据、修正后假设、同构迁移判断 | 必须给出至少三条可证伪预测 | 必须用真实状态变化解释，不以操作日志代替 | 必须有一个同构迁移判断 | 仅有 Scan-Jam-通过序列而无预测/解释/迁移 → 只蒙对 | pass：三项齐备 ∧ 操作日志不等于理解；fail：只靠通过序列推断「已理解」 |
| `G2T-P-08` | 错误假设与只蒙对区分 | L0–L2 | 成功但假设错误 / 成功且假设正确 / 失败但假设正确 | — | 逐条标注 | — | 成功但无法给出可证伪因果假设，或假设与观察矛盾 → 只蒙对 | pass：两类可区分；fail：把蒙对算理解 |
| `G2T-P-09` | 未直接告知规律的发现与迁移 | L0–L2 | 规律表述、发现依据、复现一次、同构迁移结果 | 能预测新场景结果 | 能解释因果 | 迁移后仍成立 | 复现失败 → 不算发现 | pass：可复现 ∧ 迁移成立；fail：一次性巧合或过度泛化 |
| `G2T-P-10` | ECHO 不越界 | L0–L2 | 是否提及未触发 Boss 阶段 / 全依赖图 / Hidden 字段 / 是否随机拒绝操作 | — | — | — | — | pass：无越界、不代玩家提交结尾选择；fail：剧透未触发阶段或越权 |

> 总判据：pass = L0–L2 段至少 1 条现实规则被自发理解（含预测 / 解释 / 迁移证据） ∧ 至少 1 个障碍出现机制不同的两解 ∧ 污染未计入通过 ∧ ECHO 信息差成立且不越界；fail = 全部成功依赖 L3 / 全部只蒙对 / 无第二解。

---

## 8. 存档恢复（`G2T-S-*`；按 RER §11 单一推荐值设计，不实现）

> **安全房检查点 ≠ 战斗内快照**：`captureCheckpoint` 只在 cleared / alive / 无 Boss / 无活敌 / 无未清威胁且门桥不在危险转换时写入（`src/world/World.ts:674-688`）。本规格不定义战斗内快照；活跃临时效果可能在安全房存在，若捕获必须与全部余时同一快照。当前 `RunCheckpoint` 无 Signal / 临时 / 冷却 / 恢复余数字段（`src/types/index.ts:96-107`），**不得自称已支持**；RER §11 是未来建议接口。

| ID | ② 输入初态 | ③ 操作序列与 tick | ④ 期望状态 | ⑤ 资源与失败码 | ⑥ 观察证据 | ⑦ pass / fail 判据 |
| --- | --- | --- | --- | --- | --- | --- |
| `G2T-S-01` | 切片独立键 `last_signal_station_zero_save_v2` 安全点已写；该快照含活跃 Jam/Scan 揭示/冷却/regen 余数同一原子快照 | `t0` 写档 → reload → 恢复 → `t1` 读 | 先校验命名空间/模板，再装模板、应用持续状态与合法安全位置；`rng.restore(run.rngState)`；从 `savedTick` 继续，`deadline = savedTick + remainingTicks`；重建效果与冷却/恢复余数；当前链路与占位重算；`sceneEpoch+=1` 重绑并拒绝旧回调；0 余时效果不恢复；离线时间不推进 | `0` / `OK` | `SAVE(json)` 写/读 + `LOG(savedTick,remainingTicks,cooldown,regen,epoch,instanceId,effects)` | pass：余时/冷却/恢复余数逐项按快照重建且不复位为任意值、旧 epoch 输入被拒；fail：效果消失 / 冷却清零 / 用墙钟截止时间 / 离线补时 |
| `G2T-S-02` | `rngState=RNG.snapshot()` 真实值、切片档已写；主模式 `last_signal_save_v1` 另有有效 `run` | `t0` 写档 → reload → 恢复 → 连续 `N` 次 `rng.float()/int()` | 恢复后随机序列与「同一状态继续」逐值相等；切片入口只写切片适配器，禁止借主模式首写 `expectedId=undefined` 覆盖原 `run`；主/economy 键不变 | `0` / `OK`；非 uint32 → `validateCheckpoint` 拒 | `LOG(rngState,draws)` + `SAVE(json)` 双键快照 + `REPLAY(json)` | pass：序列一致 ∧ 主 run 未被覆盖 ∧ 原/economy 键未变；fail：`rngState` 归零、主 run 被覆盖或键被改写 |
| `G2T-S-03` | 切片档 `stats.elapsedSeconds=T0` | 写档 → 关闭页面等待墙钟 `W` 秒 → reload → 恢复 → 读 | 离线墙钟不产生奖励：`Energy`/冷却/临时 TTL/`currency`/`cores` 不按墙钟变化；`elapsedSeconds` 从 `T0` 继续、`tickIndex` 不补帧；暂停入口清帧累加器、恢复不补时 | `0` / `OK` | `SAVE(json)` + `LOG(E,cooldown,effects,currency,elapsedSeconds,wallclock)` | pass：五个量与离线墙钟无关；fail：任一按墙钟增长/缩短或补离线 tick |
| `G2T-S-04` | 注入 `version=1` 无 `cores` 的合法旧主档 + 无扩展的 v2 基础档 | `t0` `load()` → `validate` 失败 → `_upgrade()` → `t1` 写 checkpoint → `t2` 读 | 主档 `version=2`、已知字段保留、未知字段丢弃、有效旧 `run` 不销毁；**没有 reality 扩展的旧 v2 档不自动变成切片档** | `0` / `OK` | `SAVE(json)` 前后 + `LOG(version,permanent,run.id,sliceSchema)` | pass：迁移不丢有效 `run`、基础档不被冒充切片档；fail：旧 `run` 被清或基础档自动升级为切片档 |
| `G2T-S-05` | 注入含未知/坏扩展、高 `sliceSchema`、不同 `templateId/templateRevision` 的切片档 | `t0` 读 → `validate` / 校验扩展 → `t1` 回写 | 坏扩展/高 schema/不同模板 → **保留原始档、拒绝覆写并显示原因**；只有用户选新开局才替换本切片 run；不能交给旧 `_upgrade` 直接丢弃；未知顶层字段不被 `validate` 拒绝是风险不是缓解 | `0` / 明确拒绝码 | `SAVE(json)` 前后 + `LOG(validate.result,sliceSchema,templateId,reason)` | pass：原档保留 ∧ 不覆写 ∧ 显示原因；fail：静默丢弃扩展或覆盖原始档 |
| `G2T-S-06` | 切片档已有选择结果；主模式 `run.id=A` | `t0` 同局重复提交选择；`t1` 同局不同选项；`t2` 写失败重试；`t3` 用任意历史 `runId` 授权 | 幂等返回原成功回执、不重复奖励；同局不同选项 `E_CHOICE_CONFLICT`；写失败 `E_SAVE_FAILED` 保留选择界面并可重试、不伪报已存；**不能凭空用已删除的历史 `runId` 授权** | 结尾 `0` / `OK`、`E_CHOICE_CONFLICT`、`E_SAVE_FAILED`、`E_PERMISSION` | `SAVE(json)` + `LOG(run.id,option,revision,committed)` | pass：四项合同逐条成立；fail：重复奖励 / 伪报保存 / 历史 runId 授权成功 |
| `G2T-S-07` | 旧客户端只识别主模式键；切片档含 reality 扩展 | `t0` 切片写 → `t1` 旧客户端读主模式 → `t2` 旧客户端写主模式 → `t3` 切片客户端再读 | 旧客户端不读取独立键因此不会删除其扩展；显式记录主模式 `_upgrade()` 丢未知字段、`_load()` 删非法 `run`、全量覆写抹掉新字段、配额失败风险；降级回安全默认态、不崩、**不自动升 `SAVE_VERSION=3`**；禁止自动 Save3 ≠ 绝对永不升版（后续单独授权可给理由/迁移/回滚设计） | `0` / 明确降级码 | `SAVE(json)` 多时刻 diff + `LOG(lost.fields,fallback.state,version)` | pass：风险逐项记录 ∧ 扩展未被旧客户端删 ∧ 不崩 ∧ 不升版；fail：声称即插即用安全兼容 / 自动 Save3 |
| `G2T-S-08` | 无合法安全位置的模板档；另有损坏档 / 配额失败注入 | `t0` 恢复 → `t1` 写盘失败 | 模板无合法安全位置则**拒绝恢复且保留档**，不能用随机传送掩盖不兼容；写失败保留档与界面、显示原因、可重试；切片奖励与选择不回写主模式 | `0` / `E_NO_FAR_SHORE`（装载期）、`E_SAVE_FAILED` | `SAVE(json)` + `LOG(reject.reason,player.pos,write.result)` | pass：拒绝恢复且保留档、不随机传送、写失败不伪报；fail：随机传送掩盖不兼容 / 覆写原始档 / 奖励回写主模式 |

> 存档总约束：区分「已支持（源码现状：v2 `validate`/roundtrip、可选 `run` 检查点、`rngState`、安全房检查点、`expectedId` 防覆盖）」与「建议扩展（未批准：独立切片命名空间 `last_signal_station_zero_save_v2`、reality 可选扩展、`sliceSchema`/`templateId`/`templateRevision` 判别、D7 持久结果）」。本轮不自动升 `SAVE_VERSION`；单纯可选字段或双写不足以保证兼容，实现前须验证基础档/缺省/损坏/高 schema/旧客户端隔离/回滚/配额失败。本规格不改 `SaveData`/`RunCheckpoint`/`validate`；不定义战斗内快照。

---

## 9. 被新合同替代的旧用例说明

本节每行左列均为已删除断言，只供回归对照；编码与验收仅采用右列及当前主规则。

| 旧断言（已删除） | 新合同 |
| --- | --- |
| Scan 对每个目标各扣 10 / 旧的 16 格排布 | Scan 玩家中心一次脉冲扣一次 10，揭示全部合法目标；RER §5 为 4 目标 × 3 能力 12 格 + 矩阵外手动交互（走廊 relay / 普通门 / SEALED 门 / Boss 节点）。见 §3.1、`G2T-U-49` |
| 门「信号封锁不吞掉物理开门意图 / 手动开关可免费开门」 | `SEALED` 有有效封锁时手动开门 `E_LINK_UNAVAILABLE`、零费、不能绕谜题；无封锁或断源后手动开关有效。见 `G2T-U-05/40`、`G2T-M-01` |
| 桥 `WARNING/PLACEHOLDER`、`RECOVERY_MAX=3`、`E_SAFE_RECOVERY` | 桥 `UNAVAILABLE/TRANSITIONING/STABLE/UNSTABLE/DISABLED`，无 `PLACEHOLDER`/`RECOVERY_MAX`；送岸是独立事件反馈，不是失败码。见 `G2T-M-02`、`G2T-U-39` |
| relay `EMITTING/RELAYING` 管道态、「SUPPRESSED 保持下游上一值」 | relay `ACTIVE/INACTIVE/JAMMED/DISABLED`；OFF 同一提交重算下游、不保持上一输出。见 `G2T-M-03` |
| `DECOYED` 作第四连接态 / Jam 屏蔽 `lastKnownPosition` | `DECOYED` 是可观察标记不是连接态；Jam 屏蔽**新**信息，仍调查未过期旧位置证据；共享断线不关本地视觉。见 `G2T-M-04` |
| `every P5 instanceId+1` / `generationId` 乐观并发 | `instanceId` 仅实例重建变化；正常状态只增 `revision`；epoch 仅装载/恢复/重开变化。见 `G2T-C-07/08` |
| `E_DUPLICATE_ACTION` / 重放返回零 `energyDelta` 新失败 | 合法重复返回原回执 + `replayed=true`、`resourceWritesThisCall=0`；生效中重施 `E_RETRYABLE` 零费；`E_ID_PAYLOAD_MISMATCH`。见 `G2T-C-03/04` |
| `E_EXPIRED`、`E_SAFE_RECOVERY`、`E_RETRYABLE_STATE` 旧失败码 | 错误码完全取 RER §9；多 Jam 取未过期集合并集、不叠加强度；到期按当前源/意图/占位重算。见 §1.3、`G2T-U-17` |
| 检查点恢复把余时/冷却/regen 复位为 0、临时态一律不存档 | 安全点保存 `remainingTicks`/冷却/regen 同一快照，从 `savedTick` 继续；0 余时不恢复；独立键隔离，主模式键不变。见 `G2T-S-01..03` |
| 复写/撤销结尾选择、写入后不可变更世界结果 | 本局幂等不可撤销、写失败可重试；下一局可再次选择并替换这一个世界结果。见 `G2T-E-06`、`G2T-S-06` |
| TTK 1.2 为必要收益指标 | 配对固定输入 20 次、护甲后单次 20 → 200 vs 400；不强制 TTK 比值。见 `G2T-M-07` |
| 理解证据 = Scan-Jam-通过写 `confirmedEvidence` | 预测 / 解释 / 迁移（到期、占位、断源三种结果 + 同构迁移判断），操作日志不等于理解。见 `G2T-E-01` 第 9 步、`G2T-P-07/09` |
| 走廊 B 需清怪 portal 门槛 | 桥可通行与玩家到岸触发下一房间，未击杀敌人留原房间。见 `G2T-E-03` |

---

## 10. 待用户签核与 GDD-03 边界

| # | 事项 | 归属 |
| --- | --- | --- |
| 1 | RER §6 全部 `Prototype Tuning Values — 原型调参初值` 的最终冻结（`TICK_HZ`、三能力数值、桥/门 tick、护盾倍率、配对次数） | 用户签核 |
| 2 | RER §5 / §4.2 手动交互「走廊两岸免费开关 / 自供电 / Boss 节点手动限制」细节提案的明确批准（当前 `建议冻结`，标提案，本轮不阻塞测试规格） | 用户签核 |
| 3 | RER §11 独立切片存储、reality 可选扩展 / schema 判别 / 迁移 / 双写 / 回滚策略，以及后续是否需要升 `SAVE_VERSION` | 用户签核 + ADR |
| 4 | D7 两个选项的内容、字段、叙事；VSCC §1 固定模板的房间尺寸与几何 | **GDD-03** |
| 5 | D9 三类验收的具体测试名、seed、截图 / 日志落点、CI 归属 | 用户签核 |

> 已由用户明确决策、不再列为待确认：D1「零 Signal 仅 Boss 战可胜（门谜题需 Jam）」；C09 的 relay 免费/自供电/两岸可达只作 `建议冻结` 提案。

---

## 11. 交叉链接

- 权威主规则：[`REALITY_ENGINEERING_RULES.md`](REALITY_ENGINEERING_RULES.md)（§4 四目标状态机 / §5 操作矩阵 / §6 Energy 与软锁 / §7 P0–P7 / §8 几何与 Boss / §9 失败与幂等 / §10 四类信息 / §11 存档与二选一 / §13 质量问题 Q1–Q10）。
- 因果链：[`VERTICAL_SLICE_CAUSAL_CHAINS.md`](VERTICAL_SLICE_CAUSAL_CHAINS.md)（§1 固定模板 / §2 门九步 / §3 路线 A / §4 路线 B / §5 ECHO / §6 Warden 与结尾 / §7 验收边界）。
- 上位设计：[`GAME_DESIGN_BIBLE.md`](GAME_DESIGN_BIBLE.md)、[`GAME_DESIGN_BIBLE_ALIGNMENT.md`](GAME_DESIGN_BIBLE_ALIGNMENT.md)、[`DESIGN_DECISION_REGISTER.md`](DESIGN_DECISION_REGISTER.md)、[`README.md`](README.md)。
- 技术参考：[`SIGNAL_SYSTEM_DESIGN.md`](SIGNAL_SYSTEM_DESIGN.md)、[`AGENT_BRIDGE_ARCHITECTURE.md`](AGENT_BRIDGE_ARCHITECTURE.md)、[`HUMAN_AGENT_COOP_DESIGN.md`](HUMAN_AGENT_COOP_DESIGN.md)、[`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md)、[`PROJECT_ROADMAP.md`](PROJECT_ROADMAP.md)、[`IMPLEMENTATION_TASKS.md`](IMPLEMENTATION_TASKS.md)、[`STYLE_GUIDE.md`](STYLE_GUIDE.md)、[`ECONOMY_MODE.md`](ECONOMY_MODE.md)。
- 规格内部：§1.2 任务覆盖 → §3 覆盖矩阵 → §4/§5 单元与机制；§1.3 关键合同交叉表 → §2/§4/§5/§8 对应断言；§6 E2E 红线 → 全部 `G2T-E-*`；§7 观察表 → §7 总判据；§8 存档 → §10 第 3 项。

---

## 12. 边界声明

- 本文件为 `建议冻结` 的测试规格提案；除 D1/D2 `明确批准`、D4 `仅原则批准`、D3/D5/D6/D7/D8/D9 `仅原则认可` 外，全部细则与 fixture 初值未批准、未实现；未自称已通过或已验证任何新功能。
- 未修改任何源码 / 测试 / 配置 / 依赖 / 存档结构；未运行玩法验收、构建或测试；未自行 commit。
- 未定义战斗内快照、未把安全点保存设计等同临时态序列化；未来 Bridge / MCP / LLM 接入按公开 DTO 契约给出断言，不因未实现而留空。
- 剧情选择字段、模板具体尺寸与几何交 GDD-03；不扩 scope、不新增资源 / 恢复服务 / 无限 fallback；纯规则层只接收普通数据快照，不 import Phaser/World/MCP。
