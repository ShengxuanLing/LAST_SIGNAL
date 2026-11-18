# GAMEPLAY-01 P4 v3 / v4 阶段集成

当前状态：P4 源码、三 seed Rendered 通关与 run11 完整工程回归通过。以下历史阶段记录按版本保留。P5 平衡总结和最终独立验收收尾中；HUMAN ACCEPTANCE PENDING，不宣称人类体验验收。

## run11 最终冻结链

最终同快照默认并发单测 73 文件 / 859 条、源码 typecheck、MCP surface 1、build、完整 E2E 155/155（零跳过、零未执行）及实际新导出 parity 3 均通过。默认单测运行前已停自身 devserver，此次默认绿不等于历史高负载 B7 风险已根除。见 [TEST_REPORT.md](TEST_REPORT.md) 和 `tester/p4-final/run11-final-155/`，各门有真实退出码和完整源码/测试快照。

最终 `audit.spec.ts` 为 6ea30e8b、`ai-native-world.spec.ts` 为 855eb948，其余已提交测试与 run11 冻结一致，Lead 集成后核 8/8 哈希匹配，见 `integration-run11/spec-hashes.log.txt`。AI-disable 不用净 HP 作为无位移代理，逐帧核人类控制/中性意图，并按真实位置事件归因，精度恢复原 toBeCloseTo(...,6)；Boss 仍精确 15 发与 3+12 速度分布，仅按本次 Boss 事件 ID 跟踪 sprite 和半秒后的存活者。

该全量实际出现 Boss 15 + owner1 无关弹 1 的原失败形态，并完整记录两桶，不清弹造绿；AI-disable 也实际经历 3 次受击位移，真实控制意图仍为零。原 run7/run9 缺失的失败现场不可逆向重建，新事件归因不是声称还原原现场。独立测试差异结论见 [AI_DISABLE_TEST_REVIEW.md](reviewer/AI_DISABLE_TEST_REVIEW.md) 和 [BOSS_VOLLEY_TEST_REVIEW.md](reviewer/BOSS_VOLLEY_TEST_REVIEW.md)；Lead 另核最终 dash/字段存在/原精度加强差异。所有旧 150/153/154 门禁与精确版本留存，均不回填。

## run7 测试收尾（不等于完整验收）

截至 run7，三 seed Rendered HumanOnly/HumanEcho 合法清房、自然 Jam 与实际换房已由 Tester 执行，并经 Reviewer 复核测试及日志。最终测试四份 SHA 见 `integration-tests-run7/hashes.log.txt`：P1 a7db1885、P2 4bc6288f、P4 13a83464、恢复探针 22ae61f7。首处理批序号与回执批末 tick 恒等式阻止任意延迟后提交也通过；零 tick 帧不误判为命令跨处理批保留。驱动只在实际模拟消费输入后释放按键，不增加结果阈值。

完整 E2E 最终记录仍为 **154/155，exit 1**；唯一失败是未修改的 ai-native-world 用例关闭 AI 后 x 漂移约 0.694 格。孤立同字节通过仅为相关性，失败现场的逐 tick 意图/输入/碰撞未持久化，根因仍待诊断，不能声明非产品问题或稳定性已解决。P4/P2 用例在该完整运行内均通过，fresh parity 3/3。该运行未再测 unit/build/surface：单测引用 run5 的无 devserver、有界并发 `--maxWorkers=2 --minWorkers=1` 配置 73/859 全过；默认并发 857/859 的 CLI 壁钟风险保持。build/surface 引用 v4 同源已有门禁，不能称 run7 重新测过。

run7 全量测试字节与开始前冻结副本一致。其逐动作 JSON 来自此前定向绿门；全量通过证据为日志，不能将定向 JSON 冒充全量现场。导出时间 22:42 本地 UTC+1 即 21:42Z，早于 parity，时区不可混算。独立结论见 [P4_TEST_REVIEW.md](reviewer/P4_TEST_REVIEW.md) §9；完整原始材料见 [P4_TEST_REPORT.md](tester/p4-final/P4_TEST_REPORT.md)。此前 150/155、两套 153/155 不回填。原未提交测试字节已备份于 `integration-tests-run7/pre-integration/`。

后续 v3 测试已交付：三 seed × HumanOnly/HumanEcho 在真实浏览器均完成清房与换房，Headless 另验证同权威规则。单测实际 73 文件 / 859 条、surface 1、build、fresh parity 3 均通过；完整 E2E 为 150/155。两条失败是 legacy 门户中心不可走的真实产品回归，另三条为有证据的 world/camera 就绪前置错误，定向修后通过。全量当时 P4 测试字节为 17fe4a09，最终 50e74fdc 有全量后扩展，不能说那次全量运行了最终字节。

v4 仅改 World.ts（SHA256 `349544bf5785dad072fb7bc3c904d0c80bb08f4619d7834a598d7e58ec05dc64`）：legacy 门户按实际格中心检测 radius 0.5 并呈现同一点，deck-exit 同步；作者门户和 spawn/landing/boss 位置路径不变。Reviewer 独立用原测试、原阈值跑出 v3 两红、v4 两绿，并通过 8 条门户/存档定向测试，见 [P4_V4_REVIEW.md](reviewer/P4_V4_REVIEW.md)。这不回填旧 150/155，新 v4 完整链仍待 Tester。

legacy 无 centre 可用格的 fallback 保留，60 个生成房间探针未触发不等于所有 seed 或手写房间都有解。另有 Companion race 负载下失败，实际红行是 tests/companion-room-race.spec.ts:208（开发 manifest 的 :274 是记录错误）；孤立 3/3 只说明负载敏感，未视为修复。

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
