# Lead 实际 Companion 逐轮尝试：授权成功，观察/暂停存活失败

日期2026-11-15，冻结ae8b4e2。Owner通过真实全新表单填写URL/Agent token/独立Owner key，无global配置注入。授权成功CONNECTED、表单关闭。SDK Companion进程只获Agent token，无Owner key/cap。

Player/ECHO阶段未能提出建议：正式echo_observe第一次返回E_LINK_UNAVAILABLE companion.no_observation；再读返回E_STALE_EPOCH world.stale_epoch。原始tool-io.jsonl包含两调用。没有echo_suggest、没有确认/伤害成功证据，不算ECHO LLM实跑通过。

源诊断：CompanionLink.authorize成功后不立即pushObservation，GameScene正常帧才推；人类在Pause授权时无正常GameScene帧。startHeartbeat默认5000ms仅GET companion-status，不续renderer heartbeat或推首份已提交obs；gateway有独立LOST超时，会话可在合法暂停UI被判失联。Agent自身lease续约不能替代renderer heartbeat。需要在暂停UI保持Owner认证的正确heartbeat并发布首份观察，不推进模拟。

另需核对：CompanionLink.get把Owner capability放query URL，应改Owner认证header或POST body；decide使用suggestion.createdAtTick+1而非真实core tick，需调用已有appliedTick()回调读取实际tick，不能伪造时间以通过校验。

本次Owner自动化仅启ECHO、在真实生成start room spawn一只真实drone后暂停；无HP/能量/伤害/资源修改，key只在进程内Owner bootstrap与masked form。脚本归档owner-bootstrap-and-agent-adapter.mts，无建议策略。bootstrap.json与录像保留。

开始时archive尚未完成就启动MCP build导致ENOENT，重试构建成功；相关setup日志在父目录lead-echo-fixed-build*.log。此为执行环境顺序问题，与上列产品会话失败分开。
