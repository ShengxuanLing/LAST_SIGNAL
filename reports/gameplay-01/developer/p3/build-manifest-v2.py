import hashlib
import json
import os
import subprocess

ROOT = os.getcwd()
P3 = "reports/gameplay-01/developer/p3"
V2 = f"{P3}/v2"


def sha(rel):
    h = hashlib.sha256()
    with open(os.path.join(ROOT, rel), "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def size(rel):
    return os.path.getsize(os.path.join(ROOT, rel))


SRC = [
    ("src/ui/feedback.ts", "modified", "pure copy: honest local source, friendly audit lines with raw traceability below, generic permission copy"),
    ("src/ui/feedback.test.ts", "new", "8 pure feedback branch tests (queued vs done, permission, restored/unknown source, no raw fields on default page, audit order)"),
    ("src/scenes/PauseScene.ts", "modified", "local source without blanket OFFLINE, LLM footer 'Takes effect when you resume', scrollable audit region, RECENT ACTIONS"),
    ("src/scenes/GameScene.ts", "modified", "2-line Signal HUD (unchanged in v2; carried over from v1)"),
    ("src/ui/menuKit.ts", "modified", "dim label color only (unchanged in v2; carried over from v1)"),
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
for base in [f"{V2}", f"{P3}/matrix", f"{P3}/logs", f"{P3}/audit8"]:
    if not os.path.isdir(os.path.join(ROOT, base)):
        continue
    for root, _dirs, files in os.walk(os.path.join(ROOT, base)):
        for name in sorted(files):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            if rel.endswith("final/manifest.json"):
                continue
            evidence.append({"path": rel, "sha256": sha(rel), "bytes": size(rel)})

head = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
status = subprocess.check_output(["git", "status", "--short", "--", "src"], text=True).strip().splitlines()

matrix = json.load(open(os.path.join(ROOT, f"{P3}/matrix/summary.json"), encoding="utf-8"))
audit8 = json.load(open(os.path.join(ROOT, f"{P3}/audit8/audit8.json"), encoding="utf-8"))

viewport_summary = [
    {
        "viewport": r["viewport"], "ok": r["ok"], "minCss": r["minCss"], "minContrast": r["minContrast"],
        "outside": len(r["outside"]), "overlaps": len(r["overlaps"]),
        "audit_sample": r["audit"]["texts"][:3],
        "focus": r["focus"], "resize": r["resize"], "repeat": r["repeat"], "esc": r["esc"],
    }
    for r in matrix["results"]
]

manifest = {
    "stage": "GAMEPLAY-01 P3 v2 — player-understandable ECHO/Signal presentation (review fixes)",
    "date": "2026-11-17",
    "status": "P3 v2 DISPLAY CANDIDATE — independent re-review pending; not human acceptance; P2 core unchanged",
    "branch": "feat/gameplay-01-ai-cooperation",
    "head": head,
    "base": {
        "p2_candidate": "87a0fac",
        "p3_v1_review": "reports/gameplay-01/reviewer/P3_REVIEW.md",
        "note": "P3 v2 source is uncommitted on top of the working tree; P2 World/echo/headless/core/Owner/Save/queue/restore rules are untouched. The superseded P3 v1 manifest (reports/gameplay-01/developer/p3/final/manifest.json) recorded older wording and is NOT current-code evidence; it is kept as history.",
    },
    "supersedes": {
        "manifest": f"{P3}/final/manifest.json",
        "status": "superseded — old wording/hash set; kept as history, not current evidence",
        "early_evidence": f"{P3}/early (direction check only, pre-polish wording)",
    },
    "source_whitelist": source_whitelist,
    "docs": doc_list,
    "working_tree_src": status,
    "p2_core_untouched": True,
    "review_fixes": {
        "blocker_manifest_hash": "this manifest is regenerated from the current working tree; the v2 hashes below match the isolated tree and the working tree byte-for-byte (checked before and after the gates)",
        "local_source": "LOCAL ECHO · A HUMAN CONFIRMS (blanket OFFLINE removed; it was inaccurate when the model link is connected)",
        "audit_detail": "friendly first line per entry (You / Model (Owner), action, Queued/Done/Rejected/Cancelled) + error explanation, then the raw proposalId/tick/code/target/room gen traceability line; the default page shows none of it",
        "error_copy": "E_PERMISSION → 'Not possible right now' (no invented range/LOS); E_RETRYABLE → 'try again' (not cooldown)",
        "llm_footer": "'COMMIT ON THE NEXT CORE TICK' → 'Takes effect when you resume'",
        "audit_scroll": "audit region is a MenuPage scroll region; at 800 with 8 real entries the content fits (measured scroll offset unchanged), ESC returns one layer",
        "audit_snapshot": "subtitle states 'as of opening' (the page is a snapshot of the real audit ring)",
    },
    "evidence": evidence,
    "verification": [
        {"gate": "npx tsc --noEmit (unfiltered, isolated tree)", "result": "PASS (0)", "log": f"{P3}/logs/p3v2-typecheck-isolated.log"},
        {"gate": "npx tsc --noEmit (main working tree)", "result": "PASS (0)", "log": f"{P3}/logs/p3v2-typecheck.log"},
        {"gate": "npx vitest run src/ui/feedback.test.ts (isolated)", "result": "PASS 8/8", "log": f"{P3}/logs/p3v2-feedback-isolated.log"},
        {"gate": "npx vitest run src/ui/feedback.test.ts (main)", "result": "PASS 8/8", "log": f"{P3}/logs/p3v2-feedback-targeted.log"},
        {"gate": "P3 six-viewport browser matrix (v2 source)", "result": "PASS 6/6; outside=0, overlaps=0, minCss>=10, contrast>=9.46", "log": f"{P3}/logs/matrix-p3v2.run.log + {P3}/matrix/summary.json"},
        {"gate": "P3 audit page with 8 real entries at 800x600", "result": f"PASS: {audit8['auditCount']} entries, {audit8['lines']} lines, minCss {audit8['minCss']}, outside {len(audit8['outside'])}, ESC -> {audit8['escPage']}, scroll region measured (content fits)", "log": f"{P3}/logs/audit8.run.log + {P3}/audit8/audit8.json"},
        {"gate": "HUD unchanged in v2", "result": "carried over from v1 (2 signal lines, #8fb8c8) — not re-run as a v2 change", "log": f"{P3}/matrix/summary.json"},
        {"gate": "full 794 pure suite", "result": "not re-run (Tester owns the full regression; no P2 change) — v1 run was 794/794", "log": f"{P3}/logs/strictunit-final.log"},
    ],
    "viewport_summary": viewport_summary,
    "audit8": {
        "entries": audit8["auditCount"], "lines": audit8["lines"], "minCss": audit8["minCss"],
        "outside": len(audit8["outside"]), "esc": audit8["escPage"],
        "scroll": audit8["scroll"], "text": audit8["auditText"], "screenshot": f"{P3}/audit8/audit8-800x600.png",
    },
    "hash_consistency": {
        "isolated_tree": "D:/tmp/gp01-p3-ui",
        "checked_before_and_after": True,
        "files": [p for p, _, _ in SRC],
        "note": "main and isolated hashes matched before the gates and after the gates (see gate logs/summary)",
    },
    "gate_environment": {
        "cwd": matrix["env"]["cwd"], "spec": matrix["env"]["spec"], "devroot": matrix["env"]["devroot"],
        "lastSignalRoot": matrix["env"]["lastSignalRoot"], "shared_old_reports_written": False, "c2_c3c_run": False,
        "before_tree": "D:/tmp/gp01-p3-before (clean git archive 87a0fac)",
    },
    "human_playtest": {
        "executed": False,
        "status": "HUMAN PENDING; all current screenshots are fixture/agent-driven",
        "sessions": ["HumanOnly", "LocalAI", "HumanEcho", "Signal", "Proposal confirmation"],
    },
    "limitations": [
        "No human played; not human acceptance or proof of understanding.",
        "Audit page is a snapshot of the audit ring at open time (stated in the subtitle); it does not live-update.",
        "At 800 with 8 real entries the audit content fits (22 lines, scroll region measured inactive); denser histories are not covered.",
        "Focus test skips disabled CONFIRM/REJECT while pending by design; not a full keyboard-only matrix. Pointer edge cases not run.",
        "E_PERMISSION stays generic ('Not possible right now'); the precise range/LOS split is a separate P3 rule decision.",
        "P3 does not change P2 core/Owner/queue/restore; the fixed P2 v3 tree at 87a0fac does not see display changes.",
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
    "evidence_note": "All browser evidence is fixture/agent-driven; not human. The isolated P3 tree has its own reports; c2/c3c were not run and shared old reports were not written. P3 v2 stops after this freeze; no commit/push.",
}

os.makedirs(os.path.join(ROOT, V2), exist_ok=True)
out = f"{V2}/manifest.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)
print("P3 v2 manifest written", head, "src", len(source_whitelist), "docs", len(doc_list), "evidence", len(evidence))
