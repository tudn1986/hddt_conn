# HDDT v1.2.1 r9 — Test report

## Scope

Adds `tvan_invoice` / M-Invoice PDF support using `msttcgp=0106026495`, seller `nbmst`, and `cttkhac` field `Số bảo mật`.

## Evidence-backed production contract

```text
GET https://tracuuhoadon.minvoice.com.vn/api/Search/SearchInvoice
?masothue=0106432955
&sobaomat=A349FB0BF1854FAE
&type=PDF
&inchuyendoi=false
```

The supplied URL was independently opened during development and returned `Content-Type: application/pdf` with the expected invoice content.

## Executed checks

### PASS — runtime adapter harness

The actual compiled `InvoiceTvanAdapter` was executed against a mock fetch boundary.

Assertions:

- provider capability is P1 / no CAPTCHA;
- supervised resolution performs zero provider network requests;
- seller tax code is mapped to `masothue`;
- `Số bảo mật` is mapped to `sobaomat`;
- `type=PDF` and `inchuyendoi=false` are exact;
- adapter performs one GET for PDF download;
- `%PDF-` validation passes.

### PASS — source syntax parse

81 TypeScript/TSX files under `src` and `tests`: 0 parse errors.

### PASS — JavaScript script syntax

All `.mjs` scripts pass `node --check`.

### PARTIAL — TypeScript semantic check

Global `tsc` was invoked. The workspace does not contain `node_modules`, so full semantic checking is blocked by missing `@types/node`, React, Ant Design, Fastify, ExcelJS, Zod, etc. No new semantic diagnostic was reported for `src/server/tvan/adapters/invoice.ts`, `src/server/tvan/registry.ts`, or `src/shared/lookup/index.ts`; the shared model file reports only the pre-existing missing Node `Buffer` type.

## Added tests in repository

- `tests/unit/tvan.test.ts`
  - registry classification for tvan_invoice P1;
  - exact supervised URL construction;
  - exact GET PDF request contract;
  - fallback provider recognition from `msttcgp=0106026495`.
- `tests/unit/dynamic-lookup.test.ts`
  - `Số bảo mật` lookup extraction.

These Vitest tests are committed in source but were not executable in this container because dependency packages are absent.

## Version

Application version remains **1.2.1**. `r9` is a source revision only.
