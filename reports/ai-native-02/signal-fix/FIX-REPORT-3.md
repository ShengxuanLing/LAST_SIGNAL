# 修复 3 — 关闭 room-notify 在途竞态（FIX-REPORT-3）

- 现场阻断：Tester `reports/ai-native-02/tester/companion-room-cancel-final/13-notify-race.json`（R04/R05 FAIL）+ `14-notify-race.log`；Reviewer `reports/ai-native-02/reviewer/companion-room-cancel-final/REVIEW.md`（阻断 + 4 项非阻断）
- 该阻断的上一状态：`7c0068f`（只靠 HTTP 取消，最终到达前仍可确认执行）
- 本次提交：`c233e5c`（parent `7c0068f`；10 文件 +758/−44）
- 原始模型证据、Tester 证据、Reviewer 探针**均未改动**；reviewer 的两个探针文件仅只读参考

---

## 1. 缺陷与根因

`notifyRoom` 是**异步 HTTP**，而 Owner 确认的 `apply` 是**浏览器同步本地调用**，所以：

```
portal 提交 → notifyRoom 发出（网络在途，Tester 人为延迟 4000ms）
   ⇒ 旧建议在窗口内被 confirm：decide ok → apply → 下一 tick 提交 → markApplied ok
   ⇒ 迟到的 roomChanged 到达时已无法撤销已执行动作（receipt: applied, 40/45）
```

单靠“取消最终会到达”不成立。必须在**浏览器本地、确认之前**同步成立房间栅栏，并在每个 `await` 之后再次校验。

---

## 2. 修复（含 reviewer 的 A/B/C/D）

### 2.1 同步本地栅栏（主修）

`CompanionLink` 新增（私有字段 + 只读访问器）：

| 字段 | 含义 |
|---|---|
| `#roomId` / `roomGeneration` | 渲染层自己的房间与单调世代（**只由真实房界同步推进**） |
| `#roomTick` | 房界 tick（上报给 bridge，用于乱序兜底） |
| `#lifecycle` | authorize / re-authorize / fallback / disconnect / 房界 都会 +1 |
| `#lastApplyGeneration` / `#lastApplyRoomId` | 最后一次**真实 apply** 发生在哪一代（收据真相） |

- `enterRoom(roomId, tick)`：**同步**，无网络；由 `GameScene.onRoomEntered`（真实房间提交边界）在**任何 await 之前**调用；授权路径也用当前房间先播下种子（否则建议会以 `roomId=null` 出生）。
- `decide(suggestion)`：
  1. **同步本地栅栏**：`suggestion.roomId !== #roomId` → 立刻 `E_STALE_GENERATION companion.suggestion_room_changed`，**不发请求、不 apply**；
  2. 捕获 `{session, epoch, roomId, generation, lifecycle}`；
  3. `await` 决策请求之后**再次校验**捕获值（房间/生命周期/会话变了就丢弃响应）；
  4. `apply` 之前**再校验一次**；成功后记录 `#lastApplyGeneration/#lastApplyRoomId`。
- `pending()`：`await` 后校验捕获值（陈旧列表不呈现）+ 按本地房号过滤旧房建议。
- `pushObservation()`：观察携带 `roomId`（发送时刻的本地房间）；`notifyRoom()` 携带单调 `roomSeq`，并忽略属于已离开房间的响应。
- `postApplied()`：携带**执行世代/房间**（来自 `#lastApply*`），`GameScene.pendingCompanionReceipt` 也记录该世代；房界时清空未发出的收据。

### 2.2 Reviewer (A) 同房幂等 —— 在任何 mutation 之前判定

`gateway.roomChanged()` 现在：`currentRoom === roomId` → **直接 no-op 返回**（不动 decisions、不动 generation、不丢观察）；`facet.applyRoomChange()` 同房也**无条件早退**（不再因 `alsoCancel` 非空而跳过幂等）。
回归：带“已 confirmed 未 applied”决策的同房重复 ×3 → generation 不变、无取消、收据仍是 `confirmed`，并且之后仍能真实 applied。

### 2.3 Reviewer (B) 乱序报告 —— 单调房间提交序号

`notifyRoom` 上报 `roomSeq = 本地 generation`；`gateway.roomChanged(session, epoch, roomId, tick, roomSeq)`：
- 有 `roomSeq` 时以它为准（`seq <= currentGeneration` → stale no-op）；无 `roomSeq` 时回退用 `tick < currentRoomTick`；
- stale 返回 `{stale:true, cancelled:[], roomId: 当前房间}`，**不取消新房建议、不回退房号**。
- 观察也带 `roomId`：网关拒绝“旧房观察”（`companion.observation_stale_room`），迟到的 A 观察无法给 B 房重新播种感知。
回归：A→B→C（第一个报告延迟 5s）落地后 `status.roomId` 仍是 C；迟到的 A 报告 `cancelled=[]`、新房建议仍 pending。浏览器层 T3 覆盖同一时序。

### 2.4 Reviewer (C) 路由分类 —— 回归 browser-only

`/world-link/companion-room` 从 `agentRoute`（无 Origin 的 token-only 白名单）移除。效果：
- Agent 形态（token、无 Origin）→ **外层 Origin 门** 403 `world.origin_denied`（与 `companion-decision` 的契约一致）；
- Owner 形态（允许 Origin + token + ownerCap）→ 进入 handler，200。
回归：`companionRoomBoundary.test.ts` 2 条 + T1 里真实桥上的 403 `world.origin_denied` 与 `roomResponses` 含 200。

### 2.5 Reviewer (D) 收据真相 —— 执行世代

- 决策记录新增 `generation` / `roomId`（决策时的世代与房间）与 `stale`。
- 房界时：**不删除**已 confirmed 未 applied 的记录，而是标记 `stale` 并写墓碑；收据在其未 applied 前显示 `cancelled/room_changed`。
- `markApplied(id, tick, {generation, roomId})`：**校验上报的执行世代**；与记录世代不符 → `E_STALE_GENERATION companion.applied_generation_mismatch`。
- **迟到但来自原世代**的 applied 仍被接受并落成 `applied`（记录里是旧世代/旧房），不会因为到达顺序被改写成 cancelled。
回归：单测覆盖“新世代收据被拒 / 原世代迟到收据 = applied”。

---

## 3. 红 → 绿（确定性，非运气）

| 阶段 | 内容 | 结果 | 日志（绝对路径） |
|---|---|---|---|
| 现场红（Tester） | 4000ms 延迟窗口内旧 confirm 成功、applied 40/45 | FAIL（未改动） | `D:\Project\LAST_SIGNAL\reports\ai-native-02\tester\companion-room-cancel-final\13-notify-race.json` |
| 本修复红对照 | 临时禁用 `link.enterRoom(...)`（同步栅栏），同一 T1 | **FAIL**（`the local barrier follows the committed room`：期望 3，得到 0） | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\RED-race-without-barrier.log`（sha256 `d83e7420…a65b`） |
| 修复绿（race 3 条 + cancel 2 条） | 真实浏览器 + 真 bridge + 官方 MCP | **PASS 5/5**（32.2s） | `…\signal-fix\GREEN-race-and-cancel.log`（sha256 `0b393509…f3da`） |
| 单测（房间世代 9 条） | 含 A/B/D 新增负向 | **PASS 9/9** | `…\signal-fix\room-generation-unit-2.log`（sha256 `53b661ec…1176`） |
| 单测（桥路由分类 2 条） | Agent 403 外层门 / Owner 到达 handler | **PASS 2/2** | `…\signal-fix\room-boundary-unit.log`（sha256 `2611d6c1…4fa2`） |

三个浏览器用例分别对应 Lead 的三条要求：

- **T1**（room POST 延迟 4000ms）：窗口内旧 confirm 同步被拒（`E_STALE_GENERATION`）、无 pendingIntent、无排队命令、无 echo 弹、无射击计数；通知落地后收据 `cancelled/room_changed`（绝非 applied）；Agent 直呼取消路由 403 `world.origin_denied`；新房 move 建议 `roomId=new` 且 Owner confirm 后下一 tick 一次性执行。
- **T2**（decision 请求已到服务端、响应延迟 6s，期间过门）：渲染层 `decide` 返回 false（`E_STALE_GENERATION`），无 apply；服务端账本 `cancelled/room_changed`，绝不 applied。
- **T3**（A→B→C，第一个报告延迟 5s）：本地栅栏跟到 C（generation ≥ 2），迟到报告落地后 `status.roomId` 仍 C、`cancelled=[]`、新房建议可用且 `roomId=C`。

---

## 4. 门禁（一行一条：PASS/FAIL + 命令 + 结果 + 日志）

| # | 命令 | 结果 | 日志 |
|---|---|---|---|
| 1 | `npx vitest run src/ai-native/companionRoomGeneration.test.ts` | PASS 9/9 | `…\signal-fix\room-generation-unit-2.log` |
| 2 | `npx vitest run src/ai-native/companionRoomBoundary.test.ts` | PASS 2/2 | `…\signal-fix\room-boundary-unit.log` |
| 3 | `npx playwright test tests/companion-room-race.spec.ts -g "T1 delayed room notification"`（栅栏禁用，RED 对照） | FAIL（预期） | `…\signal-fix\RED-race-without-barrier.log` |
| 4 | `npx playwright test tests/companion-room-race.spec.ts --project chromium` | PASS 3/3（31.3s） | `…\signal-fix\playwright-room-race.log`（sha256 `00e36982…40cd9`） |
| 5 | `npx playwright test tests/companion-room-race.spec.ts tests/companion-room-cancel.spec.ts --project chromium` | PASS 5/5（32.2s） | `…\signal-fix\GREEN-race-and-cancel.log` |
| 6 | `npx playwright test`（7 个 signal/companion spec 合跑） | PASS **12/12**（1.5m） | `…\signal-fix\playwright-race-suite.log`（sha256 `fdff163a…5fcb5`） |
| 7 | `npx vitest run src/ai-native src/world/sim` | PASS **634/634**，54 文件 | `…\signal-fix\regression-race-alone.log`（sha256 `c297e33e…8283`） |
| 8 | `npx vitest run`（全量） | PASS **738/738**，64 文件 | `…\signal-fix\full-suite-3.log`（sha256 `9464747d…e261f`） |
| 9 | `npx tsc --noEmit` | PASS（exit 0，0 字节输出） | `…\signal-fix\tsc-5.log`（`e3b0c442…b855`） |
| 10 | `npm run game:mcp:build` | PASS | `…\signal-fix\mcp-build-5.log`（sha256 `58606a59…b103a`） |
| 11 | `npx vite build` | PASS（35.57s） | `…\signal-fix\vite-build-3.log`（sha256 `4ee80c0e…26ce`） |

**一次负载性误判（如实记录）**：我先同时跑“`vitest run src/ai-native src/world/sim`”与 7 个 Playwright spec，`worldBridgeServer.test.ts`（heartbeat→409）与 `agentLease.test.ts`（5s 超时）各挂一次。单独重跑这两个文件 **15/15 PASS**（`…\signal-fix\recheck-bridge-lease.log`，sha256 `f292536d…312a`），随后同命令的 634/634 也在隔离下全绿。结论：并发造成的 CPU 饥饿，不是本次改动；测试语义未改。

---

## 5. 语义小结（一张表）

| 维度 | 取值来源 | 何时变 | 用途 |
|---|---|---|---|
| `session` / `epoch` | bridge 授权 | 授权/重授权 | 不因房界变化；不做强制重授权 |
| `roomId` | 渲染房界（同步）+ 上报 | 真实房间提交 | 建议归属、本地栅栏、观察归属 |
| `roomGeneration` / `roomSeq` | facet 单调自增（唯一自增点 `applyRoomChange`） | 真实房界 | 建议/决策世代、乱序拒绝、墓碑 |
| `roomTick` | 房界真实 tick | 真实房界（取 max） | `roomSeq` 缺失时的乱序兜底 |
| `lifecycle`（渲染本地） | authorize/fallback/disconnect/房界 | 上述任一 | 每个 await 后校验；旧响应不得 apply |
| 墓碑 `cancelledByRoom` | 房界取消的 id | 只增（FIFO 512） | 持旧对象/重放旧 id 一律拒；不因下一世代清空 |

---

## 6. NOT RUN / 限制

- **NOT RUN**：Reviewer 对新 hash 的定向异步负向复验（本报告不宣称整体放行）。
- **NOT RUN**：Lead 用真实模型再跑一轮跨房场景；Tester 独立重跑（命令见第 4 节，可用其自身探针改指向）。
- **NOT RUN**：真人（非自动点击）Owner 确认验收。
- 已知边界：墓碑 FIFO 512 淘汰后，极端旧 id 退化为既有 `E_RETRY_AFTER_EVICTION` / `E_TARGET_DESTROYED`，仍不可执行；`pending()`/`suggest` 载荷新增 `roomId/generation` 属 additive 字段（未改版本号），旧严格校验客户端需同步（Reviewer 已提示）。
- 未做：不 flush、不冻结正常游戏（栅栏全在渲染侧同步判定，正常帧率不受影响）；不自动重新授权；网络失败仍只落真实 fallback。
