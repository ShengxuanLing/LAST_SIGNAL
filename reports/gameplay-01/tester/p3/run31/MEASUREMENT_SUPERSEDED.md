# run31 — one record in this directory is SUPERSEDED (not a product fact)

`run31/evidence/p3-hud-live-800.json` (`tinyCss`) and the corresponding sentence in the
run31-era `P3_TEST_REPORT.md` claimed *"the in-game HUD sits at 8–8.5 CSS px at 800×600"*.

That number was a **test-side measurement error**, not a product state (reviewer finding
G1, `reports/gameplay-01/reviewer/P3_TEST_REVIEW.md` §8.2). `hudSample()` multiplied the
camera zoom in twice:

```
wrong: css = fontSize × cam.zoom × (canvasCSSwidth / cam.width)   // 17 × 0.8 × 0.625 = 8.5
right: css = fontSize × textScaleY × cam.zoom × (canvasCSSwidth / cam.width)
```

The live HUD is inverse-scaled by `lockHud()` (`scaleX/scaleY = 1/zoom`, re-pinned every
frame), so the zoom cancels and the real value is `fontSize × canvasScale`:

| viewport | zoom | scaleY | canvasScale | 16 px line | 17 px line |
|---|---|---|---|---|---|
| 800×600 | 0.8 | 1.25 | 0.625 | **10.0 CSS** | **10.625 CSS** |
| 1280×720 | 0.8 | 1.25 | 1.0 | **16.0 CSS** | **17.0 CSS** |

**No tested viewport is below 10 CSS px, and the HUD is not a product defect.**

Where the correction lives: the corrected measurement, the 800-viewport `>= 10 CSS` assertion, the
`scaleY × zoom = 1` invariant assertion and the full per-line record
(`fontSize / scaleX / scaleY / zoom / canvasScale / bounds / css`) live in **run32**
(`run32/evidence/p3-hud-live-800.json`, `run32/evidence/p3-hud-live-1280.json`,
spec sha256 `d446a7683560236199638b3a15af92204e31ae781a239255221921bc0b3c254c`).
Files in `run31/` are left byte-for-byte as they were run; only this note is added.
