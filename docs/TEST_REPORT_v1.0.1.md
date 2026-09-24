# HDDT v1.0.1 verification report

Environment: Windows x64, Node v24.13.1, npm. No authorized live GDT credentials used. Date: 2026-09-10.

Final `npm run verify` exited **0**. This uses `&&` to gate lint, tests, production build and smoke.

- TypeScript strict no-emit check: passed.
- Script syntax checks: passed.
- Vitest: **14 files passed; 60 tests passed; 2 skipped; 62 total**.
- Production server TypeScript build: passed.
- Production Vite web build: passed.
- Real loopback HTTP mock smoke: passed, `{ "ok": true, "version": "1.0.1", "invoices": 2, "downloads": 4 }`.

New tests invoke the real Fastify route with injected mocked connector methods. They cover strict dates/leap year/year boundary, actual opaque cursors on short pages, monthly cursor reset, composite template keys, bounded detail concurrency, transient retry, repeated cursor protection, chunk/detail warnings, partial 401 data, missing CSRF, authentication and invalid input. Filter unit tests combine all five filters, status zero, clear behavior and sales partner search. Existing integration covers login, pagination, details, dataset save/open/import, Excel and XML/ZIP.

Two existing POSIX symlink escape/collision tests use `it.runIf(process.platform !== 'win32')`; they are skipped on Windows, not claimed as passing.

An initial regression run found a test still expecting app version 1.0.0. The assertion was updated to 1.0.1 and the complete gated verification rerun passed. A retry test was corrected to capture each attempt's number before awaiting, and asserts seven calls for six successful documents after one transient failure.

Dependency installation: `npm install --ignore-scripts --package-lock=false --no-audit --no-fund`. The supplied pnpm lockfile was retained. The npm verification run resolves package.json ranges and is not proof of a frozen pnpm install. Deprecation warnings occurred for transitive dependencies. No dependency vulnerability audit was performed for this release.

NOT VERIFIED: live GDT login/query/detail/download, live sales endpoint, browser E2E interactions, virtual expansion visual behavior, 5K/10K-row browser FPS/memory, accessibility audit, macOS/Linux launchers, portable executable packaging. No invented performance baseline, screenshot or production deployment is included. UI behavior is implemented and typechecked/built, but browser acceptance testing remains necessary.

Source packaging includes source, tests, scripts, docs, supplied lockfile and per-file SHA256 manifest; excludes node_modules and dist. ZIP checksum is supplied adjacent to the archive.
