# GAMEPLAY-01 · P0 两项旧测试修复 · 独立审查（Reviewer · 只读）

**结论：PASS（无阻断）。** 两处修改都在**测试层**、都用**既有 dev/test seam**、没有放宽断言、没有发明状态；
但有 4 条非阻断需要记录（含一处「after-fix 日志命名会误导」和一处由 seam 决定的**能力边界**）。
本轮**不改产品**（`src/` 除既有的 P1 patch 外无新改动），因此这两项修复**不构成任何玩法改进声明**。

## 0. 冻结与范围

| 文件 | 实算 SHA256 | 与 Lead 给定 |
|---|---|---|
| `tests/ai-native-world.spec.ts` | `23f4961dd0cf076e…7c7c2d8e` | ✅ 一致 |
| `tests/ui-menu-layout.spec.ts` | `8aa12c9eda2840c8…0e7b549c20` | ✅ 一致 |

diff 规模：`ai-native-world` **+131/−4**、`ui-menu-layout` **+25/−6**（合计 +146/−10），与 Lead 描述一致。
时间线核对：两个文件 mtime = **21:18 / 21:20**；`p3a-after-fix-4..7`（20:57–20:59）是**更早的中间版本**，其失败断言
`preWindow.legacyEnemies === 1` 在冻结版里**已不存在**（`grep -c preWindow` = 0），而 `p3a-after-fix-1..3`（21:19–21:20）在冻结字节之后 → **3/3 绿对应冻结版**。

---

## 1. P3a（`tests/ai-native-world.spec.ts`）

### 1.1 用的全是既有 seam（在 `c7e03c5` 就有，不是本次新增）

`simFixture`（`World.ts:197`，`assertDevTest()` 守卫，生产环境 throw）、`stepSimulationTicksForTest`（`:1478`，`__LAST_SIGNAL_DEV_TEST__` 守卫）、`clearEnemiesForTest`、`resetProjectilesForTest`、`spawnEnemy`、`setPlayerPositionForTest` —— 我逐个在 `git show c7e03c5:src/world/World.ts` 里确认存在。
唯一的「原始状态写」是 `w.simFixture.pendingPlayerHits = []`（清队列，不写 HP/坐标/计时），且正是 Lead 指定的做法；`echoInvuln` 只读不写。
→ **没有私造 core 状态，没有改 dev 门禁语义。**

### 1.2 隔离与归因是否成立

顺序：清全部敌 + 清在飞弹 + 清待结算伤害 → 生成**恰好一只**真 drone（echo 旁 1–3 格、`isWalkable` 校验）→ 主角移到**20–30 格**外的可走格（并断言 `isWalkable` + `droneToPlayer > 12`，无人机攻击范围 5 格）→ 先用**真实帧**等到 `echo.invuln ≤ 0` → `stepSimulationTicksForTest(300)` 收事件。

断言强度（都强于原来）：`drones0 === 1`、`echoInvuln0 ≤ 0`、`echoHurt.length > 0`、**每条 `echo-hurt` 的 `actorId === echo actorId`**、`playerHurt` 为**空数组**、`pending === 0`、`echoAfter < echoBefore`、`playerAfter === playerBefore`、`playerWalkable`。
**原有三条断言逐字保留**（`echo takes real damage independently` / `protagonist HP is unaffected` / `HUD still reports the echo`）。
原来的 `for 50 × waitForTimeout(300)` 轮询换成确定性窗口 —— 这是稳定性修正，不是放宽（没有改任何阈值）。

### 1.3 我独立跑的结果（当前工作区，含 P1 patch）

`PORT=5482 LS_AI_EVIDENCE_DIR=…/reviewer/p3a-smoke npx playwright test tests/ai-native-world.spec.ts --grep "P3-a" --workers=1` → **PASS**（1 passed / 43.3s）。
证据（`reviewer/p3a-smoke/operation-log-p3a-echo-1280x720.json`）：

```
echoId=1  echoInvuln0=0  drones0=1
echoHurt=[{actorId:1, damage:7}]   playerHurt=[]   pending=0
hp: echo 86→79   player 82→82   playerWalkable=true
```

→ 归因（只有 echo 受伤、主角零伤害）在我这边**独立成立**。

### 1.4 能力边界（必须如实记录，已在测试注释里写对）

`core.ts:1354` 是 `if (echoIntent) stepEcho(...)`；`stepSimulationTicksForTest` **不传 echoIntent** → 窗口内**不会 stepEcho**：echo 不移动、i-frame 不衰减、计时不推进。
我的独立数据印证了这一点：300 tick（5s）里只落了 **1 次** `echo-hurt`（damage 7），因为首击后的 iframe 在窗口内永不衰减。
→ 该窗口**只能证明"谁被伤害"**，不能证明持续伤害、echo 移动或计时；测试注释已显式写明，且 `echoInvuln0 ≤ 0` 的硬断言保证「残留 iframe」不会伪装成绿。
**若将来需要"持续伤害/移动/计时"证据，不能用这个 seam，必须用真实帧窗口。**

### 1.5 fixture 是否影响早前战斗段

fixture 位于 test 尾部，之前已完成跟随/驻守/未确认不射击/确认真击杀等**真实战斗断言**；之后只剩三条原断言与 errors 检查 → 清房/移动主角不影响它们。✓

### 1.6 +131 是否过度

可读、可维护；但**可再省约 30–40 行**：`rangedLimit` 与 `attribution` 两个 `page.evaluate` 有重复的 drone 计数/距离检查，且 1s settle 的 `hpBefore` 与窗口内的 `echoBefore` 语义重叠。非阻断。

---

## 2. UI 证据目录守卫（`tests/ui-menu-layout.spec.ts`）

改动：`startsWith('reports/ui-rework-01')` → **`path.relative` 边界判定**，允许 `<repo>/reports` 下任意隔离子目录，拒绝越界。

我独立复算的 9 个用例（`reviewer/logs/p0fix-ui-guard-logic.log`，与实现同一算法）：

| 输入 | 结果 |
|---|---|
| `reports/ui-rework-01/after`（旧默认） | **ALLOW** ✅ |
| `reports/gameplay-01/tester/ui`（新任务） | **ALLOW** ✅ |
| `reports`（reports 根本身） | **REJECT** ✅ |
| `reports/..`（repo 根） | **REJECT** ✅ |
| `reports/../reports2/x` | **REJECT** ✅ |
| `../outside` | **REJECT** ✅ |
| `D:/tmp/ls-evidence`（绝对外部） | **REJECT** ✅ |
| `/c/Windows/Temp/ls-evidence` | **REJECT** ✅ |
| `reports/ui-rework-010`（旧 `startsWith` 会误放） | **ALLOW**（设计上属 reports 子目录，且不再与 ui-rework-01 混淆） |

`MISMATCHES=0`。另外：
- 守卫在**模块加载时**执行（`report_safe_guard();` 在文件顶部），非法值会让整个 spec 立刻红，**不吞、不 skip** ✓。
- 负向由 tester 日志佐证：`ui-guard-allowed.log` = 1 passed；`ui-guard-reject-{reports,reports____outside,_c_Windows_Temp_ls-evidence}.log` 三条都以 `UI_OUT_DIR must be an isolated directory inside D:…` **失败**（不是静默）✓。
- 旧默认兼容 ✓；`path.relative` 同时修掉了旧实现会把 `reports/ui-rework-010` 当合法的缺陷。

**非阻断**：`path.resolve` 不解析符号链接 —— `reports/` 内若有一个指向外部的 symlink，仍会被放行。本地证据目录场景风险极低，记录即可。

---

## 3. 非阻断清单（4 条）

1. **`p3a-after-fix-4..7` 命名会误导**：这 4 个失败日志来自**被冻结版淘汰的中间实现**（20:57–20:59，断言 `preWindow.legacyEnemies`），却与真正绿的 `after-fix-1..3` 同名序列。建议改名为 `p3a-iter-*` 或加 `SUPERSEDED` 前缀，避免后续审查把「after-fix 有 4 红」当成 flake。
2. **+131 可再瘦身 30–40 行**（见 §1.6）。
3. **窗口只落 1 次伤害是 seam 的固有边界**（见 §1.4）；若 P3/P4 需要持续伤害/移动证据，必须换真实帧窗口，不能继续用该 seam。
4. **symlink 未解析**（见 §2）。

## 4. 我跑的 gate（一行一条）

| 命令 | 结果 | 日志 |
|---|---|---|
| `PORT=5482 LS_AI_EVIDENCE_DIR=…/reviewer/p3a-smoke npx playwright test tests/ai-native-world.spec.ts --grep "P3-a" --workers=1` | **PASS**（1 passed / 43.3s） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/logs/p0fix-p3a-smoke.log` |
| 守卫算法 9 用例独立复算（node） | **PASS**（MISMATCHES=0） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/logs/p0fix-ui-guard-logic.log` |

未跑 180s 全量；未动 tester 的 `/d/tmp/ls-p1-tests` clone；未争用 5433 端口（我自起 5482 已关闭）。

## 5. 证据适用范围

- 我的 P3a smoke 跑在**当前工作区（含 P1 patch 的 src）**；tester 的 3/3 跑在**干净 `c7e03c5`（无 P1）**。两者都绿 → 该修复对 P1 有无都不敏感（P3a 不依赖 relay 设备）。
- 该修复**只证明测试夹具/归因正确**，不等于产品玩法/平衡改进；最终整体仍是 `ENGINEERING PASS / HUMAN ACCEPTANCE PENDING`（P1 tester 报告未齐，GAMEPLAY-01 未 PASS）。
