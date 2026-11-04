// diag - diagnostic report (CAFCR P11). Every module that measures something calls record(path, value).
export { record, increment, get, reset, STORAGE_KEY } from './record.js';
export { buildReport, REPORT_SCHEMA, emptyReport } from './report.js';
