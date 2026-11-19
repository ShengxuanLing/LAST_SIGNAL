# Lead 逐轮模型 Signal 最小协作

冻结代码：363eb173207bb5adaa0a21cd1af348dc92f29827。运行日期：2026-11-16。

本次是 Lead 根据每次官方 MCP 观察自行选择建议；运行辅助无建议策略。Owner 确认由独立 UI 自动点击完成，非真人授权/确认验收。源码未修改。正式运行与 `_smoke/` 演练分离。

## 原始过程

Agent 官方 companionMcpServer 环境仅 PATH/SystemRoot/TEMP/TMP、桥地址和 token 文件，无 Owner key/cap。工具原始返回在 tool-io.jsonl，Owner 行为及前后状态在 owner-ui.jsonl。

1. round1 echo_observe：tick171，echo(26,46)，relay_main(25,46) INACTIVE，objectiveBlocked=true，echo energy100/CD0。
2. round2 Lead 建议 scan，reason=perceived_relay，id末尾ab01，TTL600。仅 proposed，无执行。
3. 独立 `_owner_confirm`：decidedAtTick171，排队 signal-scan；暂停未提交。`_owner_resume` 正常帧后 receipt appliedTick172；tick200，玩家能量100、echo92（扣费后自然回复）、scanCD91，设备仍INACTIVE。Owner只读状态显示 evidence=1。
4. round3 echo_observe 得上述最新状态。Lead 因出口受阻选择 round4 toggle-relay，reason=objective_blocked，id末尾ab02。
5. UI确认 decidedAtTick200，排队 toggle-relay；正常帧后 appliedTick201。tick227，relay ACTIVE，玩家100/echo94，扫描CD64。
6. round5 echo_observe：relay ACTIVE、objectiveBlocked=false。截图12真实HUD RELAY ACTIVE、EXIT OPEN、e94/p100。
7. `_owner_enter_portal`：摆位夹具后真实 interact/正常帧，room3→具体room5，tick273，未用过渡态-1冒充新房间。
8. round6 echo_observe tick273；round7 echo_status pending=[]，两条receipt applied，tick分别172/201，连接正常。
9. `_shutdown`：浏览器/本次桥/Vite退出；shutdown.json记 credentialsDeleted=true，两个执行进程均exit0。录像随关闭落盘。

## 可证明与限制

最小模型观察→自主scan建议→独立Owner UI确认→真实ECHO能量/证据→模型根据新状态建议开设备→真实ACTIVE/开门→实际玩家转场成立。没有预写建议、手工stepFrame、HP/资源/伤害/无敌修改。本次未建议jam，不能将既有jam自动化测试称为本次模型行为。

Owner bootstrap夹具：player.reset摆到传送门、清当前普通敌人（destroy+world.enemies=[]）、真实UI启ECHO；设备来自正式opt-in+room-enter。过门辅助同样摆位，不证明模型寻路。模型未获Owner操作工具，以下划线分支实现的Owner自动化独立记录。

发现需定界而未掩盖：
- 清敌夹具后MCP仍含3个hunter目标；可能因夹具未清canonical targets，不能把这些当真实存活威胁。
- memory将target_*_hunter标成kind=relay，需判断生产投影分类问题。
- room5玩家位置(115,44)，echo仍(27.165185630391612,43.68803042088119)，观察仍见原relay(25,46)。未声称ECHO已随玩家进入下一房；需复核真实portal回调与摆位夹具的影响。
- echo_status availableActions.scan=true但本次tick273扫描CD18，作为后续可用性一致性观察。
- Vite提示World.ts重复enemy-spawned case；未在本轮擅自修改。

因此本报告只记录最小Signal模型协作事实，不宣称Task C整体、真人验收、完整Run或无缺陷完成。待独立证据审查。

截图已实际查看12-tool-5-echo_observe.png；原始video/、bootstrap.json、fixtures-final.json、工具/Owner JSONL保留。本文件为Lead现场记录，运行辅助由Orca Worker准备。
