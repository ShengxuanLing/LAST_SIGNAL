import hashlib
import json
import os
import subprocess

ROOT = os.getcwd()


def sha(rel):
    h = hashlib.sha256()
    with open(os.path.join(ROOT, rel), "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def size(rel):
    return os.path.getsize(os.path.join(ROOT, rel))


SRC = [
    ("src/ai-native/echo.ts", "modified", "pure ECHO policy: local proposal, single local pending, raw-restore busy marker, safe move, reset"),
    ("src/ai-native/echoAudit.ts", "new", "bounded human-local/owner-external audit with proposalId/cancelled; never perception input"),
    ("src/ai-native/worldHeadless.ts", "modified", "same EchoController/pending; raw-restore queue guard; exact cancel; real-tick settle; dead-echo local drain"),
    ("src/scenes/PauseScene.ts", "modified", "ECHO LOCAL COOPERATION: switch, human confirm/reject, WAITING, last receipt, compact layout"),
    ("src/systems/SaveSystem.ts", "modified", "optional echoCooperationOptIn default false; old save stays false"),
    ("src/types/index.ts", "modified", "PermanentData.echoCooperationOptIn?: boolean"),
    ("src/world/World.ts", "modified", "single local pending, lifecycle cancel, dead-echo local guard drain, human-only switch/reset"),
    ("src/ai-native/echoCoop.test.ts", "new", "19 pure P2 policy/boundary/single-pending/restore-marker/lifecycle rules"),
    ("src/ai-native/worldHeadlessEchoCoop.test.ts", "new", "17 headless same-policy/real-core/single-queue/toggle/cancel/raw-restore/room/death rules"),
    ("src/systems/SaveSystem.echoCoop.test.ts", "new", "3 old-save/default/malformed/persistence rules"),
]
DOCS = [
    "docs/gameplay/P2_IMPLEMENTATION.md",
    "docs/gameplay/ECHO_COOP_BEHAVIOR.md",
    "docs/gameplay/P2_DESIGN_RESPONSE.md",
    "docs/gameplay/GAMEPLAY_01_BASELINE.md",
]
P3_DESIGN = "docs/gameplay/AI_FEEDBACK.md"

source_whitelist = [
    {"path": p, "status": s, "purpose": u, "sha256": sha(p), "bytes": size(p)}
    for p, s, u in SRC
]
doc_list = [{"path": p, "sha256": sha(p), "bytes": size(p)} for p in DOCS]
p3_doc = {"path": P3_DESIGN, "sha256": sha(P3_DESIGN), "bytes": size(P3_DESIGN), "status": "P3 DESIGN ONLY — no P3 source"}

evidence_paths = []
for base in [
    "reports/gameplay-01/developer/p2/demo02",
    "reports/gameplay-01/developer/p2/final-v2",
    "reports/gameplay-01/developer/p2/final-v3",
    "reports/gameplay-01/developer/p2/logs",
]:
    for name in sorted(os.listdir(os.path.join(ROOT, base))):
        rel = f"{base}/{name}"
        if os.path.isfile(os.path.join(ROOT, rel)):
            evidence_paths.append({"path": rel, "sha256": sha(rel), "bytes": size(rel)})
for rel in [
    "reports/gameplay-01/developer/p2/demo02-local-coop.mjs",
    "reports/gameplay-01/developer/p2/demo02-local-800.mjs",
    "reports/gameplay-01/developer/p2/demo02-timing.mjs",
    "reports/gameplay-01/developer/p2/final-v2/repeat-confirm.mjs",
    "reports/gameplay-01/developer/p2/final-v2/KNOWN_BAD.md",
]:
    evidence_paths.append({"path": rel, "sha256": sha(rel), "bytes": size(rel)})

head = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
status = subprocess.check_output(["git", "status", "--short", "--", "src"], text=True).strip().splitlines()

manifest = {
    "stage": "GAMEPLAY-01 P2 — ECHO local cooperation (v3 restore guard)",
    "date": "2026-11-17",
    "status": "CANDIDATE — independent v3 review pending; not human acceptance; original CLI timeout restored; raw-restore guard fixed",
    "branch": "feat/gameplay-01-ai-cooperation",
    "head": head,
    "head_note": "Actual HEAD when frozen. P2 source is uncommitted on top of this tester-test HEAD; the Lead's earlier dcd1955 base advanced to 2c4584c while the v3 fix was developed.",
    "p1_base": {
        "commit": "400a73e",
        "ci_commit": "c7e03c5",
        "manifest": "reports/gameplay-01/developer/p1/final/manifest.json",
        "note": "P1 evidence/hashes are historical at its commit; P1 Tester accept tree is independent. P2 does not substitute for P1 no-assist room-clear.",
    },
    "working_tree_src": status,
    "source_whitelist": source_whitelist,
    "docs": doc_list,
    "p3_design": p3_doc,
    "blocker_fix": {
        "review": "reports/gameplay-01/reviewer/P2_V2_REVIEW.md §2",
        "issue": "HeadlessWorld.fromSimulationState kept the core pending signal queue but dropped the local guard; a new proposal/confirm then queued twice (restore/parity path).",
        "fix": "Raw-restore conservative busy marker from the exact queued echo scan/jam or toggle; exact command retained (not deleted), echoPendingLocal reports restored:true with no proposalId/acceptedTick, propose null, confirm E_ALREADY_PENDING; marker clears on real receipt or when the command leaves the queue; player/other-actor commands untouched; external Owner toggle preserved but blocks local; room/clear-intent keep the marker; only reset clears; dead echo clears only actually-local rows.",
        "red": "reports/gameplay-01/developer/p2/final-v3/restore-red.log",
        "fixed": "reports/gameplay-01/developer/p2/final-v3/restore-guard-reviewer.log",
        "tests": "src/ai-native/worldHeadlessEchoCoop.test.ts — 17 headless restore/queue tests",
    },
    "evidence": evidence_paths,
    "verification": [
        {"gate": "npx tsc --noEmit (strict tree)", "result": "PASS (0)", "log": "reports/gameplay-01/developer/p2/logs/strict-typecheck-v3.log"},
        {"gate": "P2 targeted source rules", "result": "PASS 39/39 (19 echo policy + 17 headless + 3 save)", "log": "reports/gameplay-01/developer/p2/logs/strict-targeted-v3.log"},
        {"gate": "npm test (full pure, original 15s/20s)", "result": "PASS 794/794 (68 files; 39 new P2 source tests)", "log": "reports/gameplay-01/developer/p2/logs/strict-npm-test-v3.log"},
        {"gate": "npm run build", "result": "PASS", "log": "reports/gameplay-01/developer/p2/logs/build-final-v4.log"},
        {"gate": "npm run test:mcp-surface", "result": "PASS 1/1", "log": "reports/gameplay-01/developer/p2/logs/mcp-surface-final-v4.log"},
        {"gate": "Reviewer restore script (pre-fix RED, preserved)", "result": "FAIL/RED: queue 1, guard lost, second confirm queue 2", "log": "reports/gameplay-01/developer/p2/final-v3/restore-red.log"},
        {"gate": "Reviewer restore script (post-fix)", "result": "PASS: no proposal, second confirm false, queue stays 1", "log": "reports/gameplay-01/developer/p2/final-v3/restore-guard-reviewer.log"},
        {"gate": "Fresh Rendered→Headless parity, independent tree", "result": "PASS 3/3 after real Playwright export 1/1; main old signal parity hash unchanged", "log": "reports/gameplay-01/developer/p2/final-v3/fresh-parity-gate.log"},
        {"gate": "v2 Rendered repeat-confirm/timing browser proof (kept)", "result": "PASS (fixture/agent-driven; not human acceptance)", "log": "reports/gameplay-01/developer/p2/final-v2/repeat-confirm.json"},
    ],
    "fresh_parity": {
        "result": "PASS 3/3 after real Playwright export 1/1",
        "tree": "D:/tmp/gp01-p2v3-parity (independent reports/; node_modules junction)",
        "export_log": "reports/gameplay-01/developer/p2/final-v3/fresh-parity-export.log",
        "gate_log": "reports/gameplay-01/developer/p2/final-v3/fresh-parity-gate.log",
        "main_old_signal_hash_before_after": "1727d4e9b5f627fe447a6fde77d5fcf7d408cbf890167b4171d6e112040c0b40",
        "note": "The old main reports/ai-native-02/signal/parity was not consumed; the fresh tree had its own reports. Old stale AI-NATIVE-02 c2/c3c files are not part of this gate and were not restored/deleted.",
    },
    "previous_runs": [
        {"log": "reports/gameplay-01/developer/p2/logs/npm-test-final.log", "result": "780/780 with relaxed CLI timeout (15s→30s, 20s→35s)", "status": "obsolete-config — not a gate; timeout reverted, not in whitelist"},
        {"log": "reports/gameplay-01/developer/p2/logs/strict-npm-test.log", "result": "779/780 pre-fix strict run; CLI quit timed out under load", "status": "pre-fix/stale"},
        {"log": "reports/gameplay-01/developer/p2/logs/strict-npm-test-v2.log", "result": "786/786 v2 strict run", "status": "v2 historical; v3 is 794/794"},
        {"log": "reports/gameplay-01/developer/p2/logs/parity-final.log", "result": "old stale AI-NATIVE-02 fixture mismatch", "status": "not consumed; fresh independent parity is PASS 3/3"},
    ],
    "new_test_count": {"echoCoop": 19, "worldHeadlessEchoCoop": 17, "saveCoop": 3, "total": 39},
    "real_model": {
        "connection": "Magpie group/elisa reachable per Lead probe (endpoint http://127.0.0.1:3425/v1, openai-chat, no Authorization header, no key exported)",
        "lead_probe_evidence": [
            "reports/gameplay-01/model/magpie-connection-probe.json",
            "reports/gameplay-01/model/CONNECTION_SCOPE.txt",
        ],
        "reviewer_player_smoke": "ENGINEERING PASS on fixed snapshot b6a98e5: real model -> legal observe -> legal action -> official MCP -> real core Player combat; 4 requests / 8.8s; room cleared; not human acceptance",
        "reviewer_evidence": [
            "reports/gameplay-01/reviewer/REAL_MODEL_CONNECTIVITY_AND_SMOKE.md",
            "reports/gameplay-01/reviewer/real-model/console-5.log",
            "reports/gameplay-01/reviewer/real-model/trace-2026-11-17T20-55-14-035Z.json",
        ],
        "p2_echo_chain": "NOT YET VERIFIED — legal ECHO observation -> model suggestion -> human Owner confirm/reject/disconnect is post-freeze reviewer/E2E",
        "p0_historical": "Real-LLM BLOCKED at P0 time retained; not rewritten",
        "rule": "P2 local proposals are deterministic/offline; never label them as real model output; no core model calls; no Bridge secret or Owner key to the model",
    },
    "not_claimed": [
        "human acceptance (browser clicks are a fixture; no human played)",
        "real-model ECHO game chain (Magpie connection and a bounded Player smoke are verified; ECHO chain is not)",
        "full ECHO Rendered↔Headless route parity (P1 route/portal remains Rendered orchestration)",
        "reviewer 5-viewport/fail-closed and external-owner e2e matrices (their fresh retest is next)",
        "P3 causal receipts/HUD and P4 cooperative level/route work",
        "production Player tool confirm/dev fields; no such fields were added",
        "the pre-fix 800x600 layout check as a pending-waiting check",
    ],
    "known_notes": [
        "The raw-restore guard is the v3 fix. RED evidence: final-v3/restore-red.log; fixed: final-v3/restore-guard-reviewer.log; 17 headless tests. The v2 final-v2 browser evidence is kept unchanged.",
        "Real save: RunCheckpoint.coreState has no pendingCommands and restoreCheckpoint clears them/resets echo runtime. The checkpoint is pre-confirm; a refresh between a paused confirm and the next core tick loses the queued action. UI says Queued, never Done; no receipt is resurrected.",
        "Lifecycle actual calls: E_ROOM_CHANGED/E_ECHO_DISABLED in World; E_LOCAL_REVOKED only in the explicit Headless test (no UI control); E_ECHO_DEAD in the dead-echo local drain; a new run goes through core reset, so the unused E_NEW_RUN enum was removed. Do not claim every enum was UI-tested.",
        "Restored unknown rows have no proposalId/acceptedTick, are never human-local, and are not deleted. Player/other-actor commands are preserved. An external Owner toggle is preserved while local confirm is blocked.",
        "Fresh parity PASS 3/3 in an independent tree; old main signal parity hash unchanged; old stale c2/c3c reports were not consumed and are preserved for the Lead.",
        "Strict full at original 15s/20s: 794/794 PASS. The old relaxed 780 and pre-fix strict 779 are historical; no timeout/assertion relaxation is in the tree or whitelist.",
        "P3 feedback design is docs/gameplay/AI_FEEDBACK.md (design only; no P3 source change).",
    ],
    "evidence_note": "Evidence labels: fixture / agent (real model) / human. All P2 browser/headless evidence is fixture/agent-driven, not human; no model actor. Real model connection and Player smoke are Lead/Reviewer evidence.",
}

out = "reports/gameplay-01/developer/p2/final/manifest.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)
print("manifest written", head, "src", len(source_whitelist), "docs", len(doc_list), "evidence", len(evidence_paths))
