# P3-b A：Companion facet 纯模块（`companionFacet.ts`）

- 基线 `b3930c5`；本提交只新增纯模块 + 单测，不动 P3a core/World/UI/协议接线。
- 唯一对外能力：`echo_observe` / `echo_suggest` / `echo_status` / 有界 memory；**无** confirm/reject/owner/stepPlayer/Dev。
- 观察：调用方给出 echo 自己的 center+LOS 视图，模块再做 12 格裁剪；输出不含 seed/RNG/map/hidden。
- 记忆：≤16 条、TTL 600 tick；建议：≤8 条未确认、TTL 600、会话 dedup 512 硬界；容量满拒绝而非 FIFO 淘汰后执行；过期/断线/epoch 变更写 tombstone，重试 `E_RETRY_AFTER_EVICTION`。
- reason 必须由**当前观察**可证（perceived_hostile / perceived_relay / no_perceived_target / objective_blocked），否则 `E_SCHEMA companion.reason_unobserved`；目标必须落在 echo 自身 12 格感知内。
- 断线显式 `setLink('fallback')` → 取消未确认、`fallbackLabel='NO_MODEL'`，不自动重连/接管；AI/External 主角模式只读并取消未确认。
- 复核边界：wire 级 v1/v2 协商、Owner confirm 入口、gateway 绑定在后续 B/C 提交；本模块不自行执行任何动作。
