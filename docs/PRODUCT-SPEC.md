# Golf Swing Lab — product-grade spec and implementation plan (v1, 2026-11-05)

Input for the implementation agents. Repo: `/home/simon/Desktop/golf-swing-lab` (audited build 0.1.0+2816fcb262 /
deployed 0.1.0+bc56e95160). This spec turns the audit findings (visual, ux, a11y_i18n, robustness, perf, privacy,
events) into one design system, one set of flows and six parallel work packages with disjoint file ownership.

Owner decisions this spec obeys (2026-11-04): product-grade, local-only (no payments, accounts, cloud, network after
install); zh-Hant primary + en with an extensible i18n layer; nothing GolfDB-derived ships (rules by default, owner
labels retrain the TCN later, GolfDB is a dev-only benchmark); target user = amateur alone at a range bay, phone on
a tripod 2–3 m away, gloves, sun or dim bay, 50–100 shots per session; iPhone Safari home-screen PWA first.

Source of findings. The visual, ux and a11y_i18n reports were received in full, and robustness up to R2. The perf,
privacy and events reports, and robustness after R2, were not in the lead's input. For those, the findings below
(`R3`–`R12`, `PF-*`, `PV-*`, `EV-*`) were rebuilt from the auditors' own raw outputs in
`scratchpad/audit/{robustness,perf,privacy,events}/` and from the source. Each one cites that evidence. **Their severities are
the lead's own call** (marked `[lead]`). Audit artefacts are relative to
`/tmp/claude-1000/-home-simon-Desktop/7dd7083b-ef93-4ef1-9ee8-f686268ef094/scratchpad/audit/`.

Conventions: MUST/SHOULD as in RFC 2119. "Machine check" = runs in `bash scripts/verify.sh` (or
`RUN_BROWSER_E2E=1`), prints PASS/FAIL, no human judgement. "iPhone" = needs a real device (WebKit cannot launch here).

---

## 0. Finding register (all P0/P1, mapped)

| id | sev | one line | package |
|---|---|---|---|
| UX-02 | P0 | setup never says where the tripod goes | B |
| R1 | P0 | camera interruption → 重新開啟相機 leaves live on a dead stream | B (live.js) + D (controller) |
| V01 / UX-06 / I18N-5 | P1 | spec codes, script names, raw ids, club codes in UI | all (own files) + A lint |
| V02 / UX-08 | P1 | results card flat 22 rows; no hero numbers; misleading null reasons | C (+E reason codes) |
| V03 / A11Y-2 / UX-09 | P1 | timeline markers overlap; drag-only correction; no undo | C |
| V04 / a11y_i18n-m2 | P1 | label list wraps names per glyph | C |
| V05 | P1 | landscape setup/live: controls below fold | B |
| V07 / UX-14 | P1 | home is a form dump; mode unexplained | B |
| V08 | P1 | venue select truncated / leading （ | B |
| V10 | P1 | disabled primaries look broken, no reason | A (style) + each screen (reason line) |
| V11 / UX-04 | P1 | live not glanceable at 2.7 m; touch counter shown | B |
| V12 / UX-11 | P1 | history: tempo only, no grouping/delete/star; A/B noise; backup misleading | C (+D repo API) |
| V13 / A11Y-4 | P1 | contrast: green light 3.37:1, control borders 1.49:1, warn 4.34:1 | A |
| visual-m1 | P1 | session bar covers the sticky header/back button | A (main.js, top stack) |
| UX-01 | P1 | no onboarding; 3 OS prompts unexplained | B |
| UX-03 / R8 | P1 | camera denied/busy/missing → dead-end setup, no retry | B (screen) + D (controller error codes) |
| UX-05 | P1 | high-speed path ≈10 taps × 2 apps per shot, no batch import | C |
| UX-07 / a11y_i18n-m1 | P1 | setup wall, 18 precise corner taps, drag-only picker | B |
| UX-10 / EV-7 | P1 | P14 labelling too costly; no owner retrain path | C (teach UI) + E (train script) |
| UX-12 | P1 | venue form jargon, prefilled values defeat double-measure, no edit/delete | B |
| UX-13 / V23 / I18N-7 / PV-3 | P1 | About/Settings: GolfDB, non-commercial, no privacy/licences/disclaimer, “dev” version | F |
| UX-15 | P1 | stale status texts, touch counter, bare import progress, toasts for critical info | A (bars) + B (live) + C (import) |
| ux-m1 | P1 | no club change in live | B |
| ux-m2 | P1 | import errors only as 3.5 s toast; back silently aborts | C |
| I18N-1 | P1 | no i18n layer; 646 CJK literals, pure modules return prose | A (core) + all (migrate own files) |
| I18N-2 | P1 | times shown in UTC | A (fmtDateTime) + B/C/F (call sites) |
| I18N-3 | P1 | units fixed SI | A (units) + all call sites |
| A11Y-3 | P1 | px font sizes; Dynamic Type ignored; 200 % breaks | A |
| A11Y-5 | P1 | async results not announced; errors vanish | A (toast/live-region API) + B/C (use) |
| R2 | P1 | full disk loses the whole shot | D |
| R3 [lead] | P1 | IndexedDB open that never settles → 「載入中…」 forever (robustness/idb-hang.png) | D (idb.js) + A (boot) |
| R4 [lead] | P1 | uncaught errors / rejections not caught or shown (robustness/unhandled.png) | A (handlers) + D (crash log) |
| R5 [lead] | P1 | vision-worker calls have no timeout or crash recovery (workers/client.js) | D |
| R6 / PF-3 [lead] | P1 | live recorder keeps one unbounded segment while idle (perf/live_real_mr.log: one 120 s / 2.72 MB blob at low res) | D |
| R7 [lead] | P1 | low-space guard only at session start | D |
| R11 / PF-1 [lead] | P1 | no offline-ready indicator (32 MB precache), no iOS eviction warning | D (sw/progress) + B (onboarding UI) |
| PF-2 [lead] | P1 | per-shot analysis ≈20 s, serialised; backlog at range cadence | D + E |
| PF-5 [lead] | P1 | 1080p live → renderer 1.0 GB RSS vs 0.27 GB (perf/live1080_4x.json) → iOS jetsam risk | D |
| PV-1 [lead] | P1 | no Content-Security-Policy (app/index.html has none) | A |
| EV-1 [lead] | P1 | rules address late/early → tempo wrong (dev benchmark: tempo ±0.3 in 13 %) | E |
| EV-2 [lead] | P1 | finish detected late (median +734 ms; synthetic short_tail/relax 0 %) | E |
| EV-3 [lead] | P1 | iPhone slow-mo exported with 1/8 speed baked in → 0/40 swings found | E (+C copy) |
| EV-4 [lead] | P1 | event confidence does not predict correctness → validity badges mislead | E |
| EV-6 [lead] | P1 | GolfDB still in product code (clip.js gating by split-1, bundled model fetch, About text) | E (+F text, A build default) |

Counts: **P0 = 2** (UX-02, R1), both mapped. **P1 = 58 distinct ids in 42 rows**: 39 graded P1 by the auditors (visual 12, ux 16, a11y_i18n 10, robustness R2) and 19 graded P1 by the lead (R3–R8, R11, PF-1, PF-2, PF-3, PF-5, PV-1, PV-3, EV-1–EV-4, EV-6, EV-7). V23 and I18N-7 are P2 and appear only as co-listed ids. Every P0/P1 id maps to a package, and the not-doing list holds none of them. P2 ids are mapped in each package's "closes" list or in §9.

---

## 1. Design system "Range"

### 1.1 Files and contract
- `app/styles/tokens.css` (new, package A): all tokens below as custom properties. Loaded before `app.css`.
- `app/styles/app.css` (A): base + every shared component class. **Screen-specific CSS** lives in
  `app/styles/screens/<pkg>.css` (B: `practice.css`, C: `results.css`, F: `settings.css`), owned by those packages,
  linked from `index.html` by A in drop 1 (empty files created by A). Screen CSS MUST use tokens only (lint:
  no hex colour, no `px` font-size outside `tokens.css`; `scripts/check_tokens.mjs`).
- Theme selection: `:root[data-theme="light"|"dark"|"sun"]` set by A from `settings.theme`
  (`'auto'|'light'|'dark'|'sun'`); `auto` follows `prefers-color-scheme`; `@media (prefers-contrast: more)` maps
  `auto` to `sun`. The live screen forces `data-live-theme="dark"` on its root unless the theme is `sun`.

### 1.2 Type (system stack; Dynamic Type)
`html { font: -apple-system-body; }` with fallback `html { font-size: 100%; }` (feature query
`@supports (font: -apple-system-body)`). Everything else is `rem`. Inputs/selects/buttons:
`font-size: max(16px, 1rem)` (no iOS focus zoom). Family:
`-apple-system, "SF Pro Text", "PingFang TC", "Noto Sans TC", system-ui, sans-serif`. All numbers:
`font-variant-numeric: tabular-nums`. CJK body line-height 1.5; Latin display 1.15.

| token | size/line (rem @16) | weight | use |
|---|---|---|---|
| `--t-hero` | 3.5/3.75 | 800 | live scoreboard number (landscape uses `clamp(3.5rem, 15vh, 7rem)`) |
| `--t-display` | 3.0/3.25 | 700 | shot hero tiles |
| `--t-title1` | 1.75/2.125 | 700 | screen large title |
| `--t-title2` | 1.375/1.75 | 700 | live state pill, sheet titles, compact tile value |
| `--t-headline` | 1.0625/1.5 | 600 | row primary, card title |
| `--t-body` | 1.0625/1.625 | 400 | body, inputs |
| `--t-callout` | 0.9375/1.375 | 400 | secondary row text |
| `--t-footnote` | 0.8125/1.125 | 400 | hints, CI, meta |
| `--t-caption` | 0.75/1.0 | 600 | tags, units, section headers (outside cards, muted, letter-spacing .02em) |

Metric value + unit: unit inline at `0.45em`, weight 500, `--text-2`.

### 1.3 Spacing, sizing, radii
4 px grid: `--s-1 4px … --s-2 8 · --s-3 12 · --s-4 16 (gutter, card padding) · --s-5 20 · --s-6 24 (between
sections) · --s-8 32 · --s-10 40`. Hit targets: `--hit-min 44px`; `--hit-primary 56px` (all primary actions,
gloves); `--hit-live 64px` (live screen). Rule: unrelated targets ≥ 8 px apart. List rows min 52 px.
Radii: `--r-sm 8px` (tags, inputs), `--r-md 14px` (cards, buttons, stages), `--r-lg 22px` (sheets, hero tile),
`--r-pill 999px`. Safe areas: page padding uses `max(var(--s-4), env(safe-area-inset-*))`.

### 1.4 Colour (all ratios computed with WCAG 2.x relative luminance; script
`scratchpad/audit/lead/contrast.py`, to be ported into `tests/unit/tokens.contrast.test.mjs`)

**Light** (`bg #F2F4F3`, `surface #FFFFFF`, `surface-2 #E6ECE8`)

| token | value | pair → ratio (need) |
|---|---|---|
| `--text` | #0F1A14 | surface 17.82, bg 16.14 (4.5) |
| `--text-2` | #4A5850 | surface 7.49, bg 6.78 (4.5) |
| `--text-3` (placeholder, disabled, tertiary) | #5F6D65 | surface 5.44, bg 4.92, surface-2 4.54 (4.5) |
| `--control-border` | #7C8C82 | surface 3.54, bg 3.21 (3.0 UI) |
| `--separator` | #C9D3CD | decorative hairline only (exempt) |
| `--accent` / `--on-accent` | #0B6B3F / #FFFFFF | 6.58; accent on bg 5.96 |
| `--accent-tint` | #E1F2E8 | accent text on it 5.67 |
| `--info` (estimated) | #1D5FBF | surface 6.10; focus ring on bg 5.52 |
| `--signal-go` / on | #0E7A3E / #FFFFFF | 5.42 |
| `--signal-caution` / on | #F5B700 / #1A1300 | 10.25; fill vs page 1.80 → caution surfaces MUST carry a 1.5 px `--warn-text` border |
| `--signal-stop` / on | #C4281C / #FFFFFF | 5.73 |
| `--danger-text` | #B3261E | surface 6.54 |
| `--warn-text` | #8A5700 | surface 6.10, surface-2 5.09 |
| `--fill-disabled` / text | = surface-2 / `--text-3` | 4.54 (no opacity) |
| tags valid / est / low / null | #0B5E31 on #E3F4EA · #1D4E9E on #E4EEFB · #7A4B00 on #FFF1D6 · #4F5A54 on #ECEFED | 6.92 · 6.80 · 6.64 · 6.20 |

**Dark** (`bg #07100B`, `surface #111C16`, `surface-2 #1C2B22`)

| token | value | ratio |
|---|---|---|
| `--text` | #EAF2ED | surface 15.33, bg 16.93 |
| `--text-2` | #A9BBB0 | 8.67 |
| `--text-3` | #8A9F93 | surface 6.21, surface-2 5.26, disabled fill #24332B 4.71 |
| `--control-border` | #5D7A69 (#6B8977 on surface-2) | 3.71 / bg 4.09 / 3.86 |
| `--accent` / on | #34C77B / #04140B | 8.65; accent on surface 7.99 |
| `--info` | #6FA8FF | 7.26 |
| go / caution / stop with on-colour | #2FBF71/#04140B 7.94 · #FFC940/#1A1300 12.03 · #FF5A4E/#1A0503 6.40 |
| `--danger-text` / `--warn-text` | #FF7A70 6.88 / #F0B44C 9.44 |
| tags | #7FE0A8/#123322 8.62 · #A9C8FF/#14243F 9.15 · #F5C46A/#3A2A0B 8.57 · #B4C2BA/#22302A 7.46 |

**Sun** (outdoor high contrast; Settings › Display, and suggested once when the P19 brightness check reports mean
luma > 200/255 — B shows the suggestion, A implements the theme): bg/surface #FFFFFF, text #000000 (21.0),
text-2 #26302B (13.64), all control borders **2 px** #3D4A43 (9.30), accent #00552F (white 8.97), go #006B33
(6.66), stop #A3150B (7.87), body weight +100, hero numbers +15 %. No tinted/transparent surfaces; shadows off.

Elevation: light cards `box-shadow: 0 1px 2px rgb(0 0 0 / .06), 0 2px 8px rgb(0 0 0 / .04)` plus a 1 px
`--separator` border; dark cards use surface contrast only. Colour is never the only carrier: every signal/state
has a glyph and text (closes A11Y-8).

### 1.5 Components (A implements in `app/src/ui/dom.js` + `app/src/ui/components.js`; exact API in §8.0)
Button (primary / secondary / tinted / plain / destructive; sizes `md 44`, `lg 56`, `xl 64`; states pressed
`scale(.97)` + `filter: brightness(.94)`, `:focus-visible` 3 px `--info` outline offset 2, disabled = fill-disabled +
text-3 + mandatory `reason` line for primaries) · ListRow (52 px; leading icon 28; title; trailing value text-2 +
chevron; whole row tappable) · Segmented (2–4 options, 36 px min, ≥44 px hit) · Switch (51×31, `role=switch`) ·
MetricTile (label caption · value · unit · CI footnote · ValidityTag top-right; sizes `hero` / `compact`) ·
ValidityTag (glyphs ● valid, ◐ estimated, ▲ low confidence, — not measurable; 22 px tall, r-sm, caption) ·
StatePill (full width, `--hit-live`, signal colour + glyph + title2; `aria-live=polite` persistent element) ·
Notice (4 px left bar, tint bg, icon, title, collapsible body; variants info/caution/error) · EmptyState (48 px icon,
headline, one callout, one tinted button) · Toast (`info`: auto-hide `4000 + 60 ms × chars`; `error`: `role=alert`,
persists until its 44 px 關閉, also mirrored into the current screen's error slot) · Sheet (bottom sheet, r-lg top,
grabber, max 90 dvh, focus-trapped, Esc/close) · ConfirmSheet (replaces `confirm()`; consequence line; safe action
is primary) · FilePicker (visually hidden `<input type=file>` keeps its data-testid; styled label button / 160 px
dashed drop zone; localized text) · ScreenHeader (iOS large title; back = chevron + previous screen title, 44 px;
`h1 tabindex=-1`) · ProgressSteps (step list with check marks, ETA line, cancel) · Chip / ChipRow (horizontal
scroll, scroll-snap).

### 1.6 Icons
One inline SVG sprite injected into `<body>` at boot by `app/src/ui/icons.js` (A), so there are no extra requests
and no external fonts or CDNs. 24 px grid, 1.75 stroke, `currentColor`, Lucide-style paths drawn in-house or copied from Lucide
(ISC; licence text added to About › Licences). Usage: `icon('camera')` → `<svg aria-hidden="true"><use href="#i-camera"/></svg>`.
Set: chevron-left, chevron-right, chevron-down, camera, camera-off, film, film-off, history, settings, info,
target, level, sun, lock, play, pause, step-back, step-forward, flag, ruler, trash, download, upload, share, check,
alert, x, star, star-filled, undo, mic-off, tripod, phone-landscape, phone-portrait, help, shield (privacy), club.

### 1.7 Motion
Tokens: `--dur-fast 120ms`, `--dur-base 220ms`, `--dur-slow 400ms`, `--ease-out cubic-bezier(.2,.8,.2,1)`,
`--ease-spring cubic-bezier(.34,1.56,.64,1)` (bubble level only). Uses: screen push/pop translateX ±8 % + fade
(base); toast slide-up 12 px + fade (base); press scale .97 (fast); live state crossfade 180 ms; recording dot
pulse 1.2 s; hero count-up 400 ms on new shot. **Every** transition/animation is declared inside
`@media (prefers-reduced-motion: no-preference)`; with reduce, state changes are instant and count-up is skipped.
Nothing animates layout properties (width/height/top) — transform/opacity only.

---

## 2. Information architecture and flows

### 2.1 Navigation
Bottom tab bar (A renders in `main.js`, hidden on `setup`, `live`, onboarding): **練習 Practice · 歷史 History ·
設定 Settings**. Diagnostics and About move under Settings. No URL routing (unchanged rule). Focus and title on
every navigation (A11Y-1): `document.title = t('screen.<id>.title') + ' – ' + t('app.name')`, focus the screen
`h1`; `nav.back()` restores focus to the opener.

Global top stack (visual-m1): one `#top-stack` wrapper, `position: sticky; top: 0`, holds update banner, session
status, health prompts; its height goes to `--topbar-h` via ResizeObserver; `.screen-header { top: var(--topbar-h) }`.
Session status shows `t('session.status.practising', {view, n, elapsed})` and transient messages, never a stale
setup message (UX-15).

### 2.2 Onboarding (first launch; B, `app/src/ui/onboarding.js`; flag `settings.onboarding.done_v`)
Skippable, ~60 s, 6 cards, one primary each:
1. Welcome — what it measures; "everything stays on this phone".
2. What you need — tripod ≥1.7 m, optional Bluetooth remote, tape measure on first visit; link "No tripod? Import
   videos" → sets `mode=highspeed`, ends onboarding into Import.
3. Install — if iOS Safari and not standalone: Share → Add to Home Screen illustration; offline-ready progress bar
   (`app.offline.progress()` from D). Standalone: skipped.
4. You — handedness, height (cm or ft/in), usual club, **units** (yd·mph default / m·m/s), **language**.
5. Permissions primer — rows Camera / Microphone / Motion with reason + what still works if refused; one "Allow"
   button runs the existing same-click P2 sequence (`controller.requestPermissions()`), result inline per row with
   recovery text.
6. First session — two large cards: "Swing only (live)" vs "Swing + ball flight (slow-motion → import)", each
   listing what you get. Goes to Practice.
Home form stays hidden until onboarding is done or skipped. Re-run from Settings › Help.

### 2.3 Screens: primary job and layout

**Practice (home)** — primary: start. Layout: large title; context card of ListRows `場地 · <venue> ›`,
`角度 · 正面 ›`, `球桿 · 7 號鐵 ›`, `模式 · 即時 ›` (each opens a Sheet / Segmented); option text never starts with
a full-width bracket, venue default label `預設墊子（未量測）` with dimensions in the hint (V08). Pinned bottom
56 px `開始練習` (safe-area). Tinted `匯入影片` with film icon. "Last session" card (shots, avg tempo, best carry)
+ last 3 shots rows → History. During an active session the form collapses to a read-only summary; primary
becomes `回到即時模式`, secondary `回到架設`, destructive text `結束練習` separated below (visual-m2).

**Venue** — 5-step wizard with a diagram per step; first measurements empty (no prefill), second measurement
required for L/W; units as input suffixes; slope/tee/B labelled "optional, improves ball numbers". Venues list in
Settings › Venues: edit, rename, delete (ConfirmSheet), set default (UX-12).

**Setup** — stepper, one instruction + one primary per step, progress "步驟 2 / 6":
S1 Place tripod (top-down SVG for the view with this venue's numbers from `session/bay.js`: distance from mat edge,
phone height `min(0.84, h_max)`, landscape/portrait, "1× lens"; two drivers end-to-end as a tape alternative) (UX-02)
→ S2 Level (big bubble, auto-advance after 1 s green) → S3 Mat corners (ghost + directional arrows from
ghost-vs-detected offset "move left/raise phone"; corner picker with loupe at 2×, after a tap a fine-adjust row:
corner 1–4 selector, four 44 px arrow buttons ±1 px, long-press repeat, ×10 toggle, 下一角; arrow keys when canvas
focused; f-lock solves collected automatically from 3 refined solves over 3 s, manual rounds only as fallback)
(UX-07, a11y_i18n-m1) → S4 Ball → S5 Stand at address (auto framing check) → S6 Done: green summary + "Start
hitting"; amber/red: ONE plain fix instruction ("Turn the phone slightly left") and "Start anyway" via ConfirmSheet
stating "ball numbers will be marked low-confidence". Raw pose numbers, RMSE, the C0–C9 timer → Settings ›
Developer. Landscape (`(orientation: landscape) and (max-height: 500px)`): 2 columns, preview left
`height: calc(100dvh - safe areas)`, 320 px right rail scrolls, step primary pinned at rail bottom; header hidden,
floating 44 px back (V05). Camera denied/busy/missing: full-screen state "Camera is off" with iOS path, `Try again`
(same-click retry) and `Import a slow-motion video instead`; mic denied = non-blocking banner; motion denied =
inline in level step (UX-03).

**Live** — primary: glanceable scoreboard. Forced dark (or sun). StatePill at top (`ready` go-green ✓ "準備好了",
`swinging` red ● pulse, `analysing` amber spinner + "分析中… 約 N 秒", `done` green). Below: 1–3 hero numbers
(`settings.live.metrics`, default `['tempo','club_speed_mps','carry_m']` filtered to what the mode can measure) at
`--t-hero`, readable at 2.7 m: **hero digit cap-height ≥ 40 px CSS in portrait at 390 px wide, ≥ 15 vh in
landscape** (machine-checked). Shot count chip 「第 12 球」; club chip `7 號鐵 ▾` → Sheet of clubs (56 px rows),
applied to the next shot without restarting the stream (ux-m1). Bottom toolbar: `結束` (destructive, ConfirmSheet
→ session summary), `重新架設` icon. No touch counter (moved to diag). Voice readout (speechSynthesis,
`settings.live.voice` default on, locale voice) after each shot: one sentence `t('live.speak.shot', …)`. Landscape:
full-bleed preview, translucent pill top, hero numbers overlay bottom-right. The last-shot summary is a persistent
`aria-live=polite` line (A11Y-5).

**Import** — primary: choose videos (`multiple`). Remembered view/calibration/club summary line (sticky in
`app.current`). First-time illustrated 4-step "Photos → Files" guide + "Why Files and not Photos?" expander;
"Analyse anyway (no ball data)" offered explicitly when fps < 200. Queue: ProgressSteps per clip (探測 → 姿勢 → 事件 →
擊球 → 彙整 with ✓, ETA = frames × measured ms/frame), cancel with ConfirmSheet; back during a job asks "Analysis
in progress — stop it?". Errors render a persistent error card (what happened, likely cause, `Try another video` /
`Use without ball data`) (ux-m2). Slow-mo with baked 1/8 speed: card "This video was saved as slow-motion
playback; we corrected the speed ×8" (EV-3). After results: primary `匯入下一支`, then session summary.

**Results (shot)** — three tiers (V02/UX-08):
1. Hero strip per view: face_on = carry · ball speed · club speed (high-speed) or tempo · club speed (live); DTL =
   tempo · spine angle · hand plane; high_behind = tempo · club path. MetricTile hero: value `--t-display`, unit,
   "± 2.4" footnote (rounded to display precision, hidden when it rounds to 0), ValidityTag. Meta line under title:
   local date-time · club name · "已修正" only when revision > 0.
2. Notice "2 項提醒" (shared reasons shown once) under the hero, expandable.
3. Grouped sections 揮桿節奏 / 身體 / 桿頭與球: 2-column compact tiles; reason shown per tile only when unique.
4. Disclosure 「這個角度量不到的 N 項」: one line each, label + plain reason, tip "try DTL for these".
5. Replay: empty clip → 120 px EmptyState (film-off, 「沒有保存影片」), frame controls hidden; pose-only →
   skeleton on #1C1F1E with ground line. Timeline: 12 px dot markers on the track (lane-assigned, no text on the
   track), selected event name in one chip above; event ChipRow (8 chips, scroll-snap) below; big ◀ ▶ frame buttons;
   `設為這一幀`; each marker `role=slider` with arrows ±1 / Shift ±10; `重設為偵測值`, `復原`, revision list
   ("已修正 11-04 15:20 · 還原原始"); leaving with unsaved edits → ConfirmSheet. Source shown as 自動 / 你.
6. Actions: star, delete (soft, undo toast), share/export, (?) glossary Sheet per metric (name, meaning, typical
   amateur range).
New reason codes (A adds to the code list, E/C emit): `NO_CALIBRATION` (import without a mat calibration; replaces
the wrong SETUP_UNVERIFIED), `CLIP_NOT_SAVED` (quota), `SLOWMO_CORRECTED` (informational), `NO_SWING_FOUND` exists
as an error: no shot is saved when no swing is found (UX-08).

**History** — sessions grouped by day/session with sticky headers (date · venue · angle · N shots · averages). Row:
40 px club chip, primary "139 yd · 117 mph" headline, secondary "11:05 · 正面" footnote, chevron; only the latest
revision with 已修正 tag; star toggle; swipe or long-press → delete with 10 s undo toast (soft delete). Filters as a
ChipRow. Compare = header toggle → checkboxes → plain-language diff sheet ("節奏慢 0.3，超出平常變動"). Data card:
`備份全部` (always includes poses and labels; videos optional with size estimate), `匯出試算表 (CSV)`, `從備份還原`;
uses `navigator.share({files})` when available, else download link (V12/UX-11). "Teach the swing detector" entry
→ Teach screen (§7.4).

**Settings** — grouped list: Profile (hand, height, clubs & lengths), Venues, Display (theme incl. Sun, text size
note), Live (which 3 numbers, voice), Units, Language, Storage & backup (protect from deletion = persist, usage,
clip clean-up with what/how much via ConfirmSheet), Privacy (statement + 刪除所有資料), Help/FAQ (glossary, re-run
onboarding), About. **Developer** (revealed by 7 taps on the version row; flag `settings.dev`): event-model
import/rollback, calibration health counters, drop test, setup timer, diagnostics report, pose model
快速/標準/精細, spec codes overlay (`data-spec` attributes become visible).

### 2.4 Copy rules (all locales)
No spec ids (`P\d+`, `C\d+`, `K\d+`, `RC`, `SETUP_UNVERIFIED`), file or script names, sha/golden/tensor words,
raw ids (`shot-…`, `7i`, `tcn`, `rules`) in any catalog value. Every reason code has `{short, long, fix}`; every metric
has `{label, short, meaning, range}`; zh-Hant metric labels put Chinese first, English term in `metric.<id>.term`
shown muted on its own line (zh only) (V21). Specs ids may live in `data-spec` attributes and the diag report.

---

## 3. i18n architecture (A owns the core; every package migrates its own files)

### 3.1 Files
- Source catalogs: `app/i18n/<locale>/<namespace>.json`, locales `zh-Hant`, `en`. Flat dotted keys **without**
  the namespace prefix inside the file (file `setup.json` key `step.level.title` = full key `setup.step.level.title`).
  Plural value = object keyed by `Intl.PluralRules` category (`{"one": "...", "other": "..."}`; zh-Hant uses
  `other` only). Params `{name}`. Context for translators: sibling key `<key>._context` (stripped at build).
- Build (A, `scripts/build.mjs`): merges each locale into `dist/i18n/<locale>.json`, strips `_context`, adds both to
  the shell precache. Dev and unit tests (no URL params, per interfaces.md): the loader tries `i18n/<locale>.json`, and on a 404 it loads the namespace files
  listed in `app/i18n/namespaces.json` (A).
- Namespace ownership (a package edits only its namespaces, both locales):
  - **A**: `app`, `common`, `screen`, `nav`, `unit`, `validity`, `view`, `mode`, `club`, `event`, `metric`, `reason`,
    `error`, `a11y`, `time`
  - **B**: `onboarding`, `home`, `venue`, `setup`, `calib`, `live`, `bay`, `health`, `camera`
  - **C**: `import`, `shot`, `replay`, `history`, `compare`, `label`, `teach`, `export`
  - **D**: `session`, `storage`, `diag`, `update`, `offline`
  - **E**: `model`, `events`
  - **F**: `settings`, `about`, `privacy`, `help`, `legal`, `licence`

### 3.2 Runtime API (`app/src/i18n/index.js`, pure apart from the loader) — FROZEN in drop 1
```js
export async function initI18n({ locale = 'auto', fetchImpl = fetch, base } = {}) // -> resolved locale
export function t(key, params = {})          // active → zh-Hant → key; missing → diag 'i18n.missing' (deduped)
export function has(key)                     // boolean
export function getLocale()                  // 'zh-Hant' | 'en'
export async function setLocale(locale)      // loads catalog, sets <html lang>, notifies listeners
export function onLocaleChange(fn)           // -> unsubscribe
export function resolveLocale(pref, languages = navigator.languages) // pure
export function plural(key, n, params)       // = t(key, {...params, n})
export function list(items, type = 'conjunction')                    // Intl.ListFormat
export function fmtNum(x, { digits = 0, sign = false } = {})         // Intl.NumberFormat, U+2212 minus
export function fmtDateTime(iso, { date = true, time = true } = {})  // local tz, dateStyle medium / timeStyle short
export function fmtDate(iso), fmtTime(iso), fmtRelativeDays(n)       // Intl.RelativeTimeFormat
export function msg(m)                       // renders a { code, params } message object: t(m.code, m.params)
```
`resolveLocale`: `zh-TW|zh-HK|zh-MO|zh-Hant*` → zh-Hant; `zh-CN|zh-Hans*` → zh-Hant (until zh-Hans exists);
`en*` → en; else en. `settings.locale = 'auto'|'zh-Hant'|'en'`. On change: `<html lang>`, current screen
re-`show()`, `document.title`. Manifest/apple title stay bilingual-brand `揮桿實驗室 Golf Swing Lab` / short
`揮桿實驗室`.

### 3.3 Units (`app/src/i18n/units.js`, A)
`settings.units = { distance: 'yd'|'m', speed: 'mph'|'m/s'|'km/h', body: 'cm'|'in', clubLength: 'in'|'m', height: 'cm'|'ftin' }`.
Default `{ yd, mph, cm, in, cm }` (en-US locale → body `in`, height `ftin`). **OWNER-CONFIRM** (§9 open item).
Storage stays SI. `fmtMetric(metric, units) -> { value, unit, ci, text, digits }` (moves from `ui/format.js`):
factors 1 m = 1.09361 yd; 1 m/s = 2.23694 mph = 3.6 km/h; 1 m = 100 cm = 39.3701 in; deg/s/ratio unchanged; CI and
sigma scale with the same factor. Digits: carry yd/m 0; speeds mph 1, m/s 1, km/h 0; body cm 1, in 1; ratios 2;
deg 0. Body metrics (`head_sway_x_m`, `head_lift_z_m`, `head_depth_y_m`, `hand_plane_dev_m`, `early_extension_m`)
display in body units. `parseLength(text, unit)` / `toSI` for inputs. Thresholds in copy are params formatted with
the user's units (`calib.check.abs_Y_m = "側偏太多：腳架要在球線上（≤{lim}）"`).

### 3.4 Pure modules emit codes (owner in brackets)
| module | today | becomes |
|---|---|---|
| `contract/reason-codes.js` [A] | Chinese table | `RC` code list + `describe()` removed; UI `t('reason.'+c+'.short')` |
| `workers/protocol.js` [D] | `ERROR_CODES` prose | `ERR` code list; worker sends `{code, params, detail}`; detail → diag only |
| `ui/format.js` [A] | `ERROR_TEXTS`, `CHECK_LABELS`, `errorText` CJK sniffing | delete `ERROR_TEXTS`; `CHECK_LABELS` → B's `calib.check.*`; `errorText(e) = t('error.'+(e.code ?? 'INTERNAL'), e.params)` |
| `session/controller.js` [D] | `store.status` Chinese | `status: {code, params}` (`session.status.*`) |
| `store/quota.js` [D] | `plan.message` | `plan.msg = {code:'storage.over_limit', params}` |
| `store/compare.js` [C] | `notes[].text`, dup VIEW_LABEL | `notes[] = {kind, params}` |
| `calib/checks.js` [B] | prompt text, failure text | `{id, level, params}` |
| `store/labels.js` [C] | Chinese errors | `[{code:'label.unknown_event', params}]` |
| `session/bay.js` [B] | advice text | `{verdict, D_m, h_max_m, shift_m}` |
| `session/settings.js` [A] | `CLUBS` names | `[type, length_m]`; name `t('club.'+type)` |
| `metrics/registry.js` [A] | `label_zh` | removed; `t('metric.'+id+'.label')` |
| `session/models.js` [E] | `modelStatusText` | `modelStatus() -> {code, params}` |
| `ui/replay.js` validation [C] | Chinese message | code |
Exports (JSON/CSV) keep codes and English column ids, never localized text.

### 3.5 String sources to migrate (from a11y-i18n/strings.mjs: 646 literals, 591 unique, 32 files)
`ui/setup.js` 74 [B] · `ui/format.js` 61 [A; CHECK_LABELS part → B keys] · `ui/settings.js` 57 [F] · `ui/venue.js`
43 [B] · `ui/shot.js` 38 [C] · `ui/home.js` 37 [B] · `ui/history.js` 33 [C] · `contract/reason-codes.js` 26 [A] ·
`session/models.js` 24 [E] · `metrics/registry.js` 22 [A] · `index.html` 20 [A] · `workers/protocol.js` 18 [D] ·
`store/core.js` 16 [D] · and the remaining files: `ui/live.js`, `ui/import.js`, `ui/replay.js`, `ui/magnifier.js`,
`ui/sensors.js` [B/C by file owner], `ui/about.js`, `ui/diag.js` [F/D], `ui/update.js`, `ui/dom.js` [D/A],
`session/controller.js`, `store/quota.js` [D], `store/compare.js`, `store/labels.js` [C], `calib/checks.js`,
`session/bay.js` [B], `session/settings.js` [A], `pipeline/clip.js` [E], `main.js` [A], `manifest.webmanifest` [A].
Estimate ≈620 keys, ≈40 plural patterns, 127 interpolated templates.

### 3.6 Lint (`scripts/check_i18n.mjs`, A; verify stage `i18n`)
FAIL when: any CJK literal in `app/src/**/*.js` outside comments; any `t('…')`/`plural('…')` key literal missing in
either locale; a catalog key unused (warn only for `metric.*`, `reason.*`, `error.*` which are built dynamically —
those are checked against `RC`, `ERR`, registry ids instead); placeholder sets differ between locales; a value
matches `/\b[PCK]\d{1,2}\b|\b[A-Z]{3,}_[A-Z_]+\b|\.mjs\b|sha-?256|golden|GolfDB|tcn\b/i`; a namespace file is edited
outside its owner's namespace (checked by key prefix ⇄ filename). Prints per-namespace coverage
(`en keys / zh keys`). Package acceptance requires 100 % for its namespaces.

---

## 4. Robustness model

### 4.1 Global handlers (A, `main.js`; storage of records by D)
- `window.addEventListener('error')` and `'unhandledrejection'` → `app.errors.report(err, {where:'global'})`.
- `app.errors.report(err, ctx)`: normalises to `{code, params, detail, stack?, where, screen, at}`; appends to the
  crash log (D, `diag/record.js` ring buffer 200 entries, persisted in `localStorage gsl.diag/2` with try/catch);
  shows `toast.error(t('error.'+code))` unless `ctx.silent`. Never throws.
- Boot watchdog: if `#app-ready` is not set 8 s after DOMContentLoaded, replace `載入中…` with an error EmptyState:
  "The app could not start" + `重新載入` + `以不儲存模式繼續` (runs without repo) + `複製診斷資料`. `#boot-error`
  is used for this.
- Worker: `worker.onerror`/`onmessageerror` → client rejects all pending with `WORKER_CRASHED`, recreates the worker
  once (backoff 1 s), re-sends `init` and `set_model`; second crash within 60 s → `WORKER_UNAVAILABLE` state.

### 4.2 User-visible error states (each has a recovery path)
| situation | state | recovery |
|---|---|---|
| IDB open never settles (R3) | `openRepository` times out at 5 s → `repoReady=false`, banner "結果不會被儲存" | 重新載入; continue unsaved |
| camera denied / busy / missing (UX-03/R8) | `camera.denied`/`camera.busy`/`camera.missing` full-screen state on setup | Try again (same click), Import instead |
| camera interrupted (R1) | session bar `session.status.camera_lost` + reopen | reopen re-attaches the live screen (§8 B/D contract `attachStream`) |
| quota exceeded on save (R2) | shot + poses saved without clip, `CLIP_NOT_SAVED` reason, `lowSpace=true`, persistent Notice | Storage settings / clean-up |
| low space mid-session (R7) | check `navigator.storage.estimate()` every 10 shots and before each clip save; < 200 MB free → stop saving clips, Notice | clean-up sheet |
| worker timeout (R5) | per-call timeouts: `init` 60 s, `pose` frame 5 s, clip analysis `max(30 s, frames × 1 s)` → `ANALYSIS_TIMEOUT` | retry once automatically, then error card |
| import errors | persistent error card (C) | try another / without ball data |
| truncated/garbage file (R9) | probe verifies sample table vs file size and decodes first+last sample → `FILE_TRUNCATED` | try another |
| offline + heavy model missing (R10) | 精細 option disabled with reason "需要先下載 31 MB" + download button (Developer) | download when online |
| storage eviction risk (R11) | if `persisted !== true` and not standalone: onboarding + Settings show "加入主畫面並開啟防止清除" | persist request, backup |
Errors never show `e.message`; developers read `detail` in diag.

### 4.3 Crash log in diag (D)
`diag/record.js`: keep last value per key (existing) **plus** `events[]` ring (200) of `{at, kind:'error'|'warn'|
'info', code, where, detail}`; `diag/report.js` includes it; Diagnostics screen (D, `ui/diag.js`) shows a human
summary (camera fps, decoder, storage used/quota, offline ready, persisted, last 10 errors with local time) +
`複製報告` + `儲存為檔案` (JSON via share/download) + raw JSON in a collapsed disclosure (V19, R12).

---

## 5. Performance budgets and ranked fixes

Budgets (Chromium on this host as proxy; iPhone numbers measured on device and recorded in
`docs/device-checklist.md` by the owner):

| metric | budget | today (evidence) |
|---|---|---|
| warm start (SW) to `#app-ready`, CPU ×4 | ≤ 400 ms | 258 ms (perf/load.json) ✓ |
| cold start Fast-3G to `#app-ready` | ≤ 6 s | 14.9 s, 96 requests (perf/load.json) ✗ |
| offline-ready (precache) visible | progress shown; complete ≤ 90 s on 20 Mbit | 31.85 MB, no UI ✗ |
| live: shot → hero numbers | ≤ 6 s (iPhone 13), ≤ 12 s on this host CPU ×4 | ≈20 s/job serialised (perf/live_standin_jobs.log) ✗ |
| import 3 s 240 fps clip → card | ≤ 15 s iPhone; ≤ 25 s host | 21.5 s host (perf/import.json) ~ |
| renderer memory live | ≤ 450 MB host proxy | 1,025 MB at 1080p (perf/live1080_4x.json) ✗ |
| long tasks on main thread during live | 0 > 100 ms | 1 × 144 ms ~ |
| history 1000 shots open | ≤ 500 ms CPU ×4, ≤ 1,500 DOM nodes | all rows rendered (history.js:99) ✗ |

Ranked fixes:
1. **PF-5 / R6 capture resolution and recorder** (D): live capture constraint `1280×720` (face_on/high_behind
   landscape), never 1080p in live; recorder uses `timeslice`-free segments **cut at most every 8 s while idle**
   (discard idle segments not followed by onset), cap one segment at 12 s; ImageBitmaps closed (already 0 leaks).
2. **PF-2 analysis latency** (D + E): live job analyses only the trimmed window (address−0.5 s … impact+1.2 s)
   at the rule grid rate (≤ 60 Hz) with the lite model; pose on a crop ROI from the previous shot; jobs run newest-
   first with a queue limit of 2 (older pending shots analysed later, card shows "排隊中"); ETA shown.
3. **PF-1 cold start + offline readiness** (A build + D sw): build emits `<link rel="modulepreload">` for the boot
   graph (≤ 30 modules) and lazy-imports `capture/`, `import/`, `pipeline/`, `physics/`, `track/` only on first use;
   SW posts `{type:'PRECACHE_PROGRESS', done, total, bytes}`; `app.offline` (D) exposes it.
4. **History virtualisation** (C): render by session groups, collapsed by default except the latest 2; within a
   group render 50 rows then "顯示更多"; DOM ≤ 1,500 nodes at 1000 shots.
5. Long task 144 ms (D): move clip assembly (`pipeline/assemble.js` runs on main, 104 ms) into the worker or yield
   with `scheduler.yield()`/`setTimeout(0)` between metric groups.

---

## 6. Privacy, security, legal

### 6.1 CSP (A, `app/index.html` meta + `deploy/` header note)
```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data:;
img-src 'self' blob: data:; media-src 'self' blob: mediastream:; style-src 'self'; font-src 'self';
object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```
(`frame-ancestors` is ignored in meta; GitHub Pages cannot send headers — documented.) No inline scripts or styles:
`h()` style objects set CSSOM properties, which CSP allows; any `style="…"` attribute string must be removed (lint
in check_tokens). Verified in Chromium e2e: `securitypolicyviolation` listener records 0 violations across all
screens, and a probe `fetch('https://example.com/x')` is blocked (privacy/run3.out shows it works).

### 6.2 Telemetry block (PV-2)
Keep `blockForeignFetch` in `pose/landmarker.js` (MediaPipe ODML logger, diag `pose.blocked_requests`), and add
the CSP `connect-src 'self'` as the second layer. Extend the guard to `XMLHttpRequest.open` and
`navigator.sendBeacon` in the worker (D). e2e gate `real-pose` keeps failing on any request leaving the origin.

### 6.3 Sanitisation
All UI text goes through `h()`/`textContent` (no `innerHTML` in app/src today; lint keeps it out: add `innerHTML`,
`insertAdjacentHTML`, `outerHTML =`, `document.write` to `FORBIDDEN_RE` in verify.sh — A). Imported backups are
validated by `contract/validate.js` before writing; import rejects files > 2 GB and unknown `format`; strings from
imports (venue names) are rendered as text and truncated to 60 chars. File names for exports are built from local
date parts only.

### 6.4 About / Licences / Privacy / Disclaimer content (F; catalogs `about`, `privacy`, `legal`, `licence`)
- About: app name, version from the build constant `APP_VERSION` (A injects into `app/src/version.js` at build;
  never "dev") as "0.1.0 · build bc56e95", one-line description, "Support: …" contact placeholder **OWNER-CONFIRM**.
- Event detection line: "揮桿階段：自動偵測（規則式）" / "Swing phases: automatic (rule-based)"; later
  "…（以你自己的揮桿訓練）" when an owner model is active. **No GolfDB, no "non-commercial".**
- Privacy (own screen, shield icon): no account; after install no network requests; videos, poses and results stay
  in this browser's storage on this device; nothing is sent to us or third parties; camera/mic/motion used only
  while practising; how to back up; how iOS may delete website data (and how persist/Home Screen helps); `刪除所有資料`
  (ConfirmSheet → clears IndexedDB, caches except shell, localStorage; then reload).
- Licences: MediaPipe tasks-vision 1.2.2 + pose models (Apache-2.0, full text from `vendor/mediapipe/LICENSE`),
  mp4box 2.4.1 (BSD-3-Clause), Lucide icons if used (ISC). Rendered from the shipped LICENSE files (fetched locally).
- Disclaimer: estimates for practice, not a certified launch monitor; carry is a model; ±ranges explained; safety
  note (tripod placement out of the swing path, side partition).

---

## 7. Event detection without GolfDB (E)

### 7.1 Product removal of GolfDB (EV-6)
- `scripts/build.mjs` (A, per this spec): default = no event model; `--include-golfdb-model` becomes a dev-only flag
  that also sets `precache-manifest.dev_research=true` and refuses `deploy_pages.sh`.
- `pipeline/clip.js` (E): remove the per-view TCN gate derived from GolfDB split 1 (`clip.js:143,166`). Selection
  becomes: imported owner model **only if** its model card's owner-set gate passed (§7.3), else rules. high_behind
  rules unless the owner model card covers it.
- `workers/vision.worker.js` default model fetch (D, per this spec): no fetch of `models/event-tcn-v1.*` unless the
  build manifest says it is bundled (removes the 404 in diag, privacy/run1.out).
- `session/models.js` (E): `modelStatus()` codes; `BUNDLED_MODEL` only in research builds.

### 7.2 Rule improvements (`app/src/events/rules.js`, `features.js`, `signal.js`)
Tuning data: synthetic generator (`tests/synth/swing.js`, extended with the stress modes below) + the owner set.
**GolfDB numbers are reported, never used to choose thresholds** (protocol §7.3).
1. EV-1 address: define address as the **last** still run (≥ 0.3 s, speed < still_speed) ending within 1.2 s
   before takeaway onset, where takeaway onset = the first sustained (≥ 80 ms) rise of the lead-hand speed above
   `0.6 × still→swing midpoint`, back-projected with the existing onset fit; reject waggle runs (hand oscillation
   with ≥ 2 zero-crossings of lateral velocity in the last 1.0 s) and forward press (≤ 0.1 torso drift toward target
   within 0.25 s). Address `conf` = f(still-run length, onset fit residual).
2. EV-2 finish: finish = first frame after impact + 0.15 s where body-set speed < still_speed for ≥ **0.25 s**
   (was 0.7 s), or, if the clip ends first, the frame of the minimum body-set speed in the last 0.5 s with
   conf ≤ 0.4; relaxation after finish (hands dropping) must not move finish later (take the first qualifying run).
3. EV-3 slow-mo baked exports: in `pipeline/clip.js` before events, if no swing at native time base and container
   fps ≤ 60 and duration ≥ 4 s, retry with time scale ÷4 and ÷8 (and use QuickTime `com.apple.quicktime.*` speed /
   capture-fps metadata when present via `import/probe.js` — D adds `probe.captureFpsHint`); accept the first scale
   that yields a swing with downswing 0.15–0.6 s; mark `SLOWMO_CORRECTED`, effective fps = container fps × scale.
4. EV-4 confidence calibration: replace ad-hoc conf with a per-event logistic map fitted on synthetic + owner
   tune split of `(features → |err| ≤ tol)`; constants in `events/calib-conf.json` (E) with provenance field
   `"fitted_on": ["synthetic-v2", "owner-tune"]`. Requirement: in each conf bin the empirical within-tolerance rate
   is within ±0.15 of the bin's mean conf (reliability check). toe_up conf no longer constantly < 0.5.
5. high_behind (EV-5, P2): use view-specific hand-speed axis (vertical image axis dominant) for onset.
6. DTL toe_up early (79 % early on the benchmark): toe_up = lead forearm parallel to ground proxy (shaft-angle from
   wrist→hand vector crossing horizontal) with the fraction fallback only when visibility < 0.5.

### 7.3 Validation protocol
- `tests/unit/events.rules.test.mjs` (E): synthetic suite 3 views × 8 modes (baseline, waggle, forward_press,
  short_tail, finish_relax, impact_dropout, slowmo_x8, low_visibility) × 40 seeds, 60 Hz and 240 Hz. Gates (per view;
  high_behind relaxed by 10 pp): swing found ≥ 98 % (slowmo_x8 included after EV-3); address/top/impact within 2
  frames @60 Hz ≥ 95 %; finish within 4 frames ≥ 90 % including short_tail and finish_relax; tempo ±0.3 ≥ 95 %.
  Today's stress run (events/stress.txt) fails slowmo_x8 (0/40), finish in short_tail/finish_relax (0 %) and
  high_behind address (63–78 %), so these gates are the acceptance criteria for E.
- Owner set (`scripts/eval_owner_set.mjs`, existing): split by **session** into tune (≤ 50 %) and holdout; gates on
  holdout once ≥ 20 labelled swings: Impact ±1 frame @60 Hz ≥ 0.90 (existing), address ±3 frames ≥ 0.80, tempo ±0.3
  ≥ 0.80, no regression vs baseline on common shots. Before 20 swings: report only.
- GolfDB (dev only, `training/eval_pce.py` / events/analyze.py style): may be run and printed by a
  `RESEARCH=1` script, outputs go to `training/runs/` (gitignored); never read by any test that gates a ship and
  never used to set constants. A unit test asserts no file under `app/` references `golfdb` (case-insensitive)
  except comments in `contract/enums.js` naming the event order convention (rename comment to "8 swing events").
- Reliability (EV-4): `scripts/check_event_conf.mjs` (E) computes the binned reliability on synthetic + owner tune
  and fails when any bin with n ≥ 20 deviates > 0.15.

### 7.4 Owner retraining
- Labelling UX (C, `ui/teach.js`): queue of unlabelled shots with clips; per event "正確 ✓" (accept detected, one
  tap) / "調整" (scrub + 設為這一幀), auto-advance to next event and next shot; progress "12 / 20 桿";
  `匯出訓練集` → one file `golf-swing-lab-labels/1` (shots' pose sequences + labels, no video) via share/download.
  Target ≤ 12 taps for a swing whose detections are all right (UX-10).
- Training (E, `training/train_owner.py` + `scripts/train_owner.sh`): input = the labels export(s); features via the
  existing `training/features.py` (feature_version unchanged); **initialised from scratch or from a model trained
  only on synthetic swings** (`training/synth_pretrain.py`), never from GolfDB weights; session-wise split;
  outputs `event-tcn-owner-<date>.{json,bin}` with model card fields `training_data: ["owner", "synthetic"]`,
  `golfdb: false`, owner-set holdout metrics, golden cases. `scripts/check_model_card.mjs` (E) rejects any card with
  `golfdb != false` or missing owner-holdout metrics for a non-research build. Import path in Settings › Developer
  stays (P9) and accepts only such cards.
- Docs: `docs/training.md` (E) rewritten: owner flow first, GolfDB section marked "research only, not shippable".

---

## 8. Work packages

Six packages run in parallel. **File ownership is exclusive**: a package writes only the paths listed for it, and it
may edit only the existing tests whose subject files it owns. Shared contracts are in §8.0. Package A ships
**drop 1 (contract freeze)** first, as the first commit of its branch, ideally within the first working block:
files with the frozen API and a working minimal implementation (t() with fallback, tokens, components, reason/error
code additions, empty screen CSS files, gate auto-discovery). The other packages code against §8.0 from the start
and rebase onto drop 1 when it lands. If drop 1 is late, they import the documented paths anyway, and their unit
tests use the injectable fakes the contract defines (`initI18n({fetchImpl})`, `createComponents(doc)`).

### 8.0 Cross-package contracts (FROZEN)
1. **i18n**: §3.2 API; catalogs §3.1; namespaces per package.
2. **Units**: `import { fmtMetric, convert, parseInput, unitLabel } from '../i18n/units.js'`.
   `fmtMetric(metricObj, settings.units) -> {value:string, unit:string, ci:string|null, text:string}`.
3. **Components** (`app/src/ui/components.js`, A): `button({label, variant, size, icon, reason, testid, onClick})`,
   `listRow({icon, title, value, onClick, testid})`, `segmented({options:[[v,label]], value, onChange, label})`,
   `switchRow({label, checked, onChange, testid})`, `metricTile({metric, size:'hero'|'compact', units})`,
   `validityTag(validity)`, `statePill({state:'ready'|'swinging'|'analysing'|'done'|'error', text})` → element with
   `.update(state, text)`, `notice({variant, title, items, collapsible})`, `emptyState({icon, title, body, action})`,
   `sheet({title, content, onClose}) -> {open(), close()}`, `confirmSheet({title, consequence, confirmLabel,
   destructive}) -> Promise<boolean>`, `filePicker({accept, multiple, label, testid, onFiles, variant:'button'|'zone'})`,
   `progressSteps({steps:[{id,label}]}) -> {set(id, state), eta(s), el}`, `chipRow({items, value, onChange})`,
   `screenHeader({title, back:true|false, onBack, actions})`, `icon(name)`.
   `toast.info(text)`, `toast.error(text, {slot?})` replace `toast()` (old `toast()` kept as alias to info until all
   callers migrate; removed by A at integration).
4. **App object** additions (A, `main.js`): `app.errors.report(err, ctx)`, `app.toast`, `app.t`, `app.units()`,
   `app.offline` (provided by D: `{ ready():boolean, progress():{done,total,bytes}, onProgress(fn) }`),
   `app.screenTitle(id)`, nav `go(screen, params, {opener})`.
5. **Settings schema** (A, `session/settings.js`, key bumps to `gsl-settings-v2` with v1 migration):
   `+ locale:'auto', units:{…}, theme:'auto', onboarding:{done_v:0}, live:{metrics:[...], voice:true},
   dev:false, sunSuggested:false`. CLUBS `[type, length_m]`.
6. **Status/messages**: every pure-module message is `{code, params}`; `store.status` is `{code, params}|null`.
7. **Reason & error codes** added by A in drop 1: RC `NO_CALIBRATION`, `CLIP_NOT_SAVED`, `SLOWMO_CORRECTED`; ERR
   `QUOTA_EXCEEDED`, `ANALYSIS_TIMEOUT`, `WORKER_CRASHED`, `WORKER_UNAVAILABLE`, `FILE_TRUNCATED`,
   `REPO_UNAVAILABLE`, `CAMERA_DENIED`, `CAMERA_BUSY`, `CAMERA_MISSING`, `NO_SWING_FOUND` (if not present). Catalog
   texts for `reason.*`/`error.*` written by A (B–F send A wording requests in their PR notes; A merges).
8. **Repo API** additions (D, `store/core.js`): `shots.softDelete(id)`, `shots.restore(id)`,
   `shots.purgeDeleted({olderThanMs})`, `shots.setStar(id, bool)`, `shots.list({includeDeleted=false})`,
   `labels.unlabelledWithClips()`, `repo.deleteAll()`; `saveShot()` returns `{ok, clipSaved, reason?}`.
9. **Controller** (D): `requestPermissions()` (same-click) → `{camera, microphone, motion}` each
   `'granted'|'denied'|'busy'|'missing'|'unsupported'`; `onStreamChange(fn)` fires after a reopen with the new
   `MediaStream`; `setClub(club)` used by the next live job; `analysisQueue` events `{queued, started, done, eta_s}`.
   Live screen (B) implements `attachStream(stream)`; main.js calls it (fixes R1 together).
10. **Probe** (D): `probe()` result adds `captureFpsHint|null`, `truncated:boolean`.
11. **Events** (E): `detectEvents()` signature unchanged; EventSet gains `meta.time_scale` (1|4|8) and calibrated
    `conf`; `pipeline/clip.js` result adds `reasons` including `NO_CALIBRATION`/`SLOWMO_CORRECTED`.
12. **Test hooks**: existing data-testids in `docs/e2e-hooks.md` MUST survive (FilePicker keeps the input
    testids). New testids declared now: `onb-next`, `onb-skip`, `onb-allow`, `setup-step` (with `data-step`),
    `setup-primary`, `camera-retry`, `camera-import-instead`, `live-state`, `live-hero`, `live-club`, `live-end`,
    `shot-hero`, `shot-unmeasured`, `event-chip`, `event-set-frame`, `event-undo`, `history-session`, `shot-star`,
    `shot-delete`, `undo-toast`, `teach-accept`, `teach-progress`, `import-queue`, `import-error-card`,
    `settings-locale`, `settings-units`, `settings-theme`, `privacy-delete-all`, `about-version`, `diag-save`,
    `tabbar-<id>`. e2e gates live in `tests/e2e/gates/<pkg>-<name>.mjs`, auto-discovered by `run.mjs` (A, drop 1).
13. **Shared e2e checks library** (A, `tests/e2e/checks.mjs`): `noHScroll(page)`, `minTargets(page, 44)`,
    `contrastOfRendered(page)`, `accessibleNames(page)`, `noCJK(page)` (en locale), `noSpecCodes(page)`,
    `focusOnH1(page)`, `screenshotSet(page, name, {widths:[320,390,430], themes:['light','dark','sun'],
    locales:['zh-Hant','en'], textScale:[1,2]})` writing to `$GSL_SHOTS_DIR`.

### WP-A — Foundation: design system, i18n core, app shell, build (owner: "foundation")
Goal: tokens, components, icons, i18n/units core, shell (top stack, tab bar, focus/title, global error handlers,
boot watchdog), CSP, build/precache/catalog merge, lints, contrast tests.
Owned paths: `app/styles/tokens.css` (new), `app/styles/app.css`, `app/styles/screens/` (creates empty files,
then hands `practice.css`→B, `results.css`→C, `settings.css`→F), `app/index.html`, `app/manifest.webmanifest`,
`app/src/main.js`, `app/src/state.js`, `app/src/version.js` (new, generated), `app/src/ui/dom.js`,
`app/src/ui/components.js` (new), `app/src/ui/icons.js` (new), `app/src/ui/format.js`, `app/src/i18n/**` (new:
`index.js`, `units.js`), `app/i18n/namespaces.json`, `app/i18n/{zh-Hant,en}/{app,common,screen,nav,unit,validity,
view,mode,club,event,metric,reason,error,a11y,time}.json`, `app/src/contract/reason-codes.js`,
`app/src/metrics/registry.js`, `app/src/session/settings.js`, `scripts/build.mjs`, `scripts/check_i18n.mjs`
(new), `scripts/check_tokens.mjs` (new), `scripts/verify.sh`, `scripts/deploy_pages.sh`, `scripts/check-sw.mjs`,
`tests/e2e/run.mjs`, `tests/e2e/lib.mjs`, `tests/e2e/checks.mjs` (new), `tests/e2e/screens.mjs`,
`tests/e2e/gates/a-*.mjs`, `tests/unit/{i18n.*,units.*,tokens.*,appcore.build,appcore.state,appcore.static,
appcore.helpers,metrics.registry}.test.mjs`, `docs/e2e-hooks.md`, `docs/design-system.md` (new),
`docs/i18n.md` (new), `docs/app-architecture.md`, `docs/interfaces.md`.
Closes: V06, V09 (component), V10 (style), V13, V14, V15, V16, V20, visual-m1, A11Y-1, A11Y-3, A11Y-4, A11Y-8
(components), I18N-1 (core + lint), I18N-2 (helpers), I18N-3 (units core), I18N-4, I18N-6 (helpers), A11Y-5
(toast/live-region API), R3 (boot side), R4, PV-1, PF-1 (modulepreload/lazy), EV-6 (build default), UX-15 (bars).
Acceptance (machine):
- `tests/unit/tokens.contrast.test.mjs`: parses `tokens.css` for light/dark/sun and asserts every pair in §1.4 ≥ its
  threshold (text 4.5, large text/UI 3.0); fails on any token pair added without a declared requirement.
- `scripts/check_tokens.mjs` (verify stage `tokens`): no hex colours or px font sizes outside `tokens.css`; no
  `transition`/`animation` outside a `prefers-reduced-motion: no-preference` block; no inline `style="` strings in
  app/src.
- `scripts/check_i18n.mjs` (stage `i18n`): passes for A's namespaces; whole-repo CJK-literal scan reports a count that
  must reach 0 at integration (gate turns from report to FAIL when all packages merged; flag `--strict`).
- `tests/unit/i18n.core.test.mjs`: fallback chain, plural en one/other, zh other, ListFormat, fmtDateTime renders
  `2026-11-04T23:30:00Z` as 11/5 07:30 in `Asia/Taipei` (TZ env), U+2212 minus, resolveLocale table.
- `tests/unit/units.test.mjs`: conversions to 1e-9 relative, CI scaling, digits table.
- e2e `a-shell`: every screen at 390 light/dark: `focusOnH1` after navigation; `document.title` changes; top stack never overlaps header
  (header rect top ≥ top-stack bottom after scrolling 700 px in setup); `noHScroll` at `html{font-size:200%}` for all
  10 screens; tab bar targets ≥ 44 px; `securitypolicyviolation` count 0 and a probe cross-origin fetch blocked;
  throwing in a click handler shows a `role=alert` toast and appends to diag `events[]`; IDB open stubbed to never
  resolve → error state with `重新載入` within 9 s.
- verify.sh wires new stages `tokens`, `i18n`, `event-conf` (E's script; `script_stage` SKIPs until it exists).
- build: `dist/i18n/zh-Hant.json` and `en.json` exist and are precached; default build has no `models/event-tcn-v1.*`;
  `index.html` has `<link rel=modulepreload>` entries; Fast-3G cold start ≤ 6 s in `tests/e2e/gates/a-coldstart.mjs`
  (throttled CDP, CPU ×4).
iPhone: Dynamic Type at AX sizes in standalone PWA; Sun theme legibility in direct sunlight; status-bar style;
reduced-motion system setting honoured.

### WP-B — Practice flow: onboarding, home, venue, setup, live (owner: "practice")
Goal: §2.2–§2.3 Practice/Venue/Setup/Live; stepper; tripod guidance; landscape; live scoreboard; club change;
camera-error states; R1 live re-attach.
Owned paths: `app/src/ui/onboarding.js` (new), `app/src/ui/home.js`, `app/src/ui/venue.js`, `app/src/ui/setup.js`,
`app/src/ui/live.js`, `app/src/ui/magnifier.js`, `app/src/ui/sensors.js`, `app/src/ui/tripod-diagram.js` (new),
`app/src/ui/venues.js` (new, venue list/edit used by Settings via `mountVenues(root, app)`), `app/src/session/bay.js`,
`app/src/calib/checks.js`, `app/styles/screens/practice.css`, `app/i18n/{zh-Hant,en}/{onboarding,home,venue,setup,
calib,live,bay,health,camera}.json`, `tests/unit/{calib.checks,ui.bay,ui.onboarding}.test.mjs`,
`tests/e2e/gates/b-*.mjs`, `docs/setup-guide.md`.
Closes: UX-02 (P0), R1 (live side, P0), V01/UX-06/I18N-5 (own files), V05, V07, V08, V10 (reason lines), V11, UX-01,
UX-03 (+R8 UI), UX-04, UX-07, UX-12, UX-14, UX-15 (live), ux-m1, ux-m3, visual-m2, a11y_i18n-m1, A11Y-5 (setup light
region, live summary), A11Y-6 (setup overlay, picker), A11Y-7 (setup view select), V22, R11 (onboarding UI).
Acceptance (machine):
- e2e `b-onboarding`: fresh context shows onboarding; `onb-skip` reaches home; completing all steps with fake media
  sets `onboarding.done_v`; permission rows show granted/denied states with `--use-fake-ui-for-media-stream` and a
  denied context.
- e2e `b-camera-denied`: denied camera → `camera-retry` and `camera-import-instead` visible; no setup controls
  rendered; import-instead lands on import.
- e2e `b-reopen` (R1): end video tracks, click reopen, assert `live.detections` (diag) increases within 20 s with the
  stand-in pose seam and the `<video>.srcObject` is the new stream.
- e2e `b-setup-steps`: `setup-step[data-step]` progresses 1→6 with the e2e seam; at 390×844 portrait and
  844×390 landscape the `setup-primary` button's rect is fully inside the viewport without scrolling (V05); the
  tripod step shows numbers that match `bayAdvice()` for the fixture venue (text contains formatted D and height).
- e2e `b-live-glance`: `live-hero` value element computed font-size ≥ 56 px at 390 px portrait and ≥ 15 vh at
  844×390; `live-state` has an icon + text, and its colour pair contrast ≥ 4.5; no element containing 碰了螢幕/touch;
  `live-club` change updates the next job's `club.type` (diag) without a new `getUserMedia` call.
- e2e `b-home`: `btn-start-practice` height ≥ 56 px and within viewport at 390×844; no select option text starts
  with `（`; no truncated text (`scrollWidth ≤ clientWidth` for every row value) at 320 px.
- All B screens pass `checks.noSpecCodes`, `minTargets(44)` (primaries 56), `accessibleNames`, `noCJK` in en,
  `noHScroll` at 200 %; `check_i18n` 100 % for B namespaces; screenshot set written for review.
- unit: `calib.checks` returns `{id, level, params}` only (no CJK); `bay` returns numbers + verdict.
iPhone: real permission prompts order and sticky-deny recovery path text; tripod diagram vs a real bay; live
readability at 2.7 m in sun and in a dim bay (owner reads the hero number); glove taps on the corner fine-adjust;
speechSynthesis voice in zh-TW and en; landscape on notch devices (safe areas); wake lock.

### WP-C — Results & data: import, shot card, replay/correction, history, compare, teach (owner: "results")
Goal: §2.3 Import/Results/History; teach (labelling) mode; batch import; persistent import errors; soft delete/star.
Owned paths: `app/src/ui/import.js`, `app/src/ui/shot.js`, `app/src/ui/replay.js`, `app/src/ui/history.js`,
`app/src/ui/teach.js` (new), `app/src/ui/compare.js` (new), `app/src/ui/glossary.js` (new),
`app/src/store/compare.js`, `app/src/store/labels.js`, `app/src/store/export.js`,
`app/styles/screens/results.css`, `app/i18n/{zh-Hant,en}/{import,shot,replay,history,compare,label,teach,
export}.json`, `tests/unit/{store.compare,store.labels,store.export,ui.timeline}.test.mjs`,
`tests/e2e/m2.mjs`, `tests/e2e/m6.mjs`, `tests/e2e/gates/c-*.mjs`.
Closes: V02, V03, V04, V12, V17, V18 (usage), V21 (catalog), V09 (import zone), UX-05, UX-08, UX-09, UX-10 (UI),
UX-11, UX-15 (import progress), UX-16 (clip delete flow), ux-m2, A11Y-2, a11y_i18n-m2, A11Y-6 (replay canvas),
A11Y-7 (A/B names), PF history virtualisation, I18N-2 (call sites in its files), V01/UX-06/I18N-5 (own files).
Acceptance (machine):
- e2e `c-shot-hero` (fixture `tests/fixtures/shots/valid_face_on_240.json` via history import): `shot-hero` has 3
  tiles above the fold at 390×844 (rect bottom ≤ 844); hero value font-size ≥ 44 px; unmeasured metrics are inside a
  collapsed `shot-unmeasured` disclosure whose summary contains the count; no "± 0.00"; no "第 0 版"; no raw club code
  (`7i`, `driver`) or `shot-` id in visible text; carry shows in yd by default and in m after switching units.
- e2e `c-timeline`: 8 markers' bounding boxes do not intersect each other or any text node below; arrow key on a
  focused marker changes its frame by 1 (aria-valuenow); `event-set-frame` sets a frame without drag; `event-undo`
  restores; leaving with unsaved edits opens a confirm sheet.
- e2e `c-labels`: label rows height ≤ 64 px at 390 px; event name element width ≥ 3 em; no glyph-per-line wrapping
  (name element `getClientRects().length == 1`) at 100 % and 200 % text.
- e2e `c-import-batch`: `import-file-input` has `multiple`; two fixture clips queue and both produce shots;
  `import-queue` shows ✓ per step; a garbage file renders a persistent `import-error-card` still visible after 10 s;
  pressing back mid-analysis opens a confirm sheet; a no-swing clip saves no shot.
- e2e `c-history`: 1000-shot export import → history open ≤ 500 ms (CPU ×4), DOM ≤ 1,500 nodes; rows grouped
  (`history-session` ≥ 1); delete → `undo-toast` → undo restores; star persists across reload; A/B buttons have
  accessible names with shot time.
- e2e `c-teach`: 3 fixture shots with clips → `teach-accept` × 8 completes a swing in ≤ 12 taps; `teach-progress`
  text updates; export produces a `golf-swing-lab-labels/1` file that `scripts/eval_owner_set.mjs` reads (exit 0).
- unit: compare notes and label errors are codes only; export JSON/CSV contain no localized text.
- Shared checks (`noSpecCodes`, `minTargets`, `accessibleNames`, `noCJK` en, `noHScroll` 200 %), check_i18n 100 % for
  C namespaces.
iPhone: Photos → Files multi-select share of 10 slow-mo clips and one batch import; `navigator.share({files})` of a
backup from the standalone PWA; swipe gesture vs iOS back-swipe conflicts; memory with 10 queued 240 fps clips.

### WP-D — Robustness & performance platform (owner: "platform")
Goal: §4 and §5 fixes in the runtime layers; crash log; offline progress; storage safety; worker resilience;
capture/recorder budgets.
Owned paths: `app/src/session/controller.js`, `app/src/session/health.js`, `app/src/session/thermal.js`,
`app/src/session/ids.js`, `app/src/store/core.js`, `app/src/store/idb.js`, `app/src/store/mem.js`,
`app/src/store/quota.js`, `app/src/workers/**`, `app/src/capture/**`, `app/src/import/**`, `app/src/pipeline/live.js`,
`app/src/pipeline/frames.js`, `app/src/pipeline/assemble.js`, `app/src/pose/**`, `app/src/diag/**`,
`app/src/ui/diag.js`, `app/src/ui/update.js`, `app/src/audio/**`, `app/src/sensors/**`, `app/sw.template.js`,
`app/i18n/{zh-Hant,en}/{session,storage,diag,update,offline}.json`, `tests/unit/{store.core,store.quota,
store.contract,store.static,media.*,appcore.controller,flows.health}.test.mjs`, `tests/e2e/m1.mjs`,
`tests/e2e/m5.mjs`, `tests/e2e/realpose.mjs`, `tests/e2e/gates/d-*.mjs`, `docs/device-checklist.md`.
Closes: R1 (controller side), R2, R3 (idb timeout), R4 (crash log), R5, R6/PF-3, R7, R8 (codes), R9, R10, R11/PF-1
(sw progress, persist), R12, PF-2 (queue/trim), PF-5, PV-2 (XHR/beacon guard), V19, worker model 404 (EV-6 part),
I18N-1 (own files: controller, quota, core, protocol), UX-15 (touch counter → diag).
Acceptance (machine):
- unit `store.quota`: QuotaExceededError on a batch with a clip → retried without clip, returns
  `{ok:true, clipSaved:false, reason:'CLIP_NOT_SAVED'}`; `lowSpace` set; mem backend simulates quota.
- e2e `d-quota` (CDP `Storage.overrideQuotaForOrigin` 4 MB, as in robustness/p2.mjs): import of
  `clip_240_vp9.mp4` stores 1 shot, 0 clips, and the card shows the CLIP_NOT_SAVED reason (C renders it).
- e2e `d-idb-hang`: stubbed `indexedDB.open` never firing → `#app-ready` set within 6 s with `repoReady=false`.
- e2e `d-worker-crash`: terminate the worker mid-import → client rejects with `WORKER_CRASHED`, a second import
  succeeds (worker recreated); a stalled `pose` call rejects with `ANALYSIS_TIMEOUT` (fake timer seam
  `__GSL_E2E__.workerDelayMs`).
- e2e `d-recorder`: 120 s idle live with the real fake camera → no segment > 12 s and total retained blobs ≤ 2
  (diag `recorder.segments`), renderer heap stable (heapMB growth ≤ 2 MB); live capture track settings width ≤ 1280.
- e2e `d-offline`: SW posts PRECACHE_PROGRESS messages with increasing `done`; `app.offline.ready()` true after
  completion; with `--no-bundled-model` no request to `models/event-tcn-v1.*` occurs (request log).
- e2e `d-trunc`: `trunc.mp4` (robustness/) → `FILE_TRUNCATED` error, not a silent pass.
- unit `media.protocol`: worker messages carry `{code, params, detail}` and no CJK.
- Diag screen: `diag-save` produces a JSON file containing `events[]` with the last error; summary rows have icons + text.
- Live latency: `tests/e2e/gates/d-latency.mjs` with the stand-in pose seam at CPU ×4 → shot-to-card ≤ 12 s median over
  5 swings; queue never > 2.
iPhone: real camera interruption (call, lock, app switch) recovery; 100-shot session memory (no tab reload by
jetsam); storage-full on device; persist() result in standalone; 720p capture still yields 240 fps high-speed path
unaffected (import only); thermal throttling behaviour.

### WP-E — Event detection without GolfDB (owner: "events")
Goal: §7: remove GolfDB from the product path, improve rules, calibrate confidence, validation protocol, owner
retraining pipeline.
Owned paths: `app/src/events/**`, `app/src/pipeline/clip.js`, `app/src/session/models.js`,
`app/src/contract/enums.js` (comment only), `app/i18n/{zh-Hant,en}/{model,events}.json`, `tests/synth/swing.js`,
`tests/unit/{events.*,flows.models,flows.eval,pipeline.*,metrics.tempo}.test.mjs`, `scripts/eval_owner_set.mjs`,
`scripts/check_model_card.mjs`, `scripts/check_model_parity.mjs`, `scripts/check_event_conf.mjs` (new),
`scripts/train_owner.sh` (new), `training/**`, `docs/training.md`, `docs/metrics-by-view.md` (rules section),
`docs/ADR/0004-no-golfdb-in-product.md` (new).
Closes: EV-1, EV-2, EV-3, EV-4, EV-5, EV-6 (pipeline/models), EV-7 (training side), UX-08 (`NO_CALIBRATION`,
no-swing → no shot in clip.js), I18N-1 (models.js).
Acceptance (machine):
- `tests/unit/events.rules.test.mjs`: the §7.3 synthetic gates (3 views × 8 modes × 40 seeds) all pass; a
  snapshot of today's failing modes (slowmo_x8, short_tail finish, finish_relax finish, high_behind address) is
  included so regressions are visible.
- `scripts/check_event_conf.mjs` (verify stage `event-conf`): reliability deviation ≤ 0.15 per bin (n ≥ 20).
- `tests/unit/events.no_golfdb.test.mjs`: grep `app/` (excluding `vendor/`) for `/golfdb|split1|event-tcn-v1/i` → only allowed
  hits (none in shipped code paths); `pipeline/clip.js` chooses rules when no owner model; an imported card with
  `golfdb: true` is rejected by `session/models.js` (non-research build).
- `scripts/eval_owner_set.mjs --split session`: holdout gates per §7.3 on the fixture labels set
  `tests/fixtures/owner/labels-fixture.json` (E creates a synthetic-derived fixture of 24 swings).
- `scripts/train_owner.sh --dry-run tests/fixtures/owner/labels-fixture.json` (RUN_TRAINING=1 stage) produces a json/bin
  + model card with `golfdb:false`, which `check_model_card.mjs` accepts and `session/models.js` imports in a unit
  test (golden reproduced ≤ 1e-4).
- clip pipeline unit: an import with no calibration emits `NO_CALIBRATION` (not `SETUP_UNVERIFIED`); a stretched ×8
  synthetic clip yields a shot with `SLOWMO_CORRECTED` and tempo within ±0.3.
iPhone: a real iPhone slow-mo clip shared via Files (does it carry capture-fps metadata, or is speed baked?) — the
owner records 5 clips each way; owner labels ≥ 20 swings for the first holdout run.

### WP-F — Settings, About, Privacy, Legal, Help (owner: "trust")
Goal: §2.3 Settings IA, Developer section, §6.4 content, glossary/FAQ, delete-all-data, language/units/theme pickers.
Owned paths: `app/src/ui/settings.js`, `app/src/ui/about.js`, `app/src/ui/privacy.js` (new), `app/src/ui/help.js`
(new), `app/src/ui/licences.js` (new), `app/src/ui/developer.js` (new; hosts model import/rollback, health counters,
drop test, timer, pose model, spec-code overlay), `app/styles/screens/settings.css`,
`app/i18n/{zh-Hant,en}/{settings,about,privacy,help,legal,licence}.json`, `tests/unit/ui.settings.test.mjs` (new),
`tests/e2e/m6.mjs` **excluded** (C), `tests/e2e/gates/f-*.mjs`, `docs/PRIVACY.md` (new), `docs/LICENCES.md` (new),
`README.md` (product section).
Closes: UX-13, V23, I18N-7, PV-3, V19 (entry point; diag screen is D), V16 (switches), V01/UX-06 (settings strings
incl. 事件模型（P9）, 儲存空間（P10）, persist label), R10 (UI for heavy model download), R11 (Settings eviction
notice), UX-16 (clip clean-up sheet in Storage), I18N-2 (settings.js:105 relative days).
Acceptance (machine):
- e2e `f-about`: `about-version` text equals `precache-manifest.version` formatted ("0.1.0 · build …"), never "dev";
  page text contains none of `GolfDB`, `非商業`, `non-commercial`, `CC BY-NC`; the licences screen shows the
  Apache-2.0 and BSD-3-Clause texts.
- e2e `f-privacy`: `privacy-delete-all` → confirm sheet → after confirm, IndexedDB has 0 shots and localStorage has
  no `gsl-*` keys and the app shows onboarding again.
- e2e `f-settings`: `settings-locale` = en → no CJK in any visible text on home, settings, about (shared `noCJK`);
  `settings-units` = m → carry in m on a fixture shot; `settings-theme` = sun → `data-theme="sun"` on html; developer
  section hidden until 7 taps on version; no spec codes outside the developer section with `settings.dev=false`.
- check_i18n 100 % for F namespaces; shared checks pass.
iPhone: delete-all clears data in the standalone PWA (and caches); legal text readable at large Dynamic Type.

### 8.7 Integration order and gates
1. A drop 1 lands (contracts). 2. B–F merge in any order; each PR must pass `bash scripts/verify.sh` plus its own
`RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only <pkg gates>`. 3. A integration commit: remove `toast()` alias,
switch `check_i18n --strict` (0 CJK literals in app/src) and `check_tokens --strict`. 4. Fresh-context acceptance
agent runs the full verify with `RUN_BROWSER_E2E=1`, generates the screenshot matrix (10 screens × 3 widths × 3
themes × 2 locales × text 1/2) and checks it against the explicit lists in each package (no overlap, no truncation,
no spec codes, hero sizes). 5. Owner iPhone pass from each package's "iPhone" list, recorded in
`docs/device-checklist.md`.

---

## 9. Not doing (with reasons)

| item | reason |
|---|---|
| Payments, accounts, cloud sync, analytics/telemetry | owner decision 2026-11-04 (local-only); privacy promise depends on zero network |
| Shipping or fine-tuning from GolfDB weights; GolfDB-tuned thresholds | owner decision (CC BY-NC); GolfDB stays dev benchmark (§7.3) |
| zh-Hans / other locales now | architecture supports them (drop-in catalogs); translation cost not justified before launch |
| Native iOS app / App Store wrapper | PWA is the decided platform; revisit after device feedback |
| Auto corner detection of the mat via ML | the stepper uses the existing calib + fine-adjust; auto-detect from refined solves is in scope, a new detector is not |
| Android-specific polish beyond "works in Chrome" | iPhone first per owner; Android gets the shared checks only |
| Heavy pose model in precache | +30.7 MB breaks the 35 MB precache budget; offered as on-demand download (R10) |
| WebKit automation on this machine | WebKit cannot launch here; replaced by the explicit iPhone lists |
| Rewriting physics/ball tracking accuracy | outside this round's findings; results honesty is handled by validity/nulls |
| Bundler (Vite etc.) | Node 18 + no-bundler rule (ADR 0001); modulepreload + lazy imports meet the cold-start budget |
| Open questions (OWNER-CONFIRM, block nothing): default units (yd/mph proposed), support contact text on About, app display name in English |

Every P0/P1 id in §0 maps to a package. This list contains none of them.

## 10. Resolved open items (2026-11-05)

Chosen defaults. The owner can change any of them later.

| item | decision |
|---|---|
| Default units | zh-Hant: distance **yd**, speed **mph**, body cm, club length in, height cm. en-US: the same, plus body in and height ft/in. Every unit can be switched in Settings. |
| English display name | **Golf Swing Lab**. zh-Hant stays 揮桿實驗室. |
| Support contact (About) | A link to the GitHub issues page: https://github.com/ahhshiba/golf-swing-lab/issues. It is a plain link the user taps; the app makes no request and sends no telemetry. |

