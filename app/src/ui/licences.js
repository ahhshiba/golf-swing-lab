// ui/licences.js — Settings › About › Open-source licences (PRODUCT-SPEC §6.4). Catalog namespace `licence`.
// The full texts are the LICENSE files shipped with the app (vendor/*/LICENSE, precached), read with a same-origin
// fetch; the Lucide ISC text is short and embedded. Nothing leaves the device.
//
//   LICENCES                                  [{ id, file | text }]
//   renderLicences(ctx) -> { title, nodes }    ctx = { C, t, fetchImpl? }

/** ISC licence of Lucide (lucide.dev/license); the icon sprite is drawn in its style. */
const LUCIDE_ISC = `ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
`;

export const LICENCES = Object.freeze([
  Object.freeze({ id: 'mediapipe', file: 'vendor/mediapipe/LICENSE', spdx: 'Apache-2.0' }),
  Object.freeze({ id: 'mp4box', file: 'vendor/mp4box/LICENSE', spdx: 'BSD-3-Clause' }),
  Object.freeze({ id: 'icons', text: LUCIDE_ISC, spdx: 'ISC' }),
]);

async function loadText(fetchImpl, file) {
  try {
    const r = await fetchImpl(file);
    if (!r || !r.ok) return null;
    const s = await r.text();
    return s && s.trim() ? s : null;
  } catch (_) {
    return null;
  }
}

export function renderLicences(ctx) {
  const { C, t } = ctx;
  const { h } = C;
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const cards = LICENCES.map((l) => {
    const pre = h('pre', { class: 'licence-text', 'data-testid': `licence-text-${l.id}`, tabindex: '0', 'aria-label': t('licence.show') });
    const details = h('details', { class: 'licence-details' }, h('summary', { text: t('licence.show') }), pre);
    if (l.text) pre.textContent = l.text;
    else {
      pre.textContent = t('licence.loading');
      Promise.resolve(fetchImpl ? loadText(fetchImpl, l.file) : null).then((s) => { pre.textContent = s ?? t('licence.missing'); });
    }
    return h('section', { class: 'card licence-card', 'data-spdx': l.spdx },
      h('h2', { text: t(`licence.${l.id}.name`) }),
      h('p', { class: 'hint', text: t(`licence.${l.id}.what`) }),
      h('p', { class: 'licence-name', text: t(`licence.${l.id}.licence`) }),
      details);
  });
  return { title: t('licence.title'), nodes: [h('p', { class: 'trust-lead', text: t('licence.intro') }), ...cards] };
}
