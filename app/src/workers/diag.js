// workers/diag.js - one guarded entry point for diagnostic measurements from media code (main thread or worker).
//
//   diagRecord(path, value)     never throws; forwards to the active sink
//   setDiagSink(fn | null)      worker: (path, value) => postMessage({ type: 'diag', path, value })
//   getDiagLog()                last 200 records (for tests / debugging)
//
// Default sink (main thread): app/src/diag/record.js record(path, value), loaded lazily; when that module is missing
// or fails to load the measurement is only kept in the local log (no-op). In a worker there is no localStorage and
// the report is built on the main thread, so vision.worker.js installs a postMessage sink and workers/client.js
// replays the messages into diag/record.js.

let sink = null;
let lazy = null; // Promise<fn | null>
const log = [];

function loadDefault() {
  if (!lazy) {
    lazy = import('../diag/record.js')
      .then((m) => (typeof m.record === 'function' ? m.record : null))
      .catch(() => null);
  }
  return lazy;
}

export function setDiagSink(fn) {
  sink = typeof fn === 'function' ? fn : null;
}

export function diagRecord(path, value) {
  try {
    log.push({ path, value });
    if (log.length > 200) log.shift();
    if (sink) { sink(path, value); return; }
    loadDefault().then((rec) => {
      try { if (rec) rec(path, value); } catch { /* diag must never break media code */ }
    });
  } catch {
    /* no-op */
  }
}

export function getDiagLog() {
  return log.slice();
}
