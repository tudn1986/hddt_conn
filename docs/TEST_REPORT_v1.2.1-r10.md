# HDDT v1.2.1 r10 — test report

## Scope

SoftDreams EasyInvoice supervised lookup/download implementation from the supplied production capture. App version remains 1.2.1.

## Checks completed

- Source syntax transpile: **81 TS/TSX files, 0 syntax diagnostics**.
- `scripts/check-scripts.mjs`: PASS.
- `node --check scripts/*.mjs`: PASS for all script files.
- Registry updated with `tvan_softdreams` as `captchaMode=per_invoice`, priority P3.
- Unit regression source added for the exact observed sequence:
  `Captcha/Show -> Search/Search -> DownloadPdfAndFileAttachFromAvailableHtml -> Invoice/Download`.
- Regression checks assert that provider cookie and opaque search token are not exposed in the public challenge/download plan.
- ZIP-to-PDF code validates safe ZIP entry names, entry count/size, selects a PDF, and validates `%PDF-`.

## Full semantic TypeScript build

`tsc -p tsconfig.server.json` was attempted in the packaging environment. It is blocked by the source workspace not containing `node_modules` / local dependency typings (`@types/node`, Fastify, yauzl, etc.). The new SoftDreams file consequently shows the same missing-module/Node-global class of diagnostics; syntax transpile is clean. A dependency-enabled build on the target workstation remains required.

## Live acceptance still required

The browser capture establishes the request sequence and final download contract. The implementation has not been allowed to submit a real CAPTCHA to the supplier portal from this packaging environment. First production acceptance should be performed from the supervised card in **Chi tiết hóa đơn → Tra cứu / TVAN**.
