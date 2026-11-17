# GAMEPLAY-01 P2 v3 阶段提交（候选）

状态：`87a0fac` 独立快照的 P2 v3 安全阶段复核通过；Tester 完整回归仍在进行，不能标记完整工程验收通过，更不是整个 GAMEPLAY-01 PASS。真人验收 HUMAN ACCEPTANCE PENDING。

## 内容

ECHO 使用同一个纯 EchoController：保留手动 FOLLOW/HOLD/MOVE-TO，增加观察、本地建议、合法感知记忆及明确授权后的低风险移动。记忆有来源、容量 16、600 tick 时效和房间代次失效规则，审计不反向参与策略。

离线本地建议明确标为 local-echo，不创建模型连接。人类确认边界重新验证 actor、控制权、建议 ID、有效期、房间和当前可见目标，确认时取得 originRoomId，来源设为 human-local，再经现有 core 命令下一 tick 执行。外部模型 Owner 路径及能力边界保留。

每次最多一个未结算本地动作：等待期间不生成新可确认建议，UI 与直接边界调用都拒绝重复；回执关联 proposalId。已知本地取消仅移除对应命令。raw-sim 恢复保留原队列，并对待处理 ECHO 信号动作建立来源未知的 restored busy 标记，禁止再次确认；不伪造 human-local 来源，不删除其它 actor 或外部 Owner 命令，真实结算后解除。

真实 RunCheckpoint 不含 pendingCommands：暂停确认后、执行前刷新会回到确认前安全检查点，排队动作不会复活。Queued 不等于 Done。这与 raw-sim 的保留队列恢复契约不同。

## 已有证据与边界

- Developer 原阈值下一次纯单测 794/794：原 P1 755 + P2 新 39（policy 19、headless 17、save 3）。另外 surface 1 与真实新导出 parity 3 分组运行，通过。
- CLI quit 仍是原 15s/整体 20s；放宽阈值的旧 780 结果是 obsolete-config，不可替代 v3 门禁。
- v1 暂停重复确认失败和 v2 raw-sim 恢复 queue1→2 失败均保留。v2 独立复测已证明 Rendered 重复确认闭环，但发现恢复缺陷，不能用于 v3 恢复保证。
- Developer v3 先保存恢复失败反例，再验证原队列保留、二次确认被拒、只执行一次；Reviewer 已在 `87a0fac` 独立快照复核通过：98 条针对性单测、2 条浏览器测试及恢复/混合队列探针。范围见 [P2_V3_REVIEW.md](reviewer/P2_V3_REVIEW.md)，不代替完整回归。
- Tester v3 固定目录为 `D:/tmp/ls-p2-v3-accept`：基底 `2c4584c` + manifest 10 个 P2 文件及其测试快照，自有 npm ci、无共享链接。之后共享目录的 P3 改动不能作为该快照的证据。
- 已有浏览器精确时序证明暂停 tick/HP/energy 不变；Scan 首次提交扣 ECHO 能量 10，玩家能量不变。较晚采样的 100→97 含回能，不是成本 3。
- 正式 Headless 驱动同一个 Controller，但 P1 route/portal 仍为 Rendered-only；旧 parity 与 P2 signal parity 不证明完整协作关卡等价，P4 需补关键规则。
- Magpie Player 最小游戏链路已单独提交 `dcd1955`；ECHO 在 `87a0fac` 独立快照上完成两次真实模型实验，分别提出 toggle-relay 与 scan，走官方观察/建议、Owner fixture 确认或拒绝、真实 tick 与断线降级。成功 trace 可独立核实 4 次模型请求；早期 6 次仅有执行者记录，原始日志被覆盖，不可独立复核。执行者记录总数为 10，上限 12 的完整遵守情况缺少原始证据。失败说明和成功请求账本见 [REAL_MODEL_ECHO_REPORT.md](reviewer/REAL_MODEL_ECHO_REPORT.md)，不声称失败记录完整。本地确定性建议不属于模型证据；自动 Owner 点击属于 fixture，不是本人试玩。
- Tester v3 新 E2E 已执行 6/6、skip 0，未过滤的完整 typecheck 通过；纯单测、surface、build、全量 Playwright 与新导出 parity 的最终结果仍待回报，不能拼接历史通过数。

源码及证据哈希见 [manifest](developer/p2/final/manifest.json)；规则及调用链见 [P2_IMPLEMENTATION.md](../../docs/gameplay/P2_IMPLEMENTATION.md)。历史问题见 [P2_FINAL_REVIEW](reviewer/P2_FINAL_REVIEW.md) 与 [P2_V2_REVIEW](reviewer/P2_V2_REVIEW.md)，新版本说明见 [final-v3 README](developer/p2/final-v3/README.md)。后续独立结论和完整结果另行提交，不混用版本。

执行渠道：Orca Worker developer 实现；Orca Worker reviewer 独立审查；Orca Worker tester 独立快照回归。仅本地阶段提交，不 push、PR 或 merge main。
