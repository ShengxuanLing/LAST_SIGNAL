# P3-b Companion 纯 UI 表单最小复现（冻结 `7fd4a2e`）

**结论：FAIL — Lead 报告的根因在 `7fd4a2e` 仍成立，已独立复现。纯 UI 表单提交后根本没有发出 handshake 请求；有 host config 对照则成功。**

## 冻结

- 目标：`7fd4a2eedb39ebf3602de00328eb5a12287ee300`（父 `87ab3797d9fbcf08293649cf3137250245ee8ee9`）
- 冻结时 HEAD：`3fb8af9e06482ad76bddf46d661901916fc35f30`（工作区有他人 WIP，**未读取、未使用**）
- `git archive 7fd4a2e | tar -x` → `D:/Project/AI-NATIVE-02-snapshots/7fd4a2e`；2031 文件，全量 sha256 记于 `00-all-files.sha256`；二次解包 `diff -rq` 零差异（`00-archive-diff.log`）
- 未改源/测/配置/分支；未读 WIP/stash；未等待新 commit。仅限本诊断，不与 87ab379 验收结论混合。

## 一行 PASS/FAIL 门禁（完整 `gate-summary.log`）

| 结论 | 检查 | 命令 | 结果 / 路径 |
|---|---|---|---|
| PASS | dev 就绪 | `npx vite --mode test --port 5392 --strictPort` | true / `00-freeze.log` |
| PASS | host 私有凭据文件独立且有 ACL | `npx vite-node scripts/c3b-bridge.mts` | 两文件不同、`OWNER_KEY_ACL` 已打印、日志无 token/key / `01-host-config.json` |
| PASS | 凭据来自私有文件、非错误 key/工具环境 | `readFile(TOKEN_FILE/OWNER_KEY_FILE)` | ownerKey 64hex、token≠key、Agent env 无 ownerKey / `01-host-config.json` |
| PASS | 表单含 masked token + ownerKey 字段 | Playwright 真实表单 | `[token/password, ownerKey/password]` / `01-pure-ui.json` |
| **FAIL** | **纯 UI AUTHORIZE 实际发出 handshake** | `probe-form-repro.mts`（fresh context，无全局注入） | **`network=[]`（0 个 `/world-link/*` 请求）** / `01-pure-ui.json` |
| **FAIL** | **纯 UI AUTHORIZE 后 Owner 状态** | 同上 | **`companionStatus=OFF`；`FAILED · owner pairing rejected — control stays human`；表单仍打开** / `01-pure-ui.json` |
| PASS | 同一 key/token 桥侧直连可用 | `fetch POST /world-link/handshake`（host 侧） | `200, ok=true` / `01-credential-control.json` |
| PASS | 有 host config 对照成功 | 第二独立 bridge `8905` + fresh context 注入 bridgeUrl/token | `companionStatus=CONNECTED`；网络 `POST handshake 200` + `POST companion-authorize 200` / `01-host-config.json` |
| PASS | 对照注入不含 ownerKey | `addInitScript` | `globalKeysBeforeForm=["bridgeUrl","token"]` / `01-host-config.json` |

## 关键证据

- 纯 UI（无全局配置）：`network: []`、`globalKeys: []`、`hasLink: false`、`tokenVal/keyVal: ""`（产品已清空）、`pageErrors: []`；截图 `evidence/pure-ui.png`。
- 对照（仅注入 bridgeUrl+token，ownerKey 仍来自表单）：`network` 明确含 `POST /world-link/handshake → 200`、`POST /world-link/companion-authorize → 200`，`hasLink: true`、`CONNECTED`；截图 `evidence/host-config.png`。
- 直连控制：相同 ownerKey + token 对 bridge handshake 返回 `200 ok=true`，排除错误 key、错误 token、工具环境或 bridge 故障。
- 产物 secret 扫描（Bearer/ownerKey/ownerCap 模式）零命中；ownerKey 未进入 Agent 环境或 MCP env，仅 host 侧私有文件与浏览器 masked 表单。

## 根因确认（冻结源）

`7fd4a2e` 的修复只给 `authorizeCompanionFromConfig()` 增加了 `config?.ownerKey` 回退（`GameScene.ts:822-828`），但 `bridgeUrl`/`token` 仍**只从 `globalThis.__externalLinkConfig` 读取**；而 `PauseScene.ts:611-625` 的 companion 分支只 `stashOwnerPairing(parent, ownerKey)` 后调用无参 `authorizeCompanionFromConfig()`，把用户输入的 `bridgeUrl`/`token` 写回全局的动作只存在于 external 分支（`PauseScene.ts:625`）。因此纯 UI 路径下 `bridgeUrl=''`、`token=''`，函数在 fetch 之前就 `return false` —— 与观察到的 `network=[]` 完全一致。Lead 的 FAILURE.md 根因判断成立。

## 范围

- 本单只做最小纯 UI 复现 + host config 对照 + 凭据有效性控制；**未**重跑 87ab379 全门禁、**未**重跑 E2E 套件、**未**验证真实 LLM 建议。
- 87ab379 的独立验收结论保持原样，不与本目标混合。

## 路径

`reports/ai-native-02/tester/p3b-companion-form-repro/`
`00-freeze.log` / `00-all-files.sha256` / `00-archive-diff.log` / `gate-summary.log` / `diagnosis.json` / `probe-run.log` / `probe-form-repro.mts` / `01-pure-ui.json` / `01-host-config.json` / `01-credential-control.json` / `evidence/pure-ui.png` / `evidence/host-config.png`
