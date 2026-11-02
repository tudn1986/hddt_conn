/**
 * Single source of truth for the application version used by the server,
 * the web client, exports and dataset metadata.
 *
 * Keep in sync with `VERSION` and `package.json`; `scripts/check-version.mjs`
 * (run by `pnpm lint`) fails when they drift apart.
 */
export const APP_VERSION = '1.3.1-1';
