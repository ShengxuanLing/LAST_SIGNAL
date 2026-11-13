# AI-NATIVE-01 阶段报告

## P0 — 2026-11-12

- 阶段：PASS，协议与基线保护完成；不代表 Runtime 已实现。
- Git 分支：`feat/ai-native-runtime`。
- HEAD：父提交 `c656f788227f44efec993315bfb65a323e398377`；P0 提交由本文件所在提交标识，见 `git log --oneline -- docs/AI_NATIVE_PHASE_REPORTS.md`。
- 已完成：封闭 DTO schema v1、纯校验/规范化/排序/授权辅助函数；三份架构契约；旧功能基线与独立复核。
- 实际修改文件：`src/ai-native/protocol.ts`、`protocol.test.ts`；`docs/AI_NATIVE_ARCHITECTURE.md`、`AI_NATIVE_PROTOCOL.md`、`AI_NATIVE_PERMISSION_MODEL.md`、`AI_NATIVE_TEST_REPORT.md`、本报告。
- 新增接口：版本化 Session/Action/Observation/Evidence/StepResult、内部 Snapshot/Replay 类型及校验；`canonicalJson`、排序与 `authorizeRawFrame` 等纯函数。尚无执行 Runtime、MCP 或真实 Agent 通关。
- 运行命令：`npm run typecheck`、定向 `npx vitest run src/ai-native/protocol.test.ts --reporter=verbose`、`npm test -- --reporter=dot`、`npm run build`；基线另跑 economy 构建及双端口 `npx playwright test`。
- 测试结果：协议 72/72、全单测 135/135、typecheck/build PASS；旧浏览器基线 23/23 PASS。最新修正无浏览器依赖，不重复浏览器全套。
- 失败项：独立复核发现公共 response 接受内部 Snapshot/Replay，以及接受未约定 notification；均已修复并补负向测试。无服务器的 Playwright 负向对照预期失败；构建保留既有 chunk-size 警告。
- 独立复核：Orca Worker reviewer 结论“P0 代码可接受，无未关闭阻断”；Orca Worker tester 提供基线证据，Orca Worker architecture 负责契约，Orca Worker developer 实现代码与测试。
- 剩余风险：协议模块较大；结构校验不替代 Gateway 授权。R9、共享移动、完整运行快照、Session 隔离、MCP 和真实 Agent 均待后续阶段；主 World 非完全确定性。真实玩家理解验证未完成。
- 下一阶段：P1 复用 SliceModel/Corridor，实现共享移动与显式固定 tick、Node CLI、确定性快照/恢复/回放和多实例测试；不复制玩法。

### 可复核证据

完整日志位于本机仓库外 `D:/Project/AI-NATIVE-01-evidence/`，尚未作为远端产物发布：

- 最终测试/构建：`p0-fix-{typecheck,vitest,full-vitest,build,probe}.log`。
- 独立终审：`p0-protocol-review-final.md`，及同名前缀 gate 日志。
- 浏览器基线：`p0-tester-playwright.log`、`p0-tester-gate-summary.log`。
- 代码 MD5：`protocol.ts` 为 `b99eb7011b148c055e14e70fb87e3d0e`；`protocol.test.ts` 为 `79359f01439ccecf063720a23ee40f66`。

未经所有者批准不合并 main。远端分支/PR 状态须以实际推送与创建回执为准。

## P1 — Headless 共享核心

- 阶段：PASS，Orca Worker tester 与 reviewer 均完成最终独立验收。
- Git 分支：`feat/ai-native-runtime`；P0 提交 `95e8da35dcaff9000ae0147ef3ec80b0e0a085fc`，P1 hash 见本节所在提交。
- 已完成：真实 Node 无界面运行、共享逐 tick 移动/碰撞/转场、合法门桥链、Guard 状态、快照恢复/回放、多实例隔离；R9 正常与异常证据恢复。
- 实际修改文件：新增 `src/ai-native/{runtime.ts,runtime.test.ts,headlessCli.ts}`、`src/slice/{sharedCore.ts,fullState.ts,evidence.test.ts}`、`docs/AI_NATIVE_RUNTIME.md`；修改 `SliceScene.ts`、`rules.ts`、`corridor.ts`、`corridorGuard.ts`、`storage.ts`、package 与 lock、测试报告和本报告。
- 新增接口：`createGame`、`HeadlessGame.step/observe/snapshot/restore/replay/pause/resume`；共享移动和逐 tick 提交入口；`npm run game:headless` 本机 Dev CLI。它不是 MCP。
- 运行命令：typecheck、定向 runtime/evidence 测试、`npm test`、默认/economy 构建、vs00/vs01 Playwright、真实 Node CLI 与独立反例脚本。
- 测试结果：最终 186/186 单测、13/13 受影响 E2E PASS；此前修复版完整旧回归 23/23 PASS。合法动作链 tick 518 完成；这是 Runtime 固定动作验证，不是真实 AI 通关。
- 失败项：独立审查发现 B1–B7（采样分叉、观察泄漏、R9、恢复污染、哈希漂移、私有帧边界、资源上限）及 B3-1/B4 残留，均经新增回归与独立复验关闭；保留失败历史。
- 独立复核：Orca Worker reviewer “P1 代码可接受，无未关闭阻断”；Orca Worker tester “P1 PASS”。实现由 Orca Worker developer 完成。
- 剩余风险：尚无正式 Session/Gateway/MCP、跨进程快照导入、真实 Agent/ECHO；主 World 非完全确定性。恢复只接受同实例原样签发帧，64 条 FIFO 上限，公开 hash 不代表授权。Node CLI 为显式本机 Dev/test 通道；受限入口拒绝私有帧。
- 下一阶段：P2 实例级 Session/Gateway、可信角色绑定、事件/观察裁剪、幂等、有界高级动作/取消和完整生命周期；P3 再接标准 MCP。

最终证据位于仓库外 `D:/Project/AI-NATIVE-01-evidence/`：`p1-review-residual-final.md`、`p1-tester-residual-final.md`、`p1-residual-{developer,reviewer,tester}-*.log`。性能采样见 `p1-final-tester-perf.log/.json`：1000 ticks 5.50ms、10000 ticks 8.84ms、10 实例 9.91ms、合法链 8.17ms（重复 2.62ms）；仅为本机测量，CPU 粒度较粗，不作为通用性能保证。默认后续并发预算建议 2、硬上限 10，单操作受 tick/事件/时间预算限制，P2/P3 结合调度再落实。

最终源码 MD5：runtime `b6a5474a2d456bd84651dab5823c574f`，rules `55fb1552845c770e59bef27a23a6f093`，storage `addd69bd1af496131398ed2efe851d2c`；完整清单见独立验收报告。P0 已推送，草稿 PR 为 https://github.com/ShengxuanLing/LAST_SIGNAL/pull/3；P1 推送结果以实际回执为准，禁止自动合并。

## P2 — Session / Action / Observation Gateway

- 阶段：PASS，最终事务残留经 Tester/Reviewer 独立验收关闭。
- Git 分支：`feat/ai-native-runtime`；父提交 `8a5b7c250b6a878c77bfee99b65163ba2c907b5d`，P2 hash 见本节所在提交。
- 已完成：实例级 SessionManager、Player/Owner/Test/Companion 能力分面、闭合请求校验、会话/actor/epoch/tick 绑定、request/action 幂等、有界高级动作与取消、生命周期/回收、多实例隔离、P0 观察和事件投影。
- 实际修改文件：新增 `src/ai-native/sessions.ts`、`sessions.test.ts`、`sessionClient.mts`、`docs/AI_NATIVE_SESSIONS.md`；适配 `protocol.ts` 真实事件枚举、`runtime.ts` 内部非签发事务接缝；更新测试报告和本阶段报告。
- 新增接口：`createSessionManager`、Player/Owner/Test/Companion closure handles；moveTo/approach/scanTarget/interactWith/waitUntil 有界高级动作及可观测 actionId；Test snapshot/restore/replay/inspect。fixture 注入仍 unavailable，未计作完成。
- 运行命令：typecheck、43 项 sessions 定向测试、229 项全单测、build、真实 `sessionClient.mts`、独立事务及49项回归探针；slice 未改，浏览器沿用受影响13项已通过证据。
- 测试结果：43/43 定向、229/229 全单测；独立事务10/10、独立回归49/49；真实 production Player 合法动作整链 tick518 完成、取消停 tick、回收退出正常。固定客户端仍不是 P4 真实 Agent 自主游玩。
- 失败项：非法输入/绑定/批内幂等/预算/Player生命周期权限、reset 在飞动作污染、cancelAction失效及提交后校验失败均曾阻断；已修并保留失败历史。最终 rollback 不推进 tick/资源/事件/epoch，失败 request 重试一致，不驱逐已有快照。
- 独立复核：Orca Worker tester “P2 PASS”；Orca Worker reviewer “P2 代码可接受，无未关闭阻断”。实现由 Orca Worker developer 完成。
- 剩余风险：尚无 MCP/LLM/ECHO 实体或 fixture 注入，跨进程导入仍拒绝。同 seed 的不同会话 actorId 可相同，但 session 绑定严格隔离，actorId 视为 session 内标识。Player 不能 pause/resume/reset，可信 Owner 独立。结构校验不替代服务端授权。
- 下一阶段：P3 标准 MCP stdio、Dev Harness/fixture审计、batch/compare、真实 MCP 客户端工具记录和后台资源验证。

证据：`D:/Project/AI-NATIVE-01-evidence/p2-review-transaction-final.md`、`p2-tester-transaction-final.md`、`p2-transaction-final-{reviewer,tester}-*.log`、`p2-residual-developer-{unit,build,client}.log`。最终 MD5：sessions `e6ca754a1a9012dd5920d634b1894879`，sessions.test `e6109981e7a6f0445de200ec143cf1a1`，runtime `58413a99ad9ca3ded9dae901f3c781fa`。

## P3 — 标准 MCP / Developer Harness（2026-11-13 验收）

- 阶段：PASS，Tester/Reviewer 最终 epoch 定向验收均通过。
- Git 分支：`feat/ai-native-runtime`；父提交 `5d4fe9128f21555997b2c301fe25a20a056f6490`；P3 hash 见本节所在提交。
- 已完成：官方 MCP SDK stdio、默认 Player 6 工具/显式 Dev 16 工具双面隔离、严格 schema、结构化输出、Dev fixture/inspect/audit、受控快照引用/恢复/回放、run_scenario/run_batch/compare_runs、有界取消和后台资源清理。
- 实际修改文件：新增 `src/ai-native/{harness.ts,harness.test.ts,mcpServer.ts,mcpClient.mts}`、`vite.mcp.config.ts`、`docs/AI_NATIVE_MCP.md`；适配 `sessions.ts` Dev fixture 接缝与单调 epoch；精确 SDK/schema 依赖与 package lock；更新测试/阶段报告，忽略生成目录 `dist-mcp/`。
- 新增接口：官方 MCP Player/Dev 工具，详见 MCP 文档真实注册矩阵；Player 不注册 Dev 工具。直接入口 `node dist-mcp/mcpServer.mjs`，Dev 加 `--dev`；先执行 `npm run game:mcp:build`。不修改全局 MCP 配置。
- 运行命令：typecheck、32 harness/43 sessions 定向测试、261 全单测、build、MCP build、官方 SDK Client 及独立 MCP 探针。
- 测试结果：261/261 单测；独立 Reviewer 52/52 官方 Client 检查；独立 Tester 最终22/22检查，原8项幂等及正常门桥路线/Dev操作/退出通过。slice 未改，不重复浏览器全套。
- 失败项：原始 MCP 请求默认 tick/actionId 变化导致重试冲突，以及缺 epoch 旧请求在 fixture/restore 后重执行；均已修。mutation 入口 epoch 强制必填，校验先于缓存，restore 保证单调 epoch。
- 独立复核：Orca Worker reviewer “P3 现在可接受”；Orca Worker tester “P3 PASS”。实现由 Orca Worker developer 完成。
- 剩余风险：固定官方客户端路线仍不是 P4 模型自主游玩；ECHO 实体未实现。跨进程原始快照导入不支持，Dev 通道仅本机可信启动；公开 hash 仅完整性。模型/Token/推理延迟未在此阶段测量。
- 下一阶段：P4 由真实外部 Agent 仅经 Player MCP 逐步观察、决定动作并完成合法路线，保存可回放轨迹；再实施隔离最小 ECHO 双 Actor 场景。

最终证据位于 `D:/Project/AI-NATIVE-01-evidence/p3-review-epoch-final.md`、`p3-tester-epoch-final.md`、`p3-epoch-final-{reviewer,tester}-*.log`、`p3-epoch-developer-*.log`。最终 MD5：harness `1db664997f3548df53968138801d93db`，server `83f600c92399b7b052acdf91418861b2`，client `475b77c7a42f4a1bc8e6572a3bfc3364`，sessions `b87fe02fa24e4f7d76c7102b7af3a16a`。所有完整日志仍在本机仓库外，尚未发布为远端附件；PR 保持 draft，禁止自动合并。

## P4 — 当前 Codex 经 Player MCP 真实交互游玩

- 阶段：PASS，原始执行真实性、独立重放和反馈修复均经 Tester/Reviewer 验收。
- Git 分支：`feat/ai-native-runtime`；父提交 `ddcd7e9580346a2411e3b10c369dd3bfc1ef4edd`；P4 hash 见本节所在提交。
- 已完成：当前 Codex Lead 通过中立官方 MCP 客户端逐次读取 Player 观察并决定动作，未调用 Dev/fixture/seed/私有快照或预写策略，真实完成门、Guard、Relay、Bridge 路线；提供中立客户端、不可变原始归档和可移植公开动作回放样例。
- 实际修改文件：新增 `agentClient.mts`、`replayPlayerTrace.mts`、`p4.test.ts`、`examples/ai-native/p4-*`、`docs/AI_NATIVE_PLAYER.md`；修改 runtime/sessions/MCP server 与 slice rules/fullState 的采样归因接缝、相关测试及 package scripts；更新报告。
- 新增接口：中立 list/call 交互客户端和 Player trace 重放入口；扫描证据采样时绑定真实位置/actor/action/epoch，嵌套事件使用一致的外部 session 句柄，合法扫描关系投影。
- 运行命令：typecheck、266全单测、build、MCP build、真实Agent逐次MCP调用、两套独立官方Player重放、provenance探针、中立客户端smoke、完整23项Playwright。
- 测试结果：266/266 单测、23/23 E2E PASS；原始 Agent 终态 tick501、HP100、Energy96、passed/crossed/completed=true、29条有序公开事件。修复前后公开动作轨迹一致；opaque身份与seed hash不比较，不声称新seed全内部stateHash相同。
- 失败项：一次载荷缺type导致E_SCHEMA，模型按公开协议修正；普通开门因封锁返回E_LINK_UNAVAILABLE零扣费，随后Jam合法通过。游玩发现旧房间扫描位置/合成来源身份/嵌套session错位/关系投影缺失，均修复并回归；原始记录未改。
- 独立复核：Orca Worker reviewer “P4可接受，无阻断”；Orca Worker tester “PASS”。原始运行由当前Lead Codex完成，客户端与修复由Orca Worker developer实施。
- 剩余风险：本次为非盲测，Lead已有项目知识；不是独立provider API盲测，也不是完整主World/Boss通关。模型Token/内部推理次数不可获取，保持null。工具往返93.0398ms不等于推理延迟；墙钟约257.9s。重放不是第二次真实Agent游玩。
- 下一阶段：隔离ECHO最小双Actor协作场景，独立观察/记忆/目标/受限行动及人类确认；不冻结未批准世界观或正式角色权限。

原记录：47行，23 requests /22 results（22 MCP工具+quit），600142B；SHA256 `0ba5cdb4f305527bd9de12e01a987c1dc5d7a2d3bed4c86eb940d418a09aea52`。仓库示例目录保存完整gzip归档与校验文件；外部原件 `D:/Project/AI-NATIVE-01-evidence/p4-codex-live.jsonl`。独立报告：`p4-review-original.md`、`p4-review-final.md`、`p4-tester-original.md`、`p4-tester-final.md`；证据目录内 `p4-final-{tester,reviewer}-*`。

## P5 — 隔离 ECHO 最小双 Actor 协作

- 阶段：PASS，仅 `echo-coop-test` 隔离测试场景；不代表正式 ECHO 完整玩法或世界观已定稿。
- Git 分支：`feat/ai-native-runtime`；父提交 `56e4902044a3dae94c6b7cca1d7eceb46b29a947`；P5 hash 见本节所在提交。
- 已完成：单一 SliceModel/共同 tick，Human 与 ECHO 独立位置、观察、记忆、目标、预算；真正逐字段双向共享、带不确定性假设、人类确认/拒绝、合法 ECHO Jam 与人类过门、离线策略、暂停/接管/取消/断链降级、实例隔离与签发快照。
- 实际修改文件：新增 `src/ai-native/{coop.ts,coop.test.ts,coopDemo.mts}`、`docs/AI_NATIVE_ECHO.md`；抽取 `rules.ts` 的 actor 位置能力入口与 `sharedCore.ts` 通用移动；Dev-only MCP coop 工具及 scripts；更新报告。
- 新增接口：CoopSession/CoopManager、Human/Companion closure handles、Dev-only `game_coop_*`；production Player 仍6工具，production Companion仍不授予实体行动权限。
- 运行命令：typecheck、21项coop测试、287全单测、build、MCP build、真实官方Dev MCP双actor探针/demo、P4 Player回放、完整23项Playwright。
- 测试结果：287/287、21/21；独立Tester直接帧23/23、官方Dev MCP27/27；完整23E2E首次及复跑PASS；P4仍tick501/HP100/E96/29events。fixture仅测试初态，协作动作来自合法Actor能力。
- 失败项：share字段未真正裁剪、EchoStatus泄Human隐私、快照浅引用、恢复可篡改确认、计划浅冻结，以及同seed跨实例快照/32bit-only对比，均修并经独立反例关闭。开发者一次计时失败历史保留；Tester两次完整回归未复现，未延长wait。
- 独立复核：Orca Worker reviewer “P5现在可接受，无残留阻断”；Orca Worker tester “PASS，全部gate通过”。Orca Worker architecture提供只读边界复核；Orca Worker developer实施。
- 剩余风险：ECHO为隔离Headless测试实体，无正式浏览器呈现/剧情/长期跨局记忆/外部LLM人格。快照只接受本实例原样签发帧（64条FIFO）；公有hash非授权，完整canonical逐字比较；正式存档key/version不变。
- 下一阶段：提交最终范围/验收矩阵与PR供Owner审核；不自动合并。

证据：`D:/Project/AI-NATIVE-01-evidence/p5-review-residual-final.md`、`p5-tester-final.md`、`p5-final-tester-*`、`p5-residual-final-reviewer-*`、`p5-residual-developer-*`。最终MD5 coop `f2dfe8b1b6b521916fdf25038e33a504`、test `40de8152c8e248eadc058c7f0fab7829`。P0–P5 的实际执行渠道均为 Orca Worker 与 Lead；未使用原生子代理替代 Worker。

## 最终资源预算与材料收尾

P5提交后Lead发现普通Session与coop各10槽位可合计20，已由Orca Worker developer最小修正为调用方持有的单个ProcessSessionBudget(10)，不使用全局单例；两类实例、run_scenario/batch同池，构造失败/close/idle/dispose归还槽。Orca Worker tester独立官方MCP13/13与直连12/12通过，Orca Worker reviewer结论代码可接受、无阻断。新增budget.test.ts五例，最终全量292/292；typecheck/build/MCPbuild/P4replay/coopDemo通过，slice与browser逐字未变，沿用P5两次完整23E2E。

实际文件为sessions/coop/harness/MCP server的预算注入、budget.test.ts/budgetClient.mts、scripts和最终文档/取证样例。完整gate在仓库外`final-budget-{developer,reviewer,tester}-*`；最终审查和Tester结论归档进`docs/ai-native-evidence/`。未合并main，GitHub P5节点两项CI已通过；最终新提交的CI需以PR实时状态为准。最终提交hash见本节所在提交。

---

# AI-NATIVE-02 阶段报告（正式 World / 意图适配）

阶段编号与 AI-NATIVE-01 的 P0–P5 无关。基线 `860a0dd78fb741896c2f1433742603dd91e37fc8`，分支 `feat/ai-native-world-integration`，P0/P1 提交 hash 见本节所在提交；未 push、未合并 main。

## P0 — 接缝核查与最小接口

- **PASS**（基线真实失败：无）。`npm run typecheck` exit 0；`npm test` 292/292；`npm run build` exit 0（仅既有 500kB chunk 警告）。日志 `reports/ai-native-02/p0-baseline-*.log`、`reports/ai-native-02/reviewer/`、`reports/ai-native-02/tester/`。
- 核查范围：World/Player/Enemy/Boss/Weapon/Projectile/Collision/Signal(房间与传送门)/Input/Camera/HUD/Save/RNG/Tick/EventBus/既有 ai-native。
- 接缝图、最小接口、操作说明与风险映射：`docs/AI_NATIVE_WORLD_CONTROL.md`。
- 结论：主 World 是 Phaser+规则耦合、变长 dt、含视觉/玩法随机；Lead 裁定 R-01/R-02 留 P2/P4，P1 只做**共用合法意图适配层**，不宣称 Headless/Replay/确定性。

## P1 — 可见本地确定性接管

- **PASS（开发者自测，非独立验收）**：人类与本地 controller 共用 `PlayerIntent → Player.applyIntent`，同一各向异性移动/碰撞、`setAimGrid` 瞄准、`tryFire`、`tryInteract`；AI 只返回意图，不写坐标/HP/Phaser 对象。
- 实现：`ControlAuthority`（owner/pause/takeover/disable/死亡/重启/场景退出）、`LocalDeterministicController`（MOVE/TRAVEL/ENGAGE/STOP/INTERACT/BLOCKED，目标最近可见敌人或传送门位置）、`WorldObservationV1` 白名单、`World.observationView()/intentView()`、HUD 模式/最近动作/目标/真实连接状态、Pause 菜单 `AI CONTROL` 开发入口、升级弹层内一键夺回、`cloneCheckpoint()` 深拷贝。
- 真实标签：HUD/暂停菜单/文档一致显示 `LOCAL DETERMINISTIC` 与 `EXTERNAL NOT CONNECTED`；没有外部 LLM/Codex/MCP Agent 接入，没有 MCP 直接改 Scene，没有系统键鼠模拟。
- 命令与结果：`npm run typecheck` PASS；`npm test` 321/321（新增 29 项）；`npm run build` / `npm run game:mcp:build` PASS；冻结快照 5281 专属端口 `npx playwright test tests/ai-native-world.spec.ts --workers=1` 6/6 PASS；双端口全量 `PORT=5173 npx playwright test --workers=1` 33/33 PASS。日志 `reports/ai-native-02/final-*.log`、`p1-full-playwright.log`、`final-playwright-frozen.log`。
- 证据：`reports/ai-native-02/evidence-frozen/`（5 张分辨率 HUD 截图、AI 连续截图、暂停/升级/死亡截图、`operation-log-*.json`）；五分辨率物理最小字号 19.5/13.87/13/10.4/8.125 CSS px；AI 14 帧采样 pathLength 9.478 tiles、5 个移动意图、1 次合法传送门房间转场、所有采样点 walkable；白名单把其他房间敌人排除，portal targetRoom 不外泄；暂停菜单 AI 运行时确认为 ON、手动 OFF 后不自抢；升级弹层内按 W 真实夺回；死亡清 run、新局 human 且无残留；checkpoint 捕获帧不随活状态变异。
- 失败历史：早期 WIP 采样的「位移点数>2」失败不是放宽阈值掩盖，而是发现 LevelUpScene 暂停与合法传送门房间跳变；最终用连续细采样、同房间步长/碰撞合法性与单独记录 interact 转场修复。另有生产构建 class 名被压缩导致按 `constructor.name` 找 Scene 失败，已全部改为 Phaser scene key。
- 独立复核：Tester `reports/ai-native-02/tester/p1-final/P1-FINAL-ACCEPTANCE.md` **P1 PASS（无阻断）**，含 6/6 冻结浏览器复核与 2 个无夹具探针（自然受伤 / 自然升级 / 自然死亡 / 真实键鼠夺回）；Reviewer `reports/ai-native-02/reviewer/REVIEW_P1_IMPLEMENTATION.md` **P1 PASS（有条件）**，要求 F-01/F-02/F-04/F-05/F-06/F-07 闭环后才允许接外部 Agent。两者均不是开发者自测，也不等于真人/外部 Agent 验收。
- 剩余风险/未完成：World 纯权威核与固定 tick（P2）、全玩法 seeded RNG 与 Replay/确定性（P4）、外部 Agent 经正式通道接入、Human+ECHO 正式双 Actor、Station Zero runtime 的 actor/reset 硬化、`onLoot`/`statsSnapshot()` 空实现；P1 不重构这些。
- 下一阶段：先闭环 Reviewer 条件项，再由 Lead 派独立复核；P2–P5 由 Lead 另行排期。

## P1 条件项修复（F-01/F-02/F-04/F-05/F-06/F-07）

- 提交：见本节所在提交（父 `2d78e805...`），未合并 main。
- 实现：新增 `src/ai-native/worldPerception.ts`（有界网格半径 12 tiles / 已探索房间 / 墙遮挡 LOS / ±1.5 tiles 局部 `canWalk` 探针）；`WorldObservationV1` 改名为 `perceivedActors` 并增加 `visibilityBasis`，`observationView()/intentView()` 按 `isPerceivable` 过滤敌人/Boss/portal，远距、墙后、未进入房间全部不可感知，从他房追入感知范围的敌人可见；`GameScene` 把背包纳入 `control.pause()` + 清输入 + HUD 刷新，覆盖层内 W/A/S/D/SPACE、非 UI 鼠标、F 均可夺回，UI 点击用 `hitTestPointer` 归覆盖层所有，关闭后不自抢；紧凑视口（scale<0.85）放大右列与操作提示并拉开行距，提示文字改高对比色，测试改名为几何断言（最小 ≥10 CSS px）。
- 新增回归：`src/ai-native/worldPerception.test.ts`（8）、重写 `worldObservation.test.ts`（6）、`tests/ai-native-world.spec.ts` 新增 2 个正式 World 用例（覆盖层所有权 + 有界感知），并把五视口断言从「readable」改为几何 + 截图供人工判读。
- 证据范围表（F-07，逐项标注真实 commit；C2 WIP 与后续提交不得混入）：

| 证据类别 | 真实 commit | 具体来源 | 夹具 / 注入 | 能证明 | 不能证明 |
| --- | --- | --- | --- | --- | --- |
| 开发者 P1 主控制流 / 五视口截图 | `2d78e80` | `reports/ai-native-02/evidence-frozen/` | 固定 seed 注入 `scene.start`、每 100ms 刷新 `invuln`、`addXp` 升级、`spawnEnemy` 隐藏敌人、`hurt(999999)` 合成伤害 | 初始控制所有权、暂停冻结、夺回、升级/死亡**清理流程**、HUD 几何、checkpoint 不变性 | 真实战斗难度 / 生存击杀 / 真实 XP 升级 / 真实战斗死亡 / 外部 Agent |
| 开发者 P1 修复回归 / 覆盖层 / 可读性 | `1aadd2e` | `reports/ai-native-02/p1-fixes/evidence-frozen/` | i-frames、第二武器 fixture、`addXp` 升级、隐藏敌人、合成伤害 | 覆盖层 UI 点击归属、移动/开火/F 夺回、关闭不自抢、800×600 几何 | 真人游玩、外部 Agent、真实战斗胜利 |
| 开发者感知边界 E2E | `1aadd2e`（夹具声明由本节所在小补丁补充） | `p1-fixes/evidence-frozen/operation-log-perception-bounds-1280x720.json` | `bootRun` 固定 seed 注入 `scene.start`；`spawnEnemy` 隐藏敌人；`enteredRooms.add(other.id)` 标记已探索；**临时 `mid.type='wall'` 改地形**并恢复；`spawnBoss` + 改写 `boss.wx/wy` 近/远；改写 `portal.wx/wy` 近/远并恢复；`boss.sprite.destroy()` / `w.boss=null` 清理；非有限 `canWalk(NaN/±Infinity)` 探针 | 12 tiles 半径、已探索过滤、墙遮挡 LOS、Boss/portal 位置受限、远距/非有限/未探索 `canWalk` 统一拒绝、近距合法探针可用 | 真实地图自然墙后战斗（墙为测试临时改地形）、真人 / 外部 Agent / 真实战斗死亡 |
| 独立 Tester 无夹具短演示（父提交） | `2d78e80`，**非 `1aadd2e`** | `reports/ai-native-02/tester/p1-final/04-normal-run-probe.log`、`normal-run-log.json`、`evidence-normal/` | **无** i-frames / HP / 坐标 / addXp / spawnEnemy / seed 注入 | 自然受伤、真实升级弹层、墙碰撞合法性、KeyD/鼠标/F 真实夺回、暂停 OFF 不自抢 | 真人、外部 Agent、战斗胜利、不可用于 `1aadd2e` 签字 |
| 独立 Tester 无夹具自然死亡（父提交） | `2d78e80`，**非 `1aadd2e`** | `reports/ai-native-02/tester/p1-final/05-natural-death-wall-probe.log`、`natural-death-wall-log.json`、`evidence-natural/` | **无**夹具 | HP 100 → 0 自然死亡、GameOver 清档、新 R0 控制复位、墙邻域合法性 | 真人、外部 Agent、战斗胜利、不可用于 `1aadd2e` 签字 |
| 独立 Tester 修复提交无夹具探针 | `1aadd2e`，**非 C2 WIP** | `reports/ai-native-02/tester/p1-fixes-final/P1-FIXES-FINAL-ACCEPTANCE.md`、`04-normal-run-probe.log`、`05-pointer-overlay-probe.log`、`07-inventory-probe.log`、`08-resume-after-inventory-probe.log`、`09-no-reclaim-probe.log` | **无** i-frames / HP / 坐标 / addXp / spawnEnemy / seed 注入（`03-playwright-final.log` 的 8 项 spec 仍有夹具） | 修复后自然受伤（100 → 最低 17）、背包 PAUSED/清输入、指针覆盖层夺回、关闭背包后恢复、夺回后不自抢 | 真人、外部 Agent、战斗胜利；本提交**没有**独立自然死亡探针（自然死亡仅父提交） |
| 外部 Agent / Headless World / Replay | 无（全部 `2d78e80`/`1aadd2e`/C1/C2 均未实现） | 无 | — | — | HUD/菜单/报告始终 `EXTERNAL NOT CONNECTED`；`game:headless`/MCP 只服务 Station Zero；不得用本地 demo / 浏览器自动化 / 假 Headless 冒充 |

- 本小节所在提交仅修文档/测试可靠性，不新增产品功能证据；C2 WIP 的源码改动在后续 C2 提交单独验收，不得把上表任何一行算作 C2 证据。

- 人工可读性判读（F-06）：开发者已查看 `p1-fixes/evidence-dev/hud-ai-800x600.png`（修复后）：右列 7 行与左下提示在 800x600 下完整、无裁切/重叠、字号明显放大且提示高对比；结论记为「可辨，不需要放大」，但这是开发者看图结论，不冒充独立人工验收；数字阈值只作几何下限。
- 仍未处理：F-03（`window.__game` 生产暴露）、F-08（`restoreCheckpoint` 入参别名）、R-01/R-02/R-05/R-06/R-09、固定 tick、集中状态、外部 Agent 接入；F-09 已在 C1 修复，其余带入 P2/P4。

## C1 — 共享纯规则抽取与即时接线（提交见本节所在提交）

- **状态**：Developer 自测完成，未合并 main；父提交 `1aadd2e04...`。范围仅 C1，**没有**实施 C2 固定 tick / RNG 归一 / 集中状态，也没有 C3 外部 Agent 或 Signal 玩法。
- **实现**：唯一纯模块 `src/world/sim/rules.ts`（无 Phaser / DOM / `Math.random`）承载移动/轴分离碰撞/瞄准、武器 spec、弹丸创建（复用真实 `World.rng`）、弹丸推进与扫掠命中、护甲伤害/击退、drone FSM、非 drone 共用移动/远程攻击助手；`Player` / `Enemy` / `World` 立即调用这些唯一实现，旧内联规则体删除；渲染、音效、回调、精灵生命周期仍在适配层。`src/ai-native/control.ts` 改用 `IsoMath.TILE_W/H`（F-09），`drone/pulse` 为首片，scatter/plasma 等其他武器与敌人共用通用纯函数未回归。
- **不是权威核完成**：可变状态仍分散在 `Player` / `Enemy` / `World`；`GameScene.update()` 仍是变长 `dt`，`World.rng` 仍由 World 持有，存档契约（SAVE_VERSION=2 / `finishRun` / checkpoint）未改。集中 `SimulationState`、固定 60Hz tick、事件队列、全部玩法 RNG 归一是 **C2**；C1 不以一组几何 helper 冒充完成。
- **Signal**：正式 World 当前不支持任何 Signal 玩法（Scan/Jam/Decoy/Relay/Bridge/Guard/Signal Energy 只在 Station Zero `src/slice/`；`SIGNAL_SYSTEM_DESIGN.md` 是设计提案）。C1 没有发明 Signal；正式接入仍是 AI-NATIVE-02 总任务义务。
- **阶段口径**：C3 真实外部 Agent 经正式通道战斗**仍是 P2 完成条件**，排在 C1/C2 依赖之后，不重定义为 P3；HUD/菜单/报告持续 `EXTERNAL NOT CONNECTED`，不得用本地 demo / 浏览器自动化 / 假 Headless 冒充。
- **验证**：Node 单测用真实 `MapGenerator(424242)` + `WEAPONS.pulse` + `ENEMY_STATS.drone` 覆盖受阻移动、瞄准、射击、扫掠命中/墙、伤害/死亡、drone FSM；静态 rewiring 单测证明 Phaser 三个适配器调用 `sim/rules` 且旧规则体已删除；Rendered Playwright 用真实键鼠断言 `Player.lastMoveStep` / `lastWeaponSpec`、`World.lastProjectileData`、`Enemy.lastDroneStep` / `lastHitResult`，并覆盖 P1 五视口与旧全量回归。完整日志与证据在 `reports/ai-native-02/c1/`。
- **C2 下一步**：集中 `SimulationState`、固定 tick 累加器、玩法/视觉 RNG 拆分、`SimEvent[]` 呈现事件隔离、Node/Rendered canonical parity；仍不宣称全游戏 Replay/确定性。
