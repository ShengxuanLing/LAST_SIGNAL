# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/) 风格，版本号语义参考 [Semantic Versioning](https://semver.org/)。

> 注意：代码版本号见 `package.json`（`version: 0.1.0`）。`0.2.0` 是一个**设计文档里程碑**——6 篇 `docs/` 设计审计文档在此阶段产出，但**未改动游戏源码、未授权实现任何功能**。代码版本在相关 PHASE 完成前仍保持 `0.1.0`。

## [Unreleased]

### 仓库美化（当前阶段，仅文档与资源，不改源码）
- 新增 `README.md`：项目简介、当前可玩特性、截图区、快速开始、操作表、测试命令、项目结构、已有设计文档列表、路线图简述、已知限制、许可。
- 新增 `LICENSE`：MIT 许可证（Copyright (c) 2026 LAST SIGNAL contributors）。
- 新增 `CHANGELOG.md`（本文件）。
- 新增 `CONTRIBUTING.md`：分支/提交规范、测试命令、双 Vite dev server（5173/5199）说明、忽略产物与 `docs/STYLE_GUIDE.md` 约定。
- 新增文档用资源 `assets/banner.svg`、`assets/social-preview.png` 与 `assets/screenshots/`（01–06，由仓库美化流程生成）。

## [0.2.0] — 设计审计文档（文档里程碑，非代码版本）

> 仅完成 `docs/` 下 6 篇技术设计与架构审计文档。**本阶段未授权实现**，不改源码、不装依赖、不提交功能代码；仓库 Git 基线在后续仓库发布阶段建立。代码 `version` 仍为 `0.1.0`。

- 新增 [`docs/PROJECT_ROADMAP.md`](docs/PROJECT_ROADMAP.md)：PHASE 0–5 路线图与 `0.2.0-alpha/beta/rc` 节奏。
- 新增 [`docs/ARCHITECTURE_DECISIONS.md`](docs/ARCHITECTURE_DECISIONS.md)：架构决策记录（ADR 集合）。
- 新增 [`docs/SIGNAL_SYSTEM_DESIGN.md`](docs/SIGNAL_SYSTEM_DESIGN.md)：Signal 系统技术设计（PHASE 2 提案）。
- 新增 [`docs/AGENT_BRIDGE_ARCHITECTURE.md`](docs/AGENT_BRIDGE_ARCHITECTURE.md)：Agent Bridge 与本机 Harness 接入设计（PHASE 3 提案）。
- 新增 [`docs/HUMAN_AGENT_COOP_DESIGN.md`](docs/HUMAN_AGENT_COOP_DESIGN.md)：Human–Agent Co-op 设计（PHASE 4 提案）。
- 新增 [`docs/IMPLEMENTATION_TASKS.md`](docs/IMPLEMENTATION_TASKS.md)：PHASE 0–5 实施工单拆解。
- 现状基线审计（逐文件复核真实源码）：确认源码中**无任何** WebSocket / MCP / Agent / Harness 代码；Signal Manipulation、Agent Bridge、Human+AI Co-op 一律为 `0.2.0` 提案。

## [0.1.0] — 可玩基线

> 初始可玩纵向切片（playable vertical slice）。首个可玩版本。

### 新增
- 主菜单与 `NEW RUN` 入口（`LOAD RUN` / `CONTINUE` 预留但暂未实现）。
- 等距（isometric）程序化地牢：房间深度结构、单纹理烘焙、`MapGenerator` 生成 5–9 个房间。
- 战斗核心：WASD 移动、鼠标瞄准、按住左键射击、`SPACE` 冲刺；4 型敌人（drone / stalker / hunter / sentinel）随深度解锁。
- 武器系统：4 把武器（Pulse Rifle / Scatter Gun / Plasma Cannon / Arc Drone），`Q`/`E` 切换，弹匣自动换弹。
- 成长系统：经验 / 等级、3 选 1 升级卡（12 项升级）、资源 / 信用点掉落。
- Boss 房与 Boss 弹幕，击破推进。
- 暂停面板（`ESC`）、局内统计、GameOver 结算、小地图与相机跟随/缩放。
- 本地存档 `SaveSystem`（localStorage，版本号 + 校验 + 安全回退），持久化永久统计与设置。
- Web Audio 程序化音效（`AudioSystem`），无外部音频资源。
- 程序化美术（Canvas 生成，无外部图片资源），配套 [`docs/STYLE_GUIDE.md`](docs/STYLE_GUIDE.md)。
- 测试基线：Vitest 单测（`src/core/runtime.test.ts`，7 个用例）+ Playwright E2E（`tests/` 下 audit / canvas / gameplay / boss-room / runtime-bugs）。
