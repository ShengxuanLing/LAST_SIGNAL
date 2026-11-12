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
