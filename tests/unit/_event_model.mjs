// The GolfDB-derived event model (CC BY-NC) is kept out of the public repo; tests that need it skip on a clone.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));
export const HAVE_EVENT_MODEL = ['../../app/models/event-tcn-v1.json', '../../app/models/event-tcn-v1.bin',
  '../fixtures/event-tcn-v1.golden.json'].every((f) => existsSync(p(f)));
export const NO_MODEL_SKIP = HAVE_EVENT_MODEL ? false
  : 'GolfDB-derived event model not present (not in the public repo, CC BY-NC); train it with training/, see docs/training.md';
