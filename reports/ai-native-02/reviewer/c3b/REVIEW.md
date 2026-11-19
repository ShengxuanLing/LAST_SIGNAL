# C3-b 真实 Rendered MCP 接线 独立验收（8ec8758）

- **被测提交**：`8ec87587b0b4dba3146016e53bd6592ccb41be96`（HEAD），父 `a25f140`（dirty 小补丁），祖父 `780cece`
- **分支**：`feat/ai-native-world-integration`；未读/不恢复 stash `@{0}`/`@{1}`；无源码 WIP
- **复核方式**：`git archive` 冻结精确 hash 快照 `D:/Project/lastsignal-c3b-review-8ec8758`（`node_modules` junction）；`git hash-object` 全量比对 → `ALL_TRACKED_FILES_MATCH`（1671/1671）
- **凭据安全**：bridge token 由 `randomBytes` 临时生成/由 `scripts/c3b-bridge.mts` 写入 `0600` 文件；本轮探针只在进程内使用假 token，未打印、未入日志/截图/进程参数
- **结论：C3-b 不能独立接受。** 授权/来源/会话绑定、MCP 无 SimulationState、真实动作效果、观察裁剪（敌人/Boss/传送门）、dirty 补丁等已通过；但存在 3 个阻断（`ticks` 被忽略、开发者集成 E2E 非稳定绿且含 async race、projectiles 未做感知裁剪）及若干限制。C2 维持已放行；C3-b 未闭环。

## 一、质量门一行结果（命令 → 结果 → 日志）

| 门 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | PASS exit=0 | `gate-typecheck.log` |
| 定向 unit（externalLink/bridge/control） | `npx vitest run src/ai-native/externalLink.test.ts src/ai-native/c3bBridge.test.ts src/ai-native/c3bControl.test.ts` | PASS 25/25 | `gate-unit-c3b.log` |
| F-03 生产 `__game` 门禁 | `npx vite-node scripts/c3b-f03-gate.mts` | PASS production_no_game_handle / test_mode_keeps_game_handle | `gate-f03.log` |
| MCP 构建 | `npm run game:mcp:build` | PASS | `gate-mcp-build.log` |
| 官方 WORLD MCP smoke | `npx vite-node src/ai-native/worldMcpSmoke.mts` | PASS 7/7（4 tools，隔离） | `gate-mcp-smoke.log` |
| MCP bundle 无 core | `grep createSimulationState/stepSimulationTicks/Phaser dist-mcp/worldMcpServer.mjs` | 0 命中 | 见报告 |
| 独立 auth/origin 探针（raw HTTP） | `npx vite-node reviewer-probe-c3b-auth.mts` | PASS 15/15 | `gate-probe-auth.log` |
| 独立动作效果探针（真实渲染 loop） | `npx vite-node reviewer-probe-c3b-effects.mts` | MOVE/AIM/FIRE PASS；**ticks FAIL** | `gate-probe-effects*.log` |
| 独立 dirty 补丁探针 | `node probe-dirty.mjs` | PASS（失败后 dirty=true） | `gate-probe-dirty.log` |
| 开发者集成 E2E | `PORT=5403 npx playwright test c3b-external-link.spec.ts` | **FAIL**（1 次 heartbeat null；repeat 3/3 receipt=none） | `gate-e2e-c3b.log`、`gate-e2e-c3b-repeat.log` |

## 二、已关闭 / 已验证

| 项 | 结论 | 依据 |
|---|---|---|
| 人类授权才能建会话 | **PASS** | handshake 需 `authorized:true`+token+精确 Origin；`authorized:false`→403，无 token→401，错 Origin→403（auth 探针 1–3） |
| agent 不能自授权 | **PASS** | 无人类会话前 attach→403；无 token attach→401（探针 4–5） |
| 人类会话后 agent 仅 join 同会话 | **PASS** | attach 返回同一 session/epoch（探针 7）；错 Origin attach→403（探针 8） |
| 跨 Origin / 会话 origin 绑定 | **PASS** | 渲染侧 observation/close 非本会话 Origin→403；agent 路由带非允许 Origin→403；会话 epoch 错→409（探针 9/11/13） |
| 断线/关闭不能续输入 | **PASS** | agent-disconnect→200 control=human；关闭后 re-attach→403/404（探针 14–15）；unit/yield 覆盖 |
| MCP 只桥、无 SimulationState | **PASS** | `worldMcpTools.ts` 仅 import MCP SDK/zod/WorldClient/worldProtocol；bundle 0 core/Phaser 符号；smoke 4 tools 与 Station Zero 隔离 |
| 外部输入是合法 PlayerIntent | **PASS** | `sampleIntent` owner=external → `takeExternalIntent()`；无直接坐标/HP/Scene 写入 |
| 真实动作效果（move/aim/fire） | **PASS** | 独立探针：move 后 x 增大；aim 后 aimYaw 改变；fire 后 projectile 增加/fireTimer>0 |
| 观察裁剪（敌人/Boss/传送门）+ 无 seed/map/rng | **PASS（部分）** | `buildWorldObservation` 用 `isPerceivable` 裁剪敌人/Boss/portal 并丢弃 targetRoom；探针 observation 无 seed/map/rng 键 |
| 网关去重/幂等/TTL | **PASS** | 已淘汰 id 墓碑 `E_RETRY_AFTER_EVICTION`；`appliedTick ∈ [acceptedTick, applyByTick]`；request/action 指纹不符 `E_ID_PAYLOAD_MISMATCH` |
| `__game` 生产门禁 | **PASS（生产）** | F-03：production build 无 `__game`，test-mode 保留 |
| 暂停/升级/背包/死亡/场景退出清理 | **PASS（代码+部分 E2E）** | `degrade('pause'/'level-up'/'inventory'/'death'/'scene-exit')` 均在对应路径；E2E 测试 2 通过（takeover/overlay/disconnect 不自动夺回） |
| dirty 小补丁（失败保留） | **PASS** | `a25f140` 将 `checkpointDirty=false` 移到成功写入之后；探针：失败后 `dirtyAfterFail=true`，恢复后保存一次 |
| AUTHORIZE UI 不被注入误触 | **PASS** | `__externalLinkConfig` 仅被 PauseScene 的 pointerdown 读取；注入本身不授权；CONNECTED 时再次点击返回 false，YIELDED/LOST 需新点击且新 session |

## 三、阻断（必须修复）

### 阻断 1：`ticks` 时长被完全忽略
- 协议/MCP schema 对 `move`/`fire` 强制 `ticks: int 1..MAX_ACTION_TICKS(120)`；但 `externalLinkController.intentFromExternalAction()` 只读 `type/dir/target`，**从不读 `ticks`**；`applyByTick` 来自批次 `ttlTicks`，与 `ticks` 无关。
- 独立探针（`gate-probe-effects*.log`）：同一 `dir` 下 `ticks:1` 与 `ticks:120` 的位移完全相同（`d1 = d120 = -0.05729166666666696`）。Agent 请求 120 tick 移动只得到一帧移动。
- 影响：外部 Agent 无法控制动作时长；与 schema/文档承诺不符。E2E 只断言 receipt=applied，未断言时长/距离，故未暴露。
- 修复条件：控制器按 `action.ticks` 维持意图 N 个 core tick（或在 gateway 侧按 ticks 计数并在 ACK 时校验），并加“ticks=1 vs ticks=120 位移显著不同”的测试。

### 阻断 2：开发者集成 E2E 非稳定绿 + `degrade()/afterFrame()` async race
- 独立跑 `tests/c3b-external-link.spec.ts`：
  - 首跑：test 1 失败，`pageerror: Cannot read properties of null (reading 'heartbeat')`（line 140 `expect(errors).toEqual([])`）。
  - `:20 --repeat-each=3`：**3/3 失败**，断言 “Wait for the REAL post-commit ACK” 得到 `receipt status = 'none'`（动作从未 applied）。
- 代码原因（已定位）：`ExternalLinkController.afterFrame()` 在 `await this.client.pushObservation(...)` 之后继续调用 `this.client.heartbeat()`；而 `degrade()`（human takeover/pause/…) 同步把 `this.client = null`。若 takeover 发生在 await 窗口内，随后 `this.client.heartbeat()` 解引用 null → 未捕获 TypeError，链接降级/动作丢失。3/3 receipt=none 与首跑 heartbeat null 均与该竞态一致（时序相关，非纯随机噪声）。
- 我的 `reviewer-probe-c3b-effects.mts` 在同一渲染 loop 下稳定 PASS（MOVE/AIM/FIRE），说明基础路径可用；但“takeover + 在途 afterFrame”路径不稳定。
- 修复条件：`afterFrame`/`beforeFrame` 在每次 `await` 后重新检查 `this.client`/`this.disposed`/epoch，或持有局部 client 引用并在 degrade 后中止；`degrade` 中先置中止标志再 null；补一条“动作进行中触发 takeover”的稳定回归测试。

### 阻断 3：Observation 的 projectiles 未做感知裁剪（隐藏状态泄漏）
- `ExternalLinkController.observation()` 中 `drones`/`targets` 按 `view.perceivedActors` 过滤，但 `projectiles: world.sim.projectiles.map(...)` **未过滤**，把核心中所有弹丸（含未感知房间/远处敌方弹丸）发给 Agent。
- 影响：Agent 可通过弹丸位置/速度推断未见区域的敌人/Boss 存在，违反“观察裁剪防隐藏状态”。
- 修复条件：projectiles 也按 `isPerceivable(p.pos.x,p.pos.y)`（或 owner 玩家可见性）过滤；加“未感知区域弹丸不出现在 observation”的测试。

## 四、限制 / 需 Lead 决策（非阻断但应记录）

1. **ACK 是“已投递到真实 tick”，非“效果已验证”**：`applied = world.sim.tick > issuedAtTick`；未校验 move 是否真的产生位移、fire 是否真的产生弹丸、interact 是否真的产生交互。E2E 注释称 “player moved” 但未断言位移。建议 ACK 增加效果断言或明确 ACK 语义为“intent delivered”。
2. **人类授权是渲染侧布尔**：bridge 仅校验 `authorized:true` + token + Origin，无法证明“人真的点了”。同源脚本（持 token）可绕过点击。属本地信任模型限制。
3. **token-only agent、无 per-agent actor 身份**：任何持 token 的本地进程都可 attach/act 于唯一 live 人类会话；actorId 为 session 内标识。无按 agent 的撤销/审计。
4. **`__game` 在任意 `mode !== 'production'` 暴露**：`vite.config.ts` 的 `__LAST_SIGNAL_DEV_TEST__ = mode !== 'production'`。生产构建已清理（F-03 PASS），但任何非 production 部署（staging/test）都会暴露整机 `__game`，可绕 Player 权限。部署必须强制 `mode=production`。
5. **未做真实 LLM / Headless 实跑**：开发者明确“未真实 LLM/Headless”；本轮 E2E/探针均为接口级。真实 LLM 实跑前置：用官方 `--world` MCP server + 真实 bridge/token，由真实 LLM/客户端经 observe→action→ack 完成一条合法路线（非 fixture/预写策略），并保留原始调用归档。

## 五、C3-b 判定与 C2 状态

- **C3-b：不能独立接受。** 阻断 1（ticks）、2（集成 E2E 非稳定 + async race）、3（projectiles 泄漏）需修复并补稳定回归；限制 1–5 需 Lead 明确接受/文档化。
- **C2：维持此前放行**（本提交未触碰 C2 行为；dirty 小补丁已验证）。
- **真实 LLM 实跑**：未提供，不能据此宣称“外部 Agent 正式接入完成”。修复阻断后，方可进入“真实 LLM/官方 MCP 客户端实跑 + 原始证据归档”的下一验收。

## 六、报告目录

`reports/ai-native-02/reviewer/c3b/`：`REVIEW.md`（本文）、`gate-typecheck.log`、`gate-unit-c3b.log`、`gate-f03.log`、`gate-mcp-build.log`、`gate-mcp-smoke.log`、`gate-probe-auth.log`、`gate-probe-effects*.log`、`gate-probe-dirty.log`、`gate-e2e-c3b.log`、`gate-e2e-c3b-repeat.log`、`gate-probe-race.log`、`probe-dirty.mjs`、`pw-out-c3b/`、`pw-out-c3b-repeat/`；独立探针源在快照根 `reviewer-probe-c3b-{auth,effects,race}.mts`。

所有运行均在冻结快照与独占端口（dev 5402/5403）上进行；token 为进程内随机假值；未修改生产源码/已有测试/配置；未切换共享分支、未合并/重置；未读取/恢复 stash。
