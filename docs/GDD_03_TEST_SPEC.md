# GDD-03 测试规格（关卡与交互验收）

> 文档性质：仅测试规格，不含测试源码、不含实现、不含执行结果。GDD-03 是在 GDD-02 规则之上的**关卡与交互设计**验收；本文件只给可执行判据，引用而不改写主规则。
> 权威来源：规则 [RER](REALITY_ENGINEERING_RULES.md) / [VSCC](VERTICAL_SLICE_CAUSAL_CHAINS.md)；稳定叙事/UI 合同 [EXPERIENCE_FLOW](VERTICAL_SLICE_EXPERIENCE_FLOW.md) / [ECHO_SCRIPT](ECHO_VERTICAL_SLICE_SCRIPT.md) / [UI_SPEC](VERTICAL_SLICE_UI_SPEC.md)；关卡坐标 [LEVEL §1–§7](VERTICAL_SLICE_LEVEL_DESIGN.md)；上游测试 [GDD_02_TEST_SPEC.md](GDD_02_TEST_SPEC.md)（101 ID 沿用不复制）。
> 批准分级与提案标注：D1/D2 `明确批准`；D4 `仅原则批准`；D3/D5/D6/D7/D8/D9 `仅原则认可`。本文件全部新增布局/台词/选择/数值/时长均为 `GDD03 推荐提案 · 候选`，数值标 `Prototype Tuning Values — 原型调参初值`，**不自动等同用户批准**；提案不升批准、设计不冒实测。
> 本轮未执行：未运行玩法验收、构建或测试；所有 pass/fail 均为判据，不是结果。

---

## 1. 依据与约定

### 1.1 来源与层级

- **规则层**：RER §4 四目标状态机、§5 操作矩阵、§6 Energy 与软锁、§7 P0–P7、§8 几何与 Boss、§9 失败与幂等、§10 四类信息、§11 存档与二选一；VSCC §1 固定模板、§2 门九步、§3/§4 双走廊、§5 ECHO、§6 Warden 与结尾、§7 验收边界。
- **叙事/UI 合同**：`EXPERIENCE_FLOW`（体验顺序、计时口径、H0–H4、跳过/失败/重试、R1_SOURCE_TEST、R4 选择与保存）、`ECHO_SCRIPT`（事件表、台词、权限、`NONE|POWER|MEMORY`、优先级与去抖）、`UI_SPEC`（信息结构、Z/X/C 预览、事实/推测/验证/未知、错误文案、Boss 护盾、选择 UI 状态机与读回）。
- **关卡坐标**：以官方 [LEVEL](VERTICAL_SLICE_LEVEL_DESIGN.md) 终版为准——§1 单位/LOS/坐标约定、§2 全局偏移与有向邻接、§3 R0、§4 R1、§5 R2、§6 R3、§7 R4、§8 安全岸点 vs checkpoint。
- **共享设计合同**（项目外 `shared_design_contract.md`）：四目标/三基础能力、无高级协议/自由地形、固定模板复用 World、切片存档隔离。

### 1.2 源码事实（只读校准，路径:行）

| 事实 | 证据 | 性质 |
| --- | --- | --- |
| **玩家移动非均匀**：`Player.update` 用屏幕输入 `tx = sx/(TILE_W/2)=sx/32`、`ty = sy/(TILE_H/2)=sy/16`，再 `vx=(tx+ty)/2*speed`、`vy=(ty-tx)/2*speed`；世界位移随输入方向变化 | `src/entities/Player.ts:165-179`、`src/core/iso.ts:8-9`（`TILE_W=64/TILE_H=32`） | 现状事实（`3.4375 格/秒` 仅保守时间下界，非恒速） |
| 冲刺为 `speed*2.6` 持续 `dashDuration 0.16s`，位移随方向变化，非恒定 1.29 格 | `src/entities/Player.ts:171`、`src/config/game.ts`（`dashDuration 0.16`） | 现状事实 |
| `Player.reset()` 把 `hp` 置满 | `src/entities/Player.ts:114-119` | 现状事实（过房/进房不得调用 `reset` 满血） |
| `World.placePortal` 在房间挑最近可走格生成传送门，`onEnterRoom`/`restoreCheckpoint` 会调用 | `src/world/World.ts:197,200,709` | 现状事实（禁止借自动 portal 绕谜题/清怪门槛） |
| 死亡 → `onDeath` → `finishRun(runId,false,…)` 删本局 run → 失败界面；再开新局从 R0 | `src/world/World.ts:665-667`、`src/scenes/GameScene.ts:428-434`、`src/systems/SaveSystem.ts:182` | 现状事实（死亡清 run 新开 R0，不是续安全点） |
| 退出/刷新 → `saveCheckpoint` 写安全点；恢复走 `restoreCheckpoint` | `src/scenes/GameScene.ts:366-371`、`src/world/World.ts:690` | 现状事实（退出/刷新才恢复最近安全 checkpoint） |
| `captureCheckpoint` 要求 cleared/alive/`!won`/`!boss`/无活敌/无未清 spawned 房间 | `src/world/World.ts:674-688` | 现状事实（R2 留活 guard 时无法捕获 R2 安全点） |
| Boss `hit` 用 `max(2, damage*reduction)`；三阶段 `ratio>0.66/0.33`；`summonDrones` 用 `Math.random` | `src/entities/Boss.ts:155,160,142` | 现状事实（护盾 0.5/1.0 与配对 200 vs 400 为 GDD-02 提案，见上游 `G2T-M-07`） |
| `SAVE_KEY='last_signal_save_v1'`；`finishRun` 删 run、胜利 +1 core；无切片独立键；现状无二选一 UI | `src/config/game.ts:33`、`src/systems/SaveSystem.ts`、`src/scenes/GameOverScene.ts` | 现状事实（切片独立键与二选一为提案） |
| `tileAt(worldX)=floor(worldX)-_minX`；`isWalkable` 采样半径 0.5 四角，阻断 wall/lava/water | `src/world/World.ts:136,145` | 现状事实（几何/LOS 基准） |
| 敌人感知用 `distanceTo(player) <= aggroRange` | `src/entities/Enemy.ts:145` | 现状事实（感知 `<=`，能力半径 `<`，不互换） |

> 源码事实数值（`TILE_W 64`、`TILE_H 32`、`speed 220`、`armor 12`、`maxHp 2400`、0.66/0.33）与章节号、用例 ID 不是调参值。仅本文件新增 fixture 初值标 `Prototype Tuning Values — 原型调参初值`；不写一刀切的总调参声明。

### 1.3 测试约定与红线

- **ID**：`G3T-<族>-<两位序号>`；族 = `L`（关卡几何/连通）、`F`（17 用户流程）、`M`（机制/软锁）、`E`（真实浏览器 E2E）、`P`（试玩/时间/提示）、`S`（切片存档隔离/失败）。
- **七要素（每用例强制）**：`① ID` / `② 输入初态或 fixture` / `③ 真实操作` / `④ 可断言期望` / `⑤ 资源与失败码` / `⑥ 观察证据` / `⑦ pass/fail`。
- **上游复用**：GDD-02 已覆盖的机制/状态机/几何/可见性/存档断言（`G2T-U-*`/`G2T-M-*`/`G2T-S-*`/`G2T-E-*`/`G2T-P-*`）不复制，只引用。
- **失败码**完全取 RER §9（`OK`/`E_NOT_APPLICABLE`/`E_ILLEGAL_TARGET`/`E_LINK_UNAVAILABLE`/`E_ENERGY_INSUFFICIENT`/`E_COOLDOWN`/`E_PAUSED`/`E_PERMISSION`/`E_TARGET_DESTROYED`/`E_STALE_GENERATION`/`E_STALE_EPOCH`/`E_ID_PAYLOAD_MISMATCH`/`E_RETRYABLE`/`E_NO_FAR_SHORE`/`E_CHOICE_CONFLICT`/`E_SAVE_FAILED`）。
- **时间口径**：`3.4375 格/秒` 仅保守时间下界（用于上界估算），**不当作真实恒速**；`dash` 不当恒定 1.29 格；真实耗时以真实输入帧测量。
- **红线（真实 E2E）**：禁 `player.reset` 传送/满血、改 HP、`boss._hp`、`world.won`、`killBoss()` 直杀、伪造结算；禁借 `World.placePortal` 自动传送绕过谜题门/清怪门槛；fixture 只初始设置；`window.__game` 仅只读探针；预设选项/scripted JSON 不冒充已体验。
- **双评估**：通关与理解独立评估——完成九步/通关不能证明理解；理解证据由 `G3T-P-*` 后置、非引导评估。

---

## 2. 覆盖矩阵

### 2.1 17 用户流程 → 测试 ID（对齐 EXPERIENCE_FLOW §2）

| # | 用户流程 | 稳定合同/规则 | 测试 ID |
| --- | --- | --- | --- |
| 1 | R0 基础行动 + 第一条异常证据 | FLOW §3；RER §10；ECHO `ECHO_CONTACT`/`ECHO_R0_ANOMALY` | `G3T-F-01`、`G3T-L-01` |
| 2 | R0→R1 进入观测实验室 | FLOW §2；LEVEL §2/§3 | `G3T-F-02` |
| 3 | R1 两扇相似门（对照可开 / 谜题 SEALED 拒） | FLOW §4.1；RER §4.1；LEVEL §4 | `G3T-F-03`、`G3T-L-02` |
| 4 | R1 观察/Scan | FLOW §4.1；RER §5/§10 | `G3T-F-04`、`G3T-L-02` |
| 5 | R1 假设（允许错误）+ ECHO 事实反馈 | FLOW §4.1；ECHO `ECHO_DOOR_SCAN` | `G3T-F-05` |
| 6 | R1 Jam 谜题门接收器 | FLOW §4.1；RER §5；LEVEL §4 | `G3T-F-06` |
| 7 | R1 通过 `JAMMED_OPEN` 门到南廊 | FLOW §4.1；VSCC §2 步5–6；LEVEL §4 | `G3T-F-07` |
| 8 | R1 恢复（到期/占位/断源） | FLOW §4.1；VSCC §2 步7–8 | `G3T-F-08` |
| 9 | R1 再解释/理解（预测+解释+迁移） | FLOW §4.1/§10；RER §13 Q6 | `G3T-F-09`、`G3T-P-04` |
| 10 | R1→R2 到南廊出口 | FLOW §2；LEVEL §2/§4 | `G3T-F-10` |
| 11 | R2 路线 A（清敌建桥） | FLOW §5；VSCC §3；LEVEL §5 | `G3T-F-11`、`G3T-M-03` |
| 12 | R2 路线 B（单次 Jam 留活 guard 过桥） | FLOW §5；VSCC §4；LEVEL §5 | `G3T-F-12`、`G3T-M-03`、`G3T-L-05` |
| 13 | R2→R3 到东岸 | FLOW §2；LEVEL §5 | `G3T-F-13`、`G3T-L-06` |
| 14 | R3 常规零 Signal 击败 Warden | D1；RER §8.2；上游 `G2T-M-06` | `G3T-F-14`、`G3T-E-04` |
| 15 | R3 Signal 辅助击败 | RER §8.2；LEVEL §6；上游 `G2T-M-07` | `G3T-F-15`、`G3T-E-05` |
| 16 | R3→R4 结尾二选一 POWER/MEMORY/NONE | FLOW §7；ECHO §5；UI §8；RER §11.4 | `G3T-F-16`、`G3T-E-06`、`G3T-M-09` |
| 17 | 下一局/重开：R0 差异 + 可再次选择替换 | FLOW §7/§9；ECHO §5；RER §11.4 | `G3T-F-17`、`G3T-S-03` |

> 另覆盖：四房连通（L-01）、R1 对照门与 Jam 安全（L-02/03、M-02）、R2 A/B 留活 guard 进 R3（M-03、L-05/06）、Boss 常规/Signal（fixture 200 vs 400 与真实胜利分开，F-14/15）、两结尾与下一局（F-16/17）、无 LLM/故障/能量耗尽/桥失稳/安全 checkpoint/主 economy 隔离/保存失败/重复通关替换/旧 schema（M-04..09、S-01..05、E-06）、死亡 vs 退出刷新（M-10）、反伪造（M-11、E-07）、理解与通关独立（P-11）。

### 2.2 类型覆盖

| 维度 | L | F | M | E | P | S |
| --- | --- | --- | --- | --- | --- | --- |
| 连通/可达 | L-01..07 | F-02/10/13 | M-03 | E-01/02/03 | — | — |
| 因果链/状态 | — | F-03..09/11/12 | M-02 | E-02/03 | P-04/05 | — |
| Boss/结尾 | — | F-14/15/16/17 | M-08/09 | E-04/05/06 | P-08/09 | S-03 |
| 软锁/恢复 | — | — | M-01/03/04/05/10 | — | — | S-02 |
| 反伪造/几何 | L-08/09 | — | M-11 | E-07 | — | — |
| 时间/提示/理解 | — | — | — | — | P-01/02/03/06/07/10/11 | — |
| 存档隔离 | — | — | — | — | — | S-01/04/05 |

---

## 3. 关卡几何与四房连通（`G3T-L-*`；坐标见 §9）

| ID | ② fixture | ③ 真实操作 | ④ 可断言期望 | ⑤ 资源/失败码 | ⑥ 证据 | ⑦ pass/fail |
| --- | --- | --- | --- | --- | --- | --- |
| `G3T-L-01` | 固定模板 `MapData`（非 `MapGenerator.generate/assignRoles`）；LEVEL §3–§7 四房 R0–R4 | 静态 BFS 房间图可达 + 装载期拒绝有环/缺必经源/缺安全点 | R0→R1（谜题门）→R2（承重桥到东岸）→R3（击败 Boss）→R4 全可达；装载期 `E_NO_FAR_SHORE` 拒非法模板 | `0` / `E_NO_FAR_SHORE`（仅装载期） | `LOG(roomGraph,reachable)` | pass：四房+结尾全连通、固定模板；fail：依赖随机地图或缺口 |
| `G3T-L-02` | R1（LEVEL §4）：西入口 `x1..9,y1..12`；`x=10` 竖墙 `y1..12` 仅两门孔；`y=5` 横墙 `x11..21`；`R1_D_REF` 门孔 cell `(10,2),(10,3)`→北死路 `x11..21,y1..4`；`R1_D_SEAL` 门孔 cell `(10,9),(10,10)`→南廊 `x11..21,y6..12`；入口 `(1.5,9.5)` | 静态校验：西入口到南廊只能经 `R1_D_SEAL`；北小室只能经 `R1_D_REF`；门孔 2 格全占不可旁穿 | 对照门不进入 R2；谜题门为唯一通路；两门同外观；`y=5` 墙+`x=10` 墙+边框无绕行 | `0` / `OK` | `LOG(pathRef,pathSeal,wallMask)` | pass：对照门进死路∧谜题门唯一通路∧无绕行；fail：对照门成旁路或存在墙缝 |
| `G3T-L-03` | R1 `R1_SRC_SEAL(12.5,9.5)`（cell `(12,9)`）为**只读模板发射源**；Jam 目标是 `R1_D_SEAL` 门体接收器 cell `(10,9),(10,10)` | 静态确认：源不可 Jam、不可免费断源，仅 Scan 可读发射端点；Jam 目标=门接收器 | 对源 Jam 应 `E_NOT_APPLICABLE`；对门接收器 Jam 合法；源仍在 | `0` / `E_NOT_APPLICABLE` | `LOG(srcJamTargeted,doorReceiver,distance)` | pass：源不可 Jam∧Jam 目标为门接收器；fail：把源当接收器 Jam |
| `G3T-L-04` | R2（LEVEL §5）：26×14；西地板 `x1..9`、东地板 `x16..24`、chasm `lava x10..15,y1..12`、桥覆盖 `x10..15,y8..10`（6×3）；入口 `(2.5,10.5)`；单 guard `(5.5,6.5)`；near relay `(8.5,9.5)` 初始 OFF；far ctrl `(18.5,9.5)`；`SAFE_W(9.5,9.5)`/`SAFE_E(16.5,9.5)` | 静态校验：无其它内墙；两岸控制器可达、自供电；安全岸点无持续伤害/不被可关门覆盖/不被 guard 占位阻断；桥 `STABLE` 才可走 | 初态 near OFF+自供电；桥 UNAVAILABLE；岸点合法；无内墙 | `0` / `OK`；装载失败 `E_NO_FAR_SHORE` | `LOG(ctrl,shoreValid,innerWalls=0)` | pass：无内墙∧两岸可达+供电∧岸点合法；fail：内墙存在或岸点不可达 |
| `G3T-L-05` | R2 合法 Decoy 对照实验（**单测 fixture，非必经路线**）：guard `(5.5,6.5)`、玩家在 (a) 不可见（`d>5.3125` 或 LOS 断）或 (b) 可见（`d<=5.3125` 且 LOS 通）两种初始 | 各投一次 Decoy（合法落点，−20） | (a) 不可见 → guard 可接收诱饵、标记 `DECOYED`；(b) 可见 → **玩家优先**，诱饵不覆盖可见玩家 | `-20` / `OK` | `LOG(playerVisible,decoyReceived,marker)` | pass：可见→玩家优先∧不可见→诱饵可接收；fail：诱饵覆盖可见玩家或假称必经路线 |
| `G3T-L-06` | R2 出口→R3：LEVEL §5 的桥 `STABLE` 且玩家到 `SAFE_E(16.5,9.5)` | 静态确认过渡由「桥承重+到东岸」触发，**不经 `placePortal`**、不要求清怪；桥跨 `x10..15,y8..10`；路径 `isWalkable(0.5)` 全通 | 到 `SAFE_E` 即进 R3；活 guard 留 R2；无清怪 portal；桥 6×3 | `0` / `OK` | `LOG(transitionTrigger,liveGuard,bridgeSpan,pathWalkable)` | pass：到东岸触发∧活 guard 留原房∧无 placePortal∧路径可行；fail：自动 portal/清怪门槛/路径入墙 |
| `G3T-L-07` | R3（LEVEL §6）：26×18；入口 `(1.5,9.5)`；`R3_WARDEN(13.5,9.5)` 半径 3.0；`R3_SHIELD_RELAY(20.5,4.5)`；玩家阵地 `(20.5,7.5)`；掩体 cell `(7,4)(7,13)(18,9)` | 静态校验：阵地→relay `3.0`（Scan `<12`、Jam `<6`、LOS 通）；阵地→Boss `7.28>attackRange 3.125`；路径 `(1.5,9.5)→(1.5,2.5)→(20.5,2.5)→(20.5,7.5)` 到 Boss 最小距离 `7.0>3` | 固定阵地可 Scan/Jam 护盾源；路径避开 Boss/掩体；护盾 relay 维护封闭 | `0` / `E_NOT_APPLICABLE`（手动 OFF） | `LOG(d_vantage_relay,d_vantage_boss,pathMinD,subtype)` | pass：3 格 Scan/Jam∧路径避开 Boss∧维护封闭；fail：超距/路径穿 Boss/可手动 OFF |
| `G3T-L-08` | 体验预算：首次 20–30min（中心 24 = R0 4 / R1 5 / R2 6 / R3 7 / R4 2），熟练 9–14min（`Prototype Testing Suggestion`）；R2 过桥预算显式含 1.5s 建立预警 | 只测量、不强制；分别记录墙钟与死亡重试；R2 路线 B 记录「单次 Jam 生效起→`SAFE_E`」实测 | 预算为待验目标；不含暂停/失焦/加载/访谈/空等/整局死亡重开；不靠延长对话/加 HP/刷怪凑；设计期上界 `5.597s`（含 1.5s），**运行期验收 ≤6s**（含实际输入开销，待 E2E 实测） | `0` / `OK` | `LOG(wallclock,successPath,deaths,perRoom,b_overhead)` | pass：分段可记录∧口径明确∧1.5s 与输入开销纳入；fail：漏算或混算死亡 |
| `G3T-L-09` | R1 可选反事实 `R1_SOURCE_TEST`（FLOW §4.2，候选，需用户确认）：仅玩家已合法跨过 `R1_D_SEAL` 到南廊安全侧后可触发 | 触发后模板源 OFF 2 逻辑秒再 ON；返回门前观察 | 不能成为首次解谜旁路；不强迫等待/回头；占位遵守待关；断源只是模板事件非玩家技能；进房间快照、安全点不重复制造事件 | `0` / `OK` | `LOG(sourceTest.fired,armSafe,occupancy)` | pass：仅首次合法过门后触发∧非旁路∧可跳过；fail：首次前触发或当玩家免费断源 |

---

## 4. 17 用户流程（`G3T-F-*`）

| ID | ② fixture | ③ 真实操作 | ④ 可断言期望 | ⑤ 资源/失败码 | ⑥ 证据 | ⑦ pass/fail |
| --- | --- | --- | --- | --- | --- | --- |
| `G3T-F-01` | R0（LEVEL §3）：出生 `S(9.5,6.5)`、`R0_D_EXIT(16.5,6.5)`、drone `E1(4.5,4.5)`；`Energy=100` | 移动/基础射击/首次 Scan/观察 ECHO | 移动非均匀（§1.2）；清 `E1`；出口表面记录两条苏醒标记差异；护盾源未 Scan 隐藏；ECHO 只读本地 | 首次 Scan `-10` / `OK` | `LOG(moveSample,echo.lines)` | pass：基础循环可玩∧异常证据可读∧不剧透；fail：ECHO 越界或护盾提前可见 |
| `G3T-F-02` | R0 出口 `R0_D_EXIT(16.5,6.5)` 开启态 | 真实移动到门位+`F` 交互 | 进入 R1 入口 `(1.5,9.5)`；无传送、无 `placePortal` 旁路；保 HP/位置 | `0` / `OK` | `LOG(roomId,pos,hp)` | pass：R0→R1 合法触发∧HP 保持；fail：瞬移/自动 portal/reset 满血 |
| `G3T-F-03` | R1：`R1_D_REF` 门孔 `(10,2),(10,3)`、`R1_D_SEAL` 门孔 `(10,9),(10,10)`；SEALED | 手动尝试两门 | 对照门 OPEN→北死路；谜题门 `E_LINK_UNAVAILABLE`、零费、原意图不变；对照门不通南廊 | `0`、`E_LINK_UNAVAILABLE` | `LOG(door.state,code,E)` | pass：对照进死路∧谜题被拒零费∧对照不绕；fail：谜题被普通开门绕过 |
| `G3T-F-04` | R1 谜题门 SEALED、范围内含门接收器/源/桥/敌链 | 一次 Scan 脉冲 | 一次扣 10，揭示门接收载波/合法连接/源仍发射；8s TTL（上游 `G2T-V-03`/`G2T-U-49`） | 一次 `-10` / `OK` | `DTO(Scan Revealed)` + `LOG(E)` | pass：一次脉冲扣 10∧揭示合法目标；fail：按目标数扣费 |
| `G3T-F-05` | R1 Scan 后 | 玩家或 ECHO 提出假设（可错） | 假设与已观察事实分开；ECHO 报载波不自动给完整答案；错误假设允许 | `0` / `OK` | `HUD(hypothesis)` + `LOG(echo.lines)` | pass：假设≠Canonical∧ECHO 不剧透；fail：自动升格事实 |
| `G3T-F-06` | R1 谜题门接收器（门体 `(10,9),(10,10)`）在 Jam `<6`+LOS | 对**门接收器** Jam（25，单目标） | `JAMMED_OPEN`、压制接收、**发射源 `R1_SRC_SEAL(12.5,9.5)` 仍在**（上游 `G2T-U-01`） | `-25` / `OK` | `LOG(door.state,sealSignalPresent)` | pass：门 JAMMED_OPEN∧源仍在∧未 Jam 源；fail：把源当 Jam 目标或改源 |
| `G3T-F-07` | `G3T-F-06` 终态 | 玩家过门进入南廊 `x11..21,y6..12`（门区占位为权威快照） | 真实通行性改变；占位快照一致；过门即历史合法，**不要求 South 廊出口时 Jam 仍活动** | `0` / `OK` | `SHOT(door)` + `SNAP(pos)` | pass：真实通过∧占位一致∧不把 Jam 6s 当出房计时；fail：仅动画或要求出口仍 Jam |
| `G3T-F-08` | `G3T-F-06` 终态，Jam 剩 1 tick、已过门到南廊 | Jam 到期读状态 | 恢复接收；源仍在才重新 SEAL；不重造已失联源、不回滚位置/HP/弹丸（上游 `G2T-U-13`）；不影响已在南廊 | `0` / `OK` | `LOG(sealSignalPresent,occupancy)` + `SNAP(L1)` | pass：到期恢复∧不回滚∧不夹人；fail：瞬间 SEAL 或回滚 |
| `G3T-F-09` | `G3T-F-08` 终态 | 记录能否预测到期/占位/断源三结果 + 同构迁移 | 理解=预测+解释+迁移，非操作日志（RER §13 Q6；上游 `G2T-P-07`） | `0` / `OK` | 预测/迁移记录 | pass：三项齐备；fail：只靠通过序列推断 |
| `G3T-F-10` | R1 南廊出口 `(20.5,9.5)`（LEVEL §4/§2） | 移动+`F` 交互 | 进入 R2 入口 `(2.5,10.5)`；触发点在出口而非过门瞬间；保 HP/位置 | `0` / `OK` | `LOG(roomId,pos,hp)` | pass：到出口→R2∧HP 保持；fail：过门即跳房或 reset 满血 |
| `G3T-F-11` | R2 路线 A：near `(8.5,9.5)` OFF、桥 UNAVAILABLE、guard `(5.5,6.5)` 存活 | 清 guard→near 手动 ON（0 费）→`TRANSITIONING`(1.5s)→`STABLE`→过桥到 `SAFE_E(16.5,9.5)` | 全程 0 Energy；`emitOn=true` 同提交送桥+共享感知；已清 guard 不复活（上游 `G2T-E-02`/`G2T-M-03`） | 手动 `0` / `OK` | `LOG(bridge.state,sharedConnected,E)` | pass：A 线 0 Energy∧双影响同 tick；fail：需 Energy 或半提交 |
| `G3T-F-12` | R2 路线 B：入口 `(2.5,10.5)`、单 guard `(5.5,6.5)`、near OFF、无内墙、桥 6×3 | 入口对 guard Link **单次 Jam**（入口→guard `5.0<6`，−25）→行至 near 开 relay（不刷新该次个人 Jam）→桥 1.5s→过桥到 `SAFE_E` | 单次 Jam 窗口内到东岸（设计期上界 5.597s，运行期 ≤6s，含输入开销待测）；guard 只调查旧位置；活 guard 留 R2；不用 Decoy 也可行（上游 `G2T-E-03`） | Jam `-25` / 手动 `0` | `REPLAY(json)` + `LOG(jamCount,reachTick,liveGuard)` | pass：单 Jam 内到 `SAFE_E`∧活 guard 留原房；fail：需第二次 Jam/清怪门槛/超 6s |
| `G3T-F-13` | R2 桥 `STABLE` 且玩家到 `SAFE_E(16.5,9.5)` | 到东岸触发 | 进入 R3 入口 `(1.5,9.5)`；活 guard 留 R2（LEVEL §5/§2） | `0` / `OK` | `LOG(roomId,liveGuard)` | pass：到东岸进 R3∧活 guard 留原房；fail：portal 清怪门槛 |
| `G3T-F-14` | R3 Warden `(13.5,9.5)` 存活、常规武器、三能力不可用 | 真实移动/射击至 `boss._hp<=0`（`src/entities/Boss.ts:155`） | Boss 战零 Signal 可赢；`won=true`→`EXTRACT COMPLETE`（D1；上游 `G2T-M-06`/`G2T-E-04`）；phase2 可召唤 drone | `0` Signal / `OK` | `LOG(boss.hp,dmg)` + `SHOT(phase)` | pass：零能力击败∧结尾解锁；fail：改 HP/绕 Boss |
| `G3T-F-15` | R3 护盾 relay `(20.5,4.5)` 未 Scan、护盾 ON（0.5）；**ECHO_BOSS_OBS 在首次真实减伤回执后才可触发** | 真实战斗首击产生减伤回执→玩家在阵地 `(20.5,7.5)` Scan→Jam relay→`0.5→1.0`→真实胜利 | ECHO 只在首次减伤回执后报护盾存在且来源未确认；配对 fixture 200 vs 400 与真实胜利**分开**；仍需击败 Warden | 按能力表扣费 | `LOG(shieldMult,dmg,bossObsTick)` + `REPLAY(json)` | pass：BOSS_OBS 在首减伤后∧Δ 可量化∧真实胜利分开；fail：开战即报来源或仅视觉 |
| `G3T-F-16` | Warden 已真实击败、玩家存活、胜利会话凭据独立；`NONE|POWER|MEMORY`（NONE=未提交）；UI §8 读回就绪 | 真实预选→可取消→确认→写失败先读回同局结果→按结果 COMMITTED / 明确未提交才改选 / 读回失败只重试读回或原事务 | 成功才退出；同局幂等；`E_CHOICE_CONFLICT`；不得以未知绕过幂等；ECHO_SAVE_FAILED 只说「未确认保存结果」；ECHO 不代选 | 结尾 `0`；`E_SAVE_FAILED`；`E_CHOICE_CONFLICT` | `SAVE(json)` + `LOG(readback,committed)` + `SHOT(ending)` | pass：读回优先∧明确未提交才改选∧未知只重试；fail：未知即改选/伪称已存/ECHO 代选 |
| `G3T-F-17` | 下一局新 run；上次成功提交选择（POWER/MEMORY，或首次 NONE） | 重开→观察 R0 差异→再次选择替换 | POWER=稳定灯带、MEMORY=档案保留、NONE=间歇/待决索引；不给伤害/能量/谜题捷径；本局不可撤销、下局可替换（ECHO §5；FLOW §7） | `0` / `OK` | `SHOT(R0 variant)` + `LOG(choice,committed)` | pass：差异可见∧无捷径∧可替换；fail：给捷径或撤销本局 |

---

## 5. 机制与软锁反例（`G3T-M-*`）

**G3T-M-01 门前能量耗尽软锁防护**
- ② R1 谜题门前（门体 `(10,9),(10,10)`）、`Energy=24`（< Jam 25）、西入口安全等待区。
- ③ 尝试对门接收器 Jam→失败；等待区按 5/逻辑秒恢复；`t+300` tick 重试。
- ④ 等待区无持续伤害且敌不可进（R1 无敌人）；`E=25` 后 Jam 成功 `JAMMED_OPEN`；可重试有界（上游 `G2T-U-33/37`）。
- ⑤ `E_ENERGY_INSUFFICIENT` 零扣费；成功后 `-25`/`OK`。
- ⑥ `LOG(code,E,waitTicks,zoneSafe)`。
- ⑦ pass：零扣费+可重试+等待区安全；fail：锁死/超时/敌入区。

**G3T-M-02 对照门不绕过谜题门出口**
- ② `R1_D_REF` 门孔 `(10,2),(10,3)` 只通北死路 `x11..21,y1..4`；`R1_D_SEAL` 门孔 `(10,9),(10,10)` 通南廊；`x=10`/`y=5` 墙+边框封闭。
- ③ 尝试从北死路绕到南廊；对 `R1_D_SEAL` 普通开门；尝试借 `placePortal` 跳过。
- ④ 北死路无法到南廊；谜题门始终 `E_LINK_UNAVAILABLE`；不得借自动 portal 跳过。
- ⑤ `E_LINK_UNAVAILABLE` 零费。
- ⑥ `LOG(path,door.state,code,portalUsed)`。
- ⑦ pass：对照不绕∧谜题不可绕∧无自动 portal；fail：旁路（含 placePortal）。

**G3T-M-03 R2 路线 B 留活 guard 进 R3（单次 Jam、无清怪门禁）**
- ② R2 同模板、单 guard `(5.5,6.5)` 存活、near OFF、无内墙、桥 6×3。
- ③ 入口单次 Jam guard Link→near 开 relay→桥 1.5s→到 `SAFE_E`，不清怪。
- ④ 到东岸进 R3；guard 留 R2；不依赖清怪 portal；单次 Jam 窗口内完成（VSCC §4；上游 `G2T-E-03`/`G3T-L-06`）。
- ⑤ Jam `-25` / 手动 `0`。
- ⑥ `LOG(roomId,liveGuard,jamCount,reachTick)`。
- ⑦ pass：活 guard 留原房∧进 R3∧单 Jam；fail：清怪才进/portal 门槛/需二次 Jam。

**G3T-M-04 桥失稳有限恢复（任意次数）**
- ② `R2_BRIDGE` UNAVAILABLE；`SAFE_W(9.5,9.5)`/`SAFE_E(16.5,9.5)` 装载校验；`hp=100`。
- ③ ON→STABLE→OFF→UNSTABLE（仍承重不扣血）→到期有玩家→送「进入桥前最后一岸」对应固定点并扣 20→第 N 次重启。
- ④ 无次数上限；送岸是独立事件非失败码；不总送西岸；死亡可新开局；无 `PLACEHOLDER`/`RECOVERY_MAX`（上游 `G2T-M-02`/`G2T-U-23/39`）。
- ⑤ 手动 `0`/`OK`；送岸独立事件。
- ⑥ `LOG(bridge.state,hp,side,recovery.index)`。
- ⑦ pass：任意次数可恢复∧按进入侧送岸∧有限 tick 结束；fail：总送西岸/第 4 次卡住/假失败码。

**G3T-M-05 安全 checkpoint：R2 活 guard 不捕获、恢复不补时**
- ② R2 路线 B 留活 guard 时尝试 `captureCheckpoint`；路线 A 清场后写点。
- ③ 按 `src/world/World.ts:674` 条件校验；退出/刷新后恢复最近成功 checkpoint。
- ④ 有活 guard 返回 null（不捕获）；清场后写点成功；恢复从 `savedTick` 继续、离线墙钟不推进（RER §11.3；LEVEL §8；上游 `G2T-S-01..03`）。
- ⑤ `0`/`OK`；不捕获 `null`。
- ⑥ `LOG(captureResult,checkpointValid)`。
- ⑦ pass：活 guard 不捕获∧安全点可恢复且不补时；fail：R2 活 guard 捕获或离线补时。

**G3T-M-06 无 LLM 完整流程**
- ② 不启动 Bridge/MCP/Harness；脚本 ECHO 在线。
- ③ 真实人类输入 R0→R1（含 Jam 门）→R2→R3 击败 Warden→R4 选择→重开。
- ④ 无外部 LLM 完整通关；ECHO 只读已发生事件、受本地接收器范围约束、不读 Hidden；模型不可用保留本地观察与人类操作（RER §10；上游 `G2T-E-07`）。
- ⑤ Energy 按表/`OK`。
- ⑥ `LOG(echo.lines,mode)` + `CONSOLE ERRORS: 0`。
- ⑦ pass：零外部模型完整通关∧模型不可用人类仍可完成；fail：依赖 LLM 或断线卡住。

**G3T-M-07 故障/断线降级**
- ② Bridge 已连接（Mode C）、进行中动作 `active`；公开 DTO 契约就绪。
- ③ WebSocket 断连/ping 超时→`FAULT→OFFLINE`+Mode A；人类继续真实输入。
- ④ 清除注入意图、在途动作 `cancelled`；**不回滚世界状态**（弹丸/敌/掉落/RNG 已发生副作用保持）；人类立即可玩；`YIELDED` 仅人类 takeover（RER §10；上游 `G2T-E-08`）。
- ⑤ 降级期新 Agent 请求 `0`+明确码。
- ⑥ `LOG(state.migration,mode)` + `SNAP(world)` + `CONSOLE ERRORS: 0`。
- ⑦ pass：安全降级∧世界不回滚∧人类可继续；fail：冻结/重启/回滚。**本轮只给断言，不声称执行通过**。

**G3T-M-08 同时死亡失败优先**
- ② R3 Boss 战同 tick、双方均将死亡。
- ③ 受控同 tick 双方死亡提交。
- ④ 失败优先；结算只提交一次、不重复奖励；`won=false` 锁结尾（RER §8.2；上游 `G2T-M-07`）。
- ⑤ `0`/`OK`。
- ⑥ `LOG(won,rewards,t)`。
- ⑦ pass：失败优先∧单次结算；fail：双结尾或重复奖励。

**G3T-M-09 选择幂等 + 读回 + 下局替换（`NONE|POWER|MEMORY`）**
- ② 切片档已有选择；主模式 `run.id=A`；状态域 `NONE|POWER|MEMORY`（NONE=未提交）；UI §8 读回就绪。
- ③ 同局重复提交同选项；写失败先读回同局结果；同局改选另一项；下一局再次选择替换。
- ④ 同局幂等不重复奖励；**写失败先读回：存在→COMMITTED；明确未提交→回 PREVIEW 改选；读回失败→保留 SAVE_FAILED 只重试读回/原事务，不得以未知绕过幂等**；同局不同选项 `E_CHOICE_CONFLICT`；本局不可撤销；下局可替换这一个世界结果；不覆盖旧 run/不自动 Save3（RER §11.4；ECHO §5；UI §8；上游 `G2T-E-06`/`G2T-S-06`）。
- ⑤ 结尾 `0`/`OK`、`E_CHOICE_CONFLICT`、`E_SAVE_FAILED`。
- ⑥ `SAVE(json)` + `LOG(option,revision,committed,readback)`。
- ⑦ pass：幂等∧读回优先∧未知只重试∧可替换∧不覆盖；fail：未知即改选/重复奖励/伪报/历史 runId 授权。

**G3T-M-10 死亡 vs 退出/刷新 的恢复路径（含 B 留活 guard）**
- ② 三分支：(a) R3 前死亡；(b) 路线 B 留活 guard 后手动退出/刷新；(c) 安全清场后退出/刷新。
- ③ (a) 真实死亡→失败；(b)(c) 退出/刷新→重载。
- ④ (a) `finishRun(false)` 清本局 run、新开 R0（不续安全点）；(b) 最近成功 checkpoint 为 **R1 出口 `(20.5,9.5)`**（R2 有活 guard 无 checkpoint，不得伪称已存 R3 前/`SAFE_E` 安全点）；(c) 恢复最近成功 checkpoint、从 `savedTick` 继续；无战斗内快照（RER §11.3；LEVEL §8；FLOW §9）。
- ⑤ `0`/`OK`；死亡后 `run` 不存在。
- ⑥ `LOG(path,runExists,resumeRoom,savedTick)`。
- ⑦ pass：(a) 清 run 新 R0∧(b) 回 R1 出口侧 checkpoint∧(c) 安全点续档；fail：死亡续档/伪存 R3 前/b 满血复活。

**G3T-M-11 反伪造：禁止 placePortal 旁路、reset 满血、传送/改 HP 伪 E2E**
- ② 固定模板；存在 `World.placePortal` 与 `Player.reset`（`hp=maxHp`）。
- ③ 尝试用 `placePortal` 直接跳 R1→R2 或清怪产生传送门；尝试 `reset` 过房；尝试改 HP/`boss._hp`/`world.won` 造结算。
- ④ 全部判 fail：过渡只经谜题门/承重桥到 `SAFE_E`/Boss 胜利；过房不 `reset` 满血（HP 保持）；结算只由真实击败产生；无清怪 portal 门槛。
- ⑤ 不应有成功码；旁路尝试应被拒绝或不被采信。
- ⑥ `LOG(portalUsed,hpBeforeAfter,teleport,forcedWin)`。
- ⑦ pass：真实路径∧HP 不被重置∧无 forcedWin；fail：任一伪造路径。

---

## 6. 真实浏览器 E2E（`G3T-E-*`；D9 `仅原则认可`，未运行）

**E2E 红线**：固定模板入口（不调 `MapGenerator`），真实输入驱动；禁 `player.reset` 满血/传送、改 HP、`boss._hp`、`world.won`、`killBoss()`、伪造结算；禁借 `placePortal` 绕谜/清怪；`CONSOLE ERRORS: 0`、无 `pageerror`；产物落项目外；理解由 `G3T-P-*` 后置独立评。

| ID | ② fixture | ③ 真实操作 | ④ 可断言期望 | ⑤ 资源/失败码 | ⑥ 证据 | ⑦ pass/fail |
| --- | --- | --- | --- | --- | --- | --- |
| `G3T-E-01` | 固定模板 `MapData`（`fixedSeed`）；真实 `World` | 启动切片入口，校验未调随机生成 | 四房按模板装载、复用 `World`/`HUD`；无随机 MapGenerator | `0` / `OK` | `LOG(mapSource,roomCount)` + `CONSOLE ERRORS: 0` | pass：固定模板∧复用 World；fail：调用随机生成 |
| `G3T-E-02` | R1 两门同外观；无提示 | 真实键鼠走 VSCC §2 九步（理解后置评） | 规则链真实动作与恢复成立；零 console error；理解由 `G3T-P-*` 独立评；过门历史合法不要求出口仍 Jam | Scan `-10`/Jam `-25`/`OK` | `SHOT(door)` + `DTO(Scan)` + `errors.json` | pass：九步真实∧零错误∧理解独立评；fail：传送/改 HP/只动画 |
| `G3T-E-03` | 同 R2 模板 seed，两套输入 | 真实 A（清 guard）与 B（保留活 guard、单 Jam）各到 `SAFE_E` | 两解序列显著不同且都能到 R3；B 不依赖清怪、单 Jam（上游 `G2T-E-03`） | 按能力表 | `REPLAY(json)` 两组 + `LOG(liveGuard,jamCount)` | pass：两解异质∧均到东岸∧单 Jam；fail：同质/必清怪/需二次 Jam |
| `G3T-E-04` | R3 Warden 存活；玩家不用 Signal | 真实移动/射击至 `boss._hp<=0` | 零 Signal Boss 战可赢；`EXTRACT COMPLETE`；不绕撤离（D1；上游 `G2T-E-04`） | `0` Signal / `OK` | `SHOT(phase)` + `LOG(boss.hp)` | pass：零能力击败∧结尾解锁；fail：直杀/改 HP/绕 Boss |
| `G3T-E-05` | R3 护盾来源未 Scan；阵地 `(20.5,7.5)`→relay `(20.5,4.5)` 3 格 | 真实首击减伤回执→Scan（玩家发出）→Jam→真实胜利 | ECHO_BOSS_OBS 在首个减伤回执后才报；护盾状态/实际伤害有记录；配对 200 vs 400 与真实胜利分开（上游 `G2T-M-07`/`G2T-E-05`） | 按能力表 | `LOG(shieldMult,dmg,bossObsTick)` + `REPLAY(json)` | pass：BOSS_OBS 在首减伤后∧3 格 Scan/Jam∧Δ 可量化；fail：开战即报或仅视觉 |
| `G3T-E-06` | Warden 真实击败、胜利会话独立；`NONE|POWER|MEMORY`；UI §8 读回就绪 | 真实预选/取消/确认→写失败先读回同局结果→重试原事务→重开观察差异 | 存在→COMMITTED；明确未提交才改选；读回失败只重试；ECHO_SAVE_FAILED 不声称确定未保存；下局读取并替换；不覆盖旧 run/不自动 Save3（上游 `G2T-E-06`；ECHO §5；UI §8） | 结尾 `0`；`E_SAVE_FAILED` | `SAVE(json)` + `LOG(readback,committed)` + 下局 `SHOT` | pass：读回优先∧未知只重试∧替换/隔离成立；fail：未知即改选/覆盖旧 run/撤销本局 |
| `G3T-E-07` | 真实 `Player.update`（非均匀移动）；固定模板 | 真实方向输入移动/冲刺；真实过房（谜题门→南廊；桥→`SAFE_E`） | 位移随方向变化（非恒速 3.4375、非恒定 dash 1.29 格）；过房不改 HP（不 `reset` 满血）；无传送/改 HP 造结算 | `0` / `OK` | `LOG(speedByDir,dashDist,hpBeforeAfter)` + `CONSOLE ERRORS: 0` | pass：位移非均匀∧过房 HP 保持∧无伪造；fail：恒速假设或满血过房 |

---

## 7. 无提示试玩 / 提示等级 / 时间（`G3T-P-*`；D9 `仅原则认可`，未实测）

- 目的：验证规则可被自行发现；记录由试玩填写，本轮不虚构数据。提示等级与触发以 EXPERIENCE_FLOW §8 为唯一来源，文案候选见 ECHO_SCRIPT §4。
- 提示：`H0` 无解法提示；`H1` 指出可见异常（正常活动 40s 无进展可自动一次/每房最多一次，或玩家请求）；`H2` 指出可观察对象（已见 H1、再 45s 无进展且至少一次合法失败，或显式请求；每房自动最多一次）；`H3` 可验证假设（**仅玩家显式请求**，需合法观察支持）；`H4` 具体操作（**仅玩家显式点「需要具体操作」**，永不自动，即使重复失败也须确认）。每房自动 H1/H2 各最多一次；手动请求一次只升一级；语义进展重置无进展计时；暂停/对话模态/战斗威胁不推进计时；主持人含规则词记污染。
- 样本/通过比例标 `Prototype Testing Suggestion — 原型测试建议`，无实测。

| ID | 观察项 | 允许等级 | 记录字段 | 预测/解释/迁移要求 | pass/fail |
| --- | --- | --- | --- | --- | --- |
| `G3T-P-01` | 时间测量：排除暂停/失焦/加载/访谈/空等/整局死亡重开；分别记录墙钟、成功路径、死亡重试 | 全 | `wallclock`、`successPath`、`deaths`、每房 `观察/移动/战斗/实验/对话/无进展等待` 秒 | 不强制等待/堆 HP 凑；首次 20–30min、熟练 9–14min 为待验预算 | pass：口径排除项明确∧墙钟与死亡分开∧不强制；fail：混算或强制凑时 |
| `G3T-P-02` | 提示等级与污染审计（H0–H4） | H0–H4 | 每句、禁用词、污染 tick、自动 vs 请求、H4 是否显式确认 | 首次思考不得直接给答案；H3/H4 仅显式请求；H4 永不自动 | pass：H0–H2 段无污染∧H3/H4 仅显式∧首触不 H4；fail：自动 H4 或污染计入 |
| `G3T-P-03` | 自发 Scan | H0–H1 | 首次 Scan tick、触发前所见、主持人提示 | 预测扫描将显示哪类差异；换门后复用判断 | pass：H0–H1 自发+预测/解释/迁移；fail：H3 后才 Scan 或只蒙对 |
| `G3T-P-04` | 因果解释不是「Jam 开门」 | H0–H2 | 能否用因果链解释门开（非单纯操作通过） | 解释「封锁被压→门开」而非只记按钮 | pass：能用因果解释；fail：仅操作通过无解释 |
| `G3T-P-05` | relay 双影响 | H0–H2 | 是否体现「恢复桥同时改变共享感知」、发现 tick | 预测「再 ON 一次会怎样」并被验证 | pass：双影响自发或经非引导提问识别；fail：需 H4 明说 |
| `G3T-P-06` | 多解（路线 B 单 Jam 留活 guard） | H0–H2 | 两解序列、发现顺序、是否换皮重放 | 预测 B 不需清怪；同构房间复用 | pass：机制不同的第二解；fail：换皮重放 |
| `G3T-P-07` | ECHO 推测 vs 事实（含 ECHO_SAVE_FAILED 不声称确定未保存） | H0–H2 | ECHO 行、事实/推测标签、保存失败措辞、玩家反应 | 预测 ECHO 能/不能报什么；指出信息差；不得把「未确认」当「未保存」 | pass：信息差影响决策∧不把推测当事实∧保存失败不说确定未保存；fail：假设升格或伪称状态 |
| `G3T-P-08` | Boss 收益（配对 200 vs 400 fixture + 真实胜利） | H0–H2 | 是否理解护盾 ON/OFF 可测伤害差 | 解释 Signal 辅助真实收益（非仅视觉） | pass：理解收益∧区分 fixture/真实；fail：仅视觉差异 |
| `G3T-P-09` | 选择理由（POWER/MEMORY/NONE） | H0–H2 | 能否给出二选一/暂不选理由（非脚本代答） | 解释选择后果预期 | pass：能陈述理由；fail：盲目或脚本代答 |
| `G3T-P-10` | 后置非引导提问、盲测 | H0–H2 | 提问时机（后置）、是否提前解法、行为+预测+迁移 | 盲测不提前给解法 | pass：后置非引导∧行为+预测+迁移齐备；fail：提前解法或污染 |
| `G3T-P-11` | 理解与通关独立评估 | H0–H2 | 通关用时/失败数 与 理解回答 分开记录 | 通关快≠理解；九步完成≠理解 | pass：两者独立且分别判定；fail：用通关替代理解 |

> 总判据：pass = H0–H1 段至少 1 条规则被自发理解（含预测/解释/迁移）+ 至少 1 个障碍出现机制不同的两解 + 污染未计入通过 + ECHO 信息差成立且不越界；fail = 全依赖 H3/H4 / 全只蒙对 / 无第二解。

---

## 8. 切片存档隔离与失败（`G3T-S-*`）

| ID | ② fixture | ③ 真实操作 | ④ 可断言期望 | ⑤ 资源/失败码 | ⑥ 证据 | ⑦ pass/fail |
| --- | --- | --- | --- | --- | --- | --- |
| `G3T-S-01` | 切片独立键 `last_signal_station_zero_save_v2`（提案）；原版/economy 键 `last_signal_save_v1`（`src/config/game.ts:33`） | 切片入口写档；验证主模式键不变 | 不覆盖主/economy run；禁止借主模式首写 `expectedId=undefined` 覆盖原 run（RER §11.2；上游 `G2T-S-02`） | `0` / `OK` | `SAVE(json)` 双键 + `LOG(keys)` | pass：主/economy 键不变∧不覆盖；fail：覆盖或键改 |
| `G3T-S-02` | 切片档写入；磁盘满/不可用注入；UI §8 读回就绪 | 写档失败→先读回同局结果→按结果 COMMITTED / 明确未提交才改选 / 读回失败只重试读回或原事务 | `E_SAVE_FAILED`、保留界面、不伪报已存、不提前应用；不得以未知绕过幂等；ECHO_SAVE_FAILED 只说「未确认保存结果」（RER §11.4；UI §8；ECHO_SCRIPT） | 写入 `0`/`E_SAVE_FAILED` | `SAVE(json)` + `LOG(write.result,readback)` | pass：读回优先∧未知只重试∧不伪报；fail：伪报/未知即改选/提前应用 |
| `G3T-S-03` | 切片档已有选择；下一局新 run；状态域 `NONE|POWER|MEMORY` | 下一局再次选择替换这一个世界结果 | 本局不可撤销；下局可替换；不覆盖旧 run/不自动升 `SAVE_VERSION`（RER §11.4/§11.2；上游 `G2T-S-06/07`） | 结尾 `0`/`OK` | `SAVE(json)` + `LOG(committed,version)` | pass：可替换∧不覆盖∧不升版；fail：覆盖旧 run 或自动 Save3 |
| `G3T-S-04` | 注入坏扩展/高 `sliceSchema`/不同 `templateId`/`templateRevision` | 读→校验→回写 | 保留原始档、拒绝覆写并显示原因；仅用户选新开局才替换本切片 run（RER §11.2；UI §8；上游 `G2T-S-05`） | `0` / 明确拒绝码 | `SAVE(json)` + `LOG(reason)` | pass：原档保留∧不覆写；fail：静默丢弃或覆盖 |
| `G3T-S-05` | 主模式 permanent 进度（cores/run/bossesDefeated） | 切片奖励与选择写入后读主模式 | 切片奖励与选择不回写主模式；原模式存档不受影响（RER §11.2；VSCC §1） | `0` / `OK` | `LOG(permanentBefore,permanentAfter)` | pass：主模式进度隔离；fail：切片回写主模式 |

---

## 9. 坐标规格（LEVEL §1–§7 终版值 + 确定性判据）

### 9.1 坐标类与确定性函数

- **坐标类**：地形 mask 用整数 cell `(i,j)`；实体/设备/端点用 position `(i+0.5, j+0.5)`（格中心）；1 格 = 1 tile = 64 px。同一比较只用一种坐标类。
- **D1 距离**：`d = hypot(ax-bx, ay-by)`（同坐标类）。能力半径严格 `d < r`，不加碰撞半径（RER §8.1）。
- **D2 LOS**：格线 supercover 枚举经过格、去两端目标格、墙角两侧格都查；`tile.type ∈ {wall,lava,water}` 阻断；端点归属 `floor(wx)-minX`（`src/world/World.ts:136`）。
- **D3 可走**：`isWalkable(wx,wy,0.5)` 四角采样（`src/world/World.ts:145`）；路径沿线每 ≤0.5 格采样，任一不可走则路径失败。
- **D4 感知**：敌人用源码 `distanceTo(player) <= aggroRange`（`src/entities/Enemy.ts:145`），drone `aggroRange=340/64=5.3125`；感知用 `<=`，能力半径用 `<`，不互换。
- **D5 手动 F 交互**：交互范围是独立参数，**不得以 Jam 6 格代替**；断言只要求玩家到达设备旁可交互（具体半径按 UI/LEVEL 定义）。
- **D6 桥与时间**：桥覆盖 `x10..15,y8..10`（6 长×3 宽），仅 `STABLE` 可走；R2 路线 B 设计期上界 `6.083/3.4375 + 1.5 + 8.0/3.4375 = 5.597s`，运行期验收「单次 Jam 生效起→`SAFE_E` ≤ 6s」（含实际输入开销，待 E2E 实测）。
- **D7 过房门控**：R0→R1、R1→R2、R2→R3、R3→R4 均为切片状态门控（门态/桥态/胜利位+玩家位置）；**不借 `World.placePortal`**；过房保 HP/位置、不 `reset` 满血。

### 9.2 LEVEL 终版坐标与判据

| 项 | LEVEL 节 | 类型 | 值 / 判据 |
| --- | --- | --- | --- |
| R0 出生 / 出口 / 敌人 | §3 | position | `S(9.5,6.5)`、`R0_D_EXIT(16.5,6.5)`、drone `E1(4.5,4.5)`；`R0_D_EXIT` 开启+到门位→R1 入口 `(1.5,9.5)` |
| R1 mask | §4 | cell | 边框墙；`x=10` 竖墙 `y1..12`；`y=5` 横墙 `x11..21`；西入口 `x1..9,y1..12` |
| `R1_D_REF` / 北小室 | §4 | cell | 门孔 `(10,2),(10,3)`；北小室 `x11..21,y1..4`（死路） |
| `R1_D_SEAL` / 南廊 | §4 | cell | 门孔 `(10,9),(10,10)`；南廊 `x11..21,y6..12` |
| `R1_SRC_SEAL` | §4 | position | `(12.5,9.5)`（cell `(12,9)`）**只读发射源**：不可 Jam、不可免费断源，仅 Scan 可读发射端点 |
| R1 Jam 目标 | §4 | position | `R1_D_SEAL` 门体接收器（cell `(10,9),(10,10)`）；玩家须在 Jam `<6`+LOS；相邻西格 `(9.5,9.5)`→门体 `d≈1.0` |
| R1 入口 / R2 出口 | §4/§2 | position | 入口 `(1.5,9.5)`；R1→R2 触发在南廊出口 `(20.5,9.5)`（非过门瞬间） |
| R2 mask | §5 | cell | 26×14；西地板 `x1..9`、东地板 `x16..24`、chasm `lava x10..15,y1..12`、桥 `x10..15,y8..10`（6×3）；无其它内墙 |
| R2 入口 / near / far | §5 | position | 入口 `(2.5,10.5)`；`R2_RELAY`/`R2_CTRL_NEAR(8.5,9.5)` 初始 OFF、自供电；`R2_CTRL_FAR(18.5,9.5)` |
| R2 guard | §5 | position | 单 guard `(5.5,6.5)` drone；`aggro 5.3125`、`attackRange 3.125` |
| R2 入口→guard Link | §5 | distance | `5.0 < 6`（单次 Jam 可达，单目标 −25） |
| R2 near→`SAFE_E` | §5 | distance | `8.0` 格 |
| R2 安全岸点 | §5 | position | `SAFE_W(9.5,9.5)`、`SAFE_E(16.5,9.5)`（桥失败回岸，**非 checkpoint**） |
| R2 时序 | §5 | — | 设计期上界 `1.770 + 1.5 + 2.327 = 5.597s`；运行期「单 Jam 生效起→`SAFE_E` ≤6s」含输入开销待测 |
| R3 mask / 掩体 | §6 | cell | 26×18；掩体 `(7,4)(7,13)(18,9)` |
| R3 入口 / Boss / relay / 阵地 | §6 | position | 入口 `(1.5,9.5)`；`R3_WARDEN(13.5,9.5)` 半径 3.0；`R3_SHIELD_RELAY(20.5,4.5)` 维护封闭；阵地 `(20.5,7.5)` |
| R3 阵地判据 | §6 | distance | 阵地→relay `3.0`（Scan `<12`、Jam `<6`、LOS 通）；阵地→Boss `7.28 > attackRange 3.125`；路径 `(1.5,9.5)→(1.5,2.5)→(20.5,2.5)→(20.5,7.5)` 到 Boss 最小 `7.0>3`；Scan 由玩家发出 |
| R3 阶段 | §6 | — | `summonDrones()` 可召唤 drone；普通路线零 Signal 仍可胜 |
| R4 结尾 | §7 | — | 无网格；`NONE|POWER|MEMORY` 与保存状态机见 §8/UI §8 |
| checkpoint | §8 | — | R2 有活 guard 无 checkpoint，最近为 R1 出口 `(20.5,9.5)`；R3 含 Boss 不可写；死亡回 R0；仅退出/刷新恢复最近成功 checkpoint |

---

## 10. 待用户签核与边界

| # | 事项 | 归属 |
| --- | --- | --- |
| 1 | GDD-02 §6 原型初值与 GDD-03 新增布局/台词/选择/时长 `Prototype Tuning Values` 最终冻结 | 用户签核 |
| 2 | 手动交互细节（走廊两岸免费开关/自供电/Boss 节点手动限制）与 R1 门前等待区布局边界 | 用户签核（GDD-03 提案） |
| 3 | 切片独立存储 `last_signal_station_zero_save_v2`、reality 扩展/schema 判别/迁移/回滚，是否升 `SAVE_VERSION` | 用户签核 + ADR |
| 4 | `POWER/MEMORY/NONE` 选择语义、字段、叙事与 R0 下一局差异表现（NONE=未提交） | GDD-03（Lead FLOW/ECHO/UI）+ 用户签核 |
| 5 | `R1_SOURCE_TEST` 可选反事实是否采纳 | 用户签核（GDD-03 提案） |
| 6 | D9 试玩样本量/seed/截图日志落点/CI 归属；H0–H4 文案终稿 | 用户签核（GDD-03 提案） |
| 7 | 关卡坐标以官方 LEVEL §1–§7 为准（本规格 §9 已给终版值与判据） | LEVEL |
| 8 | 无 LLM 完整流程与断线降级 Mode A 的真实接入（Bridge/MCP 未来） | 实现前 ADR |

> 已由用户明确决策、不再列为待确认：D1「零 Signal 仅 Boss 战可胜（门谜题需 Jam）」；四目标/三基础能力、无高级协议/自由地形；C09 relay 免费/自供电/两岸可达只作 `建议冻结` 提案。

---

## 11. 交叉链接

- 规则：[`REALITY_ENGINEERING_RULES.md`](REALITY_ENGINEERING_RULES.md)（RER）、[`VERTICAL_SLICE_CAUSAL_CHAINS.md`](VERTICAL_SLICE_CAUSAL_CHAINS.md)（VSCC）。
- 叙事/UI 合同：[`VERTICAL_SLICE_EXPERIENCE_FLOW.md`](VERTICAL_SLICE_EXPERIENCE_FLOW.md)、[`ECHO_VERTICAL_SLICE_SCRIPT.md`](ECHO_VERTICAL_SLICE_SCRIPT.md)、[`VERTICAL_SLICE_UI_SPEC.md`](VERTICAL_SLICE_UI_SPEC.md)。
- 关卡/计划：[`VERTICAL_SLICE_LEVEL_DESIGN.md`](VERTICAL_SLICE_LEVEL_DESIGN.md)、[`VERTICAL_SLICE_IMPLEMENTATION_PLAN.md`](VERTICAL_SLICE_IMPLEMENTATION_PLAN.md)。
- 上游测试：[`GDD_02_TEST_SPEC.md`](GDD_02_TEST_SPEC.md)。
- 上位/参考：[`GAME_DESIGN_BIBLE.md`](GAME_DESIGN_BIBLE.md)、[`GAME_DESIGN_BIBLE_ALIGNMENT.md`](GAME_DESIGN_BIBLE_ALIGNMENT.md)、[`DESIGN_DECISION_REGISTER.md`](DESIGN_DECISION_REGISTER.md)、[`README.md`](README.md)、[`SIGNAL_SYSTEM_DESIGN.md`](SIGNAL_SYSTEM_DESIGN.md)、[`HUMAN_AGENT_COOP_DESIGN.md`](HUMAN_AGENT_COOP_DESIGN.md)、[`AGENT_BRIDGE_ARCHITECTURE.md`](AGENT_BRIDGE_ARCHITECTURE.md)、[`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md)、[`PROJECT_ROADMAP.md`](PROJECT_ROADMAP.md)、[`IMPLEMENTATION_TASKS.md`](IMPLEMENTATION_TASKS.md)、[`STYLE_GUIDE.md`](STYLE_GUIDE.md)、[`ECONOMY_MODE.md`](ECONOMY_MODE.md)。
- 规格内部：§2 覆盖 → §3 几何 → §4 流程 → §5 机制 → §6 E2E → §7 试玩 → §8 存档 → §9 坐标规格 → §10 签核。

---

## 12. 边界声明

- 本文件为 GDD-03 关卡与交互验收的 `GDD03 推荐提案 · 候选`；除 D1/D2 `明确批准`、D4 `仅原则批准`、D3/D5/D6/D7/D8/D9 `仅原则认可` 外，全部新增细则/布局/台词/选择/数值/时长未批准、未实现；未自称已通过或已验证。
- **现状源码未实现** Signal/Jam/Decoy/Relay/Bridge/Door-Seal/ECHO/结尾二选一；本规格针对设计中的切片，以上游 GDD-02 机制断言、Lead 三份合同、LEVEL §1–§7 与源码事实（§1.2）为依据。
- **几何**：§9 已给 LEVEL 终版坐标与确定性判据；R2 单 guard / 无内墙 / 6×3 桥 / 设计期上界 5.597s（运行期 ≤6s 含输入开销待测）；R3 固定阵地 3 格 Scan/Jam。
- **R2 路线 B**：单次 Jam（25/6s/8s CD）窗口内到 `SAFE_E`，不得要求第二次 Jam；Decoy 仅为合法对照实验（不可见时优先诱饵、可见时玩家优先），**非必经路线**。
- **选择保存读回**：写失败先读回同局提交结果；存在→COMMITTED，明确未提交才改选，读回也失败则保留 `E_SAVE_FAILED` 只重试读回/原事务，不得以未知绕过幂等；`ECHO_SAVE_FAILED` 不声称确定未保存。
- **速度**：`Player.update` 用 `sx/32`、`sy/16` 转世界速度，非均匀；`3.4375 格/秒` 仅保守下界，`dash` 非恒定 1.29 格；真实耗时以输入帧测量。
- **死亡 vs 退出/刷新**：死亡 `finishRun(false)` 清本局 run、新开 R0；退出/刷新才恢复最近成功 checkpoint；R2 留活 guard 无 checkpoint（最近为 R1 出口）。
- **禁止**借 `World.placePortal` 绕谜题门/清怪门槛；过房不得 `reset` 满血；真实 E2E 禁传送/改 HP/`killBoss()`/伪造结算；fixture 只初始设置；预设选项/scripted JSON 不冒充已体验。
- 未修改任何源码/测试/配置/依赖/存档结构；未运行玩法验收、构建或测试；未自行 commit/push。
