# 修复 2 — 跨房旧 Companion 建议仍可执行（FIX-REPORT-2）

- 现场：Tester 探针 `reports/ai-native-02/tester/signal-field-fix/11-cross-room-suggestion.json`（X07 FAIL）+ `12-cross-room-suggestion.log`
- 上一修复：`246469b`（本文件不改它）；本次提交：`7c0068f`
- 冻结对照：`363eb173207bb5adaa0a21cd1af348dc92f29827`
- 原始模型证据（`reports/ai-native-02/lead-signal-model-live/`）与 Tester 目录**均未改动**

---

## 1. 缺陷事实（Tester 已复现，不是预期行为）

```
X03 在房间 A(0) seed 一个 fire 建议 sug_d302…（未确认）
X05 真实 portal A(0) → B(3)
X06 status 仍 pending 该建议
X07 Owner 用旧对象确认 → decided:true → 旧坐标 (10,45) 发射 1 发弹（projectiles:1）
```

**为什么 `246469b` 没修掉**：那次只在渲染进程清了本地 `echoController`/`pendingCompanionIntent`。
建议账本与 Owner 决策路径在 **Link / gateway / facet**，三者完全不知道房间变了，于是
`pending` 继续列出、`decide` 继续接受、浏览器继续 `apply`。

---

## 2. 语义（房间 generation，显式且可观察）

| 概念 | 定义 | 位置 |
|---|---|---|
| `roomId` | 建议所属房间；建议对象携带（`suggestion.roomId`） | facet |
| `roomGeneration` | 单调计数，**只在真实房间提交时 +1**；建议携带（`suggestion.generation`）；`echo_status.status.roomGeneration` 可见 | facet |
| 墓碑 `cancelledByRoom` | 被房间变更取消的 id → 原因 `room_changed`；**FIFO 有界（与 dedup 同上限 512），只按最旧淘汰，绝不因下一次 generation 变化被清空/重放** | facet |
| `tick` | 取消时用真实 `world.sim.tick` 记录（receipt 里 `decidedAtTick/appliedTick` 仍为 null） | gateway/bridge |
| `session/epoch` | 不变：仍由既有 epoch 校验；本次**不要求断线重授权** | 既有 |

**提交边界执行的一次性动作**（`World.onRoomEntered` → 渲染层上报 → bridge → gateway → facet）：

1. 取消**所有未确认**建议（tombstone + `evicted`）；
2. 取消**已确认但从未 applied** 的决策（它们属于旧房；`markApplied` 后被拒绝）；
3. 丢弃已发布观察、清空旧房记忆（agent 必须先 observe 新房才能再 suggest）；
4. `roomGeneration += 1`；
5. 渲染层随后**推送新房的已提交观察**，让新一轮 suggest 立刻合法。

**其它约束**：
- 同房间重复上报是幂等 no-op（暂停/恢复、心跳不会取消任何东西）；
- 重复/迟到的 `echo_suggest`：房间取消的 id 在观察门禁**之前**就被拒（`E_STALE_GENERATION` + `companion.suggestion_room_changed`），换 `requestId` 也不能复活；
- 已 applied 的历史保留 `applied`（不会被追溯改成 cancelled）；
- **Agent 不能触发取消**：`POST /world-link/companion-room` 必须同时具备 bridge 签发的 Owner capability **且** 游戏 Origin；只有 token 的 Agent 得 403。

---

## 3. 改动（7 文件，+684/−4）

| 文件 | 变更 |
|---|---|
| `src/ai-native/companionFacet.ts` | 建议携带 `roomId/generation`；`applyRoomChange(roomId, tick, alsoCancel)`（取消 + 墓碑 + 清观察/记忆 + bump）；`roomCancellation()`/`cancelledSuggestionIds()`；status/snapshot 暴露房间代数；`validateOwnerDecision` 支持 `roomCancelled` → `E_STALE_GENERATION` |
| `src/ai-native/companionGateway.ts` | `roomChanged()`：取消未确认 + **已确认未 applied**；`state.observation=null` 仅在真实变化时（幂等安全）；`status()` 新增 `cancelled/room_changed` receipts；`markApplied` 拒绝房间取消的 id；`suggest` 增加房间代数的早拒绝（先于观察门禁） |
| `src/ai-native/companionLink.ts` | `notifyRoom(roomId, tick)`：渲染层上报（带 cap），不发游戏状态、不抛异常 |
| `src/ai-native/worldBridgeServer.ts` | 新浏览器专用路由 `POST /world-link/companion-room`（Origin + ownerCap 双校验），并在 CORS/预检列表登记 |
| `src/scenes/GameScene.ts` | 在**真实房间提交边界** `onRoomEntered` 上报房间，然后推送新房观察 |
| `src/ai-native/companionRoomGeneration.test.ts` | 7 条单元回归（见下） |
| `tests/companion-room-cancel.spec.ts` | 2 条真实浏览器/真实 bridge/官方 Companion MCP 回归 |

---

## 4. 红 → 绿

| 阶段 | 内容 | 结果 | 日志 |
|---|---|---|---|
| 基线红（Tester，246469b） | X07 旧对象确认成功、旧坐标发弹 | FAIL（已存在，未改动） | `reports/ai-native-02/tester/signal-field-fix/11-cross-room-suggestion.json` |
| 红（本修复，去掉房间上报钩子） | 同一 spec：过门后旧建议仍 pending | **FAIL**（`expect(statusB.pending…).not.toContain(oldId)`） | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\RED-room-cancel-without-hook.log`（sha256 `6b9b9e83…8962`） |
| 绿（钩子恢复） | 同 spec 2 条 | **PASS 2/2**（10.7s） | `…\signal-fix\GREEN-room-cancel.log`（sha256 `0894bbab…c91f`） |
| 单元 | 7 条房间代数语义 | **PASS 7/7** | `…\signal-fix\room-generation-unit.log`（sha256 `1396f5b3…ca59`） |

**单元覆盖（`companionRoomGeneration.test.ts`）**：
1. 未确认建议被取消 + 显式 `cancelled/room_changed` receipt；
2. 持旧对象 `decide` → `E_STALE_GENERATION`；`markApplied` 同样拒绝；
3. 已确认未 applied 被取消（receipt cancelled）；
4. 已 applied 保留 `applied`；
5. 重复 suggest（同 requestId / 换 requestId）都不会复活；
6. 新房必须先 `pushObservation` 才能再 suggest（且新建议 roomId=B）；
7. 同房间重复上报幂等（暂停/恢复不取消）。

**真实 UI 覆盖（`companion-room-cancel.spec.ts`，官方 SDK + 真 bridge + 真 portal）**：
旧建议 seed → 真实过门 → status 无旧 pending 且 receipt `cancelled/room_changed` → 持旧对象 confirm 被拒（`E_STALE_GENERATION`）→ 无 pending intent / 无排队命令 / 无 echo 弹 / 无射击计数变化 → Agent 直接 POST cancel 路由得 **403** → 新房 observe 后新建议 `roomId=B` → Owner confirm 后**下一 tick 一次性**执行（pendingIntent true→false，receipt confirmed/applied）；另测暂停/恢复不取消。

---

## 5. 门禁（一行一条）

| # | 命令 | 结果 | 日志 |
|---|---|---|---|
| 1 | `npx vitest run src/ai-native/companionRoomGeneration.test.ts` | PASS 7/7 | `…\signal-fix\room-generation-unit.log` |
| 2 | `npx playwright test tests/companion-room-cancel.spec.ts:122 --project chromium`（钩子禁用，RED 对照） | FAIL（预期） | `…\signal-fix\RED-room-cancel-without-hook.log` |
| 3 | `npx playwright test tests/companion-room-cancel.spec.ts --project chromium` | PASS 2/2（10.7s） | `…\signal-fix\GREEN-room-cancel.log` |
| 4 | `npx vitest run src/ai-native src/world/sim` | PASS 630/630，53 文件 | `…\signal-fix\regression-room-generation.log` |
| 5 | `npx vitest run`（全量） | PASS **734/734**，63 文件 | `…\signal-fix\full-suite-2.log`（sha256 `014adc1a…b3fa`） |
| 6 | `npx playwright test tests/companion-room-cancel.spec.ts tests/signal-coop-e2e.spec.ts tests/signal-rendered-parity.spec.ts tests/signal-sdk-negative.spec.ts tests/echo-portal-migration.spec.ts tests/p3b-companion-owner.spec.ts --project chromium` | PASS **9/9**（29.0s） | `…\signal-fix\playwright-companion-signal-final.log` |
| 7 | `npx tsc --noEmit` | PASS（exit 0，无输出） | `…\signal-fix\tsc-4.log`（0 字节） |
| 8 | `npm run game:mcp:build` | PASS（1.0s 级） | `…\signal-fix\mcp-build-3.log` |
| 9 | `npx vite build` | PASS（13.88s） | `…\signal-fix\vite-build-2.log` |

---

## 6. NOT RUN / 限制

- **NOT RUN**：Lead 再用真实模型跑一轮跨房场景（本修复不产生模型证据；建议下一轮现场复核改为“过门后旧建议消失 + 新建议一次执行”）。
- **NOT RUN**：Tester 独立重跑（本次只由我提供红绿；独立复核请照第 5 节命令复现）。
- **NOT RUN**：真人（非自动点击）Owner 确认验收。
- 观察（不改）：`/world-link/companion-status` 仍是 Agent 只读通道（无 ownerCap），本次新增的 cancel 路由是唯一新增渲染层变异点，Agent 侧无法到达。
- 已知边界：墓碑按 FIFO 上限 512 淘汰；极端情况下被淘汰的旧 id 会退化为既有的 `E_RETRY_AFTER_EVICTION`/`E_TARGET_DESTROYED`，仍不会执行。
