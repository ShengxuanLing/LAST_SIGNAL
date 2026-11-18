# GAMEPLAY-01 · P4 v4（legacy portal 单源修复）· 独立复核

审查者：独立只读。日期：2026-11-18。范围：**v3→v4 的 `src/world/World.ts` 单源修复**，目标是把
P4_TEST_REVIEW §6 中那两条 legacy portal 真回归闭环。无模型、无 `src/`/`tests/` 修改、未 commit/push；
主仓 `48b080d`（v3 集成）我只读、未热换；未使用 tester 5199/5492 与其 clone。

## 0. 冻结输入（先核字节）

| 项 | 值 |
|---|---|
| 工作树 | `D:\Project\LAST_SIGNAL\.cindy-worktrees\serene-leakey`，HEAD `3819621`，`commitsMadeByThisWorker: 0` |
| manifest | `…\reports\gameplay-01\developer\p4-recovery\manifest.v4.json`（`freeze.state = FROZEN for independent re-review (v4)`） |
| 我的快照 | `git archive 3819621` + v4 十源 + 四文档 → `D:\tmp\gp01-p4v4`；自有端口 **5498**（红验用 5497，均已关） |
| v3 冻结 | `…\p4-recovery\v3-freeze` 存在且未被覆盖 |

**14 个交付文件（10 源 + 4 文档）sha256 与 manifest.v4 逐一相同**，其中只有 `World.ts` 变了：

```
core f71523e1  p1Scenario 76367087  worldHeadless 7382d6f0  World 349544bf(改)  relay 6fc7ba40
relayRoutes.test 097bfc6f  demoRoute.test 11c812f7  layout.test 8b12cbf2  frameAuthored.test 93447a60
restoreSafety.test ec4139ff   docs 7c9a19bf / 80094d2d / 3a75fb96 / 62986032（均与 v3 相同）
```

v3→v4 实际 diff：**47 行变更（3 处门户调用点 + 新 helper + `findWalkableInRoom` 注释）**，无其他文件改动。

## 1. Gate（命令 → 结果 → 绝对日志）

| gate | 命令 | 结果 | 日志 |
|---|---|---|---|
| **RED 复现（我自己，v3 World `3ff4f7e3`）** | `PORT=5497 npx playwright test tests/runtime-bugs.spec.ts -g "cleared room always offers an exit portal"` | **FAIL**：`Error: start room portal is walkable` / Expected true, Received false | `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p4v4-red-on-v3.log` |
| **RED 复现（同上）** | `PORT=5497 npx playwright test tests/audit.spec.ts -g "fixed-seed playability regression"` | **FAIL**：`TimeoutError: page.waitForFunction: Timeout 8000ms exceeded` | 同上 |
| **GREEN（v4 World `349544bf`，同一份未修改 spec、原阈值）** | `PORT=5498 npx playwright test tests/runtime-bugs.spec.ts -g "cleared room always offers an exit portal"` | **PASS 1/1 (24.0 s)** | `…\reviewer\p4v4-red-green.log` |
| **GREEN（同上）** | `PORT=5498 npx playwright test tests/audit.spec.ts -g "fixed-seed playability regression"` | **PASS 1/1 (19.4 s)** | 同上 |
| typecheck | `npx tsc --noEmit` | **PASS 0 `error TS`**, TSC_EXIT=0 | `…\reviewer\p4v4-typecheck.log` |
| 必要 checkpoint/portal 定向 | `PORT=5498 npx playwright test tests/checkpoint.spec.ts tests/echo-portal-migration.spec.ts tests/signal-human-crossroom.spec.ts` | **PASS 8/8 (30.4 s)** | `…\reviewer\p4v4-portal-checkpoint.log` |
| 退化 fallback 可达性探针 | `npx vitest run src/reviewer/p4v4-probe.test.ts`（仅我的快照） | **PASS 1/1**；10 seed × 6 房间 = 60 房间，**没有一间**缺 centre 格 | `…\reviewer\p4v4-centre-probe.log` |

**红→绿是我自己跑出来的，不是抄开发者日志**：同一份 spec 字节（runtime-bugs/audit 均为基线原文件，未改）、
原断言、原 8 s 阈值；只有 `World.ts` 从 v3 换成 v4。开发者 `v4/red/*.log.txt` 与 `v4/green/*.log.txt` 与我的结果一致
（其 red 报错行同为 `start room portal is walkable` / `Timeout 8000ms`）。

## 2. diff 逐点审查（`v3-to-v4-World.diff`）

1. **统一校验点/呈现点**：新 `findWalkableCentreInRoom(r, near?)`（`World.ts:1384-1401`）遍历房间内格子，
   用 `cellCentre(tile)` 得到**中心**，以 `isWalkable(centre.x, centre.y, 0.5)` 校验，返回该中心；锚点默认房间中心、
   可传 `near`。`placePortalForTarget`（`:1376`）与两个 deck-exit 呈现点（`:1341`、`:1344`）全部改用它，
   `makePortal` 收到的就是被校验过的同一坐标 → **“贴图/交互/校验同点”成立**。
2. **作者路线门户不变**：`updateP1RoutePortal` 仍走 `makePortal(target, route.portal)`（`:700`），
   `route.portal` 本就是格中心，未受本次改动影响（diff 未触及该函数）。
3. **位置类调用不迁移**：`findWalkableInRoom` 只多了注释（明确“POSITIONS ONLY（spawns/landings/boss），
   门户请用 centre 版”），实现未变；其既有调用点（`:1494` boss spawn、`:1536` 房间切换 landing、`:1568`、`:1599`、
   `:2505` 恢复位置）全部仍是整数格坐标 → **没有被“顺手”改成半格**。
4. **旧 bug 的根因准确**：原循环用 `isWalkable(tile.x, tile.y, 0.5)`（格角四邻格采样），而 beacon 放在中心
   （采样格自身四角），两者是**不同谓词**，所以会选出玩家站不上去的“门户”。本次不是把 beacon 挪回格角，
   而是把校验挪到中心 → 与 `P4_TEST_REVIEW` 的定性一致。

## 3. 退化 fallback（Lead 要求单列）

`findWalkableCentreInRoom` 在**没有任何 centre 合格格**时返回 `cellCentre(房间中心格)`（`:1400`），注释写明
“keep the previous fallback point so the room still gets a beacon; generated rooms always qualify”。
- 我的实测：10 个 seed × 6 房间 = **60 个房间，0 个缺 centre 格**（`p4v4-centre-probe.log`）。所以该 fallback
  在当前生成器下**不可达**，作者路线也不走它。
- **但这只是“未触发”，不能当作“所有房间都有解”**：手写/未来的房间图或极端窄条房仍可能落到这个点，
  而该点可能不可站立（就是本次回归的同一类问题）。这属于**legacy 保留风险**，代码注释已如实标注。
- 是否需要改成显式失败？我的判断：**不必**。理由：(a) 现状在生成地图上 60/60 有解；(b) 改成返回 `null`
  会让退化房间直接无门户（可能变成软锁），比“有个不可站的门户”更糟；(c) 加 3 行的 debug 断言/日志即可让同类问题
  再次出现时可见，但这属于可选打磨，不是本单阻断项。**不建议为此扩整个地图/门户框架。**

## 4. 开发者侧 14/15 与 P1 6/7 的口径

- `v4/green/portal-checkpoint-targeted.log.txt`：**14 passed / 1 failed**。失败的是
  `tests/companion-room-race.spec.ts:208` “T1 delayed room notification 4000ms…”（`Error: the real Owner-shaped
  notification reached the handler`）。**manifest 写的是 `:274`，与实际红行 `:208` 不符**——记录口径小错，需修正。
- 孤立 `3/3 passed`（`companion-room-race-isolated.log.txt`）只能说明“负载相关/时序敏感”，**不等于该问题已解决**；
  开发者自己也写了 `unrelated P2 race, no assertion touched` 且未修。**我同样记录为未修**，最终判定归 Tester 全链。
- `v4/green/authored-p4-p1.log.txt`：P1 6/7，唯一失败是基线里那条**旧门距断言** `tests/gameplay-01.spec.ts:578`
  （`> JAM_RANGE`）。这是已裁决的 F7，tester 的冻结 P1 spec（`a7db1885`）已把它换成“门内自然 Jam 成本 25 + 走远拒绝”，
  所以**不是 v4 缺陷**，也不能拿基线旧 spec 的红去否定 v4。

## 5. 判定

- **两条真产品回归（runtime-bugs “start room portal is walkable”、audit “fixed-seed 站门户 8 s”）
  → CLOSED**：同一份未修改 spec、原阈值，v3 我复现为红、v4 复现为绿；根因修正方式正确（校验点=呈现点），
  且作者门户与位置类调用均未被半格迁移。
- **来源与冻结**：v4 只有 `World.ts` 变（`349544bf`），其余九源四文档与 v3 逐字节相同；v3-freeze 保留；
  我按 archive 3819621 + v4 十源重建快照，未用主仓的 v3 World，也未碰主仓 `48b080d`。
- **建议**：把 `src/world/World.ts` 的 `349544bf` 版本随 v3 九源一起集成；无需新增产品修改
  （fallback 可保留，见 §3）。集成后请 Tester 在另一棵树跑全链并**原地复跑**那两条 legacy 用例，
  保留 150/155 的历史记录，不得用定向绿回填。
- **口径必须保持**：fallback“未触发”≠“所有房间有解”；`companion-room-race:208` 是未修的负载敏感项，
  孤立 3/3 不是修复证据；P1 基线 `:578` 的红是已裁决的旧断言，tester 冻结 spec 已替换。
- **整体 GAMEPLAY 仍不是 PASS**：P5 与真人验收开放。

## 6. 本轮未验证

- 全量 E2E / 全量单测 / build / mcp-surface（按 Lead 指定 targeted only，归 Tester 另一树全链）。
- 只在 10 个 seed 上统计了 centre 格可达性；未穷举所有 seed，也未验证手写房间图。
- 未复跑开发者那 14/15 的完整组合（我只取了 checkpoint/echo-portal-migration/signal-human-crossroom 8/8 作为必要定向）。
