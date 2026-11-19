# C3-b 动作/竞态/观察/Agent 租约 + 游戏内表单 — 独立重验（冻结 8b9705d）

- **被测**：`8b9705d6bce1894b08717c0180e127f26de8e2f5`（父 `21c3995fa1088fef51119fe73da9879102c268d8`），分支 `feat/ai-native-world-integration`
- **冻结**：`git archive 8b9705d` → `D:/Project/AI-NATIVE-02-snapshots/8b9705d`（`node_modules` junction），关键文件 MD5 见 `00-frozen-hashes.log`；未读共享 WIP / 未读 stash，未改源码/测试/配置/分支
  - 复核结束时活仓库 HEAD 已推进到 `da7c169`，并出现新的未跟踪 headless 文件；**本轮未读取/未使用**，结论只对 `8b9705d` 快照负责。
- **端口**：dev 5301、prod 静态 5302、test 静态 5303、staging 静态 5304、bridge 8891/8892/8893（全部自启自停，收尾已确认 free）
- **凭据**：bridge 在系统临时目录生成随机 token（`%TEMP%/last-signal-c3b-*/bridge.token`），仅当前 Windows SID 有权限（`icacls` 输出 `S\Rafae:(F)`，继承已移除；**不假称 chmod 有效**）；token 只在 `Authorization` 头/内存使用，日志/参数/URL/截图 0 命中。
- **结论：上一轮 3 个阻断全部关闭；本轮范围内 C3-b 修复验收 PASS。** 仍**未跑真实 LLM/Agent**（见 §8），不能据此宣称“外部 Agent 正式接入/真人战斗”。

## 1. 质量门（命令 → 结果 → 日志）

| 项 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| typecheck | `npx tsc --noEmit`（快照） | PASS exit=0 | `01-typecheck.log` |
| unit | `npm test`（快照） | PASS **33 files / 485 tests**（开发者称 497，见 §7） | `02-unit.log` |
| 生产构建 | `npx vite build` | PASS | `03-prod-build.log` |
| 测试构建 | `npx vite build --mode test` | PASS | `03b-test-build.log` |
| staging 构建 | `npx vite build --mode staging` | PASS | `03c-staging-build.log` |
| MCP 构建 | `npx vite build --config vite.mcp.config.ts` | PASS；`worldMcpServer.mjs` 0 core 符号 | `03d-mcp-build.log` |
| F-03 门禁 | Playwright 真浏览器 | PASS：**prod/staging 无 `__game`；test/dev 有** | `04-build-gate.log`、`build-gate.json` |
| StationZero 默认 MCP | 官方 SDK client 连 `dist-mcp/mcpServer.mjs`（无 `--world`） | PASS 6 Player 工具；production session create/observe OK | `12-stationzero-default.log` |
| C3b E2E | `PORT=5301 npx playwright test tests/c3b-external-link.spec.ts tests/c3b-link-form.spec.ts --repeat-each=3` | PASS **33/33** | `09-c3b-e2e-repeat3.log` |
| P1 五视口 | `PORT=5301 … tests/ai-native-world.spec.ts` | 8/9；1 个已知偶发（见 §7），单测复跑 PASS | `10-p1-5viewport.log`、`10b-p1-rerun.log` |
| C2 回归 | resume-no-step 3 + economy storage 重试 1 | PASS 4/4 | `11-resume-storage.log` |
| 隐藏弹丸负向 | `npx vite-node probe-crop.mts` | PASS：60 格外敌弹丸被裁掉，近处保留 | `08-crop-negative.log` |
| 生产构建真实表单 + MCP | 真浏览器(5302) + 表单授权 + 官方 MCP SDK | PASS 10/10（含真实位移） | `06-form-prod.log`、`form-prod.json`、`evidence-form-prod/`（录屏） |
| 动作效果/生命周期 | 真浏览器(5303) + 表单 + MCP | PASS **26/26** | `07-effects.log`、`effects.json`、`evidence-effects/`（录屏+连拍） |

## 2. 真实效果（不是看 receipt=applied）

来自 `effects.json`（test 构建；所有动作经官方 MCP stdio server + bridge）：

| 项 | 实测 |
| --- | --- |
| `move ticks=1` | `executedTicks=1`、`startedTick=340→completed 341`；真实位移 **0.081023** 格（agent 观察与引擎一致） |
| `move ticks=120` | `executedTicks=120`、`startedTick=371→completed 491`；真实位移 **6.238744** 格（合法碰撞截断，仍为 1-tick 的 ~77 倍） |
| `fire ticks=120`（安全房） | `executedTicks=120`；最多 **4** 发弹丸；**19** 个采样帧 `fireTimer>0`（真实冷却）；pulse 弹药 `-1`（无限，非扣减型） |
| `fire` 真伤害 | 猎手 HP **59 → 35.296**（同一次真实战斗；HUD `DMG 24`，见 `02-combat.png`） |
| `interact` 真转场 | room **0 → 3**，receipt `applied`，`executedTicks=1`（玩家在传送门的布置为已披露测试布置） |
| HUD | `EXTERNAL AGENT CONNECTED · LAST aid_… @1237`、`CONTROL EXTERNAL`（截图 `evidence-effects/02-combat.png`） |

## 3. 竞态（afterFrame await 窗口内接管）×3

- 用真实 controller/client，在 `pushObservation` 的 await 窗口内 `degrade('takeover')`，并强制心跳分支；连续 3 次：
  - **0 次异常**（上一版 3/3 `heartbeat` null 已消失），页面 0 pageerror；
  - 每次 queued action 结果 `cancelled`、owner `human`、link `YIELDED`、`pendingCount=0`；
  - **取消生效后位移 0**；取消前 0.162/0/0 格属于接管落地前已开始执行的帧，不是取消后继续。

## 4. 硬断线（SIGKILL agent 进程）

- 提交 120-tick move 后 `SIGKILL` MCP 子进程：
  - **4.856s** 内 → owner `HUMAN`、link **`LOST`**、`pendingCount=0`（≤15s 要求满足）；
  - **检测后 800ms 位移 = 0**（旧动作不继续）；
  - 新 MCP 进程 `world_list_sessions` → **不 attached**（死会话不再骗 attached）；
  - 人类在游戏内表单重新授权 → **新 session**，agent 重新 attach 并拿到真实 observation。

## 5. 游戏内表单（生产构建，无 `__game`）

- 真浏览器打开 prod 产物：`NEW RUN → ESC → SETTINGS → EXTERNAL LINK SETUP` 出现原生 DOM 表单（`data-testid=external-link-form`）。
- token 输入 `type=password`（截图 `02-form-empty.png` 无凭据、`03-form-token-masked.png` 仅掩码点）；提交后 **token 立即从 DOM 清除**（断言页面 HTML 不含 token），表单关闭，HUD/设置页显示 `EXTERNAL AGENT CONNECTED`（`04-connected.png`、`05-hud-connected.png`）。
- 随后官方 MCP SDK client 成功 `world_list_sessions → world_observe → world_action(move)`，观察到位移（`06-form-prod.log`、录屏）。**不再需要 console 注入配置**。

## 6. 观察裁剪（负向）

`buildExternalObservation`（纯函数）负向测试：玩家 (8,45)、`perceivedActors=[]`、感知半径 12，
- 60 格外敌弹丸 **被排除**（`farIncluded=false`），1 格内玩家弹丸保留（`nearIncluded=true`），无 seed/map/rng 键（`08-crop-negative.log`）。

## 7. 回归与已知问题

| 项 | 结果 |
| --- | --- |
| C3b E2E（含新 link-form spec） | repeat 3 × 全部 **33/33 PASS**（上一版同用例我 6/6、Reviewer 3/3 挂的时序问题未再现） |
| P1 五视口 | 8/9；`ai-native-world:257` 失败于 `LevelUpScene` 期望、收到 `GameOverScene`（随机死亡时序的**已知偶发**，与本修复无关）；单测复跑 PASS。已查看 `hud-ai-800x600.png`：HUD 完整可读 |
| 五视口 | `evidence-p1-5v/hud-ai-{1920x1080,1366x768,1280x720,1024x768,800x600}.png` |
| C2 resume/storage | 4/4 PASS（C2 维持放行） |
| unit 数量差异 | 我实测 **485**（33 files），开发者报告 497；差 12，未改变 PASS/FAIL，但建议开发者核对计数口径 |
| **新发现（非本轮 3 阻断）** | 浏览器崩溃/刷新后，bridge 会保留 `lost` 会话，`/world-link/handshake` 对非 `closed` 状态返回 409 `duplicate_handshake`；在同一 bridge 上重新授权会一直 FAILED，直到重启 bridge（我第一次表单跑就复现，重启后 PASS）。建议修复：`lost` 会话应可被人类重新授权替换/回收 |
| 探针清理 | effects 探针在全部 26 检查完成后进程未自行退出（EXIT=124 超时）；证据 JSON/截图/录屏已完整写入，属探针清理问题，非产品缺陷 |

## 8. 真实 LLM / Agent 实跑结论

- **尚未跑真实 LLM**。本轮由脚本化官方 MCP SDK client 驱动（observe → action → 真实提交），不是 LLM 决策，也不是真人战斗。
- 就接口与安全边界而言，**具备真实 LLM 实跑的前置条件**：游戏内表单可配置、人类显式授权、官方 `--world` MCP（4 工具、无 core）、真实 tick 时长/效果、观察裁剪、接管/断线租约、死会话不 attached、重新授权新 session。
- 建议下一步：由真实 LLM/官方 MCP 客户端经同一表单授权跑一条合法路线，保留原始 tool I/O 与录屏，再判定“外部 Agent 正式接入”。

## 9. 判定

| 项 | 判定 |
| --- | --- |
| 阻断 1 `ticks` | **关闭**（1/120 执行 tick 数与位移均不同，非只看 receipt） |
| 阻断 2 async race | **关闭**（await 窗口接管 3/3 无异常、cancelled、pending 0、取消后不继续） |
| 阻断 3 弹丸泄漏 | **关闭**（负向裁剪通过） |
| Agent 租约/硬断线 | **PASS**（4.9s LOST/HUMAN、pending 0、无旧动作继续、死列表不 attached、新授权新 session） |
| 游戏内表单 | **PASS**（prod 无 `__game` 下真实表单 → 授权 → MCP） |
| F-03 | **PASS**（prod/staging 无句柄，test/dev 保留） |
| 回归 | C3b 33/33、C2 4/4、StationZero 默认兼容；P1 1 个已知偶发 |
| **C3-b 本轮** | **PASS（限 8b9705d 冻结范围）**；新发现“lost 会话导致 409 无法重新授权”建议同轮修复；真实 LLM 实跑仍未做 |

## 10. 复现

```bash
cd D:/Project/AI-NATIVE-02-snapshots/8b9705d
npx tsc --noEmit && npm test
npx vite build && npx vite build --mode test && npx vite build --mode staging
npx vite build --config vite.mcp.config.ts
npx vite-node probe-crop.mts
# dev 5301 / static 5302-5304；bridge 8891-8893；scripts/c3b-bridge.mts 打印 TOKEN_FILE/ACL
node .../probe-form-prod.mjs   # 生产构建真实表单 + MCP
node .../probe-effects.mjs     # 效果/竞态/租约
PORT=5301 npx playwright test tests/c3b-external-link.spec.ts tests/c3b-link-form.spec.ts --repeat-each=3
PORT=5301 npx playwright test tests/ai-native-world.spec.ts
```

## 11. 报告文件

`reports/ai-native-02/tester/c3b-fixes-final/`：`00-frozen-hashes.log`、`01–04`、`05*` bridge、`06` 生产表单链路、`07` 效果/竞态/租约、`08` 裁剪负向、`09` C3b E2E、`10*` P1、`11` C2、`12` StationZero、`form-prod.json`、`effects.json`、`build-gate.json`、`probe-*.mjs`、`evidence-form-prod/`、`evidence-effects/`、`evidence-p1-5v/`（均含录屏/连拍）。
