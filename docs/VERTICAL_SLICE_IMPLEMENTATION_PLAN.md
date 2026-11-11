# GDD-03 — 首切片实现计划（Station Zero · The Broken Door）

> **性质与边界**：本文件是**设计计划，不是实现**。工期为**假设**（标不确定性），非承诺；提案不因交付升为批准，设计不以实测结论冒充实测；新增细则仅为建议/候选，沿用 GDD-02 未批准标记，**不新增冻结**。
> **权威引用**：RER、VSCC、`GDD_02_TEST_SPEC.md`、`VERTICAL_SLICE_LEVEL_DESIGN.md`、`VERTICAL_SLICE_EXPERIENCE_FLOW.md`。
> **坐标**：cell `(i,j)` 整数 = 地形 mask；position `(i+0.5,j+0.5)` = 实体/设备。1 格 = 1 tile = 64 px。

---

## 1. 读源事实校正（现状 vs 未来，不误标）

| 事实 | 真实源码 | 对计划的影响 |
|---|---|---|
| `MapData`/`Room`/`Tile`/`RoomKind` | **`src/types/index.ts:62-95`**（`MapGenerator` 仅 `import ... from '../types'`） | 固定模板复用 `MapData`；**不是**在 `MapGenerator` 定义 |
| `RunCheckpoint`/`SaveData`/`SAVE_VERSION=2` | `src/types/index.ts:96-125` | checkpoint **已实现**（非"未实现"） |
| checkpoint 写入条件（现状） | `src/systems/SaveSystem.ts`（`writeCheckpoint`/`finishRun`）、`src/world/World.ts:674-688`（cleared/alive/`!won`/`!boss`/无活敌，写 `rngState`） | **「无危险转换」不是现状**（GDD-02 未来提案）；不写成现状 |
| 已有 checkpoint 测试 | `tests/checkpoint.spec.ts` | 已存在，非"未实现" |
| Boss 三阶段/护盾减伤/phase2 召唤 | `src/entities/Boss.ts`（`0.66/0.33`、`Math.max(2,dmg*reduction)`、`summonDrones()` 用 `Math.random()`） | 复用三阶段；`Math.random`→种子源为未来提案 |
| 坐标/半径/屏震历史项 | `src/scenes/GameScene.ts`、`src/world/*`、`src/entities/*`（Task 0.3/0.4） | **历史项**，不列为切片"未完成前置" |
| 旧 PHASE 0–2 / 内容任务 | `IMPLEMENTATION_TASKS.md` | **不全部强作切片前置**；只按自身节奏复用/并行 |

---

## 2. 模块矩阵（7 核心 + 2 用户必需：Save/Checkpoint、HUD）

> 保留 [`IMPLEMENTATION_TASKS.md`](IMPLEMENTATION_TASKS.md) 的**原始 TaskID 映射**（Task 0.1–0.6 / 1.1–1.6 / 2.1–2.7 / 3.x / 4.x / 5.x）不动；新增工单 `SL-*` 对齐既有模块，不重排、不覆盖旧 ID。`【已实现】/【需扩展】/【需新建】` 沿用既有口径。

| # | 模块 | 复用（真实路径） | 适配 | 新建 | 主要风险 | 对齐既有 Task |
|---|---|---|---|---|---|---|
| M1 | **SliceScene + World 适配层** | `src/scenes/GameScene.ts`（`create/update`/HUD 锚定）、`src/world/World.ts`（`tileAt/isWalkable/currentRoom`） | `World` 增「固定模板入口」分支：**不调** `MapGenerator.generate/assignRoles`；过房用**切片专用状态门控**（门态/桥态/胜利位+玩家位置），**不复用 `World.placePortal` 清房传送门**、不 reset 满血 | `src/scenes/SliceScene.ts`【新建】 | 固定模板供给是未来接口提案（VSCC §1/§4） | Task 1.2 / 2.2 |
| M2 | **MapData 固定模板** | **`src/types/index.ts`** 的 `MapData/Room/Tile/RoomKind` | `MapData` 增 `devices[]`/`targets[]` 覆盖层；地形用整数 cell mask，实体用 `(i+0.5,j+0.5)` | 四房间模板数据（`src/world/slice/*.ts` 候选）【新建】 | 手工关卡 vs 随机 `MapGenerator` 边界（X-13 / ADR-GDB-14） | Task 1.3 / 2.2 |
| M3 | **WorldRenderer / 边界** | `src/world/WorldRenderer.ts`、`src/core/iso.ts`（64×32） | 每房间 camera 边界按 `MapData.width/height` 钳制；Boss 房缩放复用 `CAM_ZOOM_MAX` | — | 单位/屏震历史项勿重复改 | Task 0.3（历史） |
| M4 | **切片状态门控（替代 portal）** | `src/world/World.ts`（`currentRoom`）、`src/types/index.ts`（`Room`） | 到下一房间改为**显式状态门控**：`R1_D_SEAL` 合法过门只置 `passedSealThisVisit=true` 并留南廊，到达出口 `(20.5,9.5)` 才转 R2（Jam 到期不锁已过门玩家）；桥 `STABLE`+玩家到东岸 `(16.5,9.5)` → R3；`boss._hp≤0 && alive` → R4；**保 HP/位置** | `src/systems/slice/SliceTransition.ts`【新建】 | 不得借 `placePortal` 绕谜题；不得用清怪门禁挡 B | Task 1.2 |
| M5 | **EnemyAI / 感知 FSM** | `src/entities/Enemy.ts`（`detects()` 唯一入口）、`src/config/enemies.ts` | `detects()` 并入信号阈值与优先级（死亡>Jam>局部可见玩家>局部可接收诱饵>位置证据>巡逻，RER §4.4）；仅现有种类 | `src/systems/signal/` 接入【新建】 | 改 `detects()` 冲击 `tests/audit.spec.ts` | Task 2.5 |
| M6 | **Boss / 护盾中继器** | `src/entities/Boss.ts`（三阶段/`hit()`/`boss-phase`/`summonDrones`）、`src/config/enemies.ts` | `R3_SHIELD_RELAY` 维护封闭；Jam→倍率 `0.5→1.0`；普通交互 `E_NOT_APPLICABLE` | 护盾 relay 状态机【新建】 | phase2 有召唤 drone，勿写「无敌人」；`Math.random` 替换延后 | Task 2.6 |
| M7 | **Signal 能力 + 设备状态机 + Energy** | `src/types/index.ts`、`src/config/game.ts`、`src/scenes/GameScene.ts`（HUD 读数） | 门/中继器/桥/敌人连接四目标状态机（RER §4.1–§4.4）；手动两岸开关 | `src/systems/signal/`：Scan/Jam/Decoy + Energy【新建】 | 事件通道（ADR-01）、Energy 暂停计时、坐标铁律（ADR-10） | Task 2.1/2.4/2.6 |
| **M8** | **Save / Checkpoint（用户必需；现状 vs 未来）** | `src/systems/SaveSystem.ts`（`validate/load/save/writeCheckpoint/finishRun`）、`src/systems/RunCheckpoint.ts`、`src/types/index.ts`、`src/config/game.ts`（`SAVE_KEY`）、`tests/checkpoint.spec.ts`【已实现】 | 现状可用（cleared/alive/`!won`/`!boss`/无活敌）；**未来**：切片命名空间 `last_signal_station_zero_save_v2` + 可选 `reality` 扩展 + `sliceSchema/templateId/templateRevision` 判别 | 切片存档适配器【新建】（不覆盖主/economy 键） | 迁移/回滚 ADR-06；不自动升 v3 | Task 1.1 |
| **M9** | **HUD（用户必需）** | `src/scenes/GameScene.ts`（`setupHud/lockHud/refreshHud`）、`src/core/GraphicsFactory.ts`、`src/systems/AudioSystem.ts` | 复用锚定；加 Energy 条/能力冷却/TTL/目标邻近状态/Hint 入口/选择模态 | HUD 组件：Scan/Jam/Decoy 图标、冷却/有效源、桥预警、Boss 护盾状态【新建】（UI §1–§7） | 不重复监听（SHUTDOWN 清理） | Task 2.4 |
| **M10** | **ECHO 事件 + Hint 调度** | `src/scenes/GameScene.ts`（状态读数）、`src/core/eventbus.ts`（事件通道候选）、`ECHO_VERTICAL_SLICE_SCRIPT.md`、`VERTICAL_SLICE_EXPERIENCE_FLOW.md` §8 | 事件只引用已发生真实事件；四类信息权限裁剪；H0–H4（H3/H4 主动请求，H1/H2 计时） | ECHO 事件表/台词队列/Hint 调度器【新建】 | 不得越权读隐藏/全图；不得代玩家操作 | Task 3.3（observe_events 候选）/4.x |
| **M11** | **选择 UI + 保存反馈** | `src/scenes/GameOverScene.ts`（结算风格参考）、`src/scenes/GameScene.ts`（模态/暂停）、`VERTICAL_SLICE_UI_SPEC.md` §8、`src/systems/SaveSystem.ts` | 复用结算场景承载 R4 模态；规则时钟暂停；失败保留界面 | R4 选择模态（POWER/MEMORY/NONE 预览/确认/SAVING/失败重试）【新建】 | 不代选、不伪报保存、不覆盖原档 | Task 1.1 / 1.6 |

---

## 3. 切片工单与**有向无环**依赖（修正 SL01↔SL02、SL07 自依赖）

> `MapData/Device/Target` **schema 先定**（SL-00）；`SliceScene`（SL-01）与`四房间模板`（SL-02）只依赖 schema、**并行无环**；`Signal 基础`（SL-05）不依赖任何房间；`SL-11` 依赖 SL-05/06、`SL-12` 依赖 SL-09，均无回边。

| 工单 | 内容 | 直接依赖（无环） | 模块 |
|---|---|---|---|
| `SL-00` | `MapData`+`Device`+`Target` schema + 切片存档字段 schema（`src/types/index.ts` 扩展） | 无 | M2/M8 |
| `SL-01` | `SliceScene` + `World` 固定模板入口（不调 `MapGenerator`） | SL-00 | M1 |
| `SL-02` | 四房间模板数据（R0–R3，见 `LEVEL_DESIGN` 坐标） | SL-00 | M2 |
| `SL-03` | 相机边界 / Boss 缩放复用 | SL-01, SL-02 | M3 |
| `SL-04` | 切片状态门控（门/承重桥到 `SAFE_E(16.5,9.5)`/Boss 胜利；保 HP/位置；不借 portal） | SL-01, SL-02 | M4 |
| `SL-05` | Signal 基础：Scan/Jam/Decoy + Energy + 目标预览（Z/X/C） | SL-00（Signal 基础本身尚未实现） | M7 |
| `SL-06` | 设备状态机：门/relay/桥/敌人连接 + 手动两岸开关 | SL-02, SL-05 | M7 |
| `SL-07` | Enemy FSM 接入 Decoy/Jam 优先级（仅现有种类） | SL-05, SL-06 | M5 |
| `SL-08` | Boss 护盾中继器（维护封闭）+ 倍率 + `E_NOT_APPLICABLE` | SL-05, SL-06 | M6 |
| `SL-09` | 结尾选择持久化（POWER/MEMORY/NONE）+ 切片存档/检查点适配（现状 vs 未来） | SL-00, SL-06, ADR-06 | M8 |
| `SL-11` | ECHO 事件（ECHO_SCRIPT 表）+ Hint 调度（H0–H4、主动请求、去抖、权限裁剪） | SL-02, SL-05, SL-06 | M10 |
| `SL-12` | R4 选择 UI（POWER/MEMORY/NONE 预览/确认/SAVING/失败重试/读取回执） | SL-09 | M11 |
| `SL-10` | E2E / 单测 / 无提示试玩 fixture 与集成验收 | SL-03..SL-09, SL-11, SL-12 | 全部 |

```
SL-00 ─┬─ SL-01 ─┬─ SL-03 ─┐
       └─ SL-02 ─┼─ SL-04 ─┤
                 └─ SL-06 ─┼─ SL-07 ─┐
SL-05 ────────────┘         ├─ SL-08 ─┤
                            ├─ SL-11 ─┼─ SL-10
SL-09 ── SL-12 ─────────────┘         │
                                      ▼
                                   验收
```

---

## 4. 阶段验收（引用 TEST_SPEC；区分设计期自检 vs 运行期验收）

| 阶段/房间 | 验收判据（节选） | 引用 |
|---|---|---|
| R0 | 移动/射击/冲刺/首次 Scan；短战斗清 1 drone；开 `R0_D_EXIT` | `G2T-E-07` |
| R1 | 九步门链：`SEALED` 手动 `E_LINK_UNAVAILABLE`、Scan（−10，可选）、Jam 门接收器（−25）开 `JAMMED_OPEN`、到期不夹人、REF 不绕出口；`R1_SOURCE_TEST` 仅合法过门后安全侧、不门禁 | `G2T-E-01`、`G2T-M-01` |
| R2 | A 清 guard 建桥；B 留 guard + **单次 Jam** 抑制感知 + 建桥，运行期时限「单次 Jam 生效起 ≤6s 到 `SAFE_E(16.5,9.5)`」；桥 `UNSTABLE` 送最后岸点 −20HP、无次数上限；B 不被清怪门禁挡 | `G2T-E-02/E-03`、`G2T-M-02` |
| R3 | 零 Signal 可胜（每击≥2）；玩家在 `(20.5,7.5)` Scan/Jam relay 倍率 1.0（200 vs 400）；phase2 召唤不破坏普通路线；同 tick 双死失败优先 | `G2T-M-06/M-07`、`G2T-E-04/E-05` |
| R4 | POWER/MEMORY/NONE 不透明、幂等、`E_SAVE_FAILED` 可重试、下一局替换、不覆盖原档、不升 `SAVE_VERSION` | `G2T-E-06`、`G2T-S-01..08` |
| ECHO/Hint | 事件只引用已发生真实事件、四类信息裁剪、H0–H4（H3/H4 主动请求）、HUD 不替代 ECHO | `G2T-V-08`、`G2T-P-01..10`、`G2T-E-07` |
| 选择 UI | PREVIEW→CONFIRM→SAVING→COMMITTED/SAVE_FAILED；取消/重试/读取回执；不代选 | `G2T-E-06`、`G2T-S-06/07` |
| 全切片 | `typecheck`/`test`/`vite build`/`playwright` 全绿、`CONSOLE ERRORS:0`、无 `pageerror`；既有测试不回归 | — |

> **设计期自检 ≠ 运行期验收**：R2 的 5.597s<6s 与 R3 路径距离是只读脚本在**保守下界**上的算术/LOS 自检（`developer/geom_check_v2.py`），**不声称已验证可玩**；运行期须按 `G2T-E-*`/单测/无提示试玩实测。

---

## 5. 工期估算（假设，分阶段范围，含 Signal 未实现基础；标不确定性）

- **可玩时长**（体验流程 §1）：首次中心预算 **24 分钟**（4+5+6+7+2）；熟练 **9–14 分钟**；待试玩验证，**不强制等待凑时间**。
- **实现工期（熟练开发者，假设，含 Signal 尚未实现基础）**：

| 阶段 | 内容 | 人日（范围） |
|---|---|---|
| A | SL-00/01/02/03/04（模板/SliceScene/渲染/状态门控） | 4–6 |
| B | SL-05（Signal 基础 Scan/Jam/Decoy/Energy + 预览；**当前完全未实现，按新建计**） | 5–7 |
| C | SL-06/07/08（设备状态机/Enemy FSM/Boss 护盾） | 4–6 |
| D | SL-09（结尾选择 + 切片存档/检查点适配） | 2–3 |
| F | SL-11（ECHO 事件 + Hint 调度） | 2–3 |
| G | SL-12（R4 选择 UI + 保存反馈） | 1–2 |
| E | SL-10（E2E/单测/无提示试玩 + 集成） | 2–4 |
| **合计** | — | **20–31 人日（假设，±50% 不确定性）** |

> 算术一致（按表序 A+B+C+D+F+G+E）：低 4+5+4+2+2+1+2=20；高 6+7+6+3+3+2+4=31。**Signal 基础未实现**是最大不确定项（B 阶段）；ECHO/Hint 与选择 UI 的单列工期已计入（F/G）。旧 PHASE 0–2 与内容任务**不全部强作切片前置**，仅按自身节奏复用/并行。

---

## 6. ADR 优先级 / 阻断项

| ADR/决策 | 状态 | 优先级 | 对切片的阻断 |
|---|---|---|---|
| `ADR-10` 坐标/半径单位 | 建议（历史项，已按基线处理） | 高 | 坐标铁律前提；不重复造 |
| `ADR-08` 确定性（固定 tick） | 建议 | 高 | 未收敛则 E2E/回放不可复现（`G2T-C-09`、`G2T-S-03`） |
| `ADR-06` 切片存档命名空间/迁移 | 待定 | 高 | `SL-09` 前必须定 |
| `ADR-01` 事件通道 | 待定 | 中 | 影响 SL-05/06 提交 |
| `ADR-09` Local First/人类最高优先级 | 已定（原则） | — | 设计满足：Bridge 可选、无 AI 可通关 |
| `ADR-GDB-14`/`X-13` 手工关卡集成 | 待定 | 中 | 固定模板 vs 随机 `MapGenerator` 边界 |
| `Boss.summonDrones` 种子源（seededRNG） | **未来实施必须收敛（本轮不实现）** | 高（用户可复现要求） | 若留 `Math.random()` 非确定性会破坏同 seed 可复现；实施时必须收敛为种子源，不是低优先可任意延后 |

> **不新增 GDD-02 冻结**：参数、手动开关、D7 内容、Energy 单位/暂停计时仍 `建议冻结`/`原型调参初值`。

---

## 7. 建议坐标修正（终稿见关卡文档；外部 layout_contract 仅证据、非正式依赖）

1. R2 改用 Lead 推荐 **26×14**：西地板 `x1..9`、东地板 `x16..24`、chasm `x10..15`、桥覆盖 `x10..15,y8..10`（**6×3**）；入口 `(2.5,10.5)`、单 guard `(5.5,6.5)`、near `(8.5,9.5)`、far `(18.5,9.5)`、`SAFE_W(9.5,9.5)`/`SAFE_E(16.5,9.5)`；**单次 Jam**（入口→guard 5.0<6，单目标 25）；设计期上界 `5.597s<6s`；成功在东岸 `16.5` 触发。
2. R3：玩家阵地 `(20.5,7.5)`→relay `(20.5,4.5)` 3 格；具体路径 `(1.5,9.5)→(1.5,2.5)→(20.5,2.5)→(20.5,7.5)`（cell 可走、距 Boss 中心最小 7.0>3）；**Scan 由玩家发出**，不用 Boss→relay 反证。
3. 全局偏移 R0(0,0)/R1(0,14)/R2(0,30)/R3(0,46)；运行时各自加载 `MapData`。
4. 敌人仅现有种类：R0/R2 `drone`；R3 `boss_warden`（phase2 可能召唤 drone）。

---

## 8. 边界声明

- 本文件与 `VERTICAL_SLICE_LEVEL_DESIGN.md` 为 GDD-03 设计计划（非实现）；提案不升批准、设计不冒实测。
- 不引入新 `RoomKind`、不新增敌人种类、不新增第五类可操纵目标；不把 `MapGenerator` 随机地图当切片谜题来源；**过房用切片状态门控，不借 `World.placePortal` 绕谜题，不 reset 满血**。
- 数值/细则沿用 RER/VSCC 的 `建议冻结`/`原型调参初值`；D7 内容、切片存档迁移、`R1_SOURCE_TEST` 等仍为候选/待 ADR/签核。
- R2/R3 几何为**设计期算术/LOS 自检**（`developer/geom_check_v2.py`，保守下界），**不是可玩证明**；运行期须 `G2T-E-*`/单测/无提示试玩复核。外部 `layout_contract.md` 仅证据，非正式文档依赖。
