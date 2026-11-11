# LAST SIGNAL — 设计待决问题登记册

> **用途：** 汇总 [`GAME_DESIGN_BIBLE.md`](GAME_DESIGN_BIBLE.md) 第 19 章的 26 个问题，以及正文中明确「尚未冻结 / 需要确认 / 不得擅自规定」的关键项，供后续 ADR、设计评审或原型测试逐步收敛。  
> **重要边界：** 所有条目都是 **尚未冻结**，不是已批准规格，更不是已实现功能。本登记册与仓库中已实现的局内 checkpoint / 永久进度 / 可选补给终端无关；那些是既有工程能力，不能反向证明 GDB 设计已落地。  
> **配套文档：** [`GAME_DESIGN_BIBLE_ALIGNMENT.md`](GAME_DESIGN_BIBLE_ALIGNMENT.md)  
> **登记数量：** 39 条（GDB 第 19 章 26 条 + 正文/对齐补充 13 条）

**状态取值：**

- `OPEN`：已识别，尚未归类到具体决策路径。
- `NEEDS_USER_DECISION`：必须由用户明确确认产品方向或候选设定。
- `NEEDS_ADR`：需要架构决策记录冻结接口、状态机或边界。
- `NEEDS_PROTOTYPE`：需要可玩原型或测试后依据证据再决定。

---

## 1. GDB 第 19 章：世界观（6 条）

| ID | 类别 | 问题 | GDB 章节 | 状态 | 影响文档 / 模块 | 建议产出物 | 备注 |
|---|---|---|---|---|---|---|---|
| W-01 | 世界观 | 大静默发生的准确年代 | 19 / 世界观 1 | `NEEDS_USER_DECISION` | GDB 2.4、五幕叙事、Station Zero 档案 | 世界观术语 ADR / 剧情年表 | 「公元 2189 年之后」仍是建议初稿 |
| W-02 | 世界观 | 零号站失联的具体时长 | 19 / 世界观 2 | `NEEDS_USER_DECISION` | GDB 2.5、第一幕 | 剧情状态设定 | 影响 ECHO 记忆与设施记录 |
| W-03 | 世界观 | 共识场究竟是自然结构还是人工结构 | 19 / 世界观 3 | `NEEDS_USER_DECISION` | GDB 2.1/2.2、最终真相 | ADR / 叙事圣经附录 | 不得用「宇宙级结构」一笔带过 |
| W-04 | 世界观 | ECHO 的起源与最终身份 | 19 / 世界观 4 | `NEEDS_USER_DECISION` | GDB 4、10、14.4 | ECHO Identity ADR | 与 A-01/A-02 有关，但问题层级不同 |
| W-05 | 世界观 | 玩家多次苏醒记录的真实原因 | 19 / 世界观 5 | `NEEDS_USER_DECISION` | GDB 3.3、第三幕、第五幕 | 剧情状态与结局条件 | 第一幕不得直接揭示 |
| W-06 | 世界观 | 最终剧情真相与结局条件 | 19 / 世界观 6 | `NEEDS_USER_DECISION` | GDB 10、11.8、21 | 结局设计 / ADR | 三个候选结局均非已批准规格 |

## 2. GDB 第 19 章：玩法（7 条）

| ID | 类别 | 问题 | GDB 章节 | 状态 | 影响文档 / 模块 | 建议产出物 | 备注 |
|---|---|---|---|---|---|---|---|
| G-01 | 玩法 | 现实工程是否允许直接改变地形 | 19 / 玩法 1 | `NEEDS_USER_DECISION` | GDB 5.1、6.1、9.3；Reality Protocol | 协议目标类型 ADR | 必须保留成本、条件、后果 |
| G-02 | 玩法 | ANCHOR / SEVER / RELAY / INVERT 的具体解锁顺序 | 19 / 玩法 2 | `NEEDS_USER_DECISION` | GDB 6、9.2、16 | Engineering Progression 路线 | 不应第一阶段全部实现 |
| G-03 | 玩法 | Scan / Jam / Decoy 与高级协议的资源关系 | 19 / 玩法 3 | `NEEDS_ADR` | GDB 5.5、6；`SIGNAL_SYSTEM_DESIGN.md` | Signal Energy ADR | 与 X-01 同源，但本项聚焦能力间资源关系 |
| G-04 | 玩法 | 世界稳定性是否使用独立资源 | 19 / 玩法 4 | `NEEDS_ADR` | GDB 6.1、9.3、12.4 | 资源模型 ADR | 避免与 Signal Energy 混为同一数值但语义不同 |
| G-05 | 玩法 | 世界状态变化是否跨局永久保留 | 19 / 玩法 5 | `NEEDS_ADR` | GDB 9.2/9.3、11.8；`SaveSystem` / `RunCheckpoint` | 存档与迁移 ADR | 与 X-12 关联，但本项聚焦「是否永久」 |
| G-06 | 玩法 | 高级协议能否作用于 Boss | 19 / 玩法 6 | `NEEDS_PROTOTYPE` | GDB 8.4、11.7；`Boss.ts` | Warden 机制原型 / ADR | 不要求所有 Boss 可完全绕过战斗 |
| G-07 | 玩法 | 现实操纵的可逆性和失败代价 | 19 / 玩法 7 | `NEEDS_ADR` | GDB 5.1、6、7.4 | 协议状态机 ADR | 失败条件必须可观察、可测试 |

## 3. GDB 第 19 章：AI（6 条）

| ID | 类别 | 问题 | GDB 章节 | 状态 | 影响文档 / 模块 | 建议产出物 | 备注 |
|---|---|---|---|---|---|---|---|
| A-01 | AI | ECHO 在不同模式中的权限 | 19 / AI 1 | `NEEDS_ADR` | GDB 4.6、14.2；`HUMAN_AGENT_COOP_DESIGN.md` | Action API 权限 ADR | 需与 Physical/Signal Core 权限层协调 |
| A-02 | AI | ECHO 的记忆持久化范围 | 19 / AI 2 | `NEEDS_ADR` | GDB 14.4/14.5；ECHO Identity | 记忆 schema / 存档 ADR | Hypothesis 不得自动升格为 Canonical |
| A-03 | AI | ECHO 主动行动的触发条件 | 19 / AI 3 | `NEEDS_ADR` | GDB 4.5、14.2；Action Layer | 主动行为规则 ADR | 不应通过随机拒绝指令表现独立性 |
| A-04 | AI | ECHO 是否可以在关键剧情中拒绝建议 | 19 / AI 4 | `NEEDS_USER_DECISION` | GDB 4.5、10、11.8 | 剧情/权限边界 ADR | 拒绝建议不等于拒绝合法玩家操作 |
| A-05 | AI | 玩家与 ECHO 的关系如何影响玩法 | 19 / AI 5 | `NEEDS_PROTOTYPE` | GDB 1.4、4.5、9.2 | Relationship State 原型 | 需可观察、可保存、可测试 |
| A-06 | AI | 外部模型不可用时的完整降级逻辑 | 19 / AI 6 | `NEEDS_ADR` | GDB 14.1/14.2；Agent Bridge | 断线降级 ADR | 必须保证 Mode A 无 AI 可完整通关 |

## 4. GDB 第 19 章：技术（7 条）

| ID | 类别 | 问题 | GDB 章节 | 状态 | 影响文档 / 模块 | 建议产出物 | 备注 |
|---|---|---|---|---|---|---|---|
| T-01 | 技术 | Signal 事件通道 | 19 / 技术 1 | `NEEDS_ADR` | GDB 7.1/7.3；`ARCHITECTURE_DECISIONS.md` | 复用 `gameBus` 或新建专线的 ADR | 不得把 `gameBus` 写成已有 Signal 总线 |
| T-02 | 技术 | RNG 与存档状态恢复 | 19 / 技术 2 | `NEEDS_ADR` | GDB 9.3、17；`RunCheckpoint` / `RNG` | 确定性 / 存档 ADR | 关键状态变化必须可复现 |
| T-03 | 技术 | Observation DTO 白名单 | 19 / 技术 3 | `NEEDS_ADR` | GDB 4.3、14.3；`AGENT_BRIDGE_ARCHITECTURE.md` | DTO schema ADR | 不得暴露未授权隐藏状态 |
| T-04 | 技术 | Action API 的权限模型 | 19 / 技术 4 | `NEEDS_ADR` | GDB 4.6、14.3；Action API | 权限/速率/接管 ADR | 人类始终拥有最终接管权 |
| T-05 | 技术 | 世界状态持久化格式 | 19 / 技术 5 | `NEEDS_ADR` | GDB 9.3；`SaveSystem` / `RunCheckpoint` | 存档 v3 候选与迁移 ADR | 与 G-05、X-12 关联 |
| T-06 | 技术 | 现实协议的模块边界 | 19 / 技术 6 | `NEEDS_ADR` | GDB 5/6/7；`src/systems/*` 候选 | 模块边界 ADR | 按文件边界拆工单，避免并发写同一模块 |
| T-07 | 技术 | 自动化关卡测试方案 | 19 / 技术 7 | `NEEDS_ADR` | GDB 11、17；`tests/*`、CI | 测试策略 ADR | 必须含真实浏览器 E2E，不只是单测 |

## 5. 正文与对齐补充（13 条）

| ID | 类别 | 问题 | GDB 章节 | 状态 | 影响文档 / 模块 | 建议产出物 | 备注 |
|---|---|---|---|---|---|---|---|
| X-01 | 规则冻结 | Signal Energy 的每秒恢复量、技能消耗、冷却、跨房间恢复、暂停计时 | 5.5 | `NEEDS_ADR` | `SIGNAL_SYSTEM_DESIGN.md`、Signal Core | Signal Energy ADR | GDB 明确「不擅自规定」这些参数 |
| X-02 | 规则冻结 | 协议组合结果如何保持可预测，且不由 LLM 即兴决定 | 6.5、7.4 | `NEEDS_ADR` | Reality Protocol、状态机、测试 | 协议组合规则表 / ADR | 与 G-07 互补：本项聚焦组合确定性 |
| X-03 | 关卡 | Warden / 共识核心的具体胜利条件 | 11.7、17 | `NEEDS_USER_DECISION` | Vertical Slice、Boss 机制 | Vertical Slice 胜利条件 ADR | 常规击败 / 环境削弱 / 撤离均只是候选 |
| X-04 | 叙事 | 第五幕最终真相、三个候选结局的触发条件与代价 | 10、21 | `NEEDS_USER_DECISION` | 五幕叙事、World Progression | 结局设计 / 剧情状态 ADR | 与 W-06 相关，但本项聚焦可选结局条件 |
| X-05 | 美术 | GDB 语义色与 `STYLE_GUIDE.md` 现行色板如何统一，以及可读性/无障碍验证 | 12.3 | `NEEDS_PROTOTYPE` | `STYLE_GUIDE.md`、HUD、Signal 视觉 | 色彩语义 ADR + 验证报告 | 冷蓝/青/琥珀/白/灰黑与现有威胁色需调和 |
| X-06 | AI | ECHO 连续身份在不同 LLM 间保证到什么程度，不承诺哪些一致性 | 14.4 | `NEEDS_ADR` | Identity Layer、Reasoning Adapter | 连续身份 ADR | 保存相同状态 ≠ 不同模型输出完全一致 |
| X-07 | 流程 | GDD-01 / GDD-02 / GDD-03 的冻结顺序与验收产物 | 16 | `NEEDS_USER_DECISION` | 全部后续设计/实现 | GDD 阶段验收清单 | 在扩大功能开发前完成 |
| X-08 | 流程 | GDB P0–P5 与现有 `PHASE 0–5` / `0.2.0-alpha/beta/rc` 如何对齐 | 16、15.3 | `NEEDS_USER_DECISION` | `PROJECT_ROADMAP.md`、`IMPLEMENTATION_TASKS.md` | PHASE 对齐 ADR | 两套编号目前并存 |
| X-09 | 范围 | 远端 `f01e3f0` 已实现的可选补给终端 / 局内信用点是否纳入 GDB 核心循环 | GDB 未覆盖；`docs/ECONOMY_MODE.md` | `NEEDS_USER_DECISION` | `src/economy/*`、Engineering/World Progression | 模式归属 ADR | 已是工程事实，但 GDB 未定义 |
| X-10 | 文档 | GDB 第 20 章「现有六份技术设计文档」与第 15.3 章列出 7 个文件的措辞差异 | 15.3、20 | `OPEN` | `docs/README.md`、GDB 归档说明 | 文档索引/措辞修订记录 | 不擅自改 GDB 原文；本报告按 7 份审查 |
| X-11 | 文档 | 6 份 `0.2.0` 文档中「当前不是 Git 仓库」「PHASE 0 未授权」「4 个 Playwright」等历史快照是否逐字同步 | 15.2；`docs/README.md` | `NEEDS_USER_DECISION` | 6 份历史设计文档 | 历史状态同步授权 | 目前用 `docs/README.md` 澄清，未重写原文 |
| X-12 | 存档 | Knowledge / Engineering / World Progression 的字段、嵌套、版本与迁移策略 | 9.2、9.3 | `NEEDS_ADR` | `SaveSystem`、`RunCheckpoint`、`src/types/index.ts` | 存档 v3 候选 ADR | 现有 checkpoint 已实现，不能直接覆盖 |
| X-13 | 关卡 | 手工/模板 Vertical Slice 与现有随机 `MapGenerator` 的边界 | 11.3 | `NEEDS_ADR` | `World`、`MapGenerator`、房间数据、测试 | 手工关卡集成 ADR | GDB 明确不依赖随机地图碰巧生成正确谜题 |

---

## 6. 使用规则

1. 任何条目从 `NEEDS_USER_DECISION` 变为已确认，必须有用户明确确认；Assistant 不得自行代决。
2. 任何条目进入实现前，必须先有对应 ADR 或原型证据，且不得与 GDB 第 18 章「明确不做什么」冲突。
3. 状态变化应同步更新本登记册与 [`GAME_DESIGN_BIBLE_ALIGNMENT.md`](GAME_DESIGN_BIBLE_ALIGNMENT.md)，但仍不得把 GDB 创意提案自动改写为「已实现」。
4. 与现有工程事实冲突时，以真实源码、测试、CI 与 `git` 证据为准；与产品方向冲突时，记录冲突并请求用户确认，不擅自覆盖 GDB。
