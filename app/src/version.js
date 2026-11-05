// version.js — build constants (PRODUCT-SPEC §6.4). scripts/build.mjs REPLACES this file in dist/ with the real values
// (APP_VERSION = '<semver>+<10 hex>' = precache-manifest.version, APP_BUILD = its first 7 hex). In the unbuilt app/
// tree (unit tests, a raw static server) every value is null and the About screen shows the service worker's version.
export const APP_VERSION = null;
export const APP_SEMVER = null;
export const APP_BUILD = null;
export const DEV_RESEARCH = false;
export const BUNDLED_EVENT_MODEL = false;
export const PRESENT_MODULES = null; // unbuilt: every optional module is tried
