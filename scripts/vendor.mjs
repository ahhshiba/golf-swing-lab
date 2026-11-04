#!/usr/bin/env node
// scripts/vendor.mjs - pinned, offline-capable vendoring of browser runtime dependencies.
//
//   node scripts/vendor.mjs --check   verify every manifest file exists with the right bytes + sha256 (exit 1 if not)
//   node scripts/vendor.mjs --fetch   download/extract MISSING files into place, then run --check
//   node scripts/vendor.mjs --list    print name / version / size totals from the manifest
//   node scripts/vendor.mjs --pin     maintainer mode: fill in null sha256/bytes/integrity by downloading (see ADR 0001)
//
// Options: --root DIR (repo root, default: parent of scripts/), --force (with --fetch: also re-fetch files whose
// bytes/sha256 are wrong), --help.
// Node >= 18, no dependencies. https only (redirects included). Every file is verified (sha256 + bytes) before it is
// written, and written via temp file + rename. Manifest: app/vendor/manifest.json (schema "gsl-vendor/1").
//
// A manifest file entry is { path, sha256, bytes } plus exactly one source:
//   tar_path  path inside the entry's npm tarball (entry.npm.tarball, verified against entry.npm.integrity), or
//   url       https URL of the file itself, or
//   generated repo path of the script that produces the file locally (e.g. training/export.py for the event model);
//             --check verifies it like any other file, --fetch cannot download it and says how to regenerate it.
// Writes are confined to app/vendor/ and app/models/.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_REL = 'app/vendor/manifest.json';
const ALLOWED_PREFIXES = ['app/vendor/', 'app/models/'];
const SCHEMA = 'gsl-vendor/1';
const MAX_BODY_BYTES = 256 * 1024 * 1024;
const USER_AGENT = 'golf-swing-lab-vendor/1';

// ---------- small helpers ----------

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');
const fmtMB = (n) => (n / 1e6).toFixed(3) + ' MB';
const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function die(msg, code = 2) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

function usage() {
  return [
    'usage: node scripts/vendor.mjs (--check | --fetch | --list | --pin) [--root DIR] [--force]',
    '  --check   verify all manifest files (exists, bytes, sha256); exit 1 and list problems otherwise',
    '  --fetch   download/extract missing files into place, then --check (--force: also re-fetch bad files)',
    '  --list    print name/version/size totals',
    '  --pin     maintainer: fill null sha256/bytes/integrity fields by downloading from the declared sources',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { mode: null, root: path.resolve(SCRIPT_DIR, '..'), force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check' || a === '--fetch' || a === '--list' || a === '--pin') {
      if (opts.mode && opts.mode !== a.slice(2)) die('only one of --check/--fetch/--list/--pin\n' + usage());
      opts.mode = a.slice(2);
    } else if (a === '--force') opts.force = true;
    else if (a === '--root') {
      if (!argv[i + 1]) die('--root needs a directory');
      opts.root = path.resolve(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(usage() + '\n');
      process.exit(0);
    } else die('unknown argument: ' + a + '\n' + usage());
  }
  if (!opts.mode) die(usage());
  return opts;
}

// ---------- manifest ----------

function loadManifest(root) {
  const p = path.join(root, MANIFEST_REL);
  let text;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch (e) {
    die(`cannot read manifest ${p}: ${e.message}`, 1);
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (e) {
    die(`manifest is not valid JSON (${p}): ${e.message}`, 1);
  }
  return { manifest, manifestPath: p };
}

function saveManifest(manifestPath, manifest) {
  atomicWrite(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
}

// Returns a list of problem strings (empty = structurally valid).
function validateManifest(manifest) {
  const probs = [];
  if (!manifest || typeof manifest !== 'object') return ['manifest: not an object'];
  if (manifest.schema !== SCHEMA) probs.push(`manifest.schema must be "${SCHEMA}"`);
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    probs.push('manifest.entries must be a non-empty array');
    return probs;
  }
  const seenPaths = new Set();
  manifest.entries.forEach((e, i) => {
    const tag = `entries[${i}]${e && e.name ? ' (' + e.name + ')' : ''}`;
    for (const k of ['name', 'version', 'license', 'source']) {
      if (typeof e?.[k] !== 'string' || !e[k]) probs.push(`${tag}: "${k}" must be a non-empty string`);
    }
    if (e?.npm !== undefined) {
      if (!isHttps(e.npm?.tarball)) probs.push(`${tag}: npm.tarball must be an https URL`);
      if (e.npm?.integrity !== null && !/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(e.npm?.integrity ?? '')) {
        probs.push(`${tag}: npm.integrity must be an SRI string or null`);
      }
    }
    if (!Array.isArray(e?.files) || e.files.length === 0) {
      probs.push(`${tag}: "files" must be a non-empty array`);
      return;
    }
    e.files.forEach((f, j) => {
      const ft = `${tag}.files[${j}]`;
      const pathProb = badPath(f?.path);
      if (pathProb) probs.push(`${ft}: path ${JSON.stringify(f?.path)} ${pathProb}`);
      else if (seenPaths.has(f.path)) probs.push(`${ft}: duplicate path ${f.path}`);
      else seenPaths.add(f.path);
      if (f?.sha256 !== null && !isHex64(f?.sha256)) probs.push(`${ft}: sha256 must be 64 lowercase hex or null`);
      if (f?.bytes !== null && !(Number.isInteger(f?.bytes) && f.bytes >= 0)) probs.push(`${ft}: bytes must be an integer >= 0 or null`);
      const hasTar = typeof f?.tar_path === 'string';
      const hasUrl = f?.url !== undefined;
      const hasGen = f?.generated !== undefined;
      if (hasGen && (typeof f.generated !== 'string' || !f.generated)) probs.push(`${ft}: generated must be a non-empty repo path`);
      if ([hasTar, hasUrl, hasGen].filter(Boolean).length !== 1) probs.push(`${ft}: exactly one of tar_path / url / generated is required`);
      if (hasTar && !e.npm) probs.push(`${ft}: tar_path needs an "npm" block on the entry`);
      if (hasUrl && !isHttps(f.url)) probs.push(`${ft}: url must be https`);
    });
  });
  return probs;
}

function isHttps(u) {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
}

// Reason string if the repo-relative path is not acceptable, else null.
function badPath(p) {
  if (typeof p !== 'string' || !p) return 'must be a non-empty string';
  if (p.includes('\\') || p.includes('\0') || p.startsWith('/')) return 'must be a relative posix path';
  if (p.split('/').some((s) => s === '..' || s === '.' || s === '')) return 'must not contain "..", "." or empty segments';
  if (!ALLOWED_PREFIXES.some((pre) => p.startsWith(pre))) return `must be under ${ALLOWED_PREFIXES.join(' or ')}`;
  if (p === MANIFEST_REL) return 'must not be the manifest itself';
  return null;
}

// ---------- filesystem ----------

function atomicWrite(dest, buf) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, buf, { mode: 0o644 });
    fs.renameSync(tmp, dest);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

// state: 'ok' | 'missing' | 'not_a_file' | 'unpinned' | 'bad'
function inspectFile(root, f) {
  const abs = path.join(root, f.path);
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return { state: 'missing', abs };
  }
  if (!st.isFile()) return { state: 'not_a_file', abs };
  if (f.sha256 === null || f.bytes === null) return { state: 'unpinned', abs, bytes: st.size };
  const buf = fs.readFileSync(abs);
  const digest = sha256Hex(buf);
  if (buf.length !== f.bytes || digest !== f.sha256) return { state: 'bad', abs, bytes: buf.length, sha256: digest };
  return { state: 'ok', abs, bytes: buf.length };
}

function describe(f, r) {
  switch (r.state) {
    case 'missing': return `MISSING   ${f.path}`;
    case 'not_a_file': return `NOT_A_FILE ${f.path}`;
    case 'unpinned': return `UNPINNED  ${f.path}  (manifest has no sha256/bytes yet; run --pin)`;
    case 'bad': {
      const parts = [];
      if (r.bytes !== f.bytes) parts.push(`bytes ${r.bytes} != ${f.bytes}`);
      if (r.sha256 !== f.sha256) parts.push(`sha256 ${r.sha256.slice(0, 16)}.. != ${f.sha256.slice(0, 16)}..`);
      return `MISMATCH  ${f.path}  ${parts.join(', ')}`;
    }
    default: return `OK        ${f.path}`;
  }
}

function listFilesRec(dir, out = []) {
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) listFilesRec(p, out);
    else out.push(p);
  }
  return out;
}

// ---------- check ----------

function runCheck(root, manifest, { quiet = false } = {}) {
  const problems = validateManifest(manifest).map((p) => 'MANIFEST  ' + p);
  let nFiles = 0;
  let nBytes = 0;
  const listed = new Set([path.join(root, MANIFEST_REL)]);
  if (problems.length === 0) {
    for (const e of manifest.entries) {
      for (const f of e.files) {
        nFiles++;
        listed.add(path.join(root, f.path));
        const r = inspectFile(root, f);
        if (r.state === 'ok') nBytes += r.bytes;
        // Locally generated files (e.g. the GolfDB-derived event model, kept out of the public repo) may be absent.
        else if (r.state === 'missing' && f.generated) {
          if (!quiet) process.stderr.write(`WARN      optional generated file absent: ${f.path} (${f.generated})\n`);
        } else problems.push(describe(f, r));
      }
    }
    // Unlisted files under the vendor dirs: warning only (other owners may add notes next to vendored code).
    for (const pre of ALLOWED_PREFIXES) {
      for (const abs of listFilesRec(path.join(root, pre))) {
        if (!listed.has(abs) && !abs.includes('.tmp-')) {
          if (!quiet) process.stderr.write(`WARN      unlisted file ${path.relative(root, abs).split(path.sep).join('/')}\n`);
        }
      }
    }
  }
  if (problems.length) {
    process.stderr.write(`vendor check FAILED: ${problems.length} problem(s)\n`);
    for (const p of problems) process.stderr.write('  ' + p + '\n');
    return { ok: false, problems, nFiles, nBytes };
  }
  if (!quiet) process.stdout.write(`vendor check OK: ${nFiles} files, ${nBytes} bytes (${fmtMB(nBytes)}) verified (sha256 + size)\n`);
  return { ok: true, problems, nFiles, nBytes };
}

// ---------- list ----------

function runList(manifest) {
  const probs = validateManifest(manifest);
  if (probs.length) {
    process.stderr.write('manifest invalid:\n' + probs.map((p) => '  ' + p).join('\n') + '\n');
    return 1;
  }
  const out = [];
  let tFiles = 0;
  let tBytes = 0;
  const nameW = Math.max(4, ...manifest.entries.map((e) => e.name.length));
  const verW = Math.max(7, ...manifest.entries.map((e) => e.version.length));
  out.push(`${'name'.padEnd(nameW)}  ${'version'.padEnd(verW)}  ${'license'.padEnd(12)}  ${'files'.padStart(5)}  ${'bytes'.padStart(11)}  size`);
  for (const e of manifest.entries) {
    const bytes = e.files.reduce((s, f) => s + (f.bytes ?? 0), 0);
    tFiles += e.files.length;
    tBytes += bytes;
    out.push(`${e.name.padEnd(nameW)}  ${e.version.padEnd(verW)}  ${e.license.padEnd(12)}  ${String(e.files.length).padStart(5)}  ${String(bytes).padStart(11)}  ${fmtMB(bytes)}`);
    for (const f of e.files) {
      out.push(`    ${f.path}  ${f.bytes === null ? '(unpinned)' : `${f.bytes} bytes  ${fmtMB(f.bytes)}`}`);
    }
  }
  out.push(`TOTAL ${manifest.entries.length} entries, ${tFiles} files, ${tBytes} bytes (${fmtMB(tBytes)}, decimal MB)`);
  process.stdout.write(out.join('\n') + '\n');
  return 0;
}

// ---------- network (https only) ----------

function httpsGetOnce(urlStr, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return reject(new Error('bad URL ' + urlStr));
    }
    if (u.protocol !== 'https:') return reject(new Error('refusing non-https URL ' + urlStr));
    const req = https.get(u, { headers: { 'user-agent': USER_AGENT, accept: '*/*' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, u).toString() });
      }
      const chunks = [];
      let n = 0;
      res.on('data', (c) => {
        n += c.length;
        if (n > MAX_BODY_BYTES) req.destroy(new Error('body too large'));
        else chunks.push(c);
      });
      res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout after ' + timeoutMs + ' ms')));
    req.on('error', reject);
  });
}

async function httpsGet(urlStr, { timeoutMs = 120000, attempts = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      let url = urlStr;
      for (let hop = 0; hop < 6; hop++) {
        const r = await httpsGetOnce(url, timeoutMs);
        if (r.redirect) {
          url = r.redirect; // httpsGetOnce rejects non-https on the next hop
          continue;
        }
        if (r.status === 200) return r;
        if (r.status >= 500 || r.status === 429) throw Object.assign(new Error(`HTTP ${r.status} for ${url}`), { retry: true });
        throw Object.assign(new Error(`HTTP ${r.status} for ${url}`), { retry: false });
      }
      throw Object.assign(new Error('too many redirects for ' + urlStr), { retry: false });
    } catch (e) {
      lastErr = e;
      if (e.retry === false || /refusing non-https|bad URL/.test(e.message)) break;
      if (attempt < attempts) await sleep(1000 * attempt);
    }
  }
  throw lastErr;
}

// ---------- npm tarball handling ----------

function verifySri(buf, sri) {
  const m = /^(sha256|sha384|sha512)-(.+)$/.exec(sri);
  if (!m) return false;
  return createHash(m[1]).update(buf).digest('base64') === m[2];
}

function sriOf(buf) {
  return 'sha512-' + createHash('sha512').update(buf).digest('base64');
}

function cstr(buf, off, len) {
  const slice = buf.subarray(off, off + len);
  const z = slice.indexOf(0);
  return slice.subarray(0, z === -1 ? slice.length : z).toString('utf8');
}

function parsePax(data) {
  const out = {};
  let i = 0;
  while (i < data.length) {
    const sp = data.indexOf(0x20, i);
    if (sp === -1) break;
    const len = parseInt(data.subarray(i, sp).toString('latin1'), 10);
    if (!(len > 0)) break;
    const rec = data.subarray(sp + 1, i + len - 1).toString('utf8'); // strip trailing \n
    const eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

// Minimal tar reader (ustar + pax + GNU long names). Returns Map<name, Buffer> of regular files.
function readTarGz(tgz) {
  const buf = zlib.gunzipSync(tgz);
  const files = new Map();
  let off = 0;
  let longName = null;
  let pax = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    // header checksum: sum of all bytes with the checksum field read as spaces
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    const want = parseInt(cstr(h, 148, 8).trim() || '-1', 8);
    if (sum !== want) throw new Error(`tar header checksum mismatch at offset ${off}`);
    if (h[124] & 0x80) throw new Error('tar base-256 sizes are not supported');
    const size = parseInt(cstr(h, 124, 12).trim() || '0', 8);
    const type = h[156] === 0 ? '0' : String.fromCharCode(h[156]);
    let name = cstr(h, 0, 100);
    if (cstr(h, 257, 5) === 'ustar') {
      const prefix = cstr(h, 345, 155);
      if (prefix) name = prefix + '/' + name;
    }
    const dataStart = off + 512;
    if (dataStart + size > buf.length) throw new Error('truncated tar');
    const data = buf.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / 512) * 512;
    if (type === 'x') { pax = parsePax(data); continue; }
    if (type === 'g') continue;
    if (type === 'L') { longName = cstr(data, 0, data.length); continue; }
    if (pax && pax.path) name = pax.path;
    if (longName) name = longName;
    pax = null;
    longName = null;
    if (type === '0' || type === '7') files.set(name, data);
  }
  return files;
}

async function getNpmTarball(entry, { allowUnpinnedIntegrity }) {
  process.stdout.write(`  download ${entry.npm.tarball}\n`);
  const { body } = await httpsGet(entry.npm.tarball);
  if (entry.npm.integrity === null) {
    if (!allowUnpinnedIntegrity) throw new Error(`${entry.name}: npm.integrity is null; run --pin first`);
  } else if (!verifySri(body, entry.npm.integrity)) {
    throw new Error(`${entry.name}: tarball integrity mismatch (got ${sriOf(body)}, manifest ${entry.npm.integrity})`);
  }
  return body;
}

// Independent integrity statement from the registry metadata (used only by --pin).
async function registryIntegrity(entry) {
  const m = /^npm:(.+)@([^@]+)$/.exec(entry.source);
  if (!m) throw new Error(`${entry.name}: source must look like "npm:<package>@<version>" for npm entries`);
  const url = `https://registry.npmjs.org/${m[1]}/${m[2]}`;
  const { body } = await httpsGet(url);
  const doc = JSON.parse(body.toString('utf8'));
  if (doc.name !== m[1] || doc.version !== m[2]) throw new Error(`${entry.name}: registry returned ${doc.name}@${doc.version}`);
  if (!doc.dist?.integrity) throw new Error(`${entry.name}: registry document has no dist.integrity`);
  return doc.dist.integrity;
}

// ---------- fetch / pin ----------

// mode 'fetch': only fill files that are missing (or bad with --force); verify against the manifest.
// mode 'pin'  : only handle files whose sha256/bytes are null (and npm.integrity null); record what was obtained.
async function fetchOrPin(root, manifest, { mode, force }) {
  const probs = validateManifest(manifest);
  if (probs.length) {
    process.stderr.write('manifest invalid:\n' + probs.map((p) => '  ' + p).join('\n') + '\n');
    return { errors: probs.length, changed: false };
  }
  let errors = 0;
  let changed = false;
  for (const entry of manifest.entries) {
    const todo = [];
    for (const f of entry.files) {
      const r = inspectFile(root, f);
      if (mode === 'pin') {
        if (f.sha256 === null || f.bytes === null) todo.push(f);
      } else if (r.state === 'missing' && !f.generated) todo.push(f);
      else if (force && (r.state === 'bad' || r.state === 'not_a_file')) todo.push(f);
    }
    const needIntegrity = mode === 'pin' && entry.npm && entry.npm.integrity === null;
    if (todo.length === 0 && !needIntegrity) continue;
    process.stdout.write(`${mode === 'pin' ? 'pin' : 'fetch'} ${entry.name}@${entry.version} (${todo.length} file(s))\n`);
    try {
      let tarFiles = null;
      const needTar = todo.some((f) => f.tar_path !== undefined) || needIntegrity;
      if (needTar) {
        const tgz = await getNpmTarball(entry, { allowUnpinnedIntegrity: mode === 'pin' });
        if (mode === 'pin' && entry.npm.integrity === null) {
          const claimed = await registryIntegrity(entry);
          const actual = sriOf(tgz);
          if (claimed !== actual) throw new Error(`${entry.name}: registry integrity ${claimed} != downloaded ${actual}`);
          entry.npm.integrity = actual;
          changed = true;
          process.stdout.write(`  npm integrity ${actual} (matches registry metadata)\n`);
        }
        tarFiles = readTarGz(tgz);
      }
      for (const f of todo) {
        let data;
        if (f.generated !== undefined) {
          throw new Error(`${f.path}: generated locally, cannot be downloaded; regenerate it with ${f.generated}`);
        } else if (f.tar_path !== undefined) {
          data = tarFiles.get(f.tar_path);
          if (!data) throw new Error(`${f.path}: ${f.tar_path} not found in tarball`);
        } else {
          process.stdout.write(`  download ${f.url}\n`);
          data = (await httpsGet(f.url)).body;
        }
        const digest = sha256Hex(data);
        if (mode === 'fetch') {
          if (data.length !== f.bytes || digest !== f.sha256) {
            throw new Error(`${f.path}: downloaded content does not match the manifest (bytes ${data.length} vs ${f.bytes}, sha256 ${digest} vs ${f.sha256}); nothing written`);
          }
        } else {
          f.sha256 = digest;
          f.bytes = data.length;
          changed = true;
        }
        atomicWrite(path.join(root, f.path), Buffer.from(data.buffer, data.byteOffset, data.length));
        process.stdout.write(`  wrote ${f.path} (${data.length} bytes, sha256 ${digest.slice(0, 16)}..)\n`);
      }
    } catch (e) {
      errors++;
      process.stderr.write(`ERROR     ${entry.name}@${entry.version}: ${e.message}\n`);
    }
  }
  return { errors, changed };
}

// ---------- main ----------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { manifest, manifestPath } = loadManifest(opts.root);
  switch (opts.mode) {
    case 'list':
      process.exit(runList(manifest));
      break;
    case 'check':
      process.exit(runCheck(opts.root, manifest).ok ? 0 : 1);
      break;
    case 'fetch': {
      const { errors } = await fetchOrPin(opts.root, manifest, { mode: 'fetch', force: opts.force });
      const res = runCheck(opts.root, manifest);
      process.exit(errors === 0 && res.ok ? 0 : 1);
      break;
    }
    case 'pin': {
      const { errors, changed } = await fetchOrPin(opts.root, manifest, { mode: 'pin', force: false });
      if (changed) {
        saveManifest(manifestPath, manifest);
        process.stdout.write(`manifest updated: ${path.relative(opts.root, manifestPath)}\n`);
      }
      const res = runCheck(opts.root, manifest);
      process.exit(errors === 0 && res.ok ? 0 : 1);
      break;
    }
    default:
      die(usage());
  }
}

main().catch((e) => {
  process.stderr.write(`vendor.mjs: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
