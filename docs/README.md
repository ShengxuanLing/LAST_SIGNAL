# 设计文档索引

本目录包含 **LAST SIGNAL** 的美术风格指南、`0.2.0 Technical Design & Architecture Audit` 阶段产出的设计、路线图与架构审计文档，以及 2026-11-10 归档的 Game Design Bible（V1.0 Draft）与配套设计分析产物。

> **历史快照说明**：以下文档中关于「当前不是 Git 仓库」「PHASE 0 尚未授权」「4 个 Playwright 测试」等描述，是 **2026-11-09 审计时点** 的事实记录。仓库后续已经建立 Git 基线、CI、README、截图资源与额外回归测试；这些句子不应被当作当前仓库状态。当前代码版本始终以 `package.json` 为准。

| 文档 | 类型 | 当前用途 |
| --- | --- | --- |
| [`STYLE_GUIDE.md`](STYLE_GUIDE.md) | 生效规范 | 美术色板、几何语言、程序化纹理、HUD 字体与 Signal 视觉反馈边界。改动画面时必须遵守。 |
| [`PROJECT_ROADMAP.md`](PROJECT_ROADMAP.md) | 路线图 | PHASE 0–5、版本节奏、每阶段验收与风险登记。 |
| [`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md) | 架构决策 | ADR 集合：事件通道、Signal 目录、Bridge 独立进程、输入仲裁、存档迁移等。 |
| [`SIGNAL_SYSTEM_DESIGN.md`](SIGNAL_SYSTEM_DESIGN.md) | 技术设计 | Signal 数据模型、传播、Scan / Jam / Decoy、敌人感知与测试房间。 |
| [`AGENT_BRIDGE_ARCHITECTURE.md`](AGENT_BRIDGE_ARCHITECTURE.md) | 技术设计 | 本机 WebSocket Bridge、独立 MCP Server、Observation / Action API 与安全边界。 |
| [`HUMAN_AGENT_COOP_DESIGN.md`](HUMAN_AGENT_COOP_DESIGN.md) | 技术设计 | Mode A / B / C、Input Arbitration、AI 状态面板与接管降级。 |
| [`IMPLEMENTATION_TASKS.md`](IMPLEMENTATION_TASKS.md) | 实施工单 | 按真实源码路径排列的 PHASE 0–5 任务、前置依赖与验收标准。 |
| [`ECONOMY_MODE.md`](ECONOMY_MODE.md) | 可选模式说明 | 远端 `main` `f01e3f0` 引入的补给终端 / 局内信用点入口与玩法说明；与主玩法共用同一浏览器地址的 `run` 检查点。 |
| [`GAME_DESIGN_BIBLE.md`](GAME_DESIGN_BIBLE.md) | **权威设计方向（V1.0 Draft，归档版）** | 统一世界观、核心玩法、叙事、AI 角色与开发方向的最高设计依据。高层产品方向已确认；世界观细节、剧情年份、角色名称、技能参数、关卡与结局均为 V1.0 创意提案，不自动视为已批准技术规格，亦不代表已实现功能。 |
| [`GAME_DESIGN_BIBLE_ALIGNMENT.md`](GAME_DESIGN_BIBLE_ALIGNMENT.md) | 设计对齐报告 | GDB 与现有 `0.2.0` 设计审计文档、`0.1.0` 可玩纵向切片之间的设计对齐分析：一致点、冲突、缺口与需澄清项；仅分析归档，不含实现结论。 |
| [`DESIGN_DECISION_REGISTER.md`](DESIGN_DECISION_REGISTER.md) | 待决问题登记册 | 汇总对齐过程中识别的待用户决策问题、状态与影响范围，供后续 ADR 与实施工单引用；未决条目不代表已批准实现。 |

> **归档说明**：上表最后三行为 2026-11-10 新增的归档产物，本次仅归档与设计分析，不涉及源码实现。GDB 是设计方向依据；Signal Manipulation / Agent Bridge / Human+AI Co-op 仍为设计提案，未因归档而自动实现。前述 6 份 `0.2.0` 审计文档保持原样，历史快照说明仅适用于它们。

## 当前实现边界

- `0.1.0` 是**可玩纵向切片**：程序化地图、战斗、升级、Boss、暂停、结算、本地永久存档与基础音效已实现。
- **局内检查点与永久进度已实现**：`NEW RUN` 在开始新局时覆盖旧检查点；`LOAD RUN` / `CONTINUE` 可查看 / 直接恢复检查点；死亡或击败 Boss 进入结算时清除这局的 `run` 检查点。击败 Boss 可获得永久 `cores`，在 `PERMANENT TALENTS` 中购买天赋，永久加成在下次开局生效。
- Signal Manipulation、Agent Bridge、Human+AI Co-op **目前只有设计文档，尚未实现**；代码中没有 WebSocket / MCP / Agent / Harness。
- 可选补给终端入口已由远端 `f01e3f0` 引入（见 `ECONOMY_MODE.md`）；它是额外可选模式，不改变上述 Signal / Agent 未实现的结论。
- 设计文档里大量 `TBD — Requires User Decision` 与「需新建 / 需扩展」状态标签，代表未来提案，不代表当前代码能力。

需要了解如何启动、测试与贡献，请先看仓库根目录的 [`README.md`](../README.md) 和 [`CONTRIBUTING.md`](../CONTRIBUTING.md)。
