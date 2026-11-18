# AI-disable drift（`tests/ai-native-world.spec.ts:553`）归因审查

审查者只读：未起 devserver、未跑 155/unit/build、未改 src/tests、未 commit/push、未与 Developer/Tester 争端口。
输入（recovery worktree，主仓未复制）：`D:/Project/LAST_SIGNAL/.cindy-worktrees/serene-leakey/reports/gameplay-01/developer/p4-recovery/AI_DISABLE_DRIFT_DIAG.md`、`diag/step-diag.json`（`03a5e49a`，308 条）、`diag/step-diag-summary.json`、`diag/guard-hole.check.mts`＋`diag/guard-hole.log.txt`、`diag/ai-native-world.diag.p4v4.spec.ts`、`diag/diag-run1.log.txt`；产品源读主仓 `d55e502`（= `manifest.v4.json`，sha 已在前轮核过）。

---

## 0. 结论先行

1. **CONFIRMED**：neutral intent 下敌人击退真的写 player pos（`applyActorHit` 落 `p.x/p.y`），插桩 126 个 human 帧里 5 次位移全部 = 0.375 tile、全部伴随 HP 下降、全部 `move {0,0}` / `owner human` / `aiEnabled false` / `pendingCommands 0`。**该插桩运行里没有 AI 输入。**
2. **CONFIRMED**：`hp(firstSample) === hp(secondSample)` **不能**排除中间受击。至少 4 条真实恢复/规避路径，其中一条是 **spec 自己的 100 ms keep-alive 治疗**（`tests/ai-native-world.spec.ts:232-247`，`enqueueHeal` → `heal-player`），Developer 文档没有提到它。
3. **UNKNOWN**：run7 现场到底发生了什么。0.694 的**构成**不可判定：既可能是 ≥2 次击退，也可能是 1 次击退 + `ensureWalkableFromState` 回位（后者无上界，`core.ts:850-867` 最多搜到 6 tile）。所以“0.694 / 0.375 ≈ 1.85 ⇒ 两次击退”只能是 INFERENCE，而且漏掉了这个替代项。
4. **Developer 文档的“NOT a product defect”必须收窄**（见 §4）：可写的是“**这一机制**（击退/回归位写 pos）在 neutral intent + human owner 下足以解释一次红，且插桩运行里未见 AI 输入”；不可写“run7 的非产品根因已确立”。
5. **拟修契约（Tester）方向正确、比原写法更直接**，但按 Lead 的草稿原样落地会有 **两处会误红**（`pendingCommands.length===0`、`hp 未变` 两个门），且必须补 **事件级归因**（见 §5/§6）。

---

## 1. CONFIRMED — 代码路径（我逐条读源核对）

| 主张 | 核对结果 | 位置 |
|---|---|---|
| 击退在 neutral intent 下真实写 pos | **成立**。`applyActorHit` 把 `hit.position` 写进 `p.x/p.y`（另有 `hp`、`invuln`、`hurtTimer`）；此前 `resolvePlayerHit` 只在 hp>0 且 invuln==0 时非 blocked，位移 = `24 / PIXEL_TO_TILE(64) = 0.375` 且**逐轴**做 walkable 判定 | `src/world/sim/core.ts:1178-1199`（写 pos 在 `:1196`）、`src/world/sim/rules.ts:365-384`、`src/config/game.ts:9` |
| 伤害下限 1 | **成立**：`Math.max(1, amount * reduction)` | `src/world/sim/rules.ts:131-134` |
| 除击退外的 pos 写者（Developer 的“exact writers”并不完整） | **不完整**：`_sim.player.x/y` 的全部写入点是 ① `stepActorMovement` 每 tick 的 `ensureWalkableFromState` 回位（环形搜到 6 tile，发 `player-moved` 且 `velocity{0,0}`，`core.ts:1040-1048`）；② `applyActorHit` 击退（`:1193`）；③ intent 位移（`:1062`，neutral 时不动）；④ `teleport-player` 命令提交（`:650-660`，受 `pendingCommands` 门控；`Player.reset`/`World.enqueueTeleport` 只入队不直写，`World.ts:1775-1778`、`Player.ts:159-163`）；⑤ `World.ts:646`（scenario start）、`#resetPlayer`（`:1701-1709`，checkpoint/开局恢复）——非窗口内；⑥ `setPlayerPositionForTest`（dev/test 专用，`World.ts:115-120`）。另：`Player.ensureWalkable()`（`src/entities/Player.ts:146-152`，“knockback 后进墙就 teleport”）**定义了但无任何调用点**，今天不是写者——提醒 Tester 不要把写者清单当永久不变 | 同左 |
| HP 可在窗口内被恢复 | **成立且更强**：`stepLoot` 拾取回 30 / 满血（`core.ts:1223-1229`）、`hpRegen` 逐 tick（`core.ts:941-943`）、**spec 自身 keep-alive**：`setInterval(apply,100)`，`hp < maxHp*0.35` 时 `enqueueHeal(maxHp-hp)`，**从不 clear** | `tests/ai-native-world.spec.ts:232-247`（安装在 `:280`，红了的那条测试就是 :273） |
| 禁用后 AI 不再被调用 | **成立**：`disableAi` 清 `_aiEnabled`/置 `_owner='human'`；`resume()` 在 `aiEnabled===false` 时恢复 `'human'`；`resolveIntent` 仅当 `owner==='ai'` 才问控制器；唯一重开路径 `enableAi`（PauseScene AI CONTROL → `GameScene.toggleAiControl` `:1203`） | `src/ai-native/control.ts:164-215`、`src/entities/Player.ts:209-236`、`src/scenes/GameScene.ts:1203` |
| 玩家受击来源是真实敌人 | **成立**：`Player.ts:302 → world.enqueuePlayerHit`（`World.ts:1930`），走 `pendingPlayerHits` → 下一 tick `applyActorHit` | 同左 |

## 2. CONFIRMED — 我用 `step-diag.json` 独立复算（与 Developer §2 表逐项一致）

筛 `owner==='human' && aiEnabled===false` 的全部记录（信封 `{now, diag, final}`，`diag` 308 条）：

| 我复算 | 值 |
|---|---|
| human&disabled 帧数 | **126**（t 5474→28010 ms；`mode` 全 `HUMAN`，`ctlPaused/gsPaused` 全 0） |
| 非零 `intent.move` | **0** |
| 任一移动键按下 | **0**（`fire` 也 0） |
| `pendingCommands != 0` | **0** |
| 有位移的帧 | **5**，位移长度全 **0.375**（0.375,0.375,0.375,0.375,0.375）、全 `lastIntentOwner='human'`、最近敌 `drone` 0.15/0.48/0.86/1.22/1.6 tile |
| HP 下降帧 | **5**，且与位移帧**完全同一集合**（集合相等，按 t/hpBefore/hpAfter 逐项比对） |
| 窗口内 HP 上升 | **0**（100→79→71→64→56→49，最低 49 > 35 ⇒ keep-alive 未触发） |

⇒ **该运行确实“无人输入、无 AI 输入、只有敌人击退”**。且注意：`stationaryStart` 位置 (116.938,45.930) 恰等于第 3 次击退后的位置、`stationary` 恰等于第 5 次击退后的位置（`step-diag-summary.json`），两端 HP 64 vs 49 不等 ⇒ **原 guard 跳过 ⇒ 绿**。也就是说：这次之所以绿，只因为那段窗口里 HP 没有回到起点值；**再有一次回血就会红**。

## 3. CONFIRMED — 反例夹具是否合法、是否标明

- `guard-hole.check.mts` 只用真实导出：`createSimulationState / generateRealMap / basePlayerData / enqueuePlayerHit / enqueueCommand('heal-player') / stepSimulationTicks`；玩家被放在 start room 最中心的可行走格；击退方向先确认目标格可行走。**没有任何直写 `player.x/hp`**（我通读全文）。
- `heal-player` 是**真实核心命令**（`core.ts:119/715`），产品侧入口 `World.enqueueHeal`（`World.ts:1672`，「Legal adapter commands」），而且**正是本 spec keep-alive 用的那条**（`:246`）。所以“合法 heal core fixture”成立；代码注释与日志 `rule` 字段都写明了用的是「real heal-player command」，**标注存在**。
- 可改进的措辞（非错误）：该 heal 是**adapter/测试接缝**驱动（`World.enqueueHeal`），organic 回血是 `stepLoot` 的 `healPlayer(30)` / `hpRegen`；文档把两者并列写成「what a health pickup / the harness top-up does」可以，但更该直接引 spec 自己的 keep-alive（`:232-247`）——那比 loot 更贴近 run7。
- 小瑕疵：结果字段名 `guardWouldSkip: false` 与 `hpEqual: true` 并列容易被读成矛盾；它其实表示「guard 不会跳过 ⇒ 位置断言会执行 ⇒ 会红」。建议改名 `positionAssertionRuns`。

## 4. 必须收窄的三处表述（对 `AI_DISABLE_DRIFT_DIAG.md`）

| 现文 | 问题 | 建议措辞 |
|---|---|---|
| 标题下 “**Verdict: NOT a product defect**” | 从**一次插桩运行**推到结论，且 run7 现场没有 trace | “In the instrumented run the disabled AI passed no intent (per-tick, 126 frames); the failing assertion's precondition (`hp` equal) is **unsound** because **real enemy knockback writes pos under a neutral intent** and HP can be restored in-window (incl. this spec's own 100 ms keep-alive). The **run7 site itself was not instrumented, so its literal cause is UNKNOWN**.” |
| §3 “HP can be restored … health loot / hpRegen” | 漏了最强的那个：spec 自己的 keep-alive 治疗 | 补：`tests/ai-native-world.spec.ts:232-247`（`hp < 35% → enqueueHeal(full)`，每 100 ms，永不 clear）⇒ 两端等 HP 在这条测试里是**预期内**的，不是罕见巧合 |
| §4 “0.6941511 / 0.375 = 1.851 → 两次击退” | 位移写者不止击退：`ensureWalkableFromState` 回位无上界 | 改成“≥1 次击退；若还叠加了回位则上界不存在。**只有 1 次击退时 |Δx| ≤ 0.375**，所以 0.694 至少需要 2 次击退**或** 1 次击退+回位”；保留「INFERENCE，未在现场观测」 |

另外 §2 表头「CONFIRMED — the disabled AI applies no intent」本身没问题，但请把“one instrumented run”的范围写在表头，避免被后续文档引用成 run7 的现场结论。

## 5. 对拟修 Tester 契约的判断

**5.1 是否比原写法更直接：是，而且不只是“更直接”，是“测的才是要声称的东西”。**
- 原写法：`if (hp端点相等) ⇒ 位置必须逐位相同`。它声称的是「AI 没动玩家」，测的却是「HP 端点 + 位置」两个代理量；`hp` 与本命题**无因果关系**（HP 只由伤害/回血决定），所以它既可能**误红**（击退）也可能**在回血场景下把窗口判成“安静”**。
- 新写法：逐 tick 记录**实际传入 core 的 intent** ＋ `owner/aiEnabled/aiActionCount` ⇒ 直接观测「禁用后的 AI 没有投递任何输入」。这比终点位置差**强**：AI 一旦自我夺回并动一帧，就在那一帧被点名（带 tick/intent 证据），而不是丢给位置差去猜。
- 位置断言不必删：把它降级为「**已验证无物理写者**的窗口里，位置必须逐位相同」，保留 1e-6，安全语义不丢。

**5.2 按 Lead 草稿原样落地会误红的两处（必须改）**
1. **`pendingCommands` 不能断言 `length===0`**：本 spec 的 keep-alive 每 100 ms 就可能 `enqueueHeal`，窗口里出现 `pendingCommands=[heal-player]` 是**正常的**。应记录命令**类型**，只断言「窗口内没有 `teleport-player`」——那是唯一会写玩家位置的命令（`core.ts:110/524-527/650-660`；`move-target` 只动 `state.targets`），不判空。
2. **“仅无受击且 HP 未变 保留原 x/y 1e-6”里的 `HP 未变` 应删掉**：`hpRegen`/拾取会合法改动 HP 而**没有**位移；保留这个合取只会让本该断言位置的窗口**少测**（lead 的“不删安全含义”目标反而受损）。安静分支的判据应是「**没有任何位置写事件**」。

**5.3 必要最小补（顺序即优先级）**
1. **用 `stepFrame` 返回的 `SimEvent[]` 归因，而不是 HP 差**：`stepFrame(...)` 返回本帧全部事件（`World.ts:1853/1870-1905`），其中 `player-hurt` 自带 `hit.position`（`core.ts:224/1193`）、`player-moved` 自带 `position`（`core.ts:218/658/1043/1066`）。只比 HP 会在「同一帧里挨打 + 拾取回血」时**重犯**原 guard 的洞（净 0 但位置动了）。这是唯一必须新增的“信息源”。
2. **`finally` 恢复原型 + flush**：Developer 的 diag 版**从不 restore**（`proto.stepFrame` 永久替换），照抄会污染后续用例并让红时无证据。恢复要在取 `stationary` 之前完成，trace 写进证据目录（run7 红的最大损失就是没有 trace）。
3. **非空 + 真实推进**：窗口内 `calls ≥ 1` 且至少一帧 `sim.tick` 增加（逐帧记 `tickBefore/tickAfter`；不要要求**每帧**都推进，`ticks===0` 的首帧正常）。
4. **逐帧无条件**：`intent.move == {0,0}`、`fire === false`、`owner === 'human'`、`aiEnabled === false`、`lastIntentOwner === 'human'`。
5. **窗口级**：`aiActionCount` 不变、`takeoverCount` 不变、`lastAiAction === null`（保留原有两条 + 新增 count，防止中途夺回又夺回）。
6. **位置断言二选一（有事件时归因、无事件时逐位相等）**：
   - `positionWriters = events.filter(player-hurt | player-moved | player-reset)`；
   - `writers.length === 0` ⇒ `x/y` 与帧前**逐位相同**（1e-6，原精度）；
   - `writers.length > 0` ⇒ 断言**帧末位置 === 最后一个 writer 的 `position`**（1e-6），即「位移 100% 由真实物理事件解释，AI 贡献 0」；同时记录事件类型/伤害/来源，不把位移算作 AI。
   这条让“有击退的窗口”**仍然有硬断言**，而不是只记录——比 Lead 草稿的“若物理事件存在位置作为真实物理观测”更强，且不引入新 flake（事件 payload 就是真实写值）。
7. 保持：不清敌、不冻结、不 teleport、不 heal 造静窗、不动 budget/`maxMs`/`skip`、不放宽 1e-6。

**5.4 需要 Tester 明确写进报告的三件事**：① 新契约**不**断言位移幅度（幅度只作记录）；② `pendingCommands` 只判 `teleport-player`（不判空）；③ 原型包裹必须 restore（并提供 restore 失败的 fail-fast）。

## 6. 我**不**建议做的

- 不建议清掉 spec 的 keep-alive 去“造安静窗”（可能中途死亡，且属新增夹具）；新契约本来就不再依赖 HP。
- 不建议改用 `page.evaluate` 轮询 `state()` 代替包裹：轮询会漏帧（负载下更漏），而 `stepFrame` 包裹是逐帧全覆盖；也没有“每帧传入 intent”这个最直接的证据。
- 不建议用 `setPlayerPositionForTest` / `clearEnemiesForTest` 之类 dev-test 接缝做静窗（Lead 已禁，且会掩盖本现象）。
- 不因本诊断改动产品源或放宽 `toBeCloseTo(…, 6)`。

## 7. Gate 表（本轮只读静态/现 trace）

| 检查 | 结果 | 路径 |
|---|---|---|
| `ai-native-world.spec.ts` 无 diff（sha `ef1d2e92`） | **PASS** | `D:/Project/LAST_SIGNAL/tests/ai-native-world.spec.ts` |
| 击退写 pos / 逐轴 0.375 / 下限 1 | **PASS（代码）** | `src/world/sim/rules.ts:365-384,131-134`、`src/world/sim/core.ts:1196` |
| 插桩 126 帧 / 0 非零 move / 0 键 / 0 命令 / 5 位移=5 HP 降 | **PASS（复算）** | `…/p4-recovery/diag/step-diag.json` |
| 位移幅度 0.375（5/5）与最近敌 drone 0.15–1.6 | **PASS（复算）** | 同上 |
| 反例夹具只用真实核心 API、未直写 pos/hp | **PASS（通读）** | `…/diag/guard-hole.check.mts`、`guard-hole.log.txt` |
| HP 可被窗口内恢复（含 spec keep-alive 100 ms） | **PASS（代码）** | `tests/ai-native-world.spec.ts:232-247,280`；`core.ts:1223-1229,941-943` |
| 位移写者全集 | **FAIL（文档不完整）**：缺 `ensureWalkableFromState` 回位 / `teleport-player` 命令提交 | `core.ts:1040-1048,650-660`、`World.ts:1701-1709` |
| 拟修契约“无 edit/端口/CPU 争用” | 不适用（尚无 Tester 新 diff） | — |

## 8. 判定

- **归因**：机制层面 CONFIRMED（neutral intent 下击退真实写 pos；HP 端点相等不可作“无受击”判据）。run7 现场 UNKNOWN，**不能**写成“已证非产品缺陷”；可写的上限是「此机制足以解释；未见 AI 输入（插桩运行）」。
- **测试契约**：Lead 的方向正确且更直接；**必须先修** §5.2 的两处误红点，并**必须补** §5.3-1（事件级归因）与 -2（restore/flush），否则新写法要么误红、要么在“同帧挨打+回血”上重犯旧洞。
- **不动**：产品 v4 源、`toBeCloseTo(...,6)`、budget、`skip`、任何“平静夹具”。
- 待 Tester 新 diff 到手后我做增量核（§5.3 六条 + §5.2 两处），核过再建议是否值得整跑 155。本节不改变既有结论：B7 默认档 857/859 风险、P5 未实现、HUMAN ACCEPTANCE PENDING，整体仍非 PASS。
- 另记一条（不在本轮改）：`tests/ai-native-world.spec.ts:232-247` 的 keep-alive `setInterval` **从不 clear**，因此**任何以 `hp` 为判据的断言**在该测试里都可能被它干扰（不止 :553 这一处）。本轮只把 :553 改成事件级判据，其余 hp 判据待专项排查。

---

## 9. run8（`c33f16c7`）— 增量审查：**可提交，可开始一次完整 155；无阻断**

只读增量：未重跑 155/859、未起端口、未改 src/tests、未 commit。输入 `D:/Project/LAST_SIGNAL/reports/gameplay-01/tester/p4-final/run8-ai-disable/`（`HASHES-RUN8.txt`、`before-spec/`、`after-spec/`、`diff-ai-native-world.spec.ts.diff`、`logs/`、`evidence/`）。run7 的未知现场**不因本节被重建**；本节只判“新契约是否成立、可否开跑”。

### 9.1 字节（**先纠正一处 hash 不符**）

| 项 | 实测 | 说明 |
|---|---|---|
| **你给的 after `934bf2d7…`** | **不是最终字节**：它出现在 `logs/attempt1-window-empty-join-bug.log.txt` 的头部，是 **attempt1**（因我 §5.3-3 的“非空”门而红：node 侧只在上面的 `finally` 填 trace、gate 切片为空，`Expected: > 0, Received: 0`，`EXIT=1`） | 冻结/审查必须引 `c33f16c7…`，否则记录会指向已被废弃的失败版 |
| **最终 / 实际被测字节** | `c33f16c7e48a433968c156d012c7c7dc21751f0eee5aecdaa179e2c347b8bd61` = `after-spec/` = **现盘 `/d/tmp/ls-p4-v4/tests/ai-native-world.spec.ts`**（我实算，三处一致） | 对应 `logs/final-2of2-with-branch-fields.log.txt` 头部 `spec=c33f16c7…`，**PASS 2/2 EXIT=0** |
| 中间版 | `f248400e…`（attempt2，已通过 2/2 后被 c33f16c7 取代，后者加了 branch 字段） | 三版链条：`934bf2d7`(红) → `f248400e`(绿) → **`c33f16c7`(绿，最终)** |
| before | `ef1d2e92…` ✓（= 主仓 `tests/ai-native-world.spec.ts`，未改） | |
| 产品源 | **未变**：主仓 HEAD `2b67106` 相对 `d55e502` 对 `src/` **零改动**（`git diff --stat d55e502..2b67106 -- src/` 空），10 源仍 = `manifest.v4.json`（World `349544bf…`） | 与你的“v4 无源变”一致 |
| 改动范围 | 我重算 `diff -u before after` = **单一 hunk `@@ -542,18 +542,180 @@`，+173/−11（diff 文件 194 行 = 173+11+7 上下文+2 文件头+hunk 头）**（与你给的“194 行”一致） | 无 `skip`/`.only`/`setTimeout`；`waitForTimeout(1500)` 与 `waitForTimeout(2500)` **均未变**；`txtControl` 断言保留 |

### 9.2 §5.2 / §5.3 逐项核对

| 我 §5.3 的要求 | run8 实现（`after-spec/ai-native-world.spec.ts` 行号） | 判定 |
|---|---|---|
| 1. 用 `stepFrame` 返回的 `SimEvent[]` 归因 | `:589` `const ret = orig.call(this, delta, intent, ...rest)`；`:590` `events = Array.isArray(ret) ? ret : ret?.events ?? []`；`:591-597` 只从 `player-hurt.hit.position` / `player-moved.position` 取 writer | **PASS** |
| 2. `finally` restore + flush；失败还原显 fail | `:700` `} finally {`；`:703-713` 重新取 world、`hadOwn ? w.stepFrame = t.orig : delete w.stepFrame`；`:716` 先 `writeFileSync(...)` 再 `:717` `if (!restored) throw` | **PASS**（flush 在 throw 之前；见 9.4-④ 的掩蔽瑕疵） |
| 3. 非空 + 真实 tick 推进 | `:647` `win.length > 0`；`:648` `win.filter(r => r.ticks > 0).length > 0` | **PASS**（下限偏松，见 9.5-④） |
| 4. 逐帧无条件：neutral move / fire / interact / owner / aiEnabled / lastIntentOwner | `:649-659` offender 聚合：`:651` owner、`:652` aiEnabled、`:653` lastIntentOwner、`:654` move、`:655` fire、`:656` interact；`:659` `toEqual([])` | **PASS**（`dash` 未纳入，见 9.5-①） |
| 5. 窗口级 aiActionCount / takeover 不增 + lastAiAction null | `:660-663` 两个 `new Set(...).length === 1`；`:639` `stationary.lastAiAction` null（`stationaryStart` 与 `stationary` 都写入 record） | **PASS**（`?? -1` 兜底使“集合=1”可能空转，见 9.5-②） |
| 6a. 无 writer ⇒ 前后 1e-6 | `:601-603` `positionExplained = last ? (|x1-last.x|、|y1-last.y| ≤1e-6) : (|x1-x0|、|y1-y0| ≤1e-6)`；`:670-672` quiet 时 `unexplained` 必须为空 | **PASS（分支未触发）** |
| 6b. 有 writer ⇒ 帧末 === 最后一个 writer 的 position（1e-6），按执行顺序 | 同上，`writers` 按 `events` 顺序 push（`:591-597`）；evidence 实测 **73/73 帧残差恰好 0.0**（我逐帧复算，`x1===last.x && y1===last.y` 73 次） | **PASS** |
| §5.2-1 不限 `pendingCommands` 为空；只禁 `teleport-player` | `:587` 记 `pending` 类型；`:612` `hasTeleport`；`:657` 断言 `!hasTeleport`。实测 `pendingTypesSeen=['heal-player','spawn-enemy-projectile']` —— 正好证明“判空”会误红 | **PASS** |
| §5.2-2 去掉 `hp` 前置 | 无任何 `hp ===` 条件；`hp0/hp1` 只进 record（`hp0hp1`） | **PASS** |
| 事件是产品既有、非 probe 伪造 | writer 只由真实 `stepFrame` 返回数组映射；无 `page.evaluate` 里的伪造/补写 | **PASS** |
| actor 过滤正确 | `player-hurt` 仅由 `applyActorHit(kind==='player')` 发（echo 发 `echo-hurt` 带 `actorId`）；`player-moved` 仅 `movedType`=player 分支（`core.ts:1037-1072`）——类型本身即玩家专属，无需 actorId 过滤 | **PASS** |

### 9.3 我对 `evidence/manual-disable-step-trace.json` 的独立复算

窗口 `records[1:74]`（`windowStart=1`、`windowEnd=74`，共 77 条记录，含 3 条采样后记录，可切片）：

| 我复算 | 值 | 与 `HASHES-RUN8` 声称 |
|---|---|---|
| calls / ticks / framesWithTicks | **73 / 153 / 73** | 一致 |
| owner / aiEnabled / lastIntentOwner | 全 `human` / 全 `false` / 全 `human` | 一致 |
| move / fire / interact / dash | 全 `(0,0)` / 全 false / 全 false / **全 false** | 一致 |
| 按键（`keys` 任一 true） | **0 帧** | 一致 |
| `pending` 类型 | `heal-player`、`spawn-enemy-projectile`；`teleport` **无** | 一致 |
| `aiActionCount` / `takeoverCount` | `{33}` / `{1}` | 一致 |
| 场景（`scenes`） | 全 `('GameScene',)` ⇒ `quiet=true`、`overlays=[]` | 一致 |
| writer 帧 / 类型 | **73** / `player-moved`、`player-hurt` | 一致 |
| `player-hurt` 帧 | **4**，damage **21 / 21 / 8 / 13**，全非 blocked；位移幅度我算 = **0.3750 / 0.3751 / 0.3750 / 0.3750** | 一致（再次印证击退机制，不是本轮要证的） |
| `positionExplained` | **73/73 true**；残差 **恰好 0** | 一致 |
| 无 writer 帧 | **0** ⇒ no-writer 分支**未触发** | `HASHES` 已坦诚写明，**不冒充全覆盖** ✓ |
| overlay 分支（GameOver/LevelUp） | **未触发** | 同上，已写明 ✓ |

### 9.4 四个语义判定（你点名要确认的）

1. **“实际传给 stepFrame 的所有参数与返回值原样”**：`orig.call(this, delta, intent, ...rest)` + `return ret`，参数未改写、返回值未替换；recorder 在调用**前**读 `tick/x0/y0/hp0/keys/pending/snapshot`、**后**读 `x1/y1/hp1/events`，读写不交叉。**PASS**
2. **wrapper cleanup 的窗口边界不漏尾**：`windowStart` 在装好之后立刻取（`:623`，其前的帧被排除）；`windowEnd` 在 **`stationary` 采样之后**才取（`:631`），所以窗口末覆盖到采样点之后 → 不会漏掉“采样之间的最后一帧”，只会多收（更严）。**PASS**
3. **`quiet=false`（overlay）不会整段空转绿**：控制属性断言（`:649-663`）在 overlay 逻辑（`:668-672`）**之前且不依赖 `quiet`**，所以非 quiet 窗口仍逐帧断言 owner/aiEnabled/lastIntentOwner/neutral/fire/interact/no-teleport + 计数恒定。**符合你的判据**。但位置门在非 quiet 时被静默跳过（`unexplained` 直接 `[]`）——见 9.5-③。
4. **`finally` 的 flush 与还原**：`catch(() => false)` 兜住页面已关闭；`writeFileSync` 在 `throw` 之前 ⇒ 断言失败/超时也能落 trace（attempt1 的教训正是这条）。**PASS**；瑕疵：若 gate 已失败且 restore 也失败，restore 的 `throw` 会**覆盖**原断言错误（可诊断性，LOW）。

### 9.5 残留（全部 LOW，均不阻断本轮）

1. **`dash` 记了但没断言**（`:611` 记录、`:649-657` 未纳入 offender）。这是新写法相对旧写法**唯一的覆盖收缩**：`player-moved` 每 tick 无条件发（`core.ts:1066-1072`），所以“位置一致性”对 intent 驱动的移动近乎自指；一个 `dash:true, move:{0,0}` 的帧会移动玩家却全绿。本轮 73 帧 `dash` 全 false，加一行 `if (r.dash) offenders.push(...)` 零风险——但会改字节、需重跑定向，故**列为下次触碰该文件时的必改项**，不作为本轮阻断（真 AI 夺回会被 `owner`/`aiEnabled` 抓住；残留只覆盖“卡住空格键”这类人类输入残留）。
2. **`aiActionCount`/`takeoverCount` 只用“集合大小=1”**（`:660-663`），而记录值是 `snap.aiActionCount ?? -1`：若该字段被改名，两侧会一起变成 `-1` 而“恒定”仍成立。建议补 `expect(actionCounts).toEqual([stationaryStart!.aiActionCount])`（`state()` 不做兜底，改名即红）。本轮实测 33/1 为真值，**不是**当前缺陷。
3. **`quiet=false` 时位置门静默跳过**：控制属性仍断（符合你的判据），但“本窗口未验证 stillness”只在 record 里，测试仍绿。建议后续二选一：`expect(quiet, ...).toBe(true)`（响亮失败）或把 `quietWindow:false` 写进测试报告的必读项；本轮 `quiet=true`，不影响结论。
4. **下限偏松**：`win.length > 0` + “至少 1 帧推进”即可通过；若浏览器被严重节流，1 帧也算过。可加 `observedTicks >= 30` 之类地板（本轮 153，安全）。
5. **`intent` 缺失会被记成 neutral**（`:610` `intent?.move?.x ?? 0`）：`GameScene` 两处调用都传了具体对象（`GameScene.ts:188/516`），今天不触发；若要更严谨可记 `intentPassed: !!intent` 并入 offender。
6. **`typecheck 0` 对该 diff 没有验证力**：`tsconfig.json` 的 `include` 只有 `["src","scripts","vitest.config.ts","playwright.config.ts"]`，**不含 `tests/`**（`npm run typecheck` = `tsc --noEmit` 同一 program）。所以本轮真正的验证只有 2/2 运行；也解释了为什么 run8 没有 typecheck 日志。不是缺陷，但**记录里不应把 typecheck 当这处改动的证据**。

### 9.6 Gate（本轮只读；命令/检查 → 结果 → 绝对路径）

| 检查 | 结果 | 路径 |
|---|---|---|
| 最终字节 = 归档 = 现盘工作树 | **PASS**（`c33f16c7…` 三处一致） | `…/run8-ai-disable/after-spec/ai-native-world.spec.ts`、`D:/tmp/ls-p4-v4/tests/ai-native-world.spec.ts` |
| before = 主仓未改 | **PASS**（`ef1d2e92…`） | `D:/Project/LAST_SIGNAL/tests/ai-native-world.spec.ts` |
| 产品源未变（`d55e502..2b67106` 对 `src/` 零改动） | **PASS** | `git diff --stat d55e502..2b67106 -- src/`；`…/developer/p4-recovery/manifest.v4.json` |
| 单 hunk、+173/−11、无 skip/timeout 变化 | **PASS** | `…/run8-ai-disable/diff-ai-native-world.spec.ts.diff` |
| §5.2/§5.3 逐项 | **PASS**（9.2 全表） | `…/after-spec/ai-native-world.spec.ts:578-717` |
| 定向 2/2（同字节、连续） | **PASS 1.5m EXIT=0**（采信日志，未重跑） | `…/logs/final-2of2-with-branch-fields.log.txt` |
| 复算 73/153/73、quiet、33/1、4 hurt、73/73 explained、残差 0 | **PASS** | `…/evidence/manual-disable-step-trace.json` |
| no-writer / overlay 分支 | **未触发（已坦诚标注）** | `…/HASHES-RUN8.txt`（branch coverage 段） |
| attempt1 失败记录保留、未隐藏 | **PASS** | `…/logs/attempt1-window-empty-join-bug.log.txt` |

### 9.7 判定

- **PASS：这处 diff 可提交**（测试侧、产品零改动、单 hunk、无 skip/超时/精度结构放宽；§5.2 两处误红已排除，§5.3 六条全部落实，分支覆盖已如实标注）。
- **可以开始一次完整 155**：定向 2/2 连续通过、字节与工作树一致、`quiet=true`（本轮窗口是真实无遮罩窗口）、4 次真实 `player-hurt` 已触发 damage 分支。
- **无阻断**；9.5 的六条全部记为后续（其中 ① `dash` 未断言与 ③ 非 quiet 静默跳过位置门，是下次触碰该 spec 时的必改项）。
- **记录口径**：请把引用 hash 改为 `c33f16c7…`（`934bf2d7…` 是 attempt1 的失败版）；`typecheck 0` 不作为该 diff 的证据；run7 的现场仍为 UNKNOWN，本节不重建它。
- 其余不变：B7 默认档 857/859 风险、P5 未实现、HUMAN ACCEPTANCE PENDING；整体仍非 PASS。
