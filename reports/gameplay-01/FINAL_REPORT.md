# GAMEPLAY-01 — 最终工程交付报告

日期：2026-11-19。分支：`feat/gameplay-01-ai-cooperation`。

状态：**ENGINEERING PASS / HUMAN ACCEPTANCE PENDING。** 独立审查在所述工程功能、测试和权限范围内通过，无未关闭阻断；单轮全绿不保证所有负载与种子稳定。没有真人试玩记录，不宣称产品体验已最终验收。未推送、未创建 PR、未合并 main。

## 交付行为

普通主菜单的 `DEMO 01 · LINKED SENTRY` 是正式 World 的协作内容切片（开发阶段称 Demo-03，保留已有入口名称）。设备、敌人、能量、冷却、伤害和通关状态实际改变，不靠动画模拟。

- Scan 提供合法感知内的设备证据；Jam 消耗 25 点能量，在有效窗口抑制关联哨兵的新开火，既有弹丸继续有效。手动关闭 Relay 也能改变局面。
- Relay ACTIVE / INACTIVE 分别提供不同目的地；JAMMED / DISABLED 不匹配路线。清房由 core 唯一提交，World 门户和 Headless 投影读取相同状态。未清房、无可用路线时不能通过门户。
- ECHO 使用同一 Controller 和核心动作，保留手动跟随/驻守，增加观察、感知记忆、离线本地建议和显式同意后的低风险合作。低风险开关默认关闭，不授权扫描、Jam、设备操作或攻击。
- 本地扫描/设备建议必须由人类边界确认，再入队下一处理 tick；同一时刻最多一个待提交动作。暂停不 flush，不重复确认，不把 Queued 写成 Done。外部模型沿用正式 Companion/Owner 能力机制，来源不与本地建议混淆。
- 本地页呈现目标、可观察依据、成本、确认要求和真实结果；技术 ID/tick/code 仅在主动打开的最近动作详情中。Signal HUD 两行简短反馈，800×600 的受测 HUD 为 10.0/10.625 CSS px。

## 验收证据

| 项目 | 结果与出处 | 边界 |
|---|---|---|
| P0 真实基线 | 独立 clone 7aa8b51，六项玩法与干净环境门禁；`tester/BASELINE_REPORT.md` | 人类式输入是 agent，不是真人 |
| CI 密闭性 | pure unit / 构建后 surface / 渲染导出后 parity 分门执行；缺产物明确失败 | 不提交 dist 或伪造 parity 输入 |
| Signal 因果 | core 规则单测及 P1 早期事件探针验证新开火抑制、旧弹保留与到期恢复；最终正式 E2E 验证提交状态、成本和路线阻断 | 最终 E2E 的 linkedFire getter 不是弹量断言；旧弹伤害未作为最终版专项用例，不声称 Jam 无敌 |
| ECHO 非战斗协作 | 合法观察 → scan 建议 → Owner 自动化夹具确认 → 首处理 tick 的实际证据和 ECHO 扣费 10 | 自动 Owner 不是真人授权验收 |
| 正式关卡 | 20261117/18/19 × HumanOnly/HumanEcho 均实际清房并通过路线 A；手动 R 路线 B 另有正式 E2E 与 Headless | non-blind 驱动读取状态作导航，不是盲测 |
| 拒绝与离线 | 拒绝不执行、无连接时本地 ECHO 仍可合作；既有真实模型链另验证 Disconnect | 无连接样本不冒充断线实验 |
| Headless / 恢复 | 同权威 cleared；作者身份恢复；四类 frame/raw-sim 入口重建未知来源 guard、单次执行、精确队列保留 | Headless route.completed 是投影，不能冒充渲染换房 |
| UI 回归 | 六视口默认页、两视口 pending、1280 Done、键盘禁用/审计往返/resize；完整菜单套件通过 | 未测所有视口所有状态和指针边缘 |

最终实际运行目录 `D:/tmp/ls-p4-v4`，基底 `3819621` 加 manifest.v4 十源及最终测试；主仓源与其哈希一致。完整证据归档 `tester/p4-final/run11-final-155/`。Lead 已将通过字节精确集成并提交，8 份测试 SHA 核对见 `integration-run11/spec-hashes.log.txt`。

| 最终门禁 | run11 结果 | 日志（相对本报告） |
|---|---:|---|
| npm test，默认并发，无自身 devserver | 73 文件，859/859，exit 0 | `tester/p4-final/run11-final-155/logs/1-unit-default.log.txt` |
| npx tsc --noEmit | exit 0 | `tester/p4-final/run11-final-155/logs/2-typecheck.log.txt` |
| npm run test:mcp-surface | 1/1，exit 0 | `tester/p4-final/run11-final-155/logs/3a-mcp-surface.log.txt` |
| npm run build | exit 0 | `tester/p4-final/run11-final-155/logs/3b-build.log.txt` |
| 完整 Playwright --workers=1 | 155/155，零 skip / did-not-run，exit 0 | `tester/p4-final/run11-final-155/logs/4-full-playwright.log.txt` |
| 新渲染导出后 test:parity | 3/3，exit 0 | `tester/p4-final/run11-final-155/logs/5-parity.log.txt` |

项目 tsconfig 不含 tests，typecheck 只证明源码类型；测试改动由实际 Playwright 执行验证。详细原始命令、时间、退出码、执行角色和固定字节见 [TEST_REPORT.md](TEST_REPORT.md)。这是一轮全绿，不是对所有负载、所有种子稳定性的证明。

## 发现并修复的根因

1. 历史单测依赖 gitignore 的 MCP 构建产物和尚未生成的 E2E parity：拆分门禁、按正确顺序构建与导出，保留原断言。
2. 暂停重复确认、恢复队列无 guard：单 in-flight、本地确认边界与来源标记、恢复时保留 exact queue 并建立保守 busy，真实回执才解除。
3. Headless 独自以敌人数推导清房：迁到 core 单一提交，避免两套完成真相；作者身份进入 frame/snapshot。
4. 布局失败半修改地图、坏 authored frame 崩溃：先完成布局计算再提交地图变化；有界结构校验 fail-closed，旧无 authored 帧兼容。
5. 门户贴图偏半格与 legacy 格中心不可走：统一中心坐标，实际显示点就是检测点和交互点；原 runtime/audit 两条红用例独立红转绿。
6. 测试归因错误：AI-disable 不再以净 HP 判断有无击退；按实际人类意图和位置事件归因。Boss 精确 15 发按本次 Boss 事件 ID 计数，其他敌人的弹完整记录，保留 3+12 速度分布、sprite 和存活移动断言。

最终全量实际覆盖了 Boss 15 + 无关敌弹 1 的旧失败形态，以及关闭 AI 后 3 次真实受击位移。旧 run7/run9 的具体失败现场没有逐事件数据，不能用新运行逆向伪造原现场。旧 150/153/154 计数与快照保留，未用定向通过回填。

## 真实模型与权限

所有者选择的 Magpie `group/elisa` 已用于正式工具链。Player Headless 战斗和 ECHO 观察→模型建议→Owner 夹具确认/拒绝→真实执行→断线降级均有真实请求 trace；见 `reviewer/REAL_MODEL_CONNECTIVITY_AND_SMOKE.md` 与 `reviewer/REAL_MODEL_ECHO_REPORT.md`。前者运行于 b6a98e5，后者于 87a0fac，不冒充最终 v4。

最终 v4 另有一次独立真实 ECHO smoke：archive d55e502、World 349544bf/core f71523e1，2/6 请求、51.4 秒，合法投影提出 toggle-relay，Owner 夹具确认后真实翻转一次；第二条 scan 被拒绝不执行；Disconnect 后真实 FALLBACK:NO_MODEL，本地离线建议仍可人工确认入队。见 `reviewer/real-model-v4/trace.json`、5 张实图与 `run-console-transcript.md`。原 trace 的 `snapshot` 仍是旧 harness 字面量 87a0fac，不能用它作版本依据；实际 provenance 以独立 archive 和首尾源哈希为准，原 trace 不改写。这仍是单次工程 smoke，不证明真人理解、模型平衡或所有非法输出路径。模型只获取合法投影，没有 Owner key/cap/Developer 隐藏状态，日志不保存秘密或内部 reasoning。

早期模型失败日志被覆盖，成功 ECHO trace 可独立核 4 次请求，另 6 次只有执行者记录；不能独立核实完整预算遵守。该证据缺口保留，不用新运行补造历史。

## P5 平衡与真人验收

平衡评价见 [GAMEPLAY_01_BALANCE.md](../../docs/gameplay/GAMEPLAY_01_BALANCE.md)。记录三 seed 实际完成时间、射击数、能量成本/净差、建议结果和完成率。缺失伤害字段为 N/A，不填 0；Headless 0 伤害短战不是人类平衡样本。脚本拒绝冷却 125 tick 与主动执行分列，不把等待归因于 ECHO。

本轮决定暂不调整数值：样本每格有限、战斗仅 2–4 shots，尚无支持某项数值改动的假设与人类证据。ECHO 未被证明更优。新增敌种或资源 preset 未实现，`P5_VARIANTS_PLAN.md` 仅未来建议；P5 已完成的是指标分析和最终回归，不能把建议标成上线功能，也不将自行追加建议变成新增系统的验收目标。

试玩流程见 [HUMAN_PLAYTEST.md](../../docs/gameplay/HUMAN_PLAYTEST.md)：HumanOnly、Local AI、HumanEcho、Signal 战斗、双路线、接受/拒绝。真人结果表仍为空。状态维持 HUMAN ACCEPTANCE PENDING，不虚构所有者已试玩。

## 交付位置与已知限制

要求的设计/基线文件位于 `docs/gameplay/`，测试报告在本目录，源码与测试已阶段提交。实现核心为 `src/world/sim/core.ts`、`src/config/p1Scenario.ts`、`src/signal/relay.ts`、`src/ai-native/{echo,worldHeadless}.ts`、`src/ui/feedback.ts`、PauseScene/GameScene 和 SaveSystem；各阶段 manifest 给出精确白名单。

已知非阻断限制：高负载下默认 B7 曾 857/859，本轮默认绿不根除资源竞争；极端无 centre 格的 legacy fallback 未全面验证；跨版本作者布局身份可能分叉；restore() 保留目标审计与代次而 factory 冷启动，不把旧历史当恢复后回执；无 writer/遮罩分支不是本轮全覆盖；未验证真人理解度、长期难度曲线与全部模型非法输出。

两项独立覆盖边界也须保留：P3 run32 最终 HUD 测量由 Tester 跑过，Reviewer 独立复现的是 run31（run32 差异由 Lead 核，不能称独立再跑）；World.updateRoom 的非作者房间旧清除块有重复两份，是本任务前既有代码，作者场景由 core 先提交而不触达该重复块，本轮未修且未将其 callback 双计作为指标。

所有独立实现、测试与审查渠道均为 **Orca Worker**，没有用 native subagent 替代。Lead 负责来源保护、实际集成、哈希与本地提交。原输入与历史证据保留，没有 force push/reset、删除别人的证据或变更 Owner 协议。最终文档审查确认无未关闭工程阻断；最后两处模型调用范围和集成时态由 Lead 据实修正，不涉及源码或测试。

独立最终结论见 [GAMEPLAY_01_FINAL_REVIEW.md](reviewer/GAMEPLAY_01_FINAL_REVIEW.md)：工程功能、测试、Owner 边界均为有界 PASS，人类验收待定；旧状态误记的勘误保留在该报告。主要本地提交为 CI `c7e03c5`、P1 `400a73e`、P2 `87a0fac`、P3 `7007ce2`、P4 `48b080d`、门户修复 `d55e502`、最终通关测试 `2b67106`、绿门禁与最终测试 `a487b98`。最终文档提交以本分支最新 git log 和交付回复为准，避免提交哈希自引用。

早期共享 cwd 测试改写的 8 份旧 AI-NATIVE-02 tracked parity JSON，已在 `evidence-preservation/final-before-restore/` 逐字节备份并附 SHA256，再还原到 HEAD；没有删除这些早期测试证据，也没有将无关旧报告变化混入源码交付。原独立工作树、旧失败日志、旧 error 会话与未跟踪启动脚本均保留。
