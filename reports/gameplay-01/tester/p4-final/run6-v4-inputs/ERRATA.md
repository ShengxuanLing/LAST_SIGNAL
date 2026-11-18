# ERRATA — run6 receipt diagnostics (spec `6a8085f5`, EXIT=1)

Applies to `logs/p4-receipt-semantics-diag.log.txt` and
`evidence/p4-receipt-diag-20261119-HumanEcho.json` in **this** directory.

- **What it is**: a single probe run whose spec bytes were `P4_sha=6a8085f5…`. It failed
  (`EXIT=1`) on my own assertion reading a non-existent field (`processedTicksUntilCommit`),
  not on a product condition. Its `receiptSemantics` payload also lacks the fields added later
  (`commitBatchTicks`, `queueAfterCommit`), which is how the source spec can be identified.
- **What it is not**: it is **not** part of the green gate. The P4 green evidence for
  `aa9ee012` is `logs/p4-jam-input-3x-final.log.txt` (3 passed, 1.1 m, `EXIT=0`) and the
  `evidence/p4-route-*.json` written by that run.
- **The observation it does contain** is still useful and is quoted only as an observation:
  confirm/audit `enqueued` tick 1037, draining batch 1037→1038 with `queueBefore=["signal-scan"]`,
  `signal-scanned#1` + `signal-energy#1` in that batch, audit `applied` 1038, and a separate
  `1039→1041 ticks=2` batch. It is consistent with the batch-boundary semantics in
  `P4_TEST_REVIEW` §8.3, but it does not by itself gate anything.
- **`HASHES-INPUTS.txt`**: the line under *targeted results* that lists this probe is now to be
  read as `EXIT=1 (failed probe, observation only)`. The original file is **not rewritten** —
  this errata is the sidecar, as required.
- **Fix history**: the field-name defect was fixed in the same session; the identity assertions
  demanded by `P4_TEST_REVIEW` §8.3 were then implemented in `run7-v4-final` (see
  `run7-v4-final/HASHES-PRE-RUN.txt`), which is the byte set used for the final full run.

Sidecar links: `run7-v4-final/HASHES-PRE-RUN.txt`, `run7-v4-final/diff/*.diff`.
