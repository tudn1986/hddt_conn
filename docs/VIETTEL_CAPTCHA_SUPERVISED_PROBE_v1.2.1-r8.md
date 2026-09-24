# HDDT v1.2.1 r8 — Viettel CAPTCHA supervised probe

## Production evidence that triggered r8

The supervised r7 run showed that Viettel accepts GET on the live CAPTCHA endpoints and returns HTTP 200 with a challenge/session identifier, while the guessed POST variants return HTTP 405. This means POST-body probing is not a reliable way to discover the production challenge image.

## r8 decision

The initial Viettel challenge acquisition path is GET-only. The backend probes these same-origin routes in order:

1. `/api/services/einvoiceuaa/api/captcha/get`
2. `/api/services/einvoiceuaa/api/captcha/generate`
3. `/api/services/einvoiceuaa/api/captcha`

No POST is sent during the initial supervised probe.

For each response the backend records a safe diagnostic attempt: endpoint, method, HTTP status, Content-Type, JSON key paths, whether a token exists, image candidate count, Set-Cookie names, and a redacted response preview. Token/cookie values are never returned to the browser.

## Image discovery

r8 no longer depends only on hard-coded field names such as `originalImageBase64` or `jigsawImageBase64`. It also:

- walks nested JSON and JSON-encoded strings;
- detects actual PNG/JPEG/GIF/WebP/SVG base64 by file signature;
- follows same-origin image-looking URL fields;
- accepts binary image responses;
- preserves CAPTCHA cookies for same-origin image resolution and verification.

If a GET returns a token but no usable image, supervised prepare returns `captchaProbe.status = token_only` instead of throwing. The Overview card displays the redacted probe and stops before offsetX input.

## User acceptance step

Open an invoice with `tvan_viettel`, then **Chi tiết hóa đơn → Tổng quan → Bản thể hiện hóa đơn · Viettel (giám sát) → 1. Lấy CAPTCHA Viettel**.

If an image appears, continue verify/download. If the card still says token-only, copy the **Raw response đã che token** and **Response keys** from the successful HTTP 200 attempt. Those fields are the production schema evidence needed for the next mapping step; TVAN Backport is no longer required just to obtain this diagnostic.
