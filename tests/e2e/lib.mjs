// Shared helpers for the Playwright e2e gates (Chromium; WebKit variants where it launches; headless, local server only).
import fs from 'node:fs';
import { chromium, webkit } from 'playwright';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'generated');
export const PREFIX = '/golf-swing-lab/';

export class Skip extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'Skip';
  }
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.setTimeout(1000, () => { req.destroy(); resolve(0); });
  });
}

/** Start scripts/devserve.py on a free 127.0.0.1 port. -> { baseUrl, stop() } */
export async function startServer(distDir) {
  const port = await freePort();
  const py = process.env.PYTHON || 'python3';
  const child = spawn(py, ['-I', path.join(ROOT, 'scripts', 'devserve.py'), '--bind', '127.0.0.1', '--port', String(port), '--root', distDir, '--prefix', PREFIX],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const baseUrl = `http://127.0.0.1:${port}${PREFIX}`;
  const t0 = Date.now();
  for (;;) {
    if (exited) throw new Error(`devserve.py exited early:\n${log}`);
    const code = await probe(baseUrl);
    if (code > 0 && code < 500) break;
    if (Date.now() - t0 > 15000) { child.kill(); throw new Error(`devserve.py did not answer on ${baseUrl} within 15 s:\n${log}`); }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { baseUrl, port, stop: () => new Promise((r) => { if (exited) return r(); child.once('exit', r); child.kill('SIGTERM'); setTimeout(r, 2000); }) };
}

/** Page helper: read/reset the diag record inside the page (same module instance as the app, same URL). */
export const diag = {
  async get(page, base, pathStr) {
    return page.evaluate(async ([b, p]) => (await import(`${b}src/diag/record.js`)).get(p === null ? undefined : p), [base, pathStr]);
  },
  async reset(page, base) {
    return page.evaluate(async (b) => (await import(`${b}src/diag/record.js`)).reset(), base);
  },
  async report(page, base) {
    return page.evaluate(async (b) => (await import(`${b}src/diag/report.js`)).buildReport(), base);
  },
};

export async function waitFor(fn, { timeout = 30000, interval = 200, what = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() - t0 > timeout) throw new Error(`timeout after ${timeout} ms waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Attach collectors: uncaught page errors and requests that leave 127.0.0.1 (the app must be fully local). */
export function watchPage(page) {
  const w = { errors: [], external: [] };
  page.on('pageerror', (e) => w.errors.push(String(e && e.message ? e.message : e)));
  page.on('request', (r) => {
    const u = r.url();
    if (/^https?:/.test(u) && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) w.external.push(u);
  });
  return w;
}

export function need(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function fixturePath(name) {
  return path.join(FIXTURES, name);
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function hookMissing(testid, why) {
  return new Error(`missing UI hook [data-testid="${testid}"] (${why}); see docs/e2e-hooks.md`);
}

/**
 * Wait for [data-testid=testid]; `fallbacks` are CSS selectors for what the app already has today (ids, text), so the
 * gates work before every testid exists. A missing hook fails with the testid name.
 */
export async function testidOrFail(page, testid, why, timeout = 15000, fallbacks = []) {
  const sel = [`[data-testid="${testid}"]`, ...fallbacks].join(', ');
  const loc = page.locator(sel).first();
  try {
    await loc.waitFor({ state: 'attached', timeout });
  } catch {
    throw hookMissing(testid, why);
  }
  return loc;
}

/** Click the first element matching the testid or fallbacks if one exists right now; returns whether it clicked. */
export async function clickIfPresent(page, testid, fallbacks = []) {
  const loc = page.locator([`[data-testid="${testid}"]`, ...fallbacks].join(', ')).first();
  if (await loc.count()) {
    await loc.click();
    return true;
  }
  return false;
}

/**
 * The fixture MP4 for `which` ('h264' | 'vp9') from clip_240.json, or a Skip when the machine has no ffmpeg that can make
 * it (then M2 is NOT verified and the runner says so). Missing fixtures on a machine WITH ffmpeg are a FAIL.
 */
export async function mp4Fixture(which) {
  const truthFile = fixturePath('clip_240.json');
  const truth = fs.existsSync(truthFile) ? readJson(truthFile) : null;
  const file = truth && truth.files && truth.files[which] ? fixturePath(truth.files[which]) : null;
  if (truth && file && fs.existsSync(file)) return { truth, file };
  const { findFfmpeg } = await import('../../scripts/make_fixtures.mjs');
  const ff = findFfmpeg();
  if (!ff || (which === 'vp9' && !ff.vp9)) {
    throw new Skip(`no ffmpeg with ${which === 'vp9' ? 'libvpx-vp9' : 'libx264'} on this machine ($FFMPEG, PATH, imageio-ffmpeg in $GSL_PY), so the ${which} MP4 fixture cannot be generated: M2 is NOT verified here`);
  }
  throw new Error(`fixture ${which} MP4 missing although ffmpeg (${ff.exe}) exists: run node scripts/make_fixtures.mjs`);
}


export const BROWSERS = Object.freeze({ chromium, webkit });

/** Short reason why a non-Chromium browser cannot start here (missing host packages / shared libraries). */
export function launchProblem(e) {
  const m = String(e && e.message ? e.message : e);
  if (/missing dependencies/i.test(m)) {
    const pk = [...new Set([...m.matchAll(/\b(lib[a-z0-9][a-z0-9.+-]*?)\\?\s*║/g)].map((x) => x[1]))];
    return `host is missing system packages ${pk.join(', ') || '(see playwright install-deps)'} (playwright install-deps needs sudo; not done here)`;
  }
  const so = [...new Set([...m.matchAll(/(lib[\w.+-]+\.so[\w.]*): cannot open shared object/g)].map((x) => x[1]))];
  if (so.length) return `missing shared libraries ${so.join(', ')}`;
  if (/Executable doesn't exist/i.test(m)) return 'browser not installed (npx playwright@1.49.1 install webkit)';
  return m.split('\n').slice(0, 3).join(' ');
}

/** ldd over Playwright WebKit's WPE MiniBrowser bundle (with its own lib dirs on LD_LIBRARY_PATH): unresolved .so names. */
export function missingSharedLibs(type) {
  try {
    const root = path.join(path.dirname(type.executablePath()), 'minibrowser-wpe');
    const libDirs = ['lib', 'sys/lib'].map((d) => path.join(root, d)).filter((d) => fs.existsSync(d));
    const files = [path.join(root, 'bin', 'MiniBrowser'), ...libDirs.flatMap((d) => fs.readdirSync(d).filter((f) => /\.so/.test(f)).map((f) => path.join(d, f)))];
    const out = new Set();
    for (const f of files) {
      const r = spawnSync('ldd', [f], { encoding: 'utf8', env: { ...process.env, LD_LIBRARY_PATH: libDirs.join(':') } });
      for (const m of String(r.stdout).matchAll(/^\s*(\S+) => not found/gm)) out.add(m[1]);
    }
    return [...out].sort();
  } catch {
    return [];
  }
}

/**
 * Launch ctx.browser ('chromium' default, or 'webkit'). Chromium-only `args` are dropped for other browsers. A
 * browser other than Chromium that cannot start on this machine is a Skip with the exact reason, never a pass.
 */
export async function launch(ctx = {}, opts = {}) {
  const name = (ctx && ctx.browser) || 'chromium';
  const type = BROWSERS[name];
  if (!type) throw new Error(`unknown browser ${name}`);
  const o = { headless: true, ...opts };
  if (name !== 'chromium') delete o.args;
  try {
    return await type.launch(o);
  } catch (e) {
    if (name === 'chromium') throw e;
    const so = name === 'webkit' ? missingSharedLibs(type) : [];
    throw new Skip(`${name} does not launch here: ${launchProblem(e)}${so.length ? `; ldd: ${so.join(', ')} not found` : ''}`);
  }
}

/** Does this page's WebCodecs decode H.264 (avc1 High 4.2)? Playwright's Chromium: no (no proprietary codecs). */
export async function supportsH264(page) {
  return page.evaluate(async () => {
    if (typeof VideoDecoder === 'undefined') return false;
    try { return (await VideoDecoder.isConfigSupported({ codec: 'avc1.64002A', codedWidth: 1280, codedHeight: 720 })).supported; } catch { return false; }
  });
}
