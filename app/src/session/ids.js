// session/ids.js — ids and timestamps for records created on the device (not used by pure modules).

let counter = 0;

/** Unique id with a prefix: crypto.randomUUID when available, else time + counter. */
export function newId(prefix, env = globalThis) {
  const c = env.crypto;
  if (c && typeof c.randomUUID === 'function') return `${prefix}-${c.randomUUID()}`;
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** ISO-8601 timestamp of now. */
export function nowIso() {
  return new Date().toISOString();
}
