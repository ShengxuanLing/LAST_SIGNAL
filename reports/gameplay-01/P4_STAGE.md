# GAMEPLAY-01 P4 v3 阶段集成

状态：源码与独立审查范围内通过，可本地阶段集成。Tester 的三 seed Rendered 通关与完整回归尚未交付；整体 GAMEPLAY-01 未 PASS，HUMAN ACCEPTANCE PENDING。

作者场景与路线规则由正式 World、Headless 共用。core 提交作者房间唯一的 room.cleared；World 呈现门户，Headless 路线投影读取同一标记。布局失败不修改地图，门户格中心统一。作者身份随核心 snapshot/frame 恢复；四条正式恢复入口保留排队命令并建立未知来源 busy 标记，阻止重复确认，不虚构人类授权或动作回执。

## 来源与验证

- Orca Worker developer-recovery 在独立 worktree `serene-leakey`、基底 `3819621` 实现。主仓原四文件未提交输入的作者来源仍未知，恢复开发仅将它们作为显式待审 patch，未把 provenance 当作作者证明。
- Lead 集成前保留原有源与文档字节于 `integration-v3/pre-integration/`。从冻结 manifest 复制的 10 源和 4 文档哈希 14/14 一致，见 `integration-v3/source-hashes.log.txt`。canonical `COOP_LEVEL_DESIGN.md` 使用冻结替换稿。
- Orca Worker reviewer 独立 archive 快照通过 62 条相关源测试、315 条边界测试与 9 项恢复探针，见 [P4_V3_REVIEW.md](reviewer/P4_V3_REVIEW.md)。此前 [P4_FINAL_REVIEW.md](reviewer/P4_FINAL_REVIEW.md)、[P4_V2_REVIEW.md](reviewer/P4_V2_REVIEW.md) 的失败与关闭过程保留。旧 red8→green8 未删除。
- 原始交付、patch、各版冻结源码和日志见 [manifest.v3.json](developer/p4-recovery/manifest.v3.json)。这些阶段结果不是 Tester 完整链结果。

## 恢复契约与剩余限制

RunCheckpoint 故意不保存未提交命令，刷新后回到确认前；raw-sim/frame 恢复保留队列，未知来源 guard 不允许再次确认。两种契约不能互相替代。`restore()` 当前保留目标世界原有审计环和 echoRoomGeneration，而 factory 冷启动空审计、代次为 0；旧审计是真实历史但可能过期，不能当恢复后本次动作回执。此差异已独立观测，选择文档化而未改冻结代码。跨版本作者布局算法变化仍可能让 World 重建场景与恢复身份分叉，未声称解决。

12 条三 seed Headless 结果仅是路线完成投影；真正房间切换的开发证据仅一个 seed。0 伤害短战不是平衡样本，Owner 自动确认是 fixture；HumanOnly 无连接不等于断线。ECHO 脚本含 125 tick 拒绝冷却，耗时应分别记录 scripted hold 与主动执行；能量净差含回能，成本必须取实际动作事件。

P5 的敌人、资源状态变体仍只有计划。真人未试玩、正式三 seed Rendered 对照和完整最终回归未完成。未推送、创建 PR 或合并 main。
