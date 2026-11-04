// store — local-only persistence (venues, presets, sessions, shots, poses, clips), export/import, comparison, quota.
//
// API summary (signatures only; data types in docs/interfaces.md section 4, reason codes in section 9):
//
// core.js   (pure)
//   openRepository(backend, { version?, stores?, migrations? }) -> Promise<Repository>
//   Repository: get(store, id) -> rec|null   put(store, rec) -> id   putMany(store, recs)   delete(store, id)
//     list(store, { index?, query? /* key | { gte, gt, lte, lt } */, limit?, reverse? }) -> rec[]   count(store)
//     clear(store?)   batch([{ op: 'put', store, record } | { op: 'delete', store, id }])
//     transaction(storeNames, 'readonly'|'readwrite', async (tx) => ...)  tx = { get, put, delete, getAll, getAllByIndex, clear }
//     snapshot(storeNames) -> { [store]: rec[] }   merge({ [store]: recs }) -> { [store]: { added, updated, kept } }
//     queryShots({ session_id, preset_id, venue_id, view, club_type, lie, from, to, starred, limit, reverse }) -> shots
//     deleteShot(shotId) -> { shot, pose, clips }   close()
//     shortcuts per store: repo.shots.get / put / putMany / delete / list / count (same for the other stores)
//   STORE_DEFS, STORE_NAMES, SCHEMA_VERSION, DB_NAME, MIGRATIONS, StoreError(code, message)
//   makeClipRecord({ clip_id, shot_id, session_id, created_at, blob, mime?, starred?, kind? }) -> clip record
//   filterShots(shots, filter) matchesShotFilter sortShots revisionOf getPath compareKeys isValidKey
// mem.js    new MemBackend({ name? })              in-memory backend (Node tests)
// idb.js    idbBackend({ name?, factory?, keyRange? })   IndexedDB backend (browser; lookups happen at open())
//     usage:  const repo = await openRepository(idbBackend());
// export.js
//   exportJSON(repo, filter?) -> Promise<{ format, exported_at, app_version, venues, presets, sessions, shots, poses?, clips? }>
//       filter = shot filter keys + { includePoses, includeClips, includeLabels, app_version, now }
//   importJSON(repo, dataOrText, { validate? }) -> Promise<{ ok, counts, total, validator, warnings, message }> | rejects ImportError
//   exportCSV(shots, { bom? }) -> string      CSV_COLUMNS, CSV_FIXED_COLUMNS, EXPORT_FORMAT, ImportError(message, details)
//   builtinShotValidator(shot) normalizeValidation(result) resolveDefaultValidator() csvField(v)
//   encodeTyped(value) decodeTyped(value)
// compare.js (pure)
//   compareShots(a, b) / compareSets(listA, listB) -> { kind, a, b, like_for_like, warnings, notes, metrics }
//   tCritical95(df)
// quota.js
//   planCleanup({ usage, quota, clips, practiceActive?, protectShotIds?, highWater?, lowWater?, highBytes?, lowBytes?,
//                 minFreeBytes? }) -> plan      policyClips(clipRecords) isDeletableClip(clip, protectedShotSet)
//   requestPersist(nav?) -> Promise<{ supported, persisted, requested, usage, quota, error }>   (never throws)
//   estimateStorage(nav?) -> Promise<{ supported, usage, quota }>   DEFAULT_POLICY
// metric-ids.js   METRIC_IDS (interfaces.md section 9 order)
// labels.js (pure) makeLabelRecord({ shot_id, events, labelled_at, fps, previous? }) validateLabel(rec) LABEL_SOURCE LabelError
//   (schema v2 stores: labels[shot_id] owner annotations P14, models[slot] imported event models P9)

export * from './core.js';
export * from './mem.js';
export * from './idb.js';
export * from './export.js';
export * from './compare.js';
export * from './quota.js';
export * from './metric-ids.js';
export * from './labels.js';
