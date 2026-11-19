# AI-NATIVE-02 非阻断限制清单（`c2a31af`）

> 这些是已知、已定界、未在本轮修复的限制；不扩大设计、不改源码、不放宽断言。

## 1. Signal / Companion 语义

1. **toggle 被 core 拒绝时没有事件痕迹**
   - `originRoomId` 不匹配时 core 在 `events.push` 前 `break`：relay/manual/power/exit 不变，也不发 `signal-relay-changed`。
   - 后果：外部只能从设备状态判断“没生效”；scan/jam 被拒仍可能有事件，toggle 被拒没有专门事件。
   - 影响：可观测性/对账，不是安全或玩法阻断。

2. **收据表达“确认已投递并被 tick 消费”，不表达“物理效果一定发生”**
   - 这是既有语义（scan 在范围外也可 `applied` + `found:false`）。
   - 本轮没有扩大为“所有 action 必须物理生效”。

3. **parity 未覆盖 `originRoomId`**
   - rendered parity 导出器记录 `{type, enabled, powered, actor}`，不记录 Companion 内部 `originRoomId`。
   - 当前 parity 双方都用 `enqueueSignalCommand` 直发（不带 binding），所以 3/3 通过；若未来把 Companion 确认 toggle 放进 parity，需要同步导出 binding。

4. **`originRoomId` 的语义是“确认时玩家所在房”**
   - 玩家离开又回到设备房后再确认旧建议，会因 origin==current==device 而放行。
   - 这是“同房合法”的自然结果；若产品要求旧建议永不跨任何房界，需另加 suggestion 世代校验（产品口径，不是本轮缺陷）。

5. **Signal 多 seed 批次没有独立 Playwright/npm 门禁**
   - 现有真实批次在 vitest/MCP dev 工具内；没有扩张为独立浏览器门禁。

## 2. 测试 / 验证限制

6. **`ai-native-world` 死亡结算已知 flake**
   - 首跑 `GameOverScene after death`，隔离复跑 1/1 PASS；历史同类记录见 `tester/p3a-final/17b-flake-rerun.log`。
   - 未放宽断言，未改代码。

7. **`c3c-headless-parity` 缓存问题已在 `d1f29d1` 修复**
   - 根因是 `World.sim` 缓存未在 `spawnEnemy`/`spawnBoss` 后失效；已用既有 `bumpSimVersion()` 修复，并新增真实回归 `tests/world-sim-cache.spec.ts`。
   - 修复后 c3c Rendered 导出 + Node 16/16 PASS，最终完整 E2E 88/88；旧 RED/83/85 日志仅作历史保留。

8. **硬编码端口已改为 `PORT ?? 旧默认`**
   - `tests/boss-room.spec.ts` 默认仍 5173，`tests/canvas.spec.ts` 默认仍 5199；本轮用自有 5411 运行并通过，未动他人 5173/5199。
   - 当前不构成 NOT RUN。

9. **单机 / 单平台**
   - 所有证据来自本机 Windows、单 Playwright worker；未做跨机器/跨系统/并发稳定性。

## 3. 架构范围（不是本轮新增任务）

10. **非 drone legacy FSM 未迁移到 Headless**
    - Rendered adapter 仍保留 legacy 非 drone FSM 决策；core 覆盖弹丸/HP/位置/奖励等已迁移部分。
    - 这是已知架构边界，不升级为本轮额外硬任务。

11. **既有视觉随机/房间生成/adapter 生命周期**
    - 不属于 Signal 任务范围；未顺手重构。

## 4. 人工验收

12. **最终真人验收未发生**
    - 现有模型证据的 Owner CONFIRM/AUTHORIZE 均为自动点击夹具。
    - 没有真人完整试玩、真人录像、真人可读性/理解签字。

13. **旧模型证据的范围**
    - `lead-live` 是单 drone/start room 最小遭遇；`lead-headless-cropped` 是最小默认 drone；`lead-echo-model-live` 是两轮 fire；`lead-signal-model-live` 是 scan/toggle 最小回合，未覆盖 jam。
    - 这些都不能外推为完整 Run、自主路线或跨平台稳定性。

14. **不可本地复核的历史引用**
    - `reports/ai-native-02/lead-live-drone/` 在当前工作区不存在；旧报告中的该目录保持历史断言，但本轮不计为证据、也不删除历史。

15. **旧 `status.pending` 语义**
    - 早期模型证据中 `echo_status.pending` 将已确认建议仍显示为 proposed；该缺口后来由 `receipts` 只读账本修复（`a1188c2` 等）。
    - 旧证据保留原样，不修改其历史含义。
