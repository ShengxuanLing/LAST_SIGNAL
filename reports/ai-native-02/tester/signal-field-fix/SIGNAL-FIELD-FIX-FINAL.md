# Task C `246469b` 三现场产品修复独立验收

**结论：大部分 PASS，但发现 1 项跨房建议失效缺口（需开发者确认/修复，不强行补全）。** 新 portal 两例、signal 合作/SDK 矩阵、重生 rendered parity→headless 三例、最小 resume/storage、CD 拒扣/恢复、memory/可用性、截图查看均独立通过；**跨房前未确认 Companion 建议在真实 portal 后仍可被 Owner 确认并以旧房坐标执行**（decide=true，echo 发出旧目标弹道）。

## 冻结

- 目标：`246469b7d7e82bb469f62f80f293b0702af46588`（父 `363eb173207bb5adaa0a21cd1af348dc92f29827`）
- HEAD 于冻结时同目标值；工作区 WIP 未读取、未使用；不覆盖原模型证据
- `git archive 246469b | tar -x` → `D:/Project/AI-NATIVE-02-snapshots/246469b`；**2043 文件**
- **tracked blob 比对**：`git ls-tree` blob vs `git hash-object --stdin-paths`（eol 过滤）→ **mismatch=0 / 2043**；二次解包 `diff -rq`=0；全量 sha256
- 未改源码/测试/配置/分支，未 merge/push/reset/rebase。自有 dev strictPort 5392，用完仅清理 5392，其他端口（5173/5176/5393/5394/5396/5397/5398）未动；secret 零日志。

## 门禁逐行（完整 `gate-summary.log`）

| 门 | 命令 | 结果 |
|---|---|---|
| 冻结+blob 比对 | `git archive` + `git hash-object` vs `git ls-tree` | 2043 mismatch=0, diff=0 |
| typecheck | `npx tsc --noEmit` | 0 |
| MCP build | `npx vite build --config vite.mcp.config.ts` | 0 |
| 定向 unit | `vitest run companionInsights/ targetRemoval/ echoRoomTransition/ companionFacet` | 37 passed |
| **新 portal 2 例** | `PORT=5392 playwright test tests/echo-portal-migration.spec.ts` | **2 passed** |
| signal 合作 E2E | `playwright test tests/signal-coop-e2e.spec.ts` | 1 passed（10 步） |
| signal SDK 矩阵 | `playwright test tests/signal-sdk-negative.spec.ts` | 1 passed |
| rendered parity 重生 | `playwright test tests/signal-rendered-parity.spec.ts` | 1 passed（三件套重生） |
| headless parity 3 例 | `vitest run signalRenderedHeadlessParity` | 3 passed（字节一致+分歧负向） |
| C2 resume | `playwright test tests/resume-no-step.spec.ts` | 3 passed |
| C2 storage/checkpoint | `playwright test tests/checkpoint.spec.ts -g "resume reuses..."` | 1 passed |
| core signal combat | `vitest run src/world/sim/signalCombat.test.ts` | 28 passed |
| CD 拒扣/恢复 | `vite-node probe-cd-recovery.mts` | 5/5 |
| **跨房未确认建议负向** | `vite-node probe-cross-room-suggestion.mts` | **FAIL（见下）** |
| 截图实际查看 | `read evidence/xroom-after.png` | room B 正常（见下） |

## 新 portal 两例（PASS）

`tests/echo-portal-migration.spec.ts`（真实 browser、真实 portal 交互、真实 core tick；唯一夹具=把玩家放到自己的 portal，已披露）：
1. **普通 portal**：echo 与 player 同房，assist 已 armed、memory 有旧房条目 → 真实 `requestInteract` → 真实下一房：echo 仍在（未滞留旧房）、在**新房间内**且距 player **<3.5**、`assistArmed=false`、旧房 memory 条目全部落在新房间边界内（无旧房残留）。HP/能量未刷（迁移同一 tick，非 heal 路径）。
2. **NEGATIVE CONTROL（hold 无 flag 传送保留原位）**：`setEchoMode('hold')` 后 `enqueueTeleport(..., migrateEcho=false)` → player 移动 >2，**echo 坐标 `toBeCloseTo` 原位不变**（证明修正是显式 flag，不是“某 tick 碰巧移动”）。

## signal 合作 / SDK / parity（PASS）

- **合作链 10 步**：默认无 relay → 真实 Pause opt-in → 设备 INACTIVE 挡门 → Companion 观察 relay → fixture suggest → Owner 确认暂停只入队 → 恢复真实 tick ACTIVE → echo scan 仅扣 echo 100→90 → 真实 portal room3→5 → memory/status 正常。
- **SDK 矩阵**：v1 缺 actor isError；actor=echo `E_PERMISSION` 无扣/无队列；actor=player 真实付费；jam 到期回 INACTIVE 保持 manual OFF/powered。
- **parity**：三件套重生（`01:45`）→ headless 重放 3 passed（canonical+events 字节一致；改 actor 分歧负向）。

## memory / 可用性 / CD（PASS）

- `companionInsights`：裁剪 target 记作 `target`（非 relay），relay 仅设备；`availableActions` 反映**当前** scanCD>0 → `cooldown`、能量不足 → `insufficient_energy`、available=false；CD/能量恢复后 available=true；perceived relay 是合法 scan/jam 主体（真实出口链）。
- 独立 `probe-cd-recovery.mts`（5/5）：CD 内 scan → `E_COOLDOWN` **不扣费**；推进 120 tick → CD=0；恢复后 scan 成功再次扣费；能量不足 `E_ENERGY_INSUFFICIENT` 不扣费。

## 辅助清敌边界（fixture 改进，不作正常战斗证明）

`targetRemoval.test.ts`（PASS）：**真实死亡（hp<=0）的 target 由下一 core tick 从 `state.targets` 移除**；**活着的 target 不会被移除**——旧的“renderer-only clear-enemies（把 targets 清 0）”只是夹具改进，会留下幻影威胁，**不作为正常战斗证明**。

## ❌ 发现：跨房未确认建议未失效（新缺口，需开发者确认）

`probe-cross-room-suggestion.mts`（真实 bridge + 官方 Companion SDK + 真实 masked 表单 + 真实 portal；夹具：直接置玩家门口、直开 relay ACTIVE，已披露）：

1. room A：真实 drone + 观察 → 官方 SDK `echo_suggest {kind:'fire', target:room-A 坐标, ttl:600}`（**未确认**），`echo_status` pending 含该 `sug_...`。
2. 真实 portal A→B（room 0→3）。
3. 过门后 `echo_status` pending **仍含旧 `sug_...`**（未被取消，epoch 未变）。
4. 用真实浏览器 `companionLink.pending()` 取到旧建议并 `decide(...,'confirm')` → **`decided=true`**，`world.enqueueCompanionAction('fire', 旧房坐标)` 执行，下一 tick echo 发出弹道（`projectiles=1`）。

即：`World.tryInteract` 只清了 `echoController`（assist/suggestion/memory）与 `pendingCompanionIntent`，**未通知 gateway/facet 作废旧房未确认建议**；旧建议跨房后仍可被 Owner 确认并按旧房坐标执行。这**不绕过 Owner 确认、不泄状态、不破门控**，但违反“跨房旧建议不得误执行”的期望，且与源码注释“pending companion intent dropped”不一致。**请开发者确认这是需修复缺口还是预期（若预期，应显式 epoch 推进/取消旧建议）。**

## 精确范围与剩余阻断

- **PASS（精确 scope）**：echo 同 tick 跨房迁移 + assist/memory/旧意图清理；hold 无 flag 传送保留原位；signal 合作/SDK/parity 字节一致；memory 真实 actor 类型；可用性反映 CD/能量；CD 拒扣/恢复；最小 resume/storage。原模型证据不变，本轮为 fixture 真产品路径回归，未再一次声称 LLM。
- **剩余阻断（及时回报）**：**跨房未确认 Companion 建议未失效**（`probe-cross-room-suggestion` FAIL / `12-cross-room-suggestion.log`）。其余按指示不重开全架构、不要求完整 Run。

## 路径

`reports/ai-native-02/tester/signal-field-fix/`
`00-freeze.log` / `00-all-files.sha256` / `00-archive-diff.log` / `00-tracked-hash-check.log` / `01-typecheck.log` / `02-mcp-build.log` / `03-unit-signal.log` / `04-portal-migration.log` / `05-coop-e2e.log` / `06-sdk-negative.log` / `07-parity-export.log` / `08-parity-replay.log` / `09-resume.log` / `10-storage.log` / `11-cross-room-suggestion.json` / `12-cross-room-suggestion.log` / `13-signal-combat-core.log` / `14-cd-recovery.json` / `15-cd-recovery.log` / `gate-summary.log` / `evidence/xroom-after.png` / `evidence/coop/*.png` / `probe-*.mts`
