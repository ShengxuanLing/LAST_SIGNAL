# 门禁逐行 — c233e5c 定向独立复核

被测：`c233e5cfeae0473a70878cb25608d30d88f9c976`（父 `7c0068f…`）
快照：`D:\review-race\snap`（2047 tracked，逐 blob diff=0）
本目录：`D:\Project\LAST_SIGNAL\reports\ai-native-02\reviewer\companion-room-race-final\`
环境：自有 dev `strictPort 5374`（Playwright 用 `PORT=5374`），用完仅关自己的 vite；5173 等他人端口未动；未并行跑重型全量

| # | 结论 | 门禁 | 实际命令 | 结果 | 日志（绝对路径） |
|---|---|---|---|---|---|
| 1 | **PASS** | 精确 hash + 父 + 隔离快照 | `git rev-parse c233e5c; git rev-parse c233e5c^; git archive … \| tar -x` + 全量 `git hash-object` vs `git ls-tree` | `c233e5c…`，父 `7c0068f…`；**2047 文件 diff 0 行** | `…\tracked-blobs-c233e5c.txt`、`…\tracked-blobs-snapshot.txt` |
| 2 | **PASS** | 类型检查 | `npx tsc --noEmit` | exit 0，0 字节 | `…\logs\gate-typecheck.log` |
| 3 | **PASS** | MCP 构建 | `npx vite build --config vite.mcp.config.ts` | exit 0，built in 1.38s | `…\logs\gate-mcp-build.log` |
| 4 | **PASS** | 最小 Owner/权限回归 | `npx vitest run ownerAuth companionBridge worldBridgeServer companionGateway companionFacet companionInsights` | **54/54 passed**（6 文件） | `…\logs\gate-owner-minimal.log` |
| 5 | **PASS** | 房界新增单测 | `npx vitest run companionRoomBoundary.test.ts companionRoomGeneration.test.ts` | **11/11 passed**（2+9） | `…\logs\gate-room-units.log` |
| 6 | **PASS** | 新 race3（浏览器，真实延迟） | `PORT=5374 npx playwright test tests/companion-room-race.spec.ts --project chromium` | **3 passed**：T1 房通知延迟 4000ms 旧确认即刻拒且收据未 applied；T2 decision 响应延迟 6s 跨房服务器 ok 但渲染端不 apply；T3 A→B→C 首报延迟不回退 | `…\logs\gate-race3.log` |
| 7 | **PASS** | cancel2 回归 | `PORT=5374 npx playwright test tests/companion-room-cancel.spec.ts --project chromium` | **2 passed** | `…\logs\gate-cancel2.log` |
| 8 | **PASS** | 我的确定性延迟探针（受控 Promise，无真实睡眠） | `npx vitest run src/zz-probe/raceBarrier.probe.test.ts` | **8/8**：L1 房 POST 在途旧确认立即拒且 apply=0；L2 决策响应跨房 apply=0；L3 迟到 pending→[]；L4 列表本地房过滤；L5 本地/bridge 代际不错位；L6 同房+confirmed-unapplied 重复 3 次不取消；L7 原世代迟到 applied 记账为真、异世代拒；L8 墓碑 512 淘汰后仍拒 | `…\logs\probe-race-barrier.log`（源码 `…\raceBarrier.probe.test.ts`） |
| 9 | **PASS（含 1 条残留实测）** | 我的排队命令跨房探针（core） | `npx vitest run src/world/sim/zz-confirmedPending.probe.test.ts` | **3/3**：scan 在 teleport 前入队→旧房执行 found=true；scan 在 teleport 后入队→107 格外、**未扣费**（legality 短路）；**toggle 在 teleport 后入队→`relay=INACTIVE, exitOpen=false, roomMoved=true`（跨房关锁残留）** | `…\logs\probe-pending-core-command.log`（源码 `…\zz-confirmedPending.probe.test.ts`） |
| 10 | **PASS（残留实测）** | 迟到的省略世代回执 | 我的探针 L7-c（同 #8） | `markApplied(stale, 无 execution)` → **ok=true**，`applied:true / appliedTick:42 / stale:true` → 可把 cancelled 未执行翻成 applied（需 ownerCap；当前 renderer 不会这么发） | `…\logs\probe-race-barrier.log` |
| 11 | **PASS** | Agent 不能 Owner 路由（C） | `npx vitest run src/zz-probe/bridgeClass.probe.test.ts` | `BRIDGE_CLASS`：agent（无 Origin）打 `/companion-room` 与 `/companion-decision` 均 **403 `world.origin_denied`**（外层门）；Owner（Origin+cap）**200** | `…\logs\probe-bridge-class.log`（源码 `…\bridgeClass.probe.test.ts`） |
| 12 | **PASS（源码级）** | 同步屏障位置 | 读 `GameScene.ts:705-716/966-979`、`companionLink.ts:73-84/251-290` | `enterRoom` 在任何 await 前；decide 前/响应后/apply 前三道检查，末次检查到 apply 无 await | 源码（快照，同 #1 hash） |
| 13 | **NOT RUN（按指令不重复无关全量）** | 全量单测 / 无关 Playwright / 新模型回合 / 真人验收 | — | 开发者报 738/738；本轮只做定向补丁与最小回归 | — |

## 失败行

无 FAIL。两条**残留**最相关输出：
1. 省略世代回执（`probe-race-barrier.log`）：
   `L7 omitted-generation-on-stale={"ok":true,"value":{"suggestionId":"sug_…00d","decision":"confirm","decidedAtTick":41,"applied":true,"appliedTick":42,"generation":3,"roomId":7,"stale":true}}`
2. 跨房遗留 toggle（`probe-pending-core-command.log`）：
   `STALE_TOGGLE_AFROOM {"relay":"INACTIVE","exitOpen":false,"roomMoved":true}`
