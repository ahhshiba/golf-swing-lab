# Design system "Range" (owner: foundation, PRODUCT-SPEC §1; FROZEN in drop 1)

Files: `app/styles/tokens.css` (every raw value), `app/styles/app.css` (base + shared components),
`app/styles/screens/{practice,results,settings}.css` (owned by B, C, F; linked from `index.html` after app.css),
`app/src/ui/components.js`, `app/src/ui/icons.js`, `app/src/ui/dom.js` (legacy helpers). Tests:
`tests/unit/tokens.contrast.test.mjs`, `tests/unit/appcore.components.test.mjs`, e2e gate `a-contracts`.

## 1. Rules for screen CSS

- Tokens only: no hex/rgb colours, no `px` font sizes (use `font: var(--t-…)` or `font-size: var(--fs-…)`).
  Spacing in px on the 4 px grid is fine, but prefer `var(--s-…)`.
- `transition` / `animation` only inside `@media (prefers-reduced-motion: no-preference)`; animate transform and
  opacity only.
- No `:hover`-only affordances. Targets ≥ `--hit-min` (44 px); primary actions `--hit-primary` (56 px); live screen
  `--hit-live` (64 px); unrelated targets ≥ 8 px apart.
- Colour is never the only carrier: every state has a glyph or text.

## 2. Tokens (`tokens.css`)

Type (font shorthands for `font:`; sizes `--fs-*` for size-only uses; Dynamic Type via `html { font:
-apple-system-body }`, so everything is rem):

| token | size / line | weight | use |
|---|---|---|---|
| `--t-hero` | 3.5rem / 1.07 (× `--hero-scale`) | 800 | live scoreboard number; landscape `--fs-hero-landscape` = `clamp(3.5rem, 15vh, 7rem)` |
| `--t-display` | 3rem / 1.08 (× `--hero-scale`) | 700 | shot hero tiles |
| `--t-title1` | 1.75rem / 1.214 | 700 | screen large title (h1) |
| `--t-title2` | 1.375rem / 1.273 | 700 | state pill, sheet titles, compact tile value |
| `--t-headline` | 1.0625rem / 1.412 | 600 | row primary, card title |
| `--t-body` | 1.0625rem / 1.5 | `--weight-body` | body |
| `--t-callout` | 0.9375rem / 1.467 | `--weight-body` | secondary row text |
| `--t-footnote` | 0.8125rem / 1.385 | `--weight-body` | hints, CI, meta |
| `--t-caption` | 0.75rem / 1.333 | 600 | tags, units, section headers |

`--fs-input: max(16px, 1rem)` for inputs/selects/buttons (no iOS focus zoom). `--unit-scale: .45em` for a metric unit
next to its value. `--font`, `--font-mono`.

Spacing `--s-1 4 · --s-2 8 · --s-3 12 · --s-4 16 · --s-5 20 · --s-6 24 · --s-8 32 · --s-10 40` (px). Sizes
`--hit-min 44`, `--hit-primary 56`, `--hit-live 64`, `--row-min 52`. Radii `--r-sm 8`, `--r-md 14`, `--r-lg 22`,
`--r-pill`. `--border-control` (1 px; 2 px in sun), `--border-focus` 3 px. Layout `--max-content 760px`,
`--gutter-left/right = max(16px, safe-area)`, `--safe-top`, `--safe-bottom`, `--topbar-h`, `--tabbar-h` (set by
main.js once the top stack / tab bar exist). Motion `--dur-fast 120ms`, `--dur-base 220ms`, `--dur-slow 400ms`,
`--dur-live 180ms`, `--ease-out`, `--ease-spring` (bubble level only).

Colours (values per theme in tokens.css; every pair below is asserted ≥ 4.5 for text and ≥ 3.0 for UI in light, dark and
sun by `tests/unit/tokens.contrast.test.mjs`; a new colour token without a declared pair fails that test):

| token | role |
|---|---|
| `--bg`, `--surface`, `--surface-2` | page, cards, raised controls / disabled fill base |
| `--text`, `--text-2`, `--text-3` | primary, secondary, tertiary/placeholder (all ≥ 4.5 on bg/surface/surface-2) |
| `--control-border`, `--control-border-2` | input / button borders (on surface, on surface-2) |
| `--separator` | decorative hairlines only (exempt) |
| `--accent`, `--on-accent`, `--accent-tint` | primary fill + its text; tinted button fill |
| `--info` | estimated values, focus ring |
| `--signal-go/-caution/-stop` + `--on-go/-caution/-stop` | state fills and their text; caution fills carry a 1.5 px `--warn-text` border |
| `--danger-text`, `--warn-text` | destructive / warning text |
| `--fill-disabled`, `--text-disabled` | disabled controls (no opacity) |
| `--tint-info/-caution/-error` | Notice backgrounds (text on them is `--text`) |
| `--tag-{valid,est,low,null}-{fg,bg}` | ValidityTag |
| `--toast-bg`, `--toast-fg`, `--media-bg`, `--on-media`, `--scrim` | toast, video stages, sheet backdrop |
| `--shadow-card`, `--shadow-sheet`, `--card-border` | elevation (dark: surface contrast only; sun: none + 2 px border) |

Themes: `:root` = light; `:root[data-theme="dark"]`; `:root[data-theme="sun"]` (white/black, 2 px borders, body weight
500, `--hero-scale 1.15`, no tints or shadows). `settings.theme = 'auto'|'light'|'dark'|'sun'`; main.js sets
`<html data-theme>` for the explicit ones (`app.applyTheme(theme)`, also on `app.updateSettings`). With `auto` there is no
attribute and the media queries pick dark (`prefers-color-scheme: dark`) or sun (`prefers-contrast: more`); those blocks
repeat the explicit values exactly (unit test). The live screen sets `data-live-theme="dark"` on its root unless the
theme is sun.

### 2a. Launch-monitor tokens (LAUNCH-MONITOR-SPEC §4.2, LM-A drop 1)

`--fs-metric-xl` (`clamp(max(44px, 2rem), 11.3vw, 3.5rem)` × `--hero-scale`: ≥ 44 px at 390 px, grows with the width; the floor follows rem (64 px at 200 %) so numbers stay bigger than their
labels), `--fs-metric`, `--t-metric` (sun 800); `--tile-bg`, `--tile-border` (+ `--tile-border-color`; sun 2 px);
`--viz-bg`, `--viz-axis`, `--viz-grid`, `--viz-text`, `--viz-series-1…8` (club series, `CLUBS` order; every series also
has a glyph), `--viz-ci-alpha` (sun 0: outline instead of fill), `--viz-target`, `--viz-tracer`, `--viz-tracer-halo`.
Canvas code reads them only through `viz/palette.js` `vizPalette(el)`; `check_tokens` rule `js-hex-colour` flags hex
literals in `src/viz/**` and `src/ui/**` (WARN until integration). Data screens (shot, stats, gapping, drill) are dark
while the theme is auto.

## 3. Components (`app/src/ui/components.js`)

`createComponents(doc, { t, timers })` binds a document (tests: `tests/unit/_fakedom.mjs` `fakeDocument()`,
`fakeTimers()`); the named exports bind `globalThis.document` on first use. Every component returns DOM and is styled by
app.css classes only.

| call | returns / behaviour |
|---|---|
| `button({ label, variant, size, icon, reason, testid, onClick, disabled, type, id, block })` | `<button class="btn btn-<variant> btn-<size>">`. variant `primary·secondary·tinted·plain·destructive`, size `md 44·lg 56·xl 64`. `reason` (string) disables it and shows the reason line inside the button (V10: a disabled primary always says why). `.setReason(text|null)`, `.setDisabled(bool)`, `.setLabel(text)`. Pressed: scale .97 + brightness .94; focus: 3 px `--info` ring. |
| `listRow({ icon, title, value, subtitle, onClick, testid, chevron })` | whole-row `<button class="list-row">` (52 px; 28 px leading icon; trailing value + chevron in one `.lr-end` box, so with large text they wrap together to the right; a row without a value has a bare right-aligned chevron), `<div>` without onClick. Group rows in `<div class="list-group">`. `.setValue(v)` |
| `segmented({ options: [[v, label]], value, onChange, label, testid })` | `role=radiogroup` of `role=radio` buttons (≥ 44 px), arrow keys move; `.value` get/set (set does not fire onChange) |
| `chipRow({ items: [[v, label]], value, onChange, label, testid })` | same semantics, horizontally scrolling pill chips with scroll-snap |
| `switchRow({ label, checked, onChange, testid, hint })` | row with a 51×31 `role=switch` button (`aria-checked`); `.checked`, `.control` (has the testid) |
| `validityTag(validity)` | `<span class="vtag">` glyph + word: ● valid, ◐ estimated, ▲ low confidence, — not measurable. ◐ is drawn as a CSS half disc (the text stays in the DOM; fonts drew it like ‹ at caption size); a ◐ in running text goes in `span.glyph-est` |
| `metricTile({ metric, size: 'hero'|'compact', units, id, label })` | caption label (`metric.<id>.label`) + ValidityTag, value (`--t-display` hero / `--t-title2` compact) + unit, `± ci` footnote (hidden when it rounds to 0); null → `—` and `.is-null`. Uses `fmtMetric`. |
| `statePill({ state, text, testid })` | persistent `role=status aria-live=polite`; states `ready ✓ · swinging ● · analysing ◌ · done ✓ · error ✕`; `.update(state, text)` |
| `notice({ variant: 'info'|'caution'|'error', title, items, body, collapsible, testid })` | 4 px left bar on a tint; `collapsible` → `<details>`; error → `role=alert` |
| `emptyState({ icon, title, body, action: { label, onClick, testid } | Element, testid })` | 48 px icon, headline, callout, one tinted button |
| `sheet({ title, content, onClose, testid })` | `{ el, backdrop, open(), close(result), isOpen() }`: bottom sheet (r-lg top, grabber, max 90 dvh), `role=dialog aria-modal`, focus moves in and is trapped, Esc / backdrop / close button close it, focus returns to the opener |
| `confirmSheet({ title, consequence, confirmLabel, cancelLabel, destructive, testid })` | `Promise<boolean>`; replaces `confirm()`. The safe action is primary; a destructive confirm is red. Buttons `data-testid` `confirm-yes` / `confirm-no` (or `<testid>-confirm` / `<testid>-cancel`) |
| `filePicker({ accept, multiple, label, testid, onFiles, variant: 'button'|'zone', id, hint })` | `<label>` with a visually hidden `<input type=file>` that keeps `testid` and `id` (e2e hooks survive); `.input`; zone variant = 160 px dashed drop area |
| `progressSteps({ steps: [{ id, label }], testid, onCancel, cancelLabel })` | `{ el, set(id, 'pending'|'active'|'done'|'error'), eta(seconds|null), reset() }`; ✓ marks, `aria-current=step`, ETA line `t('common.eta')` |
| `screenHeader({ title, back, onBack, backLabel, actions })` | sticky header; `button.back` = chevron + `backLabel` (default 返回 / Back; pass the previous screen's title); `<h1 tabindex=-1>` |
| `icon(name, { label })` | `<svg class="icon"><use href="#i-<name>"></svg>`, `aria-hidden` unless labelled |
| `toast.info(text, { action: { label, onClick, testid }, testid, ms })` | `#toast` (`role=status`, polite), hides after `4000 + 60 ms × chars` |
| `toast.error(text, { slot, testid })` | `#toast-alert` (`role=alert`), stays until its 44 px Close; also appends the text to `slot` (element or selector), e.g. the current screen's error area |
| `toast.hide()` | hides both |

`ui/dom.js`: `toast(text)` is a DEPRECATED alias of `toast.info` (removed at integration); `toast.info/error/hide` are
also reachable from it. `screenHeader(title, onBack)` (legacy signature) renders the new header. `select()` shows
`t('club.<type>')` for a numeric club label (transitional, for screens still using the v1 CLUBS shape).

`app` object (main.js): `app.toast` (= the components toast), `app.errors.report(err, { where, silent, slot })` →
normalised `{ code, params, detail, stack, where, screen, at }`, appended to `app.errors.log()` (ring of 200) and to diag
(diag record `errors.last`, and every `app.errors.onReport(fn)` sink — platform attaches its crash-log ring there), shown as `toast.error(t('error.<code>'))` unless
`silent`; never throws. Global `error` / `unhandledrejection` handlers call it with `where: 'global'`.

## 4. Icons (`app/src/ui/icons.js`)

One inline sprite injected at boot (`injectSprite()`), 24 px grid, 1.75 stroke, `currentColor`, drawn in-house in the
Lucide style. Names: chevron-left, chevron-right, chevron-down, camera, camera-off, film, film-off, history, settings,
info, target, level, sun, lock, play, pause, step-back, step-forward, flag, ruler, trash, download, upload, share,
check, alert, x, star, star-filled, undo, mic-off, tripod, phone-landscape, phone-portrait, help, shield, club, plus,
external-link. Ask foundation for new ones.

## 5. Focus and titles (A11Y-1)

On every screen change main.js sets `document.title = t('screen.<id>.title') + ' – ' + t('app.name')` and, after the
screen's `show()` resolves, focuses the screen's `<h1>` (adds `tabindex=-1` if missing). Going back focuses the element
that opened the screen when it still exists (captured automatically, or passed as `nav.go(id, params, { opener })`),
else the `<h1>`. Screens should render a single `<h1>` (use `screenHeader`).

## 6. e2e checks (`tests/e2e/checks.mjs`)

`noHScroll`, `minTargets(page, 44)`, `contrastOfRendered`, `accessibleNames`, `noCJK`, `noSpecCodes`, `focusOnH1`,
`screenshotSet(page, name, { widths, themes, locales, textScale })` (writes to `$GSL_SHOTS_DIR`), plus `setTheme`,
`setLocale`, `setTextScale`. Each returns data (`{ ok, offenders | hits }`); the gate decides. See docs/e2e-hooks.md.

## 7. Shell layout (WP-A)
- Top stack `#top-stack` (sticky, one wrapper): update banner, repo banner, session bar, health prompts. Its height is
  `--topbar-h`; `.screen-header` sticks at `max(var(--topbar-h), var(--safe-top))`. A scrim covers the notch strip.
- Tab bar `#tabbar` (fixed bottom, 56 px targets + safe area). Its height is `--tabbar-h` (0 when hidden). Pinned bottom
  actions use `bottom: calc(var(--s-2) + var(--safe-bottom) + var(--tabbar-h))`.
- Lints: `scripts/check_tokens.mjs` (hex colours / px font sizes only in tokens.css, motion only inside
  `prefers-reduced-motion: no-preference`, no inline style strings). 200 % text: base rules wrap long words
  (`overflow-wrap`), clamp media to 100 %, and let `.row` / grid children shrink (`min-width: 0`).
- Sun theme: `settings.theme = 'sun'` → `<html data-theme="sun">`; `auto` + `prefers-contrast: more` uses the same
  tokens. The browser `theme-color` follows the chosen theme's `--bg`.
