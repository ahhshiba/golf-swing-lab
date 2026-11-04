// ui/diag.js — P11 diagnostic report: shows buildReport() JSON (devtools' diag/report.js) and a copy button.

import { h, clear, card, toast, screenHeader } from './dom.js';

export function mountDiag(root, app) {
  async function report() {
    const mod = app.deps.diagReport;
    if (mod?.buildReport) return await mod.buildReport();
    return { schema: 'gsl-device-report/1', note: '診斷模組（diag/report.js）尚未安裝：以下是本機暫存的紀錄', app_version: app.version(), recorded: app.localDiag };
  }

  function render(json) {
    const pre = h('pre.report', { id: 'diag-json' }, json);
    const copy = h('button.primary.big', { type: 'button' }, '複製報告 JSON');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(json);
        toast('已複製，貼回開發機：node scripts/check_device_report.mjs r.json --milestone Mx');
      } catch (_) {
        const r = document.createRange();
        r.selectNodeContents(pre);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        toast('無法自動複製：已選取全文，請按「拷貝」');
      }
    });
    clear(root, screenHeader('診斷', () => app.nav.back()), copy, card('裝置報告', pre),
      h('button', { type: 'button', onclick: () => show() }, '重新產生'));
  }

  async function show() {
    clear(root, screenHeader('診斷', () => app.nav.back()), h('p', '產生報告中…'));
    let json;
    try { json = JSON.stringify(await report(), null, 2); } catch (e) { json = JSON.stringify({ error: String(e?.message ?? e) }, null, 2); }
    render(json);
  }

  return { show, hide() {} };
}
