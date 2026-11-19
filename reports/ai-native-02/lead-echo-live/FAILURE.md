# Lead 实际 Companion UI 连接尝试：未能进入模型回合

日期2026-11-15，冻结7fd4a2eedb39ebf3602de00328eb5a12287ee300。Owner bootstrap真实NEW RUN/启ECHO/一只真实drone，无HP资源改写。Owner测试自动化通过Pause→LLM COMPANION→ENABLE，填写真实随机bridgeUrl/Agent token/独立Owner key，点AUTHORIZE。

结果：表单显示FAILED owner pairing rejected，GameScene.companionStatus一直OFF，30秒等待超时。没有建立Companion官方SDK会话，没有提交echo_observe/echo_suggest；不算真实LLM建议证据。failure.png为真实界面，敏感输入已由产品清空，截图无密钥。

根因源证据：PauseScene表单companion分支stashOwnerPairing(parent,ownerKey)后调用无参authorizeCompanionFromConfig()；该方法从globalThis.__externalLinkConfig读取bridgeUrl/token。表单此分支并未把用户输入的bridgeUrl/token传入；配置写global只在external分支出现。因此无预注入全局配置的正常UI路径直接return false。

旧Owner E2E/工具smoke有宿主页__externalLinkConfig夹具，掩盖纯UI缺陷。修复应显式传参给Owner授权方法，并新增禁止预设global配置的真实表单E2E。不要通过重新写token/OwnerKey到global来修复。

通用尝试脚本归档owner-bootstrap-and-agent-adapter.mts；没有任何预写建议策略。相关错误已通知开发者；本目录只记录失败，不得宣称ECHO LLM实跑完成。
