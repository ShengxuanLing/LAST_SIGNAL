# GAMEPLAY-01 P1 阶段提交

状态：冻结候选与独立审查通过；Tester 完整 P1 流水尚未结束。不是整个 GAMEPLAY-01 的 ENGINEERING PASS。真人试玩 HUMAN ACCEPTANCE PENDING，真实 LLM 因连接配置缺失 BLOCKED。

基底为 `c7e03c5`（CI 密闭性前置），其前基线为 `main @ 7aa8b51`。本阶段仅提交 12 个冻结源码/规则测试文件，以及设计、P0 实测与 P1 证据；Tester 正在修改的 `tests/**` 不随本提交纳入。后续测试提交和结果会单独记录，不能混用快照。

## 可玩入口与内容

主菜单 `DEMO 01 · LINKED SENTRY` 进入正式 World：T Scan、Y Jam、R 切换 Relay；直接战斗、抑制新开火、切换路线均使用现有规则。Jam 不清除已发弹，不使玩家无敌。清房后 ACTIVE/INACTIVE 对应两条不同路线，JAMMED 不匹配任何路线。

## 已有证据及边界

- 实现者纯单测 755/755（原纯单测 741 + 新规则 14）；类型检查和构建通过。MCP surface 1 与 parity 3 是独立 gate，不包含在 755 内。
- Reviewer 独立规则测试 82/82，通过真实主菜单与 T/Y/R 验证抑制、恢复、能量和旧弹伤害，并实际步行走过两条路线。
- 步行过门检查使用了清敌夹具，不是无辅助完整通关，也不是本人试玩。
- 实现者验证三 seed、存档恢复、Jam 期间 portalTarget=null；Reviewer 仅独立验证其中部分路径，剩余由 Tester 继续验收。
- 新规则执行在共用 core。路线/portal 目前仍为 Rendered-only 适配；旧 parity 通过不能证明完整新关卡 Headless 等价，P4 必须补齐关键关卡权威规则。
- 新 HUD compact ≥10 CSS px、无重叠；提示对比度 4.07:1、Relay 与出生点同格、INACTIVE Jam 的价值、范围拒绝原因等非阻断体验问题留给 P3/P4，不称已修。

源码 SHA256 与本提交前验证对应 [final/manifest.json](developer/p1/final/manifest.json)。最终证据仅采用该 final 目录；早期截图保留但标为 obsolete。

执行渠道：Orca Worker developer 实现；Orca Worker reviewer 独立审查；Orca Worker tester 正在执行最终测试。报告链接：

- [P0 正式基线](../../docs/gameplay/GAMEPLAY_01_BASELINE.md)
- [P0 Tester 实测](tester/BASELINE_REPORT.md)
- [P1 机制与限制](../../docs/gameplay/SIGNAL_INTERACTIONS.md)
- [P1 独立审查](reviewer/P1_FINAL_REVIEW.md)

仅本地阶段提交，不 push、PR 或 merge main。
