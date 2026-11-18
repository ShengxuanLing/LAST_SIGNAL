# Boss volley 16 vs 15 — 归因审查与拟修契约（`tests/audit.spec.ts:780`）

审查者只读：未起端口、未跑 155/859/模型、未改 src/tests、未 commit。产品源读主仓 v4（`World.ts 349544bf…`、`core.ts f71523e1…`；HEAD `2b67106` 对 `src/` 与 `d55e502` 无差异）。
输入：`D:/Project/LAST_SIGNAL/.cindy-worktrees/serene-leakey/reports/gameplay-01/developer/p4-recovery/BOSS_VOLLEY_DIAG.md` ＋ `diag/{boss-run1,boss-run2}.log.txt`、`diag/boss-volley-bossrun{1,2}.json`、`diag/boss-volley.check.mts`＋`boss-volley-check.log.txt`、`diag/audit-boss-volley.diag.p4v4.spec.ts`；对照 Tester 的 `reports/gameplay-01/tester/p4-final/run9-ai-disable-final/{logs/full-e2e-155.log.txt, logs/diag-audit-boss-bullets-isolated.log.txt, boss-volley-drift/}`。

---

## 0. 结论先行

1. **CONFIRMED（本次红，逐事件可证）**：被测量的那一步共 **16** 个 `projectile-spawned`，其中 **owner 4（Boss）恰好 15（id 4–18，速度 3×2.5 + 12×1.875）**，**第 16 个是 owner 1**（id 3，kind plasma，pos (22.58,44.33)，vel (2.17,1.24)），而且它的 `spawn-enemy-projectile#1` **在测量开始前就已经在 core 队列里**。core 与 adapter 的 id 列表在步后**都是 `[3..18]`（16/16）** ⇒ 本次红**不是**索引错位。
2. **CONFIRMED（机制）**：legacy 敌人在 `World.updateLegacy`（在 tick 之后）里经 `Enemy.update` → `world.spawnEnemyProjectile` **入队**，由**下一帧** `stepFrame` 提交（`World.ts:1904/2292-2302`、`Enemy.ts:137-147,258-272`、`World.ts:1781-1784`、`core.ts:708-713`）。Boss 自己 `fireLaser()` 3 ＋ `shockwave()` 12（`Boss.ts:165-188`），同样入队、下一 tick 提交。所以“本步所有 spawn 都是 Boss 的”这个模型本身不成立。
3. **UNKNOWN（保留）**：run9 现场**没有**逐事件 trace（`bossInit` 是 `page.evaluate` 内的局部对象，断言先抛）⇒ **不能**宣称 run9 的 16 与本次同源；owner 1 的**敌种**没有记录（recorder 只记 ownerId）；run9 的 16 里“其它”可能有 1–3 发（sentry 2 发 / shiver 3 发，`Enemy.ts:268-272`）。
4. **拟修契约方向正确**，但按 Developer §7 原样落地仍有**三处需要补的护栏**（§5）：Boss 侧必须先断言“测量前 core 队列里没有**Boss 自己的**待发弹”；速度要用 **3×2.5 / 12×1.875 的多重集**而不是 max/min；`afterHalf` 的全世界检查必须收窄到**同一 volley 的 id**。
5. **收窄不会删掉原 Boss 安全含义**：数量（恰好 15）、速率（2.5/1.875）、sprite 可见、屏内、0.5 s 存活与位移全部保留且更精确；被去掉的只是“同一帧里不允许出现别的敌人子弹”这个**从来不是本意**的副作用（§6）。

---

## 1. CONFIRMED — 本次 16 的逐事件归属（我用归档 JSON 独立复算）

`boss-volley-bossrun2.json`：

| 项 | 值 |
|---|---|
| `preDiag.coreLen / adapterLen` | **0 / 0**（`resetProjectilesForTest()` 之后两者都清空） |
| `preDiag.queued` | **`["spawn-enemy-projectile#1"]`** ← 测量开始前已挂着的旧弹（owner 1） |
| `preDiag` 其余 | `droneAlive 0`、`enemiesAlive 3`、`bossId 4`、`phase 1`、`attackTimer/stateTimer 999999` |
| `queuedAfterCalls` | 16 条：1 条 `#1` + **15 条 `#4`**（= 3 laser + 12 shockwave，全部入队待提交） |
| 事件归属（我按 `ownerId` 分桶） | `owner 4` **15**（id 4–18）＋ `owner 1` **1**（id 3）＝ **16** |
| Boss 速度集合 | `{2.5, 1.875}`：`2.5000…/2.5000…/2.5000…`（对角两发是 `2.5000000000000004`）＋ 12×`1.875` |
| 第 16 发 | id 3、owner 1、kind plasma、pos (22.58,44.33)（Boss 在 (16.5,46)）、vel (2.17,1.24) ⇒ 速度 **2.5** |
| `postDiag.coreIds == adapterIds` | **`[3..18]` 两边完全一致，coreLen=adapterLen=16** |
| `created = w.projectiles.slice(c0)` | `c0=0` ⇒ 16 项（`[3..18]`）⇒ `count=16` 红 |

`boss-volley-bossrun1.json`（同字节、绿）：`preDiag.coreLen=1`（`coreIds=[3]`）、`preDiag.queued=[]`、`createdIds=[4..18]`（`slice(1)` = 15）、事件 15 个全 owner 4。

**⇒ 两次运行“同一个敌人也开了枪”，区别只是那一发在**测量前**提交（进 `c0`，被排除）还是**落在测量步**（进 `created`）。**这一句比“load flake”准确**：run1 不是“没有别的敌人开火”，而是“别的敌人的弹早一帧提交”。

## 2. CONFIRMED — 机制与代码（逐条对源）

| 主张 | 核对 |
|---|---|
| Boss 15 = 3 + 12，且两档速度来自真实常量 | `Boss.fireLaser()` 3 发（`BOSS_LASER_SPEED_PX=160 → 2.5`）、`shockwave()` 12 发（`=120 → 1.875`，带 `lifetime 3`）：`src/entities/Boss.ts:15-16,165-188` |
| Boss 与普通敌人走**同一个**入队路径 | `World.spawnEnemyProjectile` = `enqueueCommand({type:'spawn-enemy-projectile', ownerId,…})`（`World.ts:1781-1784`）；core 在 `processCommands` 里提交并推 `projectile-spawned{projectile}`（`core.ts:708-713`），`SimProjectile` 自带 `id/ownerId`（`core.ts:142-156`），id 由 `state.nextProjectileId++` 单调分配（`core.ts:832`） |
| legacy 敌人在 tick **之后**开火 ⇒ 命令落到下一帧 | `stepFrame` 末尾 `if (ticks>0) this.updateLegacy(delta/1000)`（`World.ts:1904`）；`updateLegacy` → `e.update(dt, port)`（`:2292-2299`）→ `Enemy.doAttack` → `world.spawnEnemyProjectile`（`Enemy.ts:137-147,258-272`）。这是**唯一**的非 drone 敌人开火路径（我 grep 全仓，`spawnEnemyProjectile` 只有 `Boss.ts:169/181` 与 `Enemy.ts:270` 三个调用点） |
| `resetProjectilesForTest()` 同时清 core 与 adapter | `World.ts:95-105`：`coreProjectileViews.clear()` ＋ `this._sim.projectiles = []` ⇒ Tester 的 “may not clear the core list”（`boss-volley-drift/README.md` 的线索）**不成立**；两次 diag 运行 pre 状态 0/0、1/1 也印证 |
| 本次没有索引错位 | 见 §1：`coreIds == adapterIds`（16/16，同一顺序）⇒ 本次红**不能**归给 `c0` 的表示混用；但那个混用仍是**潜在**脆弱点（只在两集合等长同序时才成立） |
| 不是 drone 打的 | `droneAlive 0`（两次运行）；drone 开火走固定 tick 的 `stepDrones`，不会经 `updateLegacy` |
| 不是 Boss 的旧弹 | 测量前队列里唯一一条是 `#1`，不是 `#4` |

## 3. CONFIRMED — 确定性反例（core 级）

`diag/boss-volley.check.mts` 只用真实导出（`createSimulationState / enqueueCommand / stepSimulationTicks / generateRealMap / basePlayerData`），无任何直写：先入队 1 条 owner 1 的 `spawn-enemy-projectile`，再入队 15 条 owner 4（3×2.5 + 12×1.875），跑 **1 个真实 core tick** → `spawnedEvents 16 / byOwner {1:1, 4:15} / bossEvents 15 / coreProjectiles 16`，日志 `boss-volley-check.log.txt` EXIT=0。
**边界说明（应写进文档，不是错误）**：它证明的是 **core 的归属性质**，不是“Boss 通过 `fireLaser/shockwave` 产出 15”——那 15 条是手写入队、模拟 Boss 的调用效果；Boss 真身产出 15 已由 §1 的 run2 事件直接证明。

## 4. UNKNOWN（不得在当前证据上推进）

- **run9 现场**：那一次 16 的成员、owner、是否队首有旧弹，全部未知（`bossInit` 未落盘）。可说的是“同一份产品字节 + 同一份 spec 在我们的复跑里得到 16，并逐事件解释了它”；不能说“run9 的第 16 发就是 owner 1 的旧弹”。（run9 全量与孤立重跑**都是 16**：`full-e2e-155.log.txt:31-32`、`diag-audit-boss-bullets-isolated.log.txt:12-13`；而 Developer 的 diag 副本是先 15 后 16。）
- **owner 1 的敌种**：未记录（只有 ownerId）。
- **run9 那次“其它”是不是 1 发**：sentry 一次 2 发、shiver 一次 3 发；若那次是这两种，`count` 会是 17/18。
- **occurrence 是时间相关的**（这条我建议收窄 Developer 的“not load flakiness”）：`Enemy.update(dt)` 的 `attackTimer -= dt` 用的是 **`stepFrame` 的 real frame delta**（`Enemy.ts:144`；`World.ts:1904` 传 `delta/1000`，正常帧是真实帧间隔、上限 250 ms），所以“那一发落在 setup 步还是测量步”取决于真实帧时序历史；而**一旦落进测量步，归属就是确定的**。准确表述：**归属确定、发生时相依赖**（与 ECHO 的 batch-gap 同类），而不是“纯粹的加载偶发”，也不是“纯模型错误所以永不发生”。

## 5. 对拟修契约的判断（Tester 侧，产品零改动）

### 5.1 可以接受并应照做的部分（Developer §7 的 1/2/4）

- **按事件 owner 归属**：`spawns = stepEvents.filter(e => e.type === 'projectile-spawned')`；`volley = spawns.filter(e => e.projectile.ownerId === bossId)`；`expect(volley.length).toBe(15)`（**不是 `>= 15`**）。`bossId` 在调用前从 `boss._id` 取一次。
- **用 volley 的 id 建检查集**：`const ids = new Set(volley.map(e => e.projectile.id))`；`const created = w.projectiles.filter(q => ids.has(q.data.id))`（顺带断言 `created.length === ids.size`，即 core 的每个 volley id 都能在 adapter 找到 sprite——这条同时守住旧的“core/adapter 同步”隐含前提，且不再依赖 `c0`）。
- **记录而不是吞掉 others**：`others = spawns.filter(...)`，把 `{ownerId, kind, pos, vel}` 全部写进返回对象（并进失败消息），`expect(new Set(spawns.map(e=>e.projectile.id)).size).toBe(spawns.length)` 断言 id 互异。
- **不加 `>= 15`、不过滤掉第 16 发、不清敌、不冻结其他敌人造静窗、不改 `toBe(15)`**。

### 5.2 必须补的三处护栏（缺了不算 airtight）

1. **Boss 侧先验：测量前不允许有 Boss 自己的待发弹。**
   现在的 setup 步（`enqueueTargetMove` 后的那次 `stepFrame`）跑在 `boss.attackTimer = 999999` **之前**；若那一刻 Boss 的 `attackTimer ≤ 0`，它会经 `updateLegacy` 入队 3 或 15 条 **owner 4** 的命令，在测量步里一并提交 ⇒ owner 归属也救不了，`volley` 会变成 18 或 30。
   最小护栏（只读、不“清队列”）：

   ```ts
   const preSpawns = w.sim.pendingCommands.filter(c => c.type === 'spawn-enemy-projectile');
   const preFromBoss = preSpawns.filter(c => c.ownerId === boss._id);
   expect(preFromBoss, 'no boss volley was already queued before the measured volley').toEqual([]);
   ```

   并把这些 `preSpawns`（其它 owner 的）与 `others` 一起记录——它们正是第 16 发这类东西的来源。
2. **速度用多重集，而不是 max/min。**
   现在的 `maxSpeed/minSpeed` 无法区分 **3+12** 与 4+11 / 2+13（"Boss 发 3+12" 的本义只在名字里）。用 volley 的速度集合做精确计数：`|s-2.5|<0.01` 恰好 **3** 个、`|s-1.875|<0.01` 恰好 **12** 个（其余 0 个），同时保留 `min>0`、`max<=3`。注意对角激光是 `2.5000000000000004`，必须用容差。
3. **`afterHalf` 收窄到同 volley 的 id。**
   现版本对**全世界所有** projectile 断言 `visible == count`、`lifetime > 0`、`every(on screen)`（`tests/audit.spec.ts:791-806`）。无关敌弹在这 0.5 s 内完全可能离开视口或被 `Enemy` 之外的路径移除 ⇒ 误红。
   改成：`survivors = afterHalf.bullets.filter(b => ids.has(b.id))`；断言 `survivors.length > 0`、`survivors.every(visible)`、`survivors.every(lifetime>0)`、`survivors.every(screen 在 1280×720 内)`、至少一发相对 `bossInit` 同 id 位移 > 0.05。这些正是原意（“Boss 的弹 0.5 s 后还在飞、还可见、还在屏内”），只是主语从“世界”改回“volley”。

### 5.3 建议但非必须

- 记录 `tickBefore/tickAfter`（`resetSimulationAccumulator()` + `1000/60+1e-6` 应恰好 1 tick），让“测量步”可核。
- 若 `preSpawns`（非 Boss）非空，可断言 `others.length === preSpawns.length`——前提是 `droneAlive === 0`（drone 开火会额外贡献非 Boss 事件）；这能把“所有 16 个事件都能指向一次显式入队”变成硬断言，而不是仅记录。
- 事件负载已含 `pos/vel/lifetime`，`bullets[]` 里的 `vel` 可直接取自事件（与 adapter 的 `q.data.vel` 交叉核对一次即可）。

## 6. 是否保护原“Boss 发 3+12 且有 sprite/速率”的本义

**是，且更强。** 保留并加严的：`volley.length === 15`（按 owner 精确）；3×2.5 / 12×1.875（由 max/min 改为多重集）；每个 volley id 都有 sprite（`created.length === ids.size`）；sprite 可见、屏内；0.5 s 后仍存在、仍可见、仍在屏内、确有位移（改为同 id 追踪）。
被去掉的只有一条**从来不在断言名里**的副作用：“这 0.5 s 内世界里不允许出现别的敌人的弹”。它既不是 Boss 的安全性质，也不是产品保证（legacy 敌人在 `updateLegacy` 里本来就会持续开火）。所以**原 Boss 安全意义没有任何一条被删或放宽**；原文的 `count===15` 精确定量也保留（没有退化成 `>=15`）。

## 7. Gate（本轮只读）

| 检查 | 结果 | 路径 |
|---|---|---|
| 16 事件归属（owner 1×1 + owner 4×15，id 4–18） | **PASS（复算）** | `…/p4-recovery/diag/boss-volley-bossrun2.json` |
| Boss 速度 3×2.5 + 12×1.875 | **PASS（复算：{2.5, 1.875}，计数 3/12）** | 同上 |
| core/adapter id 列表一致（无索引错位） | **PASS**（两侧 `[3..18]`，16/16） | 同上 |
| 测量前队列有 owner 1 的旧弹 | **PASS**（`preDiag.queued=['spawn-enemy-projectile#1']`） | 同上 |
| 绿轮同字节的对照（旧弹落在 setup 步） | **PASS** | `…/diag/boss-volley-bossrun1.json` |
| Boss 15 = fireLaser(3)+shockwave(12)、速度常量 | **PASS（代码）** | `src/entities/Boss.ts:15-16,165-188` |
| legacy 敌人经 updateLegacy 入队、下一帧提交 | **PASS（代码）** | `World.ts:1904,2292-2302`、`Enemy.ts:137-147,258-272`、`World.ts:1781-1784`、`core.ts:708-713` |
| `resetProjectilesForTest()` 双清 | **PASS（代码 + 两次 pre 状态）** | `World.ts:95-105` |
| core 级反例 | **PASS**（16 / byOwner {1:1,4:15}） | `…/diag/boss-volley.check.mts`、`boss-volley-check.log.txt` |
| 拟修契约是否已存在 | 不适用（本轮无 Tester 新 diff；到手后我按 §5.1/§5.2 增量核） | — |

## 8. 判定

- **诊断成立**：本次 16 = Boss 15 + 其它 owner 的 1 发旧弹（测量前已在队列）；机制为 legacy 敌人 `updateLegacy` 入队 + 下一帧提交；本次**无** core/adapter 索引错位。**产品 v4 不改**。
- **run9 现场仍是 UNKNOWN**，不因本次复现被“重建”；owner 1 的敌种、run9 的第 16 发成员都不宣称。
- **拟修契约可接受**，但**必须**补 §5.2 的三条（Boss 待发先验 / 速度多重集 / `afterHalf` 收窄到 volley id），否则要么仍可能红（Boss 旧弹），要么漏掉“3+12”的本义，要么继续被无关敌弹误红。
- 不变：P4/E2E 仍 154/155，B7 默认并发 857/859 风险、P5 未实现、HUMAN ACCEPTANCE PENDING，整体仍非 PASS。

> 附（范围外的一句记录，不展开）：run9 冻结的 `tests/ai-native-world.spec.ts` = `855eb948…`，**不是**我 run8 批过的 `c33f16c7…`（`run9-ai-disable-final/HASHES-PRE-RUN.txt:10` 自己写明了“was c33f16c7 = reviewer-approved green”）。那处改动不在本轮范围内，需要时另开增量核。

---

## 9. run10（`6ea30e8b`）— 最终测量归因 diff 增量核：**PASS，可提交，可开始一次完整 155**

只读增量（未跑 full/859、未起端口、未改 src/tests、未 commit）。输入 `D:/Project/LAST_SIGNAL/reports/gameplay-01/tester/p4-final/run10-boss-volley/`（`HASHES-RUN10.txt`、`before-spec/`、`after-spec/`、`diff-audit.spec.ts.diff`（141 行）、`logs/targeted-2of2.log.txt`、`evidence/boss-volley-events.json`）。

### 9.1 字节与范围（实算）

| 项 | 实测 | 结论 |
|---|---|---|
| **最终 after** | `6ea30e8b1338862eb00c1cc8a54b4687d9a23f8f152cad4e605faafbdbd6dcea` = `after-spec/` = **现盘 `/d/tmp/ls-p4-v4/tests/audit.spec.ts`**（三处一致） | 与你给的 SHA **一致** |
| before | `fe43dc48…`（run9 携带的 CRLF 字节） | 未改、保留 |
| diff | **4 hunk / +79 −19 / 141 行**；只删 1 条 `expect`（旧的 `count===15`） | 其余 136 条 audit 断言原样 |
| `expect(` 总数 | **137 → 143**（+6 净增）；`test.skip`/`.only(`/`test.setTimeout` 全 0（前后一致） | 无放宽、无跳过 |
| 产品 10 源 | 仍 = `manifest.v4`（core `f71523e1`、World `349544bf`、worldHeadless `7382d6f0`、p1Scenario `76367087`、relay `6fc7ba40`）；主仓 HEAD `2b67106` 对 `src/` 与 `d55e502` 无差异 | 产品零改动 ✓ |
| 其它 tester spec | P1/P2/P4/probes/ai-native-world（`855eb948`）全部未动 | ✓ |
| 定向 | `logs/targeted-2of2.log.txt`：**PASS 2/2，18.6s，exit_code=0**，`audit=6ea30e8b…` | 采信日志，未重跑 |

### 9.2 你逐项要求 → 实际行号

| 要求 | 实现 | 判定 |
|---|---|---|
| 同一次 `stepFrame` 的**真实** `projectile-spawned` 按 `ownerId === bossId` 分桶 | `:776` `const events = (w.stepFrame(1000/60+1e-6, neutral) ?? [])`；`:777-778` `bossId = boss._id`、`spawned = events.filter(type==='projectile-spawned')`；`:779-787` `describe()` 取 **payload** 的 `id/ownerId/kind/source/pos/vel/speed`；`:788-789` `volleyEvents`/`otherEvents` 由 `e.projectile.ownerId === bossId` 分 | **PASS**（真 payload，无自造） |
| volley 恰好 15（不是 `>=`） | `:827` `expect(bossInit.volley.length, 'laser(3)+shockwave(12) BOSS projectiles created').toBe(15)` | **PASS** |
| `spawnedTotal === volley + others` | `:824-825` | **PASS**（分区恒等式，起文档作用） |
| ID 互异 | `:826` 只对 **volleyIds** 断言 `new Set(...).size === volley.length` | **部分**：未对「全部 spawned」断言（core 的 id 由 `nextProjectileId++` 单调分配，冲突理论不可能）→ 见 §9.4-① |
| others 里不含 boss | `:828` `others.some(o => o.ownerId === bossId)` 必须为 false | **PASS** |
| 按 ID 取 adapter 的 15 发，不得丢 | `:791` `byId = new Map(w.projectiles.map(q => [q.data.id, q]))`；`:793-800` 用 `volleyIds` 逐个查 → `null` 计数；`:833` `adapterMissing === 0`；`:834` `bullets.length === 15` | **PASS**（用 ID 交叉表示取代 `c0` 切片；run10 证据 `preExisting coreLen=1, adapterLen=1` 而 `bullets=15`，正好证明旧 `slice(c0)` 的脆弱已被消除） |
| 速度 histogram 精确 3×2.5 + 12×1.875 | `:830-832` 用**事件速度**过滤后 `toEqual([3,12])`；因为 `volley.length===15` 且 3+12=15，第三档速度无处可藏 | **PASS**（并保留了原 `max≤3`、`abs(max−2.5)<0.01`、`abs(min−1.875)<0.01`） |
| after 0.5 s 只跟 same IDs 的存活者，原 5 条阈值不动 | `:849-850` 传入 `volleyIds`；`:854` `survivor = w.projectiles.filter(q => ids.includes(q.data.id))`；`:865` `count>0`、`:866` `visible===count`、`:867` `lifetime>0`、`:872` `moved>0.05`、`:873-874` `screen∈(0,1280)×(0,720)` | **PASS**（五条全保留，主语从“全世界”改为“volley 存活者”，与我的 §5.2-3 一致） |
| 所有其它 audit 断言未删 | `diff` 中 `^-.*expect(` **仅 1 条**（被替换的旧 count）；shade/light/weapon/sound 等块不在 diff 里 | **PASS** |
| 断言前把**全 payload** 落盘 | `:818-823` `mkdirSync(SHOT_DIR)` + `:819` `writeFileSync(... 'boss-volley-events.json', {note, ...bossInit})`，位置在**所有** boss 断言之前；`bossInit` 含 `spawnedAll`（全量事件）、`volley`、`others`、`volleyIds`、`adapterMissing`、`bullets`、`speeds`、`preExisting`、`pendingBefore` | **PASS**（失败也能拿到归因；落盘目录 `SHOT_DIR` 默认 `screens/`，已被 `.gitignore:16` 忽略，不会污染仓库） |
| 无 fixture 清敌 / 清 pending / 过滤第 16 发不记录 | 无 `clearEnemies`；无 `pendingCommands` 清空；`others` 全量进 JSON 且不参与“必须为 0”的断言；`spawnedAll` 逐条保存 | **PASS** |
| 2 次 `others=0` → 分支未触发，需坦诚 | `HASHES-RUN10` “BRANCH NOTE”明确写“未在这两次触发，红路径只由 developer diag + core 反例支撑”；我复算 `evidence/boss-volley-events.json`：`spawnedTotal 15 / volley 15 / others [] / pendingBefore [] / preExisting 1·1 / adapterMissing 0 / hist {2.5:3, 1.875:12} / 15 ids [4..18] 全 visible 且在屏内` | **PASS（口径诚实）** |
| 过滤是否会掩盖 Boss 真的发 16 | 不会：`volley` 是按**真 payload owner** 过滤，若 Boss 发 16 则 `volley.length=16` → `:827` 红；且 histogram 变成 `[4,12]`/`[3,13]` → `:832` 也红；全文无 `slice(15)`/无截断（我 grep `slice(15`、`slice(c0` 均为空）；16 条全 payload 也已落盘 | **PASS** |

### 9.3 对“是否保护原 Boss 安全含义”的复核

保留：恰好 15（改按 owner 归属，更严）、3×2.5/12×1.875（由 max/min 升级为直方图）、每个 volley id 都能在 adapter 找到 sprite（`adapterMissing===0` + `bullets.length===15`，比原来的 slice 更严）、sprite 可见、屏内、0.5 s 后仍存在/可见/未过期/有位移/仍在屏内。
被去掉的只有那条“同一帧里不允许出现别的敌人的弹”——它不是 Boss 的安全性质，也不是产品保证（legacy 敌人在 `updateLegacy` 里持续开火）。**没有任何一条 Boss 断言被删或放宽。**

### 9.4 残留（三条 LOW，均不阻断）

1. **ID 互异只覆盖 volley**（`:826`）：建议 `expect(new Set(bossInit.spawnedAll.map(e => e.id)).size).toBe(bossInit.spawnedTotal)`，一行、零风险；今天 core 的 id 单调分配，冲突不可能，属加固。
2. **`pendingBefore` 只记 `type`**（`:773`），未记 ownerId，也没有“Boss 自己在测量前没有待发弹”的前置断言（我 §5.2-1）。现状不会静默放过：若 Boss 有旧 volley 在队列，测量步会把它们一并提交 ⇒ `volley=18/30` ⇒ `:827` 必红（只是报错文案会含糊）。建议一行改成 `type#ownerId` 并可选加断言。
3. **两次定向的 `others` 都为空**，红形态（16）只由 developer 的 `bossrun2` + core 反例支撑——HASHES 已如实写，不算“冒充”。**提示**：完整 155 里 legacy 敌人正在持续开火，很可能是 `others` 分支第一次在 CI 里真正执行；那正是本次修复的目标分支，届时若红，`boss-volley-events.json` 会直接给出 owner/pos/vel。

另（非本 diff 问题）：`mkdirSync(SHOT_DIR)` 现在在同一测试里出现 3 次（`:71/:579/:818`），冗余但无害；JSON 落在 `screens/` 目录只是沿用既有截图目录约定（可改用专门的 evidence env，非必须）。

### 9.5 Gate（本轮只读）

| 检查 | 结果 | 路径 |
|---|---|---|
| 最终字节 = 归档 = 现盘 | **PASS**（`6ea30e8b…` 三处） | `…/run10-boss-volley/after-spec/audit.spec.ts`、`D:/tmp/ls-p4-v4/tests/audit.spec.ts` |
| before 未改 | **PASS**（`fe43dc48…`） | `…/before-spec/audit.spec.ts` |
| 产品 10 源 = manifest.v4 | **PASS** | `…/HASHES-RUN10.txt`；主仓 `git rev-parse`/sha |
| diff 范围（4 hunk / +79 −19 / 仅删 1 条 expect） | **PASS** | `…/diff-audit.spec.ts.diff` |
| 逐项归属实现（§9.2 全表） | **PASS** | `…/after-spec/audit.spec.ts:776-800,818-834,849-874` |
| 定向 2/2 | **PASS 18.6s exit 0**（采信，未重跑） | `…/logs/targeted-2of2.log.txt` |
| 证据复算（15/15/others 0/hist 3·12/ids 4–18/adapterMissing 0） | **PASS** | `…/evidence/boss-volley-events.json` |
| others 分支未触发且已标注 | **已记** | `…/HASHES-RUN10.txt`（BRANCH NOTE） |
| run9 154/155 与失败包保留 | **PASS**（未覆盖） | `…/run9-ai-disable-final/` |

### 9.6 判定

- **PASS：这处 diff 可提交。** 归属用真实 `projectile-spawned.projectile.ownerId`，volley 恰好 15（非 `>=`），others 全量记录、不进“必须为 0”的断言、不被隐藏；速度改为事件级直方图 3+12；adapter 侧改为 **按 ID 交叉查找**（取代 `c0` 切片，run10 的 `preExisting 1/1` 与 `bullets 15` 直接证明该改进生效）；0.5 s 检查收窄到同 volley ids 且五条阈值原样；其余 136 条 audit 断言一字未动；全 payload 在任何断言之前落盘。
- **可以开始一次完整 155。** 定向 2/2 连续 `exit 0`、字节与工作盘一致、产品零改动、无 skip/超时/阈值变化。
- **无阻断**；§9.4 三条为加固/记录项（其中 ① 一行 ID 去重、② `pendingBefore` 带 ownerId 建议下次触碰时顺手加上）。
- 结论只覆盖 `6ea30e8b` 这一处测试改动；run9 的全量记录仍为 **154/155**（不因本轮被判为 155），B7 默认并发 857/859 风险、P5 未实现、HUMAN ACCEPTANCE PENDING 均不变，整体仍非 PASS。
