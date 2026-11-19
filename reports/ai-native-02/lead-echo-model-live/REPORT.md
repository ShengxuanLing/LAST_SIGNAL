# Lead 模型实际 Companion 两轮建议与 Owner UI 确认

日期：2026-11-15。冻结提交 d690848（SHA由本目录bootstrap.json及快照git archive记录关联）。官方 MCP SDK stdio连接companionMcpServer.mjs。没有预写建议策略；适配器仅传递模型逐次输入的tool JSON，另有显式分离的Owner UI自动化确认分支。

## 场景与权限

Owner bootstrap：真实NEW RUN、调用enableEcho，在实际生成start room正常spawn一只drone，无HP/伤害/资源/无敌修改。Owner填写真实表单URL/Agent token/独立Owner key，没有global预注入；Agent子进程环境仅BRIDGE_URL+TOKEN，拿不到Owner key/cap。实际确认由自动化点击游戏内CONFIRM，明确**不是真人授权/确认验收**，也不是Agent MCP工具。

渲染使用Chromium录屏viewport；不是Node Headless规则运行。模型等待时游戏处于用户可用的Pause Companion面板，Owner确认后关闭面板，按正常RAF运行600ms，再暂停。没有手动step/修改tick或保持无敌。独立Agent租约在模型读取观察期间持续正常续约。

## 原始实际序列

1. echo_observe：epoch1，tick9，echo(9,45)HP100，player(8,45)，drone#1(9,43)HP24；记忆1条。
2. Lead基于该观察自主选择echo_suggest fire target(9,43),reason=perceived_hostile，req/sug ...201，TTL600。结果proposed。echo_status仍显示pending，尚未执行。
3. Owner UI自动确认第一个建议→正常帧→tick36，drone HP6，playerHP100，echoHP100。Owner记录在owner-ui.jsonl；不是模型侧拿Owner能力。
4. echo_observe：tick29，drone#1移动到(9,42.7734375)，HP6；记忆从tick9增加tick29位置。
5. Lead根据新观察更新射击目标，echo_suggest fire target(9,42.7734375)，req/sug ...202，TTL600。
6. Owner UI自动确认第二个建议→正常帧→tick61，敌人列表空，playerHP100，echoHP94。画面真实KILLS1/DMG30/XP8/HOSTILES0、ECHO94/100 FOLLOW ASSIST SAFE COMPANION CONNECTED。
7. 后续echo_observe（tick58缓存post-commit观察）drones=[]；echo_memory返回2条、TTL600；echo_status连接仍正常。关闭SDK/浏览器/桥，录像已落盘。

原始MCP I/O：tool-io.jsonl；Owner确认行为与结果：owner-ui.jsonl；截图round-*-agent/owner.png；video/*.webm。通用适配器：owner-bootstrap-and-agent-adapter.mts。

## 限制与待核对

- 模型亲自选择两次不同目标（由相邻观察导出），适配器无自主选择目标/战斗策略。仅两个建议的最小遭遇，不是完整Run/长期人格/Signal协作。
- Owner自动确认夹具≠真正人类确认。该证据只能说明模型建议经独立Owner UI路径生效，不能关闭最终真人交互验收。
- SDK echo_status.pending仍把已确认建议显示proposed（Owner面板已WAITING no proposal）；真实确认状态在独立Owner ledger，建议后续Agent只读状态暴露自己的confirmed/applied receipt，不能靠此旧status字段判断是否执行。本次效果依据后续观察、Owner只读记录与HUD/录像。
- 最后observation tick58比Owner读数tick61落后3tick（明确时间戳，非伪造实时），所以该观察echoHP仍100；真实HUD与Owner结果echoHP94。不得把缓存观察称tick61完整新帧。
- 之前7fd表单失败、ae8暂停无首观察/过期均保留在../lead-echo-live和../lead-echo-model-fixed；本目录不混入失败回合。
- 尚未Signal；Relay C仍开发中。需独立Reviewer检查源代码/日志/录像后再关闭相应子项。
