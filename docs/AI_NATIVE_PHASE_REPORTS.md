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
