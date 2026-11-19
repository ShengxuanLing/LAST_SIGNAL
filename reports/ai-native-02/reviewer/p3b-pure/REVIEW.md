# P3-b 前置「纯共享规则 / 确认契约」定向独立验收（ab59fe6）

- **被测提交**：`ab59fe6f346705df5570c4fad5f8dba5b672e718`（HEAD，分支 `feat/ai-native-world-integration`）
- **链**：`212cd56`(P3a 放行) → `77c9294`(Task0 echo factory 钉死) → `c0cfdb6`(Signal 共享纯规则 + 旧 slice 同函数) → `ab59fe6`(Owner capability / decision ledger / snapshot 契约)
- **哈希解析**：`ab59fe6=ab59fe6f…e718`、`c0cfdb6=c0cfdb687…2370`、`77c9294=77c9294927…a37fc2`；ab59fe6 父 = c0cfdb6，c0cfdb6 父 = 77c9294。
- **冻结**：`git -c core.autocrlf=false -c core.eol=lf archive ab59fe6 | tar -x -C D:/Project/lastsignal-p3b-pure-review-ab59fe6`；`node_modules` junction；Python 逐文件 git blob SHA1 → **ALL_TRACKED_FILES_MATCH（1969/1969, MISMATCH=0, MISSING=0）**
- **边界**：未改生产源码/已有测试/配置/分支；未 merge/reset；未读/恢复共享 WIP/stash；未起 dev server / 未占用他人端口。只做定向 unit + 独立负向，未重跑无关全量。
- **结论**：**纯模块契约整体 PASS，可以进入接线阶段；但纯模块本身不是安全边界，不能当完整 P3-b**。当前 World/LLM/Signal 全未接线，`world_signal_status` 仍 `E_NOT_APPLICABLE`。发现 **1 个接线前必须处理的阻断（公开 factory 可被任意 import 铸造 Owner 凭据）** + 若干接线注意（见 §5），不掩盖。

## 1. Task0 `77c9294` — Echo 合法 factory + 运行 HP/timers 边界

| 检查项 | 结果 | 证据 |
|---|---|---|
| 不可升级字段精确等于 `echoPlayerData()`（非绝对上限） | **PASS** | `RunCheckpoint.ts` 从 `core.ts` 导入 `echoPlayerData()/ECHO_ACTOR_ID`；`ECHO_EXACT_BASE_KEYS` 18 项逐字段 `!==` 拒绝。探针 18/18 tamper 全拒 |
| 上轮我提出的 10 类「绝对上限内注入」全部关闭 | **PASS** | `damage=99 / hpRegen=50 / cooldownReduced=1 / critDamage=99 / pierceCount=10 / speed=1000 / armor=1000 / pickupRange=1000 / xpGain=100 / maxHp=10000` 以及 `hp=10000 / xp=100 / currency=100 / level=2` 全 `validateCheckpoint=false` |
| 运行态 HP / 朝向 / 坐标 / 计时器不误拒 | **PASS** | `hp=1 / dead hp=0 / full hp=100`、`data.aimYaw=-2.5`、`x=12.25 / y=-3.5`、`aimYaw=-1.2`、invuln/hurt/fire/dash/reloadTimer 全部合法通过；`resolvePlayerHit` 真把 HP clamp 到 ≥0 |
| 旧档 / 原 checkpoint 不误拒 | **PASS** | 无 echo 旧档合法；玩家自身合法升级（level7 / scatter lvl3 / power lvl2 / ability）不误拒；`cloneCheckpoint` 往返仍合法 |
| 结构 / 有限数 / 身份负向 | **PASS** | hp<0 / hp>maxHp / maxHp=0 / NaN / Infinity / 坐标越界 / actorId≠1 / 负计时器 / >MAX_TICK / 额外武器 / 非 pulse / reloading=true / 免费 upgrade/ability / NaN data.aimYaw 全拒 |

**残余（非阻断，接线注意）**：`finiteRuntime` 上界是 `AI_NATIVE_LIMITS_V1.MAX_TICK`（≈2.1e9），故 `data.aimYaw=1e9`、`e.aimYaw=1e9`、`fireTimer=2e9`、`reloadTimer=2e9` 仍被接受（是运行态字段、不是能力注入，但上界宽松）；`validEchoActor` 是**字段钉死 + denylist**，额外未知键（如 `hiddenTarget`）会保留在帧里。建议接线时改成 allowlist + 合理 timer 上界。

## 2. `c0cfdb6` 共享 signalCore / tuning / relay 与旧 slice 语义一致性

| 检查项 | 结果 | 证据 |
|---|---|---|
| 单一 tuning 源 | **PASS** | `SLICE = Object.freeze({...SIGNAL_TUNING, 仅 slice 特有项})`；13 个共享键逐项 `SLICE[k]===SIGNAL_TUNING[k]`；两者均 frozen |
| scan/jam 范围 `<` vs `<=` 与旧 slice 一致 | **PASS** | `withinSignalRange` 用 `Math.hypot < radius`（严格 `<`）；探针：`11.999/5.999` 命中、`12/6` 精确排除；冻结 slice 在**正好 6 格** jam 仍 `E_ILLEGAL_TARGET`（与 212cd56 的 `distanceToReceiver < JAM_RANGE` 一致）。**注意** companion facet 的 `PERCEPTION_TILES` 用 `<=`（另见 §5） |
| tick 量化 regen / cooldown / paused | **PASS** | 11 tick 仍 90/regenAcc=11，第 12 tick +1 且归零；满能量清 regenAcc；paused 完全不推进；4 个 cooldown 每 tick 精确 -1；10k tick regen 恒 cap 100（**无无限资源**） |
| guard jam 语义 | **PASS** | `chargeJam(base,false)` 保留 `jamRemainingTicks=0`（不误抑制 relay），仍扣 25 + CD480；`jamBlocker` active→`E_RETRYABLE`、guardOnly→`E_COOLDOWN`；player/echo 各自 100 能量池不共享 |
| scan 证据来源 TTL + energy 扣费顺序 | **PASS** | `scanCost()` 先 `scanBlocker` 再 `chargeScan`（扣 10 在证据生成之前）；`observedAtTick === 当前 tick`、`expiresAtTick === tick+480`、provenance（sourceActionId/observerActorId/sceneEpoch）保留；空扫合法且仍扣 10、无证据；CD/暂停/能量不足**不扣费**；`expireEvidence` 在 tick+479 保留 / +480 丢弃；`scanDiscover` 带 actor 归属 |
| **旧 slice 真实语义/边界一致（强证据）** | **PASS** | 独立双跑：把 `212cd56` 的 `src/` git archive 到同一冻结快照，与 `ab59fe6` 的 `SliceModel` 跑**完全相同**的 14 步序列（scan/regen11/regen12/cd120/scanAgain/move/jam/jamExpire/interact/paused100/scanFrom/jamExact6…），逐步 `snapshot + lastResult + actionAvailability + evidenceSnapshot + serialize()` 逐字节相同；走廊 10 步（enterCorridor/scan/guard jam/480tick/relay jam/jamExpire/interact/shootGuard/serialize）同样全同；OLD/NEW 在正好 6 格均 `E_ILLEGAL_TARGET` |
| 无复制规则 | **PASS（有保留）** | `slice/tuning` 展开共享；`corridor.ts` 删除本地 `relayState/nextBridge/reading` 改 import/re-export `relay.ts`；`rules.ts` 的 regen/cooldown/scan gate/charge/evidenceExpiry/withinSignalRange 全走共享。**但 `SliceModel` 仍有自己的 `private jamBlocker`**（见 §5） |

**残余（非阻断）**：`chargeScan/chargeJam` 是纯函数，**自身不 clamp 负能量**（探针直调 energy=5 → -5）；共享 `jamBlocker` 的判定顺序（cooldown 优先）与 slice 私有 `jamBlocker`（走廊 energy 优先）不同。`validSignalResources` 也是 denylist：额外 `hiddenTarget` / 嵌套 `energy.free` 键会被接受。接线时统一用共享 gate + 严格 allowlist。

## 3. `ab59fe6` Owner capability 私有 Symbol（**纯模块不是安全边界**）

| 检查项 | 结果 | 证据 |
|---|---|---|
| token / Origin / 普通对象 / JSON / 同名 Symbol 伪造拒绝 | **PASS** | `{kind:'OWNER',session,token,origin}`、plain OWNER、`Symbol('last_signal.companion.owner.v1')`、`Symbol.for(同描述)`、JSON round-trip、字符串/null/数字 全部 `isOwnerCapability=false` |
| **`createOwnerCapability` 是 PUBLIC export，任意 import 可铸造** | **确认（接线阻断）** | 探针模拟「Agent 侧 import」：`createOwnerCapability(SESSION)` → `isOwnerCapability=true` → `CompanionOwnerLedger.decide` **接受**（`ok:true`）。注释声称「agent process 不能铸造」只对 token/Origin/JSON 成立，对**同进程 import** 不成立 |
| 凭据对象泄漏即无限伪造 | **确认（接线阻断）** | 私有 Symbol 是 **enumerable**：`Object.getOwnPropertySymbols(real)[0]` 取出后 `{...real}`、`{kind,session,[sym]:true}`、`Object.create(real)` 全部通过 `isOwnerCapability`。即「拿到一次对象」即可铸任意 session 的 OWNER |

**判定**：这不是纯模块的 bug（模块从未声称做进程隔离），但**接线时必须由游戏内 Owner(human UI) 进程独占持有 capability，`createOwnerCapability`/capability 对象绝不能出现在 gateway / bridge / MCP / Agent / remote 可导入或可序列化的路径**；否则「Owner 独占确认」退化为「任何能 import 该模块的人自 confirm」。当前提交**未接线**，故尚无可利用路径；这是接线前的**硬前置条件**。

## 4. `CompanionOwnerLedger.decide` / snapshot 契约

| 检查项 | 结果 | 证据 |
|---|---|---|
| 同 session / epoch / human / connected / TTL | **PASS** | 无凭据/伪 token→`E_PERMISSION`；错 session→`E_PERMISSION`；旧 epoch→`E_STALE_EPOCH`；NaN/Infinity tick→`E_SCHEMA`；ownerMode ai/external→`E_PERMISSION`；fallback→`E_LINK_UNAVAILABLE`；fallback 取消建议后→`E_TARGET_DESTROYED`；到期/超时拒绝且不记录 |
| 重复 confirm / 反复 confirm 不能双执行 | **PASS** | 首次 confirm `ok:true`；第二次同 id（confirm 或 reject）→`E_RETRYABLE`；`list()` 恒 1 条；decision frozen；建议状态仍 `proposed`；facet/ledger 原型**无** `confirm/reject/execute/step/stepPlayer/restoreSnapshot`。两个不同建议各需各一次决策，重复仍拦 |
| snapshot 有界、无授权泄漏 | **PASS** | 深冻结；`pending ≤ 8`、`memory ≤ 16`；带 dedupLimit/suggestionLimit/TTL；JSON 无 `seed/rngState/map/capability/OWNER_CAPABILITY/token/origin/hiddenTarget/energy/cooldowns`；**无任何 symbol 键**；`pending[].status='proposed'`；无 restore 入口（诊断用，不能恢复旧授权） |
| 建议内存不通过 hidden target 注入 | **PASS（有前提）** | 共享 echoView 的 `targets` 字段被 facet **忽略**：注入 `targets:[{id:77,x:999,y:999,hp:900,isBoss:true}]` 后 memory 只含感知 drone、无 77/999 坐标；40 个 drone 仍 cap 16；无当前观察的 `perceived_hostile` 建议被拒（`companion.reason_unobserved`）。**前提**：调用方必须传共享裁剪后的 `EchoView`（见 §5） |

**契约缝隙（接线注意，非纯模块阻断）**：
- `decide()` **不做运行时枚举校验**：`decision:'anything'` 被 `ok:true` 原样记录（TS 类型只在编译期）。接线传输层必须 strict schema 只放行 `confirm|reject`。
- `decide()` **不拒绝早于 `createdAtTick` 的 tick**：探针 tick=0 而建议创建于 500，仍 `ok:true`、`decidedAtTick=0`。接线须由权威 core tick 喂入并加单调校验。
- `E_ACTION_EXPIRED` 分支实际不可达：`facet.advanceTo(tick)` 先驱逐过期建议，故到期返回 `E_TARGET_DESTROYED`（开发者单测亦如此断言）。文档/错误码口径需统一。
- `rebindEpoch(2)` 后 epoch-1 的旧 decision 仍留在 `list()`（消费方必须按 `decision.epoch` 过滤，不能把旧授权当新授权重放）。
- `E_NOT_APPLICABLE`/`NO_MODEL`：断线 fallback 不自动重连，`fallbackLabel='NO_MODEL'` 诚实；**没有假 connected / 假 LLM**。

## 5. 阻断与接线注意（明确）

**阻断（进入接线前必须解决）**
1. **Owner 凭据的进程边界**：`createOwnerCapability` 是公开 export 且 Symbol 可枚举泄漏即无限伪造。接线时必须：capability 只在游戏内 human Owner 进程构造/持有；`createOwnerCapability` 与 capability 对象**不得**被 gateway / bridge / MCP 工具 / Agent / remote import 或序列化；传输面只传不可伪造的 session id，不传 capability 本体。否则 Owner 独占确认失效。
2. **本提交不能当完整 P3-b**：静态核查 `NO_WIRING_OUTSIDE_PURE_AND_SLICE`、`NO_WORLD_WIRING`；`World.ts/GameScene.ts/PauseScene.ts` 无 Signal/companion 引用；唯一相关 MCP 工具 `world_signal_status` 返回 `E_NOT_APPLICABLE / world.signal_combat_unsupported`（smoke `PASS signal_unsupported`）。正式 World 无 Signal 设备/energy/scan/jam、无 Relay 门控、无 LLM 连接、无 Owner UI 确认、无 gateway/bridge/v2 协商、无跨端 echoSignal 字节 parity。开发者 `REPORT.md` 对此「未完成边界（诚实）」明写，未冒充 LLM。

**接线注意（不阻断纯模块放行）**
3. `<` vs `<=` 不一致：共享 Signal scan/jam 用严格 `<`（12/6 精确排除），companion facet 感知用 `<=`（12 精确包含）。两者现在互不调用、不冲突；但**接线到同一 World 时**「刚好 12 格」会出现「可感知但不可 scan」的边界差，需明确统一口径。
4. 重复 jam gate：`SliceModel` 仍保留私有 `jamBlocker`（走廊 energy 优先）与共享 `signalCore.jamBlocker`（cooldown 优先）并存。当前旧 slice 语义经双跑验证未变（非回归），但接线主 World 时只能保留一份，否则错误码优先级分叉。
5. `chargeScan/chargeJam` 不 clamp 负能量；`validSignalResources` / `validEchoActor` 是 denylist 会保留未知键；`finiteRuntime` 上界 `MAX_TICK` 过宽。接线/存档路径必须共享 blocker + allowlist + 合理 timer 上界。
6. snapshot 里的旧 epoch decision、decide 枚举/单调 tick 未运行时校验：传输层 strict schema + 消费方按 epoch 过滤。
7. facet 自身**没有 LOS/explored 判定**，只按距离裁剪（探针：把隐藏 drone 塞进 `view.drones` 仍被记入 memory）。接线必须喂 `buildEchoObservation()` 的输出，绝不能喂裸 sim state / hidden target，否则「内存不通过 hidden target 注入」的保证失效。
8. scanFrom 在走廊「先扣 10 再 `E_PERMISSION` 且无证据」：OLD/NEW 完全一致（非本轮回归），但接线 ECHO 扫描前应先判场景合法性再扣费。

## 6. 范围与诚实边界

- 本地确定性策略 ≠ 外部 Agent；纯 Node 单测/双跑 ≠ Rendered/Headless 字节 parity；本轮**没有**跑 LLM 逐轮建议、没有真实模型遭遇、没有 Signal Combat 批测、没有五视口 UI。两份既有真实 LLM 最小遭遇（Rendered `lead-live`、Headless `lead-headless-cropped`）是 P3-a 前证据，**不代表 ECHO 已跑 LLM**。
- `world_signal_status` 显式 UNSUPPORTED，未伪造连接；`NO_MODEL` fallback 不自动接管。
- 未重跑无关全量（按 Lead 指令仅 unit + 独立负向）；首次 MCP smoke 因快照未建 `dist-mcp` 报 `Connection closed`，补 build 后 PASS，已如实记录未掩盖。
- 报告目录：`reports/ai-native-02/reviewer/p3b-pure/`（`REVIEW.md`、`GATES.md`、`gate-*.log`、`reviewer-probe-*.mts`）。

未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash。
