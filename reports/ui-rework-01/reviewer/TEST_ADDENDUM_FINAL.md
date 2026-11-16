# UI-REWORK-01 · B1/B2 返修最终复核（Reviewer · ADDENDUM-FINAL）

**结论：B1、B2 均闭环。无阻断。** 产品 `src` 与 `eb83eb4` 逐字节一致（冻结 hash 未变：PauseScene `3f01ebae…` / menuKit `c20131b2…` / GameScene `aec3ff04…`；`git diff eb83eb4 -- src/` 为空），本轮仅 `tests/audit.spec.ts`（+45/−4）、`tests/ui-menu-layout.spec.ts`（+37/−9）、`tester/REPORT.md` 变化。只读未改，未 commit/push；证据全写 `reviewer/`，未触碰 `reports/ai-native-02/` 与 tester 的 `addendum/` 证据。

## 1. 我本轮独立跑的定向 gate

| 命令 | 结果 | 日志（绝对路径） |
|---|---|---|
| `PORT=5173 LS_SHOT_DIR=…/reviewer/audit/pw-audit-shots2 npx playwright test tests/audit.spec.ts --grep "fixed-seed playability" --workers=1` | **PASS**（1 passed / 16.6s） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/pw-audit-teleport-fixed.log` |
| `PORT=5173 LS_SHOT_DIR=… npx playwright test tests/audit.spec.ts --grep "fixed-seed playability" --repeat-each=3 --workers=1` | **PASS**（3 passed / 50.7s） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/pw-audit-teleport-x3.log` |
| `PORT=5173 UI_PHASE=reviewer UI_OUT_DIR=… npx playwright test tests/ui-menu-layout.spec.ts --grep "re-authorize" --workers=1` | **PASS**（1 passed / 10.9s） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/pw-reauth-fixed.log` |

合计：teleport **4/4 绿**（返修前我在同机同条件独立复现过 red：`grid x` 偏移 `0.2400691498741736`，见 `logs/pw-audit-teleport.log`）；reauth **1/1 绿**（tester 另做 2/2）。未跑全量（按要求）。

## 2. B1（teleport）闭环判定：**闭环**

逐项核对 `git diff eb83eb4 -- tests/audit.spec.ts`：

1. **吞错已删除**：`.catch(() => undefined)` 消失；现在「站到 portal 格」的 `waitForFunction`（8s）失败即红，不再被后续几何断言掩盖。✅
2. **固定长等待已删除**：`waitForTimeout(500→1200)` 整段删除，替换为三个**真实条件等待**，全部无 catch：①玩家在 portal 格（`<0.01`，8s）；②按 F 后「已换房 **且** 落在预测落点（`<0.01`，10s）」；③camera 收拢到原有阈值（`<120`，6s）。✅
3. **几何/可玩性阈值一字未改**：`<0.01` 格 ×2、`spriteErr < 1`、`room != beforeRoom`、`centerErr < 120` 全部原样保留，没有把 expected 改成 actual。✅
4. **诊断可复核**：`|diff| = hypot(0.2400691, 0.2880830) = 0.375000` 与 tester §10.1 一致；0.375 = 24px = `PLAYER_RADIUS(0.5)+0.5` 的**角色分离推出**距离，方向为单位向量。这与我返修前独立测到的 x 分量 `0.2400691498741736` **完全吻合**，说明根因判断（敌人站在落点格被 core 分离）成立，也排除了「findWalkable 与 core 落点语义不同」这一方向。✅
5. **fixture 只隔离几何、不绕过战斗验收**：`clearEnemiesForTest()` + `resetProjectilesForTest()` 是 **eb83eb4 里既有的 core 测试 seam**（`World.ts:90` / `:125`，另有 4 个既有 spec 在用），且调用点位于**传送步骤之前一刻**——该 spec 的 kill/loot/damage/升级/暂停等真实战斗断言都已在此之前跑完，被清的只是「传送落点上的残留敌人」。→ 判断：**仅隔离几何断言，不削弱此前的战斗可玩性验收**。✅
6. 残留观察（非阻断）：第 ③ 个等待用的是与 `centerErr < 120` **同一个判据**，等于把该断言变成「等待成立即断言成立」。这与项目既有的「条件等待优先于固定 sleep」做法一致，且超时仍会红；但严格说它已无法独立失败。若未来要保留这一断言的独立诊断力，可把它改成「对 camera 收敛过程采样」而不是等同一阈值。

## 3. B2（reauth）闭环判定：**闭环**

逐项核对 `git diff eb83eb4 -- tests/ui-menu-layout.spec.ts`：

1. **负向断言改到真实原因**：`expect(reobserved.ok).toBe(false)` **且** `toMatch(/no_observation|E_LINK_UNAVAILABLE/)`；注释已改成「re-authorize 只清已发布 observation、取消未确认建议，session/epoch 不变，agent 需重新观察后才能提案（非安全撤销）」。✅ 与源码完全一致（`companionGateway.authorize(reauthorize)` → `facet.reauthorize()` 只 `cancelUnconfirmed()` + `lastObservation = null`；返回 `{session, epoch}` 原值）。
2. **恢复 post-swap 可用性覆盖（关键）**：不再 `sdk.client.close()` 重建，而是**同一个** SDK 会话走完整真实链路——房间内放真实 drone → `resumeGame()` 跑 **>8 个真实 tick**（渲染侧重新发布 observation）→ 重回 LLM 页 → `expect.poll` 等 `echo_observe` ok → `echo_suggest` ok → `waitForButton('CONFIRM FIRST PROPOSAL')` → 人类点击 CONFIRM → 断言 `world.hasPendingCompanionIntent === true`。✅ 这正好补回我上一轮指出的「swap 后链路仍可用 + 人类仍能确认」这条唯一覆盖，且走真实渲染侧发布路径、无 mock。
3. **原有正向断言全部保留**：同实例标记仍在、reauth 后 `CONNECTED`、旧 proposal 退役（CONFIRM 禁用 + 点击不入队）、DISCONNECT 后状态不再 CONNECTED 且文案 `OFFLINE|NOT CONNECTED`。✅
4. 所以「cap 原子替换 / 老 cap 失效」不再由这条 e2e 冒充（协议层仍由 `ownerAuth.test.ts` C3/C4 覆盖），e2e 只声明状态性拒绝 + 可用性恢复 —— 语义分工正确。✅

## 4. 报告口径核对：均已修正

| 项 | 核对结果 |
|---|---|
| 本 spec 条数 24 → **25** | ✅ 已改（§2 第 30 行、§7 第 131 行均为「25 条：6 capture + 6 audit + 13 单例」），与我数日志的 25 一致 |
| 113 与 118 **不同集合** | ✅ §2 明确写「`37-` 跑在 `eb83eb4` 之前、本 spec 当时还没有现在的 25 条定义；113 不得当本集合历史通过率」；并声明 118 是「当前集合的**单次全量绿**，不代表确定性稳定（前两轮各 117/118）」——表述准确 |
| 「teleport flake 已修（加长等待）」 | ✅ 已撤回，改为「定位到 0.375 格角色分离 + 真实条件等待 + core seam；5/5 复跑绿」。我独立 4/4 绿佐证 |
| 「旧会话被安全撤销」 | ✅ 已撤回，改为「reauth 清空 observation（状态性拒绝），session/epoch 不变；cap 原子替换由 ownerAuth C3/C4 覆盖」 |
| P2（整文件 1 failed，16 vs 15） | ✅ 真实记录：`expect(bossInit.count, 'laser(3) + shockwave(12) bullets created').toBe(15)`（`tests/audit.spec.ts:800`）实测偶发 16（前一阶段残留弹丸），整文件 `1 failed / 1 passed`，隔离 `--repeat-each=3` 3/3 绿，明确标注「既有 flake、未修、非本单引入」。**该断言与本 diff 无关**（diff 只动传送那一个 hunk） |
| whale-dash 5s 未出现 | ✅ §10.5 记录为既有、未修，隔离 3/3 绿 |

## 5. 剩余非阻断（4 条，不影响本次提交）

1. `camera <120` 的等待与其后断言同判据（见 §2.6）：断言不再能独立失败；属既有「条件等待」风格的可接受取舍。
2. `audit.spec` P2 的 `bossInit.count === 15` 是**严格相等**，受前一阶段残留弹丸影响偶发 16：既有 flake、未修。若将来要修，建议改为「等弹丸数量稳定后取样」或按本次同款思路用 core seam 清残留，**不要**放宽为 `>=15`。
3. `whale-character.spec` 的 `whale-dash` 在重负载全量下 5s 内不出效果（隔离 3/3 绿）：既有、未修。
4. 118/118 仍是**单次全量绿**（本单定向返修后未再跑全量，按订单不跑）；FINAL_REPORT 应保持「单次绿 + 前两轮各 117/118 的既有 flake 记录」这一口径，不要写成确定性稳定。
   另：`after/` 48 张 PNG 在返修前那轮被重写过（字节变化），建议与代码/测试分开提交，且**不要**重写 `before/` 旧快照。

## 6. 证据范围

- **实跑**：上述 3 条命令（audit teleport ×1 + ×3、reauth ×1）。截图写入 `reviewer/audit/pw-audit-shots2`（已随复核结束清理，日志保留）；`LS_SHOT_DIR` / `UI_OUT_DIR` 隔离，未写作他人证据目录。
- **实读**：`tester/REPORT.md §10`（含 10.1–10.5）、`git diff eb83eb4 -- tests/`（两文件全部 hunks）、`World.ts` 两个 seam 的提交版本（`eb83eb4:src/world/World.ts:90/125`）与其在 4 个既有 spec 中的用法、`companionGateway.authorize` / `companionFacet.reauthorize` 源码、P2 断言原文与 `tester/addendum/audit-full-file.log`、`audit-p2-1..3.log`、`audit-teleport-regression.log`、`reauth-regression.log` 的 PASS 结论。
- **未做**：全量 118 重跑（按订单）；`1366/1600/1920` 视口截图逐张目检；`before/` 旧快照未复核内容。
