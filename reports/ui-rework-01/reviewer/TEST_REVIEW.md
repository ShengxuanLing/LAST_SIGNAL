# UI-REWORK-01 · 最终提交前 测试 diff 独立复核（Reviewer）

**结论：PASS —— 未发现断言弱化或安全断言丢失；两处“断言变更”实为契约升级（更严格）。`World.ts` −13 行作为前置基线修复：必要、无调用者、无阻断，可先单独提交。**
附 5 条非阻断观察（见 §6）。我是独立 reviewer，只读 src/tests，未改任何源码/测试，未 commit/push；自起的 dev server 已关闭。

## 1. 冻结与范围校验

- `src` 三文件 SHA256 与 Lead 给的冻结值**仍一致**：`PauseScene 3f01ebae…`、`menuKit c20131b2…`、`GameScene aec3ff04…`（复核开始与结束各取一次）。
- 本轮变更全部在 `tests/`：11 个旧 spec（`+186/−129`）+ 新增 `tests/uiNav.ts`、`tests/ui-menu-layout.spec.ts`；`src/` 无变化（除既有的 `World.ts` −13 行）。
- 测试报告 `reports/ui-rework-01/tester/REPORT.md` 声称的计数与**日志实读一致**：

| 声称 | 日志核对 | 结论 |
|---|---|---|
| unit 745/745（65 files） | `logs/32-unit.log` → `Test Files 65 passed` / `Tests 745 passed` | ✅ |
| typecheck 0 error | `logs/33-typecheck.log` 大小 0 字节 | ✅ |
| build PASS | `logs/34-build.log` → `✓ built in 8.50s` | ✅ |
| E2E 113/113（37 spec，13.7m） | `logs/37-final-e2e-full-rerun.log` → `113 passed (13.7m)`；`35-final-e2e-full.log` 同为 `113 passed` | ✅ |
| before 42 张 / after 48 张 | `before/*.png` = **42** ✅；`after/*.png` = **53**（48 为 6×8 页面图，另含 5 张功能性截图 `llm-connected` / `llm-pending-proposal` / `llm-after-reject` 等） | ⚠️ 数字口径小偏差，不影响结论 |
| after 每视口 0 clipped / 0 overlap | `after/audit-after-<w>x<h>.json` × 6 存在；`before/audit-before-*` × 6 亦在 | ✅ |

## 2. 我本轮独立跑的针对性 gate

| 命令 | 结果 | 日志 |
|---|---|---|
| `npx tsc --noEmit` | **PASS**（0 error） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/tsc-testreview.log` |
| `PORT=5173 npx playwright test tests/c3b-link-form.spec.ts --workers=1` | **PASS**（3 passed / 26.0s） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/pw-c3b-link-form.log` |
| `PORT=5173 UI_PHASE=reviewer UI_OUT_DIR=.../reviewer/audit/pw-ui-fixture npx playwright test tests/ui-menu-layout.spec.ts --grep "real pending proposal" --workers=1` | **PASS**（1 passed / 13.5s，真实 bridge + 官方 SDK 产生 pending） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/pw-ui-pending.log` |

未重复全量（113 / 745）——按要求只读日志核对。`PORT` 用 5173、`--workers=1`，与 tester 的 5433 不冲突。

## 3. 断言收支：10 条 expect 被删，18 条新增——逐条追平

`git diff 0faf95c -- tests/*.spec.ts`：`-expect(` = **10**，`+expect(` = **18**。10 条删除**全部**是「同一断言改写/升级」，无一条净丢失：

| 被删 | 替代 | 判定 |
|---|---|---|
| `actions.size > 1` | 同断言 + 报错时打印实测动作集合 | 等价（更可诊断） |
| `labels includes 'AI CONTROL: ON · LOCAL DEMO'` | 正则 `/AI CONTROL: ON · LOCAL/` **＋** 新增精确断言 root 的 `AI CONTROL: ON · LOCAL DETERMINISTIC DEMO` **＋** 新增 `EXTERNAL AGENT  NOT CONNECTED` | 更强 |
| `includes 'CONTROL  AI · LOCAL DETERMINISTIC DEMO'` | 正则同时接受两种真实文案 | 等价 |
| `grid.x/y toBeCloseTo(...,6)` ×2 | 同断言 + 打印实际差值 | 等价 |
| `settingsBefore.arrows toBe(4)` | 改为从真实 `◀/▶` 控件 bounds 取 4 个 + 新增 `labels === ['MASTER','SFX']` + 读真实百分比文本 | 更强 |
| `PauseScene closed by ESC from settings === false` | 拆成两步：先断言 `ESC→page==='pause'`（新契约），再 `resumeGame`，仍断言最终 `pauseActive===false` 且 `paused===false` | 更强（保留原终态） |
| 表单内 ESC 后 `form toBeVisible()` | 改为 `toHaveCount(0)` + 断言 `page==='settings'` + 暂停层仍开 + 控制权未变；CANCEL 路径另行断言 | 契升级，非放宽 |

**两处契约变更是产品行为变化（B6 ESC 只关表单、ESC 逐层回退）**，测试跟着契约走并额外锁定了中间态，属于加严。

## 4. Lead 点名的 5 个重点

### 4.1 `invuln=` 赋值 → `enqueueHeal`（只稳定非生存验收）
- 事实核对：`src/entities/Player.ts:64` `get invuln()` 只读（`world.playerInvuln` 视图），旧写法 `player.invuln = 1e9 / = 0` 在非严格模式下是**静默空操作**，故旧 spec 的“i 帧夹具”本身无效。
- 新实现（`stabilizeEvidenceRun`）：`if (p.hp > 0 && p.hp < p.maxHp * 0.35) w.enqueueHeal(p.maxHp - p.hp)` —— 真实 core 命令（`World.ts:1233`），下一 tick 提交；**只在濒死时**兜底，敌人/开火/伤害/位置/seed/控制权全部保留。
- 记录字段改诚实：`iframesWritten:false` / `hpToppedUpBelow35Pct:true` / `tickUntouched:true`（旧字段 `onlyIFramesRefreshed:true` 与事实不符，删除是正确的）。
- 生存验收未被绕过：P1 仍走真实 `hurt(999999)` 死亡路径；移动验收仍用 `hp 未变` 作前置守卫；`hp > 0` 的下界保证**死亡不会被 interval 复活**。
- 判定：**只稳定了“控制权/覆盖层”类用例，未削弱任何生存/战斗断言。**

### 4.2 P1 死亡步骤（等残余 i 帧 + 关闭 interval）
- 新代码：`for (let i = 0; i < 180 && gs.world.player.invuln > 0; i++) gs.world.stepFrame(1000/60, neutral)` → `hurt(999999)` → 再 10 tick 提交，**有界（180 tick ≈ 3s）**，走真实 core tick，不再依赖无效赋值。
- 断言完整保留：`GameOverScene` 出现、`owner==='human'`、`aiEnabled===false`、`authorityPaused===true`、死亡清 run checkpoint。
- sampler 的 `clearInterval(__aiPathTimer)` 仍在（`ui-menu-layout` 采样与 P1 采样都正确收尾）。
- 观察：`__lsKeepAlive` 这个 100ms interval **从未 clearInterval**——**与旧版一致**（旧版同样只 set 不 clear），作用域是单个 page，测试结束即随页面销毁；且 `hp > 0` 守卫避免影响死亡。判定：非本轮引入、无跨用例污染。

### 4.3 P3-a `protect=false`（真实 echo 伤害）
- `await stabilizeEvidenceRun(page, false)`（`ai-native-world.spec.ts:1332`），`protect=false` 直接 return，**完全不加血**。
- 关键断言仍在：`expect(hurt.echo.hp).toBeLessThan(hpBefore)`（echo 独立承受真实伤害）、`expect(hurt.player.hp).toBe(playerHpBefore)`（主角不受影响）、HUD 仍报 ECHO、`errors` 为空。
- 判定：P3-a 的战斗真实性**未被任何夹具削弱**。

### 4.4 `actionVariety` 加入既有 bounded wait
- 常量未变：`MAX_SAMPLES=80`、`MIN_SAMPLES=20`；`boundedWaitExhausted` 仍存在且 `expect(boundedWaitExhausted).toBe(false)` 保留（`:438`）。
- 新条件 `actionVariety > 1` 只是**提前退出条件的加严**：循环更难提前 break（可能更易超时失败），绝不会把失败变通过；最终 `expect(actions.size).toBeGreaterThan(1)` 保留，仍要求「>1 种真实动作」。
- 判定：**上限与断言都保留**，且方向是加严。

### 4.5 真实 pending Confirm/Reject、ESC、hidden 态、父子 overlap 例外
- 真实 pending（`ui-menu-layout.spec.ts:968` 起，我独立复跑通过）：无 pending 时 CONFIRM/REJECT `enabled===false`；真实 bridge + 官方 SDK 产生 proposal 后 `expect.poll` 等 `enabled===true` 且断言 `perceived_hostile` 真被渲染；CONFIRM 后断言 `hasPendingCompanionIntent===true` **且世界仍冻结**，恢复后由真实 tick 提交（`pending===false` 且 `tick` 前进）；第二条 proposal 走 REJECT 后断言**不产生**队列意图；DISCONNECT 后状态不再 CONNECTED 且两按钮变灰。这套断言是真正锁住 Owner 语义的。
- ESC 层级（`:691` nav 测试）：暂停期间断言 `sim.tick` 不前进、HUD 隐藏；root ESC 恢复且 HUD 恢复；`ai→pause`、`echo/llm→ai`、`settings→pause`、`inventory→pause`；直接 `KeyI` 的单层 inventory ESC 直接恢复。
- hidden 态：`auditLayout` 有独立 `hidden-but-interactive` 规则（不可见却可点击 = defect）。
- overlap 例外是否够严：`sameBox(±2px)` 用于「按钮 rect + label + hit」这类同心复合控件；容器包含仅在**非交互父包含子**时放行，**两个可交互控件互相包含或任意部分相交都判失败**；六视口 0/0。该审计**非空转**：同一审计器在 `before/` 干净 HEAD 树上报出**每视口 4 clipped + 30 overlaps**，正好命中已知缺陷。
- 交叉验证：我自己的独立 harness（不同实现，仅放行「rect 包含自身 label」）在 800×600 / 1024×768 也得到 overlaps=0、oob=0 —— 两套独立实现结论一致。

## 5. `World.ts` −13 行前置修复：必要性与风险

- **必要性成立**：`git show 0faf95c:src/world/World.ts:1338` 确实存在 `spawnProjectile(ownerId: number, …)` 兼容别名；而 `src/world/sim/rewiring.test.ts:113` 断言 `expect(src).not.toContain('spawnProjectile(ownerId')`。即：**在 HEAD 上跑单测该条必红**（测试树加了这 −13 行才是 745/745）。所以“先单独提交这 13 行”能让分支第一个提交就与全绿树一致。
- **调用者核对**：全仓库 `src/ tests/ scripts/` 搜索 `spawnProjectile` 仅剩 `src/world/sim/rules.ts:185` 的**注释**，没有任何调用点；`tsc --noEmit` 0 error，745/745 + 113/113 均在此树跑出 → 删除安全，无运行时回归。
- **风险**：仅剩「文档陈旧」——`docs/` 有 5 个文件仍以 `World.spawnProjectile()` 描述旧开火适配（非编译产物，不影响门禁）。非阻断。
- **提交顺序建议（供 Lead 决策）**：基线 → UI src → tests+reports 的顺序本身没问题，但要知道中间态不可单独为绿：仅提交 UI src 时旧 spec 仍按旧坐标点击（会红）；仅提交 tests 时源码还是旧 UI（也会红）。若在意可 bisect，建议把「UI src + tests」合成一个提交、基线单独一个；若坚持三分，请在提交信息里写明中间态不可独立验证。**这属于工程口味，不是阻断。**
- 另请排除：`reports/ai-native-02/**` 的 37 个旧脏文件、根目录未跟踪 `developer/`、`Start-LAST-SIGNAL.cmd` 都不要混进本次提交；`test-results/` 已在 .gitignore。我已删除自己产生的 `reviewer/audit/pw-results/` 临时失败上下文，避免污染 reports 提交。

## 6. 非阻断观察（5 条）

1. **过期 id fail-closed 视觉不一致**（Lead 已知）：守卫触发后 `selectedSuggestionId=null` 但列表仍显示 `▶`、CONFIRM/REJECT 仍 enabled；点击只会得 `NO SELECTED PROPOSAL`（fail-closed，不会误确认）。建议后续把 `lastPendingSig` 一并清掉强制重渲染。本轮不动冻结源码。
2. `tester/REPORT.md` 的 “after 48 张” 与实际 53 张口径不一致（48 = 6×8 页面图，另 5 张为功能性截图）；建议报告措辞改成“48 张页面图 + 5 张功能截图”。
3. `docs/` 5 处仍在描述 `World.spawnProjectile()`（见 §5），删除后文档陈旧。
4. `ui-menu-layout.spec.ts` 的审计中，“非交互元素被任意交互矩形完全包含”会放行（设计上用于 label 落在自己按钮内）。理论上可放过“label 完全落进邻接按钮”的情形，但同一 label 的按钮 rect 与邻 rect 会先以 interactive×interactive 被判 overlap，实际已被兜住；两套独立审计结论一致也印证了这点。
5. `__lsKeepAlive` interval 不清理（与旧版一致、page 作用域、`hp>0` 守卫）。

## 7. 证据范围（我实际跑/读了什么）

- **实跑**：`tsc --noEmit`（0 error）；`c3b-link-form.spec.ts`（3 passed）；`ui-menu-layout.spec.ts --grep "real pending proposal"`（1 passed，真实 bridge + SDK）。
- **实读核对**：`logs/32-unit.log`（745）、`33-typecheck.log`（0 字节）、`34-build.log`（built）、`35/37-e2e`（113 passed ×2）、`before/*.png`（42）、`after/*.png`（53）、`after|before/audit-*.json`（各 6）；11 个 spec 全量 diff + `tests/uiNav.ts`（189 行）+ `tests/ui-menu-layout.spec.ts`（1243 行，重点审计/pending/ESC 段落）。
- **未跑**：全量 113 E2E 与全量 745 单测（按 Lead 指示不重复，只核计数）；`1366/1600/1920` 三视口的 before/after 截图内容我未逐张目检（只核文件数与 audit JSON 存在）。
