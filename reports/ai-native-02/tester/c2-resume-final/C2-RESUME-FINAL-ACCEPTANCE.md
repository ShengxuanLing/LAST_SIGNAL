# AI-NATIVE-02 C2 resume / storage 最终补丁独立验收（780cece）

- Worker `y6en9ua8phanll8cqi8dd8ru`，专属目录 `reports/ai-native-02/tester/c2-resume-final/`
- 目标冻结：`780cecef9187090c6274a048f1e93bec18401b48`（父 `ae72a67f92c5c9c5ebde9f4163db086911a3106e`）
- 隔离：`git archive 780cece` → `D:/Project/AI-NATIVE-02-snapshots/780cece`（哈希 `00-frozen-state.log`，收尾复核 `17-final-state.log` 一致）；专属 dev 端口 **5296**（自启自停）；未切分支、未改源码/测试/配置、未读 WIP/stash。复核结束时活仓库 HEAD 已推进到 `a25f140`（后续提交），**本报告只认 780cece 快照**。
- 结论：**C2 阻断解除（就本轮范围）**。resume 不再强制 tick；storage 失败重试覆盖已恢复并通过；checkpoint/audit/升级路径通过。C3b 可进入（**仍不等于 P2 整体完成，也不是外部 Agent 接入**）。

## 1. Gate 一行式

- PASS `npx tsc --noEmit`（快照）退出码 0 → `01-typecheck.log`
- PASS `npm test`（快照）**26 files / 429 tests** → `02-unit.log`
- PASS `npx vite build --outDir …/c2-resume-final/frozen-dist` 15.98s → `03-build.log`
- PASS `npm run game:mcp:build`（301.22 kB）→ `03b-mcp-build.log`；default StationZero MCP smoke = 6 Player 工具 → `04-mcp-smoke.log`
- PASS `PORT=5296 npx playwright test tests/resume-no-step.spec.ts --repeat-each=3 --workers=1` → **9 passed (25.1s)** → `05-resume-no-step-3x.log`
- PASS `PORT=5296 … tests/economy.spec.ts tests/checkpoint.spec.ts tests/audit.spec.ts tests/ai-native-world.spec.ts --workers=1` → 16/18（2 个已知 flaky，见 §5）→ `06-targeted.log`
- PASS `PORT=5296 … tests/audit/checkpoint/economy/c2-parity/purchase-ledger/supply-transaction/resume-no-step --workers=1` → **25 passed (1.9m)** → `13-core-suite.log`
- PASS `PORT=5296 npx playwright test tests/ai-native-world.spec.ts --workers=1` → **9 passed (1.8m，五视口)** → `12-p1-5viewport.log`
- PASS parity 脚本：node 8/8、kill 13/13、loot-pickup 全过、room **C1_ROOM_PARITY_PASS seeds=220** → `14-parity-scripts.log`
- PASS CLI 冷启动 3/3（就绪 3.47/3.48/3.49s，quit 后 30/45/48ms 退出 exit 0）→ `15-cli-coldstart.log`

## 2. resume 不再强制 tick（核心补丁，独立复核）

- 源码：`GameScene.onResume()` 与 `onLevelUpClosed()` 删除了 `stepFrame(1000/60+1e-6, …)`，只保留 `resetSimulationAccumulator()` + `refreshHud()` + 脏检查点保存。
- 官方新用例 `tests/resume-no-step.spec.ts` 3 项 **repeat-each=3 → 9/9 PASS**（`05`）。
- 我的独立探针 `probe-resume.mjs`（**在同一个 evaluate 内测量**，避免实时 RAF 干扰）：
  - `onPause()` → 排队 heal+5 / currency+10 → `onResume()`：**tick 不变**（80→80）、HP/currency/loot/projectiles/enemies/4 个计时器全部不变、pending 保持 2；
  - `update(0,5)`（亚 tick）：**不提交**（tick 仍 80、currency 不变）；
  - `update(0,20)`（恰好一 tick）：**提交一次**（tick 81、currency +10、HP +5）；
  - 再一 tick：**不重复**提交；
  - resume 后真实 RAF 继续推进（`probe-resume` 的 `real-raf-advances` PASS）。
  - `onLevelUpClosed()` 隔离测量：关闭后 tick/pending/upgrades 全不变 → 亚 tick 不提交 → 一 tick 提交一次（upgrades 0→1、pending 清空）。
  - 背包关闭路径（`onPause` → `enqueueEquipWeapon` → `onResume`）：同样 tick 不变 → 亚 tick 不提交 → 一 tick 提交一次。
  - 独立观察到的升级落盘：真实选卡后 `save.run.player.upgrades = [{key:'vitality',level:1}]`。
- 结论：**上一轮 Reviewer 阻断（resume 强制 +1 tick）在 780cece 关闭**，且语义正确（排队命令由正常 tick 提交一次）。

## 3. storage 失败 → 退出/重开与重试（覆盖已恢复）

- 官方 `tests/economy.spec.ts` 新增第 2 项 `a failed checkpoint save keeps the purchase pending and completes once after recovery` → **PASS**（`06`/`13`）。
- 我的独立探针 `probe-storage-retry.mjs`（注入真实 `Storage.setItem` 抛错）：
  - 基线 currency 212 / hp 40 / 磁盘 212；
  - 失败时：提示 **“Purchase could not be saved. Retrying…”**、**不含 “Purchased”**；内存**只扣一次**（currency 196、hp 75）、ledger=1；**磁盘仍 212**（未写脏数据）；
  - 恢复存储后：提示变为 **“Purchased Repair kit.”**，磁盘 currency **196**（= 212-16，只扣一次）、hp 75、ledger=1（保留一条，不重复）。
- 结论：**storage 失败不误报成功、不双扣、恢复后恰好完成一次并保留 ledger**；上一轮的覆盖缺口已关闭。

## 4. 18 格掉落 / 升级 / checkpoint / audit

- 官方 `audit.spec.ts` 新增断言：默认 pickupRange（90px≈1.4 格）下 **+18 格掉落留在地面**、currency 不变。
- 我的独立探针 `probe-loot-magnet.mjs`（运行中游戏、90 次 tick）：**18 格 → loot 保留 1、currency 不变（未磁吸）**；**5 格 → 拾取成功（currency +10、loot 0）**。
- `checkpoint.spec.ts` 5/5、`audit.spec.ts` 2/2、`c2-parity` 9/9、`purchase-ledger` 1/1、`supply-transaction` 3/3 全 PASS（`13`）。
- 五视口：dev P1 9/9 PASS；实际查看 `hud-ai-800x600.png`（scale 0.625，最小物理字高 10.625px）——控制列 4 行与左下提示可读、无裁切/遮挡。

## 5. 保留的偶发失败（不掩盖、不改 slice 追绿）

| 用例 | 现象 | 复跑 | 影响结论 |
| --- | --- | --- | --- |
| `tests/ai-native-world.spec.ts:257` shared control path | 首轮（与其它 spec 同批）失败于 `HUD returns to HUMAN`（收到 `CONTROL  PAUSED`）；单独复跑第 1 次**通过**、第 2 次失败于 `PauseScene open`（收到 `["GameOverScene"]`） | 单独复跑 1 过 1 败；**独立跑整文件 9/9 PASS**（`12`） | 与 C2 事务补丁无关：失败点是 P1 控制权/HUD 断言与随机死亡时序；**偶发，未消除，保留** |
| `tests/audit.spec.ts:508` P2 boss bullets | 首轮失败于 `laser(3)+shockwave(12) bullets` 期望 15 实际 16（多 1 发） | 复跑 2 次**均通过** | 计时敏感的 boss 弹丸计数 flaky，**偶发，未消除，保留** |
| `tests/vs01.spec.ts:131` route B | `y` 期望 10.5 实际 10.6（另一轮 x 2.7 vs ≤2.6） | 复跑 3 次：2 过 1 败 | Station Zero **legacy slice** 精确坐标 flaky；`780cece` 未改 `src/slice/`、不改 slice 追绿，**保留** |

均属测试时序/精确坐标敏感，非 C2 事务契约回归；不影响 C2 阻断解除结论。

## 6. 构建门禁区分（生产 vs 测试）

- 生产构建：`simFixture` / `playerDataFixture` / `clearEnemiesForTest` / `resetProjectilesForTest` / `stepSimulationTicksForTest` 在 production 抛 `dev/test only`（上轮已验，本轮 `resume-no-step` 的新断言在 dev server 下运行，不依赖生产写入口）。
- 官方 `resume-no-step.spec.ts` 通过**真实产品回调**（`gs.onPause() / onResume() / onLevelUpClosed()`）与 `gs.update(0, delta)` 驱动，不使用 test-only 步进口 → 与被测契约一致；我的独立探针同样只用真实回调 + `update()`，结论可独立成立。

## 7. C2 放行判定与边界

| 项 | 判定 |
| --- | --- |
| resume 强制 tick 阻断 | **关闭**（官方 9/9 + 我独立探针 12 项全过） |
| storage 重试覆盖缺口 | **关闭**（官方新用例 PASS + 我独立探针验证不误报/不双扣/恢复一次） |
| 上一轮已确认关闭项（ledger 硬配额、房间清空顺序、升级记录、装备标签、loot 单位） | 保持关闭（parity 4 脚本全过、checkpoint/audit/purchase-ledger/supply-transaction 全过） |
| **C2 阻断** | **解除**（就 780cece 范围）；三个偶发用例保留记录，未声称全绿 |
| **C3b** | 可进入（连接层与事务契约已具备前提）；但 **C3b ≠ 外部 Agent 接入**，C2 完成 ≠ P2 整体完成，真实外部 Agent 战斗仍是 P2 完成条件 |
| 证据性质 | 全部为自动化测试/探针（夹具已声明：清怪建安全终端、`simFixture` dev-only 读取、seed 注入）；非真人/Agent 证据 |
| 未覆盖 | 未跑全量 53（`canvas` 5199 / `boss-room` 5173 硬编码端口仍被他人占用，未干扰）；已跑 25 核心 + 9 P1 + 9 resume×3 |

## 8. 复现

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse 780cece                       # 780cecef9187090c6274a048f1e93bec18401b48
git archive 780cece | tar -x -C D:/Project/AI-NATIVE-02-snapshots/780cece
# node_modules junction；dev server 5296 (strictPort)
npx tsc --noEmit && npm test
npx vite build --outDir ".../c2-resume-final/frozen-dist" --emptyOutDir && npm run game:mcp:build
PORT=5296 npx playwright test tests/resume-no-step.spec.ts --repeat-each=3 --workers=1
PORT=5296 npx playwright test tests/audit.spec.ts tests/checkpoint.spec.ts tests/economy.spec.ts \
  tests/c2-parity.spec.ts tests/purchase-ledger.spec.ts tests/supply-transaction.spec.ts --workers=1
npx vite-node scripts/c2-node-parity.ts && npx vite-node scripts/c2-kill-parity.ts \
  && npx vite-node scripts/c2-loot-pickup-parity.ts && npx vite-node scripts/c2-room-generation-parity.ts
# 探针（仓库根，BASE=http://localhost:5296/）：probe-resume.mjs / probe-storage-retry.mjs /
# probe-loot-magnet.mjs / probe-cli-coldstart.mjs
```
