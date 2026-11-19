# P3-b 前置纯共享规则 / 确认契约 — 独立定向审（冻结 ab59fe6）

- **被测**：`ab59fe6f346705df5570c4fad5f8dba5b672e718`（父 `c0cfdb6`；含 `77c9294` Echo 基础 stats、`c0cfdb6` 共享 Signal 纯规则、`dd42239` 纯 companionFacet）
- **冻结**：`git archive ab59fe6` → `D:/Project/AI-NATIVE-02-snapshots/ab59fe6`（`node_modules` junction），MD5 见 `00-frozen-hashes.log`；未读共享 WIP / 未读 stash，未改源码/测试/配置/分支。
  - 复核结束时活仓库 HEAD=`ab59fe6`，但工作区已有下一轮接线 WIP（`companionFacet.ts`、`worldBridgeServer.ts`、`GameScene.ts`、`PauseScene.ts`）；**本轮未读取/未使用**。
- **结论：纯规则/契约本身独立通过；但当前没有 LLM 工具、没有正式 Signal，World/gateway/bridge/UI 未接线，不能当完整 P3-b，更不能声称 P4/全 Run。**

## 1. 门禁 / 最小回归（一行式）

| 项 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| typecheck | `npx tsc --noEmit` | PASS | `01-typecheck.log` |
| unit | `npm test` | PASS **51 files / 644 tests** | `02-unit.log` |
| MCP build | `npx vite build --config vite.mcp.config.ts` | PASS | `03-mcp-build.log` |
| test 构建 | `npx vite build --mode test --outDir …/test-dist` | PASS | `03b-test-build.log` |
| 旧 slice unit | `npx vitest run src/slice` | PASS **5 files / 59 tests** | `04-slice-unit.log` |
| vs00/vs01 E2E | `PORT=5381 npx playwright test tests/vs00.spec.ts tests/vs01.spec.ts --workers=1` | PASS **13/13**（已知 `vs01:131` 精确坐标 flake 本轮未出现；未追绿、未复跑） | `05-vs-e2e.log` |
| P3a 定向 | `p3a-restore + p3a-enemy-target` | PASS **3/3** | `06-p3a-targeted.log` |
| C3b resume | `tests/resume-no-step.spec.ts` | PASS 3/3 | `15-resume.log` |
| MCP 面 | 官方 SDK Player+Dev listTools + `world_signal_status` | PASS：无 LLM/Signal/Companion 工具；Signal `E_NOT_APPLICABLE / world.signal_combat_unsupported` | `14-mcp-surface.log` |

## 2. Signal 纯规则（我的独立探针 20/20）

- `SLICE` 与 `SIGNAL_TUNING` 逐项相等；player/echo 各自 100 energy，绝不共享。
- **能量不足/扣费一次**：energy 9 → `scanBlocker=E_ENERGY_INSUFFICIENT`；100 → `chargeScan` 后 90、CD120、reveal480、原对象不变；第二次 `E_COOLDOWN`（不重复扣 10）。`jam` 100→75、CD480、duration360，二次 `E_RETRYABLE`；`chargeJam(...,false)` 不改设备倒计时。
- **regen 暂停**：paused 30 tick 仍 50/regenAcc 0；非暂停 12 tick +1；cooldowns paused 不变、running 递减；`scanBlocker(paused)=E_PAUSED`。
- **scan 证据 expiry / 归属**：tick10 发现范围内 `a`（99 格外 `b` 被裁），`expiresAtTick=490`、`observerActorId='echo'`；tick489 保留、tick490 删除；共享 range+LOS（scan12/jam6）。
- **jam 手动开关保留**：`manualEnabled=true` → ACTIVE；`applyJamToRelay` → JAMMED、`relayOutput=false`（不等于上电/ACTIVE）；`clearJam` 后 `manualEnabled` 仍 true → ACTIVE。`relayState(false,true,jammed)=JAMMED` 与 `INACTIVE` 区分明确。
- 日志 `11-signal-pure.log`。

## 3. Companion 纯权限 / 确认契约（我的独立探针 22/22）

- Owner capability：真凭据可用；**JSON 往返、伪造 Symbol、假 Origin/header、token/字符串**全部被 `isOwnerCapability` 拒绝；`OwnerLedger.decide` 对伪造凭据 `E_PERMISSION`。
- `observe` 输出不含 auth/token/Origin；`suggest` 只产生 `proposed`，facet 无 `confirm/execute/restoreSnapshot`；`OwnerLedger` 仅记录决定，不执行。
- **TTL/epoch/去重**：同 id 同 payload `replayed:true`、异 payload `E_ID_PAYLOAD_MISMATCH`；`advanceTo(10)` 后过期，重放旧 id `E_RETRY_AFTER_EVICTION`；`rebindEpoch(2)` 后旧 epoch observe/decide 均拒；owner 决定重复 `E_RETRYABLE`。
- **容量/记忆界**：`maxDedupRecords=3` 第 4 个新 id `E_RESOURCE_LIMIT / companion.dedup_limit`；20 个 actor 观察后 memory 恰好 16；TTL600 后旧项清除；AI/External owner `readOnly`、fallback `NO_MODEL` 且清空 pending；snapshot 无 hidden/auth。
- 日志 `12-companion-pure.log`。

## 4. Echo 存档基础 stats 与正常受伤运行帧（7/7）

- 真实 `captureCheckpoint` 得合法 frame；`validateCheckpoint` 与 `validEchoActor` 均 true。
- 逐个篡改 18 个精确基础字段（`damage/speed/maxHp/hpRegen/xp/currency/weaponKey/...`）及 `upgrades/abilities` 注入，全部被 `validateCheckpoint` 拒绝；旧档无 echo 仍合法。
- 正常受伤运行帧（echo HP **42**、player **55**、`aimYaw=-1.2`、dash/invuln/hurt/fire 计时器与 reloadTimer 非零）`restoreCheckpoint` 成功：HP 42/55 无免费回血、计时器/朝向保留、assist=false、mode=follow、shots=0。
- 日志 `13-echo-checkpoint.log`、`echo-checkpoint.json`。

## 5. dev vs test-build preview 差异（具体谓词，不写“环境”）

| 运行 | 结果 | 证据 |
| --- | --- | --- |
| dev server（`vite --port 5381`，未压缩、所有 html 直出） | **7/7 PASS** | `07-checkpoint-economy-dev.log` |
| `--mode test` 构建 + `vite preview --port 5382`（minify） | **4/7 PASS，3 FAIL** | `08-checkpoint-economy-preview.log` |

失败不是“环境”二字能解释，具体是：

1. `tests/checkpoint.spec.ts:51` `expect(card, 'level-up card available').not.toBeNull()` → **Received: null**。同一文件用 `s.constructor.name === 'LevelUpScene'` 找场景；minify 后构造名变成 **`jp`**（bundle 中 `class jp extends re.Scene{constructor(){super("LevelUpScene")`），GameScene 是 **`Wp`**、MainMenuScene **`Pa`**（`10-preview-names.log`、`09-preview-dom.log`），所以按类名查找失败。
2. `tests/economy.spec.ts:34` `expect(page.getByText('Supply terminal · clear remaining threats')).toBeVisible()` → **element(s) not found**；`tests/economy.spec.ts:160` `expect(page.locator('#supply-open')).toBeVisible()` → **element(s) not found**。
   - 根因：`vite.config.ts` 的 `rollupOptions.input` 只有 `main` 与 `station-zero`，**没有 `economy.html`**；`test-dist/` 只有 `index.html` 与 `station-zero.html`。preview 请求 `/economy.html` 回落到 `index.html`（探针：`hasCanvas=true, hasSupplyOpen=false, script=./assets/main-CtDoQqaX.js`、scene ctor `Pa`），自然没有 Supply terminal DOM。
- 这是**测试构建输入配置 + 依赖未压缩类名的测试选择器**问题；同一份代码 dev server 7/7，不是本轮纯规则回归。正式 E2E 仍以 dev server 为准。

## 6. 当前没有的东西（必须保留的边界）

- 官方 MCP Player/Dev 工具清单没有 `echo_*` / `signal_*` / `companion` / LLM 工具；`world_signal_status` 固定 `E_NOT_APPLICABLE / world.signal_combat_unsupported`（`14-mcp-surface.log`）。
- `companionFacet`、`signalCore/relay` 只是纯模块，**未注册 gateway/bridge/MCP/UI，未改 core/World 执行路径**；没有正式 Relay 场景、能量设备、scan/jam 动作、Signal Combat 批测、跨端 echoSignal parity。
- 没有真实 LLM 逐轮实跑，没有预写建议策略，不伪造 connected/LLM；ECHO 仍是本地确定性策略 + 人类确认。
- 未跑 70 全量；未重做历史架构审查。

## 7. 判定

| 项 | 判定 |
| --- | --- |
| 旧 slice 纯规则 59 + vs00/vs01 13 | PASS（已知精确坐标 flake 本轮未现，未追绿） |
| Signal 纯能量/扣费/regen/evidence/jam 契约 | PASS 20/20 |
| Companion 纯权限/TTL/epoch/去重/记忆16 契约 | PASS 22/22 |
| Echo 基础 stats 固定 + 正常 damaged 运行帧恢复 | PASS 7/7 |
| type/unit/buildMCP/P3a restore+legacy3/C3b resume | PASS |
| dev vs test-build checkpoint/economy | dev 7/7；preview 3 个具体失败（minify 构造名 `jp/Wp/Pa` + 缺 `economy.html` 输入），已定位、非新回归 |
| **完整 P3-b / P4 / AI-NATIVE-02 整体** | **不 PASS**：无 LLM 工具、无正式 Signal、未接线、未实跑；本轮只能作为纯前置契约放行依据 |

## 8. 复现

```bash
cd D:/Project/AI-NATIVE-02-snapshots/ab59fe6
npx tsc --noEmit && npm test
npx vite build --config vite.mcp.config.ts
npx vite build --mode test --outDir .../test-dist
npx vitest run src/slice
npx vite-node probe-signal-pure.mts ; npx vite-node probe-companion-pure.mts
PORT=5381 npx playwright test tests/vs00.spec.ts tests/vs01.spec.ts --workers=1
PORT=5381 npx playwright test tests/p3a-restore.spec.ts tests/p3a-enemy-target.spec.ts --workers=1
PORT=5381 npx playwright test tests/checkpoint.spec.ts tests/economy.spec.ts --workers=1
PORT=5382 npx playwright test tests/checkpoint.spec.ts tests/economy.spec.ts --workers=1
node .../probe-echo-checkpoint.mjs ; node .../probe-mcp-surface.mjs
```

## 9. 文件

`reports/ai-native-02/tester/p3b-pure-final/`：`00-frozen-hashes.log`、`01–04` 门禁、`05–08` E2E、`09–10` preview DOM/构造名、`11` Signal 纯探针、`12` Companion 纯探针、`13` Echo checkpoint、`14` MCP 面、`15` resume、`echo-checkpoint.json`、`test-dist/`、`probe-*.mjs/.mts`。
