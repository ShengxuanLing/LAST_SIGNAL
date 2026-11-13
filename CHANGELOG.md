# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/) 风格，版本号语义参考 [Semantic Versioning](https://semver.org/)。

> 注意：代码版本号见 `package.json`（`version: 0.1.0`）。`0.2.0` 是一个**设计文档里程碑**——6 篇 `docs/` 设计审计文档在此阶段产出，但**未改动游戏源码、未授权实现任何功能**。代码版本在相关 PHASE 完成前仍保持 `0.1.0`。

## [Unreleased]

> 本节记录本分支的改动。其中「仓库美化与 CI 稳定性修复」为继承自 `main` 基线的历史记录——`README.md`、`LICENSE`、`CONTRIBUTING.md`、`docs/README.md` 与 `assets/` 在 `main` 上已存在，本分支并未重新新增这些文件；本分支净新增内容见「局内检查点与永久进度」。

### 武器库存

- 暂停时可在库存中点选已持有的武器，装备标记随选择更新。

### 仓库美化与 CI 稳定性修复
- 新增 `README.md`：项目简介、当前可玩特性、截图区、快速开始、操作表、测试命令、项目结构、已有设计文档列表、路线图简述、已知限制、许可。
- 新增 `LICENSE`：MIT 许可证（Copyright (c) 2026 LAST SIGNAL contributors）。
- 新增 `CHANGELOG.md`（本文件）。
- 新增 `CONTRIBUTING.md`：分支/提交规范、测试命令、双 Vite dev server（5173/5199）说明、忽略产物与 `docs/STYLE_GUIDE.md` 约定。
- 新增 `docs/README.md`：设计文档索引与历史快照说明。
- 新增文档用资源 `assets/banner.svg`、`assets/social-preview.png` 与 `assets/screenshots/`（01–06，由仓库美化流程生成）。
- 修正 `tests/runtime-bugs.spec.ts` 的硬编码 Windows 路径；CI 通过 `LAST_SIGNAL_ROOT` 指向仓库根目录。
- 放宽 Boss HP 条在屏震下的坐标断言，避免非确定性抖动导致 CI 误报。
- 调整 `src/scenes/LevelUpScene.ts` 的描述文本换行宽度，适配 Linux CI 字体回退；对应回归断言输出诊断 JSON。
- Boss HP 条回归改为按实时相机变换计算采样区域，避免屏震偏移导致误报。

### 局内检查点与永久进度
- 引入局内检查点（checkpoint）与永久进度分离：`SaveData` 新增可选 `run` 字段（当前一局的房间进度、生命、经验、弹药、信用点、升级卡与未捡掉落）以及永久 `cores` 字段（击败 Boss 获得的永久核心）。
- 存档版本 `SAVE_VERSION` 由 `1` 升至 `2`；旧存档（version 不匹配）在加载时按字段迁移，保留有效的永久设置、统计、武器解锁与已有永久加成（字段缺失 / 非法则回退默认值，绝不静默销毁有效数据）；已是当前版本的存档其 `run` 检查点经 `validateCheckpoint` 校验，有效则保留、无效则丢弃。
- 主菜单 `NEW RUN` 开始时覆盖旧检查点，`LOAD RUN` / `CONTINUE` 可查看 / 直接恢复检查点；死亡或击败 Boss 进入结算时清除这局的 `run` 检查点，信用点与升级卡不计入永久档。
- 集成复检后修复：resume 复用 checkpoint `runId`、恢复保存 HP、旧存档迁移保留有效 `run`、多级 XP 用队列逐个升级、缓存 settings 避免每帧解析存档；新开局不再误弹 `ROOM CLEARED`。
- 新增 Playwright 端到端回归 `tests/checkpoint.spec.ts`，覆盖清房续局、resume 稳定 id 与 HP 恢复、死亡清档、局内升级 / 永久天赋隔离；单测扩至 15 个，文档计数同步。

### docs: archive Game Design Bible and design alignment artifacts
- 新增 [`docs/GAME_DESIGN_BIBLE.md`](docs/GAME_DESIGN_BIBLE.md)：归档版 Game Design Bible（V1.0 Draft），作为统一世界观、核心玩法、叙事、AI 角色与开发方向的权威设计方向依据。
- 新增 [`docs/GAME_DESIGN_BIBLE_ALIGNMENT.md`](docs/GAME_DESIGN_BIBLE_ALIGNMENT.md)：设计对齐报告，记录 GDB 与 `0.2.0` 设计审计文档、`0.1.0` 可玩切片的对齐分析。
- 新增 [`docs/DESIGN_DECISION_REGISTER.md`](docs/DESIGN_DECISION_REGISTER.md)：待决问题登记册，汇总对齐过程中需用户决策的设计问题及状态。
- 本次仅归档与设计分析，不涉及源码实现；GDB 是设计方向依据，Signal Manipulation / Agent Bridge / Human+AI Co-op 仍为设计提案，未因归档而自动实现。代码 `version` 仍为 `0.1.0`。
- 补录 [`docs/ECONOMY_MODE.md`](docs/ECONOMY_MODE.md) 到 `docs/README.md` 索引；该文件由远端 `f01e3f0` 引入，本次未改动其正文。

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
- 主菜单与 `NEW RUN` 入口（`LOAD RUN` / `CONTINUE` 在 `0.1.0` 基线仅作预留；后续「局内检查点与永久进度」改动中已实装）。
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
