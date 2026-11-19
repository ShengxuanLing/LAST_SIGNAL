# Task C 现场问题核查与最小修复（FIX-REPORT）

- 冻结现场：`363eb173207bb5adaa0a21cd1af348dc92f29827`（Lead 的真实 Signal 回合）
- 修复提交：`246469b`（parent `363eb17`，只改产品缺陷 + 回归测试；未 merge/push/stash/rebase）
- 原始证据目录 `reports/ai-native-02/lead-signal-model-live/` **未改动、未重写**（文件时间戳仍为 Lead 运行时刻）
- 运行辅助的夹具修复放在**新目录** `reports/ai-native-02/lead-signal-model-live-fix/`（含自己的 `_smoke/` 演练，不覆盖原目录）
- 现场 session：`ses_6ee91464af86451d0b0aa089`

---

## 0. 结论速览（分类）

| # | 现场现象 | 根因 | 分类 | 处置 |
|---|---|---|---|---|
| 1 | 清敌后 MCP 观察仍含 3 个 `hunter`（hp 59） | 旧辅助只 `sprite.destroy()+enemies=[]`，没动 canonical `sim.targets` | **夹具缺陷**（不是产品） | 新目录的辅助同时清渲染层与 canonical（`_sim.targets/drones`），并自检 `echoView().targets===0`；产品侧另有“真实死亡不留残留”回归 `targetRemoval.test.ts` |
| 2 | `memory` 把 `target_1_hunter` 标成 `kind=relay` | `recordMemory()` 把所有非 drone 目标硬编码成 `'relay'` | **产品缺陷** | 新增 `kind='target'`，保留 `'relay'` 给设备；旧测试里**把 bug 写成了期望**的那一行同步纠正 |
| 3 | 过门后 player(115,44) 但 echo(27.16,43.68)、观察仍是旧房 relay | `teleport-player` 只搬主角；ECHO 被留在旧房间（steering 无寻路，跨房间走不过去） | **产品缺陷** | 真实过门时**同一 tick**迁移 ECHO 到主角旁边可行走格，并发 `echo-moved`；同一 tick 清旧 assist/建议/记忆；调试/存档传送保持旧行为（负向控制） |
| 4 | tick273 `scanCD=18` 但 `availableActions.scan=true` | `companionAvailableActions()` 只看距离，完全不看能量/冷却；且**不把已感知的 relay 当合法 scan/jam 对象**（同一处缺陷的另一半：relay 就在 2 格外却报 `out_of_range`） | **产品缺陷** | 依据 observation 里的真实 `energy/cooldowns` 与 `relay` 计算：`cooldown` / `insufficient_energy` / `perceived_relay` |
| 5 | Vite 报 `World.ts` 重复 `case 'enemy-spawned'` | 第一处（`World.ts:1324`）已完整处理事件；第二处（`:1375`）调用 `spawnEnemyFromCore()`，是**不可达的死分支**（该函数仅此一处引用） | **非缺陷（死代码告警）** | 按“先定界勿顺手大重构”**未改动**；生产 spawn 走 1324，所有运行都真实生成了敌人（本次 3 个 hunter）可证 |

---

## 1. 问题 1 — 清敌夹具残留（夹具，不是产品）

**问题**：“清敌后仍含 3 个 hunter，究竟是夹具残留还是正常死亡也有残留？”

**证据**（原目录 `tool-io.jsonl` round1/3/5/6）：`targets` 恒为 3 个 `hunter`，hp 59 不变，即使玩家离开该房间。

**代码事实**：
- 正常死亡：`core.ts` 每 tick 末尾 `state.targets = state.targets.filter(t => t.hp > 0)`（`stepProjectiles`），并先发 `enemy-died` → 渲染层清理精灵。**正常死亡不留残留。**
- 旧夹具：只删渲染对象与 `world.enemies`，`_sim.targets` 里三个 hunter 仍 `hp=59` 活着，所以观察继续上报它们。

**修复**：新目录 `lead-signal-model-live-fix/owner-bootstrap.mts` 的清敌夹具改为**渲染层 + canonical 同时清**，并当场断言一致：

```
[boot] cleared hostiles consistently (targets 3->0, drones 0->0)
```

同目录 `_smoke/tool-io.jsonl` round1 实测：`targets: []`、`memory` 只剩 `relay_main`。

**产品回归**：`src/world/sim/targetRemoval.test.ts`
- `a dead target is removed from state.targets by the next core tick`（真实死亡 → 无残留）
- `a LIVE target is NOT removed — so renderer-only clearing leaves a phantom threat`（正是旧夹具的状态，作为对照）

> 备注：`World.sim` 是冻结深拷贝快照，`World.simFixture` 才是活体；辅助脚本里必须写 `_sim`。这一点已在修复版脚本里注释说明，避免下一个夹具再写错对象。

---

## 2. 问题 2 — memory 把 target 说成 relay（产品缺陷）

**证据**（原目录 round1）：`memory: [{kind:'relay', id:'target_1_hunter', …}, …, {kind:'relay', id:'relay_main'}]`。

**根因**：`companionFacet.recordMemory()` 里
`this.memoryValue.push({ tick, kind: 'relay', id: \`target_${target.id}_${target.kind}\` … })`。

**修复**：`CompanionMemoryEntry['kind']` 扩展为 `'drone' | 'relay' | 'target'`，非 drone 目标记 `kind:'target'`。旧测试 `companionFacet.test.ts:79` 原本断言 `kind==='relay' && id.startsWith('target_')`（把 bug 写成期望），本次一并纠正为 `'target'`。

**回归**：`src/ai-native/companionInsights.test.ts`
- `a cropped target is remembered as a target, never as a relay`（并断言 relay 条目恰好 1 条 = 设备本身）

---

## 3. 问题 3 — 过门后 ECHO 没跟过去（产品缺陷）

**现场证据**（原目录 round6，tick 273）：`player (115,44)`、`echo (27.165…,43.688…)`、`relay room3 (25,46)` 仍在观察里。
**先排除了辅助脚本丢命令**：`owner-ui.jsonl` 的 `_owner_enter_portal` 结果里 `roomBefore=3`、`roomAfter=5`，tick 前进到 273，`player.reset(portal)`→真实 `requestInteract()`→真实帧；命令没有丢，是**产品没搬 echo**。

**根因**：`core.ts` 的 `teleport-player` 只恢复主角坐标；`World.tryInteract()` 也只 `enqueueTeleport(landing)`。ECHO 的 follow AI 只有 steering，跨房间（room3 在 x≈25，room5 在 x≈115）根本走不过去，于是被永久留在旧房间。

**修复（同一 tick，最小面）**：
1. `teleport-player` 增加显式可选字段 `migrateEcho?: boolean`：为真且存在活着的 echo 时，用 `ensureWalkableFromState` 找到主角旁可行走格，**在同一 tick** 落位并发 `echo-moved`；不动 HP/能量/信号。
2. `World.enqueueTeleport(x, y, healToFull, migrateEcho=false)`；**只有真实过门**（`tryInteract`）传 `true`。调试/存档恢复/`Player.reset` 一律保持旧行为（存档恢复随后会用 checkpoint 里的 echo 覆盖，语义不变）。
3. 过门开始时同时清过期授权：`echoController.clearForRoomTransition()`（新方法：清 assist、pending suggestion、旧房记忆，保留玩家选择的移动模式）+ `pendingCompanionIntent = null`。

**红→绿**（日志里两条都有）：
- `src/world/sim/echoRoomTransition.test.ts`：修复前 **RED**（`echo must NOT stay in the old room` 失败）；修复后 GREEN。
- 同一文件内**负向控制**：`NEGATIVE CONTROL: without the flag the echo is deliberately left in place` —— 证明迁移不是“随便一个 tick 都会动”。
- 确定性：同状态 + 同命令 → `canonicalSimulationState` 完全相等。
- 渲染层真实普通传送门路径：`tests/echo-portal-migration.spec.ts`（2/2 PASS）
  - 正例：真实 `requestInteract()` → 房间号变化 → echo 落在**新房间**内、距主角 <3.5、`echoAssistArmed=false`、旧房记忆不残留；
  - 负向控制：`setEchoMode('hold')` + 不带 flag 的真实 `teleport-player` → echo 原地不动（玩家确实移动了）。

**说明（诚实标注）**：渲染层 spec 与修复同批落地，它的“红”由同文件的负向控制 + core 测试的 RED 日志承担；core 测试才是红→绿的直接证据。

---

## 4. 问题 4 — `availableActions` 与真实能量/冷却/relay 不一致（产品缺陷）

**现场证据**：round7 `scanTicks: 18`，但 `availableActions` 里 `{kind:'scan', available:true, reason:'perceived_target'}`。

**根因**：`companionAvailableActions()` 只对 `drones+targets` 算最近距离，完全不看 `energy/cooldowns`；而且**不把已感知的 relay 当作 scan/jam 对象**——同一函数导致修复演练时 relay 就在 2 格外却报 `out_of_range`。

**修复**：
- 距离判定：hostile（drones+targets）或 **perceived relay** 均在范围内即可；
- 可用性：`cooldowns.scanTicks>0` → `cooldown`；`energy < SCAN_COST` → `insufficient_energy`；两者都满足才 `available:true`；jam 同理（`JAM_COST`、严格 <6）；
- reason：仅 relay 在范围内时用 `perceived_relay`；
- 旧 observation 没有 `energy/cooldowns` 时保持旧的“只看距离”行为（向后兼容）。

**实测（修复版演练 `/status`）**：
```
scan {available: true,  reason: "perceived_relay"}, jam {available: true, reason: "in_jam_range"}
```
（修复前同一场景是 `out_of_range`；现场 tick273 那种 `scanCD=18` 现在是 `cooldown`。）

**回归**：`companionInsights.test.ts` 8 条（cooldown / insufficient_energy / 恢复可用 / jam 自身 CD 与能量 / relay 合法 / relay 在 CD / 旧 payload 兼容）。

---

## 5. 问题 5 — Vite 重复 `case 'enemy-spawned'`（死代码，非缺陷）

- `World.ts:1324` 的 `case 'enemy-spawned'` 内联创建 Enemy 并 `attachExistingSimDrone/Target`，`break`；
- `World.ts:1375` 的第二个 `case 'enemy-spawned'` 调用 `spawnEnemyFromCore()`，而该函数**只在死分支里被引用**（全文件引用数 2 = 定义 + 死调用），因此不可达；
- 生产影响：**无**。事件只走 1324；Lead 本次房间真实生成了 3 个 hunter，历史 `worldHeadless` / combat 测试也都真实生成敌人。
- 处置：按“先定界勿顺手大重构”**未修改**，仅记录；需要清理应作为独立小提交（先补一条“spawn 事件只被消费一次”的回归）。

---

## 6. 门禁（一行一条：PASS/FAIL + 命令 + 结果 + 日志绝对路径）

| # | 门 | 命令 | 结果 | 日志 |
|---|---|---|---|---|
| 1 | 红（修复前） | `npx vitest run src/world/sim/echoRoomTransition.test.ts src/ai-native/companionInsights.test.ts` | FAIL（预期）5 failed / 5 passed：echo 未迁移、memory kind、availableActions 3 条 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\RED-before-fix.log`（sha256 `705bfdcf…7540`） |
| 2 | 绿（修复后） | 同上 + `companionFacet.test.ts` | PASS 33/33 | `…\signal-fix\GREEN-after-fix.log` |
| 3 | 绿（含 relay 合法性与残留守卫） | 上述 4 个文件 | PASS 37/37 | `…\signal-fix\GREEN-after-fix-2.log` |
| 4 | 类型检查 | `npx tsc --noEmit` | PASS（exit 0，无输出） | `…\signal-fix\tsc-2.log`（0 字节 = 真实无输出） |
| 5 | 定向单测（sim + ai-native） | `npx vitest run src/world/sim src/ai-native` | PASS 623/623，52 文件 | `…\signal-fix\regression-sim-and-ai-native.log` |
| 6 | 全量单测 | `npx vitest run` | PASS **727/727**，62 文件 | `…\signal-fix\full-suite.log`（sha256 `1f80fc87…faed`） |
| 7 | Rendered↔Headless parity 硬门禁 | `npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts` | PASS 3/3 | `…\signal-fix\parity-gate.log` |
| 8 | 渲染层 Signal 套件 | `npx playwright test tests/signal-coop-e2e.spec.ts tests/signal-rendered-parity.spec.ts tests/signal-sdk-negative.spec.ts tests/echo-portal-migration.spec.ts --project chromium` | PASS 5/5（18.5s） | `…\signal-fix\playwright-signal-suite.log` |
| 9 | 新传送门 spec（单独） | `npx playwright test tests/echo-portal-migration.spec.ts --project chromium` | PASS 2/2（9.9s） | `…\signal-fix\playwright-echo-portal.log` |
| 10 | 残留守卫单测 | `npx vitest run src/world/sim/targetRemoval.test.ts` | PASS 2/2 | `…\signal-fix\target-removal.log` |
| 11 | 客户端构建 | `npx vite build` | PASS（30.10s） | `…\signal-fix\vite-build.log` |
| 12 | MCP 构建（companion facet 变更必须重建） | `npm run game:mcp:build` | PASS（1.00s） | `…\signal-fix\mcp-build.log` |

## 7. 修复版运行辅助演练（新目录，未覆盖原目录）

目录：`reports/ai-native-02/lead-signal-model-live-fix/`（脚本 `owner-bootstrap.mts` / `signal-agent-adapter.mts` 为原版副本 + 上述夹具修复；证据在其 `_smoke/`）。

真实 UI 链路跑通（自有 5301/5302，真 bridge，真 masked 表单授权）：

```
[boot] cleared hostiles consistently (targets 3->0, drones 0->0)
[boot] echo perceives relay = true
[boot] committed observation proof: lastObservationTick=171 status=connected
OBSERVE tick 171 targets [] drones [] relay {id:"relay_main",state:"INACTIVE"} memory [{kind:"relay",id:"relay_main"}]
STATUS available [{scan,true,perceived_relay},{jam,true,in_jam_range}]
```

`_shutdown` 只清本次自有进程：5301/5302 无监听、三份私有凭据文件已删（`_smoke/shutdown.json`）。

---

## 8. NOT RUN / 限制

- **NOT RUN**：真人（非自动点击）Owner CONFIRM 验收；本次修复不改变这一点。
- **NOT RUN**：模型本轮未建议 `jam`，因此 `jam` 的真实模型行为仍无现场证据（只有自动化测试与本次 status 可用性修复）。
- **NOT RUN**：死代码 `spawnEnemyFromCore` 的删除/清理（按 Lead 指令先定界）。
- **未改**：Lead 的原始目录与 363eb17 实跑报告（`REPORT-LEAD.md`、`tool-io.jsonl`、`owner-ui.jsonl`、截图、录像）**一字未动**。
- 修复提交只含产品代码 + 回归测试；`reports/**` 全部 untracked，不进冻结快照。
