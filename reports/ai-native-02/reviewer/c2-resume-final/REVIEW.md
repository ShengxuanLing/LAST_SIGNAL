# C2 最后 resume/storage 补丁 独立验收（780cece）

- **被测提交**：`780cecef9187090c6274a048f1e93bec18401b48`（HEAD），父 `ae72a67f92c5c9c5ebde9f4163db086911a3106e`
- **分支**：`feat/ai-native-world-integration`；未读/未恢复 stash `@{0}`/`@{1}`；无源码 WIP
- **复核方式**：`git archive` 冻结精确 hash 快照 `D:/Project/lastsignal-c2resume-review-780cece`（`node_modules` junction）；`git hash-object` 全量比对 → `ALL_TRACKED_FILES_MATCH`（1616/1616）
- **补丁范围**（仅 4 个 src/test 文件）：`src/scenes/GameScene.ts`（-2 强制 stepFrame）、`tests/resume-no-step.spec.ts`（新增 3 例）、`tests/economy.spec.ts`（+storage 失败例）、`tests/audit.spec.ts`（+默认 18 格不吸）
- **结论：resume 强制 tick 阻断已关闭；storage 失败功能路径正确；但 `checkpointDirty` 在保存失败时未被保留（残余，非阻断）。C2 建议放行（附残余），C3b 前置待 Lead 按此结论决定。**

## 一、质量门一行结果（命令 → 结果 → 日志）

| 门 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | PASS exit=0 | `gate-typecheck.log` |
| 全部 unit | `npx vitest run` | PASS 429/429（26 files） | `gate-unit-full.log` |
| 定向 E2E（resume-no-step + economy） | `PORT=5400 npx playwright test resume-no-step.spec.ts economy.spec.ts` | PASS 5/5 | `gate-e2e-targeted.log` |
| audit（含默认 18 格不吸） | `PORT=5401 npx playwright test audit.spec.ts` | PASS 2/2 | `gate-audit.log` |
| 独立 resume/storage 探针（dev 5399） | vite + probe | 见下（含残余） | `gate-resume-storage.log` |
| 房建生成参数（220 种 C1 参考） | `vite-node scripts/c2-room-generation-parity.ts` | PASS seeds=220 | `gate-room-gen-parity.log` |
| 拾取单位参数 | `vite-node scripts/c2-loot-pickup-parity.ts` | PASS failures=0 | `gate-loot-pickup-parity.log` |
| Node 参数 | `vite-node scripts/c2-node-parity.ts` | PASS checks=8 | `gate-node-parity.log` |
| Kill 参数 | `vite-node scripts/c2-kill-parity.ts` | PASS checks=13 | `gate-kill-parity.log` |

## 二、逐项复核

### 1. onResume / onLevelUpClosed 无强制 step/flush，无其他别名 —— **已关闭**
- `onResume()`（`GameScene.ts:627`）与 `onLevelUpClosed()`（`GameScene.ts:524`）本提交均删除 `this.world.stepFrame(1000/60+1e-6, …)`，仅保留 `resetSimulationAccumulator()`（暂停不囤时间）。两处注释明确“do not force a tick”。
- 别名排查：全 `src/` 仅剩 `GameScene.ts:128`（create 初始化的一次真实 tick，Lead 上轮已接受）与正常 `GameScene.ts:373 this.world.stepFrame(delta, intent)`；`processPendingCommands` 不存在；`stepSimulationTicksForTest` 为 `assertDevTest` 门禁的诊断接口（非产品路径）。
- 独立探针 `gate-resume-storage.log`：`gs.onPause()` 后入队 currency/heal，`gs.onResume()` → 快照与 before 完全相同（`resumeNoAdvance=true`）。

### 2. create 初始化边界保持；正常 update 累计提交一次；暂停不追赶 —— **已关闭**
- `GameScene.ts:127-128` create 新跑时仍 `resetSimulationAccumulator()` + 一次真实 `stepFrame` 提交初始 `room-enter` 再捕获首存（边界保持，未改）。
- 独立探针：`gs.update(0,5)` → 无提交（`subTickNoCommit=true`）；`gs.update(0,20)` → 恰好 1 tick（`oneTickAfterEnough=1`），排队 currency 提交一次（`currencyCommittedOnce=true`）。
- 暂停不追赶：`onPause`/`onResume` 均 `resetSimulationAccumulator()`；探针暂停期间 `gs.update(0,1000)` tick 不变（pauseNoAdvance 于上轮确认，本轮 resume 后同样不推进）。

### 3. resume-no-step3 永久测试调用产品路径 + update(0,20) 上界 —— **已关闭**
- `tests/resume-no-step.spec.ts`：
  - 例 1 用真实 `gs.onPause()` / `gs.onResume()`，断言 `afterResume == before`、`update(0,5) == before`、`update(0,20).tick == before.tick+1`、currency/heal 各提交一次，并验证 resume 后真实 RAF 仍在推进（未永久 paused）。**未手工 step/commit**（`update` 即产品路径）。
  - 例 2 用真实 `LevelUpScene.choose()` + `gs.onLevelUpClosed()`；仅“开升级界面”用一次 `stepFrame` 作 setup，升级提交走 `update(0,20)`。
  - 例 3 用真实键盘 `i` 开/关 inventory、`2` 排队装备，断言关闭前 `weaponKey='pulse'`、`getPendingEquipWeapon()='scatter'`，关闭后由**正常生产帧**提交为 scatter 且仅一个。
- `update(0,20)` 上界合理：`resetSimulationAccumulator` 后累加 5+20=25ms，`TICK_MS≈16.667ms` → `floor(25/16.667)=1` tick（20ms 单独也恰为 1，<2×16.667）。未见浮点堆叠导致多 tick。
- 独立复跑：3/3 PASS。

### 4. storage 失败测试 —— **功能路径已关闭，dirty 保留未关闭（残余，见第五节）**
- 测试真实注入 `Storage.prototype.setItem = () => { throw … }`，`window.dispatchEvent('restore-test-storage')` 恢复。
- 断言：banner 含 “could not be saved” 且 **不含 “Purchased”**；内存已扣一次；失败期间**磁盘 checkpoint 不变**；恢复后 banner 变 “Purchased Repair kit.”、磁盘 currency=`baseline-16`、hp=75、**无重复扣费**、weapons 长度 1、无 page error。
- 独立探针补充：`saveCheckpoint()` 在 setItem 抛错时返回 `false` 且**不抛出**（`saveReturn=false, threw=null`）——`SaveSystem.save` 内部 catch，异常不外泄。
- 独立复跑：economy 2/2 PASS（含该 storage 失败例）。

### 5. audit 默认 18 格不吸 / wide magnet fixture 明确 —— **已关闭**
- `tests/audit.spec.ts` 新增 `defaultFar` 段：默认 `pickupRange` 下 `wx+18` 掉落、跑 90 帧后断言 `loot=1` 且 currency 不变；随后**显式**设 `pickupRange=40*64` 的 wide magnet 段（注释“give this probe a wide magnet”）单独存在。两段分离，未把宽磁吸当默认。
- 独立复跑：audit 2/2 PASS。

## 三、残余（未完全关闭，非阻断）

**`GameScene.saveCheckpoint()` 在保存失败时不保留 `checkpointDirty`。**
- `src/scenes/GameScene.ts:493-500`：
  ```ts
  const checkpoint = this.world.captureCheckpoint(...);
  if (!checkpoint) return false;
  this.checkpointDirty = false;          // <-- 在写入之前清除
  return saveSystem.writeCheckpoint(checkpoint, this.runId);
  ```
  写入失败（`SaveSystem.save` catch → `false`）时，`checkpointDirty` 已被清为 false。
- 独立探针：`dirtyBefore=true → gs.saveCheckpoint()=false → dirtyAfterFail=false`（**dirty 未保留**）。
- 影响：本提交的 storage 购买场景**功能仍正确**——`settlePurchase` 以 `pendingPurchase` 为驱动逐帧重试 `saveCheckpoint()`，恢复后一次成功、无重复扣；但“**dirty 保留**”这一 Lead 明确项未满足；若一次自动保存（如房间清算）遇到瞬时存储失败，`checkpointDirty` 被清，需等下一个 dirty 事件才再保存（该窗口可能丢一次自动保存）。
- 该行为是本补丁之前既有，非本提交引入；但属 Lead 本轮列出的验证项。
- **修复条件（一行）**：将 `this.checkpointDirty = false` 移到 `writeCheckpoint` **成功返回之后**（`const ok = saveSystem.writeCheckpoint(...); if (ok) this.checkpointDirty = false; return ok;`）。建议在本轮或紧随其后修复，并加一条断言 `checkpointDirty` 在失败后仍为 true 的用例。

## 四、flaky 非阻断范围

前两轮保留的偶发（`ai-native-world` 257 / `vs01` 131）不在本补丁范围，本轮未触碰、未隐去；按 Lead 要求保留可见，不计入本补丁阻断。

## 五、结论与 C2 放行 / C3b 前置判定

- **resume 强制 tick 阻断：已关闭**（onResume/onLevelUpClosed 均不再强制 step；产品路径测试 3/3；独立探针确认暂停不推进、sub-tick 不提交、足量 delta 恰好一次提交）。
- **storage 失败功能路径：已关闭**（真实注入、UI 正确反馈、磁盘不变、恢复一次保存无重复扣，2/2 PASS）。
- **audit 默认 18 格不吸 / wide magnet 明确：已关闭**。
- **唯一残余：`checkpointDirty` 失败未保留（非阻断）**——不影响本轮购买场景的最终一致性与无重复扣，但未满足“保留 dirty”字面要求。
- **C2 放行判定：建议放行（附 1 条非阻断残余）。** 本补丁目标（resume 不强制 tick）与 storage 失败功能均已闭环并由独立探针/测试确认；`checkpointDirty` 顺序为一处小 durability 缺口，建议放行后立即以一行修复并补断言。
  - 若 Lead 要求“逐项全绿再放行”，则先完成第五节修复后再判 C2 闭环。
- **C3b 前置：C2 功能已闭环（除上述非阻断残余）。** C3b 本身仍冻结，其解冻需 C3（Gateway/MCP）自身独立验收；本轮**不自动解冻 C3b**，建议 Lead 按“C2 放行（附残余）+ 先修 dirty 顺序”后，再单独启动 C3b 验收。

## 六、报告目录

`reports/ai-native-02/reviewer/c2-resume-final/`：`REVIEW.md`（本文）、`gate-typecheck.log`、`gate-unit-full.log`、`gate-e2e-targeted.log`、`gate-audit.log`、`gate-resume-storage.log`、`gate-room-gen-parity.log`、`gate-loot-pickup-parity.log`、`gate-node-parity.log`、`gate-kill-parity.log`、`gate-dev-5399/5400/5401.log`、`probe-resume-storage.mjs`、`pw-out/`、`pw-out-audit/`。

所有运行均在冻结快照与独占端口（dev 5399/5400/5401）上进行；未修改生产源码/已有测试/配置；未切换共享分支、未合并/重置；未读取/恢复 stash。
