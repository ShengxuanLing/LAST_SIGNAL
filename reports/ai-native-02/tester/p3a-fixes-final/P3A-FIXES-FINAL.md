# P3-a 三缺口修复 — 独立定向验收（冻结 212cd56）

- **被测**：`212cd5634ea4ef1e775294eab3ccfca8ecff3a1f`（`fix: legacy actor targeting, shared echo projection parity, restore authority reset`）
  - 父 `553707800cc20e203d55f83db9829727bed1ff90`（core/actor attribution/restore validation），更早 `dd42239372f045c91307ae83edcba9aa276428fd`（纯 companionFacet，P3-b A，本轮不作为 LLM 实跑证据）。
- **冻结**：`git archive 212cd56` → `D:/Project/AI-NATIVE-02-snapshots/212cd56`（`node_modules` junction），MD5 见 `00-frozen-hashes.log`；未读共享 WIP / 未读 stash，未改源码/测试/配置/分支。
  - 复核期间活仓库 HEAD 仍 `212cd56`，但工作区有下一轮 WIP（`companionFacet.ts`、`slice/rules.ts` 等）；**未读取/未使用**。
- **范围**：只审上轮三缺口（legacy 敌人/Boss 选 ECHO、restore 权限/HP、Headless echoView 裁剪）+ 最小回归；未跑 70 全量，未重做历史架构审查。
- **Fixture 披露**：owner/dev 门面用于确定性布置（`spawnEnemy/spawnBoss`、`setPlayerPositionForTest`、`clearEnemiesForTest`、`invuln`、`simFixture` HP、静态 target 的 `idle/stateTimer`）；真实 FSM/伤害/存档/core tick 是产品代码。ECHO 为本地确定性策略 + 人类确认，**不是 LLM/Agent**；Signal/能量未实现。

## 1. 门禁/最小回归（一行式）

| 项 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| typecheck | `npx tsc --noEmit` | PASS | `01-typecheck.log` |
| unit | `npm test` | PASS **50 files / 627 tests**（首跑即全绿） | `02-unit.log` |
| build / MCP | `npx vite build` / `vite.mcp.config.ts` | PASS | `03` / `03b` |
| P3-a 新 3 例 | `tests/p3a-{enemy-target,restore,echo-parity}.spec.ts --workers=1` | PASS **4/4** | `04-p3a-new-tests.log` |
| 开发者 parity | `scripts/p3a-echo-rendered-parity.mts` | PASS `ticks=215 steps=208 echoHp=86` | `05-dev-parity.log` |
| C3c parity 16 | 快照 cwd 重生 + compare | PASS `finalTick=26 events=59 kills=1` | `16`/`16b` |
| C3b resume | `tests/resume-no-step.spec.ts` | PASS 3/3 | `15-resume.log` |
| Task0 root junction | `c3cOwnerFile.test.ts` | PASS 7/7（含 frames ROOT junction 拒绝） | `12-owner-unit.log` |
| console 启动 | `worldConsoleSmoke.mts` + 官方 REPL `create/observe/quit` | PASS（真子进程，exit 0） | `13-console-smoke.log`、`14-repl.log` |
| 20k stdio | `worldHeadless20kSmoke.mts` | PASS `eventTotal=101635 maxResponseBytes=147844` | `17-20k-smoke.log` |

## 2. 缺口 1：legacy 各 kind + Boss 合法选 ECHO（我的独立探针 18/18）

- `hunter/stalker/sentinel` 逐一用真实 `spawnEnemy` 放在 ECHO 旁，主角远置且 invuln：
  - ECHO HP 分别 **100→88 / 100→86 / 100→81**；
  - 敌人 `targetActorKind='echo'`, `targetId=1`；
  - 主角 HP 保持 100；`echoShotsFired=0`、`assist=false`（**确认前不开火**）。
- 真实 Boss（`spawnBoss`）在 boss room 也把 ECHO 打伤，主角 HP 不联动、无确认不开火。
- ECHO 死亡后同一 hunter 重新选择主角：`targetActorKind='player'`, `targetId=0`，主角 HP 100→64。
- 无 pageerror。日志 `06-targets.log`、`targets.json`。

## 3. 缺口 2：restore 权限/HP/旧档（我的独立探针 10/10）

- 合法检查点（fixture：ECHO HP **42**、主角 HP **55**，assist armed / hold / memory+suggestion 已种）：
  - `restoreCheckpoint` 成功；assist=false、mode=`follow`、memory=0、suggestion=null、lastIntent neutral；
  - ECHO=42、主角=55（**没有免费回血**）；可见 drone 但 `intent.fire=false`、`shots=0`（**旧 suggestion 不能开火**）。
- 同一 frame 连续 restore 两次：HP 仍 42/55、assist=false、shots=0（**不能刷 HP**）。
- 旧档（`delete coreState.echo`）恢复后无 echo；重新 `enableEcho()` 得基础 HP 100、assist=false、memory 在恢复时为 0、intent.fire=false、shots=0（**必须新确认**）。
- 模式切换与 `reset()` 均撤销 assist。日志 `07-restore.log`、`restore.json`。

## 4. 缺口 3：Headless echoView 目标/隐藏负向（7/7）

- Headless runtime：近处 hunter 出现在 `targets`，Boss 只给公开 `hp/kind/isBoss`，40 格外 target 被裁；视图以 ECHO 坐标为中心，无 `seed/rngState/pendingCommands`。
- 纯 `buildEchoObservation`：墙后 target 被 LOS 裁掉；远距/未探索/死亡目标排除；近处 drone 保留。
- 日志 `08-headless-echo-view.log`。

## 5. 我自己重生的 212-tick Rendered↔Headless 字节 parity（13/13）

- 真实渲染 World：初始 `SimulationState` 含 echo、core drone、**静态 hunter target**（`idle/stateTimer=1e9`）、一条真实 `spawn-loot` command；主角/ECHO/target 位置固定。
- 显式记录 **212 个固定 tick** 的 `playerIntent + echoIntent`（`stepFrame` 第三参），不是只跑两次同策略 Node 程序。
- Headless `fromSimulationState(initial, enteredRooms)` 重放：
  - canonicalState **逐字节相等**（1314B）；**全 events 逐字节相等**（77,046B）；`finalTick=242` 相等；
  - ECHO HP 93、主角 100、drones/targets/loot 数一致；
  - 真实事件含 `echo-fired / enemy-hit / enemy-died / echo-hurt / loot-dropped / loot-collected / xp-gained`，`byActorId=1` 的 ECHO 命中 >0。
- **不外推**：本证据只对 core-managed actors + 静态 target 成立；动态 legacy target 的逐 tick 适配器路径不在本次字节 parity 范围内（上轮已记录其边界）。
- 日志 `09-parity212-export.log`、`10-parity212-replay.log`、`parity212/`、`18-evidence-md5.log`。

## 6. 五视口 / 旧流程 / Task0 最小确认（9/9 + 7/7）

- 五视口（1920×1080…800×600）：双 actor + `ECHO 100/100 · FOLLOW · ASSIST SAFE` 均可见；已实际查看 `evidence-viewports/hud-echo-800x600.png`。
- `onPause/onResume` 与 `onLevelUp/onLevelUpClosed` tick 29→29→29→29→29（无旁路 tick）；portal 真转场 room 0→3、ECHO `teleport/moved` 命令在 2 个 tick 内处理、tick 只 +2；`captureCheckpoint` 返回含 echo 的深拷贝，改 frame 不动活状态。
- Task0：owner unit 7/7（含 frames ROOT junction 拒绝）、console smoke 三模式 PASS、官方 REPL `create/observe/quit` 真启动；20k stdio 回归 PASS。

## 7. 判定

| 缺口 | 判定 |
| --- | --- |
| legacy hunter/stalker/sentinel + Boss 选/伤 ECHO、主角不联动、死后重选、确认前不开火 | **解除**（独立实测 18/18） |
| restore echo42/player55 无 assist、旧档无 echo 重新启用需新确认、不能刷 HP/旧 suggestion | **解除**（10/10） |
| Headless echoView hunter/隐藏负向 | **解除**（7/7） |
| Rendered↔Headless 212 tick 字节 parity（core actors + 静态 target，kill/loot/echo伤） | **PASS**（13/13）；不外推动态 legacy |
| 五视口/暂停/升级/portal/存档/Task0/C3b resume 最小回归 | **PASS** |
| 真实 LLM / Signal / 完整 P3 / P4 | **未实现**：companionFacet 只是纯 observe/suggest/status 接缝，本轮没有 LLM 实跑；Signal/能量未做；ECHO 仍是本地确定性策略 + 人类确认 |
| 全 Run / AI-NATIVE-02 整体 | 不声称；未跑 70 全量，不重复历史审查 |

## 8. 复现

```bash
cd D:/Project/AI-NATIVE-02-snapshots/212cd56
npx tsc --noEmit && npm test
npx vite build && npx vite build --config vite.mcp.config.ts
PORT=5371 npx playwright test tests/p3a-enemy-target.spec.ts tests/p3a-restore.spec.ts tests/p3a-echo-parity.spec.ts --workers=1
node .../probe-targets.mjs ; node .../probe-restore.mjs ; node .../probe-viewports-levelup.mjs
npx vite-node probe-headless-echo-view.mts
# parity: probe-parity212-export.mjs (browser) then probe-parity212-replay.mts (vite-node)
npx vite-node scripts/p3a-echo-rendered-parity.mts
PORT=5371 npx playwright test tests/resume-no-step.spec.ts --workers=1
npx vitest run src/ai-native/c3cOwnerFile.test.ts ; npx vite-node src/ai-native/worldConsoleSmoke.mts
printf 'create\nobserve\nquit\n' | npm run game:world:mcp-console -- --headless
```

## 9. 文件

`reports/ai-native-02/tester/p3a-fixes-final/`：`00-frozen-hashes.log`、`01–05` 门禁、`06` targets、`07` restore、`08` headless echoView、`09–10` 212 parity、`11` 五视口/旧流程、`12–17` 最小回归、`18-evidence-md5.log`、`targets.json`、`restore.json`、`viewports.json`、`parity212/`、`evidence-viewports/`、`probe-*.mjs/.mts`。
