# HDDT v1.2.1 r7 — Test report

## Scope

Supervised `tvan_viettel` workflow in **Chi tiết hóa đơn → Tổng quan**. App version remains `1.2.1`.

## Executed checks

### 1. TypeScript/TSX syntax parse

- Scope: all `.ts` / `.tsx` files under `src` and `tests`.
- Files: **80**.
- Result: **PASS — 0 syntax diagnostics** using the TypeScript parser.

### 2. Node script syntax

- Scope: `scripts/*.mjs`.
- Files: **7**.
- Result: **PASS** with `node --check`.

### 3. Viettel adapter runtime harness

Fixture uses the supplied production contract:

- seller MST: `2301000920`
- reservation code: `71ARPKV719EKBKE`
- first `/captcha/get` GET returns token-only and is rejected for UI purposes;
- bounded POST `{}` returns a slider image + private challenge token;
- `/captcha/verify` receives `{token, offsetX: 80}` and returns a private session token;
- `/downloadPDF?taxCode=2301000920` receives JSON `{supplierTaxCode, reservationCode, recaptcha}` and returns `%PDF-`.

Assertions:

- safe challenge trace reports the actual successful endpoint/method/body/status;
- challenge token is absent from the public trace;
- verification trace masks the challenge token;
- download plan masks the reusable session token;
- real provider token is still used internally for the mocked download;
- returned content passes PDF magic validation.

Result: **PASS**.

### 4. TvanPdfService supervised-flow harness

The public service boundary was executed end-to-end:

`prepareSupervised → verifyCaptcha → describeDownloadRequest → viewPdf`

Assertions:

- `prepareSupervised` does not serialize the private challenge token;
- `verifyCaptcha` does not serialize either provider token;
- `describeDownloadRequest` reports `tokenReady=true` while returning only `[backend-private-session-token]`;
- `viewPdf` uses the private cached token and returns a valid `%PDF-` buffer.

Result: **PASS**.

### 5. Source-level TypeScript project typecheck

`tsc -p tsconfig.server.json` and `tsc -p tsconfig.json` were attempted.

Result: **BLOCKED BY PACKAGING ENVIRONMENT** because this source workspace has no `node_modules`; diagnostics are dominated by missing Node/Fastify/Zod/Yazl/React/Ant Design typings and the resulting inference errors. No dependency-enabled full typecheck is claimed as passed.

No new syntax error is present in the changed Viettel adapter/service/routes/models/WebUI files.

## Live acceptance still required

This report does **not** claim that Viettel's current production challenge payload matches the mocked image field names. The supplied evidence confirms verify and PDF-download contracts, while the exact live image-bearing CAPTCHA response still needs user-side confirmation through the new supervision card.

Production acceptance requires a real run through all three buttons and a valid PDF opening in the new tab.
