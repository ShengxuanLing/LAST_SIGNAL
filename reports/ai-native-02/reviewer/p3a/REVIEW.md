# P3-a ECHO 与 Task0 Owner 文件 独立验收（b3930c5）

- **被测提交**：`b3930c5df4010b896ffac868da9f0d2e0d6695a5`（HEAD），父 `c3e1461`；链：`39a43b2`（Task0）→ `8b2de8e`（echo core）→ `c3e1461`（rendered echo）→ `b3930c5`（headless/checkpoint）
- **分支**：`feat/ai-native-world-integration`；未读/不恢复 WIP/stash；未改源/测试/配置/分支
- **快照**：`git archive` 冻结 `D:/Project/lastsignal-p3a-review-b3930c5`；Python git blob SHA1 全量比对 → `ALL_TRACKED_FILES_MATCH`（1903/1903）
- **结论**：**Task0 A–D + 官方 REPL 三路 关闭。P3-a 未完全 PASS**：核心/渲染单 drone 遭遇与 UI 通过，但 **非 drone 敌人未实现 nearest-actor 感知**、**Headless echoView 丢失 `sim.targets`**、**checkpoint 未恢复/清理 echo 策略状态**。P3-b 不满足前置。

## 一、Task0 Owner 文件关闭表（A–D + REPL）

| 项 | 命令/方式 | 结果 | 证据 |
|---|---|---|---|
| A. Owner ACL POSIX/Windows 当前 SID | 独立 `frameExport` + `icacls`；`c3cOwnerFile.test.ts` | **PASS** 文件 `S\Rafae:(F)`、目录 `S\Rafae:(OI)(CI)(F)`，无 `BUILTIN\Users`/`Authenticated Users`/`(I)` | `gate-probe-task0-acl.log`；`gate-unit-echo.log` |
| B. junction/reparse/root/link 拒绝 | `resolveFrameFile` `realpath`+`lstat`+root 检查；unit | **PASS** frames 内 junction 指向外部被拒；plain file 接受；frames root 本身拒绝 | `c3cOwnerFile.test.ts`（6/6） |
| C. 完整 MCP envelope（text+structured+UTF-8）512KiB | `measureMcpResult` 计 `JSON.stringify(result)` UTF-8；`devEvents` shrink 用同口径 | **PASS** 近预算分页按完整 envelope 收缩 | `c3cOwnerFile.test.ts` |
| D. size 预检不 read | `lstat(realFile).size > 16MiB` → `E_RESOURCE_LIMIT` 在 `readFile/JSON.parse` 前 | **PASS** >16MiB 帧文件读前拒绝 | `c3cOwnerFile.test.ts` |
| 官方 REPL 真实启动三路 | `vite-node src/ai-native/worldConsoleSmoke.mts` | **PASS** headless Player / headless Dev help / rendered help 三路 code 0 | `gate-console-smoke.log` |

> 残余（非阻断）：POSIX 0600/0700 分支未在本机 Windows 实跑；`resolveFrameFile` 未拒绝 **frames 根目录本身是 junction** 的情况（只拒绝内部 link/root 字符串）；建议后续加 `lstat(base)` 拒绝 base 为 link。

## 二、P3-a 验证结果

| 项 | 结果 | 证据 |
|---|---|---|
| 独立 actor state（actorId≠0、own data/HP/cooldown、无玩家别名） | **PASS** | `core echo.test.ts` 9 项；`tickActorTimers` 全用 actor 局部变量；`echoPlayerData` 独立构造 |
| 观察 center（echo 自己的 12 格 + explored + LOS） | **PASS（rendered/headless 自身）** | `World.echoView`/`HeadlessWorld.echoView` center=echo；`worldHeadlessEcho.test.ts` |
| 复用 pure actor 规则、无第二 World | **PASS** | `echo.ts` 纯 TS；core `stepEcho` 复用 `fireActor/stepActorMovement/applyActorHit`；无 World/Phaser 依赖 |
| echo 关闭时原 canonical/C2 不变 | **PASS** | `core echo.test.ts`：无 echo canonical 无 echo 键、3 参 step 逐 tick 一致；C1/C2 parity 全 PASS |
| 确认前绝不开火 | **PASS** | `EchoController.decide` fire 需 `assistConfirmed`；`setMode/clearIntent/revoke` 清除；渲染 E2E 确认前 0 发 |
| drone 最近 actor / 弹丸命中 / 死亡 / 友伤 | **PASS（仅 drone）** | core `chooseActorTarget` 仅用于 `stepDrones`；projectile 命中 player/echo；echo/player 弹 side=player 只打敌，无友伤 |
| 普通 Player/外部 Player 不能写 echo/Owner | **PASS** | Player MCP 工具面**无 echo 工具**；echo 指令只在 Pause UI（`GameScene.enableEcho` 等）；外部只 PlayerIntent |
| 模式/撤销/死亡/迁移/暂停/resume 不残输入 | **PASS（控制器层）** | `setMode`/`clearIntent`/`echo-death` 清 intent；pause 无 tick，resume 重新 decide |
| checkpoint 旧档/畸形 echo 拒绝/不刷 HP | **PASS（校验层）** | `runCheckpoint.test.ts`：旧档无 echo 合法；hp<0/>max/max<=0/非 pulse/NaN 拒绝；restore 不重置 echo HP |
| 五视口第 8 行 HUD / labels 不假外部连接 | **PASS** | 5 个 `HUD fully visible` E2E（8 行含 `txtEcho`）+ `txtAgentLink` 断言 `EXTERNAL NOT CONNECTED` |
| 旧武器/C2 不受 core refactor 影响 | **PASS** | C2 node 8 / kill 13 / room 220 / loot；core/parity/rewiring 40/40 |

**门禁**：typecheck PASS；定向 unit **30/30**；`P3A_ECHO_PARITY_PASS` 5/5（Node 双跑）；E2E **6/6**（5 视口 + 渲染 echo）；console smoke 3/3。

## 三、阻断/证据缺口

### P3a-1（阻断）：非 drone 敌人没有 nearest-actor 感知
- `World.updateLegacy` 对非 drone 敌人：
  ```ts
  for (const e of this.enemies) { if (e.data.kind === 'drone') continue; e.update(dt, this.player); }
  if (this.boss) this.boss.update(dt, this.player);
  ```
  `Enemy.update/legacyStateMachine/detects/moveToPlayer/doAttack` 全部以 `player: Player` 为目标；Boss 同。**只有 core `stepDrones` 用 `chooseActorTarget`（player/echo 最近）**。
- 因此 hunter/stalker/sentinel/Boss **仍只打主角**，不会选择更近的 ECHO；与开发者报告“敌人合法选择 ECHO（melee/远程）”不符（该结论最多覆盖 drone/远程弹道）。
- 修复：legacy `Enemy.update`/Boss 的目标选择改为“最近存活 actor（player/echo）”，或把非 drone AI 迁入 core；补 hunter/stalker/sentinel/Boss 对 ECHO 的真实命中/死亡/目标选择测试。

### P3a-2（阻断/证据缺口）：Headless echoView 丢失 `sim.targets`，且无 Rendered↔Headless echo 对比
- `HeadlessWorld.echoView()` 只读 `this.sim.drones`；`World.echoView()` 读 `this.enemies`（包含非 drone targets）。独立 probe：在 `sim.targets` 放一个 hunter(77) 后，headless echoView `drones=[]`（不含 77）。
- 结果：渲染侧 ECHO 可感知/瞄准 hunter/sentinel 等 targets，Headless 不能；两侧 echo 感知/行为分叉。
- `scripts/p3a-echo-parity.mts` 是 **Node 双跑**（两份 Node 结果相同），不是 Rendered↔Headless 字节对比；渲染 E2E 只验证行为（drone），未比较 Rendered canonical/events 与 Headless echo 运行。
- 修复：headless `echoView` 合并 `sim.targets`（且保持 12 格/LOS/explored）；新增 Rendered 导出 + Headless 重放的 echo canonical/events 对比（含 kill/loot/damage），并覆盖非 drone 目标。

### P3a-3（残余/阻断前修）：checkpoint restore 不恢复/清理 echo 策略状态
- `World.restoreCheckpoint` 只恢复/删除 `_sim.echo`，**未** `echoController.clearIntent()` 或恢复 mode/assist/memory；`World.reset` 才 clearIntent。
- 正常流程（GameScene 重建/新 World）会重置控制器；但 `World.restoreCheckpoint` 作为公开 API 在 mid-run 调用时，可能保留旧 `assistConfirmed=true`：restore 到无 echo 的旧档后，`enableEcho` 会**无新确认直接开火**，违反“确认前绝不开火”的跨 checkpoint 语义。
- 无 HP farm：echo HP 来自存档，不被 `#resetPlayer` 重置。`EchoController.snapshotState/loadState` 已存在但未被 checkpoint 使用。
- 修复：`restoreCheckpoint` 至少 `echoController.clearIntent()`/mode=follow；若要求完整，持久化 `snapshotState` 并在 restore 时 `loadState`（assist/mode/memory）。

### 其他残余
- `ECHO_ACTOR_ID = 1` 与 drone id 命名空间（1..）重叠；`step.targetId=1` 诊断歧义（不参与行为选择，但日志/调试易混）。
- checkpoint echo 校验只查 `x/y/actorId/timers/hp/maxHp/weaponKey/weapons[]`；`data.armor/speed/...` 等未深度校验（畸形 echo 的 NaN 字段可能影响 echo 自身，非主角）。
- Task0 B 的 **frames 根目录本身为 junction** 未拒绝（仅拒绝内部 link/root 字符串）。

## 四、范围 / P3-b 前置

- **可关闭**：Task0 A–D + 官方 REPL 三路；P3-a **单 drone** 核心/渲染行为、UI/HUD、五视口、确认前不开火、echo 独立 HP/伤害、echo 关闭 C2 不变。
- **不可关闭**：P3-a 整体（P3a-1/2/3）；非 drone 敌人 nearest-actor、Headless echo targets、Rendered↔Headless echo 字节一致性、checkpoint echo 策略状态。
- **P3-b 前置**：先修 P3a-1/2/3 并补 Rendered↔Headless echo canonical parity；P3-b 的 LLM Companion、Signal/能量**明确未实现**（docs/UI 显式 UNSUPPORTED）；本阶段 ECHO 是**本地确定性策略，不是 LLM**，HUD/面板不显示假外部连接；无完整 Run/Signal/ECHO 外部验收。

## 五、报告目录

`reports/ai-native-02/reviewer/p3a/`：`REVIEW.md`、`gate-typecheck.log`、`gate-unit-echo.log`、`gate-unit-core.log`、`gate-console-smoke.log`、`gate-p3a-parity.log`、`gate-e2e-p3a.log`、`gate-c2-*.log`、`gate-probe-task0-acl.log`、`gate-probe-echo-gap.log`、`probe-task0-acl.mts`、`probe-echo-gap.mts`、`tree.ls`、`pw-out-p3a/`。

未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash。
