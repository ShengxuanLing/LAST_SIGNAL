# `c2a31af` 独立复验：恢复人类 R 全局控制 + 仍拒旧 Companion toggle

**结论：PASS。此前唯一“人类 R 跨房控制”回归已关闭（human R 恢复 c233 全局行为）；旧 Companion toggle（originRoomId=旧房）跨房仍拒、不关 ACTIVE 门；origin 字段不可经 MCP 注入；echo 仍 E_PERMISSION；stale 回执省略仍拒；notify race T1/T2/T3 仍拒。**

## 冻结

- 目标：`c2a31af609b8305ce5917d88d0a425a4af24a29c`（父 `4b938a5f02af319b8eaebeabff3dc1708cbdf4da`）
- `git archive c2a31af | tar -x` → `D:/Project/AI-NATIVE-02-snapshots/c2a31af`；**2048 文件**
- **tracked blob 比对**：mismatch=0 / 2048；二次解包 diff=0；全量 sha256
- 未改源码/测试/配置/分支，未 merge/push/reset；原 4b938a5 失败/R 回归证据（`signal-tail-final/`）保留不覆盖。自有 dev strictPort 5392，用完仅清 5392（无 LISTENING）；其他端口未动；secret 零日志/URL/截图。

## 机制（本次改动）

- `SimCommand.toggle-relay` 新增**可选 `originRoomId`**（可信 in-process 绑定）。
- `world.enqueueCompanionAction('toggle-relay')`（Owner 确认执行时）带 `originRoomId = world.roomIdValue`（同步捕获）。
- `processCommands`：仅当 `command.originRoomId !== undefined` 且与 `device.roomId`/玩家当前房不一致时才拒绝；**human R / Owner-dev 命令无绑定 → 保留 c233 全局控制**。
- `commitToggleRelay` 恢复为无房间参数的纯 toggle。

## 门禁逐行（完整 `gate-summary.log`）

| 门 | 命令 | 结果 |
|---|---|---|
| 冻结+tracked blob | `git archive c2a31af` + `git hash-object` vs `git ls-tree` | 2048 mismatch=0, diff=0 |
| typecheck | `npx tsc --noEmit` | 0 |
| MCP build | `npx vite build --config vite.mcp.config.ts` | 0 |
| 定向 unit | `vitest run signalCombat/ signalState/ companionGateway/ worldHeadlessSignal/ companionRoomGeneration` | 59 passed |
| **origin 注入 + Companion stale toggle** | `vite-node probe-origin-schema-core.mts` | **6/6 PASS** |
| **人类 R 跨房恢复（真实 UI）** | `vite-node probe-humanR-ui.mts`（c2a31af） | **APPLIED（= c233）** |
| **新 human-crossroom spec** | `PORT=5392 playwright test tests/signal-human-crossroom.spec.ts` | **1 passed** |
| companion room cancel | `playwright test tests/companion-room-cancel.spec.ts` | 2 passed |
| ECHO portal migration | `playwright test tests/echo-portal-migration.spec.ts` | 2 passed |
| signal coop + SDK（echo E_PERMISSION） | `playwright test signal-coop-e2e + signal-sdk-negative` | 2 passed |
| notify race T1/T2/T3 | `playwright test tests/companion-room-race.spec.ts` | 3 passed |
| parity 新导出（快照 cwd） | `playwright test tests/signal-rendered-parity.spec.ts` | 1 passed（三件套 07:14 重生） |
| parity 重放（快照 cwd） | `vitest run signalRenderedHeadlessParity.test.ts` | 3 passed（字节一致 + 分歧负向） |
| stale applied 省略仍拒 | `vite-node probe-stale-applied.mts` | 8/8 PASS |
| 截图实际查看 | `read evidence/humanR-c2a31af.png` | room B `RELAY INACTIVE … EXIT CLOSED`（全局控制恢复） |

## 1) 人类 R 跨房控制：已恢复（关闭 4b938a5 回归）

真实 UI（opt-in save + 真实 NEW RUN + 真实 portal；夹具：站门口，已披露）c2a31af：
- U1 room A 按 R → ACTIVE。
- U2 真实 portal A→B（设备留 A，deviceRoom=0，玩家=3）。
- **U3 room B 再按 R（设备在旧房 A）→ APPLIED**：ACTIVE→INACTIVE、exitOpen true→false、`signal-relay-changed` 触发。与 c233 一致；4b938a5 先前为 REJECTED。截图 `evidence/humanR-c2a31af.png` 显示 `RELAY INACTIVE … EXIT CLOSED`。
- 新 spec `tests/signal-human-crossroom.spec.ts` 断言 `after.relay='INACTIVE'`、`exitOpen=false`、无 page errors。

## 2) 旧 Companion toggle（originRoomId）仍正确隔离

`probe-origin-schema-core.mts`（生产 core，确定性）：
- **M04** Companion 绑定 toggle（originRoomId=设备房）**在 teleport 前入队同一 tick** → 旧房提交一次（ACTIVE，`signal-relay-changed` 1 次）。
- **M05** 陈旧的 Companion 绑定 toggle（originRoomId=旧房）**在 teleport 后提交** → 拒绝，**ACTIVE/exitOpen 不变**，`signal-relay-changed` 0 次（不误关门）。
- **M06** human R（无 originRoomId）在 teleport 后 → 仍控制旧房设备（INACTIVE，exitOpen false）。

## 3) origin 不可经 MCP 注入 + echo E_PERMISSION

`probe-origin-schema-core.mts`：
- **M01** `world_action` 提交 `toggle-relay` → `E_SCHEMA`（v2 schema 无此类型）。
- **M02** 合法 `scan` 额外带 `originRoomId` → `E_SCHEMA`（strict 拒绝未知字段；origin 无法经 MCP 注入）。
- **M03** 合法 v2 `scan`（actor）仍正常解析。
- **echo E_PERMISSION**：`signal-sdk-negative.spec.ts` PASS——外部 Player 侧 `actor:'echo'` 被渲染控制器拒绝 `rejected:E_PERMISSION`，不扣费/不入队。

## 4) stale 回执 / notify race 仍拒

- `probe-stale-applied.mts` 8/8：陈旧的已确认决定**省略** generation/room → `E_STALE_GENERATION`（不回 flip applied）；错误 gen/room 拒；正确原 gen+room 接受；非陈旧宽松契约不变。
- `companion-room-race.spec.ts` T1/T2/T3 3/3：notify 延迟 4s / decision 响应延迟 6s / A→B→C 首报迟到，均仍拒、不 applied、不回滚新房。

## 5) 核心变化 parity

core（`processCommands` toggle-relay origin 绑定）改动 → 快照目录重新导出 rendered 三件套（`07:14`）→ headless 重放 3/3 通过（canonical+events 字节一致；改 actor 分歧负向）。signal coop/SDK、ECHO 迁移、room cancel 全 PASS。截图实际查看。

## 精确可放行 scope

**PASS / 可放行**：人类 R 跨房全局控制（恢复 c233，回归关闭）；Companion 旧房 toggle 跨房拒绝且不关 ACTIVE/exitOpen、teleport 前提交一次合法；origin 字段不可经 MCP 注入；echo E_PERMISSION；stale 回执省略仍拒；notify race T1/T2/T3 仍拒；stale applied 世代门控；room cancel / ECHO 迁移 / signal coop+SDK / parity 字节一致；typecheck / MCP build / 定向 unit 59/59。**此前唯一 R 回归可明确关闭。** 剩余无阻断；原模型证据不变，不要求新模型/真人测试/完整 Run。

## 路径

`reports/ai-native-02/tester/signal-origin-final/`
`00-freeze.log` / `00-all-files.sha256` / `00-archive-diff.log` / `00-tracked-hash-check.log` / `01-typecheck.log` / `02-mcp-build.log` / `03-unit.log` / `04-origin-schema-core.json` / `05-origin-schema-core.log` / `06-humanR-ui-c2a31af.log` / `07-human-crossroom.log` / `08-room-cancel.log` / `09-portal.log` / `10-coop-sdk.log` / `11-race.log` / `12-parity-export.log` / `13-parity-replay.log` / `14-stale-applied.log` / `gate-summary.log` / `evidence/humanR-c2a31af.png` / `probe-*.mts`
