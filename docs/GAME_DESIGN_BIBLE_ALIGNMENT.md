# LAST SIGNAL — Game Design Bible 设计对齐报告

> **2026-11-11 GDD-02 补充**　本报告主体保留归档时点。用户现已明确批准首切片必须击败 Warden 才可进入结尾，以及仅门、中继器、预设桥梁、敌人感知连接四类可操纵目标。D4 仅原则批准状态表、安全恢复及非法零扣费，D3、D5–D9 仅原则认可。新增细则见[规则规格](REALITY_ENGINEERING_RULES.md)、[因果链](VERTICAL_SLICE_CAUSAL_CHAINS.md)、[测试规格](GDD_02_TEST_SPEC.md)与[复核报告](GDD_02_REVIEW_REPORT.md)，批准范围见[登记册第 7 节](DESIGN_DECISION_REGISTER.md#7-gdd-02-决策记录2026-11-11)。本次不改 GDB 原文、不实施功能，主体中撤离胜利候选及“先收敛全部未决项”的建议须按本补充限定到本轮授权范围。

> **审查对象：** [`GAME_DESIGN_BIBLE.md`](GAME_DESIGN_BIBLE.md) V1.0 Draft（归档版）  
> **审查范围：** GDB 全文、现有 7 份 `docs/` 技术/美术文档、当前 `main` 源码与测试、GitHub Actions 状态  
> **归档时点：** 本地已快进到远端 `main` `f01e3f0fbcede3704b1f0759d492c86a52aedd1b` 后；本次新增/修改仍为 docs-only 工作区改动  
> **授权边界：** GDB 第 20 章明确「当前仅授权设计分析，不授权直接修改源码」。本报告不执行实现，不批准参数，不冻结剧情，不把创意提案写成已实现功能。  
> **配套文档：** [`DESIGN_DECISION_REGISTER.md`](DESIGN_DECISION_REGISTER.md)

---

## 1. 审查结论

**结论：方向一致，无阻断性架构冲突；但存在若干需要登记/冻结的语义差异与历史状态差异。**

1. GDB 把项目从「2.5D 等距射击 Roguelite + Signal Manipulation + Agent Co-op」进一步明确为 **2.5D Reality-Engineering Action Roguelite**。这不是推翻现有技术文档，而是在产品层给出辨识度与统一叙事；`SIGNAL_SYSTEM_DESIGN.md` 的 Signal 基础能力与 `HUMAN_AGENT_COOP_DESIGN.md` 的 Mode A/B/C 仍可作为实现层基础。
2. GDB 第 0.3 章对「产品方向 / 候选设定 / 待冻结规则 / 已实现功能」的区分，与现有 `0.2.0` 审计文档大量使用 `【已实现】 / 【需新建】 / 【需扩展】 / TBD — Requires User Decision` 的状态标签一致。归档后仍必须保持这套诚实边界。
3. 当前源码里 **Signal Manipulation、Reality Engineering、Agent Bridge、MCP、Human+AI Co-op、ECHO 均未实现**；`README.md` 与 `docs/README.md` 已有相同声明。GDB 归档不会自动改变这一事实。
4. 已实现的局内检查点 / 永久进度，以及远端 `f01e3f0` 新增的可选补给终端 / 局内信用点，是工程能力，不等同于 GDB 的 Knowledge / Engineering / World Progression；后者仍需设计冻结。
5. GDB 第 15.2 章的 `master`、`ae91596`、7/7 Vitest、7/7 Playwright 等是 **P0.1 历史验收快照**，不是当前事实；下文第 3 节给出校正。
6. GDB 第 20 章要求「输出设计对齐报告」。本报告即为该要求的交付物；未授权的实现工作仍等待用户后续明确指令。

**状态图例：** `一致` = 现有文档已有同向设计；`部分对齐` = 概念方向一致但语义/范围/参数未冻结；`冲突` = 需要澄清或 ADR 裁决；`尚未实现` = 源码中没有该能力，仅存在于设计文档；`历史快照` = 当时事实，不应继续当作实时状态。

---

## 2. 一致性矩阵

| # | GDB 概念 | GDB 章节 | 与现有文档的关系 | 当前源码状态 | 结论 / 后续动作 |
|---:|---|---|---|---|---|
| 1 | 一句话定位：Reality Engineering、人+AI 共同探索失稳宇宙 | 1.1 | 与 `PROJECT_ROADMAP.md` / `SIGNAL_SYSTEM_DESIGN.md` 的 Signal + AI 路线同向，但现有文档偏技术描述，缺少统一世界观 | 仍是 `0.1.0` 可玩纵向切片 | **部分对齐**；把 GDB 作为产品层最高方向，技术文档继续定义实现 |
| 2 | Observe → Hypothesize → Experiment → Understand → Manipulate → Consequence | 1.3 | `SIGNAL_SYSTEM_DESIGN.md` 有 Scan/Jam/Decoy 与确定性传播，但未把「知识成长/实验推理」写成核心循环 | 未实现 | **部分对齐**；需 ADR 定义实验记录、假设状态、反馈与验收 |
| 3 | 三大支柱：知识即力量、改变原因、两个不完整意识 | 1.4 | 与 `HUMAN_AGENT_COOP_DESIGN.md` 的人类/Agent 分工同向，但该文档明确「Physical Core / Signal Core 只做权限分工，不做人格」 | 未实现 | **冲突/需澄清**；必须区分「叙事角色 ECHO」与「控制权限层」，不可把 GDB 人格设定直接塞进 Input Arbitration |
| 4 | 共识场边界：非万能、仅协议接口/不稳定目标、可预测、有代价 | 2.2 | 与 `SIGNAL_SYSTEM_DESIGN.md` 的确定性、坐标铁律、无隐藏信息原则同向 | 未实现 | **一致**；把 8 条边界写入未来 Reality Protocol 状态机的硬约束 |
| 5 | 大静默、Station Zero、五幕叙事 | 2.4–2.5、10 | 现有 6 份 `0.2.0` 文档没有系统叙事设定；`PROJECT_ROADMAP.md` PHASE 1 仅把「世界观」列为待办 | 未实现 | **尚未实现**；候选设定，不得视为已批准规格 |
| 6 | 玩家身份谜团、ECHO 记得未发生事件 | 3.3、4.1 | 现有文档无对应叙事状态 | 未实现 | **尚未实现**；需 GDD-01 与剧情状态 ADR |
| 7 | ECHO 作为第二主角、独立意识、长期目标 | 4.1–4.5 | 与 `HUMAN_AGENT_COOP_DESIGN.md` 的 Mode A/B/C 有张力：后者是控制模式与权限仲裁，不定义角色人格 | 未实现 | **冲突/需澄清**；建议新增 `ECHO Identity Layer`，与 `InputArbitrator` 解耦 |
| 8 | ECHO 三层模型：Identity / Reasoning / Action | 4.4 | `AGENT_BRIDGE_ARCHITECTURE.md` 的 Game Adapter / Observation / Action 边界可承接 Action Layer；Identity 与 Reasoning 未定义 | 未实现 | **部分对齐**；Identity 必须由游戏系统管理，Reasoning 可接 LLM，Action 必须走正式 API |
| 9 | AI 权限边界：不能改 HP、造物、绕过冷却、读隐藏状态、改存档 | 4.6 | 与 `AGENT_BRIDGE_ARCHITECTURE.md` 的白名单、schema、输入意图、隐藏信息黑名单、API Key 不入前端完全一致 | 未实现 | **一致**；作为 Bridge 硬约束保留 |
| 10 | Scan / Jam / Decoy | 5.2–5.4 | `SIGNAL_SYSTEM_DESIGN.md` 已把它们列为 PHASE 2 核心；`AGENT_BRIDGE_ARCHITECTURE.md` 的 `action_signal` 也保留候选 ability | 未实现 | **一致**；但 GDB 要求「真实改变游戏状态」，不能只做 UI |
| 11 | Signal Energy：上限 100、恢复数值 5，但时间单位未冻结 | 5.5 | `SIGNAL_SYSTEM_DESIGN.md` 把 Signal Energy 列入 PHASE 2，具体数值/规则大量 `TBD` | 未实现 | **部分对齐**；必须 ADR 冻结每秒恢复、消耗、冷却、跨房间、暂停计时 |
| 12 | ANCHOR / SEVER / RELAY / INVERT | 6 | 现有 Signal 文档主要覆盖 Scan/Jam/Decoy 与环境设施，未定义四个高级协议的状态机 | 未实现 | **缺口**；不应第一阶段全部实现，需先定组合规则 |
| 13 | 协议组合可预测，不由 LLM 即兴决定 | 6.5、7.4 | 与 `ARCHITECTURE_DECISIONS.md` 的确定性重放、RNG、事件通道待定项同向 | 未实现 | **一致**；必须用确定性状态机/规则表 |
| 14 | Signal 是基础，Reality Engineering 是上层 | 7.1 | `SIGNAL_SYSTEM_DESIGN.md` 定义传播/衰减/感知；缺少上层协议依赖模型 | 未实现 | **部分对齐**；两者应共享事件与坐标系，不能做成两套无关技能 |
| 15 | `wx / wy` 网格坐标，禁止混用屏幕像素 | 7.2 | `ARCHITECTURE_DECISIONS.md` 的「坐标铁律」逐字一致 | 已修复历史坐标/半径/屏震问题，`World.worldToScreen()` / `screenToWorld()` 可复用 | **一致**；继续作为硬约束 |
| 16 | 可验证因果：封锁信号 → Jam → 门开 → 恢复信号 | 7.4 | `SIGNAL_SYSTEM_DESIGN.md` 的确定性传播与测试房间可承载 | 未实现 | **一致**；首个 Vertical Slice 必须用真实状态机验收 |
| 17 | 三种战斗路径：Direct / Signal Warfare / Reality Engineering | 8 | 现有 `src/entities/Enemy.ts` 仅距离 aggro；设计文档提出敌人感知接入 FSM | 直接战斗已实现；后两者未实现 | **部分对齐**；需敌人信息依赖模型 |
| 18 | 敌人按信息依赖区分 | 8.3 | 现有 `src/config/enemies.ts` 主要是血量/速度/攻击差异；`SIGNAL_SYSTEM_DESIGN.md` 提出扩展 | 部分类型已存在，但无信号依赖 | **尚未实现**；需数据驱动配置，不盲目加敌人数 |
| 19 | 首个 Boss 复用 Warden，护盾/场地与 Signal 关联 | 8.4、11.7 | 现有 `Boss.ts` 已有 Warden 三阶段与弹幕；设计文档尚无信号护盾规则 | Boss 可玩，信号关联未实现 | **部分对齐**；胜利条件必须先冻结 |
| 20 | Knowledge / Engineering / World Progression | 9.2 | 现有 `SaveSystem` / `RunCheckpoint` 已支持 run 检查点与永久 `cores` / 天赋；`ARCHITECTURE_DECISIONS.md` 的存档 v2 提案仍是旧快照 | 局内/永久进度已实现；知识、协议权限、世界状态变量未实现 | **部分对齐**；需要新的存档/状态 ADR，避免覆盖现有 checkpoint |
| 21 | 有限世界状态变量 + 关卡模板 + 明确后果 | 9.3 | 现有随机地图、房间角色与 checkpoint 已存在；没有持久世界状态变量 | 未实现 | **部分对齐**；可复用 `SaveData` 与 `MapGenerator`，但需新增白名单字段 |
| 22 | 五幕结构与叙事原则 | 10 | `PROJECT_ROADMAP.md` PHASE 1 仅列「世界观」，无剧本 | 未实现 | **尚未实现**；候选设定，第一阶段不锁死真相 |
| 23 | Vertical Slice：Station Zero — The Broken Door，四房间 + 结尾选择 | 11 | 现有 `MapGenerator` 是随机房间；GDB 明确要求初期手工关卡，不依赖随机地图碰巧生成谜题 | 随机地牢已实现，手工切片未实现 | **缺口**；需新关卡模块或数据驱动房间模板 |
| 24 | Scan/Jam/Decoy 真实改变状态、至少一条规则可自行发现、选择有后果 | 17 | 现有测试基础设施可复用，但没有对应机制 | 未实现 | **尚未实现**；必须配套单测 + 浏览器 E2E |
| 25 | 美术/音频：色彩语义、失稳视觉、声音作为线索 | 12–13 | `STYLE_GUIDE.md` 已有青色=系统/我方、红/橙/紫/金=威胁的生效规范；`AudioSystem.ts` 为程序化音效 | 基础渲染/音效已实现；GDB 的语义色与信息音未实现 | **部分对齐 / 需验证**；GDB 冷蓝/青/琥珀/白/灰语义与 STYLE_GUIDE 需调和并做可读性验证 |
| 26 | Mode A Human / Mode B Agent / Mode C Co-op | 14.2 | `HUMAN_AGENT_COOP_DESIGN.md` 逐字定义三模式，Mode A 默认且无 AI 可独立运行 | 未实现 | **一致**；GDB 的「人类 / ECHO 初期分工」比现有权限表更叙事化，需协调 |
| 27 | Agent Bridge 链路：Game Core → Adapter → WebSocket → MCP → Harness | 14.3 | `AGENT_BRIDGE_ARCHITECTURE.md` 的进程/数据/信任边界更具体；`ARCHITECTURE_DECISIONS.md` 已登记 ADR | 未实现 | **一致**；GDB 是方向，现有文档是实现约束 |
| 28 | ECHO 连续身份独立于模型；Canonical / Episodic / Hypothesis / Relationship / Narrative / Session 记忆 | 14.4–14.5 | 现有 Bridge 文档尚无角色身份与记忆持久化模块 | 未实现 | **缺口**；需 Identity Layer 与记忆 schema ADR，假设不得自动升格为事实 |
| 29 | 保留 Phaser 3.90 / TypeScript / Vite、不推倒现有工程 | 15.1、18 | 现有 6 份技术文档全部以复用为前提 | 已保留 | **一致** |
| 30 | 明确不做：自由规则编辑器、LLM 生成可执行逻辑、无限动态剧情、外 AI 依赖主线等 | 18 | 与现有文档「不把 MCP 塞进 Phaser 核心」「不暴露隐藏信息」「无 AI 也能玩」一致 | 当前无相关实现 | **一致**；作为范围护栏 |
| 31 | 第 20 章要求阅读「现有六份技术设计文档」并输出对齐报告 | 20、15.3 | `docs/` 实际有 7 份历史文档：6 份 `0.2.0` 审计文档 + `STYLE_GUIDE.md`；GDB 15.3 自身也列出 7 个文件 | 不适用 | **措辞差异**；本报告按 7 份全部审查，不据此改 GDB 原文 |
| 32 | 远端 `f01e3f0` 的可选补给终端 / 局内信用点 | GDB 未覆盖 | `docs/ECONOMY_MODE.md` 与 `src/economy/*` 已由远端提交引入，GDB 未定义该模式 | 已实现可选模式，CI 通过 | **缺口**；需登记为 GDB 未覆盖的既有功能，后续决定其是否纳入核心循环 |

---

## 3. 当前工程事实校正

GDB 第 15.2 章写的是 **P0.1 验收报告的历史结果**：

> `Git 分支：master`、`ae91596f...`、Typecheck PASS、Vitest 7/7、Playwright 7/7、Vite Build PASS。

这些句子在当时成立，但**不能作为本次归档后的实时状态**。本次对齐时核实到的事实如下：

| 项 | 本次归档时事实 | 证据 |
|---|---|---|
| 代码版本 | `package.json` 仍为 `0.1.0` | `package.json` |
| 当前分支 | `main`，已快进到 `origin/main` | `git status -sb` / `git log -1 --decorate` |
| 本地/远端 HEAD | `f01e3f0fbcede3704b1f0759d492c86a52aedd1b` | `git rev-parse HEAD` / `git ls-remote --heads origin main` |
| 关键历史提交 | `40c0969` 合并 checkpoint 功能；`f01e3f0` 新增可选补给终端 | `git log --oneline --decorate --graph --all` |
| 已实现功能 | 7 场景、4 武器、12 升级、5 类敌人、Boss、随机地图、局内检查点、`LOAD RUN` / `CONTINUE`、永久 `cores` / 天赋、可选补给终端 | `README.md`、`docs/README.md`、`docs/ECONOMY_MODE.md`、源码 |
| 仍未实现 | Signal Manipulation、Reality Engineering、Agent Bridge、MCP、Human+AI Co-op、ECHO | `README.md` 已知限制；设计文档状态标签 |
| 最近一次本地验证 | `npm run typecheck` 退出码 0；`npm test` 15/15；`npx playwright test --list` 列出 10 个测试 | 本次命令输出 |
| 远端 CI | `f01e3f0` 的 `Add optional run economy and supply terminals` run `42993994634` success；`40c0969` 的 merge run `42914739337` success | `gh run list --branch main --limit 5` |
| `LOAD RUN` / `CONTINUE` | 已不再是「暂未实现」，而是可查看 / 恢复检查点 | `README.md`、`docs/README.md`、`tests/checkpoint.spec.ts` |
| 存档 | `SAVE_VERSION` 已升至 2；run 与 permanent 分离；死亡/结算清 run | `CHANGELOG.md`、`src/systems/RunCheckpoint.ts`、`src/systems/SaveSystem.ts` |

> 注：上述测试数字是本次本地命令结果，不是永久保证；后续任何实现仍必须重新跑 `typecheck` / 单测 / 构建 / Playwright / CI。

---

## 4. 需要修改或补充的设计假设

以下条目应进入后续 ADR 或设计评审，**本报告不直接改写 6 份历史技术文档**：

1. **PHASE 定义冲突：** GDB 第 16 章使用 `GDD 阶段 + P0–P5 + Electron`；现有 6 份文档使用 `PHASE 0–5 + 0.2.0-alpha/beta/rc`。需要先决定以哪套为准，再同步 `PROJECT_ROADMAP.md` / `IMPLEMENTATION_TASKS.md`。
2. **存档 v2 已落地：** `ARCHITECTURE_DECISIONS.md` 仍把 `SAVE_VERSION=2`、`LOAD RUN` / `CONTINUE`、局内快照写成候选。现在 checkpoint 已实现且 Playwright 覆盖，需新增「历史设计文档快照」说明或后续授权更新，不得让旧 TBD 继续冒充当前缺口。
3. **World Progression 边界：** 现有 checkpoint 是「一局 run 状态 + 永久 cores/talents」，不是知识档案、协议权限或世界状态变量。GDB 的三类长期成长需要新字段，必须评估是否升 `SAVE_VERSION=3`，以及旧存档迁移。
4. **ECHO 人格 vs 控制角色：** 现有 co-op 文档明确 Physical Core / Signal Core 不做人格；GDB 把 ECHO 定义为第二主角。应拆为「叙事身份层」与「输入/权限仲裁层」，避免让 LLM 人格直接驱动世界状态。
5. **手工 Vertical Slice vs 随机地图：** GDB 第 11.3 明确「初期使用手工设计关卡，不依赖随机地图恰好生成正确谜题」。现有 `MapGenerator` 可继续服务主模式，但首个切片需要独立的手工/模板房间数据。
6. **高级协议范围：** ANCHOR/SEVER/RELAY/INVERT 是候选，不应在 P1 全部实现；现有 Signal 文档只覆盖 Scan/Jam/Decoy，需要新增 Reality Protocol 模块边界。
7. **色彩语义：** GDB 的「冷蓝稳定 / 青色可交互 / 琥珀未知 / 红色敌对 / 白色高优先级 / 灰黑失去观测」与 `STYLE_GUIDE.md` 现行「青色系统/我方，红橙紫金威胁」不完全同义。需 ADR 决定是否扩展色板，且必须做可读性与无障碍验证。
8. **可选补给终端：** 远端 `f01e3f0` 已新增 `/economy.html`、局内信用点、补给终端与 `tests/economy.spec.ts`。GDB 未覆盖它；后续需要决定它是独立可选模式、外围实验，还是吸收进 Engineering/World Progression。
9. **文档数量措辞：** GDB 第 20 章写「现有六份技术设计文档」，第 15.3 章列出 7 个文件。按实际 `docs/` 内容处理，不擅自改 GDB 原文。
10. **历史 Git/CI 描述：** 6 份 `0.2.0` 文档仍写「当前不是 Git 仓库」「PHASE 0 未授权」「4 个 Playwright 测试」等。`docs/README.md` 已用历史快照说明澄清；若用户要求，再统一更新原文。

---

## 5. 新增模块与任务清单

> 以下路径均为**候选模块边界**，尚未批准，不得据此创建源码。依赖列用于后续拆工单，避免并发写同一文件。

| 模块 / 工单 | 候选 owned files | 主要职责 | 依赖 | 执行关系 |
|---|---|---|---|---|
| GDD-01 术语与叙事状态 | `docs/GAME_DESIGN_BIBLE.md` 附录或新 ADR；`docs/DESIGN_DECISION_REGISTER.md` | 冻结 Consensus Field / The Silence / Station Zero / ECHO / Reality Engineering 等术语与叙事状态白名单 | 用户确认 | 先决，串行 |
| GDD-02 核心规则 | ADR + `SIGNAL_SYSTEM_DESIGN.md` 后续授权修订 | 可操纵目标、状态转换、资源、协议组合、失败代价 | GDD-01 | 先决，串行 |
| GDD-03 Vertical Slice 规格 | ADR + `IMPLEMENTATION_TASKS.md` 后续授权修订 | 四房间、教学顺序、谜题、Boss、结尾选择、自动化验收 | GDD-01/02 | 先决，串行 |
| Signal Core | `src/systems/signal/*`、`src/types/index.ts`、`src/config/*`、`src/core/runtime.test.ts` | Signal DTO、传播、衰减、生命周期、Energy、Scan/Jam/Decoy | 坐标/事件通道 ADR | 可与协议接口并行设计，实现需串行 |
| Reality Protocol | `src/systems/reality/*` 或 `src/world/RealityProtocol.ts` | 目标注册、前置条件、状态机、成本、失败、可观察反馈 | Signal Core 接口 | 依赖 Signal 数据模型；可与关卡数据并行 |
| Enemy Signal Behavior | `src/entities/Enemy.ts`、`src/config/enemies.ts`、单测 | 信息依赖、感知源、Jam/Decoy 响应、备用连接 | Signal Core | 与协议模块可并行，按文件边界拆 |
| World / Knowledge Progression | `src/systems/SaveSystem.ts`、`src/systems/RunCheckpoint.ts`、`src/types/index.ts`、迁移单测 | 知识档案、工程权限、有限世界状态变量、存档迁移 | 存档 ADR | 与 Signal 模块串行，避免同文件并发 |
| ECHO Identity & Memory | `src/systems/echo/*`（候选） | Canonical / Episodic / Hypothesis / Relationship / Narrative / Session；假设不自动升格 | Identity ADR | 可与 Bridge 设计并行，不与 Action API 混写 |
| ECHO Reasoning Adapter | 可选外部适配层，不进入实时循环 | 分析 observation、提出假设、表达不确定性 | Identity + Observation DTO | 后于 DTO 白名单 |
| ECHO Action Layer | 走既有 `action_signal` / Action API，不直接操作 Phaser | 合法 Scan/Jam/Decoy/设备操作 | Action API 权限 ADR | 后于 Bridge |
| Observation / Action API | `src/bridge/*` 候选、`server/*`、DTO schema、测试客户端 | 白名单 DTO、输入意图、权限校验、断线降级 | Bridge ADR | 与 MCP 进程可并行设计 |
| Local WebSocket / MCP Adapter | 独立 Node 进程、stdio、WebSocket、Harness 客户端 | 本机通信、鉴权、协议转换、日志脱敏 | 协议/端口/鉴权 ADR | 后于协议冻结 |
| Station Zero Slice | `src/scenes/*`、`src/world/*`、房间数据、`tests/*` | 四手工房间、破损之门、失稳走廊、Warden 信号护盾、结尾选择 | GDD-03、Signal、Protocol | 多模块集成，主助手统一验收 |
| Test & CI | `tests/*.spec.ts`、`src/**/*.test.ts`、`.github/workflows/ci.yml` | 单测、双端口 Playwright、确定性回放、Agent 断线降级 | 各功能 | 与功能同文件边界拆，最后统一回归 |

---

## 6. 可直接复用的现有功能

| 现有能力 | 证据 / 路径 | 可复用方式 | 注意事项 |
|---|---|---|---|
| Phaser 3.90 + TypeScript + Vite | `package.json`、`src/main.ts` | 保留渲染、场景、构建与测试基座 | 不推倒重写，不换引擎 |
| 7 个场景 | `src/main.ts` 注册 Boot/Preload/MainMenu/Game/LevelUp/GameOver/Pause | 新增 Station Zero 场景或复用 GameScene 数据驱动 | 不把 MCP/LLM 塞进实时循环 |
| 网格坐标与等距变换 | `src/core/iso.ts`、`src/world/World.ts` 的 `worldToScreen()` / `screenToWorld()` / `tileAt()` / `isWalkable()` | Signal 传播、协议目标距离、碰撞统一使用 `wx/wy` | 继续禁止混用屏幕像素 |
| 动作战斗基础 | `src/entities/Player.ts`、`src/entities/Enemy.ts`、`src/entities/Boss.ts`、`src/config/weapons.ts` | Direct Combat 路径、Warden 基础、输入链 | 敌人信息依赖需新增，不能只堆血量 |
| 房间与地图 | `src/world/MapGenerator.ts`、`src/world/WorldRenderer.ts` | 随机主模式、房间角色、渲染层 | GDB 首个切片要求手工/模板关卡，不能依赖随机地图生成谜题 |
| 升级与 HUD | `src/scenes/LevelUpScene.ts`、`src/scenes/GameScene.ts` | Engineering Progression 可挂接、升级选择队列已有修复 | 多级 XP 队列已实现，不要重复造 |
| 存档与检查点 | `src/systems/SaveSystem.ts`、`src/systems/RunCheckpoint.ts`、`tests/checkpoint.spec.ts` | run/永久分离、迁移、安全点写入、死亡清档 | 知识/世界状态若新增字段，需新 ADR 与迁移测试 |
| 永久进度 | `README.md`、`CHANGELOG.md`、`src/systems/SaveSystem.ts` | `cores` / `PERMANENT TALENTS` | 仅数值/天赋，不等于 Knowledge Progression |
| 可选补给终端 | `docs/ECONOMY_MODE.md`、`economy.html`、`src/economy/*`、`tests/economy.spec.ts` | 局内信用点、购买写入 checkpoint、独立入口 `/economy.html` | GDB 未定义；是否纳入核心循环待确认 |
| 程序化美术 | `src/core/GraphicsFactory.ts`、`src/world/WorldRenderer.ts`、`docs/STYLE_GUIDE.md` | 几何极简、无外部图片、语义色 | GDB 色彩语义需与 STYLE_GUIDE 调和并做无障碍验证 |
| 程序化音频 | `src/systems/AudioSystem.ts` | 稳定/失稳信号音、Scan/Jam/Decoy 信息音 | 当前不是信息线索系统，需真实状态驱动 |
| 事件总线占位 | `src/core/eventbus.ts`、`src/types/index.ts` | 可选 observation/event 通道候选 | 旧审计确认 `gameBus` 暂无消费者；不得写成已有 Signal 总线 |
| 测试与 CI | `src/core/runtime.test.ts`、`tests/*.spec.ts`、`.github/workflows/ci.yml` | Vitest、Playwright、双 Vite 端口、CI 门禁 | 新增机制必须补单测 + E2E，不能用测试通过掩盖不能玩 |

---

## 7. 首个 Vertical Slice 最小实现范围

### 7.1 必须做

1. **手工/模板关卡**：苏醒舱、观测实验室、失稳走廊、共识核心 + 撤离/结尾选择；不依赖随机地图碰巧生成正确谜题。
2. **一条真实规则链**：封锁信号 → 门关闭 → Scan 观测 → Jam 中断 → 门开启 → 恢复信号 → 门重新受控。必须由确定性状态机驱动。
3. **一个双影响协议**：中继器恢复桥梁的同时激活敌人感知；至少提供 Direct Combat / Jam / Decoy 两种机制上不同的解法。
4. **Scan / Jam / Decoy 均真实改变状态**：不是 UI 动画，不是提示文字，必须产生可观察、可测试的世界状态变化。
5. **ECHO 最小闭环**：预定义逻辑的独立观察、至少一次与玩家不同但合理的目标、对话绑定真实游戏事件；不连接外部 LLM 也能完整通关。
6. **一个世界状态变量**：结尾选择写入持久化状态，并在下一局产生可观察差异。
7. **Warden 信号护盾**：复用现有 Boss，至少让 Signal 状态影响护盾/场地；常规战斗仍可取胜。
8. **验收证据**：单测、浏览器 E2E、关键状态记录/复现、Agent 断线不崩溃的降级测试。

### 7.2 可推迟

- ANCHOR / SEVER / RELAY / INVERT 全套实现。
- 五幕完整剧情、全部结局、ECHO 最终身份揭示。
- 真实 LLM 推理、MCP Adapter、外部 Harness 联调。
- 完全动态世界、无限分支剧情、Electron 桌面化。
- 大量新敌人/武器/数值升级。

### 7.3 明确不做

沿用 GDB 第 18 章：不做自由世界规则编辑器、不让 LLM 生成可执行游戏逻辑、不以特效替代真实状态机、不依赖外部 AI 才能通关、不推翻现有 Phaser 工程、不在 Web 玩法稳定前迁移 Electron。

### 7.4 可验收条件

必须逐项覆盖 GDB 第 17 章 12 条，并把「玩家是否真正体验到『理解世界规则 → 操纵现实 → 改变结果』」作为核心判据。最低证据包括：

- `npm run typecheck` 退出码 0；
- `npm test` 全通过，并包含协议状态机/存档迁移新单测；
- `npm run build` 退出码 0；
- 双端口 Playwright E2E 全通过，`CONSOLE ERRORS: 0`、无 `pageerror`；
- 至少一条规则可在不阅读背景设定时被玩家通过实验发现；
- 至少一个障碍有两种机制上不同的解法；
- 不连接外部 LLM 时完整通关；
- 关键状态变化可记录、可复现；
- Agent 断线时游戏安全降级，不崩溃。

---

## 8. 必要 ADR 清单

| ADR 候选 | 必须回答的问题 | 关联 GDB / 现有文档 | 状态 |
|---|---|---|---|
| ADR-GDB-01 术语与权威层级 | GDB、6 份审计文档、STYLE_GUIDE 冲突时谁优先；候选设定如何升级为冻结规则 | GDB 0.3、15.3、20；`docs/README.md` | 待定 |
| ADR-GDB-02 GDD-01/02/03 冻结顺序 | 世界观术语、核心规则、Vertical Slice 的验收顺序与产物 | GDB 16 | 待定 |
| ADR-GDB-03 PHASE 编号对齐 | GDB P0–P5 与现有 PHASE 0–5 / 0.2.0 节奏如何统一 | GDB 16；`PROJECT_ROADMAP.md` | 待定 |
| ADR-GDB-04 Signal Energy | 100 上限、恢复 5 的时间单位、技能消耗、冷却、跨房间恢复、暂停计时 | GDB 5.5；`SIGNAL_SYSTEM_DESIGN.md` | 待定 |
| ADR-GDB-05 协议状态机 | 目标类型、前置条件、状态转换、成本、时限、失败、反馈、测试方法 | GDB 5.1、6、7.4 | 待定 |
| ADR-GDB-06 坐标与半径 | `wx/wy` 唯一语义、Signal 半径/falloff 与既有碰撞单位 | GDB 7.2；`ARCHITECTURE_DECISIONS.md` 坐标铁律 | 待定 |
| ADR-GDB-07 事件通道与确定性 | 复用 `gameBus` 还是新建 Signal 专线；tick、重放、暂停时事件丢弃规则 | GDB 7.3；`ARCHITECTURE_DECISIONS.md` TBD-01/02 | 待定 |
| ADR-GDB-08 存档与世界状态 | Knowledge / Engineering / World Progression 字段、是否升 v3、迁移与回滚 | GDB 9.2/9.3；现有 `RunCheckpoint` | 待定 |
| ADR-GDB-09 ECHO 身份与控制 | 叙事身份层、记忆 schema、与 Physical/Signal Core 权限层的边界 | GDB 4、14.4/14.5；`HUMAN_AGENT_COOP_DESIGN.md` | 待定 |
| ADR-GDB-10 Observation DTO 白名单 | 人类/ECHO 各自可见字段，隐藏状态黑名单，刷新频率 | GDB 4.3、14.3；`AGENT_BRIDGE_ARCHITECTURE.md` | 待定 |
| ADR-GDB-11 Action API 权限 | ECHO 可执行动作、资源/冷却校验、人类最终接管、禁止直接改世界 | GDB 4.6、14.3；现有 Action API 候选 | 待定 |
| ADR-GDB-12 Agent 断线降级 | OFFLINE / FAULT / YIELDED 语义，Mode A 无 AI 可通关，自动回切策略 | GDB 14.2、17；`HUMAN_AGENT_COOP_DESIGN.md` | 待定 |
| ADR-GDB-13 Vertical Slice 胜利条件 | Warden 常规击败 / 环境削弱 / 完成目标撤离的合法条件 | GDB 11.7、17 | 待定 |
| ADR-GDB-14 手工关卡集成 | 模板房间数据格式、与随机 MapGenerator 的边界、测试探针 | GDB 11.3；现有 `World` / `MapGenerator` | 待定 |
| ADR-GDB-15 色彩/音频语义 | GDB 语义色与 STYLE_GUIDE 调和、无障碍验证、声音是否传递真实状态 | GDB 12/13；`STYLE_GUIDE.md` | 待定 |
| ADR-GDB-16 可选补给终端归属 | `f01e3f0` 的 economy 模式是否纳入核心循环、如何与 Knowledge/World Progression 兼容 | `docs/ECONOMY_MODE.md`；GDB 9 | 待定 |
| ADR-GDB-17 自动化测试策略 | 协议单测、确定性回放、浏览器 E2E、CI 门禁与截图/日志落盘 | GDB 17；现有 CI | 待定 |

---

## 9. 风险与下一步

**风险**

- 把 GDB 的 V1.0 创意提案误当成已批准技术规格，直接开工写 Signal / ECHO / 剧情。
- 把 ECHO 人格与输入仲裁混为一层，导致 LLM 直接影响世界状态或绕过权限。
- 直接扩展现有 `SaveData` 而不做迁移/回滚 ADR，破坏已通过的 checkpoint 功能。
- 用随机地图凑首个 Vertical Slice 谜题，导致关卡不可复现、无法验收。
- 把「编译通过 / 单测通过」当作「玩家真的理解了世界规则并改变了结果」。
- 把远端 `f01e3f0` 的可选 economy 模式误写成 GDB 已定义的核心玩法。

**下一步（等待用户授权）**

1. 先收敛 [`DESIGN_DECISION_REGISTER.md`](DESIGN_DECISION_REGISTER.md) 中 `NEEDS_USER_DECISION` 条目，尤其 PHASE 定义、GDD-01/02/03、ECHO 身份边界、存档 v3、Vertical Slice 胜利条件。
2. 用户确认后，再按文件边界拆多任务/多子智能体工单；依赖串行、独立模块并行，主助手统一集成与全量验证。
3. 任何实现都必须保持 `README.md` 的诚实边界：GDB 归档不等于 Signal / Agent Bridge / Human+AI Co-op 已实现。
4. 若用户要求同步历史技术文档，再单独授权更新 `PROJECT_ROADMAP.md` / `IMPLEMENTATION_TASKS.md` / `ARCHITECTURE_DECISIONS.md` 中的历史 Git/CI/存档状态；本报告不擅自改写它们。
