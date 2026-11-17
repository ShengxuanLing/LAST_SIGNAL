# GAMEPLAY-01 · P1 新增 E2E（`tests/gameplay-01.spec.ts`）独立审查

**结论：可作为 P1 的局部证据提交，但需 2 处最小必改（第 6 条种子断言、第 1 条能耗断言）+ 2 处标注修正（非盲自动化、4 条 did-not-run 的归因）。本轮不给 P1 整体 PASS；P2 的 duplicate-confirm 阻断仍独立待修。**
只读：未改 src/tests/report，未提交/未 push，未动 tester 隔离树 `D:/tmp/ls-p1-accept`；本轮**未发任何 Magpie 请求**。

## 0. 冻结与核对

- 新 spec SHA256 = `8dde19a7…4e2d8e`，与 Lead 给定**完全一致**；7 条 test（`1)`…`7)`）。
- 源冻结：报告 §7 的 12 项 hash 与 P1 manifest 一致（我抽查 `relay.ts 4c5e51b3`、`core 2afcb1d0`、`p1Scenario 1b87c1e3`、`World 90295aaa` 均可对）。
- 日志实读：`p1-spec-final.log` = **7 passed (1.4m)**；`p1-gate-5-playwright-full.log` = **117 passed / 4 failed / 4 did not run**（125）；`p1-gate-2-npm-test.log` = 755 passed。
- 新 spec **无** `.skip` / `fixme`；只有 `test.setTimeout(240000)` 作为**整文件预算**（非断言级放宽）。

## 1. 已核对为真实、可保留的部分

| 项 | 核对结果 |
|---|---|
| 真实主菜单入口 | `bootDemo()` 点击 `DEMO 01 · LINKED SENTRY`，不是场景直启 ✓ |
| 真实键鼠战斗 | `fightUntilCleared` 用真实 `keyboard.down/up` 靠近 + 真实 `mouse.move/down/up` 开火 ✓ |
| 无 teleport / 无救命 | 第 2/3 条里没有 `setPlayerPositionForTest` / `clearEnemiesForTest` / heal / `player.reset(`（grep 确认）；`record.fighters` 标注 `fixtures: none` ✓ |
| 两条合法路线 | 第 2 条 = **jam-first**（起手格在 `JAM_RANGE` 内，玩家可达）+ 真实战斗 + 真实走到门 + F；第 3 条 = **manual OFF（R）** 选另一条 route ✓；**没有**把"纯战斗不 jam 必过"当 PASS 条件（§2.1 明确写了）✓ |
| 站门自然 jam 被拒 | 实测门到 relay **6.403 > JAM_RANGE 6**，自然按 Y → relay 仍 ACTIVE、能量不变（未扣费）✓；随后 `setPlayerPositionForTest(relay)` 再真实按 Y 是**显式标注的 FIXTURE** ✓ |
| 存档 → reload → CONTINUE | 同房间 / manual=false / routeTarget=2 / authored scenario 重挂 ✓（这条补上了我 P1 复审时列出的"未验证"） |
| 五视口 HUD/暂停页 | 1920/1366/1280/1024/800：字号 ≥10 CSS px、无越界、无意外重叠、ESC 恢复 ✓ |

## 2. 必改（最小改动，不需动 src）

### F1（阻断"证明力"）第 6 条种子的断言把 error 当成功

现状：`seeds = [20261117, 4242, 7]`，断言是 `(p1 && !err) || (!p1 && !!err)` → **显式 error 也算通过**。这只证明"不会静默降级"，不证明"3 个可玩变体"。
Lead 要求：用 manifest 已知 `20261117/18/19` 作**正向全部成立**，且至少设备/敌位/路由有变；非法布局的 error 另做独立负向。

事实补充（对实现有利）：`evidence/p1-acceptance.json` 显示当前三个 seed **实际都成立**（`ok:true, error:null`，route targets 分别为 `[1,2]`/`[2,5]`/`[5,3]`，drones=2）→ 改成 manifest 三 seed 的正向断言是**低成本**的。

最小改法：
```ts
const seeds = [20261117, 20261118, 20261119];
const rows = [...];
expect(rows.every(r => r.ok && !r.error), 'all manifest seeds set up the authored scene').toBe(true);
expect(new Set(rows.map(r => JSON.stringify(r.routeTargets))).size, 'route pairs vary').toBeGreaterThan(1);
// 另开一个独立负向用例：已知不可组建的 seed（或人为把 targets<2）→ 必须 p1ScenarioError 且 UI 可见
```

### F2（阻断"能耗验收") Energy 用含 regen 的区间，不是提交帧的精确扣费

现状：`scanDelta = 9`（`COST-3 .. COST+6`）、`jamDelta = 22`（`COST-3 .. COST+8`），注释也写"含回能"。Lead 明确要求**实际 commit 精确扣费**，不接受宽泛范围。

最小改法（不需要改 src）：在页面内对 `world.stepFrame` 做**只读包装**（同我在 real-model harness 用的手法），捕 `signal-energy` / `signal-scanned` / `signal-jammed` 事件里的**提交后 energy**：
```ts
// in-page: wrap stepFrame to collect events
const ev = world.stepFrame(...); ev.forEach(e => window.__p1events.push(e));
// then, at the commit tick:
expect(scanEvent.energy, 'committed scan charged exactly SCAN_COST').toBe(before - TUNE.SCAN_COST);
expect(jamEvent.energy, 'committed jam charged exactly JAM_COST').toBe(beforeJam - TUNE.JAM_COST);
// regen 单独断言：下一批 tick 后 energy 单调回升（5/s）
```
`signal-scanned`/`signal-jammed` 事件已带 `energy`（core 里 `result.energy`）→ 这是**精确值**，比读 `signalView()` 的延迟采样可靠。保留现有区间断言也行，但**不能代替**精确扣费。

## 3. 必须标注（不改进正确性，但影响结论口径）

### F3 `fightUntilCleared` 是**非盲**自动化（读 sim 敌位+HP 选择目标），不是人类盲测

第 200-270 行从 `w.enemies` 读敌人世界坐标与 `_data.hp`，再经相机逆变换算屏幕点并瞄准开火。这是**闭环自动驾驶（读 canonical state）**，不是"人类只看屏幕"。
报告 §2 的 `runner: 'agent (real Y jam strategy + real mouse aim/click + real WASD)'` 与 `fixtures: 'none'`**只说明了"不改状态"，没说明"读状态"**。
最小改法：`runner` 改为 e.g. `agent (non-blind: targets chosen from canonical sim state; real keyboard/mouse inputs)`，并在 §2.1 加一句"本条非人类盲测，目标选择使用内核状态；不能作为人类可玩性证据"。

### F4 `4 did not run` 的真实含义 + 负载归因的证据级别

- 新 spec 用了 `describe.configure({mode:'serial'})`；全量里第 3 条（route B）失败 → 同文件第 4–7 条**没有执行**（正好 4 条）。所以 **7/7 只来自隔离单跑**，不能表述为"全量下 7 条都绿"。
- 4 个失败的归因：
  - `vs01`：**有双基线**（P1 树 2/3 红、无 P1 基底 1/3 红，同一 `10.6 vs 10.5`）→ 既有 flake，证据级别够 ✓。
  - `ai-native-world` HUD×2 与 `gameplay-01` route B：只有**隔离复跑转绿**（5/5、单跑 PASS），**没有基底对照** → 只能说"负载/时序推测"，不能说"非回归已证"。
  - 报告 §9 目前写"3 条可在隔离复跑转绿（负载）"——建议改成"2 条隔离转绿（推测负载，未做基底对照）+ 1 条双基线证实既有 flake"，并在"未验证"里列明 **4 条 did-not-run**。

## 4. 其余观察（非阻断）

1. 第 1 条 `waitForFunction` 断言 `playerScanCD>0 || evidence>0` 作为"已提交"判据 OK；但**证据数**在多次 scan 后依赖 TTL，若后续加多次 scan 需注意。
2. 第 4 条"门到 relay 6.403"与我 P1 复审时测到的 6.9–7.0 不同（可能是不同 seed/落点）；建议在 record 里写清 seed，避免下次误判。
3. 第 7 条的五视口与 UI-REWORK 的审计器重复但**不冲突**（这里只看 HUD/暂停页文本，不重新审菜单布局）✓。
4. `test.setTimeout(240000)` 是文件预算；建议在 §2.1 说明"这不是放宽单条断言超时"（避免被误读为追绿）。

## 5. 本轮 gate

| 命令 | 结果 | 证据 |
|---|---|---|
| 静态核对 spec SHA / 7 条 test / 无 skip / 无清敌瞬移 | **PASS**（人工核对 + grep） | `tests/gameplay-01.spec.ts`、`reports/gameplay-01/tester/logs/*` |
| 读 tester 日志核对计数 | **PASS**（7/7 隔离；全量 117/4/4；unit 755） | `…/logs/p1-spec-final.log`、`p1-gate-5-playwright-full.log`、`p1-gate-2-npm-test.log` |

我**没有**重跑该 spec（1.4m，且需 tester 隔离树/端口）；本报告是静态审查 + 日志核对，因此"7/7 在隔离树成立"我采信 tester 日志，但没有独立复跑。

## 6. 结论

- **可提交（局部证据）**：7 条里 5 条（1/2/3 修 F2/F3 后、4、5、7）证据扎实；第 6 条需按 F1 改断言后才能作为"3 个可玩变体"的证据。
- **P1 整体仍不是 PASS**：Headless route 等价（Rendered-only）、P2/P3–P5、真实模型链、人类试玩均未完成；`HUMAN ACCEPTANCE PENDING` 不变。
- **P2 的 duplicate-confirm BLOCKER 仍独立待修**（本轮未复检）。
