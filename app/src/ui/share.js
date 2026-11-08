// ui/share.js — the share sheet: colours, layout, card, lines, face mask → "make video" (progress + cancel) → preview →
// a SECOND tap shares (navigator.share needs a fresh user activation) or downloads (V04-SPEC §D.2). Calls
// app.loadStyles('share') before it opens. Lazy; owner V4-E.
//
//   openShareSheet(app, { kind: 'shot'|'session'|'round', shot?, clipBlob?, poseSeq?, shots?, filter?, round?, playerId? })
//     -> Promise<void> (resolves when the sheet closes)
//     shot: the tracer clip (share/compose.js) when this browser can record and the shot has a saved clip (clipBlob /
//     poseSeq are read from app.repo when not given), plus the picture card; session / round: the picture card.
//     Choices are saved in settings.share (share/settings.js normalizeShare). Nothing is stored: the blob is dropped
//     when the sheet closes.
//   registerShareStates(app)  app.e2e states shot:share (the sheet open) and shot:share_ready (a picture card made, the
//     share button showing) for tests/e2e/screenshot_matrix.mjs; the caller (main.js / ui/shot.js) registers them.
// testids: share-sheet, share-ball-colour / share-club-colour (radio groups of swatches), share-layout, share-opt-card,
// share-opt-lines, share-opt-face, share-opt-mark, share-make, share-progress, share-cancel, share-status,
// share-preview, share-send, share-download, share-make-card, share-card-preview, share-card-send, share-card-download.
import { h, clear } from './dom.js';
import * as C from './components.js';
import { t } from '../i18n/index.js';
import { saveSettings } from '../session/settings.js';
import { shareOrDownload, fileStamp } from './history.js';
import { normalizeShare, TRAIL_IDS } from '../share/settings.js';
import { composeShotVideo, videoSupport, clipExtension } from '../share/compose.js';
import { drawShotCard, drawSessionCard, drawRoundCard, cardPalette } from '../share/card.js';

const ERROR_KEYS = Object.freeze({
  VIDEO_UNSUPPORTED: 'share.unsupported_video', NO_CLIP: 'share.no_clip', CLIP_UNREADABLE: 'share.decode_failed',
  TOO_LARGE: 'share.too_large', CANCELLED: 'share.cancelled',
});

/** Swatch radio group for one trail; the colour of the other trail is disabled (ball ≠ club). */
function colourGroup({ label, value, taken, onChange, testid }) {
  const g = h('div.share-swatches', { role: 'radiogroup', 'aria-label': label, 'data-testid': testid });
  const btns = TRAIL_IDS.map((id) => h('button.share-swatch', {
    type: 'button', role: 'radio', 'data-colour': id, 'aria-label': t(`share.colour.${id}`), title: t(`share.colour.${id}`),
  }, h(`span.share-swatch-dot.swatch-${id}`, { 'aria-hidden': 'true' })));
  let cur = value;
  let other = taken;
  const paint = () => btns.forEach((b, i) => {
    const id = TRAIL_IDS[i];
    b.setAttribute('aria-checked', id === cur ? 'true' : 'false');
    b.tabIndex = id === cur ? 0 : -1;
    b.disabled = id === other;
    b.setAttribute('aria-label', id === other ? `${t(`share.colour.${id}`)} · ${t('share.colour_taken')}` : t(`share.colour.${id}`));
  });
  btns.forEach((b, i) => {
    b.addEventListener('click', () => { if (TRAIL_IDS[i] === other) return; cur = TRAIL_IDS[i]; paint(); onChange(cur); });
    b.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      let j = i;
      do { j = (j + dir + btns.length) % btns.length; } while (TRAIL_IDS[j] === other);
      btns[j].focus();
      btns[j].click();
    });
  });
  g.append(...btns);
  g.setTaken = (id) => { other = id; paint(); };
  paint();
  return h('div.share-field', {}, h('p.share-field-label', { 'aria-hidden': 'true' }, label), g);
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') { reject(new Error('toBlob unavailable')); return; }
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('empty card'))), 'image/png');
  });
}

/** A made result (preview + share button) scrolled into the sheet's view: it would otherwise sit below the options. */
function reveal(el, media) {
  const go = () => { try { el.scrollIntoView({ block: 'nearest', behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch (_) { /* old engines */ } };
  if (media && !media.complete && media.tagName === 'IMG') media.addEventListener('load', go, { once: true }); else go();
}

async function loadShotMedia(app, opts) {
  const id = opts.shot?.shot_id;
  let clipBlob = opts.clipBlob ?? null;
  let poseSeq = opts.poseSeq ?? null;
  if (!clipBlob && id && app.repo?.clips) {
    try { clipBlob = (await app.repo.clips.list({ index: 'shot_id', query: id }))[0]?.blob ?? null; } catch (_) { clipBlob = null; }
  }
  if (!poseSeq && id && app.repo?.poses) {
    try { poseSeq = (await app.repo.poses.get(id)) ?? null; } catch (_) { poseSeq = null; }
  }
  return { clipBlob, poseSeq };
}

async function shareBlob(blob, name, outEl, testid) {
  const r = await shareOrDownload(blob, name, outEl, { title: t('share.file_title') });
  if (r === 'link') outEl.querySelector('a')?.setAttribute('data-testid', testid);
  return r;
}

export async function openShareSheet(app, opts = {}) {
  try { await app.loadStyles?.('share'); } catch (_) { /* unstyled is still usable */ }
  const kind = ['shot', 'session', 'round'].includes(opts.kind) ? opts.kind : 'shot';
  let settings = normalizeShare(app.settings?.()?.share);
  const save = (patch) => {
    settings = normalizeShare({ ...settings, ...patch });
    try { const s = saveSettings({ share: settings }); app.updateSettings?.(s); } catch (_) { /* private mode */ }
  };
  const urls = new Set();
  const objectUrl = (blob) => { const u = URL.createObjectURL(blob); urls.add(u); return u; };
  let abort = null;
  const body = h('div.share-body');

  // ---------------------------------------------------------------- tracer clip (shot only)
  if (kind === 'shot') {
    const media = await loadShotMedia(app, opts);
    const sup = videoSupport();
    const reason = !sup.ok ? t('share.unsupported_video') : !media.clipBlob ? t('share.no_clip') : null;
    const status = h('p.share-status', { 'data-testid': 'share-status', role: 'status', 'aria-live': 'polite' });
    const progress = h('progress.share-progress', { max: '1', value: '0', 'data-testid': 'share-progress', hidden: true, 'aria-label': t('share.making') });
    const result = h('div.share-result', { hidden: true });
    const outEl = h('div.share-out');
    let made = null;
    const ball = colourGroup({ label: t('share.ball_colour'), value: settings.ballColour, taken: settings.clubColour, testid: 'share-ball-colour', onChange: (id) => { save({ ballColour: id }); club.querySelector('[role=radiogroup]').setTaken(id); } });
    const club = colourGroup({ label: t('share.club_colour'), value: settings.clubColour, taken: settings.ballColour, testid: 'share-club-colour', onChange: (id) => { save({ clubColour: id }); ball.querySelector('[role=radiogroup]').setTaken(id); } });
    const layout = C.segmented({ options: [['portrait', t('share.layout.portrait')], ['landscape', t('share.layout.landscape')]], value: settings.layout, label: t('share.layout'), testid: 'share-layout', onChange: (v) => save({ layout: v }) });
    const sw = (key, label, tid) => C.switchRow({ label, checked: settings[key], testid: tid, onChange: (v) => save({ [key]: v }) });
    const cancel = C.button({ label: t('share.cancel'), variant: 'secondary', testid: 'share-cancel', onClick: () => abort?.abort() });
    cancel.hidden = true;
    const send = C.button({ label: t('share.send'), variant: 'primary', size: 'lg', block: true, icon: 'share', testid: 'share-send', onClick: async () => {
      if (!made) return;
      await shareBlob(made.blob, `golf-swing-lab-tracer-${fileStamp()}.${clipExtension(made.mime)}`, outEl, 'share-download');
    } });
    const video = h('video.share-preview', { 'data-testid': 'share-preview', controls: true, muted: true, playsinline: true, loop: true, 'aria-label': t('share.preview') });
    video.muted = true;
    result.append(video, send, outEl);
    const make = C.button({ label: t('share.make'), variant: 'primary', size: 'lg', block: true, testid: 'share-make', reason: reason ?? undefined, onClick: async () => {
      abort = new AbortController();
      make.setDisabled(true);
      cancel.hidden = false;
      progress.hidden = false;
      progress.value = 0;
      result.hidden = true;
      clear(outEl);
      status.textContent = t('share.making');
      try {
        made = await composeShotVideo({
          shot: opts.shot, clipBlob: media.clipBlob, poseSeq: media.poseSeq, opts: settings, units: app.units?.(), signal: abort.signal,
          onProgress: (p) => { progress.value = p; },
        });
        video.src = objectUrl(made.blob);
        result.hidden = false;
        status.textContent = made.notes.includes('lines_failed') ? `${t('share.ready')} ${t('share.lines_unavailable')}` : t('share.ready');
        result.dataset.mime = made.mime;
        result.dataset.duration = String(made.duration_s);
        result.dataset.bytes = String(made.bytes);
        reveal(result);
      } catch (e) {
        made = null;
        status.textContent = t(ERROR_KEYS[e?.code] ?? 'share.failed');
        if (e?.code !== 'CANCELLED') app.record?.('share.last_error', String(e?.code ?? e?.message ?? e));
      } finally {
        abort = null;
        make.setDisabled(false);
        cancel.hidden = true;
        progress.hidden = true;
      }
    } });
    body.append(
      C.notice({ variant: 'info', title: t('share.privacy_note'), testid: 'share-privacy' }),
      h('h3.share-section', {}, t('share.video_section')),
      ball, club,
      h('div.share-field', {}, layout),
      sw('card', t('share.card'), 'share-opt-card'),
      sw('lines', t('share.lines'), 'share-opt-lines'),
      sw('faceMask', t('share.face_mask'), 'share-opt-face'),
      sw('appMark', t('share.app_mark'), 'share-opt-mark'),
      make, h('div.share-progress-row', {}, progress, cancel), status, result,
    );
  }

  // ---------------------------------------------------------------- picture card (every kind)
  const cardOut = h('div.share-out');
  const cardResult = h('div.share-result', { hidden: true });
  const img = h('img.share-card-preview', { 'data-testid': 'share-card-preview', alt: t('share.card_preview') });
  let cardBlob = null;
  const cardSend = C.button({ label: t('share.send'), variant: 'primary', size: 'lg', block: true, icon: 'share', testid: 'share-card-send', onClick: async () => {
    if (cardBlob) await shareBlob(cardBlob, `golf-swing-lab-card-${fileStamp()}.png`, cardOut, 'share-card-download');
  } });
  cardResult.append(img, cardSend, cardOut);
  const cardStatus = h('p.share-status', { role: 'status', 'aria-live': 'polite' });
  const makeCard = C.button({ label: t('share.make_card'), variant: kind === 'shot' ? 'secondary' : 'primary', size: 'lg', block: true, testid: 'share-make-card', onClick: async () => {
    const canvas = document.createElement('canvas');
    const palette = cardPalette(body);
    const units = app.units?.();
    let r;
    try {
      if (kind === 'shot') r = drawShotCard(canvas, { shot: opts.shot, units, palette, locale: app.locale?.() });
      else if (kind === 'session') r = drawSessionCard(canvas, { shots: opts.shots ?? [], filter: opts.filter ?? {}, units, palette });
      else r = drawRoundCard(canvas, { round: opts.round, playerId: opts.playerId, palette, units });
      cardBlob = await canvasBlob(canvas);
    } catch (e) {
      cardStatus.textContent = t('share.failed');
      app.record?.('share.last_error', String(e?.code ?? e?.message ?? e));
      return;
    }
    img.src = objectUrl(cardBlob);
    img.alt = r.a11y || t('share.card_preview');
    img.dataset.width = String(canvas.width);
    img.dataset.height = String(canvas.height);
    img.dataset.kind = r.params.kind;
    cardResult.hidden = false;
    clear(cardOut);
    cardStatus.textContent = t('share.card_ready');
    reveal(cardResult, img);
  } });
  body.append(h('h3.share-section', {}, t('share.card_section')), makeCard, cardStatus, cardResult);

  return new Promise((resolve) => {
    const s = C.sheet({
      title: t('share.title'), content: body, testid: 'share-sheet',
      onClose: () => {
        abort?.abort();
        for (const u of urls) URL.revokeObjectURL(u);
        urls.clear();
        resolve();
      },
    });
    s.el.classList.add('share-sheet');
    s.open();
  });
}

/** app.e2e states for the screenshot matrix (shot screen shown with a shot): the sheet open, and a card ready. */
export function registerShareStates(app) {
  const open = async (a) => {
    const shots = (await a.repo?.shots?.list?.().catch?.(() => [])) ?? [];
    const shot = shots.find((s) => s.capture?.view === 'face_on' && s.tracks) ?? shots[0];
    openShareSheet(a, { kind: 'shot', shot });
    for (let i = 0; i < 100 && !document.querySelector('[data-testid="share-sheet"]'); i++) await new Promise((r) => setTimeout(r, 50));
  };
  app.e2e?.registerState('shot', 'share', open);
  app.e2e?.registerState('shot', 'share_ready', async (a) => {
    await open(a);
    document.querySelector('[data-testid="share-make-card"]')?.click();
    const im = () => document.querySelector('[data-testid="share-card-preview"]');
    for (let i = 0; i < 100 && (im()?.closest('[hidden]') || !im()?.complete); i++) await new Promise((r) => setTimeout(r, 50));
    im()?.closest('.share-result')?.scrollIntoView({ block: 'nearest' }); // as reveal(), without the smooth scroll the screenshot would catch mid-way
  });
}
