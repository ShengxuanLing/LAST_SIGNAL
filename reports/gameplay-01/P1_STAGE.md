# GAMEPLAY-01 P1 阶段提交

状态：P1 机制与源码独立审查通过；Tester 完整流水已记录但未全绿（浏览器 117 passed / 4 failed / 4 未运行，共 125）。返修后的新增 7 条隔离通过，不能补算为旧全量通过。不是整个 GAMEPLAY-01 的 ENGINEERING PASS。真人试玩 HUMAN ACCEPTANCE PENDING；Magpie 连接与 Headless Player 最小战斗已另行验证，P1 关卡及 ECHO 的真实模型链仍未验证。

源码阶段提交为 `400a73e`，基底为 `c7e03c5`（CI 密闭性前置），其前基线为 `main @ 7aa8b51`。已审两份 P0 旧测试修复另提为 `b6a98e5`。新 P1 E2E 与报告另行提交，测试隔离树为 c7e03c5 加 12 个 P1 冻结文件和两份 P0 测试修复，不包含共享工作区的 P2 改动。

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

执行渠道：Orca Worker developer 实现；Orca Worker reviewer 独立审查；Orca Worker tester 完成阶段测试及定向返修，后续仍需完整回归。报告链接：

- [P0 正式基线](../../docs/gameplay/GAMEPLAY_01_BASELINE.md)
- [P0 Tester 实测](tester/BASELINE_REPORT.md)
- [P1 机制与限制](../../docs/gameplay/SIGNAL_INTERACTIONS.md)
- [P1 独立审查](reviewer/P1_FINAL_REVIEW.md)
- [Tester 完整及返修测试报告](tester/P1_TEST_REPORT.md)
- [新 E2E 独立审查（返修要求与证据边界）](reviewer/P1_TEST_REVIEW.md)

## 新 E2E 返修结果与快照边界

新 spec SHA256：`e1c01a959314d0967e4fd14624fcc906ded2dac89ac3fde0d6f56238cdad027b`。

Reviewer 首审要求的两个断言修正已由 Tester 实现、Lead 核对：用提交事件精确断言 Scan 花费 10、Jam 花费 25；三个指定 seed 20261117/18/19 必须全部建立 authored 场景且无错误、两条非 boss/extraction 目标互异，三次实际布局 distinctLayouts=3。非盲驾驶读取 canonical 敌位/HP，移动开火为真实键鼠，不写世界状态；不能称合法 Player 模型链或人类盲测。移除不必要 serial 依赖，失败不再自动丢弃后续独立用例。新版本类型检查与 7/7 隔离通过；独立首审没有重跑这个返修后的版本，不能声称 Reviewer 也实跑了新 7/7。

历史全量的 4 未运行是 serial 第 3 条失败导致第 4–7 条未执行，保留为未验证；返修隔离 7/7 不补算旧流水。vs01 在无 P1 基底也复现，才有既有偶发失败的双基线证据；HUD/route B 隔离转绿不等于已证无回归。完整回归仍有待关闭项。

## HUD 采样前置增量

HUD 采样时曾观察到 LevelUpScene 正常暂停世界。现通过既有 `clearLevelUp` 的真实卡牌选择流程回到 live 状态，仍要求 GameScene 活跃、无升级遮罩、未暂停；所有原 mode/owner/几何/字体断言及专门的升级暂停测试保持不变。Tester 在 P1 隔离树跑五视口两轮 10/10 与 typecheck 通过；Reviewer 只读增量审查 PASS，见 [HUD_PRECONDITION_REVIEW.md](reviewer/HUD_PRECONDITION_REVIEW.md)。

该前置有最多 5 轮、最坏约 31 秒的墙钟预算，不是原断言 timeout 变更。后续 state/canvasBox 来自多个 evaluate，非同帧原子采样；理论上仍可能出现新的升级，不能宣称所有负载下竞态消除。旧 inline keypress 不稳的解释与观测症状相符，但 Reviewer 没有独立复跑旧版本证明根因。

本次整文件 SHA256 为 `ef1d2e92826d8dad98ed959b185ec251484d450764925a4781b68201516f2125`；P3-a 部分未改，但历史 `23f4961d…` 是同一文件修改前字节，不能继续充作当前整文件哈希。两轮局部通过不补算历史完整 125 项结果。

仅本地阶段提交，不 push、PR 或 merge main。
