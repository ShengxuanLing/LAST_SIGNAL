# GAMEPLAY-01 — human playtest guide (DEMO 01 cooperative level)

Status: **HUMAN ACCEPTANCE PENDING — the owner has started checking the entry flow; gameplay
sessions have not been recorded.** This file is the session script and the empty result sheet. Until a person fills it in, no claim about human
experience, difficulty or fun exists anywhere in this project.

It needs **no key, no account and no model pairing**. A model/owner key never belongs in this
document, in a chat, or in a screenshot: if a run ever asks for pairing input, that input stays
private to the person entering it.

## 1. Start the build

1. Launch the game and wait for the main menu.
2. Click **DEMO 01** (normal player entry; the cooperative level is the authored DEMO 01 scene —
   the menu copy is intentionally unchanged).
3. **If a run checkpoint already exists**, clicking DEMO 01 first opens a confirmation page:
   `STARTING OVER REPLACES THE CURRENT RUN CHECKPOINT.` This is still the main menu, not the
   demo room. Choose **REPLACE AND START** only if you are willing to replace the current
   single-run checkpoint; permanent cores, talents and weapon unlocks are kept. The confirmation
   preserves the DEMO 01 selection. To keep playing the saved run instead, choose **BACK**,
   then **CONTINUE**; that resumes the saved run rather than starting this demo. With no run
   checkpoint, DEMO 01 starts directly. Do not clear browser storage to bypass this choice.
4. **After the game room actually appears**, the HUD must show `RELAY ACTIVE · EXIT OPEN` (or `ROUTE A/B OPEN`) and the objective
   `CLEAR THE LINKED SENTRY · T SCAN · Y JAM · R TOGGLE`.
   These HUD checks do not apply to the replacement-confirmation page. A portal still requires
   clearing the sentries; the relay status alone does not mean the room has been cleared.
5. Do not use dev tools, console edits, teleports or a seed override: this playtest measures the
   normal entry a player gets.

## 2. Controls (real product bindings)

| input | action |
|---|---|
| `W A S D` / arrow keys | move |
| mouse | aim; hold left button to fire |
| `Space` | dash |
| `F` | interact (enter the portal when it is open and you stand on it) |
| `T` | scan (player Signal action, costs 10 energy) |
| `Y` | jam (25 energy; suppresses linked fire and, for the authored route, closes the door for ~6 s) |
| `R` | toggle the relay ON/OFF (manual route choice) |
| `ESC` | pause; the pause root has **AI & COMPANION** → **AI CONTROL: OFF/ON · LOCAL DEMO** and **ECHO COMPANION >** |

## 3. Sessions (6 short runs, ~10–15 min each)

Each session starts from a **fresh** menu → DEMO 01. Record what you see, not what you expect.

### S1 — HumanOnly, direct combat, route A
- Play without opening the pause menu (no AI, no ECHO).
- Fight the two linked sentries; walk to the portal and press `F`.
- **Expect:** the room clears (banner `ROOM CLEARED`), a portal with an `F · R-xx …` label appears,
  `RELAY ACTIVE` keeps the linked route open, and `F` changes the room.
- Record: fight time, HP before/after, shots fired, whether any enemy shot felt unavoidable.

### S2 — Local AI control
- `ESC` → **AI & COMPANION** → **AI CONTROL: ON · LOCAL DEMO** → back to the root → resume.
- Watch the local deterministic controller move/fire for ~10 s, then take control back with any
  movement key (or disable it again from the same page).
- **Expect:** the HUD flips to the AI-owned mode while it acts, the objective stays the same, and
  your first movement key returns control to you immediately.
- Record: did the AI ever fight itself into a corner, did you get control back on the first key.

### S3 — HumanEcho, one accepted suggestion
- `ESC` → **AI & COMPANION** → **ECHO COMPANION >** → enable the companion → resume.
- Wait for a suggestion, accept it, and watch what changes (echo energy, relay evidence).
- **Expect:** the suggestion is a scan/toggle of the relay, the ECHO spends its **own** energy
  (scan costs 10), and the human still walks and chooses the route.
- Record: what was suggested, whether you accepted or rejected, what visibly changed.

### S4 — Signal combat (T / Y)
- Clear the sentries while using `T` at range and `Y` near the relay.
- **Expect:** scan costs 10 energy and reveals relay evidence; jam costs 25 and stops **new**
  linked fire for ~6 s; the energy bar drops visibly and the cooldown prevents immediate re-use.
- Record: which action you used, at what distance, and whether the timing felt usable or fiddly.

### S5 — Signal two routes (R / F)
- Clear the room, then press `R` (relay OFF → the other route portal appears) and enter it with
  `F`. Then do the reverse on a fresh run (`R` back ON → the first portal).
- **Expect:** the portal **moves** between two authored spots; while the relay is JAMMED there is
  no portal at all and `F` does nothing; after jam expiry the portal returns; the HUD route line
  matches the open route.
- Record: whether the two portals were distinguishable, whether standing at the door and pressing
  `Y` felt like an intended move.

### S6 — ECHO suggestion: confirm / reject / off
- Enable ECHO, **reject** one suggestion, then disable the companion and finish the run solo.
- **Expect:** rejecting costs nothing and does not lock anything; with the companion off the level
  is still completable by the same route; no error or stuck state appears.
- Record: any message shown on reject/disable, and whether the level still made sense without ECHO.

## 4. Feedback questions (answer in your own words)

1. Was the objective (`CLEAR THE LINKED SENTRY`, then the portal) understandable without help?
2. Did the door/relay relationship read clearly (jam closes the door, expiry reopens it)?
3. Was the energy economy readable (10 vs 25, regen, cooldown)?
4. Did the two routes feel like a choice, or like the same room twice?
5. Did the ECHO suggestion help, distract, or do nothing? Would you keep it on?
6. Did the local AI ever act in a way that felt wrong or unsafe?
7. Any moment where you were unsure whether `F` would work?
8. Any visual/HUD problem (labels, beacon, energy bar) at your screen size?
9. Did the fight feel too short, too long, or right for a demo room?
10. Would you replay this room to try the other route? Why?

## 5. Result sheet (fill by hand; leave blank what you did not measure)

| session | date/time | route (A/B) | fight time | HP start → end | damage taken | player energy spent | echo energy spent | T / Y / R count | suggestions accept / reject / fail | outcome | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 HumanOnly |  |  |  |  |  |  | — |  | — |  |  |
| S2 Local AI |  |  |  |  |  |  | — |  | — |  |  |
| S3 HumanEcho accept |  |  |  |  |  |  |  |  |  |  |  |
| S4 Signal combat |  |  |  |  |  |  |  |  | — |  |  |
| S5 Two routes |  |  |  |  |  |  |  |  | — |  |  |
| S6 Reject / ECHO off |  |  |  |  |  |  |  |  |  |  |  |

Reporting rules: write only what you observed; if something breaks, note the exact step and stop
that session (do not "fix" it with dev tools); don't paste secrets; a blank cell is fine.

## 6. What this document does not claim

- No completion time, damage or fun number above is filled in: they are for the person playing.
- The automated evidence (see `docs/gameplay/GAMEPLAY_01_BALANCE.md`) uses an **agent** driver that
  is non-blind; it is not a substitute for this sheet.
- Until this sheet is filled by a person: **HUMAN ACCEPTANCE PENDING**, and the overall GAMEPLAY
  status is not a whole PASS.
