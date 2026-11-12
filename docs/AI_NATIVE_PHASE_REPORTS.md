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
