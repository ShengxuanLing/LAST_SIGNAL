# GAMEPLAY-01 · P3 v2 展示候选 · 独立复审（只读 + 独立快照）

复审对象：`reports/gameplay-01/developer/p3/v2/manifest.json`（P3 v2 DISPLAY CANDIDATE，head `0083e20`）。
历史文件 `P3_REVIEW.md`（v1 的 FAIL）原样保留，不被本文覆盖；本文只记录 v2 的闭环与剩余项。

范围声明：**P3 v2 展示层的局部证据，不是整体 GAMEPLAY PASS**，也不含 P2 全链、P4 路线对比、P5 和真人体验
（`HUMAN ACCEPTANCE PENDING`）。全程无模型调用、无 push/commit，未使用 tester 的 5491/5199 端口与其克隆。

---

## 0. 快照与不可变约定

| 项 | 值 |
|---|---|
| 快照目录 | `D:\tmp\gp01-p3v2`（独立 cwd，未与 P4 共享） |
| 基线 | `git archive 0083e20` |
| 精确白名单（5 源 + 2 文档） | `src/ui/feedback.ts`、`src/ui/feedback.test.ts`、`src/scenes/PauseScene.ts`、`src/scenes/GameScene.ts`、`src/ui/menuKit.ts`、`docs/gameplay/P3_IMPLEMENTATION.md`、`docs/gameplay/AI_FEEDBACK.md` |
| 白名单 sha256（首/尾各测一次，未变） | `7c1e9bd9bf6b` / `717e87e604f3` / `ed3a1078824a` / `11af21869700` / `3fd125825579` / `ee73d7f87076` / `1d2a8db26b91`（与 manifest 及 Lead 给定值逐位一致） |
| 端口 | 5493（reviewer 自有；tester 5491/5199 未触碰） |
| 未复制的未来内容 | P4 的 `World` / `worldHeadless` 改动一律未取；快照内 P2 侧文件即 `0083e20` 提交态 |

运行日志 `reports/gameplay-01/reviewer/p3v2-browser.log` 头部记录了 cwd、白名单 hash 与端口；尾部 hash 与头部
一致，说明本轮复审期间源码未被再改。

---

## 1. Gate（一行一条，命令 → 结果 → 绝对日志）

- `npx vitest run src/ui/feedback.test.ts` → **PASS 8/8（1 文件）** → `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p3v2-feedback-unit.log`
- `npx playwright test -c _review/pw.p3v2.config.ts --workers=1`（单会话 5 阶段，1280×720 → 800×600）→ **PASS 1/1（22.8 s）** → `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p3v2-browser.log`
- 证据 JSON → `…\reports\gameplay-01\reviewer\p3v2-evidence\p3v2-review.json`；截图 6 张 → `…\reports\gameplay-01\reviewer\p3v2-shots\`
- 白名单 7 文件 hash 首尾不变 → **PASS**（见 §0 表）

未跑（按 Lead 指示，避免重复）：全套 E2E、794 单元、build、模型链。

---

## 2. 规则逐条核对

### 2.1 默认页面无 raw（MAJOR 已闭环）

默认 LOCAL COOPERATION 页可见文本全量采集，对 `local_\d+_\d+`、`tick \d+`、`room gen`、`target x.x`、
`E_[A-Z_]+` 五类正则**零命中**（`idleRaw: []`）：

```
ECHO LOCAL COOPERATION | LOCAL ECHO · A HUMAN CONFIRMS |
Ready to confirm · 94/100 HP · Following · Human owner |
Scan relay / Seen: relay in sight / Cost: 10 echo energy · range 12 tiles /
Ready now / A human must confirm / Expect: reveal relay details /
Only if still in sight and permitted | LOW-RISK COOPERATION…
```

排队后同页仍零命中（`queuedRaw: []`）——raw 只出现在主动点开的 `RECENT ACTIONS` 详情页，符合 Lead 批准的
“详情可追溯”设计，因此**不再计为 MAJOR**。

### 2.2 审计详情：友好行在前，raw 在后

真实确认产生 1 条审计后的实测文本（打开详情页）：

```
#1 You · Scan relay · Queued
  id local_165_1 · tick 165 · target 8.0,45.0 · room gen 1
```

- 首行 = 友好摘要（`^#\d+ (You|Model \(Owner\)) · `），raw 行 index 严格大于摘要行 index → PASS。
- 8 行满量（布局 fixture，见 §3）时 8 条摘要 + 8 条 raw 仍逐行交替，被拒行在摘要与 raw 之间插入
  `Not possible right now (E_PERMISSION)`（友好文案 + 括注原 code）→ PASS。

### 2.3 来源不再错误 OFFLINE

默认页无任何 `OFFLINE` 字样（正则 `/\bOFFLINE\b/` 未命中），来源行是 `LOCAL ECHO · A HUMAN CONFIRMS`。
`OFFLINE` 只保留在确实无模型的 `FALLBACK:NO_MODEL` 分支（`src/scenes/PauseScene.ts:875`），属真实状态，不是
面板默认值。**静态 + 本地页动态双重确认**。

### 2.4 默认 “Waiting to resume”、queued 双禁用、Done 仅真实 receipt

实测（真实点击 CONFIRM 后，暂停中）：

| 断言 | 实测 | 结果 |
|---|---|---|
| `sim.pendingCommands` | `['signal-scan']`（1 条） | 只入队 |
| 已应用 receipt | `applied = 0` | 未执行 |
| 提案区文案 | `Waiting to resume` / `Queued: Scan relay · runs after you resume` / `Confirm and reject are paused` | PASS |
| CONFIRM / REJECT | `enabled === false` / `enabled === false` | **双禁用** PASS |
| 提示区 | `Queued · Scan relay · runs after you resume` + `Recent actions: 1`，无 `Done` | 不谎报 PASS |
| 审计页 `Done` | 本次 0 条 applied → 文本无 `Done`；fixture 中唯一 `applied` 行显示 `Done` | 条件成立才出现 PASS |

### 2.5 纯 copy 不改状态

同一会话在本地页与审计页之间往返 3 轮（真实点击 RECENT ACTIONS / BACK / LOCAL COOPERATION）：

```
before = { pending: local_165_1(scan), queue: ['signal-scan'], audit: 1, applied: 0, echoHp: 94, proposal: null }
after  = { pending: local_165_1(scan), queue: ['signal-scan'], audit: 1, applied: 0, echoHp: 94, proposal: null }
```

pending、queue、审计条数、applied 计数、ECHO 血量、提案对象全部逐字段相等 → 不重生提案、不新增 receipt、
不产生假 applied。**未覆盖**：`restored` 守卫被清空的情形（该状态要从 rawsim 恢复才出现，本轮浏览器侧未构造），
只验证了普通 pending 的恒等。

### 2.6 布局 / 键盘 / 字号 / 对比度

| 检查 | 实测 | 结果 |
|---|---|---|
| 800×600 最小字号 | `minCss = 10.0`（logical 16 × FIT 0.625） | PASS（**零余量**，见 §4 M1） |
| 800×600 文本越界 | `outside: []`（含审计页） | PASS |
| 800×600 可交互重叠 | `overlaps: []` | PASS |
| 800×600 BACK 可达 | `true` | PASS |
| 8 行审计在 800 纵向占位 | `y=140, h=288, bottom=428 < 570`（BACK 按钮带） | PASS（不触发滚动，也无需滚动） |
| ESC 链 | 审计 → 本地页 → ECHO → 菜单 → 游戏，随后 sim 继续 tick | PASS |
| 对比度（相对 90% 遮罩 #04060b，含最坏情况=遮罩下最亮游戏画面） | #8fb8c8 7.75 / #cfe8ef 12.92 / #eafaff 15.42 / #ffd233 11.41 / #ff8a3c 7.04 | PASS ≥ 4.5 |

对比度按 WCAG 相对亮度计算，最坏情况背景 = `0.9·(4,6,11) + 0.1·(255,255,255)`，即面板后压着最亮的游戏画面。

### 2.7 LLM 页 “Takes effect when you resume”

源码静态确认：`PauseScene.ts:816` 的 LLM 页脚为 `CONFIRM ACTS ON THE ▶ LINE ONLY · Takes effect when you resume`，
与旧版“会被误读为立即生效”的措辞不同。**本轮未在浏览器里重新截图 LLM 页**（Lead 只要求 feedback 8 条 +
800/1280 必要项），因此这条记为“源码 + 清单确认”，不是浏览器实测。

---

## 3. 与 P3_REVIEW.md（v1 FAIL）的闭环对照

| v1 问题 | v2 现状 | 证据 |
|---|---|---|
| BLOCKER：manifest 与工作树不一致 | v2 manifest 5 源 hash 与工作树逐一相等（本轮首次/末次各测） | §0 |
| MAJOR：默认页暴露 raw id / tick / code / room gen | 默认页五类正则零命中，raw 移到 `RECENT ACTIONS` 详情 | §2.1 |
| MAJOR 级措辞：面板默认 OFFLINE | 来源行改为 `LOCAL ECHO · A HUMAN CONFIRMS`，OFFLINE 仅真实无模型时出现 | §2.3 |
| 审计行可读性 | 友好摘要在前、raw 在后，错误码带友好文案括注 | §2.2 |
| queued 期间按钮语义 | CONFIRM/REJECT 双禁用 + “Confirm and reject are paused” | §2.4 |
| Done 语义 | 仅在真实 `applied` receipt 出现 | §2.4 |
| LLM 生效时机措辞 | 页脚 “Takes effect when you resume” | §2.7（静态） |

v1 的 FAIL 结论保留在 `P3_REVIEW.md`；本文只说明其在 v2 上被修掉的部分。

---

## 4. 剩余项（不阻断展示候选，需如实记录）

- **M1 字号零余量**：800×600 最小 CSS 字号正好 `10.0`（compact SMALL_FONT 16 × 0.625）。达标但没有余量：任何
  字号下调 1 logical px、或 FIT 之外的缩放手感改动都会跌破 10。建议保持现状并在后续改动中把它当硬约束。
- **M2 8 行审计是布局 fixture**：为测满量，我在快照内用 `echoAudit.record()` 注入 8 条合成行（页面上明确是
  fixture，真实链路只产生 1 条）。它证明的是“8 行时的高度/字号/可读性”，**不是**“真实操作产生 8 行”的行为证据。
- **M3 守卫清空未覆盖**：`restored` 标志的浏览器路径（rawsim 恢复后才出现）本轮未构造，2.5 只覆盖普通 pending。
- **M4 LLM 页脚仅静态确认**（§2.7），未重截浏览器证据。
- 范围外未跑：P2 全链、P4 路线对比、P5、真人体验；`HUMAN ACCEPTANCE PENDING` 不变。

---

## 5. 结论

P3 v2 展示候选在**本轮已复核的范围内**通过：默认页零 raw、审计详情可追溯且友好行在前、来源不再误报 OFFLINE、
queued 双禁用与 “Waiting to resume” 一致、Done 只来自真实 receipt、纯复制不改状态、800×600 与对比度达标、
键盘 ESC 链正常。v1 的 BLOCKER/MAJOR 在 v2 源码上均已闭环。P3 局部结论仍不等于 GAMEPLAY 整体 PASS。
