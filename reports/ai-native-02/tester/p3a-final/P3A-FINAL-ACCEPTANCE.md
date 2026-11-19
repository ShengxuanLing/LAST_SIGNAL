# P3-a ECHO 第二 Actor / Task0 Owner 文件 — 独立定向验收（冻结 b3930c5）

- **被测**：`b3930c5df4010b896ffac868da9f0d2e0d6695a5`（父 `c3e1461`；P3-a 链 `8b2de8e` → `c3e1461` → `b3930c5`，Task0 Owner 文件 `39a43b2`）
- **冻结**：`git archive b3930c5` → `D:/Project/AI-NATIVE-02-snapshots/b3930c5`（`node_modules` junction），MD5 见 `00-frozen-hashes.log`；未读共享 WIP / 未读 stash，未改源码/测试/配置/分支。
  - 复核结束时活仓库 HEAD 已到 `dd42239` 并有新 WIP（`echo.ts`、`worldHeadless.ts`、`Boss.ts` 等）；**本轮未读取/未使用**。
- **证据性质（重要）**：菜单与确认走真实游戏 UI；确定性遭遇使用 `World.spawnEnemy()` 生成真实敌人（**fixture 已声明**），视野分离用 `player.reset()` 布置（**fixture 已声明**）。ECHO 是**本地确定性策略 + 人类确认**，不是 LLM/Agent，也不代表完整 P3/P4；Signal/能量未实现。

## 1. 质量门（快照，按影响，不跑 70 全量）

| 项 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| typecheck | `npx tsc --noEmit` | PASS | `01-typecheck.log` |
| unit | `npm test` | 首跑 601/602（已知 `worldBridgeServer` 心跳 flaky：200 vs 409）；单文件 7/7、整跑复跑 **602/602 PASS** | `02-unit.log`、`02b`、`02c` |
| build | `npx vite build` | PASS | `03-build.log` |
| MCP build | `vite.mcp.config.ts` | PASS | `03b-mcp-build.log` |
| 官方 REPL 真实启动 | `npm run game:world:mcp-console -- --headless` + `create/observe/quit` | PASS：真子进程启动、`CONNECTED console mode=headless`、session/observation OK、exit 0 | `14-repl-command.log` |
| console smoke | `worldConsoleSmoke.mts` | PASS（Player/Dev/Rendered 三种启动） | `09-console-smoke.log` |
| Owner/ECHO 定向 unit | `c3cOwnerFile / echo / worldHeadlessEcho / runCheckpoint` | PASS 21/21 | `10-owner-echo-unit.log` |
| 20k stdio 最小回归 | `worldHeadless20kSmoke.mts` | PASS `eventTotal=101635 maxResponseBytes=147844 wallMs=23346` | `11-20k-smoke.log` |
| C3c parity 16 | spec（快照 cwd 重生）+ compare | PASS `finalTick=26 events=59 kills=1 currency=4 xp=8` | `12c`/`12d` |
| 开发者 ECHO parity | `scripts/p3a-echo-parity.mts` | PASS `P3A_ECHO_PARITY_PASS` | `13-dev-echo-parity.log` |
| Task0 Owner 文件独立探针 | `probe-task0.mjs` | PASS **7/7** | `15-task0.log`、`task0.json` |
| C2 resume/storage | 定向 4 用例 | PASS 4/4 | `18-resume-storage.log` |
| P1/P3a E2E | `ai-native-world.spec.ts` | **9/10**；`ai-native-world:257` 已知随机死亡 flaky（首跑 GameOverScene 替 PauseScene，复跑 GameScene 替 GameOverScene），本轮未追绿 | `17`、`17b` |

## 2. 真实浏览器 ECHO（独立 17/17）

- Pause → `ECHO COMPANION >` → `ENABLE ECHO` 真人菜单路径；初始无 echo，启用后得到独立坐标与独立 HP（100/100）。
- FOLLOW：主角移动后 ECHO 跟上，距离收敛到 standoff≈3 格；HOLD：ECHO 位移 <0.60 格；MOVE TO AIM 按钮可用（面板点击成功）。
- 自己的视野：`echoView()` 以 ECHO 为中心、12 格边界，看到近旁 drone；**边界说明**：start room 只有 9×11 格，主角−目标距离只有 10.58 格，因此**主角也能看到同一个 drone**，本场景无法构造 >12 格互斥视野；已验证 ECHO 的投影是自己的中心/有界，不冒充“只有 ECHO 看见”。
- 人类确认前：suggestion=fire，但等待真实 tick 后 `echoShotsFired` 不变、drone HP 不变（无自动开火）。
- 面板 `CONFIRM ASSIST FIRE` 后：ECHO 真实开火并击杀真实 drone（`drones=[]`，shots 增加），主角 HP 不变。
- 独立受伤：ECHO **86→78**，主角 **100→100**（`echo-hurt` 独立，不联动主角 HP）。
- ECHO 死亡：tick 1063 HP 0；之后 shots 不再增加（3→3），主角 HP 仍 >0；`ASSIST` 被撤销后不再开火。
- 连续截图 `evidence/01…07`（启用/FOLLOW/确认/击杀/受伤/死亡）；已实际查看 `05-echo-killed.png`：双实体 + `ECHO 86/100 · HOLD · ASSIST ARMED` + KILLS 2 / DMG 156。

## 3. 五视口与旧流程（13/13）

- 五视口（1920×1080 / 1366×768 / 1280×720 / 1024×768 / 800×600）：双 actor + `ECHO 100/100 · FOLLOW · ASSIST SAFE` 均可见；已实际查看 `evidence-viewports/hud-echo-800x600.png`，右列 8 行 HUD 不裁切/可读。
- 旧流程无旁路 tick：`onPause()/onResume()` tick 34→34→34；inventory 打开 tick 不变；portal 真实转场 room **0→3**，ECHO 同边界跟随，两个 `stepFrame` 只 +2 tick。
- 检查点：`captureCheckpoint()` 在非安全条件下按设计拒绝；echo 深拷贝/旧存档兼容由定向 unit 21/21 覆盖；死亡 restart/场景迁移由开发者 P1/P3a 定向用例（9/10，失败为已知 flaky）覆盖，本轮未重复构造。

## 4. 我自己补的 Rendered ↔ Headless ECHO 字节一致性（13/13）

- 导出真实渲染 World：初始 `SimulationState` 含 `echo`，真实 core drone（2 只），人类确认 ASSIST；逐 tick 记录**有序的 player intent 与 ECHO 实际使用的 echoIntent**（360 tick）。
- Headless 用 `HeadlessWorld.fromSimulationState(initial)` 重放同序列：
  - `canonicalState` **逐字节相等**、**全事件 canonical 逐字节相等**（105,098 bytes）、finalTick=401 相等；
  - 真事件含 `echo-fired / echo-moved / enemy-hit / enemy-died / echo-hurt / loot-dropped / loot-collected / xp-gained / currency-gained`；
  - ECHO HP 100→92（独立受伤），drone 全灭，主角 HP 100 不变，包含真 hit/kill/独立 echo-hurt，不只是 Node 两次同策略。
- **边界（如实记录）**：第一次尝试用 `hunter`（legacy `targets`）时，Rendered/Headless 在 tick 58 出现 target.x `11.0661` vs `11.1000` 分歧；hunter 等 `state.targets` 仍由渲染侧 legacy adapter 推进，不属于 core。改用**核心 drone** 后字节一致 PASS。故本 parity 适用范围是 core-managed actors（player/echo/drone/projectile/loot）；带 legacy targets 的旧路径不可宣称字节 parity。

## 5. Task0 Owner 文件 / 传输最小回归（7/7）

- frame 文件 ACL：仅当前 SID `(F)`，无 `(I)` 继承、无 BUILTIN\Users/Everyone。
- frames 下 junction 指向外部目录 → `E_PERMISSION`；合法 frame 文件 restore 正常。
- >16 MiB frame 文件在解析前被拒（`E_RESOURCE_LIMIT`/`E_PAYLOAD_TOO_LARGE`）。
- 完整 MCP envelope（text + structuredContent）有界；20k stdio 回归连接不断（101,635 events，max response 147,844B）。
- Player 面无 `dev_*`/file/ref 工具；Dev 面才有 owner 工具。

## 6. 判定与边界

| 项 | 判定 |
| --- | --- |
| P3-a ECHO 独立 actor / 菜单 / 跟随 / HOLD / MOVE / 自己的视野 | **PASS**（互斥视野样本受 start room 尺寸限制，见 §2） |
| 建议→人类确认→真实 HP/击杀；确认前不攻击 | **PASS** |
| ECHO 独立受伤 / 主角 HP 不联动 / 死后不继续开火 | **PASS** |
| 五视口双 actor/HUD、旧暂停/背包/portal/存档/死亡无旁路 tick | **PASS**（死亡 restart 用定向用例，未重复全量） |
| Rendered↔Headless ECHO canonical + 全 events 字节对照 | **PASS（core actors）**；legacy `targets` 路径有明确边界，见 §4 |
| Task0 ACL/junction/大文件/envelope/20k/REPL | **PASS** |
| type/unit/build/MCP/C3c parity/C2 回归 | PASS（unit 首跑 1 个已知 flake；复跑 602/602） |
| **P3-a 最小** | **可独立接受为「本地确定性 ECHO + 人类确认」** |
| **完整 P3 / P4 / AI-NATIVE-02 整体** | **不 PASS**：P3-b LLM Companion、Signal/能量、真实 LLM 实跑都未做；ECHO 是本地 fallback，不冒充外部 Agent；不声称全 Run |

## 7. 复现

```bash
cd D:/Project/AI-NATIVE-02-snapshots/b3930c5
npx tsc --noEmit && npm test
npx vite build && npx vite build --config vite.mcp.config.ts
printf 'create\nobserve\nquit\n' | npm run game:world:mcp-console -- --headless
npx vite-node src/ai-native/worldConsoleSmoke.mts
npx vite-node src/ai-native/worldHeadless20kSmoke.mts
node .../probe-echo-e2e.mjs                 # dev 5361
node .../probe-legacy-viewports.mjs
# parity: probe-echo-parity-export.mjs (browser) then probe-echo-parity-replay.mts (vite-node)
# Task0: node .../probe-task0.mjs ; 定向 unit ; C2 resume/storage
```

## 8. 文件

`reports/ai-native-02/tester/p3a-final/`：`00-frozen-hashes.log`、`01–03b` 门禁、`04` E2E 17/17 + `e2e.json`、`05–08` parity 导出/重放/差异/trace、`09–15` Task0/回归、`16` 五视口/旧流程、`17–18` 定向 E2E、`19-evidence-md5.log`、`parity/{initial,ticks,rendered,headless-compare}.json`、`evidence/`、`evidence-viewports/`、`probe-*.mjs/.mts`。
