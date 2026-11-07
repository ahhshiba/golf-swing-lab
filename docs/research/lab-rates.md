# Swing-lab fault rules: synthetic acceptance rates (lab-1.2.0)

Owner V4-F. Rules: `app/src/lab/params.js` (`LAB_PARAMS.version = 'lab-1.2.0'`), judgement `app/src/lab/faults.js`.
Measured by `node --test tests/unit/lab.rates.test.mjs` (the rates print as test diagnostics). Every threshold is an
UNVERIFIED teaching rule of thumb; these numbers say only that each rule separates the synthetic golfer's clean and
injected swings, not that it is right on real swings.

## Method

`tests/fixtures/v4/lab-sessions.json` → `rates`: per view (face_on, dtl) 50 clean swings at 30 fps whose fault
parameters are drawn (seeded) from realistic ranges clear of every rule (stance 0.36–0.46 m, pelvis at impact 4–12 cm
toward the target, early extension −2.5…+2 cm, pelvis at the top 0–3 cm back, head height change −2.5…+3 cm, forward
tilt loss 0–4°, spine side tilt 6–12° with −2…−6° at the top, tempo 2.7–3.3), and per rule 50 swings = the same draw plus
the rule's injection. Targets at `standard`: injected fault + possible ≥ 90 %; clean false `fault` ≤ 5 %, false
`possible` ≤ 15 %, in every view the rule is judged from.

## Results (standard)

| rule | view | clean false fault | clean false possible | injected (value) | found (fault) |
|---|---|---|---|---|---|
| early_extension | dtl | 0 % | 0 % | pelvis 10 cm toward the ball | 100 % (100 %) |
| loss_of_posture | dtl | 0 % | 0 % | forward tilt −18° | 100 % (100 %) |
| over_the_top | dtl | 0 % | 0 % | hands 10 cm out + 6 cm up at mid-downswing | 100 % (98 %) |
| over_the_top | high_behind | — | — | not synthetic (club_path_deg from the 240 fps club track) | logic test only |
| sway | face_on | 0 % | 0 % | pelvis 12 cm back at the top | 100 % (100 %) |
| slide | face_on | 0 % | 0 % | pelvis 10 cm past the lead ankle | 100 % (100 %) |
| reverse_spine | face_on | 0 % | 0 % | side tilt −12° at the top | 100 % (86 %) |
| head_dip | face_on / dtl | 0 % / 0 % | 0 % / 0 % | head −12 cm (face_on) | 100 % (100 %) |
| early_rise | face_on / dtl | 0 % / 0 % | 0 % / 0 % | head +13 cm (dtl) | 100 % (100 %) |
| weight_back ("hips don't move toward target") | face_on | 0 % | 0 % | pelvis 5 cm back of address at impact | 100 % (100 %) |
| overswing | dtl | — | — | disabled: always `unknown` + NOT_IMPLEMENTED | — |
| tempo_off | face_on / dtl | 0 % / 0 % | 0 % / 0 % | tempo 1.8 | 100 % (100 %) |

**The 0 % false-fault figures above are by construction**: the clean population leaves out every swing within
about 2.5 cm (≥ 4° for the angle rules, 0.3 for tempo, 8 points of pelvis travel for weight_back) of a threshold. They show the rules do not fire on swings that
are clearly clean; they say nothing about borderline swings. For those, the unconstrained generator:

Unconstrained generator defaults, 400 seeds per view at 30 fps (`synthSwing` random parameters; truth = the model's own
quantity, `lab.fixture.mjs labTruth`), lab-1.2.0:

| rule / view | truth past the threshold | flagged of those | false fault | false possible (of 400) | of which within 2 cm / 2° of the threshold |
|---|---|---|---|---|---|
| early_extension / dtl | 131 (truth reaches 8.0 cm) | 129 | 0 | 38 | 38 |
| head_dip / dtl | 0 (truth reaches −4.99 cm) | — | 0 | 60 (15 %) | 59 |
| head_dip / face_on | 0 | — | 0 | 3 | 3 |
| loss_of_posture / dtl | 0 (truth reaches −8.0°) | — | 0 | 11 | 11 |
| over_the_top / dtl | 0 (truth ≤ 3.3 cm) | — | 0 | 8 (2 %) | 1 (the rest 2–5 cm below) |
| every other rule | 0 | — | 0 | 0 | — |

The fresh verifier's recompute on lab-1.1.0 (400 seeds per view) found early_extension 127 / 128 true positives, 32
near-threshold `possible`, 0 false fault, and dtl head_dip `possible` on 13 %, all within 2 cm of the threshold. The
generator's early extension reaches 8 cm (not 6: `pelvisImp` plus the hip-turn interpolation). `possible` on a swing
1–2 cm from the threshold is the intended meaning ("the error range crosses the threshold").

## Interval calibration and the systematic offsets (lab-1.2.0)

On 100 unconstrained swings per view, the shot metrics the rules read are offset on the synthetic golfer:
`early_extension_m` +0.9 cm (30 fps; +0.8 at 60), dtl `head_lift_z_m` −1.2 cm, face_on `head_lift_z_m` +0.6 cm, while
their own sigma is ≈ 1.0 cm — the metric's 95 % interval covered the truth on only 86 % of dtl head-lift swings. The
offsets come from `metrics/` (not owned by V4-F) and are only known on synthetic swings, so they are not subtracted:
each rule adds a systematic 1σ (`sysSigma`: early_extension dtl 1.0 cm, head_dip / early_rise face_on 0.7 cm, dtl
1.3 cm) to its judgement interval. The over-the-top hand-path sigma no longer uses the frame spread of the moving hands
(that made every injection `possible`); a 1.5 cm motion term stands for it. `lab.rates.test.mjs` now requires the
judgement interval to cover the true quantity on ≥ 93 % of 100 unconstrained swings per view at 30 and 60 fps for every
judged rule (measured 98–100 %).

## Changes from lab-1.0.0 (both rules flagged ~every clean swing)

- **over_the_top (dtl)** measured the hands at mid-downswing against the address hand plane. Hands rise above that plane
  in every normal transition (≈ 0.27 m on the synthetic golfer), so it flagged 98 % of clean swings. Now: the hands at
  mid-downswing (lead arm parallel, ≈ P6) minus the hands at mid-backswing (≈ P3), both as distances from the address
  hand plane — over the top = the downswing comes in more than 5 cm above / outside the backswing path.
- **weight_back** compared `weight_shift_pct` with 50 %. That metric is the pelvis position (100 · pelvis Δx / stance
  width), not foot pressure; a normal swing moves the pelvis about 5–35 % of the stance toward the target, and `slide`
  starts past the lead ankle (≈ 50 % + 3 cm), so 50 % flagged every normal swing and left a ~7-point "ok" window. Now:
  weight stays back = the pelvis has not moved toward the target at all (< 0 %); relaxed −12.5 % (neutral 25 %).
  The pressure-based heuristic ("most of the weight on the lead foot at impact") cannot be read from pose, so the
  rule is named for what it measures: 骨盆沒往目標移 / "Hips don't move toward target" (lab-1.2.0). Its practice card
  (weight_step) aims at 10–45 % pelvis travel, short of the slide zone.
- **Drills (lab-1.2.0)**: `ott_pump` succeeds when the over-the-top rule stops flagging the swing (`success.clear`; the
  hand-path quantity has no contract metric); the overswing card is hidden while that rule is disabled.
- **overswing** read `top_shaft_angle_deg`, which is the across-the-line angle in the horizontal plane
  (docs/metrics-by-view.md §2), not "past parallel"; and the app keeps no club-head track near the top. Shipped
  disabled (`unknown` + NOT_IMPLEMENTED) rather than guessing.

## Known generator limitation (tests/synth/swing.js, not owned by V4-F)

The synthetic downswing hand path retraces the backswing path (`handsAtP(p)` is one function of the swing phase for
both), so clean synthetic swings sit at ≈ 0 on the new over-the-top measure, while real downswings usually shallow
(hands lower / more inside at P6 than P3: negative). Over-the-top injections are therefore applied after projection
(`lab.fixture.mjs handsOutside`). The pelvis and head ranges match common coaching descriptions (pelvis ~5–12 cm
toward the target at impact).
