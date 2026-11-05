// tests/e2e/checks.mjs — shared page checks for every package's e2e gates (PRODUCT-SPEC §8.0.13, FROZEN in drop 1).
// Each check returns data (never throws on a finding) so a gate decides what fails:
//   noHScroll(page)                 -> { ok, scrollWidth, clientWidth }
//   minTargets(page, min = 44)      -> { ok, offenders: [{ sel, text, w, h }] }  visible buttons/links/inputs/[role=…]
//                                      whose hit box (incl. ::before overlay is NOT measured) is below min in w or h
//   contrastOfRendered(page)        -> { ok, offenders: [{ sel, text, ratio, need, fg, bg }] } text vs effective bg
//   accessibleNames(page)           -> { ok, offenders: [{ sel, html }] } controls without an accessible name
//   noCJK(page)                     -> { ok, hits: [text] }    visible text with Han characters (en locale)
//   noSpecCodes(page)               -> { ok, hits: [text] }    visible text with spec ids / raw codes (§2.4)
//   focusOnH1(page)                 -> { ok, active }          document.activeElement is a visible <h1>
//   screenshotSet(page, name, { widths, themes, locales, textScale, base, fullPage }) -> [file]
//       writes $GSL_SHOTS_DIR/<name>-<w>-<theme>-<locale>-<scale>x.png (default dir: tests/e2e/.shots)
//   setTheme(page, theme), setLocale(page, base, locale), setTextScale(page, k)   helpers used by screenshotSet
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

export const SPEC_CODE_RE = /\b[PCK]\d{1,2}\b|\b[A-Z]{3,}_[A-Z_]+\b|\.mjs\b|sha-?256|golden|GolfDB|\btcn\b|shot-[0-9a-f]{6,}/;
const CONTROLS = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="switch"], [role="radio"], [role="slider"], [role="tab"], [role="checkbox"]';

export async function noHScroll(page) {
  return page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return { ok: el.scrollWidth <= el.clientWidth + 1, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
}

export async function minTargets(page, min = 44) {
  return page.evaluate(([sel, min]) => {
    const d = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.dataset && el.dataset.testid ? '[data-testid=' + el.dataset.testid + ']' : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    const off = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
      if (el.matches('input[type="file"]') || el.matches('.visually-hidden')) continue;
      // a control inside a label/row whose box is big enough counts as that box (switch inside switch-row, input in label)
      const host = el.closest('label, .switch-row, .list-row') || el;
      const hr = host.getBoundingClientRect();
      const w = Math.max(r.width, el.tagName === 'INPUT' ? hr.width : 0);
      const h = Math.max(r.height, el.tagName === 'INPUT' || el.getAttribute('role') === 'switch' ? hr.height : 0);
      if (w + 0.5 < min || h + 0.5 < min) off.push({ sel: d(el), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), w: Math.round(w), h: Math.round(h) });
    }
    return { ok: off.length === 0, offenders: off };
  }, [CONTROLS, min]);
}

export async function contrastOfRendered(page) {
  return page.evaluate(() => {
    const d = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.dataset && el.dataset.testid ? '[data-testid=' + el.dataset.testid + ']' : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
    function bgOf(el) {
      const stack = [];
      for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
      let c = { r: 255, g: 255, b: 255, a: 1 };
      const root = parse(getComputedStyle(document.body).backgroundColor);
      if (root && root.a >= 1 && !stack.some((s) => s.a >= 1)) c = root;
      for (const s of stack.reverse()) c = over(s, c);
      return c;
    }
    const off = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.data.trim()) continue;
      const el = t.parentElement;
      if (!el || seen.has(el) || el.closest('[hidden], [aria-hidden="true"], .visually-hidden, video, canvas')) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const fg0 = parse(cs.color);
      if (!fg0) continue;
      const bg = bgOf(el);
      const fg = over(fg0, bg);
      const [a, b] = [L(fg), L(bg)].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      const px = parseFloat(cs.fontSize);
      const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
      const need = large ? 3 : 4.5;
      if (ratio + 0.005 < need) off.push({ sel: d(el), text: t.data.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, need, fg: cs.color, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})` });
    }
    return { ok: off.length === 0, offenders: off };
  });
}

export async function accessibleNames(page) {
  return page.evaluate((sel) => {
    const d = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.dataset && el.dataset.testid ? '[data-testid=' + el.dataset.testid + ']' : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    const off = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect();
      if ((!r.width || !r.height) && !el.matches('input[type="file"]')) continue;
      let name = (el.getAttribute('aria-label') || '').trim();
      if (!name && el.getAttribute('aria-labelledby')) name = el.getAttribute('aria-labelledby').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
      if (!name && el.labels && el.labels.length) name = [...el.labels].map((l) => l.textContent).join(' ').trim();
      if (!name && !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) name = (el.textContent || '').trim();
      if (!name) name = (el.getAttribute('title') || el.getAttribute('placeholder') || '').trim();
      if (!name) off.push({ sel: d(el), html: el.outerHTML.slice(0, 120) });
    }
    return { ok: off.length === 0, offenders: off };
  }, CONTROLS);
}

async function visibleTexts(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const s = t.data.trim();
      if (!s) continue;
      const el = t.parentElement;
      if (!el || el.closest('[hidden], script, style, noscript, pre.report, [data-spec-overlay]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      out.push(s);
    }
    for (const el of document.querySelectorAll('[aria-label]')) if (!el.closest('[hidden]')) out.push(el.getAttribute('aria-label'));
    return out;
  });
}

export async function noCJK(page) {
  const hits = (await visibleTexts(page)).filter((s) => /[㐀-鿿豈-﫿]/.test(s));
  return { ok: hits.length === 0, hits };
}

export async function noSpecCodes(page) {
  const hits = (await visibleTexts(page)).filter((s) => SPEC_CODE_RE.test(s));
  return { ok: hits.length === 0, hits };
}

export async function focusOnH1(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    const ok = Boolean(a && a.tagName === 'H1' && a.getClientRects().length && !a.closest('[hidden]'));
    return { ok, active: a ? `${a.tagName.toLowerCase()}:${(a.textContent || '').trim().slice(0, 30)}` : null };
  });
}

export async function setTheme(page, theme) {
  await page.evaluate((th) => { if (th === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = th; }, theme);
}
/** Switch the running app's locale through its own i18n module (same module instance as the app). */
export async function setLocale(page, base, locale) {
  await page.evaluate(async ([b, l]) => { const m = await import(`${b}src/i18n/index.js`); await m.setLocale(l); }, [base, locale]);
}
export async function setTextScale(page, k) {
  await page.evaluate((s) => { document.documentElement.style.fontSize = s === 1 ? '' : `${s * 100}%`; }, k);
}

export async function screenshotSet(page, name, { widths = [320, 390, 430], themes = ['light', 'dark', 'sun'], locales = ['zh-Hant', 'en'], textScale = [1, 2], base = null, fullPage = true, height = 844 } = {}) {
  const dir = process.env.GSL_SHOTS_DIR || path.join(ROOT, 'tests', 'e2e', '.shots');
  fs.mkdirSync(dir, { recursive: true });
  const b = base ?? (await page.evaluate(() => document.baseURI.replace(/[^/]*$/, '')));
  const files = [];
  for (const loc of locales) {
    await setLocale(page, b, loc);
    for (const th of themes) {
      await setTheme(page, th);
      for (const k of textScale) {
        await setTextScale(page, k);
        for (const w of widths) {
          await page.setViewportSize({ width: w, height });
          await page.waitForTimeout(80);
          const f = path.join(dir, `${name}-${w}-${th}-${loc}-${k}x.png`);
          await page.screenshot({ path: f, fullPage });
          files.push(f);
        }
      }
    }
  }
  await setTextScale(page, 1);
  return files;
}
