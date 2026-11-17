# GAMEPLAY-01 · HUD 采样前置修复 · 独立审查（只读）

**结论：可单独提交（PASS）。** 断言未被放宽；loop 是"等待真实 live"的前置条件，且失败显式；`paused` 不能通过。
两条必须如实写进提交/报告的口径：① 采样**不是同帧原子**（`state` 与 `bbox` 是多次 evaluate）；② 最坏新增墙钟约 **31s**（不是 20s），属前置预算而非断言超时放宽。
另附一个运维级发现：`c2/c3c` 两个 spec 的输出路径是 **cwd 相对**，只隔离 dev server/端口**不足以**隔离输出。

## 1. 冻结与 diff 范围

- `tests/ai-native-world.spec.ts` SHA256 = `ef1d2e92…16f2125`，与 Lead 给定**一致**。
- `git diff HEAD -- tests/ai-native-world.spec.ts` = **+22/−7，单一 hunk（HUD 采样段）**；`git diff dcd1955 -- …` 同为该 hunk。
- P3a 段仍在（`grep -c p3a-attribution` = 1）。→ 之前 P3a 修复的 `23f4961d…` 是**同一文件的历史字节**，本次只改了另一段；不存在"另一个文件"或"旧整文件 hash 仍一致"的混淆。

## 2. loop 是前置条件，不是"paused 也通过"、也不是吞失败

```ts
const isLive = () => !gs.paused && g.scene.isActive('GameScene') &&
  !g.scene.getScenes(true).map(s=>s.sys.settings.key).includes('LevelUpScene');
let live = false;
for (let attempt = 0; attempt < 5 && !live; attempt++) {
  await clearLevelUp(page);                                   // 只在真实 LevelUpScene 活跃时按 '1'
  live = await page.waitForFunction(isLive, undefined, {timeout:4000}).then(()=>true).catch(()=>false);
}
expect(live, 'the run is live again after any real level-up choice').toBe(true);   // 显式失败
```
- `isLive` 明确要求 **`!gs.paused`** 且无 `LevelUpScene` → **paused 状态不可能通过** ✓。
- `.catch(()=>false)` 只把"等待超时"转成 `false`，而该 `false` **立刻被 `expect(live).toBe(true)` 断言** → 不是吞掉真失败 ✓。
- `clearLevelUp`（helper 250-261）：仅在 `getScenes(true)` 含 `LevelUpScene` 时按**真实 `'1'` 键**，最多 5 次；**没有** `scene.stop()`、没有直接改 Scene 内部状态、没有回血/清敌 ✓ → 是真实卡牌选择。
- 其后的原断言（`mode==='AI'`、`owner==='ai'`、bbox、字体）在 diff 里**一字未动**；F-04/F-05 的暂停冻结断言在别的段，单 hunk diff 保证未动 ✓。

## 3. 旧的 inline 6×key1 为什么不稳（推断，不是复现结论）

旧代码每 450ms 按一次 `'1'`、**不确认 overlay 真的关掉**。真实 run 里一次经验可能连续触发多级升级（`pendingLevels` 队列），第一张卡选完后**第二个 LevelUpScene 立刻重开**；最后一个 450ms 之后直接采样，就可能采到"overlay 仍开 / 被暂停"的帧 → 正是记录到的 `AI` 期望、`PAUSED` 实得。
→ 这是**代码推断**；我没有复跑旧版本验证具体时序，报告不应把它写成"已证 bug 根因"，只能写"与症状一致的机制"。

## 4. 采样边界（必须如实写，不可宣称原子）

- `waitForFunction(isLive)` 之后仍然分别调用 `state(page)`、`canvasBox(page)`、字体/bbox 读取 —— **多次 evaluate、跨多个帧**，中间理论上还能再开一次升级。该改动**降低但不消除**竞态；**不能**表述为"同一帧内原子采样"。
- 最坏新增墙钟：5 轮 ×（`clearLevelUp` 最多 5×450ms + `waitForFunction` 4000ms）≈ **31.25s**；应写成"前置条件预算"，并说明它**不是**对任何断言的 timeout 放宽（原断言阈值未变）。
- 建议提交说明里加一句：`clearLevelUp` 用真实 `'1'` 键、最多 5 轮、失败显式断言；采样仍是多次读，非原子。

## 5. c2/c3c 输出隔离（运维级发现，本轮不改）

| 文件 | 输出路径 | 是否受 env/testDir 影响 |
|---|---|---|
| `tests/c2-parity.spec.ts:13-14` | `path.resolve('reports/ai-native-02/c2/parity')`、`…/c2-fixes-round2/parity-kill` | **否**：纯 `process.cwd()` 相对；无 env 覆盖 |
| `tests/c3c-headless-parity.spec.ts:13` | `path.resolve('reports/ai-native-02/c3c/parity')` | **否**，同上 |
| `tests/runtime-bugs.spec.ts` | `LS_SHOT_DIR`（默认 `screens`）；`PROJECT = LAST_SIGNAL_ROOT ?? cwd` | 只有它读 `LAST_SIGNAL_ROOT`，且仅用于**读取**源码，不重定向输出 |

→ **结论**：`playwright.config.ts` 的 `baseURL`/`testDir` 只影响浏览器与用例发现，**不影响 `path.resolve`**；`LAST_SIGNAL_ROOT` 也不能重定向这些 writer 的输出。**只有把 `cwd` 设成独立树**（或后续给这些 spec 加 env-based OUT）才能隔离；仅用独立 dev server/端口**不隔离输出**。

- 当前 `reports/ai-native-02/c2*`、`c3c*` 仍有 **8 份 tracked dirty**，与"从共享 cwd 跑过这两个 spec"一致；我**没有**恢复或覆盖它们。
- 我本轮的运行环境（如实披露）：`npx vitest run …`（共享 cwd，不写这些路径）；`npx playwright test -c reports/gameplay-01/reviewer/…/pw.*.config.ts`（我的 config，testDir 指向 reviewer 目录，cwd 仍是共享 repo）；一次默认 config 仅 `tests/ai-native-world.spec.ts --grep "P3-a"`（带 `LS_AI_EVIDENCE_DIR` 隔离输出）。我 grep 自查：reviewer 日志中**没有** `c2-parity`/`c3c-headless-parity` 被选中；`ai-native-world.spec.ts` 也不写 c2/c3c。→ 我这些命令不会产生那 8 份 dirty；但"dev server 独立"并不等于"输出独立"这一点必须记住。

## 6. 顺带静态抽查：P1 新测试三处返修（`5aa90d8`）已满足

- 种子：`test('6) seeds 20261117/18/19 …')`，注释明确"failed with a notice is NOT a pass"，并要求 route pair/sentry 布局有变化 ✓。
- 精确成本：`expect(scanCommit.before - scanCommit.energy).toBe(TUNE.SCAN_COST)`（从**已提交事件**取值，另记 regen 来源）✓。
- 非盲披露：文件头 173-176 行明确 `NON-BLIND … reads canonical … NOT a human blind playtest` ✓。

## 7. Gate（本轮未重跑大浏览器）

| 项 | 结果 | 证据 |
|---|---|---|
| 静态：SHA/diff 范围/P3a 段完整/loop 与 `clearLevelUp` 行为/原断言未动 | **PASS** | `tests/ai-native-world.spec.ts`、`git diff HEAD` |
| tester 日志计数核对 | **PASS**：`hudfix-5vp-run1.log` = 5 passed、`hudfix-5vp-run2.log` = 5 passed（10/10）、`hudfix-typecheck.log` 存在 | `reports/gameplay-01/tester/logs/` |

## 8. 判定

- **HUD 采样前置修复：可单独提交（PASS，无阻断）**。
- 提交时必须带上的三条口径：① 前置等待不是断言放宽（原阈值未变）；② 采样**非原子**（多次 evaluate）；③ 最坏 ~31s 前置预算。
- `c2/c3c` 的 cwd 相对 writer：**不要**再从共享 cwd 跑那两个 spec；要跑就用独立树作 cwd，或后续加 env 输出覆盖（属测试工程改动，不在本轮）。
