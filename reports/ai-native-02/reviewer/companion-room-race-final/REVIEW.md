# c233e5c 同步/异步代际补丁 — 独立定向复核

- 被测：`c233e5cfeae0473a70878cb25608d30d88f9c976`（父 `7c0068f6c40cf3059b107260de50cbf0a3c4b9e1`，已解析完整 hash）
- 隔离：`git archive c233e5c` → `D:\review-race\snap`，**2047 tracked 文件**，`git ls-tree -r c233e5c`（blob sha1/路径）vs 快照内 `git hash-object` → **diff 0 行**
- 边界：只读冻结源码/配置/测试；未读 WIP/stash；未 merge/push/reset/rebase；保留旧失败与模型证据；自有 dev `strictPort 5374`（用完仅关自己的 vite，已验证 0 残留，5173 未动）；secret 零日志
- 逐门一行见 `GATES.md`；日志全文在 `…\companion-room-race-final\logs\`；我自写的 3 个探针源码同目录

## 结论

**上一轮唯一阻断（notify 在途窗口旧 confirm 可执行）已关闭；A/B/C 三项也关闭。可放行本补丁 scope。**
剩余两项**非阻断残留**：(i) `/companion-applied` 若省略 `execution.generation`（旧客户端或持有 ownerCap 的构造请求），仍可把已被房界作废的决策翻成 `applied`；(ii) 房变前已确认、**已入队但同 tick 尚未提交**的 `toggle-relay` 核心命令（无 actor/range 门）若排在 teleport 之后，仍会在新房把旧房设备翻成 `INACTIVE`、重新锁门。scan/jam 同类残留被 core legality 在扣费前拒绝（我实测），不构成扣费/证据污染。前轮三修、363eb17 合作/SDK/parity 与 Lead 最小模型 Signal 事实不在本次范围，未重开。

## 逐项判定

| 项 | 结论 | 证据 |
|---|---|---|
| 同步 `enterRoom` 在任何 await 之前 | **PASS** | `GameScene.onRoomEntered`（`:705-716`）：`link.enterRoom(room.id, sim.tick)` 是回调里第一条 companion 语句，`notifyRoom` 之后才发；authorize 路径也在 `await authorize()` **之前** `enterRoom(startRoom, startTick)`（`:966-979`）。`CompanionLink.enterRoom`（`:73-84`）是纯同步赋值 + 代际/生命周期自增 |
| decide 前 / 决策响应后 / apply 前 比对 room+generation+lifecycle | **PASS** | `CompanionLink.decide`（`:251-290`）：`#inCurrentRoom(suggestion)` 前置 → `#capture()` → POST → `#sameAuthority(captured)`（含 state/cap/session/epoch/roomId/generation/lifecycle）→ `r.ok` → **再次** `#sameAuthority` → `apply()`；从最后一次校验到 apply 之间无 await。我的 L1/L2 用受控 Promise 复现“room POST 4s”与“decision 响应 6s 跨房”，两次都是 `decide=false` 且 `apply` 调用次数 0 |
| pending/obs 迟到不退房 | **PASS** | `pending()` 响应后 `#sameAuthority` + 本地 `#inCurrentRoom` 过滤（我的 L3 迟到列表 → `[]`；L4 同房列表只留新房条目）；观察由 renderer 打 `roomId`，gateway 拒 `view.roomId !== facet.currentRoom` 的旧房观察（`E_STALE_GENERATION companion.observation_stale_room`） |
| 初次 authorize / 同房重复 / 断连重授 / 快速 A→B→C 不漂移 | **PASS** | 我的 L5：本地 enterRoom(A)=1 → bridge seq1=gen1；同房重复不 bump；`disconnect()` + `authorize()` 只 bump lifecycle、**room generation 保持 1**；A→B→C 后本地 gen3，报告按 C(seq3)→B(seq2 迟到)到达，bridge 停在 gen2、room=C，迟到报告 `stale=true`。注意这里的“gen2 vs 本地 gen3”是因为 A→B→C 三次房变中只有两次上报（同 tick 合并），**不是漂移**：bridge 只接受最新 seq，后续新房 notify 会继续对齐 |
| A 同房 confirmed-unapplied 重复通知不取消 | **PASS** | facet 早退移到任何变更之前（`applyRoomChange` 只看 currentRoom）；gateway `roomChanged` 同房 `noop()` 在任何决策删除之前返回。我的 L6 连续 3 次同房通知：代际不变、收据仍 `confirmed` |
| B roomSeq 乱序不回退 | **PASS** | `stale = seq <= currentGeneration`（seq 优先、tick 仅老客户端回退），迟到报告返回 noop；单测 + 我的 L5 + 浏览器 T3（A→B→C 首个通知延迟 5s）全过 |
| C Agent 不能 Owner 路由 | **PASS** | `/companion-room` 从 `agentRoute` 移除；我的 bridge 探针：agent（无 Origin）打 `/companion-room` 与 `/companion-decision` 都是 **403 `world.origin_denied`**（外层门，与上一轮的 `origin_mismatch` 不同），Owner（Origin+cap）200 |
| D markApplied 世代真相 | **部分 PASS**（残留见下） | 当前 renderer 路径正确：`GameScene` 在 apply 时记 `lastApplyGeneration/RoomId`，`pendingCompanionReceipt` 带该世代；房变时清空收据（`:711`）；gateway 保留 stale 决策记录并接受**原世代**迟到 applied、拒绝异世代（我的 L7-a PASS / L7-b `E_STALE_GENERATION applied_generation_mismatch`） |

## 我独立发现的两项残留（非阻断，已复现）

### (i) 省略世代的 applied 回执可把 cancelled 未执行翻成 applied
`markApplied()` 只在 `execution.generation !== undefined` 时做比对；bridge 对缺失字段传 `{}`。我的 L7-c 实测：
```
L7 omitted-generation-on-stale={"ok":true,"value":{"suggestionId":"sug_…00d","decision":"confirm",
 "decidedAtTick":41,"applied":true,"appliedTick":42,"generation":3,"roomId":7,"stale":true}}
```
即：一条已被房界标为 `stale`（收据会显示 `cancelled`）的决策，只需一个**不含 generation 的** `/companion-applied` 请求就变成 `applied`。`status()` 里 `applied` 优先于 `stale`，真相翻转。
- 边界：该路由要求 ownerCap + Origin（agent 无 cap，实测 403）；当前 renderer 总会带 generation，且房变时清空待发回执，所以**正常链路不可达**。
- 建议：对 `record.stale === true` 的记录，强制要求 `execution.generation` 存在且等于 `record.generation`，否则 `E_STALE_GENERATION`；把“真实执行世代”作为必需证据而非可选字段。

### (ii) 房变前已确认、排队未提交的 toggle-relay 仍可跨房关锁
`World.tryInteract`（`:948-952`）清 `echoController` / `pendingCompanionIntent`，**不清 `sim.pendingCommands`**；Signal 类是 core 命令而非 intent。我的 core 探针（`zz-confirmedPending.probe.test.ts`）：
- 先入队 `signal-scan` 再入队 teleport → 同 tick 在**旧房**执行，`found=true` ✓（正常 FIFO）。
- teleport 先、scan 后 → 距离 107 格，`found=false`，且**能量仍是 100**（`tryScan` 的 `permitted=false → E_PERMISSION` 在扣费前短路）✓ —— scan/jam 无扣费/证据污染。
- teleport 先、`toggle-relay(enabled:false)` 后 → `{"relay":"INACTIVE","exitOpen":false,"roomMoved":true}` ✗：旧房 ACTIVE 设备被新房触发的遗留命令关掉，新房出口重新上锁。
- 可达性：需要确认与 portal interact 落在同一 tick 且 teleport 命令先入队（UI 点击顺序竞争），窄但真实。新 race spec 未覆盖这一条（它只查“notify 窗口内确认”）。
- 建议：房变提交时按 suggestionId 撤销仍 pending 的 core Signal 命令，或在 `commitToggleRelay` 上绑定“提交房号 == 设备房号”的世代校验；恢复手段仍是人类按 `R`（`GameScene.ts:433`，不限房间）。

### 次要观察
- `CompanionLink.#inCurrentRoom()` 与 `pending()` 的本地过滤把“缺 `roomId` 的建议对象”当作当前房（向后兼容）。当前 facet 总写入 `roomId`，但旧 payload/手造对象可绕本地门；gateway 侧 `roomCancellation` 仍是第二道门，所以不构成越权。
- `CompanionRoomGeneration` 单测 9 例、`CompanionRoomBoundary` 2 例与本轮 3 个浏览器 race 用例均是“barrier 开/关”的 RED-GREEN 设计（提交说明），我按冻结码实跑为 GREEN。

## 可放行 / 限制

**可关闭（本补丁 scope）**：notify 在途竞态（T1/T2 + L1/L2）、A 同房幂等、B 乱序上报、C agent 路由隔离、D 当前 renderer 的原世代迟到回执真实性；以及本地/bridge 代际在初次授权、同房重复、断连重授、快速 A→B→C 下的对齐（L5）。
**不可关闭 / 需后续**：(i) 省略世代的 applied 回执缺口；(ii) 排队未提交的 toggle-relay 跨房关锁；(iii) 不在本轮范围且我不重开：完整 Run、新模型回合、全架构回归（开发者报 738/738 与我无关，我按指令未重跑全量）。
**未跑**：全量单测、无关 Playwright 规格、真人验收（按边界）。

## 冻结状态

复核开始与结束时 `HEAD` 均为 `c233e5c`，`git status -uno` 在复核期间为 0 行；报告写出未触碰源码/测试/配置。旧失败证据（Tester `13/14`）、模型证据与 7c0068f 审查目录均未被覆盖。
