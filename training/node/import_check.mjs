#!/usr/bin/env node
// training/node/import_check.mjs — import a trained owner model the way the app does (session/models.js
// validateEventModel + importEventModel into an in-memory store): fingerprint, shapes, model card, golden ≤ 1e-4.
//   node training/node/import_check.mjs M.json        exit 0 = imported, 1 = rejected
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { validateEventModel, importEventModel, activeEventModel, sha256Hex } from '../../app/src/session/models.js';
import { openRepository } from '../../app/src/store/core.js';
import { MemBackend } from '../../app/src/store/mem.js';

const jp = process.argv[2];
const json = JSON.parse(fs.readFileSync(jp, 'utf8'));
const b = fs.readFileSync(jp.replace(/\.json$/, '.bin'));
const bin = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const check = await validateEventModel(json, bin, { sha256: (x) => sha256Hex(x, webcrypto.subtle) });
if (!check.ok || check.golden !== 'pass') {
  console.log(`import_check: REJECTED ${JSON.stringify(check.problems)} golden=${check.golden}`);
  process.exit(1);
}
const repo = await openRepository(new MemBackend());
await importEventModel(repo, { json, bin, check, imported_at: '2026-11-05T00:00:00Z', file_names: [jp] });
const a = await activeEventModel(repo);
console.log(`import_check: imported ${a.version} (golden ${check.golden}, worst ${check.worst.toExponential(2)}, card golfdb=${a.card.golfdb}, gate passed=${a.card.owner_holdout.gate.passed})`);
