# UI-REWORK-01 · 最终补充 diff 审查（Reviewer · ADDENDUM）

**结论：产品（src）无变化、可提交；但本次两个 tests dirty 的「测试证据结论」有 2 个阻断项（B1/B2），均为 10–20 行内可修；若选择不改代码，则必须把 REPORT/FINAL_REPORT 的措辞改成事实（不能宣称 flake 已修 / 不能把 `no_observation` 说成安全会话失效）。**
只读 src/tests，未 commit/push；自起 dev server 已关；截图/证据全部写入我的 `reviewer/` 目录（`LS_SHOT_DIR` / `UI_OUT_DIR`），未触碰 `reports/ai-native-02/evidence/`（该目录 mtime 仍为 tester 的 21:21，我方运行为 00:0x）。

## 0. 范围与源码冻结

- `git diff eb83eb4 -- src/` = **空**；`git status -- src/` = 空 → 相对已提交的 `eb83eb4` **源码没变**。
  （`sha256sum` 对工作区文件与 `git show eb83eb4:file` 的字节差异只是 CRLF：PauseScene/menuKit 为 LF 故相同；`GameScene.ts` 工作区 `aec3ff04…` = Lead 冻结值，blob 为 LF 故不同。判定以 git 为准：无改动。）
- 本次 dirty 仅：`tests/audit.spec.ts`（+18/−4）、`tests/ui-menu-layout.spec.ts`（+17/−15）、`reports/ui-rework-01/tester/REPORT.md`、after/ 证据重生成。

## 1. 计数核对（结论：总量 118 正确，单 spec 报告数字偏 1）

- `logs/62-final-full-playwright-2.log`：`Running 118 tests`，`^\[n/118\]` 行数 = **118**，`118 passed (14.7m)`；`54-…`/`60-…` 均 `117 passed + 1 failed`。**总数与最终绿无可疑。**
- `tests/ui-menu-layout.spec.ts` 在 118 次运行中占 **25** 条（从日志逐条数：6 × `capture <w>x<h>` + 6 × `audit <w>x<h>` + 13 条单例）。
- 源码侧也一致：`grep -cE '^\s{2,6}test\('` = **15** 个定义，其中 2 个在 `VIEWPORTS`（6 视口）循环内 → 12 + 13 = **25**。
- 但 `REPORT.md` 两处写「本单 24 条」「新增，24 条」→ **实为 25**，属文档 off-by-one（非阻断）。
- **113 → 118 的 +5 不是本 diff 带来的**：`git show eb83eb4:tests/ui-menu-layout.spec.ts` 已经是同样的 **15 个 test 定义（=25 条）**，本 diff **没有新增任何 test 定义**，只改了两处 body。所以 113 是 `37-…` 的**旧快照**（eb83eb4 之前），118 是当前树的运行。Lead 说的“diff 之前新增覆盖已在 eb83eb4”与代码一致；但报告应明确「113/118 属于不同测试集合快照，不可混用为同一集合的通过率」。

## 2. B1（阻断测试证据命中率）audit.spec 的 teleport 等待：没有修好 flake，且 catch 吞掉了失败原因

改动实质：
```ts
await page.waitForFunction(() => w.player.wx==onPortal.x && w.player.wy==onPortal.y, ..., { timeout: 8000 }).catch(() => undefined);
await page.waitForTimeout(1200);   // 原来 500
```
事实：
1. **`.catch(()=>undefined)` 全局吞掉超时** → 如果 reset 没落到 portal 格，测试不会在此报「同步条件未达成」，而是继续 `KeyF` 后在几何断言处红（错误信息指向落点而非根因）。→ **诊断能力被削弱**。
2. **500→1200 是固定等待，不是条件等待**，且**没有修好 flake**：我用 `LS_SHOT_DIR` 隔离证据后独立单跑
   `PORT=5173 npx playwright test tests/audit.spec.ts --grep "fixed-seed playability" --workers=1` → **FAIL**，`teleported grid x` 实测 **0.2400691498741736**（与 tester 自己记录的「1/5 隔离出现恒定 0.2400691」**完全一致**）。
3. 因此 `REPORT.md:34`「时序 flake（等真实提交已修）」与 §6「已加强等待」的结论**不成立**；`REPORT.md` 至少在 §6 里诚实记录了「仍会 1/5 出现」，两处措辞互相矛盾，FINAL_REPORT 不能沿用「已修」。
4. 0.240069 是**确定性数值**（两次独立复现同值），更像 `findWalkableInRoom(targetRoom)` 的期望与核心真实落点规则不一致（语义/几何问题），而不是“等久一点就会好”的时序问题 —— 加长 sleep 天然修不了它。

**最小必要修复（二选一，推荐 a）**
- (a) 去掉 `.catch`，并把 1200ms 固定等待换成**条件等待**：`await page.waitForFunction(() => Math.abs(grid.x-expected.x)<0.01 && Math.abs(grid.y-expected.y)<0.01, {timeout: 15000})`。这样：同步失败立刻红且有精确信息；等待的正是断言语义本身（不是靠更长的 sleep 追绿）；若真跑不到，说明是核心落点语义差异，问题被正确暴露而不是被 catch 掩盖。
- (b) 若判定 0.24 格偏移属**既有产品/夹具语义差异、本任务范围外**：显式改为 `test.fixme`/`test.skip` 并写明原因 + 保留复现日志，同时在 REPORT 写明「既有 flake 未修，非本单范围」。**不允许**用「加大 timeout / 固定长等待 / catch 吞掉」来维持绿。

## 3. B2（阻断测试证据正确性）reauth 断言把「无 observation」当成安全会话失效，且删掉了有意义覆盖

改动：原来是「关闭旧 SDK → 新建 SDK → `echo_observe` ok → `echo_suggest` ok → `waitForButton` → Owner CONFIRM 成功」；现在改为「**旧** SDK `echo_observe` → 断言 `ok===false`（注释与报告称“旧 agent 会话被拒，安全正确”）→ DISCONNECT → UI 如实离线」。

源码事实（`src/ai-native/companionGateway.ts:103-116` + `companionFacet.ts:528-533`）：
```ts
if (reauthorize) { state.facet.reauthorize(epoch); state.observation = null; state.decisions.clear(); state.requests.clear(); }
// facet.reauthorize: cancelUnconfirmed(); lastObservation = null;
return { ok: true, value: { session: sessionId, epoch } };   // session / epoch 都不变
```
→ **reauthorize 不撤销 agent 会话、不改 epoch**；它只清「已发布 observation」+ 取消未确认建议。`echo_observe` 因此返回 `E_LINK_UNAVAILABLE / companion.no_observation` —— 这是**状态性拒绝**（“重新观察后才能提案”的设计），**不是**“旧会话被拒”的安全性质。

我的独立证据（`reviewer/logs/companion-final.log`，FINAL_REVIEW 那轮）：reauth 后同一 `session=ses_ca77ae89…`、`epoch=1` 在渲染侧重新推送 observation 后，`suggest` 返回 **200**（`suggestion.session` 就是 reauth 前的同一 session）。→ 「旧 agent 会话被拒」的表述与实现不符。

覆盖损失：被删掉的那段是**唯一**证明「exchange 后链路仍可用：新的合法 agent 能 observe+suggest，且人类仍能 CONFIRM 并生成待提交 intent」的 e2e 覆盖。现在只剩「DISCONNECT 可用 + UI 如实离线」，即“swap 后不会变砖”这条可用性不再被测。

**最小必要修复（推荐全做，约 15 行）**
1. 保留负向断言但**改成真实原因**：`expect(reobserved.ok).toBe(false)` **且** `expect(JSON.stringify(reobserved)).toMatch(/no_observation|E_LINK_UNAVAILABLE/)`；注释改成「re-authorize 会清掉已发布 observation，agent 必须重新观察后才能提案（非安全撤销）」。
2. 恢复 post-swap 可用性覆盖（可直接复用 eb83eb4 里被删的 6-8 行）：重新 `openCompanionSdk`（或让渲染侧重新 push observation）→ `echo_observe` ok → `echo_suggest` ok → `waitForButton` → CONFIRM → 断言 `hasPendingCompanionIntent === true`。
3. `REPORT.md:78` 的「旧 agent 会话被拒（`echo_observe ok:false`，安全正确）」必须改写；真正的“cap 原子替换 / 老 cap 失效”已由 `src/ai-native/ownerAuth.test.ts` C3/C4 在协议层覆盖（我此前 gate 已跑绿），不要用 e2e 的 no_observation 冒充它。

## 4. 我本轮跑的针对性 gate

| 命令 | 结果 | 日志（绝对路径） |
|---|---|---|
| `PORT=5173 UI_PHASE=reviewer UI_OUT_DIR=…/reviewer/audit/pw-ui-fixture npx playwright test tests/ui-menu-layout.spec.ts --grep "re-authorize" --workers=1` | **PASS**（1 passed / 7.8s） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/pw-reauth-changed.log` |
| `PORT=5173 LS_SHOT_DIR=…/reviewer/audit/pw-audit-shots npx playwright test tests/audit.spec.ts --grep "fixed-seed playability" --workers=1` | **FAIL**（1 failed；`teleported grid x` = `0.2400691498741736`） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/pw-audit-teleport.log` |

未跑全量（按指示）。`reports/ai-native-02/` 的既有脏文件与本次运行无关（mtime 未变）。

## 5. 其他非阻断

1. `REPORT.md` 单 spec 计数 24 → 实为 **25**。
2. `REPORT.md` 把 `54-…` 的红描述为「落点差 13 格（未发生交互）」，而恒定表现是 `0.2400691` 格；两种表现应分开记录，否则后续排查会被误导。
3. 118/113 快照边界需在 FINAL_REPORT 写明（113 = 旧集合快照，118 = 当前集合），避免把 113 当成本集合的旧通过率。
4. 证据重生成面较大（after/ 下 48 张 PNG 全部字节变化 + 6 个 capture JSON）；这些是“重跑导致的重写”，提交时注意与代码/测试分开提交，且不要把 `before/` 的旧快照一并重写。

## 6. 判定

- **产品**：`src` 与 `eb83eb4` 一致，冻结 hash 未变，无回归风险 → **可提交**。
- **测试证据**：B1（flake 未修 + catch 掩盖 + 报告称已修）、B2（安全性质表述错误 + post-swap 可用性覆盖被删）**不满足“可直接定稿”**；两者都可 10–20 行修好，修好后只需重跑 `tests/audit.spec.ts`（单测）与 `tests/ui-menu-layout.spec.ts --grep "re-authorize"` 两条即可，无需全量。
- 若 Lead 决定本单不再改测试：FINAL_REPORT 必须删掉「已修/安全会话被拒」两处表述，改为「既有 teleport 几何 flake（0.2400691，约 1/5，非本单引入、未修）」与「reauth 会清空已发布 observation（状态性拒绝），ep/会话不变；cap 原子替换由 ownerAuth 单测覆盖」，并把 118/118 标注为“单次全量绿，非确定性稳定”。
