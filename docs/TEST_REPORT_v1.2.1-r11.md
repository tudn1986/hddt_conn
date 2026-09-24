# HDDT v1.2.1 r11 — test report

## Scope

SoftDreams UI relocation and browser-parity mitigation for `HTTP 408` at `/Invoice/DownloadPdfAndFileAttachFromAvailableHtml`.

## Static checks

- `node scripts/check-scripts.mjs`: PASS.
- `node --check scripts/*.mjs`: PASS (7 scripts).
- TypeScript/TSX `transpileModule` syntax pass: **81 files, 0 errors** (`.d.ts` excluded from the transpile pass).
- UI source inspection: SoftDreams supervised card is rendered only from the **Tổng quan** tab; **Tra cứu / TVAN** contains only `Mã tra cứu` and `Portal`.

## Runtime harness

PASS: browser-parity SoftDreams flow using the observed HTTP PortalLink:

1. `GET http://2301213781hd.easyinvoice.com.vn/Search/Index`
2. preserve bootstrap ASP.NET session cookie
3. `GET /Captcha/Show`
4. preserve updated CAPTCHA session cookie
5. `POST /Search/Search`
6. parse token and HTML from a JSON response whose HTML field name is deliberately unknown
7. send the exact rendered HTML Base64 to `/Invoice/DownloadPdfAndFileAttachFromAvailableHtml`
8. create the exact final HTTP `/Invoice/Download?fileGuid=...&fileName=...` URL.

The harness also verifies the prepare-file request uses `/Search/Index` as the referer and does not use the previous forced-HTTPS origin.

## Not run / limitations

- Full `pnpm verify` / Vitest / Vite production build: **not run in packaging environment** because this source workspace has no `node_modules` and registry DNS is unavailable.
- Live SoftDreams CAPTCHA and prepare-file acceptance: **requires user production verification**. r11 specifically addresses the differences most likely to explain the observed r10 `HTTP 408`, but no live CAPTCHA was submitted from the packaging environment.
- No claim is made that the production 408 is resolved until a real seller portal accepts the r11 request sequence.
