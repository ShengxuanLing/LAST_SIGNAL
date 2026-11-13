# AI-NATIVE-01 最终交付报告

验收日期：2026-11-13。最低成功标准 **PASS**：当前 Codex 经标准 Player MCP，在后台真实运行 Station Zero，共享权威规则，无前台窗口/全局键鼠操作，合法完成一条门与桥路线，并保存可重放执行记录。P0–P5 均有独立提交与 Orca Worker Tester/Reviewer 验收。正式完整 ECHO、主 World 确定性及跨进程快照导入不属于已完成能力。

## Git 与审查

分支 `feat/ai-native-runtime`；PR [#3](https://github.com/ShengxuanLing/LAST_SIGNAL/pull/3)，未合并 main、未 force push。

| 阶段 | 独立提交 | 结果 |
| --- | --- | --- |
| P0 | `95e8da35dcaff9000ae0147ef3ec80b0e0a085fc` | 协议/权限/校验测试 PASS |
| P1 | `8a5b7c250b6a878c77bfee99b65163ba2c907b5d` | 共享 Headless 核心、CLI、快照/回放 PASS |
| P2 | `5d4fe9128f21555997b2c301fe25a20a056f6490` | Session、授权、幂等、取消、事务 PASS |
| P3 | `ddcd7e9580346a2411e3b10c369dd3bfc1ef4edd` | 官方 MCP、Dev Harness、batch PASS |
| P4 | `56e4902044a3dae94c6b7cca1d7eceb46b29a947` | 真实 Codex Player 执行、归因反馈修复 PASS |
| P5 | `903096ddd1402658d1bf662af2cb9c2b41f04015` | 隔离 ECHO 最小双 Actor 闭环 PASS |

开始时已 fetch 并核实最新 origin/main 为 `c656f788227f44efec993315bfb65a323e398377`，从它新建功能分支，保护干净工作区。结束时观察到 origin/main 已前进至 `e11c6e652959f38173cba6e739fd8e28bdbc147f`（背包/外观等其他工作）；未改动/合入其他 Worker 分支。本地测试针对本功能分支，未宣称验过新增 main 功能组合；PR 最后检查显示 MERGEABLE，远端 CI 结果以 GitHub 实时检查为准，不能以本机通过替代远端成功。

## 最终验收矩阵

| 能力 | 状态 | 真实证据与范围 |
| --- | --- | --- |
| Headless | PASS | 独立 Node，无 Phaser/DOM/Canvas；门/Relay/Bridge/Guard 使用已有模型 |
| AI Player | PASS | 当前 Codex 逐次 Player MCP 决策，tick501、HP100、Energy96、29事件 |
| Companion | PASS（最小隔离场景） | 一个 SliceModel/共同 tick；两 Actor 独立位置/观察/记忆；假设→人类确认→ECHO Jam→人类过门 |
| Dev Harness | PASS | 创建/加载注册场景、fixture/inspect/audit、推进、快照、恢复、回放、batch/compare |
| MCP | PASS | 官方 SDK stdio；默认 Player6工具，Dev16基础工具另加9个coop工具；参数不升级角色 |
| 权限 | PASS | closure 能力分面、Player/Companion不能Dev、人类Owner独占pause/resume/reset、epoch强制校验 |
| 确定性 | PASS（Station Zero） | 同seed/输入规范化状态与有序事件一致；0步/非零回放一致；不涵盖主World |
| 后台执行 | PASS | 独立Node/官方Client；stdout纯协议；无网络listen/OS输入，退出释放资源 |
| 兼容性 | PASS（本功能分支） | 最终292单测、P5节点完整23E2E首次及复跑通过；最后预算改动无slice/浏览器变更 |
| 存档/R9 | PASS（旧档兼容与同实例恢复） | 扫描位置/actor/action/tick/TTL绑定；恢复不重扫；旧档无证据安全降级；旧key/version不变 |
| 跨进程快照导入 | PARTIAL | 导出可审计样例；恢复只接受原签发实例/64条FIFO，跨实例与跨进程任意导入明确拒绝 |
| 测试 | PASS | 最终292/292；23/23浏览器；MCP/Actor/事务/权限反例和真实回放均独立验证 |
| 审查 | PASS | 各阶段独立 Orca Worker reviewer 无未关闭阻断；最终 Tester PASS |
| 正式ECHO/LLM人格/主World全面迁移 | PARTIAL | 只交隔离测试实体，不定剧情身份，无正式浏览器ECHO玩法 |
| R10多视口HUD/首次人类理解验证 | PENDING | 本任务未新增其修复/人类盲测结论，不能把自动化通关当理解验证 |

所有阶段十字段报告见 [AI_NATIVE_PHASE_REPORTS.md](AI_NATIVE_PHASE_REPORTS.md)，测试与失败历史见 [AI_NATIVE_TEST_REPORT.md](AI_NATIVE_TEST_REPORT.md)。

## 运行与调用

安装依赖后执行：

```sh
npm run typecheck
npm test
npm run build
npm run game:mcp:build
node dist-mcp/mcpServer.mjs
# 另一个可信测试进程可加 --dev；不要把此权限给普通玩家。
# node dist-mcp/mcpServer.mjs --dev
```

MCP 客户端直接启动 node 命令，避免 npm 横幅进入 stdout。`game_step`/`game_execute_action` 必填当前 epoch，来自 create/observe；同 requestId 原请求重试原回执、不推进时间；更换 payload 拒绝。fixture/restore 后必须更新 epoch。不要直接把私有 Runtime 对象或快照交给 Player。

```sh
npm run game:headless
npm run game:agent-client
npm run game:replay-p4
npm run game:coop-demo
```

Headless JSON行CLI是本机Dev验证入口；官方MCP为独立标准协议入口，二者不可混称。完整参数/注册矩阵/可信创建边界见 [MCP](AI_NATIVE_MCP.md)、[Sessions](AI_NATIVE_SESSIONS.md)、[Runtime](AI_NATIVE_RUNTIME.md)、[ECHO](AI_NATIVE_ECHO.md)。

## 真实 Agent 证据

当前 Codex Lead 在审阅项目后，通过无策略、无游戏 import 的中立客户端逐次选择合法动作；**非盲测**，不是另一个独立模型API调用实验。一次运行覆盖任务书A门链、B桥依赖、C已实现的Guard清除路线。未调用Dev/fixture/seed/私有快照，未调用run_scenario代替游玩。错误 E_SCHEMA 与普通门交互 E_LINK_UNAVAILABLE 原样保留。

- 原始47行：23请求/22结果（22MCP工具+quit）、600142B，SHA256 `0ba5cdb4f305527bd9de12e01a987c1dc5d7a2d3bed4c86eb940d418a09aea52`。
- [完整gzip归档](../examples/ai-native/p4-codex-live.jsonl.gz)、[校验](../examples/ai-native/p4-codex-live.sha256)、[可移植动作样例](../examples/ai-native/p4-player-trace.json)。decision文字仅记来源，不作为回放代码执行。
- 终步嵌套结构化观察直接记录 tick501/HP100/E96/crossed/completed；独立官方Player重放的各步tick/code与29条事件type/tick一致。
- 约257.9s交互墙钟；工具往返93.0398ms不是模型推理延迟。模型Token/内部推理次数不可获取，保持null，不把22工具调用写成22模型调用。
- 新seed/opaque身份及stateHash不同，不声称独立production重放全内部hash相同；只比较合法公开轨迹。固定回放不是第二次真实模型游玩。

## 性能与资源

P1 Tester 的实际基础测量原件：[performance-p1.json](../examples/ai-native/performance-p1.json)。这是2026-11-12的核心采样，非最终版本全功能吞吐承诺。

| 场景 | Wall time | CPU user/system | Heap变化 | 事件 |
| --- | --- | --- | --- | --- |
| 1000 ticks | 5.50ms（重复1.50ms） | 0/0µs，计时粒度不足 | +3,413,024B | 8 |
| 10000 ticks | 8.84ms | 15,000/16,000µs | -10,813,256B（含GC） | 1 |
| 10实例各100ticks | 9.91ms | 0/0µs，计时粒度不足 | +13,334,040B | 2 |

另测合法门桥固定动作链8.17ms（重复2.62ms）、tick518、21事件，重复规范化hash一致。它是基准脚本，不是P4模型运行；不能把空等tick吞吐当通关表现。Windows CPU采样较粗，内存受GC影响，原件含RSS/heap/重复哈希及隔离检查。

SessionManager硬上限10会话/2并发执行；step/action/tick/event/payload/快照/时间/取消均有界，idle自动回收，close/dispose释放。运行快照及coop签发表64FIFO，MCP原请求缓存256。最终小修将普通Session与coop注入同一ProcessSessionBudget，同进程总计最多10实例，构造失败/close/dispose释放；Dev场景/批量也取真实槽位，不能任意文件加载或执行代码。独立Tester混合预算官方SDK13/13、直连12/12通过，独立Reviewer无阻断。

## 可复核材料与限制

[ai-native-evidence/](ai-native-evidence/) 收录各阶段最终独立Reviewer结论和最终Tester结论。原始完整gate输出位于本机 `D:/Project/AI-NATIVE-01-evidence/`，未全部上传；报告内的绝对路径不是远端可下载日志链接。真实Player完整运行已另行归档进仓库。

[runtime-snapshot.sample.json](../examples/ai-native/runtime-snapshot.sample.json) 来自真实Dev/test模型，已验证结构与签发实例内恢复；是取证样例，不是可导入新进程的fixture。未知版本/篡改/跨实例快照拒绝，公开hash不是授权。

未删除既有存档/测试，未将fixture结果计为Player成功，未放宽容差或延长等待掩盖错误。开发者一次计时失败保留，Tester最终完整浏览器首次与复跑均通过。后续若要求跨进程安全导入、正式ECHO或新增main功能组合验收，应另作范围明确的实施与验证。
