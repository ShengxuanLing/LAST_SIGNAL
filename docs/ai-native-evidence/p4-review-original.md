# AI-NATIVE-01 P4 — 真实 Codex Player 执行证据原始审查

> 角色：Reviewer Worker，只读审查。不改源码/测试/配置、未 commit/切分支、未等待/轮询、未重跑无关全套。
> 报告：`D:/Project/AI-NATIVE-01-evidence/p4-review-original.md`；本轮机检日志：`D:/Project/AI-NATIVE-01-evidence/p4-reviewer-verify.log`。
> 原始不可变记录：`D:/Project/AI-NATIVE-01-evidence/p4-codex-live.jsonl`（600142B，SHA256 `0ba5cdb4f305527bd9de12e01a987c1dc5d7a2d3bed4c86eb940d418a09aea52`，与 Lead 给定一致）。
> 中立 bridge：`D:/Project/AI-NATIVE-01-evidence/p4-agent-bridge.mjs`（无地图/策略/游戏 import，仅 StdioClientTransport 转发）。
> 仓库状态：`feat/ai-native-runtime`，HEAD `ddcd7e9580346a2411e3b10c369dd3bfc1ef4edd`（P3 已 commit/push，分支干净）。本轮不动主 World/key/version、不 commit。

---

## 结论

**这份 `p4-codex-live.jsonl` 可作为“当前 Codex 经标准 Player MCP 真实交互游玩至完成”的原始证据，但有明确边界与一处 P4 产品反馈阻断项。** 证据真实性成立：中立 bridge 无策略/Dev/隐藏状态；全程仅用 Player 6 工具、单一生产 session、epoch=0、无 fixture/种子/私有快照；模型决策逐步可追溯（interact 失败→Jam 过门、两次 shoot_guard 清敌、Relay 启用后等待公开 89 ticks 通桥、最终北探完成）；一次 `E_SCHEMA`（scan 空 payload）原样保留并已自我纠正。

必须显式说明的边界（不虚称）：
1. **非盲测**：bridge `start` 记录 `agent: "current Codex lead"`，且 Lead 已审过本项目，模型带着既有项目知识决策，不是“独立外部模型 API 盲测”。
2. **Token / 内部推理不可获**：trace 仅记录工具往返耗时（22 次结果累计 93.0398ms），工具耗时 ≠ 推理延迟；模型 token 量与内部思考量无法从证据得出，不得杜撰。
3. **完成态资源值可在 trace 内独立核验**：最终 `game_step`（tick=501, `status:"finished"`）的 `structuredContent.result.observation.current.self` 直接包含 `hp:100, energy:96, crossed:true, completed:true`（同文件第 40 行 result；Leader 证明日志 `p4-leader-final-observation-proof.log` 一致）。注意该观察位于 `result.observation` 嵌套路径，`game_step` 与 `game_observe` 都会回传；本审查首版只查了顶层 `observation`（仅 game_observe 有）而漏掉 `result.observation`，系审查脚本路径错误，非证据缺失。SDK 同时返回 `content` 文本与 `structuredContent` 两份，二者都应检视，但本 trace 的 `content` 文本未含 observation，核验以 `structuredContent.result.observation` 为准。
4. **观察质量问题（P4 产品反馈阻断项，developer 正修，不在本轮中间态复查）**：本 trace 的 2 次 `game_observe` 观察里，事件体的 `sessionId` 为 `ses_8249e0cbadeb5177e10dc4a8`，与真实 session `ses_f09b11ac0567951eadd6dccd` 不一致（共 3 条事件 sessionId 错位）。这正属于 Lead 点名的 “observation 中 origin/actor/action/session 引用” 质量缺陷的实例；本审查只记录，不评中间修复态。
5. **固定重放/集成脚本不能替代**：回放脚本仅复现本次决策结果，不是第二次真实 Agent；本证据价值在于“一次真实的逐次 MCP 决策运行”，复现脚本不可等同。

---

## 1. 证据真实性与边界核验（p4-reviewer-verify.log）

```text
sha256 | PASS | D:/Project/AI-NATIVE-01-evidence/p4-codex-live.jsonl
row_kinds | PASS | {start:1, request:23, result:22, closed:1}
request_count | PASS | 23
result_count | PASS | 22   (另有 1 条 quit 请求不产生 result)
player_only_tools | PASS | [create, observe, execute_action, get_events, step, close]
no_dev_tools | PASS | 未出现任何 Dev 工具
single_session | PASS | ses_f09b11ac0567951eadd6dccd
create_production_no_seed | PASS | kind=production，无 seed
final_status_finished | PASS | status=finished, tick=501
public_events_29 | PASS | game_get_events total=29
e_schema_preserved | PASS | 首次 scan 空 payload -> E_SCHEMA 原样保留
observation_sessionid_mismatch | INFO | 2 次观察，3 条事件 sessionId 错位（P4 反馈项）
```

- bridge 文件仅 `import` MCP SDK 的 `Client`/`StdioClientTransport` 与 node `readline`/`fs`/`perf_hooks`，**无任何 scenario/route/strategy/游戏代码 import**，每条 stdin 命令原样转成 `listTools`/`callTool` 并 append 到 jsonl——无硬编码策略或隐藏状态读取。
- 23 次请求全部为 Player 6 工具（create×1、observe×2、execute_action×4、step×13、get_events×1、close×1、quit×1）；无 `game_snapshot`/`game_restore`/`game_inject_fixture`/`game_run_scenario` 等 Dev 工具，无 `seed`、无私有快照。

## 2. 决策可追溯（tick / 资源 / 事件 / completed）

tick 单调推进（0→1→2→3→63→153→154→155→185→215→235→236→325→385→445→490→501），与 Lead 叙述一致：

```text
scan(空payload) -> E_SCHEMA            (原样错误，已纠正)
scan{type:scan} -> tick1
interact(lab_door_receiver) -> tick2   (失败，未过门)
jam(lab_door_receiver) -> tick3        (过门)
move 60 -> tick63 (completed)
move 90 -> tick153; scan ->154; shoot_guard ->155; move30->185; shoot_guard->215; move20->235
interact(corridor_relay) -> tick236    (启用 Relay)
wait 89 -> tick325                     (公开等待 89 ticks 后通桥)
move 60 ->385; move60->445; move45->490; move(0,-1)18 -> tick501 (finished)
get_events cursor0 limit100 -> 29 公开事件
close -> ok
```

- 所有 action 类型（scan/interact/jam/move/shoot_guard/wait）均为公开 `ActionPayloadV1` 枚举成员；无 advanced/dev 动作。
- 公开事件 29 条可由 `game_get_events` 独立取回（`total=29`），包含 `SESSION_CREATED` 等，事件 `sessionId` 在顶层一致（仅观察内嵌事件存在上述错位）。
- 完成态：`final step status="finished", tick=501`（`final_status_finished | PASS`）；其 `structuredContent.result.observation.current.self` 含 `hp:100, energy:96, crossed:true, completed:true`（`final_self_in_jsonl | PASS`），可由不可变文件独立核验。

## 3. 非盲测 / 度量声明边界

- trace `start` 行：`agent:"current Codex lead"`，`strategy:"interactive decisions by model; transport has no policy"`，`modelTokenUsage:null`。
- 因此：这是“当前 Codex（Lead）通过标准 Player MCP 实操”，**不是独立外部模型 API 的多轮盲测**；既有项目知识被使用，必须明示，不得包装成未知外部模型。
- 工具往返累计 93.0398ms（22 次结果）仅为 MCP 调用耗时，不能换算为模型推理延迟；墙钟约 258 秒是交互间隔，不等于思考时间；token/内部推理用量不可得，禁止编造。

## 4. P4 产品反馈阻断项（记录，非本轮代码复查）

- **观察内事件 sessionId 错位**：2 次 `game_observe` 返回的 `observation.events[].sessionId = ses_8249e0cbadeb5177e10dc4a8`，与真实 `ses_f09b11ac0567951eadd6dccd` 不符（3 条事件）。这是 Lead 点名 “observation 中 origin/actor/action/session 引用” 质量问题的具体实例。
- 本审查范围：仅验证该缺陷确实存在于原始证据中并记录；developer 正在修复，本轮不复查中间修复态、不动源码。
- 同时提示（已撤回）：首版曾建议在终步前再请求一次 `game_observe` 以落盘完成态；经复核最终 `game_step` 的 `structuredContent.result.observation` 已含完成态 self，该建议不再需要。

---

## 5. Gate 汇总（命令 | PASS/FAIL | 日志绝对路径）

```text
python3 verify p4-codex-live.jsonl (nested result.observation path) | PASS | D:/Project/AI-NATIVE-01-evidence/p4-reviewer-verify.log
```

新增/修正核验项：

```text
final_self_in_jsonl | PASS | self={position, energy:96, hp:100, crossed:true, completed:true}
final_status_finished | PASS | tick=501
observation_sessionid_mismatch | INFO | 15 次观察, 257 条事件 sessionId 错位 (P4 反馈项)
```

（本轮为证据真实性审查，无源码编译/测试 gate；如需要可对 bridge 做语法/导入白名单复核，已在上文人工确认。）

---

## 6. 可提交结论

`p4-codex-live.jsonl`（SHA256 已校验、不可变）是**当前 Codex 经标准、中立 Player MCP 真实逐次决策游玩至 tick501 finished** 的原始证据：无 Dev/隐藏状态/脚本策略，决策、事件、完成态（含 `hp:100/energy:96/crossed/completed`，位于最终步 `result.observation`）均可由文件独立核验，一次 `E_SCHEMA` 原样保留。须如实声明其**非盲测**（Lead 既有项目知识）、**token/推理不可度量**。观察内事件 `sessionId` 错位是 P4 产品反馈阻断项（developer 修复中，本轮不查中间态）。固定重放/集成脚本不能替代此原始运行。本 Worker 未改动任何源码、未 commit。
