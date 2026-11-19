# `4b938a5` 最后两尾项独立运行检查

**结论：两尾项本身通过；但发现 1 处“人类 R 跨房控制”回归（vs c233 的既有全局设备控制），已回报、不当新规则接受。** stale-applied 世代门控 8/8、确定性 core 双排序 toggle、真实 portal 旧建议失效/新房一次、signal coop/SDK、parity 重生重放、race3、Owner 攻链均 PASS。

## 冻结

- 目标：`4b938a5f02af319b8eaebeabff3dc1708cbdf4da`（父 `c233e5cfeae0473a70878cb25608d30d88f9c976`）
- `git archive 4b938a5 | tar -x` → `D:/Project/AI-NATIVE-02-snapshots/4b938a5`；**2047 文件**
- **tracked blob 比对**：mismatch=0 / 2047；二次解包 diff=0；全量 sha256
- 未改源码/测试/配置/分支，未 merge/push/reset；原模型/失败证据不动。自有 dev strictPort 5392，用完仅清理 5392（无 LISTENING），其他端口（5173/5176/5393/5394/5396/5397/5398）未动；secret 零日志/URL/截图。

## 门禁逐行（完整 `gate-summary.log`）

| 门 | 命令 | 结果 |
|---|---|---|
| 冻结+tracked blob | `git archive 4b938a5` + `git hash-object` vs `git ls-tree` | 2047 mismatch=0, diff=0 |
| typecheck | `npx tsc --noEmit` | 0 |
| MCP build | `npx vite build --config vite.mcp.config.ts` | 0 |
| 定向 unit | `vitest run signalCombat/ signalState/ companionGateway/ worldHeadlessSignal/ companionRoomGeneration` | 59 passed |
| **stale applied 世代门控** | `vite-node probe-stale-applied.mts` | **8/8 PASS** |
| **确定性 core 双排序 toggle** | `vite-node probe-humanR-crossroom.mts`（x2） | 4b938a5 场景 C/D PASS；A/B 一致拒绝 |
| **人类 R 跨房控制对照** | `vite-node probe-humanR-ui.mts`（c233 vs 4b938a5） | **c233 APPLIED / 4b938a5 REJECTED → 回归（见下）** |
| 真实 portal 旧建议失效/新房一次 | `PORT=5392 playwright test tests/companion-room-cancel.spec.ts` | 2 passed |
| ECHO portal 迁移 | `playwright test tests/echo-portal-migration.spec.ts` | 2 passed |
| signal coop + SDK（snapshot cwd） | `playwright test signal-coop-e2e + signal-sdk-negative` | 2 passed |
| parity 新导出（snapshot cwd） | `playwright test tests/signal-rendered-parity.spec.ts` | 1 passed（三件套重生） |
| parity 重放（snapshot cwd） | `vitest run signalRenderedHeadlessParity.test.ts` | 3 passed（字节一致 + 分歧负向） |
| race3（T1/T2/T3，含 Owner token-only 403） | `playwright test tests/companion-room-race.spec.ts` | 3 passed |
| Owner 攻链 | `vite-node probe-owner-attack.mts` | 19 SECURE / 0 VULNERABLE |
| 截图实际查看 | `read evidence/humanR-4b938a5.png` / `humanR-c233.png` | room B `RELAY ACTIVE … EXIT OPEN` 4b938a5 不变 vs c233 先前 APPLIED |

## 尾项一：stale applied 世代门控（PASS 8/8）

`probe-stale-applied.mts`（真实 `CompanionGateway`）：
- G04 陈旧记录**省略** generation/room 证据 → `E_STALE_GENERATION companion.applied_generation_mismatch`（不回 flip 为 applied）。
- G05/G06 错误 generation / 正确 generation 但错误 room → `E_STALE_GENERATION`。
- G07 **正确的原世代 + 原房间**迟到回执 → 接受（applied，保留 stale 标记）。
- G08 **非陈旧**记录省略证据仍接受（宽松契约未变，旧客户端兼容）。

## 尾项二：确定性 core 双排序 toggle（PASS）

`probe-humanR-crossroom.mts`（生产 `enqueueCommand`+`stepSimulationTicks`+`roomAt`，c233 与 4b938a5 同情景）：
- **C（4b938a5）**：`toggle(true)` 先于 teleport 入队同一 tick → 在旧房提交，relay ACTIVE、`EXIT OPEN`。
- **D（4b938a5）**：toggle 在前一 tick 已提交 ACTIVE → teleport 后**效果保留**（ACTIVE、exitOpen=true）。
- **A/B（4b938a5）**：teleport 后（或同 tick teleport 先于 toggle）的旧 toggle 被 `E_PERMISSION` 拒绝，**不关闭 ACTIVE/exitOpen**（relay/exitOpen 不变）。与 `signalCombat.test.ts` 新增的 3 条（queued-before 旧房运行 / 已提交保留 / after-teleport 拒绝 + scan/jam 拒扣）一致，unit 59/59。

## ❌ 发现：人类 R 跨房控制回归（vs c233 既有全局控制）

任务要求对照“先前明确保留玩家自身全局设备控制”。真实 UI（同一 opt-in save + 真实 NEW RUN + 真实 portal；夹具：站门口，已披露）：

| 场景 | c233（父） | 4b938a5（目标） |
|---|---|---|
| U1 room A 按 R | ACTIVE | ACTIVE |
| U2 真实 portal A→B（设备留 A） | 设备房间=0，玩家=3 | 同 |
| **U3 room B 再按 R（设备在旧房 A）** | **APPLIED**：ACTIVE→INACTIVE、exitOpen true→false（全局控制保留） | **REJECTED**：ACTIVE、exitOpen true、无 `signal-relay-changed`、HUD 不变 |

确定性 core 对照同样：c233 fresh toggle 生效、4b938a5 `E_PERMISSION`。根因：`commitToggleRelay` 的新 guard 用**提交时玩家所在房间**与 `device.roomId` 比较，无法区分“旧房确认的陈旧 toggle”（应拒）与“玩家在新房主动按下的全局 toggle”（c233 保留）；两者在提交时都是 `currentRoomId=B / device.roomId=A`，被一并拒绝。

**判定：相对 c233 既有的“玩家全局设备控制”是一项行为回归**，按 Lead 指示如实回报、**未当作新规则接受**。修复建议（供开发者确认）：命令携带**入队时的房间/世代**（类似 suggestion 的 roomSeq），只拒“在旧房确认、跨房后才提交”的陈旧 toggle，保留玩家在新房主动按 R 的全局控制；或在 GameScene 侧对玩家 R 不做房界限制。scan/jam 跨房本就受 range/LOS 限制，风险较低（unit 亦记录 after-teleport 拒扣）。

## 精确可放行 scope

- **可放行（PASS）**：stale-applied 世代门控（省略/错误拒、正确原世代接受、非陈旧宽松）；确定性 core 双排序 toggle（teleport 前提交保留效果、teleport 后陈旧 toggle 不改 ACTIVE/exitOpen）；真实 portal 旧建议失效 + 新房 observe/suggest/确认一次；ECHO 同 tick 迁移；signal coop/SDK；parity 字节一致 + 分歧负向；race3（含 Owner token-only room 路由 403）；Owner 攻链 19/19；typecheck/MCP build。
- **不可放行（需开发者确认）**：**人类 R 跨房控制回归**（玩家在新房按 R 无法再控制留在旧房的 relay，c233 可）。这是本轮唯一未闭项；其余尾项闭环。原模型证据不变，不要求新模型回合/完整 Run。

## 说明

- 首次 parity 导出/重放曾误用 LAST_SIGNAL 工作目录（未 cd 快照），重放在快照目录因缺文件正确 FAIL（不假绿）；随后在快照目录重导（`13b`）与重放（`14b`）全 PASS，以快照结果为准。

## 路径

`reports/ai-native-02/tester/signal-tail-final/`
`00-freeze.log` / `00-all-files.sha256` / `00-archive-diff.log` / `00-tracked-hash-check.log` / `03-typecheck.log` / `04-mcp-build.log` / `05-unit-tail.log` / `06-stale-applied.json` / `07-stale-applied.log` / `01-humanR-c233.log` / `02-humanR-4b938a5.log` / `08-humanR-ui-c233.log` / `09-humanR-ui-4b938a5.log` / `10-room-cancel.log` / `11-portal-migration.log` / `12b-signal-coop-sdk-snap.log` / `13b-parity-export-snap.log` / `14b-parity-replay-snap.log` / `15-race-owner-perm.log` / `16-owner-attack.json` / `gate-summary.log` / `evidence/humanR-c233.png` / `evidence/humanR-4b938a5.png` / `probe-*.mts`
