# 设计文档索引

本目录包含 **LAST SIGNAL** 的美术风格指南，以及 `0.2.0 Technical Design & Architecture Audit` 阶段产出的设计、路线图与架构审计文档。

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

## 当前实现边界

- `0.1.0` 是**可玩纵向切片**：程序化地图、战斗、升级、Boss、暂停、结算、本地永久存档与基础音效已实现。
- Signal Manipulation、Agent Bridge、Human+AI Co-op **目前只有设计文档，尚未实现**；代码中没有 WebSocket / MCP / Agent / Harness。
- `LOAD RUN` / `CONTINUE` 暂未实现；当前只能从 `NEW RUN` 开始。
- 设计文档里大量 `TBD — Requires User Decision` 与「需新建 / 需扩展」状态标签，代表未来提案，不代表当前代码能力。

需要了解如何启动、测试与贡献，请先看仓库根目录的 [`README.md`](../README.md) 和 [`CONTRIBUTING.md`](../CONTRIBUTING.md)。
