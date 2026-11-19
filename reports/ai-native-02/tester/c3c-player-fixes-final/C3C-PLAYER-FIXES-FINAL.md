# C3-c Player 权限修复 — 独立重验（冻结 8f1ce6c）

- **被测**：`8f1ce6c06eaf95d03a2c6e7c9fc1e3f8c7a1c8f3`（`chore: refresh C3c parity fixtures`），代码提交父 **`593786bb31ba6ed5af69774d77ded9b682e0f186`**（`fix: crop headless Player output, persist action duration, bound step dedup`）；基线 `82734f6`。
- **冻结**：`git archive 8f1ce6c` → `D:/Project/AI-NATIVE-02-snapshots/8f1ce6c`（`node_modules` junction），关键文件 MD5 见 `00-frozen-hashes.log`；未读共享 WIP / 未读 stash，未改源码/测试/配置/分支。
  - 复核期间活仓库 HEAD 仍为 `8f1ce6c`，但工作区已有下一轮 WIP（`worldHeadlessMcpTools.ts`、`worldHeadlessMcpPlayerCrop.mts`、`worldHeadlessStepChannel.test.ts` 等）。**本轮未读取/未使用**，结论只对冻结快照负责。
- **结论：F1/F3/F4 已修复并有独立证据；F2（step intent 不经过 action 即可控制 Player）仍存在，是剩余权限边界。P4 不能因门数自动 PASS。**

## 1. 质量门（命令 → 结果 → 路径）

| 项 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| typecheck | `npx tsc --noEmit`（快照） | PASS exit=0 | `01-typecheck.log` |
| unit | `npm test`（快照） | PASS **38 files / 542 tests** | `02-unit.log` |
| build | `npx vite build` / `--mode test` | PASS | `03-prod-build.log`、`03b-test-build.log` |
| MCP build | `npx vite build --config vite.mcp.config.ts` | PASS（3 入口） | `03c-mcp-build.log` |
| 官方 SDK Player 裁剪负向 | `npx vite-node src/ai-native/worldHeadlessPlayerCrop.mts` | PASS `PLAYER_CROP_NEGATIVE_PASS`（text + structured） | `04-player-crop.log` |
| Headless MCP smoke（Player+Dev） | `npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts` | PASS `HEADLESS_MCP_SMOKE_PASS`（含权限负向、跨 step） | `05-smoke.log` |

## 2. F1 — 非 Dev 原始输出裁剪（已修）

官方 MCP SDK 直接读取 `content[0].text` 与 `structuredContent`（不是 console 显示）：

- `world_headless_step` 顶层键：`schema,ok,session,epoch,requestId,fromTick,toTick,ticks,blockTicks,status,executing,applied,rejected,observation,eventCount,events,replayed` —— **无** `canonicalState` / `canonicalEvents`。
- 对 create/list/observe/action/step 的全部返回递归扫描禁用键（`canonicalState/canonicalEvents/seed/map/rngState/pendingCommands/purchaseTransactions/nextProjectileId/nextLootId/roomGraph`）：**0 命中**。
- `events` 为公开投影（仅 legal 事件）；`drone-step`/`room-generated`/`player-reset` 不出现。
- Dev 面仍保留 canonical（严格隔离，见 §4）。

## 3. F3 — 跨 step 时长持久化（已修）

Player（官方 SDK）：
- `move ticks=120` → `step(10)`：`executing={executedTicks:10, remainingTicks:110, durationTicks:120}`，`applied=[]`（**不提前 ACK**）。
- 随后 `step(110)`：`applied=[{startedTick:0, appliedTick:120, executedTicks:120}]`，`executing=null`（**只 ACK 一次**）。

Dev（同 seed 对照，canonical 断言）：
- `move 120` 的 `step10+step110` 与 `step120`：`canonicalState` **字符串完全相等**、`canonicalEvents` **完全相等**、`toTick/status` 相等。
- `fire 120` 同样：10 时不 ACK，拆分与单次 canonical state/events 完全相等。
- 结论：Headless 与 Rendered 共用 `consumeExecutionTicks` 的 duration 语义成立。

## 4. F4 — 去重/淘汰/配额/跨域（已修）

| 场景 | 实测 |
| --- | --- |
| 同 step requestId 同 payload 重放 | `replayed:true`，`toTick` 不前进 |
| 同 step requestId 不同 payload | `E_ID_PAYLOAD_MISMATCH` |
| 131 次 step 后重放首个 requestId（响应已淘汰） | **`E_RETRY_AFTER_EVICTION`**，tick **131→131 不前进** |
| 去重集合硬配额（256） | 第 125 个新 id（已有 131）→ **`E_RESOURCE_LIMIT`**，tick **256→256 不前进** |
| step 与 action 共用 requestId 命名空间 | 同一 id 跨域 → `E_ID_PAYLOAD_MISMATCH` |
| 同 actionId 同 payload 重复 action | 第二次 `replayed:false` 但**只执行一次**：`step` 的 `applied` 中该 action 仅 1 条、`executedTicks=3` |
| 同 actionId 不同 payload | `E_ID_PAYLOAD_MISMATCH` |
| 旧 epoch（Dev restore 后） | 旧 epoch step → `E_STALE_EPOCH`；restore 后 epoch 1→2，半执行 active 被清除（`applied=[]`、`executing=null`、位置回到快照） |

## 5. F2 — step intent 不经过 action 仍可控制 Player（**未修复，剩余边界**）

- 无任何 `world_action`；仅 `world_headless_step(ticks=30, intent.move)` → 玩家真实位移 **1.9755 格**，`applied=[]`。
- 该通道不受 action requestId/actionId 去重、TTL/`applyByTick`、action 审计约束；开发者报告 §6 只收紧了 intent 的字段形状（拒绝 hp/seed 等），**未移除或限制该控制通道**。
- 若 Lead 认定 step 是“Owner 控制的 tick 边界、intent 是合法填充”，需要明确文档与预算；否则应移除该 intent 通道，Player 只能通过 `world_action` 控制。**在裁决前 P4 不能 PASS。**

## 6. 公开事件裁剪（Player）

纯投影负向（`publicEvents` + `isPerceivable`）：
- 60 格外的 `enemy-hit`/`enemy-died`/`loot-dropped`/`enemy-spawned`/`projectile-spawned` **全部被丢弃**；
- `drone-step`/`room-generated`/`player-reset` **永不输出**；
- 近处（1 格）同类事件保留；`enemy-hit` 不含隐藏 enemy HP。
- 运行时（Player step）：实际事件仅 `player-moved / projectile-spawned / player-hurt`，无隐藏位置、无 drone FSM。
- **运行期限制（如实记录）**：起始房间的 drone 会持续追击（state=attack），无法在本次遭遇中把它移出 12 格感知/LOS；因此“先感知后隐藏”的运行时隐藏目标未能在本场景构造。已用纯投影负向 + 运行时事件白名单覆盖该规则，但未获得“隐藏目标在运行时进出感知”的端到端样本。

## 7. Dev harness（同轮）

- `world_headless_dev_snapshot` / `restore`（半执行 active 清空、epoch 2）/ `replay`：完整重放 `sameState=true, sameEvents=true, firstDivergence=null`；篡改 intent → `sameState=false, firstDivergence=20`。
- `batch`（seeds 11/22, maxTicks 60）：2/2 `cleared`，ticks 25。
- `perf`（1000×2，短回归）：wall **1393.24ms**、events **6068**、liveCombatTicks **1840**、sessions 2。
- 会话全部清理；Dev/Player 工具严格隔离（Player 无 `*_dev_*`，调用 dev 工具被拒；Dev 有 snapshot/replay 等）。

## 8. Rendered parity 16 与负向

- 从冻结快照（dev 5321）重生：spec PASS；Node 比较 **16/16 PASS**：`C3C_RENDERED_HEADLESS_PARITY_PASS finalTick=26 events=59 kills=1 lootLeft=0 currency=4 xp=8`（state/events/tick/drones/projectiles/loot/currency/xp/level/HP + kill/loot-drop/loot-pickup/combat）。
- 负向：把 8 个 fire 步全部改 false → 比较 **7 项 FAIL**（state/events/drones/projectiles/currency…），退出码 1；恢复原 sequence 后重新 PASS。
- 证据：`initial/sequence/rendered.json` 已复制到本报告目录（MD5 见 `15-parity-md5.log`）。
- **过程更正（如实记录）**：第一次 parity 命令因 `cd && nohup … &` 的后台写法导致后续命令仍在活仓库 cwd 执行，写入了活仓库 `reports/…/parity`；我随后用 `git checkout` 恢复被覆盖的 tracked 文件、删除自己生成的未跟踪 `initial.json`，并按冻结快照 cwd 重新执行。上面给出的数字全部来自快照重跑。

## 9. C3b 定向（stop / reclaim / lease / resume）

- `PORT=5321 npx playwright test tests/c3c-bridge-reclaim.spec.ts tests/c3b-hard-disconnect.spec.ts tests/c3b-external-link.spec.ts --workers=1` → **12 passed**（含 “queued stop preempts ACTIVE long action”、reload→LOST→新授权、SIGKILL 降级）。
- `worldMcpLeaseSmoke` → PASS（dead list 不 attached、observe 失败）。
- `resume-no-step` 3 + `economy` storage 1 → PASS 4/4。

## 10. 判定

| 项 | 判定 |
| --- | --- |
| F1 Player 原始输出泄漏 canonical | **已修复**（text + structured 递归 0 命中） |
| F3 分包提前 ACK / 时长丢失 | **已修复**（10→executing 10/110；110→applied 120；拆/单 canonical 相等） |
| F4 缓存淘汰重放/配额/跨域 | **已修复**（墓碑拒绝、256 硬配额、共享命名空间、无双执行） |
| F2 step intent 绕过 action | **仍存在**（1.9755 格，无 action/TTL/去重）；需 Lead 裁决是否合法 |
| 公开事件裁剪 | 纯投影负向 PASS；运行时仅合法事件；隐藏目标运行时样本受限（见 §6） |
| Dev harness / parity / C3b 定向 | PASS（§7–§9） |
| **P4** | **不自动 PASS**：F1/F3/F4 已闭，但 F2 权限通道未裁决；真实 LLM 未跑 |
| 首片后台 MCP 测试 | 较上一轮显著改善（无 canonical、时长/幂等正确），但 F2 未定前仍不能作为最终权限面 |

## 11. 复现

```bash
cd D:/Project/AI-NATIVE-02-snapshots/8f1ce6c
npx tsc --noEmit && npm test
npx vite build && npx vite build --mode test && npx vite build --config vite.mcp.config.ts
npx vite-node src/ai-native/worldHeadlessPlayerCrop.mts
npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts
node .../probe-player.mjs && node .../probe-dev.mjs
npx vite-node probe-public-events.mts
PORT=5321 npx playwright test tests/c3c-headless-parity.spec.ts
npx vite-node scripts/c3c-rendered-headless-parity.mts
PORT=5321 npx playwright test tests/c3c-bridge-reclaim.spec.ts tests/c3b-hard-disconnect.spec.ts tests/c3b-external-link.spec.ts --workers=1
PORT=5321 npx playwright test tests/resume-no-step.spec.ts tests/economy.spec.ts --grep "resume|storage"
npx vite-node src/ai-native/worldMcpLeaseSmoke.mts
```

## 12. 报告文件

`reports/ai-native-02/tester/c3c-player-fixes-final/`：`00-frozen-hashes.log`、`01–05` 门禁、`06-player.log`+`player.json`、`07-dev.log`+`dev.json`、`08–10` parity/篡改、`11` C3b 定向、`12` resume/storage、`13` public events、`14` lease smoke、`15-parity-md5.log`、`initial/sequence/rendered.json`、`probe-*.mjs`。
