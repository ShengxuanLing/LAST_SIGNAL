# LAST SIGNAL 0.2.0 — 架构决策记录（ADR 集合）

> 项目 `D:/Project/LAST_SIGNAL` · 当前 `0.1.0` → 计划 `0.2.0` · Vite 5 + TypeScript 5 + Phaser 3.90（`Phaser.CANVAS`）
> 愿景：*A Game for Humans and Agents*。
> 本文件是 **0.2.0 Technical Design & Architecture Audit** 的 6 个设计文档之一，为关键架构决策记录（ADR）集合。
> 统一事实基座：前置审计 `FACTS.md`（§4.1 / §4.5 / §4.8 / §6 / §7 全部读完；阶段编号按 §7.1、术语按 §7.3 / §7.4、7 个必答问题结论按 §7.5、格式按 §7.6）。
> 本文件所有现状陈述均已逐文件复核真实源码，并额外用只读 `grep` / `git status` 核对；**未执行任何构建、测试、安装依赖或写入项目目录的操作**。
> 所有 `0.2.0` 条目均为**设计提案**，不是 `0.1.0` 已实现功能；本文件不虚构任何现有文件、类、函数或测试。

---

## 0. 约定、边界与统一口径

### 0.1 授权边界（逐字声明）

**本阶段只完成设计审计，未授权实现；Git 初始化属 PHASE 0 Task 0.1，本阶段未授权，需用户确认后执行**。

- 本阶段唯一交付物为 `docs/` 下 6 个新建设计文档；本文只写自身，不写 6 个文档之外的任何文件；不改源码、不装依赖、不初始化 Git、不提交 commit。
- 明确禁止（本文件也不得要求本阶段执行）：修改游戏源码、修改 `docs/STYLE_GUIDE.md`、写 6 个文档之外的任何文件、写项目 `dist/` / `test-results/` / `tests/screens/` / `node_modules/`、安装依赖、删除文件、初始化 Git、创建 `.gitignore`、提交 commit。
- 本文件与同批次设计文档一样，**不新增任何消费者、不新增任何 Signal / Agent / 存档 / 分包代码**；所有 `【需扩展】` / `【需新建】` 仅为后续阶段提案位置。

### 0.2 阶段编号与版本节奏（严格按 FACTS §7.1）

| 阶段 | 名称 | 与本 ADR 集合的关系 | 版本节奏 |
|---|---|---|---|
| PHASE 0 | 工程基线 | Git 初始化（Task 0.1，**本阶段未授权**）、CI/脚本与基线回归固化、坐标/半径/屏震根因修复、生产包分包 | `0.2.0-alpha` = PHASE 0–1 |
| PHASE 1 | 可玩闭环与内容深度 | 真实读档与局内快照、首房到 Boss 胜利 E2E 验收、房间/武器/升级差异化、世界观 | `0.2.0-alpha` = PHASE 0–1 |
| **PHASE 2** | **Signal 系统核心** | Signal 数据模型、确定性传播/falloff、Scan/Jam/Decoy、Signal Energy、敌人感知接入 FSM | `0.2.0-beta` = PHASE 2 |
| **PHASE 3** | **Agent Bridge 与本机 Harness 接入** | Local WebSocket Bridge、独立 Node stdio MCP Server、Observation/Action API、协议与安全 | `0.2.0-rc` = PHASE 3–4 |
| **PHASE 4** | **Human–Agent Co-op** | Mode A/B/C、Input Arbitration、AI 状态面板、Physical Core / Signal Core 权限分工 | `0.2.0-rc` = PHASE 3–4 |
| PHASE 5 | 0.2.0 集成、加固与发布验收 | 性能/分包、回归矩阵、文档、发布验收 | `0.2.0` = PHASE 5 |

- 具体日期，以及「若用户已有总计划书中的既定 PHASE 定义，请以总计划书原文为准重新对齐阶段编号」：见 `TBD — Requires User Decision`（TBD-23 一并列出）。

### 0.3 两套状态标注（本文件统一用法）

| 维度 | 取值 | 用途 |
|---|---|---|
| ADR 的 `状态` 字段（决策成熟度） | `已定` / `建议` / `待定` | 每条 ADR 状态表首列，三选一；`已定` 仅用于原则性硬约束，`待定` 表示最终结论必须由用户拍板 |
| 统一状态标签（FACTS §6.3 / §7.6） | `【已实现】` / `【需扩展】` / `【需新建】` / `TBD — Requires User Decision` | 现状一律 `【已实现】`；在已有文件上加能力 `【需扩展】`；全新文件/进程 `【需新建】`；未确认项逐字标 `TBD — Requires User Decision` 并写明具体问题 |

> 说明：`已定/建议/待定` 是 ADR 决策成熟度，**不是**状态标签；全文所有模块与结论标注只用上表第二行的 4 个统一标签，不引入其它括号标签。

### 0.4 统一术语（逐字采用 FACTS §7.3 / §7.4）

- 三层架构：**Game Client / Local Agent Bridge / Harness Adapter**。
- 链路：`Phaser Game <-> Local WebSocket Bridge <-> MCP Server <-> Local Harness`。
- **MCP Server 为本地独立 Node stdio 进程**；浏览器 WebSocket **只连 localhost**；双通道 = **MCP stdio + WebSocket**。
- 协议：JSON 消息 + schema 验证；统一候选消息类型：`hello / observation / action_request / action_result / event / error / takeover / ping`。
- Observation API（严格 6 个）：`observe_state`、`observe_entities`、`observe_map`、`observe_signals`、`observe_inventory`、`observe_events`。
- Action API（严格 9 个）：`action_move`、`action_aim`、`action_fire`、`action_dash`、`action_reload`、`action_switch_weapon`、`action_interact`、`action_signal`、`action_wait`。
- 安全铁律：**不把 MCP 塞进 Phaser 核心**；**不允许 Agent 直接操作 Phaser 内部对象**；**不暴露隐藏信息**；**不把 API Key 放前端**。
- 三种模式：**Mode A Human / Mode B Agent / Mode C Co-op**；**Mode A 为默认且无 AI 时可独立运行**；控制权铁律 **人类最高优先级**。
- AI 状态面板 7 种状态：`OFFLINE`、`OBSERVING`、`PLANNING`、`EXECUTING`、`SIGNALING`、`YIELDED`、`FAULT`。
- **Physical Core / Signal Core 只做权限分工，不做人格**；**没有 AI 时游戏必须正常运行**。
- **坐标铁律**：所有 Signal 距离、传播、`falloff`、半径、感知阈值一律使用 `wx/wy` 网格坐标（tile-world units），与 `World.worldToScreen()` / `screenToWorld()` / `tileAt()` / `isWalkable()` 同一坐标系；**禁止混用屏幕像素、等距投影坐标或 `worldToScreen()` 的输出**。

### 0.5 总计划书 7 个必答问题的统一结论（FACTS §7.5，与同批次 5 个文档不矛盾）

| 问题 | 结论（按 §7.5） | 对应 ADR |
|---|---|---|
| 1. 哪些模块复用 / 扩展 / 新建 | 复用 `src/core/eventbus.ts`、`src/core/iso.ts`、`src/core/random.ts`、`src/world/World.ts`、`src/config/*`、`src/types/index.ts`、`src/systems/SaveSystem.ts` 与现有 4 个测试文件；扩展 `src/entities/Enemy.ts`（`detects()`/FSM）、`src/entities/Player.ts`（输入层）、`src/world/World.ts`（`WorldCallbacks`）、`src/scenes/GameScene.ts`（HUD/状态面板）、`src/config/*`；新建 `src/systems/signal/`、Agent Bridge 客户端层、独立 Node MCP Server 进程、测试客户端、Signal 专属测试房间与新测试文件 | ADR-01 / 02 / 03 / 05 / 08 |
| 2. Signal 如何接 FSM | 以 `Enemy.detects()` 为唯一感知入口引入信号强度/阈值，复用 `detect / stun / reposition` 状态与 `data.targetId / stateTimer / stunTimer`；不改动 Phaser 对象模型（数值与公式以 `SIGNAL_SYSTEM_DESIGN.md` 为准） | ADR-02 / 10 |
| 3. Agent 如何不直接操作 Phaser 对象 | Action API 只发 DTO → Local Bridge → 落到 `Player` 输入层（与人类输入同层）；Observation 由公开 DTO 白名单生成，不序列化 `Phaser.Scene` / `World` | ADR-04 / 05 |
| 4. MCP 如何连本机 Harness | MCP Server 是本机独立 Node **stdio** 进程，由 Harness 启动；浏览器侧 WebSocket 仅连 localhost，Bridge 负责双向转发；Agent 凭据只在 Harness/MCP 侧 | ADR-03 / 07 |
| 5. 如何保证人类输入优先 | Input Arbitration 人类最高优先级、冲突即覆盖、人类输入立即触发 `takeover`、暂停/恢复/断线自动降级到 Mode A | ADR-04 / 09 |
| 6. 如何保证 AI 不拿隐藏信息 | Observation DTO 字段白名单 + schema 出参校验；不输出未探索房间、敌人内部计时/巡逻点/状态、RNG 内部状态、种子与存档内部字段 | ADR-05 |
| 7. 如何保证无 AI 也能玩 | Bridge 为可选旁路，`GameScene` / `World` / `Player` 对其零依赖；Mode A 默认；断线降级；既有 4 个测试文件无 Bridge 仍须通过 | ADR-09 |

### 0.6 ADR 索引

| 编号 | 标题 | 状态 | 阶段 |
|---|---|---|---|
| ADR-01 | 复用 `gameBus` / `WorldCallbacks` 还是新增 Signal 事件总线 | 待定 | PHASE 2 |
| ADR-02 | Signal 系统放 `src/systems/signal/` 还是复用现有目录 | 建议 | PHASE 2 |
| ADR-03 | Agent Bridge / MCP Server 为何是独立进程 | 建议 | PHASE 3 |
| ADR-04 | Input Arbitration 放在 `Player` 输入层还是新服务 | 建议 | PHASE 4 |
| ADR-05 | 观察数据为何由公开 DTO 生成而非序列化 Phaser Scene | 建议 | PHASE 3 |
| ADR-06 | 存档格式 v2 迁移策略 | 待定 | PHASE 1 |
| ADR-07 | MCP stdio + WebSocket 双通道、消息关联与背压 | 建议 | PHASE 3 |
| ADR-08 | 确定性核心、非确定性来源与可测试性 | 建议 | PHASE 0 / PHASE 2 |
| ADR-09 | Local First / Human Agency | 已定（原则） | 全局 |
| ADR-10 | 统一网格坐标 `wx/wy` 与单位遗留根因修复 | 建议 | PHASE 0 |
| ADR-11 | 生产包单 chunk 约 1.56 MB 与分包策略 | 建议 | PHASE 0 / PHASE 5 |
| ADR-12 | 无 Git 仓库与工程基线（PHASE 0 Task 0.1 未授权） | 待定 | PHASE 0 |

---

## ADR-01 复用 `gameBus` / `WorldCallbacks` 还是新增 Signal 事件总线

| 状态（ADR 成熟度） | 现状标签 | 提案标签 | 结论标记 |
|---|---|---|---|
| 待定 | `【已实现】` | `【需扩展】` / `【需新建】` | `TBD — Requires User Decision` |

### 背景（真实源码事实）

- `src/core/eventbus.ts`：`class EventBus` 私有成员 `handlers: Map<string, Set<Handler>>`、`queue`、`listening`；方法齐全：`on(type, handler): () => void`（返回 off）、`emit(type, payload?)`（复制 handler 集合迭代并 `try/catch` 打 `console.error`）、`emitDeferred(type, payload?)`（入队）、`flush(type)`（把已注册类型的队列事件 `emit` 出去，其余保留）、`has(type)`、`clear()`；导出单例 `export const gameBus = new EventBus()`。
- **只读 `grep` 复核**：`gameBus` 在整个 `src/` 与 `tests/` 中**仅定义处一次出现**（`src/core/eventbus.ts:71`），**没有任何文件 import、订阅或发布**；`emitDeferred` / `flush` 也没有任何外部调用者。`src/types/index.ts` 声明 `GameEventType`（`enemy-spawned` … `game-resumed`）与 `GameEvent { type, payload, tick }`，**同样没有任何使用点**。
- **当前真正的解耦机制是 `WorldCallbacks`**（`src/world/World.ts` 导出接口）：`onLevelUp(level)`、`onDeath()`、`onRoomCleared(room)`、`onRoomEntered(room)`、`onLoot(drop)`、`onStats(delta)`、`onBossWin()`；由 `src/scenes/GameScene.ts` 的 `create()` 构造该对象并传给 `new World(this, map, save, callbacks)`，其中 **`onLoot: () => {}` 是空实现**。`World` 里还声明了未使用的 `private roomClearedHandlers: Array<(r: RoomInfo) => void> = []` 与 `statsSnapshot()`（返回全 0）；这些是「可复用/待清理」点，**不是已有的 Signal 事件总线**。
- 其它真实事件通道：`src/entities/Boss.ts` 的 `this.world.scene.events.emit('boss-phase', this.phase)`；`src/world/WorldRenderer.ts` 的 `scene.events.on('prerender', _lightLock)`；`GameScene.create()` 的 `keydown-ESC` / `keydown-I` / `keydown-F` / `keydown-Q` / `keydown-E` 与 `pointerdown` / `pointerup`。

### 备选方案

- **方案 A 复用 `gameBus`**（`【需扩展】`）：扩充 `GameEventType` / `GameEvent` 增加 signal 事件名；用 `emit()` / `emitDeferred()` / `flush()` 发布；`GameEvent.tick` 承载逻辑 tick。代价：首次为 `gameBus` 引入消费者，必须定义订阅生命周期、暂停/场景切换时 `clear()` 时机、事件是否丢弃，以及 `emit()` 复制 `Set` 迭代下的固定顺序如何保证确定性重放。
- **方案 B 新增 Signal 专线**（`【需新建】`）：在 `src/systems/signal/`（提案路径，当前不存在）内置纯数据事件/快照通道；或（`【需扩展】`）给 `WorldCallbacks` 增加 signal 回调。代价：多一条与 `gameBus` 并存的通道，需明确谁负责重放日志与 PHASE 3 `observe_signals` 的出参白名单。
- **方案 C 混合**（`【需扩展】` + `【需新建】`）：`gameBus` 仅承载通用 UI/生命周期事件，Signal 传播用 `src/systems/signal/` 内纯数据序列；代价是两条通道的边界与优先级需要额外约定。

### 决策

- **倾向（仅为评估意见，不构成最终结论）**：优先评估「方案 A 复用 `gameBus` 作为通用事件通道」，理由是与 `FACTS §7.5` 第 1 问把 `src/core/eventbus.ts` 列为「可复用模块」的口径一致、新增通道最少；但 Signal 传播要求**逻辑 tick 上可确定性重放**，若 `emit()` 的即时分发与 handler 顺序、`clear()` 生命周期成本过高，则转方案 B 或 C。
- **最终结论保持 `TBD — Requires User Decision`**：本 ADR 与 `SIGNAL_SYSTEM_DESIGN.md` §13 一致，**不预设「复用」或「新建」的最终结论**；`FACTS §7.5` 的「可复用」不等于本决策已定。
- 无论选哪案，共同约束：① 本阶段不新增任何消费者、不修改源码；② 不得把 `gameBus` 描述为已有消费者；③ 当前解耦靠 `WorldCallbacks`；④ Signal 事件必须落在逻辑 tick 上并可确定性重放；⑤ 与 PHASE 3 `observe_signals` / `action_signal` 口径对齐，不向 Agent 暴露隐藏信息与 Phaser 内部对象。

### 理由

避免虚构「已有的 Signal 事件总线」；`WorldCallbacks` 是真实解耦点，任何新通道都必须以它为接入基准。确定性传播与重放要求事件顺序可复现，而 `EventBus.emit()` 迭代 `Set` 副本、`flush()` 只投递已注册类型，这些语义必须在选定方案后显式定义，否则会与 ADR-08 的确定性目标冲突。

### 影响范围

`src/core/eventbus.ts`（`【需扩展】`，可选）、`src/types/index.ts`（`【需扩展】`，`GameEventType` / `GameEvent`）、`src/world/World.ts`（`【需扩展】`，`WorldCallbacks`）、`src/scenes/GameScene.ts`（`【需扩展】`，订阅生命周期）、`src/systems/signal/`（`【需新建】`，提案路径）、PHASE 3 的 `observe_events` / `observe_signals` 出参白名单。现状 4 个测试文件不得因本决策改变断言。

### 关联文档/阶段

`SIGNAL_SYSTEM_DESIGN.md`（PHASE 2，§13「事件通道讨论」明确与本 ADR 一致、结论不预设）；`AGENT_BRIDGE_ARCHITECTURE.md`（PHASE 3，§9.2 把 `gameBus` 作为 `observe_events` 可选通道）；`FACTS §4.5` / `§6` / `§7.5` 第 1、2 问；阶段 = **PHASE 2**（Signal 系统核心）。

### 待确认事项

- `TBD — Requires User Decision`（TBD-01）：**需用户决定**最终复用 `gameBus`（并扩充 `GameEventType` / `GameEvent`）还是新增 Signal 专线（`src/systems/signal/` 内通道，或扩展 `WorldCallbacks`）；若复用，请一并决定订阅生命周期与 `EventBus.clear()` 时机、暂停/场景切换时事件是否丢弃、`emit()` 的 handler 顺序如何保证确定性重放、`GameEvent.tick` 是否就是逻辑 tick、以及该通道如何向 `observe_signals` 提供公开 DTO 白名单。
- `TBD — Requires User Decision`（TBD-02）：**需用户决定**是否扩充 `signal` 事件名、`GameEventType` 最终枚举与命名（在现有 15 个字面量基础上）——具体包括：新增哪些 signal 事件名及其命名前缀/字面量拼写与顺序、是否调整或保留现有 15 个字面量、`GameEvent.tick` / `payload` 是否随之变更、新增事件名如何进入 PHASE 3 `observe_events` / `observe_signals` 的公开 DTO 出参白名单；事件通道复用 `gameBus` 还是新建专线仍由 TBD-01 决定，本项不预设。

---

## ADR-02 Signal 系统放 `src/systems/signal/` 还是复用现有目录

| 状态（ADR 成熟度） | 现状标签 | 提案标签 | 结论标记 |
|---|---|---|---|
| 建议 | `【已实现】` | `【需新建】` / `【需扩展】` | `TBD — Requires User Decision` |

### 背景（真实源码事实）

- **只读目录复核**：`src/systems/` 当前**只有** `SaveSystem.ts` 与 `AudioSystem.ts`；`src/core/` 当前为 `iso.ts`、`random.ts`、`eventbus.ts`、`GraphicsFactory.ts`（另有一个测试文件 `runtime.test.ts`）。`src/config/` 为 6 个数据驱动配置文件，`src/world/` 为 4 个文件，`src/types/index.ts` 是唯一共享领域类型文件，`src/entities/` 为 `Player.ts` / `Enemy.ts` / `Boss.ts`。
- `src/systems/signal/`、`src/systems/agent/`、`src/bridge/`、`src/agent/`、`src/mcp/`、`server/`、`tools/`、`src/signal/` **均不存在**（FACTS §6.2）；`SignalSystem`、`SignalBus`、`SignalManager`、`SignalComponent`、`SIGNALS`、`SIGNAL_TYPES`、`SIGNAL_ENERGY` 等类名/配置也**均不存在**。
- 真实可复用基础：`src/core/random.ts` 的 `RNG`（Mulberry32）、`src/core/iso.ts` 的 `IsoMath` / `isoToScreen()` / `screenToIso()`、`src/world/World.ts` 的 `tileAt()` / `isWalkable()` / `worldToScreen()` / `screenToWorld()` / `WorldCallbacks` / `currentRoom()`、`src/entities/Enemy.ts` 的 `detects()` / `stateMachine()` / `stun()`、`src/config/weapons.ts` 的 `WEAPONS` 与 `src/entities/Player.ts` 的 `tryFire()`。
- `vitest.config.ts` 的 `include: ['src/**/*.test.ts']`、`environment: 'node'`；`src/core/runtime.test.ts` 是现有纯逻辑单测范例。

### 备选方案

- **方案 A 新目录 `src/systems/signal/`**（`【需新建】`）：Signal 数据模型、确定性传播/falloff、`Scan` / `Jam` / `Decoy`、Signal Energy、纯数据事件通道与 `*.test.ts` 全部集中在此；共享类型在 `src/types/index.ts`（`【需扩展】`）或该目录内的独立类型文件（`【需新建】`）二选一。
- **方案 B 复用现有目录**（`【需扩展】`）：把 Signal 逻辑塞进 `src/world/World.ts` / `src/core/` 现有文件，或把类型全放进 `src/types/index.ts`。代价：`World.ts` 已有 605 行且同时承担坐标、碰撞、房间、弹丸、掉落、FX、相机、存档提交；`src/core/` 定位是无状态工具（iso/random/eventbus/GraphicsFactory），塞入领域状态会破坏现有职责边界。
- **方案 C 混合**（`【需新建】` + `【需扩展】`）：新目录放纯逻辑与纯数据，`src/config/*` 放 Signal 配置，`src/types/index.ts` 放共享类型，FSM 集成点落在 `src/entities/Enemy.ts` 的真实名字上。

### 决策

- **建议采用方案 A+C 的组合**（`【需新建】` `src/systems/signal/` 提案路径 + `【需扩展】` `src/types/index.ts` / `src/config/*` / `src/entities/Enemy.ts`），但**最终目录约定与类型落点为 `TBD — Requires User Decision`**（TBD-03、TBD-04）。
- **模块边界约定（提案）**：`src/systems/signal/` 内的纯逻辑模块只依赖 `src/types/index.ts`、`src/core/random.ts`（`RNG`）与 `World` 的只读判定（`tileAt()` / `isWalkable()`），**不得 import Phaser**；与 Phaser 的耦合只经由 `WorldCallbacks` 与 `Enemy.detects()` 等真实集成点；所有 Signal 距离/传播/falloff/半径/感知阈值一律用 `wx/wy` 网格坐标（FACTS §7.2 坐标铁律）；纯逻辑必须能在 `vitest` 的 node 环境下单测。
- 本 ADR **不定义** Signal 数据模型字段、7 类信号、Signal Energy 与三大能力参数，一律以 `SIGNAL_SYSTEM_DESIGN.md`（PHASE 2）为准，避免重复定义造成口径漂移。

### 理由

`src/systems/` 现有两个文件都是「系统级、与场景解耦」模块，新增 Signal 系统与该目录定位一致；`src/core/` 是无状态工具层，不适合承载领域状态；`World.ts` 已承担过多职责，继续堆叠会放大 ADR-10 的坐标/单位遗留风险。纯逻辑集中也便于 ADR-08 要求的确定性单测与回放。

### 影响范围

`src/systems/signal/`（`【需新建】`，提案路径，含 `【需新建】` 测试文件）、`src/types/index.ts`（`【需扩展】`）、`src/config/*`（`【需扩展】`）、`src/entities/Enemy.ts` 的 `detects()` / `data.stateTimer` / `data.targetId` / `data.stunTimer` / `data.spawnRoom` / `stateMachine()`（`【需扩展】`）、`src/world/World.ts` 的 `WorldCallbacks.onRoomEntered` / `onRoomCleared`（`【需扩展】`）、`src/scenes/GameScene.ts`（`【需扩展】`，HUD/状态面板）。

### 关联文档/阶段

`SIGNAL_SYSTEM_DESIGN.md`（PHASE 2，§3 类型落点备选、§12 测试文件提案）；`AGENT_BRIDGE_ARCHITECTURE.md`（PHASE 3，`observe_signals` / `action_signal` 依赖 PHASE 2）；`FACTS §3` / `§6.2` / `§7.2` / `§7.5` 第 1、2 问；阶段 = **PHASE 2**。

### 待确认事项

- `TBD — Requires User Decision`（TBD-03）：**需用户决定**是否采用 `src/systems/signal/` 作为提案路径；共享类型声明放 `src/types/index.ts` 还是该目录内新建类型文件；`src/systems/signal/` 是否允许 import `World` / Phaser（默认禁止），以及 Signal 配置放 `src/config/*` 还是目录内自带配置。
- `TBD — Requires User Decision`（TBD-04）：**需用户决定** Signal 测试文件是否采用 `src/systems/signal/*.test.ts` 与 `tests/signal.spec.ts` 命名、是否新增 Signal 专属配置与测试房间入口、以及运行时探针是扩展 `tests/audit.spec.ts` 的 `worldState(page)` 还是新建 `signalState(page)`。

---

## ADR-03 Agent Bridge / MCP Server 为何是独立进程

| 状态（ADR 成熟度） | 现状标签 | 提案标签 | 结论标记 |
|---|---|---|---|
| 建议 | `【已实现】` | `【需新建】` / `【需扩展】` | `TBD — Requires User Decision` |

### 背景（真实源码事实）

- `index.html`：`#game` + `#loader`，全局 `window.error` / `unhandledrejection` 监听打 `console.error`，引入 `<script type="module" src="/src/main.ts">`，内联 1280×720 深色样式；**无 WebSocket / MCP / Agent 代码，无外部 CDN 资源**。
- `src/main.ts`：`new Phaser.Game({ type: Phaser.CANVAS, width: 1280, height: 720, parent: 'game', backgroundColor: '#05070c', scene: [BootScene, PreloadScene, MainMenuScene, GameScene, LevelUpScene, GameOverScene, PauseScene], pixelArt: true, dom: { createContainer: true } })`；`export const game`、`export const saveSystem = new SaveSystem()`、`;(window as any).__game = game;`。
- `vite.config.ts`：`build.outDir:'dist'`、`sourcemap:false`、`target:'es2020'`、`server.port:5173`，**无代理、无中间件、无 Node 服务端入口**；`package.json` 依赖只有 `phaser ^3.90.0`，devDependencies 为 `vite` / `vitest` / `typescript` / `@playwright/test` / `jsdom` / `@types/node`。
- 只读 `grep` 复核：`src/` 与 `tests/` 中**不存在**任何 WebSocket / MCP / Agent / Harness / stdio 代码；`src/bridge/`、`src/agent/`、`src/mcp/`、`server/`、`tools/` 等目录不存在（FACTS §5 缺口 6、§6.2）。

### 备选方案

- **方案 A 独立进程（建议）**：`MCP Server` 为**本地独立 Node stdio 进程**，由本机 Harness 以 stdio 启动/管理；浏览器侧只保留一个可选 localhost WebSocket 客户端；三层架构 **Game Client / Local Agent Bridge / Harness Adapter**，链路 `Phaser Game <-> Local WebSocket Bridge <-> MCP Server <-> Local Harness`。
- **方案 B MCP 内嵌 Phaser 核心**：把 MCP/stdio 逻辑放进 `src/main.ts` / `GameScene`。**不采纳**：浏览器没有 stdio，且直接违反安全铁律「**不把 MCP 塞进 Phaser 核心**」，会把进程管理、凭据、`Phaser.Game` 生命周期耦合进渲染主循环，破坏「无 AI 也能玩」的零依赖前提。
- **方案 C MCP 作为 Vite 中间件 / 浏览器扩展**：**不采纳**：`vite.config.ts` 无服务端扩展点，且会把 localhost 端口、凭据与 dev server 生命周期耦合，生产构建（`base:'./'` 静态产物）无法承载。

### 决策

- **建议采用方案 A**（`【需新建】` 独立 Node stdio MCP Server 进程 + `【需新建】` 浏览器侧 Bridge 客户端层 + `【需扩展】` `Player` 输入层 / `WorldCallbacks` / `GameScene` 公开 DTO 出口）。
- **不把 MCP 塞进 Phaser 核心**；`GameScene` / `World` / `Player` 对 Bridge **零依赖**，不得 import Bridge / MCP 模块；Bridge 是**可选旁路**。
- WebSocket **只连 localhost**（`127.0.0.1` / `::1`），握手不携带任何 API Key；凭据只存在于 `Local Harness` 与 `MCP Server` 的 Node 进程；`stdout` 专用于 MCP 协议帧，日志走 `stderr`。
- 进程/信任边界：① 浏览器标签页（不可信）、② 独立 Node `MCP Server`（策略执行点、唯一协议转换与双向 schema 校验处）、③ 本机 Harness（凭据与决策侧）；三者互不共享内存，`Phaser.Game` / `GameScene` / `World` / `Player` 只存在于 ①。
- 生命周期与崩溃策略、启动命令与落盘路径为 `TBD — Requires User Decision`（TBD-05、TBD-06）。

### 理由

- **进程隔离**：浏览器无法承载 stdio 进程模型；独立进程使 MCP Server 崩溃、重启、stdio 关闭与浏览器刷新互不影响——刷新只重建 WebSocket 连接，不重启 MCP Server、不丢失 Agent 侧会话。
- **信任边界**：浏览器侧一切报文视为外部输入，须经 schema 入参 → 动作白名单 → 速率限制 → 状态机 → 输入层意图；Observation 出参须经 DTO 白名单 → 出参 schema → 隐藏字段黑名单。
- **API Key 不放前端**：`index.html` / Vite bundle / WebSocket 握手 / Observation DTO / `error` 消息 / `console.error`（`index.html` 现有全局监听）均不得出现密钥、令牌或环境变量。
- **崩溃不影响游戏**：断线 / 超时 / 版本不兼容 → 清除输入意图、进行中动作置 `cancelled`、降级到 **Mode A Human**，游戏继续由人类输入驱动（对齐 `FACTS §7.5` 第 5、7 问）。
- 与 `AGENT_BRIDGE_ARCHITECTURE.md` §1.4 / §2 / §3.1 / §11 结论完全一致，不矛盾。

### 影响范围

`【需新建】` 浏览器侧 Bridge 客户端层（`src/bridge/` 等提案路径）、`【需新建】` 独立 Node MCP Server 进程（`server/` / `tools/` 等提案路径）、`【需新建】` 独立测试客户端；`【需扩展】` `src/entities/Player.ts`（输入层）、`src/world/World.ts`（`WorldCallbacks` 只读投影）、`src/scenes/GameScene.ts`（公开 DTO 出口）、`src/types/index.ts`（公开 DTO 类型）。`src/main.ts` / `index.html` / `vite.config.ts` 保持无 Bridge 硬依赖。

### 关联文档/阶段

`AGENT_BRIDGE_ARCHITECTURE.md`（PHASE 3，§1 三层架构、§2 独立进程、§8 安全铁律、§11 无 AI 也能玩）；`HUMAN_AGENT_COOP_DESIGN.md`（PHASE 4，§9.2 引用同一前提）；`FACTS §7.3` / `§7.5` 第 3、4、7 问；阶段 = **PHASE 3**。

### 待确认事项

- `TBD — Requires User Decision`（TBD-05）：**需用户决定**是否允许把三进程合并为「Harness 内嵌 MCP Server」的变体；若允许，请重新界定 stdio 生命周期与「与浏览器进程隔离」的保证。
- `TBD — Requires User Decision`（TBD-06）：**需用户决定** MCP Server 的启动命令、Node 运行时与工作目录、单实例/多实例约束、崩溃是否自动重启、stdio 关闭与 WebSocket 关闭的先后顺序、日志落盘位置与保留期，以及是否允许 `0.2.0` 引入新的 Node 侧包（本阶段不安装依赖、不创建目录）。

---

## ADR-04 Input Arbitration 放在 `Player` 输入层还是新服务

| 状态（ADR 成熟度） | 现状标签 | 提案标签 | 结论标记 |
|---|---|---|---|
| 建议 | `【已实现】` | `【需扩展】` / `【需新建】` | `TBD — Requires User Decision` |

### 背景（真实源码事实）

- `src/entities/Player.ts`：`registerInput(keys, cursors)` 保存键对象；`updateKeys()` 读 `k.W.isDown` / `k.S.isDown` / `k.A.isDown` / `k.D.isDown` 填 `this.input.{up,down,left,right}`；`setFireHeld(v)` / `fireHeld()` 驱动 `tryFire()`；`aimFromPointer(pointer)` 经 `cam.getWorldPoint(pointer.x, pointer.y)` → `world.screenToWorld(wp.x, wp.y)` → 私有 `aimYaw = Math.atan2(...)`；`update(dt)` 做归一化、`IsoMath` 逆变换、`World.isWalkable()` 轴分离碰撞、SPACE 冲刺、装填计时。
- `src/world/World.ts` 构造函数通过 `keyboard.addKey` / `createKey` 注册 W/A/S/D/SPACE 并 `this.player.registerInput(keys, cursors)`。
- `src/scenes/GameScene.ts` 的 `create()` 另注册 `addKey('SPACE')`、空 `keydown_SPACE`、`keydown-ESC`（`onPause()`）、`keydown-I`（`toggleInventory()`）、`keydown-F`（`this.world.tryInteract(this.world.player)`）、`keydown-Q` / `keydown-E`（`private switchWeapon(dir)`）、`pointerdown` / `pointerup`（`p.button === 0` 写 `this.fireHeld`）；`update()` 首行 `if (this.paused) return;`，随后 `world.update(dt)`、`player.aimFromPointer(ptr)`、`player.setFireHeld(this.fireHeld)`。
- 只读复核：**`Player` 类中没有 `switchWeapon()` 方法**，真实实现是 `GameScene.switchWeapon(dir)`（`private`）；`InputArbitrator` 等类名在源码中不存在（FACTS §6.2）；当前没有装填按键（`Player.update()` 自动递减 `WeaponState.reloadTimer`）；鼠标右键无绑定。

### 备选方案

- **方案 A `Player` 输入层内仲裁（建议）**（`【需扩展】`）：在 `registerInput()` / `updateKeys()` / `setFireHeld()` / `aimFromPointer()` 汇聚的**同一输入层**新增「人类输入槽 + Agent 输入槽 + 每帧合并器」，Agent 的 `action_*` DTO 经 PHASE 3 Bridge 只写入该层的 Agent 槽，合并结果才写入 `this.input` / `_fireHeld` / `aimYaw`，再由既有 `Player.update(dt)` 消费。
- **方案 B 独立仲裁新服务**（`【需新建】`）：由独立模块集中持有优先级表、动作队列、去抖计时、心跳与接管状态机，向 `Player` 输入层输出合并后的输入。代价：若 `GameScene` / `World` 显式依赖该服务，会破坏「Bridge 可选旁路、零依赖」与「没有 AI 时游戏必须正常运行」；若做成可选旁路但仍需在 `Player` 内保留最薄合并点，会产生**两个写入面**，与「同一输入层」冲突；并增加暂停/升级/结算状态同步点。

### 决策

- **结论（跨文档统一口径）**：`Player` 输入层合并器 = `【需扩展】`；独立 `InputArbitrator` / 新服务仅为备选且 `TBD — Requires User Decision`。据此**建议采用方案 A**，与 `HUMAN_AGENT_COOP_DESIGN.md` §4 / `PROJECT_ROADMAP.md` / `IMPLEMENTATION_TASKS.md` Task 4.2 完全一致；方案 B 是否提取、何时提取由用户拍板（TBD-07）。
- **人类最高优先级**：同帧冲突时人类有效输入直接覆盖该通道的 Agent 值，未被人类占用的通道才允许 Agent 值通过；**人类「无输入」不等于「释放委托」**，释放须靠显式恢复或超时自动恢复。
- **同层注入**：Agent 不直接操作 Phaser 内部对象，不得直写 `wx/wy`、`sprite`、`data.weaponKey`、`World.enemies`、`Phaser.GameObjects.*`；Action DTO 只转换为与人类同层的输入意图。对齐 `FACTS §7.5` 第 3 问（W3）与第 5 问。
- 人类任意有效输入立即触发 `takeover`，在途动作置 `preempted`、清空 Agent 输入槽、AI 状态面板进入 `YIELDED`；暂停（`GameScene.paused` 早退）、`LevelUpScene`、`GameOverScene` 期间冻结 Agent 提交；断线 / `FAULT` 自动降级到 **Mode A Human**。
- 暂停 / 恢复 / `takeover` / 模式切换 / `QUIT TO MENU` 属人类独占，**永不委托**；`Physical Core / Signal Core` 只做权限分工、不做人格，二者输出都必须经过同一个 Input Arbitration。

### 理由

① 单一写入点，避免人类与 Agent 双写 `input` / `_fireHeld` / `aimYaw`；② 与现有 `GameScene.update()` → `World.update(dt)` → `Player.update(dt)` 帧循环一致，无需改动 `World.update()`；③ 无 AI 时该层自然退化为纯人类输入，`GameScene` / `World` / `Player` 对 Bridge 零依赖；④ `GameScene.paused` 早退直接冻结全部输入，无需额外开关；⑤ PHASE 4 首个可运行版本改动最小，符合「只做设计、不启动大规模功能开发」的边界。

### 影响范围

`src/entities/Player.ts`（`【需扩展】`）、`src/scenes/GameScene.ts`（`【需扩展】`，`create()` 输入注册与 HUD 状态面板、`paused` 链路）、`src/world/World.ts`（`【需扩展】`，`tryInteract()` 语义不改）、`src/types/index.ts`（`【需扩展】`，意图类型）；`【需新建】` 可选旁路的注入点。既有 4 个测试文件在无 Agent 情况下必须继续通过：`tests/audit.spec.ts`（2 tests）、`tests/canvas.spec.ts`（1 test）、`tests/gameplay.spec.ts`（1 test）、`src/core/runtime.test.ts`（7 tests）。

### 关联文档/阶段

`HUMAN_AGENT_COOP_DESIGN.md`（PHASE 4，§4 Input Arbitration、§3 权限分工、§8 无 AI 也能玩）；`AGENT_BRIDGE_ARCHITECTURE.md`（PHASE 3，§6 Action API 落到 `Player` 输入层、§7 人类接管）；`FACTS §4.2` / `§4.9` / `§7.4` / `§7.5` 第 3、5、7 问；阶段 = **PHASE 4**。

### 待确认事项

- `TBD — Requires User Decision`（TBD-07）：**需用户决定**是否/何时把仲裁提取为独立新服务；以及 `action_switch_weapon` 的落点——是在 `Player` 输入层新增公开意图入口，还是复用 `GameScene.switchWeapon(dir)` 的现有语义（任务描述中「`Player.switchWeapon()`」与源码不符，需按源码统一口径）。
- `TBD — Requires User Decision`（TBD-08）：**需用户决定**「人类任意有效输入」的判定（每帧 `aimFromPointer()` 的被动指针位移是否计入）、去抖毫秒数、单动作超时与动作 ID 生命周期、接管后自动恢复委托的条件与时长、`takeover` 由浏览器侧还是 Harness 侧发起为准、以及 Agent 是否允许请求暂停/恢复（对应 `ESC` / `I`）。

---

## ADR-05 观察数据为何由公开 DTO 生成而非序列化 Phaser Scene

| 状态（ADR 成熟度） | 现状标签 | 提案标签 | 结论标记 |
|---|---|---|---|
| 建议 | `【已实现】` | `【需新建】` / `【需扩展】` | `TBD — Requires User Decision` |

### 背景（真实源码事实）

- `src/scenes/GameScene.ts` 持有 `world!: World`、`fireHeld`、`paused`、`seed = 0`、私有 `runStart` / `enemiesKilled` / `itemsCollected` / `damageDealt` 与全部 HUD 对象（`hpBar` / `txtHp` / `txtStats` / `minimap` / `timer` 等）；`create(config: {seed?, isNewRun?})` 里 `this.seed = (config?.seed ?? Math.floor(Math.random() * 1e9)) >>> 0`。
- `src/world/World.ts` 持有公开 `enemies: Enemy[]`、`projectiles`（元素含 `data: ProjectileData`，其中 `hitSet: Set<number>`）、`loot`、`fx`、`map: MapData`、`player`、`shakeAmount`、`clock`、`boss`、`won`、`renderer`，以及私有 `rng: RNG`、`callbacks: WorldCallbacks`、`enteredRooms: Set<number>`、`portal`、`_minX/_minY/_maxX/_maxY`、`roomClearedHandlers`、`currentRoomId`。`MapData`（`src/types/index.ts`）含 `seed`、`tiles`、`doorways`、`roomsOrder`。
- `src/main.ts` 末尾 `;(window as any).__game = game;`。`tests/audit.spec.ts` 的 `worldState(page)` / `gridToScreen(page, gx, gy)` 通过该全局读 `GameScene.world`、`pl.wx/wy`、`w.enemies` / `w.projectiles` / `w.loot` / `w.portal`、`gs.seed`、`gs.paused` 等，并可注入 `w.spawnEnemy()` / `w.spawnBoss()` / `player.reset()`；`tests/canvas.spec.ts`（硬编码 `http://localhost:5199/`）与 `tests/gameplay.spec.ts`（`PORT=5173`）也读 `window.__game`。
- `index.html` 的全局 `error` / `unhandledrejection` 监听会把内容打到 `console.error`；`tests/audit.spec.ts` / `tests/gameplay.spec.ts` 对 `console.error` / `pageerror` 零容忍。

### 备选方案

- **方案 A 公开 DTO 白名单（建议）**（`【需新建】` DTO 组装器 + `【需扩展】` 只读投影层）：只从 `World.currentRoom()`（`RoomInfo` 的 `id/kind/gx/gy/w/h`）、`WorldCallbacks`（`onRoomEntered` / `onRoomCleared` / `onStats` / `onLevelUp` 等真实回调）、`GameScene.refreshHud()` 的读数来源（`p.data`、`w.currentRoom()`、`w.enemies.length`）取数，组装成白名单对象。
- **方案 B 直接序列化 `Phaser.Scene` / `World`**：`JSON.stringify(scene)` / `JSON.stringify(world)` / 直接返回 `map.tiles` 全量 / `enemies[].data` / `player.data` 全量。**不采纳**：会把 `seed`、RNG 内部状态、未探索房间、敌人 `stateTimer` / `patrolPoints` / `stunTimer` / `targetId` / `aggroRange` / FSM `state`、存档内部字段全部带出；`Set`（`ProjectileData.hitSet`、`World.enteredRooms`）、函数、`sprite`、`scene`、`renderer` 等不可序列化或循环引用；且与 `Phaser` 对象模型强耦合，无法做稳定 schema 出参校验。
- **方案 C 复用 `window.__game` 作为 Agent 接口**：**不采纳**：它是**现有测试探针**（`tests/audit.spec.ts` 的 `worldState()` / `gridToScreen()` 等），其注入能力（`w.spawnEnemy()`、`player.reset()`、`boss.doAttack()`）属于测试专用，不能成为 Action API 实现路径；且等于把 `Phaser.Game` 全量暴露给 Agent，违反「不允许 Agent 直接操作 Phaser 内部对象」。

### 决策

- **建议采用方案 A**：Observation 由**公开 DTO** 生成，不得序列化 `Phaser.Scene` / `World`；`【需新建】` DTO 组装器与 `【需新建】` schema 校验器，`【需扩展】` `WorldCallbacks` / `GameScene` HUD 读数处补只读投影；`window.__game` 与 Bridge 的 DTO 出口必须互不可见。
- **隐藏信息白名单/黑名单**（对齐 `FACTS §7.5` 第 6 问）：只输出白名单字段；不输出未探索房间、`EnemyData.stateTimer` / `patrolPoints` / `patrolIndex` / `stunTimer` / `targetId` / `aggroRange` / FSM `state`、`MapData.seed` / `GameScene.seed`、`World` 的 `RNG` 实例状态、`bestSeed`、`SaveData` 的 `version` / `createdAt` / `updatedAt` / `permanent.*` / `settings.*` / `stats.*`。
- **schema 出参校验**：入参与出参双向校验、对象关闭附加属性（等价 `additionalProperties: false`）、出参侧先按 DTO 白名单组装再校验、校验失败不得降级为「原样发送」；`error` 只含结构化错误码与脱敏描述，不含堆栈、文件路径、环境变量、`seed`、RNG 状态或存档字段。
- Observation API 严格 6 个工具：`observe_state`、`observe_entities`、`observe_map`、`observe_signals`、`observe_inventory`、`observe_events`；`observe_signals` 依赖 PHASE 2，Signal 未落地前不可用。

### 理由

序列化 `Phaser.Scene` 既泄漏隐藏信息（违反「不暴露隐藏信息」铁律），又因 `Set` / 函数 / 循环引用不可稳定序列化，且把协议绑死在 `Phaser` 内部对象模型上；公开 DTO + 白名单 + 出参 schema 是唯一能同时满足「不暴露隐藏信息」「不直接操作 Phaser 内部对象」「可重放/可校验」的落点，也与 `AGENT_BRIDGE_ARCHITECTURE.md` §5 / §8.2 / §8.3 / §9.3 结论一致。

### 影响范围

`【需新建】` DTO 组装器、schema 校验器、脱敏错误通道；`【需扩展】` `src/world/World.ts`（`WorldCallbacks` 只读投影、`currentRoom()`）、`src/scenes/GameScene.ts`（`refreshHud()` 读数出口）、`src/types/index.ts`（公开 DTO 类型）、`src/core/eventbus.ts`（`observe_events` 可选通道，见 ADR-01）；`【需新建】` 独立测试客户端断言隐藏字段不外泄。`window.__game` 保持测试探针定位，是否移除/包装另见 TBD-10。

### 关联文档/阶段

`AGENT_BRIDGE_ARCHITECTURE.md`（PHASE 3，§5 Observation API、§8.2/§8.3 隐藏信息、§9.3 `window.__game` 隔离）；`HUMAN_AGENT_COOP_DESIGN.md`（PHASE 4，§9.3 第 6 问、TBD-11）；`FACTS §4.5` / `§4.8` / `§7.3` / `§7.5` 第 3、6 问；阶段 = **PHASE 3**。

### 待确认事项

- `TBD — Requires User Decision`（TBD-09）：**需用户决定** 6 个 `observe_*` 工具各自的 DTO 字段白名单最终命名、推送频率上限与合并窗口、`payload` 大小上限、schema 出参校验严格级别、视野半径与「已探索」判定依据、`EnemyData.state` / `aggroRange` 是否以聚合形式可见、Signal 强度是否可见（默认一律不暴露），以及 `GameScene.seed` 虽在 `GameOverScene` 向人类显示但 Agent 侧不输出的取舍。
- `TBD — Requires User Decision`（TBD-10）：**需用户决定**是否在非测试构建中移除或包装 `window.__game`；若移除，`tests/audit.spec.ts` / `tests/canvas.spec.ts` / `tests/gameplay.spec.ts` 如何继续读取运行时状态；以及 Agent 模式下是否禁用/脱敏 `index.html` 的全局 `error` / `unhandledrejection` 控制台输出。

---

## ADR-06 存档格式 v2 迁移策略

| 状态（ADR 成熟度） | 现状标签 | 提案标签 | 结论标记 |
|---|---|---|---|
| 待定 | `【已实现】` | `【需扩展】` / `【需新建】` | `TBD — Requires User Decision` |

### 背景（真实源码事实）

- `src/types/index.ts`：`export const SAVE_VERSION = 1;`；`SaveData` 真实结构只有 `version` / `createdAt` / `updatedAt` / `permanent`（10 个数字 + `unlockedWeapons` / `unlockedAbilities` 数组）/ `settings`（3 数字 + 2 布尔）/ `stats`（4 数字）三块，**没有任何局内快照字段**（无 `seed` / 房间 / 玩家 HP / 敌人状态 / `mode` / RNG 状态）。
- `src/systems/SaveSystem.ts`：`const STORAGE_KEY = 'last_signal_save_v1';`（**未导出**）；`emptySave()` 生成 `version = SAVE_VERSION(1)` 默认存档；导出纯函数 `validate(data): data is SaveData` **严格校验**（对象、`version` 为 number、`permanent` 的 `PERMANENT_NUMBERS` 10 个必须有限 number、`unlockedWeapons` / `unlockedAbilities` 必须是数组、`settings` 的 3 个数字 + `fullscreen` / `screenShake` 两个 boolean、`stats` 的 4 个数字）；`load()`：无 storage / 无 raw / JSON 解析失败 → `emptySave()`，`validate()` 失败 → `_upgrade(parsed)`，成功 → `parsed`；`save(data)` 写 `updatedAt` 且 `validate()` 通过才 `setItem`。
- **`_upgrade(parsed)` 只是字段修补、不是版本分级迁移**：以 `emptySave()` 为基底，逐字段从旧对象拷贝合法数值/数组/布尔/字符串，返回 `version = 1` 的新存档；无 `switch(version)`、无迁移链、无回滚。
- **key 重复定义**：`src/config/game.ts` 导出 `SAVE_KEY = 'last_signal_save_v1'`，`src/systems/SaveSystem.ts` 另定义值相同的 `STORAGE_KEY`；`src/main.ts` 里 `export const saveSystem = new SaveSystem()` 与 `SaveSystem.ts` 导出的单例 `export const saveSystem = new SaveSystem()` 构成**两个实例**，但共用同一 localStorage key。
- `src/scenes/MainMenuScene.ts` 的 `LOAD RUN · 暂未实现` 与 `CONTINUE · 暂未实现` 为 dim 态，回调只调 `_flash('暂未实现：读档尚未实现 (NOT IMPLEMENTED)')`；`tests/audit.spec.ts` 明确断言两个按钮不启动 `GameScene` 且显示 `暂未实现`。**真实读档未实现**（FACTS §4.8 / §5 缺口 1）。
- `src/world/World.ts` 的 `saveProgress()` / `playerDataSave()` 只把 `data.upgrades` 最高等级写进 `permanent` 的 7 个 bonus 字段、把已获得武器并入 `unlockedWeapons`；`src/core/runtime.test.ts` 有 3 个 `validate` 单测；`tests/audit.spec.ts` 断言 `screenShake` 仍被严格 `validate()` 接受。

### 备选方案

- **方案 A 保持 v1**（`【已实现】` 不变）：不做局内快照，只做 `permanent` / `settings` / `stats`。代价：无法支持 `LOAD RUN` / `CONTINUE` 与确定性重放。
- **方案 B v2 单档兼容升级**（`【需扩展】`）：`SAVE_VERSION` 升到 2，同一 key 内按 `version` 分级迁移，v1 可读、v2 可写，保留降级路径。
- **方案 C v1/v2 双档并存**（`【需新建】`）：新增 key 存局内快照，旧 key 只存永久进度；代价是两份数据一致性与回滚复杂度。

### 决策（v2 字段、迁移与回滚、`validate()` 兼容策略**全部待用户拍板**）

> 本节所有具体条目均为**提案**，逐项 `TBD — Requires User Decision`（TBD-11 ~ TBD-14），**未确认前不得进入实现**。

- **v2 字段候选**（`【需扩展】` `src/types/index.ts`）：在 `SaveData` 中新增局内快照（候选：`runSnapshot` 含 `seed`、当前房间 `currentRoomId` / `enteredRooms`、玩家 `wx/wy` / `hp` / `level` / `xp` / `weapons` / `upgrades` / `abilities` / `currency`、敌人与掉落状态、RNG 状态或派生 seed、`mode`、Signal 状态），并把 `SAVE_VERSION` 升到 2；字段名、必填性、是否嵌套、是否存 RNG 内部状态全部 `TBD — Requires User Decision`。
- **迁移与回滚候选**（`【需扩展】` `src/systems/SaveSystem.ts`）：把 `_upgrade()` 改造为按 `version` 分级的迁移链（v1→v2、未来 vN→vN+1），保留 `emptySave()` 为基底与「不静默销毁有效存档」原则；双写窗口、v2→v1 回滚（剥离 v2 字段后仍能被 v1 读取）、`last_signal_save_v1` 是否改名、重复定义的 `SAVE_KEY` / `STORAGE_KEY` 如何去重、两个 `SaveSystem` 实例是否收敛为单例，全部 `TBD — Requires User Decision`。
- **`validate()` 兼容策略候选**（`【需扩展】`）：同时接受 v1 与 v2 的严格度、未知字段处理（拒绝还是剔除）、`version` 白名单、`save()` 只写当前 `SAVE_VERSION`、`load()` 按 `version` 分派迁移、`src/core/runtime.test.ts` 新增迁移单测（`【需新建】`）、既有 3 个 `validate` 断言与 `tests/audit.spec.ts` 的 `screenShake` 断言必须继续通过，全部 `TBD — Requires User Decision`。
- **读档 UI 候选**（`【需扩展】` `src/scenes/MainMenuScene.ts`，属 PHASE 1）：`LOAD RUN` / `CONTINUE` 启用方案，与 `tests/audit.spec.ts`「两个 dim 按钮不启动 `GameScene`」断言的取舍，`TBD — Requires User Decision`。

### 理由

`SAVE_VERSION=1` 且 `SaveData` 无局内快照，`_upgrade()` 只做字段修补；若不先定 v2 结构与分级迁移，任何 `LOAD RUN` / `CONTINUE` 实现都会与 `validate()` 的严格校验、`tests/audit.spec.ts` 的禁用按钮断言以及确定性重放（ADR-08）冲突。key 重复定义与双实例属于工程基线遗留，必须在迁移设计中一并收口。

### 影响范围

`src/types/index.ts`（`【需扩展】`，`SAVE_VERSION` / `SaveData`）、`src/systems/SaveSystem.ts`（`【需扩展】`，`validate()` / `_upgrade()` / `load()` / `save()` / `STORAGE_KEY`）、`src/config/game.ts`（`【需扩展】`，`SAVE_KEY` 去重）、`src/main.ts`（`【需扩展】`，实例收敛）、`src/world/World.ts`（`【需扩展】`，`saveProgress()` / `playerDataSave()` 写快照）、`src/scenes/MainMenuScene.ts` 与 `src/scenes/GameOverScene.ts`（`【需扩展】`）、`src/core/runtime.test.ts` 与 `tests/audit.spec.ts`（`【需新建】` 新测试 / 既有断言兼容评估）。

### 关联文档/阶段

`FACTS §4.8` / `§5` 缺口 1 / `§7.1`（PHASE 1 真实读档与局内快照）；本批次路线图与任务分解文档（阶段 = **PHASE 1**）；`HUMAN_AGENT_COOP_DESIGN.md`（PHASE 4，TBD-01/02 涉及「是否给 `SaveData` 新增 `mode` 字段」，须与本 ADR 同步）；`AGENT_BRIDGE_ARCHITECTURE.md`（PHASE 3，隐藏信息黑名单含 `SaveData` 内部字段）。

### 待确认事项

- `TBD — Requires User Decision`（TBD-11）：**需用户决定** v2 的确切字段清单与嵌套结构、是否把 `SAVE_VERSION` 升到 2、局内快照是否包含 `seed` / RNG 状态 / `mode` / Signal 状态、`createdAt` / `updatedAt` 语义是否扩展。
- `TBD — Requires User Decision`（TBD-12）：**需用户决定**迁移链形态（`_upgrade()` 是否改为按版本分级）、是否需要双写窗口、v2→v1 回滚策略、storage key 是否改名（`'last_signal_save_v1'` 重复定义如何去重）、两个 `SaveSystem` 实例是否收敛为单例。
- `TBD — Requires User Decision`（TBD-13）：**需用户决定** `validate()` 对 v1/v2 的兼容严格度、未知字段处理、`save()` 写入版本号规则、新增迁移单测范围，以及如何保证既有 3 个 `validate` 单测与 `tests/audit.spec.ts` 的 `screenShake` 断言不回归。
- `TBD — Requires User Decision`（TBD-14）：**需用户决定** `MainMenuScene` 的 `LOAD RUN` / `CONTINUE` 何时启用、是否改写 `tests/audit.spec.ts` 中「两个 dim 按钮不启动 `GameScene`」的断言（本阶段不改源码/测试）、`SceneConfig` 是否新增可选 `isNewRun` 语义。

---

## ADR-07 MCP stdio + WebSocket 双通道、消息关联与背压

| 状态（ADR 成熟度） | 现状标签 | 提案标签 | 结论标记 |
|---|---|---|---|
| 建议 | `【已实现】` | `【需新建】` | `TBD — Requires User Decision` |

### 背景（真实源码事实）

- 源码中**没有任何** WebSocket / MCP / stdio / Harness 代码（只读 `grep` 复核；FACTS §5 缺口 6）；`index.html` 只提供浏览器页面与 `/src/main.ts` 入口；`src/main.ts` 在浏览器内 `new Phaser.Game(...)`；`vite.config.ts` 的 `server.port: 5173`；`playwright.config.ts` 的 `baseURL = http://localhost:${process.env.PORT ?? 5173}/`；`tests/audit.spec.ts` / `tests/gameplay.spec.ts` 用 `5173`，`tests/canvas.spec.ts` 硬编码 `http://localhost:5199/`。
- 统一候选消息类型（FACTS §7.3）：`hello / observation / action_request / action_result / event / error / takeover / ping`；Observation API 6 工具、Action API 9 工具（见 §0.4）。

### 备选方案

- **方案 A 只用 MCP stdio**：**不采纳**。浏览器没有 stdio，无法承载 MCP 进程模型；若把 MCP 逻辑塞进 `src/main.ts` / `GameScene`，直接违反「不把 MCP 塞进 Phaser 核心」，并把进程管理、凭据、`Phaser.Game` 生命周期耦合进渲染主循环。
- **方案 B 只用 WebSocket**：**不采纳**。Harness 只讲 MCP stdio 协议；直连浏览器 WebSocket 会让 Harness 实现浏览器私有协议、绕过出参白名单与双向 schema、把 localhost 端口与 Origin 策略扩散到 Harness 侧，且每次浏览器刷新都会打断 Agent 会话。
- **方案 C 双通道（建议）**（`【需新建】`）：`Local Harness <-> MCP Server` 走 **MCP stdio**（15 个工具的 `tools/list` / `tools/call`），`MCP Server <-> 浏览器侧 Local WebSocket Bridge` 走 **localhost WebSocket**；`MCP Server` 是唯一同时理解两种协议、同时执行入参/出参校验的组件。

### 决策

- **建议采用方案 C**：双通道 = **MCP stdio + WebSocket**；`MCP Server` 是唯一协议转换点、唯一策略执行点；浏览器刷新只是 WebSocket 重连，不重启 MCP Server、不丢失 Agent 侧状态。
- **消息关联**（`【需新建】`）：每个 `action_request` 带唯一 `id`，`action_result` / `error` 必须以 `correlation_id` 回指；`seq` 在 `session_id` 内单调递增以检测乱序/丢帧/重放；重复 `id` 按幂等重放返回首次结果、不二次执行；`hello` 做 `version` 协商与能力集交换，`ping` 双向探活；取消 / `takeover` 消息必须携带被影响动作的 `id`。
- **背压**（`【需新建】`）：`observation` / `event` 必须有推送频率上限与合并窗口、`payload` 大小上限；队列有界，超限按明确策略拒绝或丢弃（**不排队执行**）；每工具 QPS、全局并发动作上限、持续型动作数量上限落在 `MCP Server`；`ping` 超时、请求超时、动作超时分别判定，超时立即清除已注入的 `Player` 输入层意图（避免「按住不放」）。
- **失败降级**（`【需新建】`）：WebSocket 断开 / `ping` 超时 / MCP Server 退出或 stdio 关闭 / schema 连续校验失败 / 动作连续超时 / 版本不兼容 → 清除所有 Agent 输入意图、进行中动作置 `cancelled`、按 `FAULT` → `OFFLINE` **降级到 Mode A Human**、游戏继续由人类输入驱动、不弹错误不冻结不重启场景；仅在重新 `hello` + 版本协商 + Origin 校验通过后按显式让权回到 Mode B/C。
- 端口、绑定地址、Origin 白名单、协议字段、心跳与超时数值、背压阈值、重连策略全部 `TBD — Requires User Decision`（TBD-15、TBD-16）。

### 理由

单通道必然破坏「不把 MCP 塞进 Phaser 核心」或「Harness 只讲 MCP」之一；双通道让 `MCP Server` 收口工具发现、schema、权限、审计与出参白名单，同时把 localhost 绑定与凭据留在 Node 侧。消息关联与背压是确定性重放（ADR-08）与「无 AI 也能玩」（ADR-09）的前提：没有 `correlation_id` / `seq` 就无法区分重放与乱序；没有有界队列与超时，Agent 侧拥塞或崩溃会直接卡住 `Player` 输入层。

### 影响范围

`【需新建】` MCP stdio 服务端、localhost WebSocket 服务端、协议转换器、schema 校验器、DTO 白名单裁剪器、动作状态机（`pending → active → completed / timeout / cancelled / preempted`）、速率限制器、独立测试客户端；`【需扩展】` `src/entities/Player.ts`（输入意图清除与恢复）、`src/scenes/GameScene.ts`（HUD 的 `OFFLINE` / `FAULT` 显示）；端口不得与 `5173` / `5199` 冲突，不得写入前端硬编码凭据。

### 关联文档/阶段

`AGENT_BRIDGE_ARCHITECTURE.md`（PHASE 3，§3 双通道、§4 协议、§7 动作状态机、§8.7 降级、§10 测试客户端）；`HUMAN_AGENT_COOP_DESIGN.md`（PHASE 4，§4.6 断线降级）；`FACTS §7.3` / `§7.5` 第 4、5、7 问；阶段 = **PHASE 3**。

### 待确认事项

- `TBD — Requires User Decision`（TBD-15）：**需用户决定** WebSocket 固定端口还是动态端口 + 发现机制、绑定 `127.0.0.1` / `::1` 单栈还是双栈、允许的 `Origin` 精确取值（含是否允许 `null` Origin）、协议 `version` 初值与消息信封字段、以及 `id` / `seq` / `correlation_id` 的生成规则与重放窗口。
- `TBD — Requires User Decision`（TBD-16）：**需用户决定** 6 个 `observe_*` 工具各自的推送频率上限与合并窗口、`payload` 大小上限、队列超限是拒绝还是丢弃、每工具 QPS 与全局并发上限、心跳/握手/请求/动作超时数值、断线后是否自动重连、降级到 Mode A 后是否允许自动回切 Mode B/C。

---

## ADR-08 确定性核心、非确定性来源与可测试性

| 状态（ADR 成熟度） | 现状标签 | 提案标签 | 结论标记 |
|---|---|---|---|
| 建议 | `【已实现】` | `【需扩展】` / `【需新建】` | `TBD — Requires User Decision` |

### 背景（真实源码事实）

- `src/core/random.ts`：`class RNG`（Mulberry32，`_hashSeed()` 为 SplitMix64 风格扩散、`_next()` 为 Mulberry32），方法 `float()` / `int(min,max)` / `range()` / `boolean()` / `pick()` / `pickWeighted()` / `shuffle()` / **`seed(seed)`**（不重建对象即可重置状态）、静态 `fromSeed(seed)`；另导出 `clamp()` / `lerp()` / `dist()` / `distSq()` / `unit()` 等纯函数。
- `src/world/MapGenerator.ts`：`generate()` 用 `new RNG(seed)` → `_placeRooms()` → `_greedySpanningBfs()` → `assignRoles()` → `_carveCorridors()` → `_buildTiles()`，全流程由 seed 决定；`assignRoles()` 用确定性 hash `h = (r.id * 2654435761 + depth * 40503) >>> 0` 分配 `resource` / `shop` / `event`；`roomDepth()` / `guaranteeReachable()` 为纯 BFS。`src/world/World.ts` 构造函数 `this.rng = new RNG(map.seed * 7919 + 1)` 用于 `placePortal()` / `pickEnemyForRoom()` / `spawnResourceLoot()` / `killEnemy()` 掉落。
- `tests/audit.spec.ts` 固定 `SEED = 424242`，通过注入 `MainMenuScene.scene.start` 把 `NEW RUN` 固定为 `{ seed: SEED }`，断言从菜单到移动/开火/击杀/掉落/升级/暂停/传送的整条回归链；`tests/canvas.spec.ts` 用 `g.scene.start('GameScene', { seed: 42 })`；`src/core/runtime.test.ts` 的 `iso projection` 单测断言 `isoToScreen(1,0) = {x:32,y:16}` 与投影往返。
- **现存非确定性来源（只读 `grep` 复核 `Math.random`）**：
  - `src/scenes/LevelUpScene.ts` 的 `private pickWeighted()`：`let r = Math.random() * total;` —— 升级三选一抽卡不确定。
  - `src/entities/Boss.ts` 的 `private summonDrones()`：`const angle = Math.random() * Math.PI * 2;` —— Boss phase 2 召唤位置不确定。
  - `src/core/GraphicsFactory.ts` 的 `gen('bg', ...)`：`const x = Math.random() * 1280, y = Math.random() * 720, r = Math.random() * 2 + 0.5;` —— 背景星点不确定。
  - `src/scenes/GameScene.ts` 的 `create()`：`this.seed = (config?.seed ?? Math.floor(Math.random() * 1e9)) >>> 0;` —— 默认开局种子不确定。
  - 另经 `grep` 复核：`src/world/World.ts` 的 `spawnLoot()` 用 `Math.random()` 生成 `bob`、`killBoss()` 用 `Math.random()` 散布 12 个掉落；`src/systems/AudioSystem.ts` 用 `Math.random()` 生成噪声缓冲（纯音频，不影响逻辑）。

### 备选方案

- **方案 A 全量收敛（建议）**（`【需扩展】`）：把**影响玩法的随机**统一到 `RNG`，为每个随机域派生独立 RNG 流（地图 / 战斗 / 掉落 / 升级 / Boss / 视觉），固定 seed 由 `GameScene.create(config.seed)` 注入，`Math.random()` 只保留在纯视觉/音频噪声并显式标注，逻辑 tick 与重放可复现。
- **方案 B 只收敛玩法随机**（`【需扩展】`）：`LevelUpScene.pickWeighted()` / `Boss.summonDrones()` / `World.spawnLoot()` / `World.killBoss()` 换 `RNG`，保留 `GraphicsFactory` 星点与 `AudioSystem` 噪声的 `Math.random()`；代价是视觉层仍不完全可复现（截图比对需容忍）。
- **方案 C 不收敛**：保持现状。**不采纳**：无法支撑 Signal 确定性传播（FACTS §7.2）、存档局内快照重放（ADR-06）与 ADR-07 的 `seq` 重放验证。

### 决策

- **建议采用方案 A/B 的收敛方向**：`【需扩展】` `src/core/random.ts` 的 `RNG`（含 `RNG.seed()`）作为唯一玩法随机源，复用 `MapGenerator.generate()` 的确定性思路；`【需扩展】` 把 `LevelUpScene.pickWeighted()`、`Boss.summonDrones()`、`World.spawnLoot()` / `killBoss()` 改为派生 RNG 流；`GameScene.create()` 的默认 `Math.floor(Math.random() * 1e9)` 作为**唯一允许的种子入口**（生成后即固定），或改为由外部注入。
- **收敛策略**：① 所有 Signal 距离/传播/falloff/半径/感知阈值一律 `wx/wy` 网格坐标（FACTS §7.2 坐标铁律）；② 传播复用 `RNG` 与固定 seed 思路，并有明确 falloff 与墙壁影响（`tileAt()` / `isWalkable()` 判定 `wall` / `lava` / `water`）；③ 事件落在逻辑 tick 上可确定性重放（与 ADR-01 一致）；④ `【需新建】` 确定性单测与固定 seed 回放测试（Vitest node 环境 + Playwright 固定 seed 探针）。
- 是否连纯视觉星点 / 音频噪声也收敛、随机域派生规则、v2 存档是否记录 RNG 状态、逻辑 tick 频率：`TBD — Requires User Decision`（TBD-17、TBD-18）。

### 理由

`tests/audit.spec.ts` 的 `SEED=424242` 与 `MapGenerator.generate()` 已证明「固定 seed → 固定流程」可行；但升级抽卡、Boss 召唤、掉落散布仍用 `Math.random()`，使同一 seed 的两次回放分叉。Signal 传播、存档局内快照重放、Bridge 的 `seq`/幂等重放全部要求确定性，若不收敛，ADR-01 / ADR-06 / ADR-07 的结论都无法验收。

### 影响范围

`src/core/random.ts`（`【需扩展】`）、`src/scenes/LevelUpScene.ts` / `GameScene.ts`（`【需扩展】`）、`src/entities/Boss.ts`（`【需扩展】`）、`src/world/World.ts` / `MapGenerator.ts`（`【需扩展】`）、`src/core/GraphicsFactory.ts`（`【需扩展】`，可选）、`src/types/index.ts`（`【需扩展】`，快照类型）、`【需新建】` 确定性单测与回放测试；既有 4 个测试文件（尤其 `tests/audit.spec.ts` 的 `SEED=424242`、`tests/canvas.spec.ts` 的 `seed:42`）必须继续通过。

### 关联文档/阶段

`SIGNAL_SYSTEM_DESIGN.md`（PHASE 2，§8 确定性传播与 falloff、§12 测试设计）；`FACTS §4.1` / `§4.10` / `§7.2` / `§7.5` 第 1、2 问；阶段 = **PHASE 0**（基线回归固化）与 **PHASE 2**（Signal 确定性）。

### 待确认事项

- `TBD — Requires User Decision`（TBD-17）：**需用户决定** `Math.random()` 的收敛范围（是否连 `GraphicsFactory` 背景星点、`AudioSystem` 噪声、`LootDrop.bob` 这类纯视觉/音频项也统一到 `RNG`）、随机域划分与派生方式（由主 seed 派生子 seed 还是独立实例）、逻辑 tick 频率与固定时间步长、以及「默认开局种子」是否必须由外部注入。
- `TBD — Requires User Decision`（TBD-18）：**需用户决定** v2 存档是否记录 RNG 状态或派生 seed（与 ADR-06 联动）、固定 `SEED=424242` 与 `seed:42` 回归的兼容策略、确定性单测/回放测试的新增范围与命名，以及是否把「同 seed 两次回放逐帧一致」列为 PHASE 5 发布门槛。

---

## ADR-09 Local First / Human Agency

| 状态（ADR 成熟度） | 现状标签 | 提案标签 | 结论标记 |
|---|---|---|---|
| 已定（原则性硬约束） | `【已实现】` | `【需新建】` / `【需扩展】` | `TBD — Requires User Decision`（仅边界细节） |

### 背景（真实源码事实）

- `index.html` 无外部 CDN / 远程资源，只有 `#game` / `#loader` 与本地 `<script type="module" src="/src/main.ts">`；`src/main.ts` 在浏览器内构造 `Phaser.Game`，无网络请求；`vite.config.ts` 的 `base:'./'`、`build.outDir:'dist'` 支持相对路径静态托管；`package.json` 唯一运行时依赖为 `phaser ^3.90.0`。
- `src/systems/SaveSystem.ts` 只用 `localStorage`（`canPersist()` / `load()` / `save()` / `clear()`），无云端存储；`src/scenes/MainMenuScene.ts` 的 `NEW RUN` 直接 `scene.start('GameScene')`，无 Bridge 前置条件。
- 源码中**没有任何** AI / Agent / Signal / Bridge 实现（FACTS §5 缺口 6）；现有 4 个测试文件：`tests/audit.spec.ts`（2 tests）、`tests/canvas.spec.ts`（1 test）、`tests/gameplay.spec.ts`（1 test）、`src/core/runtime.test.ts`（7 tests），在完全不启动 Bridge / MCP Server 的情况下即可运行。

### 备选方案

- **方案 A 本地优先 + 人类最终控制权（已定原则）**：全部逻辑与存档留在本机，Bridge 只作可选旁路，人类始终拥有最高与最终控制权。
- **方案 B 云端依赖 / Agent 主导**：游戏逻辑或凭据依赖云服务、Agent 可覆盖人类输入或发起暂停/模式切换。**不采纳**：违反愿景 *A Game for Humans and Agents* 中「人类」的优先地位与 `FACTS §7.4` 的「人类最高优先级」，也破坏离线可玩与「没有 AI 时游戏必须正常运行」。

### 决策

- **本地优先、无云端依赖**：`【已实现】` 现状保持；`【需新建】` 的 Bridge / MCP Server 全部是本机进程与 localhost 连接；构建产物可离线静态托管，游戏核心不依赖任何远程服务。
- **人类最终控制权**：**人类最高优先级**；冲突即覆盖；人类输入立即触发 `takeover`；暂停 / 恢复 / `takeover` / 模式切换 / `QUIT TO MENU` 永不委托；`Physical Core / Signal Core` **只做权限分工，不做人格**；AI 状态面板 7 种状态只是运行状态而非人格表现。
- **无 AI 可玩**：**Mode A Human 为默认且无 AI 时可独立运行**；`Mode B Agent` / `Mode C Co-op` 仅在用户显式选择 + Bridge 连接后启用；Bridge 是**可选旁路**，`GameScene` / `World` / `Player` 对其**零依赖**；断线 / 超时 / `FAULT` 自动降级到 Mode A；`tests/audit.spec.ts` / `tests/canvas.spec.ts` / `tests/gameplay.spec.ts` / `src/core/runtime.test.ts` 在无 Agent 情况下必须继续通过。
- 原则本身为 `已定`；仅「无云端依赖」的边界细节为 `TBD — Requires User Decision`（TBD-19）。

### 理由

现状已在浏览器内闭环、存档仅 localStorage、测试仅依赖本机 dev server，这是「无 AI 也能玩」的天然基线；把 Bridge 设计为可选旁路可保证任何 Agent 相关故障都不会使游戏不可玩（对齐 `FACTS §7.5` 第 5、7 问与 `HUMAN_AGENT_COOP_DESIGN.md` §8）。

### 影响范围

全局约束：`src/main.ts` / `index.html` / `vite.config.ts`（保持 `【已实现】` 的离线可托管能力）、`【需新建】` Bridge / MCP（不得成为启动前置条件）、`【需扩展】` `GameScene` / `MainMenuScene`（模式选择为可选参数）、现有 4 个测试文件（回归判据）。

### 关联文档/阶段

`HUMAN_AGENT_COOP_DESIGN.md`（PHASE 4，§2 三种模式、§8 没有 AI 时游戏必须正常运行）；`AGENT_BRIDGE_ARCHITECTURE.md`（PHASE 3，§11 无 AI 也能玩）；`FACTS §7.4` / `§7.5` 第 5、7 问；阶段 = 全局（PHASE 0–5 均适用）。

### 待确认事项

- `TBD — Requires User Decision`（TBD-19）：**需用户决定**「本地优先 / 无云端依赖」的约束边界——是否允许 `Local Harness` 侧自行调用云端模型 API（凭据仅在 Harness/MCP 侧、不进入浏览器），还是要求全链路离线；是否允许任何可选的遥测 / 崩溃上报；以及 `Mode A Human` 是否必须在生产构建中完全不含 Bridge 代码（按需动态加载）。

---

## ADR-10 统一网格坐标 `wx/wy` 与单位遗留根因修复

| 状态（ADR 成熟度） | 现状标签 | 提案标签 | 结论标记 |
|---|---|---|---|
| 建议 | `【已实现】` | `【需扩展】` | `TBD — Requires User Decision` |

### 背景（真实源码事实）

- `src/core/iso.ts`：`IsoMath.TILE_W = 64` / `IsoMath.TILE_H = 32`；`IsoMath.toScreen(x,y,z)` / `isoToScreen(x, y, tileW=64, tileH=32, z=0) = { x:(x-y)*(tileW/2), y:(x+y)*(tileH/2)-z }`；`IsoMath.toWorld(sx,sy)` / `screenToIso()` 为逆变换；`IsoMath.depthKey(x,y,z) = x+y+z*0.001`。`src/core/runtime.test.ts` 断言 `isoToScreen(1,0) = {x:32,y:16}`、`isoToScreen(0,1) = {x:-32,y:16}`。
- `src/world/World.ts`：`worldToScreen(x,y)` = `isoToScreen(x,y)` + `WorldRenderer._offX/_offY`；`screenToWorld(sx,sy)` = `screenToIso(sx-_offX, sy-_offY)`；`tileAt(worldX, worldY)` 用 `gx = Math.floor(worldX) - _minX`、`gy = Math.floor(worldY) - _minY` 取 `tiles[gy][gx]`，越界返回 `{type:'wall',height:0}`；`isWalkable(worldX, worldY, radius=0.5)` 采样实体外接方 4 个角点，任一为 `wall` / `lava` / `water` 即 false；`_computeBounds()` 计算 `_minX/_minY/_maxX/_maxY`。
- `Player` / `Enemy` / `Boss` 都持有 `wx/wy`，`get x()` / `get y()` 返回它们；`project()` 一律 `world.worldToScreen(wx, wy)` → `sprite.setPosition()`；弹丸 / 掉落 / 传送门 / 伤害数字 / 命中 FX 均以网格坐标进入、内部转 `worldToScreen()` 后绘制。
- `src/config/game.ts`：`GAME.PIXEL_TO_TILE = 64`，配置里的速度/射程以 screen-px 书写，运行时除以 64 转 tile-world（`src/entities/Player.ts` 的 `tryFire()` 用 `speed: w.baseProjectileSpeed / GAME.PIXEL_TO_TILE`、`src/entities/Enemy.ts` 构造里 `stats.speed /= 64`、`src/entities/Boss.ts` 的 `toTilesPerSecond(px) = px / GAME.PIXEL_TO_TILE`）。
- **历史遗留（不得写成已修）**：`Player.getRadius() = 0.5`、`Enemy.getRadius() = 0.5`、`Boss.getRadius() = 3.0` 是网格单位；但 `World.spawnProjectile()` 把 `ProjectileData.radius` 设为 `5` / `6`、`spawnEnemyProjectile()` 设为 `6`（像素量级），`World.updateProjectiles()` 直接比较 `e.getRadius() + p.data.radius`（Boss 判定另加 `+1`），**半径单位混用**。屏震同理：`src/scenes/GameScene.ts` 的 `update()` 传 `cam.shake(100, world.shakeAmount * 8)`，Phaser 期望 intensity 为视口比例，实际由 `src/world/WorldRenderer.ts` 的 `_clampCameraShake()` 在 `prerender` 钩子（经 `_lockLightToScreen()`）把偏移裁剪到 ±8px 兜底，**根因未修**；`tests/audit.spec.ts` 断言屏震偏移有界且 Boss 攻击不白屏，正是对该兜底的回归。

### 备选方案

- **方案 A PHASE 0 根因修复（建议）**（`【需扩展】`）：把 `ProjectileData.radius` 与碰撞判定统一到网格单位，把 `cam.shake()` 的 intensity 改为视口比例量级，删除或降级 `_clampCameraShake()` 的兜底职责，并补纯函数单测。
- **方案 B 保留兜底**（不采纳为终态）：继续靠 `_clampCameraShake()` 与半径混用「碰巧可用」。代价：Signal 的半径/falloff/感知阈值若沿用混用单位会直接违反 FACTS §7.2 坐标铁律，且 `tests/audit.spec.ts` 的断言会持续掩盖根因。
- **方案 C 全量改为屏幕像素**：**不采纳**：会推翻 `wx/wy` 作为唯一逻辑坐标的现有体系（`Player` / `Enemy` / `Boss` / `tileAt()` / `isWalkable()` / `MapGenerator` 全用它），改动面与回归风险最大。

### 决策

- **建议**：统一 `wx/wy` 网格坐标为唯一逻辑坐标；所有 Signal 距离 / 传播 / `falloff` / 半径 / 感知阈值一律 `wx/wy`，**禁止混用屏幕像素、等距投影坐标或 `worldToScreen()` 的输出**（FACTS §7.2 坐标铁律）；配置速度/射程统一经 `GAME.PIXEL_TO_TILE = 64` 归一化；PHASE 0 先修半径单位与屏震 intensity 根因，而不是继续依赖 `_clampCameraShake()`。
- 修复属于 `【需扩展】`（`src/world/World.ts`、`src/types/index.ts`、`src/scenes/GameScene.ts`、`src/world/WorldRenderer.ts`），**本阶段未授权实现**；具体单位选择与公式 `TBD — Requires User Decision`（TBD-20、TBD-21）。
- 修复后 `tests/audit.spec.ts` 的固定种子流程、Boss 弹速断言、屏震有界断言与 `src/core/runtime.test.ts` 的 iso 单测必须继续通过。

### 理由

`worldToScreen()` / `screenToWorld()` / `tileAt()` / `isWalkable()` 已经构成一致的网格逻辑坐标系，Signal 与 Agent 的观察/动作都必须落在它上面；半径混用与屏震 intensity 单位错误是 PHASE 2/3/4 新增逻辑的直接风险源（半径阈值一旦混用，确定性传播与隐藏信息裁剪都会失真），因此列在 PHASE 0 前置。

### 影响范围

`src/world/World.ts`（`【需扩展】`，`spawnProjectile()` / `spawnEnemyProjectile()` / `updateProjectiles()` / `isWalkable()`）、`src/types/index.ts`（`【需扩展】`，`ProjectileData.radius`）、`src/entities/Player.ts` / `Enemy.ts` / `Boss.ts`（`【需扩展】`，`getRadius()`）、`src/scenes/GameScene.ts`（`【需扩展】`，`cam.shake(100, world.shakeAmount * 8)`）、`src/world/WorldRenderer.ts`（`【需扩展】`，`_clampCameraShake()`）、`src/config/game.ts`（`【需扩展】`，`PIXEL_TO_TILE` 使用统一）、`【需新建】` 单位换算与碰撞纯函数单测。

### 关联文档/阶段

`SIGNAL_SYSTEM_DESIGN.md`（PHASE 2，§2 坐标铁律、§2.3 PHASE 0 必须先解决的历史遗留）；`FACTS §4.1` / `§5` 缺口 8 / `§7.2`；阶段 = **PHASE 0**（工程基线），为 PHASE 2 前置。

### 待确认事项

- `TBD — Requires User Decision`（TBD-20）：**需用户决定**半径统一到网格单位还是像素单位、`ProjectileData.radius` 是否改为网格单位、`World.updateProjectiles()` 的 `e.getRadius() + p.data.radius` 与 Boss 的 `+1` 容差如何调整、以及该改动对 `tests/audit.spec.ts` 命中/击杀回归断言的影响评估与补偿方式。
- `TBD — Requires User Decision`（TBD-21）：**需用户决定** `cam.shake()` intensity 的归一化公式（是否按 `world.shakeAmount / 视口尺寸`）、`WorldRenderer._clampCameraShake()` 是删除还是保留为安全兜底、以及 PHASE 0 修改 `src/scenes/GameScene.ts` / `src/world/WorldRenderer.ts` 的授权范围与验收标准。

---

## ADR-11 生产包单 chunk 约 1.56 MB 与分包策略

| 状态（ADR 成熟度） | 现状标签 | 提案标签 | 结论标记 |
|---|---|---|---|
| 建议 | `【已实现】` | `【需扩展】` | `TBD — Requires User Decision` |

### 背景（真实源码事实）

- `vite.config.ts` 只读复核：`build: { outDir: 'dist', sourcemap: false, target: 'es2020' }`，`base:'./'`，`server.port: 5173`；**没有 `manualChunks`、没有 `rollupOptions`、没有任何分包或动态导入配置**（只读 `grep` 复核无 `manualChunks` / `rollupOptions`）。
- `src/main.ts` 顶部 `import Phaser from 'phaser'` 并静态引入 7 个场景；`package.json` 唯一运行时依赖 `phaser ^3.90.0`。
- 前置审计（`FACTS §4.10`）的实际验证输出：`npx vite build` 生成 31 modules、单一 `assets/index-BREKIYzd.js` **1555.58 kB**（gzip 364.00 kB）并带 chunk >500kB 警告；`FACTS §5` 缺口 10 记为「生产包单 chunk 约 1.56 MB」。**本阶段未重新构建、未写入项目 `dist/`**，该数值引用前置审计结论。
- 现有测试在开发服务器模块图上工作：`tests/audit.spec.ts` 还用 `await import('/src/config/upgrades.ts')` 动态导入源码模块；`tests/canvas.spec.ts` 硬编码 `http://localhost:5199/`。

### 备选方案

- **方案 A 保持单 chunk**：不改配置。**不采纳为终态**：`Phaser` 与游戏代码同包，警告持续存在；Mode A 也会加载全部模块，无法让 Bridge 代码按需加载。
- **方案 B `manualChunks` 分离 vendor（建议）**（`【需扩展】` `vite.config.ts`）：把 `phaser` 拆为独立 vendor chunk，游戏代码单独成块；保持 `base:'./'` 相对路径静态托管不变。
- **方案 C 按需动态加载（建议叠加）**（`【需扩展】`）：Bridge 客户端层只在 Mode B/C 显式启用时动态加载，保证 Mode A 的 bundle 不含 Bridge 代码（与 ADR-09 的可选旁路一致）。
- **方案 D 外部 CDN / 远程加载**：**不采纳**：违反「本地优先、无云端依赖」（ADR-09）与 `index.html` 现有离线结构。

### 决策

- **建议采用方案 B + C**，落在 PHASE 0（基线）与 PHASE 5（发布验收）；本阶段**不修改 `vite.config.ts`、不执行构建**；具体配置与阈值 `TBD — Requires User Decision`（TBD-22）。
- 约束：分包不得破坏 `base:'./'` 的离线静态托管；不得改变开发服务器模块图以致 `tests/audit.spec.ts` 的 `import('/src/config/upgrades.ts')` 与 3 个 Playwright 文件失效；既有的 `npm run typecheck` / `npm test` / Playwright 回归在无 Bridge 情况下仍须通过；`sourcemap` 是否开启、>500kB 警告是否作为发布门槛一并待定。

### 理由

1.56 MB 单 chunk 的主要成因是 `Phaser` 静态打包且无分包配置；把第三方与游戏代码分离可消除警告并改善首屏，而按需加载 Bridge 能同时满足「Mode A 完全不依赖 Bridge」的零依赖原则。但分包属于构建配置变更，会影响相对路径产物与测试探针，必须在 PHASE 0/5 以回归矩阵验收，不能在设计阶段顺手改。

### 影响范围

`vite.config.ts`（`【需扩展】`）、`src/main.ts`（`【需扩展】`，可选动态加载边界）、`【需新建】` Bridge 客户端层（动态加载入口）、`index.html`（`【需扩展】`，产物路径验证）、PHASE 5 回归矩阵与发布验收清单；`【需新建】` 分包后体积与离线托管的验证步骤。

### 关联文档/阶段

`FACTS §1`（`vite.config.ts` / 脚本）、`§4.10`（构建验证结果）、`§5` 缺口 10、`§7.1`（PHASE 0 生产包分包、PHASE 5 性能/分包与回归矩阵）；本批次路线图与任务分解文档；阶段 = **PHASE 0 / PHASE 5**。

### 待确认事项

- `TBD — Requires User Decision`（TBD-22）：**需用户决定** `manualChunks` 的具体分组（是否只拆 `phaser`）、目标体积阈值与 gzip 目标、是否启用 `sourcemap`、Bridge 是否按需动态加载、chunk >500kB 警告是否作为发布门槛、分包后 `base:'./'` 离线静态托管与 `index.html` 相对路径的验证方式，以及双 dev server（`5173` / `5199`）下 3 个 Playwright 文件的回归验收方式。

---

## ADR-12 无 Git 仓库与工程基线（PHASE 0 Task 0.1 未授权）

| 状态（ADR 成熟度） | 现状标签 | 提案标签 | 结论标记 |
|---|---|---|---|
| 待定 | `【已实现】` | `【需新建】` | `TBD — Requires User Decision` |

### 背景（真实源码事实）

- 只读复核：`git -C D:/Project/LAST_SIGNAL status --short --branch` 返回 `fatal: not a git repository (or any of the parent directories): .git`，退出码 **128**；`D:/Project/LAST_SIGNAL/.git` 与 `D:/Project/.git` 均不存在 → **当前不是 Git 仓库**，也没有 `.gitignore` 与 commit 历史（FACTS §1、§5 缺口 7）。
- `docs/` 下已有既有只读文件 `docs/STYLE_GUIDE.md`（v1 美术风格指南，本文件不修改），以及同批次交付的设计文档；项目现有 29 个 TS 文件、7 个场景、4 个测试文件（`tests/audit.spec.ts`、`tests/canvas.spec.ts`、`tests/gameplay.spec.ts`、`src/core/runtime.test.ts`）。
- `package.json` 脚本：`dev=vite`、`build=vite build`、`preview=vite preview`、`typecheck=tsc --noEmit`、`test=vitest run`、`test:watch=vitest`、`playwright=playwright test`；`vitest.config.ts` 的 `include: ['src/**/*.test.ts']`、`coverage.provider:'v8'`；`playwright.config.ts` 的 `testDir:'./tests'`、`fullyParallel:false`、`baseURL` 默认 5173。
- 前置审计（`FACTS §4.10`）的验证结果：`npm run typecheck` → 0；`npm test` → 1 文件 / 7 tests passed；`npx vite build` → 0（单 chunk 1555.58 kB）；Playwright → 4 passed、`CONSOLE ERRORS: 0`、无 `pageerror`；验证产物全部落在 workspace，项目 `dist/` / `test-results/` / `tests/screens/` 未被写入。**本阶段未重新执行这些命令、未产生任何验证产物**。

### 备选方案

- **方案 A 本阶段不初始化 Git（唯一允许）**：保持现状，把 Git 初始化列为 PHASE 0 Task 0.1 待用户授权。
- **方案 B 本阶段初始化 Git / 创建 `.gitignore` / 提交 commit**：**禁止**（FACTS §0 授权边界与本任务严格边界），本文件也不得要求执行。

### 决策

- **本阶段只完成设计审计，未授权实现；Git 初始化属 PHASE 0 Task 0.1，本阶段未授权，需用户确认后执行**。
- 本阶段不初始化 Git、不创建 `.gitignore`、不提交 commit、不删除文件、不安装依赖；所有临时验证输出（若后续需要）应落在 workspace，不得写入项目 `dist/` / `test-results/` / `tests/screens/` / `node_modules/`。
- PHASE 0 的工程基线内容（Git 初始化、CI/脚本与基线回归固化、坐标/半径/屏震根因修复、生产包分包）见 ADR-10、ADR-11；具体仓库与 CI 方案 `TBD — Requires User Decision`（TBD-23）。
- 本 ADR 状态为 `待定`：是否授权后续 PHASE 0 Task 0.1、以及基线范围，必须由用户决定。

### 理由

当前不是 Git 仓库，任何 `git init` / `.gitignore` / commit 都属于工程基线变更，超出「只交付 6 个设计文档」的授权；把它显式记录为 ADR，可避免后续实现阶段误以为基线已就绪，也保证 6 个文档对「无 Git」这一事实口径一致。

### 影响范围

工程基线（不在本阶段落盘）：`【需新建】` `.git` 仓库、`.gitignore`、CI/脚本配置与基线回归清单；影响 ADR-10 / ADR-11 的验收方式、PHASE 5 回归矩阵、以及 6 个设计文档的版本管理。对现有 29 个 TS 源码文件与 4 个测试文件**无本阶段改动**。

### 关联文档/阶段

`FACTS §0`（授权边界）、`§1`（Git / docs / 脚本事实）、`§5` 缺口 7、`§7.1`（PHASE 0 Task 0.1 与统一表述「PHASE 0 Task 0.1，本阶段未授权，需用户确认后执行」）、`§7.6`；`HUMAN_AGENT_COOP_DESIGN.md` TBD-15 与 `AGENT_BRIDGE_ARCHITECTURE.md` §0.1、`SIGNAL_SYSTEM_DESIGN.md` 待确认事项第 15 条采用同一表述；阶段 = **PHASE 0**。

### 待确认事项

- `TBD — Requires User Decision`（TBD-23）：**需用户决定**是否在后续阶段授权 PHASE 0 Task 0.1 初始化 Git 仓库；仓库根位置取 `D:/Project/LAST_SIGNAL` 还是 `D:/Project`；`.gitignore` 内容（是否忽略 `dist/`、`node_modules/`、`test-results/`、`tests/screens/` 等）；首个 commit 的基线内容（是否包含 6 个设计文档与现有 `0.1.0` 源码）；CI/脚本与基线回归固化的范围（`npm run typecheck` / `npm test` / Playwright 双 dev server）与回归矩阵是否纳入 CI；`0.2.0-alpha` / `beta` / `rc` / `0.2.0` 的具体日期；以及若用户已有总计划书中的既定 PHASE 定义，**请以总计划书原文为准重新对齐阶段编号**。

---

## 本文件依据的源码文件

> 以下项目文件均已逐字读取；标注「grep 复核」者为只读检索核对，未做全文细读。本文件未虚构任何现有文件、类、函数或测试；`【需新建】` 路径仅为提案。

| 文件 | 本文件引用的关键事实 |
|---|---|
| `src/core/eventbus.ts` | `class EventBus` 的 `on / emit / emitDeferred / flush / has / clear`、`export const gameBus = new EventBus()`；全项目仅定义处出现、无消费者 |
| `src/core/random.ts` | `class RNG`（Mulberry32、`_hashSeed` / `_next`）、`seed()` / `fromSeed()` / `float()` / `int()` / `pick()` / `pickWeighted()` / `shuffle()`、`clamp()` 等纯函数 |
| `src/core/iso.ts` | `IsoMath.TILE_W=64` / `TILE_H=32`、`toScreen()` / `toWorld()` / `depthKey()`、`isoToScreen()` / `screenToIso()` |
| `src/core/GraphicsFactory.ts` | `gen('bg', ...)` 背景星点使用 `Math.random()`；程序化 canvas 纹理 |
| `src/core/runtime.test.ts` | 7 个 Vitest 用例：`iso projection` / `applyUpgrade` / `validate` 三组 describe；`isoToScreen(1,0)` 断言、3 个 `validate` 断言 |
| `src/world/World.ts` | `WorldCallbacks`（7 个回调，含 `onLoot`）、`RoomInfo`、`worldToScreen()` / `screenToWorld()` / `tileAt()` / `isWalkable()` / `_computeBounds()`、`spawnProjectile()` / `spawnEnemyProjectile()` / `updateProjectiles()` 半径、私有 `rng` / `enteredRooms` / `portal` / `roomClearedHandlers`、`statsSnapshot()`、`saveProgress()` / `playerDataSave()`、`spawnLoot()` 与 `killBoss()` 的 `Math.random()` |
| `src/world/WorldRenderer.ts` | `_offX/_offY`、`projector()`、`scene.events.on('prerender', _lightLock)`、`_clampCameraShake()` ±8px 兜底与详细注释、`_lockLightToScreen()` |
| `src/world/MapGenerator.ts` | `generate()` 确定性流程、`assignRoles()` 的确定性 hash、`roomDepth()` / `guaranteeReachable()` |
| `src/entities/Player.ts` | `registerInput()` / `updateKeys()` / `setFireHeld()` / `fireHeld()` / `aimFromPointer()` / `tryFire()` / `update(dt)` / `getRadius()=0.5`、`wx/wy`、`GAME.PIXEL_TO_TILE` 用法；**无 `switchWeapon()`** |
| `src/entities/Enemy.ts` | `detects()` 唯一感知入口、`stateMachine()` 七个 case、`enterDetect()` / `stun()`、`data.stateTimer/targetId/stunTimer/patrolPoints/spawnRoom`、`getRadius()=0.5`、`stats.speed /= 64` |
| `src/entities/Boss.ts` | 独立类三阶段、`summonDrones()` 的 `Math.random()`、`toTilesPerSecond()`、`getRadius()=3.0`、`scene.events.emit('boss-phase', phase)` |
| `src/scenes/GameScene.ts` | `create()` 输入注册与 `WorldCallbacks`（`onLoot: () => {}`）、`seed` 默认 `Math.floor(Math.random()*1e9)`、`buildMap()`、`update()` 的 `cam.shake(100, world.shakeAmount * 8)`、`setupHud()` / `lockHud()` / `refreshHud()`、`paused` 早退、`private switchWeapon(dir)` |
| `src/scenes/MainMenuScene.ts` | `NEW RUN`、`LOAD RUN · 暂未实现` / `CONTINUE · 暂未实现` dim 态与 `_flash('暂未实现：读档尚未实现 (NOT IMPLEMENTED)')`、`VERSION {SAVE_VERSION}` |
| `src/scenes/LevelUpScene.ts` | `private pickWeighted()` 使用 `Math.random()`、`choose()` 调 `applyUpgrade()` / `saveProgress()` / 180ms 恢复 |
| `src/systems/SaveSystem.ts` | `STORAGE_KEY`、`emptySave()`、`validate()` 严格校验、`load()` / `_upgrade()` / `save()` / `clear()`、`export const saveSystem = new SaveSystem()` 单例 |
| `src/systems/AudioSystem.ts`（grep 复核） | 噪声缓冲使用 `Math.random()`（纯音频，不影响玩法逻辑） |
| `src/types/index.ts` | `SaveData` / `SAVE_VERSION = 1` / `GameEventType`（15 个字面量）/ `GameEvent` / `ProjectileData.hitSet: Set<number>` / `MapData.seed` / `RoomKind` / `PlayerData` / `WeaponState` / `EnemyData` |
| `src/config/game.ts` | `GAME.PIXEL_TO_TILE=64` / `TILE_W/TILE_H`、`DEFAULT_SETTINGS`、`SAVE_KEY = 'last_signal_save_v1'`、`SAVE_VERSION` re-export、`basePlayerData()` / `xpForLevel()` |
| `index.html` | `#game` / `#loader`、全局 `error` / `unhandledrejection` 监听、`<script type="module" src="/src/main.ts">`、无外部资源 |
| `src/main.ts` | `new Phaser.Game({ type: Phaser.CANVAS, ... 7 个场景 })`、`export const game` / `saveSystem`、`;(window as any).__game = game;` |
| `tests/audit.spec.ts` | `PORT=5173`、`SEED=424242`、`SHOT_DIR`、`gridToScreen()` / `worldState()` 经 `window.__game` 读状态；2 个逐字测试名；两个 dim 按钮断言、`screenShake` 存档断言、屏震有界与 Boss 弹速断言 |
| `tests/canvas.spec.ts` | 硬编码 `http://localhost:5199/`、`seed:42`、`full HUD renders and stays locked during camera movement` |
| `tests/gameplay.spec.ts` | `PORT=5173`、`menu + gameplay render`、写 `tests/screens/errors.json` 与截图 |
| `vite.config.ts` | `base:'./'`、`build.outDir:'dist'` / `sourcemap:false` / `target:'es2020'`、`server.port:5173`、**无 `manualChunks` / `rollupOptions`** |
| `vitest.config.ts` | `globals:true`、`environment:'node'`、`include:['src/**/*.test.ts']`、coverage v8 |
| `playwright.config.ts` | `testDir:'./tests'`、`fullyParallel:false`、`baseURL = http://localhost:${process.env.PORT ?? 5173}/`、chromium project |
| `package.json` | `version: 0.1.0`、`type: module`、脚本 `dev/build/preview/typecheck/test/test:watch/playwright`、依赖 `phaser ^3.90.0` 与 devDependencies |
| `docs/STYLE_GUIDE.md` | 仅确认存在（9791 字节，v1 美术风格指南），**本文件未修改、未引用其内容** |

补充依据（非项目源码）：前置审计 `FACTS.md`（§4.1 坐标、§4.5 eventbus/WorldCallbacks、§4.8 SaveSystem、§6 不虚构、§7.1 阶段、§7.2 Signal 口径、§7.3 Bridge 口径、§7.4 Co-op 口径、§7.5 七问、§7.6 格式，以及 §4.10 的前置构建/测试验证数值）；同批次设计文档 `SIGNAL_SYSTEM_DESIGN.md`（PHASE 2）、`AGENT_BRIDGE_ARCHITECTURE.md`（PHASE 3）、`HUMAN_AGENT_COOP_DESIGN.md`（PHASE 4）仅用于一致性核对。另经只读命令核对：`git status --short --branch` 返回 `fatal: not a git repository`（退出码 128）、`.git` 不存在、`src/systems/` 仅两个文件、`src/core/` 五个文件、全项目 `Math.random()` 分布、`last_signal_save_v1` 重复定义、无 `manualChunks`。

---

## 待用户确认事项

> 本文件全部 `TBD — Requires User Decision` 事项汇总如下；每条均写明**需要用户决定的具体问题**。编号仅在本 ADR 文件内有效，与同批次其它 5 个文档的「待确认事项」编号各自独立。未确认前，对应 ADR 结论保持为设计提案，**不得进入实现**。
> 再次声明：**本阶段只完成设计审计，未授权实现；Git 初始化属 PHASE 0 Task 0.1，本阶段未授权，需用户确认后执行**。

| 编号 | 所属 ADR | 主题 | 需要用户决定的具体问题 |
|---|---|---|---|
| TBD-01 | ADR-01 | Signal 事件通道 | 复用 `gameBus`（扩充 `GameEventType` / `GameEvent`）还是新增 Signal 专线（`src/systems/signal/` 内通道，或扩展 `WorldCallbacks`）？若复用：订阅生命周期与 `EventBus.clear()` 时机、暂停/场景切换事件是否丢弃、`emit()` 的 handler 顺序如何保证确定性重放、`GameEvent.tick` 是否为逻辑 tick、如何向 `observe_signals` 提供公开 DTO 白名单？本 ADR 与 `SIGNAL_SYSTEM_DESIGN.md` §13 均不预设结论 |
| TBD-02 | ADR-01 | `signal` 事件名与 `GameEventType` 最终枚举 | 是否扩充 `signal` 事件名、`GameEventType` 最终枚举与命名（在现有 15 个字面量基础上）？需用户决定：新增哪些 signal 事件名及命名前缀/字面量顺序、是否调整或保留现有 15 个字面量、`GameEvent.tick` / `payload` 是否随之变更、新增事件名如何进入 `observe_events` / `observe_signals` 公开 DTO 出参白名单？事件通道复用 `gameBus` 还是新建专线另见 TBD-01，本项不预设 |
| TBD-03 | ADR-02 | Signal 目录与模块边界 | 是否采用 `src/systems/signal/` 提案路径？共享类型放 `src/types/index.ts` 还是目录内新建类型文件？该目录是否允许 import `World` / Phaser（默认禁止）？Signal 配置放 `src/config/*` 还是目录内自带？ |
| TBD-04 | ADR-02 | Signal 测试落点 | 是否采用 `src/systems/signal/*.test.ts` 与 `tests/signal.spec.ts` 命名？是否新增 Signal 专属配置与测试房间入口？运行时探针扩展 `worldState(page)` 还是新建 `signalState(page)`？ |
| TBD-05 | ADR-03 | 进程分层变体 | 是否允许把「浏览器 / 独立 Node MCP Server / Harness」三进程合并为「Harness 内嵌 MCP Server」变体？若允许，如何重新界定 stdio 生命周期与进程隔离保证？ |
| TBD-06 | ADR-03 | MCP 进程生命周期与落盘 | 启动命令、Node 运行时与工作目录、单实例/多实例约束、崩溃是否自动重启、stdio 关闭与 WebSocket 关闭顺序、日志落盘位置与保留期、是否允许 `0.2.0` 引入新 Node 侧包（本阶段不安装依赖、不创建目录）？ |
| TBD-07 | ADR-04 | 仲裁落点与切枪语义 | 是否/何时把 Input Arbitration 提取为独立新服务？`action_switch_weapon` 是在 `Player` 输入层新增公开意图入口，还是复用 `GameScene.switchWeapon(dir)` 现有语义（任务描述中「`Player.switchWeapon()`」与源码不符，需统一口径）？ |
| TBD-08 | ADR-04 | 接管与仲裁参数 | 每帧 `aimFromPointer()` 被动指针位移是否算「人类有效输入」？去抖毫秒数、单动作超时、动作 ID 生命周期、接管后自动恢复委托的条件与时长、`takeover` 由浏览器侧还是 Harness 侧发起、Agent 是否允许请求暂停/恢复（对应 `ESC` / `I`）？ |
| TBD-09 | ADR-05 | Observation 白名单与出参校验 | 6 个 `observe_*` 工具的 DTO 字段最终命名、推送频率上限与合并窗口、`payload` 大小上限、schema 出参校验严格级别、视野半径与「已探索」判定、`EnemyData.state` / `aggroRange` 是否聚合可见、Signal 强度是否可见、`GameScene.seed` 是否一律不输出（默认一律不暴露隐藏信息）？ |
| TBD-10 | ADR-05 | `window.__game` 与控制台 | 是否在非测试构建中移除或包装 `window.__game`？若移除，3 个 Playwright 文件如何继续读取运行时状态？Agent 模式下是否禁用/脱敏 `index.html` 全局 `error` / `unhandledrejection` 的 `console.error` 输出？ |
| TBD-11 | ADR-06 | 存档 v2 字段 | v2 的确切字段清单与嵌套结构、`SAVE_VERSION` 是否升到 2、局内快照是否含 `seed` / RNG 状态 / `mode` / Signal 状态、`createdAt` / `updatedAt` 语义是否扩展？ |
| TBD-12 | ADR-06 | 迁移与回滚 | `_upgrade()` 是否改为按 `version` 分级的迁移链？是否需要双写窗口？v2→v1 回滚策略？storage key `'last_signal_save_v1'` 是否改名、`SAVE_KEY` / `STORAGE_KEY` 重复定义如何去重？两个 `SaveSystem` 实例是否收敛为单例？ |
| TBD-13 | ADR-06 | `validate()` 兼容策略 | `validate()` 对 v1/v2 的兼容严格度、未知字段是拒绝还是剔除、`save()` 写入版本号规则、新增迁移单测范围，以及如何保证既有 3 个 `validate` 单测与 `tests/audit.spec.ts` 的 `screenShake` 断言不回归？ |
| TBD-14 | ADR-06 | 读档 UI 启用 | `MainMenuScene` 的 `LOAD RUN` / `CONTINUE` 何时启用？是否改写 `tests/audit.spec.ts`「两个 dim 按钮不启动 `GameScene`」断言（本阶段不改源码/测试）？`SceneConfig` 是否新增可选 `isNewRun` 语义？ |
| TBD-15 | ADR-07 | 双通道端口与消息关联 | WebSocket 固定端口还是动态端口 + 发现机制？绑定单栈还是双栈？允许的 `Origin` 精确取值（含 `null` Origin）？协议 `version` 初值与消息信封字段？`id` / `seq` / `correlation_id` 生成规则与重放窗口？端口不得与 `5173` / `5199` 冲突、不得作为前端凭据 |
| TBD-16 | ADR-07 | 背压、超时与降级 | 6 个 `observe_*` 工具推送频率上限与合并窗口、`payload` 上限、队列超限拒绝还是丢弃、每工具 QPS 与全局并发上限、心跳/握手/请求/动作超时数值、断线后是否自动重连、降级 Mode A 后是否允许自动回切 Mode B/C？ |
| TBD-17 | ADR-08 | `Math.random()` 收敛范围 | 是否连 `GraphicsFactory` 背景星点、`AudioSystem` 噪声、`LootDrop.bob` 也统一到 `RNG`？随机域划分与派生方式？逻辑 tick 频率与固定时间步长？默认开局种子是否必须由外部注入？ |
| TBD-18 | ADR-08 | 确定性重放与存档 | v2 存档是否记录 RNG 状态或派生 seed（与 TBD-11 联动）？`SEED=424242` 与 `seed:42` 回归兼容策略？确定性单测/回放测试范围与命名？是否把「同 seed 两次回放逐帧一致」列为 PHASE 5 发布门槛？ |
| TBD-19 | ADR-09 | Local First 边界 | 「本地优先 / 无云端依赖」是否允许 Harness 侧调用云端模型 API（凭据仅在 Harness/MCP 侧）或可选遥测，还是要求全链路离线？`Mode A Human` 是否必须在生产构建中完全不含 Bridge 代码（按需动态加载）？ |
| TBD-20 | ADR-10 | 半径单位统一 | 半径统一到网格单位还是像素单位？`ProjectileData.radius` 是否改为网格单位？`World.updateProjectiles()` 的 `e.getRadius() + p.data.radius` 与 Boss `+1` 容差如何调整？对 `tests/audit.spec.ts` 命中/击杀断言的影响评估与补偿？ |
| TBD-21 | ADR-10 | 屏震根因修复 | `cam.shake()` intensity 的归一化公式？`WorldRenderer._clampCameraShake()` 删除还是保留为安全兜底？PHASE 0 修改 `src/scenes/GameScene.ts` / `src/world/WorldRenderer.ts` 的授权范围与验收标准？ |
| TBD-22 | ADR-11 | 分包策略与验收 | `manualChunks` 具体分组、目标体积/gzip 阈值、是否启用 `sourcemap`、Bridge 是否按需动态加载、chunk >500kB 警告是否作为发布门槛、分包后 `base:'./'` 离线静态托管与相对路径验证方式、`5173` / `5199` 双 dev server 回归验收方式？ |
| TBD-23 | ADR-12 | Git 与工程基线授权 | 是否授权后续 PHASE 0 Task 0.1 初始化 Git？仓库根位置、`.gitignore` 内容、首个 commit 基线内容、CI/脚本与基线回归固化范围、回归矩阵是否纳入 CI？`0.2.0-alpha` / `beta` / `rc` / `0.2.0` 具体日期？若用户已有总计划书中的既定 PHASE 定义，**请以总计划书原文为准重新对齐阶段编号**？ |
