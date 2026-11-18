import hashlib
import json
import os
import subprocess

ROOT = os.getcwd()
P3 = "reports/gameplay-01/developer/p3"


def sha(rel):
    h = hashlib.sha256()
    with open(os.path.join(ROOT, rel), "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def size(rel):
    return os.path.getsize(os.path.join(ROOT, rel))


SRC = [
    ("src/ui/feedback.ts", "new", "pure local/proposal/audit/error/HUD copy; no state or World/core import"),
    ("src/scenes/PauseScene.ts", "modified", "LOCAL page short copy, WAITING, VIEW AUDIT page, ECHO signal detail, readable colors"),
    ("src/scenes/GameScene.ts", "modified", "2-line Signal HUD, long detail moved to Pause, readable colors"),
    ("src/ui/menuKit.ts", "modified", "dim label color only; no layout change"),
]
DOCS = [
    "docs/gameplay/P3_IMPLEMENTATION.md",
    "docs/gameplay/AI_FEEDBACK.md",
]
source_whitelist = [
    {"path": p, "status": s, "purpose": u, "sha256": sha(p), "bytes": size(p)}
    for p, s, u in SRC
]
doc_list = [{"path": p, "sha256": sha(p), "bytes": size(p)} for p in DOCS]

evidence = []
for base in [
    f"{P3}/early",
    f"{P3}/before",
    f"{P3}/matrix",
    f"{P3}/logs",
    f"{P3}/final",
]:
    for name in sorted(os.listdir(os.path.join(ROOT, base))):
        rel = f"{base}/{name}"
        if rel.endswith('/final/manifest.json'):
            continue
        if os.path.isfile(os.path.join(ROOT, rel)):
            evidence.append({"path": rel, "sha256": sha(rel), "bytes": size(rel)})
for rel in [
    f"{P3}/early.mjs",
    f"{P3}/before.mjs",
    f"{P3}/matrix.mjs",
    f"{P3}/echo-detail.mjs",
]:
    evidence.append({"path": rel, "sha256": sha(rel), "bytes": size(rel)})

head = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
status = subprocess.check_output(["git", "status", "--short", "--", "src"], text=True).strip().splitlines()

matrix = json.load(open(os.path.join(ROOT, f"{P3}/matrix/summary.json"), encoding="utf-8"))
echo_detail = json.load(open(os.path.join(ROOT, f"{P3}/matrix/echo-detail.json"), encoding="utf-8"))
before = json.load(open(os.path.join(ROOT, f"{P3}/before/p2v3.json"), encoding="utf-8"))
early = json.load(open(os.path.join(ROOT, f"{P3}/early/early.json"), encoding="utf-8"))

viewport_summary = [
    {
        "viewport": r["viewport"],
        "ok": r["ok"],
        "minCss": r["minCss"],
        "minContrast": r["minContrast"],
        "outside": len(r["outside"]),
        "overlaps": len(r["overlaps"]),
        "focus": r["focus"],
        "resize": r["resize"],
        "repeat": r["repeat"],
        "esc": r["esc"],
    }
    for r in matrix["results"]
]

manifest = {
    "stage": "GAMEPLAY-01 P3 — player-understandable ECHO/Signal presentation",
    "date": "2026-11-17",
    "status": "P3 DISPLAY CANDIDATE — independent review pending; not human acceptance; P2 core unchanged",
    "branch": "feat/gameplay-01-ai-cooperation",
    "head": head,
    "base": {
        "p2_candidate": "87a0fac",
        "note": "P3 display source is uncommitted on top of actual HEAD 0083e20; the P2 candidate is 87a0fac and its 10-source manifest remains at that v3 freeze. P2 World/echo/headless/core/Owner/Save/queue/restore rules untouched. Tester's v3 fixed tree is independent and does not see these display changes.",
    },
    "source_whitelist": source_whitelist,
    "docs": doc_list,
    "working_tree_src": status,
    "p3_core_untouched": True,
    "evidence": evidence,
    "copy_table": {
        "doc": "docs/gameplay/P3_IMPLEMENTATION.md",
        "source": "Local ECHO · OFFLINE · A HUMAN CONFIRMS",
        "status": "Ready to confirm / Queued / No local suggestion · HP · mode · Human owner",
        "action": "Scan relay; Seen: relay in sight; Cost: 10 echo energy · range 12 tiles; Ready now / Cooling down / This suggestion expired; A human must confirm; Expect; Only if still in sight and permitted",
        "waiting": "Queued status; Waiting to resume; Queued: Scan relay · runs after you resume; Confirm and reject are paused; core tick only in audit",
        "audit": "RECENT ACTIONS -> LOCAL AUDIT; Recent actions: N; raw id/tick/code/target/room gen; empty No recent actions",
        "receipt": "Queued / Done / Rejected / Cancelled / No recent actions; raw id/tick/code/target/room gen only in LOCAL AUDIT",
        "buttons": "CONFIRM (HUMAN); REJECT; RECENT ACTIONS; BACK (localAudit new)",
        "hud": "2 short signal lines (RELAY ... + T SCAN · Y JAM · R TOGGLE · LINK ...); cost/range/seconds in Pause",
        "colors": "#5a7480 → #8fb8c8; #48606b → #8fb8c8 in P3 paths",
    },
    "test_handles": {
        "localConfirm": "P2v3 CONFIRM (HUMAN) · LOCAL -> P3 CONFIRM (HUMAN); same field",
        "localReject": "P2v3 REJECT LOCAL -> P3 REJECT; same field",
        "localAudit": "new RECENT ACTIONS field; opens local-audit",
        "localAuditText": "new raw audit text",
        "echoSignalDetail": "new 3-layer Pause detail",
        "page": "local-coop plus local-audit",
        "menuButtons": "switch/confirm/reject/back plus RECENT ACTIONS",
        "same": ["localStatus", "localProposalText", "localNoticeText", "localSwitch", "btnLocalBack", "echoStatus", "echoModeText", "echoSuggest", "txtSignal", "txtSignalDetail", "txtEcho", "txtHelp"],
    },
    "stable_fields": [
        "localStatus", "localProposalText", "localNoticeText", "localSwitch", "localConfirm",
        "localReject", "btnLocalBack", "btnEchoLocal", "echoStatus", "echoModeText",
        "echoSuggest", "btnEchoAssist", "btnEchoToggle", "btnEchoBack",
        "new localAudit", "new localAuditText", "new echoSignalDetail",
    ],
    "file_whitelist": {
        "source": [p for p, _, _ in SRC],
        "docs": DOCS,
        "tests": "not modified (tester-owned); no mirror copy unit tests",
    },
    "gate_environment": {
        "cwd": matrix["env"]["cwd"],
        "spec": matrix["env"]["spec"],
        "devroot": matrix["env"]["devroot"],
        "lastSignalRoot": matrix["env"]["lastSignalRoot"],
        "shared_old_reports_written": False,
        "c2_c3c_run": False,
        "before_tree": "D:/tmp/gp01-p3-before (clean git archive 87a0fac)",
    },
    "verification": [
        {"gate": "npx tsc --noEmit", "result": "PASS (0)", "log": f"{P3}/logs/strict-typecheck-final.log"},
        {"gate": "npm test original 15s/20s (strictunit)", "result": "PASS 794/794 (68 files)", "log": f"{P3}/logs/strictunit-final.log"},
        {"gate": "npm run build", "result": "PASS", "log": f"{P3}/logs/build-final.log"},
        {"gate": "npm run test:mcp-surface", "result": "PASS 1/1", "log": f"{P3}/logs/surface-final.log"},
        {"gate": "P3 six-viewport real browser matrix", "result": "PASS 6/6; all outside=0, overlaps=0, minCss>=10, contrast>=9.46", "log": f"{P3}/matrix/summary.json (final run log logs/matrix-final.run.log)"},
        {"gate": "P3 ECHO-page signal detail six viewports", "result": "PASS 6/6; outside=0, overlaps=0, minCss>=10, contrast 8.59", "log": f"{P3}/matrix/echo-detail.json"},
        {"gate": "P2v3 before screenshots (clean 87a0fac tree)", "result": "PASS (fixture; all-caps local page, 5-line #5a7480 HUD)", "log": f"{P3}/before/p2v3.json"},
        {"gate": "P3 early visual", "result": "PASS (fixture; direction check; early shows pre-polish VIEW AUDIT/expires in 2s; final uses RECENT ACTIONS/Ready now)", "log": f"{P3}/early/early.json"},
    ],
    "viewport_summary": viewport_summary,
    "echo_detail_min": {
        "minCss": min(r["minCss"] for r in echo_detail["results"]),
        "minContrast": min(r["minContrast"] for r in echo_detail["results"]),
        "outside": sum(len(r["outside"]) for r in echo_detail["results"]),
        "overlaps": sum(len(r["overlaps"]) for r in echo_detail["results"]),
    },
    "before_after": {
        "before": f"{P3}/before/p2v3-local-proposal-1280x720.png",
        "before_hud": f"{P3}/before/p2v3-hud-1280x720.png",
        "after": f"{P3}/matrix/1280x720/proposal.png",
        "after_hud": f"{P3}/matrix/1280x720/hud.png",
        "after_audit": f"{P3}/matrix/1280x720/audit.png",
        "after_echo_detail": f"{P3}/matrix/1280x720/echo-detail.png",
        "early": f"{P3}/early/local-proposal-1280x720.png",
    },
    "human_playtest": {
        "executed": False,
        "status": "HUMAN PENDING; all current screenshots are fixture/agent-driven",
        "sessions": ["HumanOnly", "LocalAI", "HumanEcho", "Signal", "Proposal confirmation"],
        "plan": "docs/gameplay/P3_IMPLEMENTATION.md §4",
    },
    "limitations": [
        "No human played; not human acceptance or proof of understanding.",
        "Audit page exercised with one real entry; 8-entry layout not independently tested. At 800 the raw line wraps (complete, no overlap) but is dense. The early screenshot is pre-polish (VIEW AUDIT/expires in 2s); the final matrix uses RECENT ACTIONS/Ready now.",
        "Focus check skips disabled CONFIRM/REJECT while pending by design; not a full keyboard-only matrix. Pointer edge cases not run.",
        "E_PERMISSION stays broad; precise range/LOS split is a separate P3 rule decision. E_RETRYABLE is not called cooldown.",
        "P3 does not change P2 core/Owner/queue/restore; the fixed P2 v3 test tree does not see display changes.",
        "P4 spawn/relay overlap, door-vs-jam layout and route Headless gap remain P4.",
        "The #5a7480 replacement is limited to the P3 paths.",
    ],
    "not_claimed": [
        "human acceptance or human understanding",
        "full Tester regression or whole-GAMEPLAY PASS",
        "real-model ECHO chain",
        "P4 level/route/headless work",
        "any core/Owner/queue/restore change",
        "every screen outside the P3 whitelist",
    ],
    "evidence_note": "All browser evidence is fixture/agent-driven; not human. The independent P3 gate tree has its own reports; c2/c3c were not run and shared old reports were not written. P3 stops after this freeze; no commit/push.",
}

out = f"{P3}/final/manifest.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)
print("P3 manifest written", head, "src", len(source_whitelist), "docs", len(doc_list), "evidence", len(evidence))
