# 7c0068f 房间世代失效链 — 独立复核（收束）

- 被测：`7c0068f6c40cf3059b107260de50cbf0a3c4b9e1`（父 `246469b7d7e82bb469f62f80f293b0702af46588`，已解析完整 hash）
- 隔离：`git archive 7c0068f` → `D:\review-cancel\snap`，**2045 tracked 文件**；`git ls-tree -r 7c0068f`（blob sha1/路径）vs 快照内 `git hash-object` 全量 → **diff 0 行**
- 复核者：独立 worker `mmxu9qr3pny4jua138sycuoq`；只读冻结源码/测试/配置；自有 dev `strictPort 5373`（用完仅关自己的 vite，已验证 0 残留；5173 未动）；未 merge/push/reset/rebase；未读 WIP/stash；未覆盖任何原有失败或模型证据；secret 未进日志/URL/截图
- 逐门一行见 `GATES.md`；日志在 `…\companion-room-cancel-final\logs\`；我自写的两个探针源码在同目录

## 结论（一句话）

**正常路径已关闭：** 房间提交 → `GameScene.onRoomEntered` → `CompanionLink.notifyRoom`（ownerCap + Origin）→ `CompanionGateway.roomChanged` → `Facet.applyRoomChange`（代际 +1、作废未确认、墓碑、丢弃旧观察/旧记忆）→ 新观察 这一整条链在**正常时序**下成立：旧建议过门后不可确认、旧 req/id 不可复活、agent 无法作废、新房需重新观察才能再提议、pause/resume 不作废（E2E 2/2、unit 7/7、我的 7 条确定性排序探针全过）。
**在途竞态未关闭（阻断）：** `notifyRoom` 是**异步网络**，而 Owner 确认的 `apply` 是**浏览器同步本地调用**。在 notify 往返窗口内落地的旧 confirm 会 `decide ok → enqueue → 下一 tick 提交 → markApplied ok`，到达的 `roomChanged` 已无法撤销已执行动作。Tester 用 4000ms 延迟复现（`13-notify-race.json` X/R04-R05，receipt `status:"applied", appliedTick:45`），我在账本层用确定性排序得到同型证据（我的 P3）。**建议的“同步本地 generation + await 后校验”正是补这个窗口；我不为任何新 hash 背书，待新提交后再做定向异步负向复核。**

## 1) 机制与时序（源码逐点）

| 环节 | 事实 |
|---|---|
| 房间提交点 | `World.updateRoom` → `onEnterRoom` → `callbacks.onRoomEntered`（`World.ts:713-719`）；`Player.reset` 摆位不产生房界（`currentRoomId` 不在那里置 -1），所以夹具摆位不会误触发 |
| 渲染侧 | `GameScene.onRoomEntered`（`:699-710`）：`link.status==='CONNECTED'` 时 `void link.notifyRoom(room.id, sim.tick).then(ok => ok && link.pushObservation())` —— **fire-and-forget**，无串行化、无本地同步兜底 |
| Link | `notifyRoom` 需要 `CONNECTED + #cap`，失败只返回 false，不抛（`companionLink.ts:139-156`） |
| Bridge | 新路由 `/world-link/companion-room`：`originMatches` + `capOk(session, ownerCap, epoch)` 后才 `companions.roomChanged`（`worldBridgeServer.ts:124-141`） |
| Gateway | `roomChanged()`：校验 roomId/tick → **删除所有 `applied !== true` 的决策**并作为 `alsoCancel` 传给 facet → `applyRoomChange` → 代际变化时丢弃已发布观察（`companionGateway.ts:225-252`） |
| Facet | `applyRoomChange`：同房且 `alsoCancel` 为空 → 直接返回（幂等）；否则作废所有 pending + alsoCancel，写 `cancelledByRoom` 墓碑（FIFO 512）、代际 +1、`currentRoomId` 更新、`lastObservation/lastObservationTick/memoryValue` 清空（`companionFacet.ts:536-583`） |
| 决策门 | `validateOwnerDecision` 新增 `roomCancelled` → `E_STALE_GENERATION companion.suggestion_room_changed`（`:701`）；`decide()` 与 `markApplied()` 都会检查（`companionGateway.ts:284/307`） |
| 建议门 | `gateway.suggest()` 把“房界墓碑”放在**观察门之前**，所以重放旧 req/id 得到 `E_STALE_GENERATION` 而不是含糊的 no_observation（`:148-155`） |

## 2) 正常路径：关闭（PASS）

- **unit 7/7**（`companionRoomGeneration.test.ts`）：作废+显式 cancelled 收据、持有旧对象不可决定、**已 confirmed 未 applied 被作废而非执行**、已 applied 保持 applied 历史、重复 suggest（同/新 requestId）不复活、新房必须先有新观察、同房幂等。
- **E2E 2/2**（`tests/companion-room-cancel.spec.ts`，自有 5373）：真实 portal 下旧建议不可确认/不执行/不扣费、agent 403、新房正常一次、pause/resume 不作废。
- **我的确定性排序探针 7/7**（`roomGeneration.probe.test.ts`，无浏览器无定时器，纯调用顺序）：P1 代际单调且 session/epoch 不变、同房无 pending 时确为 no-op；P4 房界后对“持有的旧对象”decide → `E_STALE_GENERATION`；P6 墓碑 FIFO 512 淘汰后 `roomCancellation(oldest)=null` 但 `expiredSuggestionIds` 仍含该 id（**不可重执行**）；P7 新房观察落地前 `E_LINK_UNAVAILABLE`、落地后可正常提议。
- **回归**：Owner/权限 6 文件 **54/54**；合作链 10 步 **1/1**（`room 3 → -1` 仅过渡态，不影响）；tsc 0；MCP 构建 0。

## 3) 在途竞态：未关闭（阻断）

**机制**：`decide()` 成功后浏览器**同步**调用 `apply → world.enqueueCompanionAction`，命令在下一 tick 提交，随后 `GameScene` 在 `tick > enqueuedTick` 时 `postApplied`（`GameScene.ts:449-452`）。`notifyRoom` 是独立网络请求。只要 confirm 的 `decide/apply/applied` 全部落在 notify 落地之前，动作就已经真实发生；`roomChanged` 到达时只能删决策记录，**无法撤回已入队/已提交的 core 命令**，也无法撤回 action。

**证据**
- Tester（浏览器、4000ms 延迟）：`13-notify-race.json` R04 `inWindow.ok=true`（在窗口内确认成功）、R05 通知到达后 `decide` 被拒（`E_RETRYABLE decision_exists`）但 receipt 已是 `{"status":"applied","decidedAtTick":40,"appliedTick":45}` —— 旧房动作已执行并被记为 applied。我核对了原始 json/log 字段。
- 我的账本层孪生（P3）：`decide(confirm)` ok → `roomChanged` → 迟到的 `markApplied` 返回 `E_STALE_GENERATION`，收据变 `cancelled/room_changed/decidedAtTick:null`。
- 两者合起来说明：**同一个物理事件，谁后到就写谁的真相**（先 applied 后 room → 保留 applied；先 room 后 applied → 记 cancelled），账本没有“执行发生在第 N 代”这一维度。

**为什么必须本地同步兜底**：浏览器在 confirm 时**已经持有** `suggestion.roomId/generation`（本提交新增字段，`pending()` 与 `decide()` 都能拿到），也随时知道 `world.currentRoomId`；因此“确认前同步比对本地房号/代际”即可在**无网络**条件下关掉整个窗口。这正是 Lead 已派的“同步本地 generation + await 后校验”方向，我确认该数据在 7c0068f 里**可取**（可行性核实），但**当前代码没有这一步**：`GameScene` 的 `apply` 闭包只做 `enqueueCompanionAction(kind, target)`，无房界校验。

## 4) 我独立新发现的机制问题（非 Lead 已知项）

### (a) `roomChanged()` 对“同房重复通知”并不幂等（P2，实测）
`roomChanged` 在调用 `applyRoomChange` **之前**就删除所有 `applied !== true` 的决策，然后把它们当 `alsoCancel` 传入。于是即使 roomId 与当前相同（本该早退），只要存在“已 confirmed 未 applied”的决策，`alsoCancel.length>0` 就会**跳过幂等早退** → 代际 +1、观察被丢弃、那条确认被改成 `cancelled/room_changed/decidedAtTick:null`。
- 我的 P2 实测：`same_room_bumped=true`，收据 `{"status":"cancelled","reason":"room_changed","decidedAtTick":null}`。
- 与提交说明/单测标题（“is idempotent for the same room: pause/resume and repeats cancel nothing”）不一致：该单测只覆盖“无已确认决策”的同房重复。
- 当前可达性：渲染侧只在真实房界调用，且同房不会触发 onRoomEntered，所以**暂不可达**（潜在缺陷）；但这是契约与实现的分歧，若将来加入重试/心跳式通知就会立刻生效。

### (b) 乱序 room 报告会过度作废新房建议（P5，实测）
`applyRoomChange` 只按“roomId 不同”判定变化，**没有 roomId/序号的单调守卫**。P5 实测：先报 B、在新房合法提一条建议、再收到迟到的 A 报告 → `status.roomId` 退回 A、`cancelled=["sug_…05"]`，新房那条**合法建议被作废**、Owner 无法确认。
- 可达性：需要两次房界报告乱序（例如快速双过门，或将来加重试）。渲染侧 `void notifyRoom` 无串行化，两次并发 POST 的顺序无保证。
- 影响方向是“过度作废”（丢功能），不是“复活旧建议”（不破坏安全边界）。

### (c) 新桥路由被放进 agentRoute（token-only，无 Origin）白名单
`/world-link/companion-room` 被加入 `agentRoute`（`worldBridgeServer.ts:293`），而该列表的语义是“**本地 agent 进程无 Origin 也可达**”。我的边界探针实测（`probe-bridge-boundary.log`）：
- agent 形态（token 无 Origin）→ `403 world.origin_mismatch`（**handler 的 originMatches** 拦下）；
- 对照的纯 browser-only 路由 `companion-decision`（token 无 Origin）→ `403 world.origin_denied`（**外层 Origin 门**拦下）。
- agent + 伪造 Origin / 错 ownerCap → `403 companion.owner_capability_required`；三次尝试后 `pending` 仍为 1（**agent 确实无法作废**），浏览器路径 200 且 pending → 0。
结论：安全属性成立（真正的门是 ownerCap），但该放置与“browser-only”的注释/提交说明不符，且**少了一层 Origin 防护**；若将来有人放松 `originMatches`（例如允许 sessionOrigin 为空）就会变成可达面。建议从 `agentRoute` 移除。

### (d) 收据真相随到达顺序翻转（非阻断但影响模型判断）
同第 3 节：一次真实执行可能被记为 `cancelled/room_changed`（先 room 后 applied），也可能记为 `applied`（先 applied 后 room）。建议在决策记录里加“执行代际/房号”，让 `markApplied` 即使迟到也能落成 `applied(generation=old, room=old)`，而不是被改写成 cancelled。

## 5) 权限/隔离/边界（PASS）

- 代际与 epoch 解耦：房界不改 session/epoch，`generation` 单增（P1 实测；`applyRoomChange` 是唯一自增点）。
- agent 不可作废（bridge 探针 3 形态全 403，pending 不变）；cap 错误与 origin 错误分属不同 messageKey，错误隔离正常。
- 同房重复：facet 层幂等 ✓（gateway 层缺陷见 4(a)）。
- pause/resume：渲染侧路径根本不发通知（E2E case 2 通过，`status.pending` 保留同一 id）✓。
- 墓碑上限 512：FIFO 淘汰后仍不可复活（`evicted` 集合独立且无界，`suggest` 先判 `E_RETRY_AFTER_EVICTION`）✓（P6）。

## 6) 可放行 scope / 剩余阻断

**可放行（scope 限 7c0068f 的“房界作废”能力，且**不含**竞态窗口）**
1. 正常时序下：房界提交后旧房未确认建议不可确认（`E_STALE_GENERATION`）、不会执行/不会扣费、不会复活（同 id/新 requestId 都不行）。
2. 已 confirmed 未 applied 的决策被作废且 `markApplied` 被拒（正常顺序下不会产生“幽灵 applied”）。
3. 新房必须先有新观察才可再次提议；新房的正常提议与确认**不需要重新授权**（session/epoch 不变，E2E 与 P7 均验证）。
4. agent 无法作废 Owner 的工作（cap 门 + 实测 403）。
5. pause/resume、同房重复（无已确认决策时）不作废任何东西。
6. 回归：unit 7/7、Owner/权限 54/54、room-cancel E2E 2/2、合作链 1/1、tsc 0、MCP 构建 0。

**剩余阻断（必须修后才能把“旧房建议不得执行”整体标关）**
- **在途竞态**：notify 网络在途窗口内的旧 confirm 仍可 `decide ok → 提交 → applied`（Tester R04/R05 + 我的 P3）。修法应为**确认前同步本地房号/代际校验**（数据已具备），并在 `await notifyRoom` 之后再做一次校验；修好后需新 hash + 定向异步负向（人为延迟 notify 并重放 confirm）。

**非阻断（建议修）**
1. `roomChanged` 同房幂等缺陷（4a）：把 `confirmedUnapplied` 的删除移到“确认是真房界变化”之后，或让 facet 的早退判定只依据 roomId。
2. 乱序 room 报告过度作废（4b）：报告携带单调 `roomSeq`（由渲染侧自增），gateway 丢弃旧序号。
3. `companion-room` 从 `agentRoute` 移除（4c）。
4. 收据加“执行代际/房号”，消除 applied↔cancelled 的顺序翻转（4d）。
5. `pending()`/`suggest` 载荷新增必填 `roomId/generation` 字段：对外 schema 仍是 additive（未改版本号），但旧严格校验客户端需同步。

**未跑（按指令不重复全量）**：全量单测（开发者报 734/734）、Tester 的其他探针（resume/checkpoint/CD 恢复）、浏览器级“我自己的人为延迟 notify”探针（Tester 13/14 已覆盖同一机制；我在账本层的等价探针 P3 已跑）。**新提交后再做定向异步负向复核。**

## 7) 并发披露

- 复核开始时（02:05 前后）：`HEAD=7c0068f`，`git status -uno` = 0 行；全部门禁都在该状态 + `git archive` 快照上执行。
- 收束时（02:20 前后）：`git status -uno` 显示 `src/ai-native/companionLink.ts` 被修改（应是开发者按派单做的“同步本地 generation + await 后校验”）。
- 按边界：**我未读该改动、未为任何新 hash 背书**；本报告结论只对 `7c0068f` 成立。
