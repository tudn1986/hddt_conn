# HDDT v1.2.1 r6 — Test report

## Scope

MISA supervised presentation-link resolution in **Chi tiết hóa đơn → Tổng quan**. App version remains `1.2.1`.

## Executed checks

### 1. TypeScript syntax transpile

- Scope: all non-declaration `.ts` / `.tsx` under `src` and `tests`.
- Files: 79.
- Result: **PASS — 0 syntax diagnostics**.

### 2. Node script syntax

- Scope: all `scripts/*.mjs`.
- Result: **PASS** with `node --check`.

### 3. MISA supervised runtime harness

Fixture:

- lookup code: `50FBTGG6Q110`
- MISA metadata response: `customData=M7DR_2_K`

Observed backend request:

- method: `POST`
- URL: `https://www.meinvoice.vn/tra-cuu/GetInvoiceDataByTransactionID`
- body: `transactionID=50FBTGG6Q110`
- request count before returning the supervised result: exactly 1

Resolved URL:

`https://www.meinvoice.vn/tra-cuu/tra-cuu/DownloadHandler.ashx?Type=pdf&Viewer=1&ext=M7DR_2_K&Code=50FBTGG6Q110`

Result: **PASS**.

### 4. Missing customData negative case

A successful metadata response without a valid `customData` returns:

`TVAN_MISA_CUSTOM_DATA_MISSING`

No fabricated DownloadHandler URL is returned.

Result: **PASS**.

### 5. Full `tsc -p tsconfig.server.json`

Result: **BLOCKED BY PACKAGING ENVIRONMENT**. The source package has no `node_modules`, so TypeScript reports missing Node/Fastify/Zod/Yazl typings and downstream inference errors. No dependency-enabled full typecheck is claimed as passed.

## Live acceptance still required

This revision deliberately does not claim that the final MISA URL successfully displays a PDF in the user's browser. The purpose of r6 is to expose that URL so the user can verify it directly. Once the user confirms the new-tab link works, the same confirmed contract can be used to restore/adjust automatic preview and batch download behavior.
