# 本地 main 整合最终报告（AI-NATIVE-02 全功能分支）

- 采集时间：2026-11-17（本机）
- 仓库：`D:\Project\LAST_SIGNAL`
- 分支：`main`
- HEAD：`beb20df171281afcab06393e4e202402f9207252`
- Tree：`cab42dfb90e0e78d8079f0073d2f7e830bc4fd24`
- origin/main：`860a0dd78fb741896c2f1433742603dd91e37fc8`
- ahead / behind：**98 / 0**（origin/main 是 HEAD 的祖先）
- 状态：**未 push、未创建 PR**；本地 main 已完成整合；tracked dirty **0**。
- Untracked 证据/报告：**1623 个文件**（含 `reports/branch-integration/` 门禁日志、`reports/ai-native-02/final-delivery/`、以及既有旧 reports）。未 `git add` 全目录，未删除旧证据，`stash@{0}/@{1}` 未读取/未恢复。

## 1. 本轮两个 fix commit（在 main 上，独立于 merge 历史）

| commit | 说明 |
|---|---|
| `0faf95cc1e6f55cdf23e07cd4fe1c05f5d478c48` | sector end 房语义：extraction 房进入且其他房已清（exit unlocked）即下一 sector 门 `{target:null}`；boss 房杀 boss 后门变 `{target:null}`；start 房 spawn 时标记 `cleared=true`（使 `exitUnlocked` 正确）。sector spec 重写为真实交互：逐 deck 清非 boss 房→进 end 房→杀 boss→按 F 下一 sector→末尾 GameOver。 |
| `4cc80d0798ee6285099dd0597c226968882f7d0f` | 删除 `World.spawnProjectile` alias，恢复 C2 single-authority 契约（`rewiring.test` 断言 World.ts 不得暴露 `spawnProjectile(ownerId...)`）；sector boss 弹丸继续走既有 `spawnEnemyProjectile` core 命令。 |
| `beb20df171281afcab06393e4e202402f9207252` | `companion-room-cancel.spec.ts` 时序同步点：`enableEcho` 后首次 `echo_observe` 可能未在 30 帧 observation push 周期内到达；加有界重试（仍要求 `ok===true`，不放宽断言）。 |

## 2. 门禁（每条一行，绝对日志）

| # | 命令 | 结果 | 绝对日志 |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | **PASS** exit 0 | `D:\Project\LAST_SIGNAL\reports\branch-integration\82-tsc-rewiring-fix.log` |
| 2 | `npm run build` | **PASS** exit 0（built 14.50s） | `D:\Project\LAST_SIGNAL\reports\branch-integration\76-build-final.log` |
| 3 | `npm run game:mcp:build` | **PASS** exit 0（built 1.50s） | `D:\Project\LAST_SIGNAL\reports\branch-integration\77-mcp-build-final.log` |
| 4 | `npx vitest run`（全量） | **PASS** 745/745（65 files） | `D:\Project\LAST_SIGNAL\reports\branch-integration\87-unit-final2.log` |
| 5 | `npx vitest run src/world/sim/rewiring.test.ts` | **PASS** 11/11（C2 契约回归修复） | `D:\Project\LAST_SIGNAL\reports\branch-integration\83-rewiring-fix.log` |
| 6 | `npx vitest run src/ai-native/worldHeadlessSnapshotBoundary.test.ts` | **PASS** 7/7 | `D:\Project\LAST_SIGNAL\reports\branch-integration\84-snapshot-boundary-fix.log` |
| 7 | `npx vitest run src/ai-native/runtime.test.ts` | **PASS** 40/40 | `D:\Project\LAST_SIGNAL\reports\branch-integration\85-runtime-fix.log` |
| 8 | `PORT=5500 npx playwright test tests/sector-dungeon.spec.ts --workers=1` | **PASS** 1/1（真实 sector 交互） | `D:\Project\LAST_SIGNAL\reports\branch-integration\72-sector-green21.log` |
| 9 | `PORT=5500 npx playwright test tests/companion-room-cancel.spec.ts --workers=1` | **PASS** 2/2（同步点修复后） | `D:\Project\LAST_SIGNAL\reports\branch-integration\96-room-cancel-sync2.log` |
| 10 | `PORT=5500 npx playwright test --workers=1`（完整 E2E，全部 32 spec） | **PASS** 93/93（8.1m，全绿） | `D:\Project\LAST_SIGNAL\reports\branch-integration\98-complete-e2e-final3.log` |
| 11 | `git status --porcelain -uno` + branch/ancestor 表 | **PASS** tracked dirty 0；main=beb20df；ahead 98 | `D:\Project\LAST_SIGNAL\reports\branch-integration\99-final-main-state.log` |

完整 E2E 首败曾为 91/93（`companion-room-cancel` 2 个 `echo_observe` 时序失败，首败日志 `reports/branch-integration/88-complete-e2e-final2.log` 保留），加同步点后最终 `98-complete-e2e-final3.log` 93/93 全绿；不是放宽断言，仍要求 `echo_observe ok===true`。

## 3. 分支祖先表（`main` HEAD 视角）

| 分支 | tip | 状态 |
|---|---|---|
| `main` | `beb20df` | 本地 HEAD |
| `feat/ai-native-world-integration` | `d1f29d1` | ANCESTOR（已入） |
| `feat/ai-native-runtime` | `367dfa2` | ANCESTOR（已入） |
| `integrate/run-checkpoint-saves` | `de9d69d` | ANCESTOR（历史已入） |
| `integrate/all-branches-20261116` | `132c55b` | ANCESTOR（已入） |
| `origin/feat/ai-native-runtime` | `0679ebf` | ANCESTOR（历史已入） |
| `origin/feat/art-02-world-visuals` | `0b11869` | ANCESTOR（经 main revert 历史，未恢复被撤销内容） |
| `origin/feat/art-renaissance` | `56f39fa` | ANCESTOR（经 feat/ai-native-runtime 合入） |
| `origin/feat/claude-chan-art` | `be45ad8` | ANCESTOR（经 runtime 合入） |
| `origin/feat/grok-gemini-gpt-art` | `ef57986` | ANCESTOR（经 runtime 合入） |
| `origin/feat/whale-chan-art` | `d46d2cc` | ANCESTOR（经 runtime 合入） |
| `origin/feat/sector-dungeon` | `12fe8ac` | ANCESTOR（已入） |
| `origin/feat/r2-guard-perception` | `fc116fe` | ANCESTOR（历史已入） |
| `origin/feat/vs-01-relay-bridge` | `30edd36` | ANCESTOR（历史已入） |
| `origin/feature/run-checkpoint-saves` | `ef45f3c` | ANCESTOR（历史已入） |
| `fix/ui-menu-layout-rework` | `4ff3725` | **NOT_ANCESTOR**：用户/Lead 的 UI 菜单布局 rework 分支，不在本轮“AI-NATIVE-02 功能分支”范围内；未纳入、未改动。 |
| `origin/gh-pages` | `b4f390a` | **NOT_ANCESTOR**：部署产出分支（不同产出根/历史），不属功能分支，未纳入。 |

## 4. 结论

- 本地 `main` 已整合全部 AI-NATIVE-02 功能分支与历史已入支线（含 checkpoint/r2/vs01），并包含两个 sector/契约 fix commit 与一个 Companion 时序同步 commit。
- 最终完整 E2E **93/93 全绿**；全量单测 745/745；tsc/build/MCP build 全 PASS。
- 未 push、未创建 PR；untracked 证据保留；stash 未读取；未改写 merge 历史（fix commits 为 main 上的后续提交）。
