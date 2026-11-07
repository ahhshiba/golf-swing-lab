# Visualization components (LM-C)

Owner: LM-C. Spec: `docs/LAUNCH-MONITOR-SPEC.md` §3.2 (main visual), §3.3 (tracer), §3.6 (2D/3D), §3.7 (stats charts),
§4.2 (tokens), §5.0-4 (frozen signatures). The code is the authority; this file is the index.

## 1. Files (all lazy: `build.mjs` LAZY_GLOBS `src/viz/*.js`)

| File | Exports |
|---|---|
| `app/src/viz/index.js` | entry: re-exports everything below, plus `prefersReducedMotion()` |
| `app/src/viz/palette.js` | `vizPalette(el)`, `seriesIndex(club, series?)`, `GLYPHS` |
| `app/src/viz/draw.js` | shared helpers (not frozen): canvas setup / DPR, units, ticks, glyphs, dashes, text, thinning |
| `app/src/viz/plot2d.js` | `drawSide`, `drawTop`, `cloudEllipse` |
| `app/src/viz/traj3d.js` | `createTraj3d`, `orbitCamera`, `project3` (≤ 12,288 B) |
| `app/src/viz/tracer.js` | `projectFlight`, `drawTracer` |
| `app/src/viz/charts.js` | `drawBars`, `drawBox`, `quantile` |
| `app/i18n/{zh-Hant,en}/viz.json` | text drawn on charts and every a11y key (lazy namespace) |
| `app/styles/screens/viz.css` | **intentionally empty** (comment only): it is linked from `index.html`, so every byte counts as shell; LM-C's shell budget is 0 B. The one style the components need (`touch-action: none` on the 3D canvas) is set from JS. Size the canvas with your own screen CSS. |

Size gates (spec §5.2 LM-C 3): `traj3d.js` ≤ 12,288 B, all `viz/*.js` ≤ 60,000 B.

## 2. Conventions

- **Input**: numbers in metres in the mat frame (x down the target line, y toward a right-handed golfer = *left* of the
  line seen from behind the ball, z up) and a canvas. `units` = `settings.units` (only `distance`: `yd` | `m` is read;
  heights are shown in the same unit as distances).
- **Text size**: `setup` reads the root font size; canvas text and the axis margins scale by root px / 16 (1–2.5),
  so 200 % text also enlarges chart text. Units live in **axis titles** (`viz.axis.distance|height|side|miss|target|value`:
  "距離（碼）", "高度（碼）", …; x centred under the tick row, y left-aligned above the label column; helpers `axisTitleX/Y`
  in `draw.js`), never among the tick labels: every tick label is drawn (one near the canvas edge slides in, `tickText`).
  The bottom margin is `TITLE_B · FS` where a chart has an x title. `drawBars` thins its bar labels (every k-th) when a
  slot is narrower than the widest label plus a gap; `drawBars` / `drawBox` take `axisTitle` (string or `unit => string`)
  and `drawBars` also `xTitle`.
- **Sizing**: each draw sizes the backing store to `clientWidth × devicePixelRatio` (max 3) when the canvas is laid out,
  otherwise it uses `canvas.width/height` as CSS pixels. Call the draw again after a resize (the 3D view does it itself
  with a ResizeObserver).
- **Colour**: only `vizPalette(el)` values (read from `--viz-*`, `--text`, `--font` with `getComputedStyle`). No colour
  literal anywhere in `viz/**` (unit test + `check_tokens js-hex-colour`). Translucency = `globalAlpha = palette.ciAlpha`
  with a series colour; in sun (`ciAlpha = 0`) bands and ellipses are 1.5 px outlines instead. A soft glow on the hero
  line only when `palette.dark`.
- **Series**: colour and point shape per club, `CLUBS` order (driver … sw → series 1–8, shapes ● ■ ▲ ◆ ▼ ✚ ✕ ○); a club
  outside `CLUBS` gets its neighbour's slot (6i → 7i …); pass `series` (0-based) to override.
- **Line styles** (§4.2): estimated = solid (+ ±1σ band when sigma is given); `low_confidence` = dash `[6, 4]`; modelled
  roll / simulated continuation = dotted.
- **Many shots**: ≤ 200 drawn, evenly thinned; the a11y key then is the `*_sampled` variant with `{shown}` and `{n}`.
- **Accessibility**: every draw returns `{ a11y: 'viz.<key>', params }`. The caller sets `role="img"` and
  `aria-label = t(a11y, params)` on the canvas (params are already formatted strings / numbers). The 3D handle exposes
  `a11y` / `params` and calls `onChange({ a11y, params })` after each redraw.
- **Reduced motion**: nothing animates by itself. The tracer is the only time-driven drawing and draws the complete
  line when `reducedMotion` is true (use `prefersReducedMotion()`); the 3D view never auto-rotates and turns in jumps.

## 3. `drawSide(canvas, { flights, units, palette, target_m? })`

`flights: [{ samples: flight.samples, club, validity, rest?: flight.rest, sigma?: { carry, apex } (1σ, m), series? }]`.
`band` (the top-view outline) is accepted and ignored here: the side band is built from `sigma` by scaling the curve
(x by carry ± σ, z by apex ± σ), drawn for ≤ 12 flights. One flight = hero: thick line, light area, apex marker and
label, carry number at landing. a11y: `side.one` | `side.one_low` | `side.many` | `side.many_sampled` | `side.empty`.

## 4. `drawTop(canvas, { points, units, palette, target?, paths? })`

`points: [{ x, y | null, sx, sy, club, validity, band?, series? }]` (landing x, side y, 1σ). `band` may be
`flight.band` (`{ side_lo, side_hi }`, the two halves of the outline) or an `[[x, y]…]` polygon. `target`: number (x) or
`{ x, y? }`. `paths: [{ samples, club, validity }]` draws the flight seen from above.

- Points with `y === null` (face_on: left/right not observable) **never share the plane**: they go to a separate
  hatched "distance only, left/right unknown" strip with a `?`, ±σ distance bar (§3.7). When no point has a side the
  strip is the whole chart, on the centre line (§3.2 single face_on shot).
- ≤ 3 points: each gets its own ±1σ ellipse / band; more: one 1σ covariance ellipse per club (≥ 3 points).
- params always carry `n`, `shown`, `n_plane`, `n_strip` (LM-F acceptance 3 asserts face_on vs hb from these).
- a11y: `top.one` | `top.one_unknown` | `top.many` | `top.many_sampled` | `top.path` | `top.empty`.

## 5. Tracer — `projectFlight(camera, samples)`, `drawTracer(canvas, opts)`

`projectFlight(calibration.camera, flight.samples) -> [[u, v] | null]` in original-resolution pixels (geom/camera.js
pinhole + k1); `null` behind the camera. Out-of-frame points are kept; the canvas clips the line.
`drawTracer(canvas, { track: shot.tracks, projected, frame, palette, reducedMotion, size?: [W, H], times?, fps? })` —
overlay canvas over the replay video (transparent, cleared each call). Detected `ball_px` up to `frame`: solid + dots;
projected flight: dotted; both as two strokes (halo 4 px `--viz-tracer-halo`, then 2 px `--viz-tracer`). Legend
"detected / simulated" top-left. Growth: with `times` (`flight.samples[i][0]`) and `fps` the simulated part follows
the video time after `impact_frame`; without them it appears once the video passes the last detected frame.
`frame: null` or `reducedMotion` → everything. a11y: `tracer.alt` | `tracer.none`.

## 6. 3D — `createTraj3d(canvas, { flights, palette | () => palette, units, target_m?, onChange? })`

`palette` may be a function: it is read again on every redraw, so a theme change only needs `redraw()` (the result
screen passes `() => vizPalette(canvas)`).

Hand-written perspective orbit camera (no library): `orbitCamera({ yaw, pitch, dist, center, fov = 50, w, h })`,
`project3(cam, p) -> [sx, sy, depth] | null`. Yaw 0 = behind the tee looking down +x; the view starts at yaw −25°
(behind-right, so the curve has depth), pitch 18° (oblique) or 89.5° (top). Draws the ground grid every 25 display
units with distance labels, the target line (y = 0, `--viz-target`), an optional target distance mark, each flight
(series colour, dashed if low) with a ground shadow, landing glyphs and the tee ring.

Handle: `rotate(dYawDeg)`, `setPitch('top'|'oblique')`, `redraw()`, `destroy()` (removes listeners / observer), `a11y`,
`params`, `view`. Input: one-finger / mouse drag (yaw horizontal, pitch vertical; `touch-action: none` on the canvas),
arrow keys when the canvas has focus (give it `tabindex="0"`). **The caller (LM-D / LM-F) renders the two 44 px buttons**
(rotate ±15°: `viz.traj3d.rotate_left|rotate_right`; top/oblique: `viz.traj3d.to_top|to_oblique`; hint
`viz.traj3d.hint`). Auto-framing: the camera distance fits every landing, the tee and the apex at all yaws of the
current pitch, so turning never zooms.

Deviation (documented): the spec says the camera orbits the landing centre; it orbits the point halfway between the
tee and the landing centre, otherwise the tee leaves the frame at most yaws.

## 7. Charts — `drawBars`, `drawBox`

`drawBars(canvas, { bars: [{ label, value, lo?, hi?, club?, series?, validity? }], palette, kind?, units?, unit? })`:
vertical bars around a zero line (signed misses: + long / − short), optional whisker lo..hi, value labels when ≤ 12
bars; low confidence = dashed outline. `drawBox(canvas, { groups: [{ label, club?, series?, values? | stats? }], … })`:
one row per group; whiskers 10th–90th percentile, box 25th–75th, thick median bar, points outside the whiskers as
dots. `stats = { p10, q1, median, q3, p90, n? }` instead of raw values. `kind: 'distance'` → values in metres shown in
`units.distance`; otherwise values are shown as given with `unit` (an already translated label). `quantile` = numpy
`linear`. a11y: `bars.alt` | `bars.empty`, `box.alt` | `box.empty`.

## 8. Tests

- `tests/unit/viz.project.test.mjs` — projection of `flight.samples[0]` onto the impact-frame ball (face_on and hb
  fixtures, ≤ 2 px; measured 0.003 px), orbit-camera known points < 1e-9 against an independent rotation-matrix
  reference at 16 yaw/pitch pairs.
- `tests/unit/viz.draw.test.mjs` — a recording fake canvas in the test file: every `strokeStyle` / `fillStyle` /
  `shadowColor` is a palette value, no gradients / patterns, low validity → `setLineDash([6, 4])`, tracer two strokes,
  reduced motion → complete line, all a11y keys exist in both catalogs with the same placeholders and every key the
  code can return is exercised; no colour literal or bare import in `viz/**`.
