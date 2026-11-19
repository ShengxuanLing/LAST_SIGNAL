# 测试报告 — Lead 合并后的 main（测试 Lead 目前的成果）

- 被测树：`main` @ `0faf95c` + 工作区未提交 1 处 `src/world/World.ts`（删除 `spawnProjectile` 兼容别名）
- 日志/证据目录：`reports/ai-native-02/tester/lead-merge-main/`
- 日期：2026-11-16
- 结论：**核心逻辑与构建门禁通过；Playwright 全量 2 红（P1 稳定红、P3-a 负载相关偶发红），单测 2 红为满载超时**。P1 的红不是 sim 规则回归，而是测试自身夹具失效 + 默认 run 血量贴近死亡线的结果。

## 门禁结果

| # | 门禁 | 命令 | 结果 | 日志 |
|---|---|---|---|---|
| 1 | 类型检查 | `npx tsc --noEmit` | PASS exit 0 | `01-typecheck.log` |
| 2 | 客户端构建 | `npm run build` | PASS exit 0 | `04-build.log` |
| 3 | MCP 构建 | `npm run game:mcp:build` | PASS exit 0 | `05-mcp-build.log` |
| 4 | 全量单测 | `npx vitest run` | **FAIL** 2 failed / 743 passed（65 files, 334s） | `02-unit.log` |
| 4b | 单测失败隔离复跑 | `npx vitest run src/ai-native/runtime.test.ts` | PASS 40/40 | `03-runtime-isolated.log` |
| 5 | F-03 生产无 `window.__game` | `npx vite-node scripts/c3b-f03-gate.mts` | PASS `F03_PRODUCTION_GATE_PASS` | `06-f03.log` |
| 6 | World Player MCP smoke | `npx vite-node src/ai-native/worldMcpSmoke.mts` | PASS `WORLD_MCP_SMOKE_PASS` | `07-world-mcp-smoke.log` |
| 7 | Headless Player MCP smoke | `npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts` | PASS `HEADLESS_MCP_SMOKE_PASS` | `08-headless-mcp-smoke.log` |
| 8 | Companion MCP smoke | `npx vite-node src/ai-native/companionConsoleSmoke.mts` | PASS `COMPANION_CONSOLE_SMOKE_OK` | `09-companion-smoke.log` |
| 9 | Rendered↔Headless sim parity | `npm run game:sim:parity` | PASS `PARITY_PASS checks=8` | `16-sim-parity.log` |
| 10 | C3c 16 门 Node 重放 | `npx vite-node scripts/c3c-rendered-headless-parity.mts` | PASS `C3C_RENDERED_HEADLESS_PARITY_PASS tick=25 events=59` | `17-c3c-node-parity.log` |
| 11 | 全量 Playwright（自起 dev :5422） | `PORT=5422 npx playwright test --workers=1` | **FAIL** 91 passed / 2 failed (9.1m) | `10-e2e-full.log` |

Playwright 两条红：

- `tests/ai-native-world.spec.ts:257` — `AI-NATIVE-02 P1 real World › shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit`
- `tests/ai-native-world.spec.ts:1266` — `P3-a echo companion › enable via pause, follow/hold, confirm-before-fire, real damage`

## 失败 1：P1 spec 在 main 上稳定红（6/6）

隔离复跑：`PORT=5422 npx playwright test tests/ai-native-world.spec.ts --workers=1 -g "shared control path"` → 6 次全部失败（`12-p1-run1..6.log`），失败点漂移，说明是时序/血量问题而不是固定断言写错：

| run | 失败断言 | 现象 |
|---|---|---|
| 1,2 | `enableAiViaPause` → `PauseScene open` (spec:206) | 按 Escape 时活动场景是 `GameOverScene`，玩家已死 |
| 3 | `GameOverScene after death` (spec:571 附近) | 注入 `hurt(999999)` 后仍是 `GameScene`，未死 |
| 4,5,6 | 同 run1/2 | 玩家在 AI 抽样窗口中死亡 |
| 全量 run | `txtControl` `HUMAN` (spec:548) | 实得 `CONTROL  PAUSED`（等级选择遮罩仍开着） |

**根因（已实测确认，不是猜测）**：spec 的两处保护夹具都是空操作。`Player.invuln` 只有 getter 没有 setter（`src/entities/Player.ts:64`，取值走 `world.playerInvuln` → `_sim.player.invuln`，`src/world/World.ts:465`）。浏览器里验证：

```
gs.world.player.invuln = 1e9  →  threw: null, 读取值仍 0, hasOwnProperty('invuln') = false
```

即 `stabilizeEvidenceRun()` 每 100ms 刷的 i 帧从未生效（`tests/ai-native-world.spec.ts:218-231`），死亡步骤里的 `player.invuln = 0` 同样无效（所以残余 dash i 帧会挡住致命伤 → 上面 run3 那种「杀不死」）。

于是默认 run 的真实血量决定成败。同一 seed(424242) 的存活探针（复刻 P1 的 AI 抽样节奏，`probe/`）：

```
hp trace: 100,100,89,78,100,89,89,100,100,84,84,76,55,85,77,56  → 末值 48
```

玩家一直在 48–56 HP 附近，AI 再推进一点就死；P1 又在 AI 战斗期间插了 `clearLevelUp` / 2s 静止等待，正好落在死亡边缘。

同时 `record('evidence-fixture', { onlyIFramesRefreshed: true, hpUnchanged: true, ... })` 记录的是一个**并未发生**的夹具，这条证据不可采信。

### 与 d1f29d1 基线的对比（不改变工作区，用临时 worktree）

- `git worktree add --detach /d/tmp/ls-d1 d1f29d1` + `node_modules` 目录联接 + 自起 dev :5423，用**同一份 spec**（`git diff d1f29d1 HEAD -- tests/ai-native-world.spec.ts` 为空，spec 完全一致）跑 P1：**4 pass / 1 fail**（`13-d1f29d1-p1-run1..5.log`；唯一一次失败也是「注入致命伤却不死」那一类）。
- `132c55b`（合入 main 前的功能分支头）：1 pass / 1 fail（`14-132c55b-p1-run1..2.log`）。
- 存活探针在 main 与 d1f29d1 上**血量轨迹逐点一致**（`hp: 100,100,89,78,100,89,89,100,100,84,84,76,55,85,77,56`），帧率 53 (main) vs 56 (d1f29d1)。

结论：合并没有改动 sim 规则（`src/world/sim/*` 在 `132c55b..HEAD` 无 diff，全量 parity 也 PASS），红是「夹具失效 + 默认 run 贴近死亡线 + 合并后渲染更重、帧率略低」的合力；main 只是把这个既有脆弱性从 ~20% 推到 ~100%。

**建议修法**：

1. 给 `Player` 加真正的 `set invuln`（经 core 事务写入 `_sim.player.invuln`，或暴露 `World.setPlayerInvuln`），spec 的 i 帧夹具与死亡步骤才成立；否则 `record` 里不应再写 `onlyIFramesRefreshed: true`。
2. 或把 P1 做成确定性：抽样窗口内清空当前房敌人 / 用固定血量夹具，别让断言依赖真实战斗存活。
3. `clearLevelUp` 失败会让 `txtControl` 变 `CONTROL PAUSED`（spec:548），建议失败时同时校验覆盖层状态，避免把它误判成控制权回归。

## 失败 2：P3-a echo（负载相关偶发）

- 全量跑第 13 条失败：`protagonist HP is unaffected by echo damage` — expected 100, received 82（真实 drone 在探针窗口内打到了主角，不是 echo 伤害串到主角）。
- 隔离复跑 3 次全 PASS（`15-p3a-run1..3.log`），即与 GATES 里记录的「已知 P3-a echo flake」一致：只在全量串跑/机器繁忙时复现。

复现：`PORT=5422 npx playwright test --workers=1`（全量串跑，前面跑完 ai-native-world 其它 9 条后再跑 P3-a）。

## 失败 3：单测 2 红（满载超时，非逻辑错）

```
FAIL src/ai-native/runtime.test.ts > B5 … CLI 0-step replay hash equals the source snapshot hash
FAIL src/ai-native/runtime.test.ts > B6 … snapshot/replay/restore require the explicit --dev channel
Error: spawnSync D:\nodejs\node.exe ETIMEDOUT   (runtime.test.ts:48, timeout 120_000)
```

- 同时刻其它 CLI 用例耗时 11–16s，这两条撞 120s 上限；隔离跑 `runtime.test.ts` 40/40 PASS。
- 复现：`npx vitest run`（65 文件并行时稳定撞线；`02-unit.log`）。
- 建议：该文件的 CLI 子进程超时与并行度需解耦（提高 `120_000` 或 `--no-file-parallelism` 跑该文件），否则任何满载机器上全量单测都不可复现为绿。

## 其它需要注意

1. **被测树含未提交改动**：`src/world/World.ts` 删除了 `spawnProjectile` 兼容别名（工作区状态，HEAD 仍含该别名）。删除后无调用者、`tsc`/`build`/单测均过，`src/world/sim/rewiring.test.ts` 的源码守卫正是要求不存在，因此这处改动看起来是对的，但它未提交 → 我跑的 Playwright 证据来自「HEAD + 该改动」。
2. **证据文件被本轮跑动作覆盖**：Playwright 用例会把截图/操作日志写进 `reports/ai-native-02/evidence/`，这些文件在我开始前已是 dirty，本轮跑动又重写了一遍（`hud-*.png`、`ai-run-*.png`、`operation-log-*.json` 等）。若 Lead 需要旧版本内容，需从更早的报告快照取。
3. 我用的 dev server 端口 5422（main）、5423（基线 worktree），均已关闭（`netstat` 无监听）；临时 worktree 已 `git worktree remove --force` 清理，工作区只剩原有改动。
4. 本轮新增的临时探针 `reports/ai-native-02/tester/lead-merge-main/probe/` 仅供取证，未被 `tests/` 收录，不参与 CI。
