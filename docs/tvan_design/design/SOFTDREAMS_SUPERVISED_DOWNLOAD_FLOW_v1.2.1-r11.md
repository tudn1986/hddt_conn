# SoftDreams supervised download flow — HDDT v1.2.1 r11

## UI placement

The complete SoftDreams workflow now lives in **Chi tiết hóa đơn → Tổng quan**:

1. initialize seller EasyInvoice portal session;
2. get CAPTCHA image;
3. submit `FKey + Capcha` to `/Search/Search`;
4. extract the opaque invoice token and rendered invoice HTML;
5. post `token + html` to `/Invoice/DownloadPdfAndFileAttachFromAvailableHtml`;
6. expose the returned `fileGuid`, `fileName`, and `/Invoice/Download?...` link.

The **Tra cứu / TVAN** tab intentionally contains only:

- Mã tra cứu;
- Portal.

## Production evidence replayed

Observed seller portal example:

`http://2301213781hd.easyinvoice.com.vn`

Observed requests:

- `GET /Captcha/Show`
- `POST /Search/Search` with `typeSearch=&FKey=<FKey>&Capcha=<captcha>`
- `POST /Invoice/DownloadPdfAndFileAttachFromAvailableHtml` with `token=<opaque>&html=<base64 rendered invoice HTML>`
- `GET /Invoice/Download?fileGuid=<guid>&fileName=<name>`

The r10 adapter forced HTTPS. r11 preserves the scheme in `PortalLink` because seller-specific EasyInvoice HTTP and HTTPS virtual hosts can behave differently, while still pinning every request and redirect to the exact seller-specific hostname.

## HTTP 408 mitigation

r11 removes four differences between the previous backend replay and a normal browser session that could lead to `HTTP 408` on file creation:

1. **Portal scheme parity** — use the exact scheme from `PortalLink` instead of always upgrading to HTTPS.
2. **Session bootstrap** — request `/Search/Index` before `/Captcha/Show`, preserving all session cookies through CAPTCHA, search, and file creation.
3. **Browser-like request context** — browser User-Agent, `Accept-Language`, same-origin `Origin`, `Referer`, and `X-Requested-With` are preserved for the AJAX flow.
4. **Rendered HTML extraction** — recursively locate the actual HTML fragment in JSON/HTML responses and Base64-encode that fragment only. The JSON response envelope is no longer silently encoded and sent as invoice HTML.

No blind automatic retry is performed after `408`, because the first request may still create a server-side temporary file and a retry could create duplicates. If production still returns 408 after r11, the error reports the exact portal origin and encoded request size so the next capture can compare browser/backend request semantics without exposing the private token or HTML.

## Security boundary

- Seller host must be exactly `<sellerTaxCode>hd.easyinvoice.vn` or `<sellerTaxCode>hd.easyinvoice.com.vn`.
- HTTP is allowed only when it is the scheme explicitly supplied by the GDT `PortalLink`; HTTPS upgrade redirects on the same host are also accepted.
- HTTPS-origin portals are never allowed to downgrade to HTTP.
- Session cookies, opaque invoice token, CAPTCHA state, and rendered HTML remain backend-private.
- The UI receives only safe lookup metadata, CAPTCHA image, `fileGuid`, `fileName`, and final download URL.
