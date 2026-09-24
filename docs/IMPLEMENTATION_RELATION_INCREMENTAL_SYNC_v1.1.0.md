# Implementation update — Relation-driven incremental sync + bounded ttxly=6 supplement

## Files changed

- `src/shared/models/index.ts`
  - adds invoice relation contracts;
  - adds `baselineToDate`, supplement controls, query windows and sync statistics.
- `src/shared/schemas/index.ts`
  - validates `baselineToDate` and `supplementTtxly6`.
- `src/shared/utils/date-utils.ts`
  - adds next-day, previous-month and incremental-window helpers.
- `src/shared/normalizer/index.ts`
  - maps `tchat=2/3` to `replacement/adjustment` relation using `nbmst + khmshdgoc + khhdgoc + shdgoc`.
- `src/shared/incremental-sync/index.ts`
  - preserves cached detail;
  - resolves relation locators against the local dataset;
  - marks originals locally as `tthai=4/5`.
- `src/server/services/invoice-query.service.ts`
  - main query begins after `baselineToDate`;
  - bounded purchase/standard `ttxly=6` supplement runs from the first day of the previous month through `toDate`;
  - main/supplement results are deduplicated before hydration;
  - existing complete invoices skip detail;
  - relation matching produces statistics/warnings without full-history lookup.
- `src/web/App.tsx`
  - keeps fully-covered dataset range separately from requested UI range.
- `src/web/pages/InvoicePage.tsx`
  - sends `baselineToDate`;
  - enables supplement query;
  - merges relation-driven status changes;
  - advances coverage only after a non-partial sync;
  - saves the fully-covered range, not an unsuccessfully requested range.
- `tests/unit/incremental-sync.test.ts`
  - adds replacement/adjustment local-status tests.
- `tests/integration/query-auto.test.ts`
  - adds baseline window, previous-month supplement and relation-resolution tests.
- `docs/INCREMENTAL_SYNC_v1.1.0.md`
  - replaced with the current relation-driven specification.
- `docs/RELATION_DRIVEN_INCREMENTAL_SYNC_v1.1.0.md`
  - standalone copy of the current specification.

## Required behavior

For a dataset fully covered through `2026-05-16`:

```text
MAIN incremental window:
2026-05-17 -> requested toDate

TTXLY=6 supplement window:
2026-04-01 -> requested toDate (when requested toDate is in May 2026)
```

When requested `toDate` is still `2026-05-16`, MAIN is empty and only the supplement is executed:

```text
purchase + standard + ttxly=6
2026-04-01 -> 2026-05-16
```

Relation rules:

```text
tchat=2 + original locator match -> original.tthai = 4
tchat=3 + original locator match -> original.tthai = 5
```

The original invoice is not hydrated again when its detail is already cached.

## Verification performed in this workspace

- TypeScript transpile/syntax diagnostics: PASS for all changed TS/TSX files.
- `node scripts/check-scripts.mjs`: PASS.
- Runtime harness for relation merge: PASS.
- Runtime harness for date windows, including year boundary: PASS.
- Runtime harness for `InvoiceQueryService`:
  - baseline `2026-05-16` produced MAIN `2026-05-17 -> 2026-05-20`;
  - supplement produced `2026-04-01 -> 2026-05-20` split by month;
  - replacement matched the original in the compact dataset index;
  - only the new replacement detail was hydrated.

Full dependency-backed `pnpm verify` was not executable in this environment because the uploaded source does not contain `node_modules` and package registry access is unavailable.
