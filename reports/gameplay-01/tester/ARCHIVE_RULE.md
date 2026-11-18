# Gate-run archival rule (tester)

Every gate run directory must, before or at the same time as the run, contain:

```
<run>/source-snapshot/tests/<spec files actually executed>
<run>/source-snapshot/src/<source files whose hash the report cites>   (optional)
<run>/source-snapshot/HASHES.txt     # sha256 BEFORE the run, AFTER the run, of the archived copy
<run>/source-snapshot/SNAPSHOT.md    # cwd, devRoot, PORT, HEAD, commit, time, manifest ref
<run>/logs/*.log                     # first line: workdir/spec/devRoot/commit/specSha/time
```

Rules
1. Copy the spec bytes **from the run tree**, never from the shared workspace and never from a
   newer version. If the run tree no longer matches the hash in the log, mark the difference
   as `UNVERIFIABLE` instead of substituting new bytes.
2. Re-hash before and after the run; a mismatch means the run did not use the archived bytes.
3. Logs are kept even when `reports/` is gitignored (they are archived on disk with the run,
   and the path is cited in the report).
4. Old run directories are never overwritten; a corrected evidence set gets a new run number.
5. Historical results whose exact spec bytes no longer exist (e.g. the P2 `efef833c…` runs)
   stay documented as *log-verifiable, byte-UNVERIFIABLE* — they are not recomputed into new
   numbers and no byte-reconstruction is attempted.
