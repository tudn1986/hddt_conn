# SoftDreams EasyInvoice supervised download flow — HDDT v1.2.1 r10

App version remains **1.2.1**. `r10` is a source revision only.

## Production evidence used

GDT documents identify the provider as `tvan_softdreams` / `msttcgp=0105987432` and expose two lookup fields under `ttkhac`:

- `PortalLink`, for example `http://2301213781hd.easyinvoice.com.vn`
- `Fkey`, for example `MDYEKT4OZ`

The captured browser sequence is:

1. `GET /Captcha/Show`
2. `POST /Search/Search` with form body `typeSearch=&FKey=<Fkey>&Capcha=<captcha>`
3. obtain an opaque invoice token and the rendered invoice HTML
4. `POST /Invoice/DownloadPdfAndFileAttachFromAvailableHtml` with form body `token=<opaque-token>&html=<base64-html>`
5. response `{ fileGuid, fileName }`
6. final download link: `GET /Invoice/Download?fileGuid=<...>&fileName=<...>`

For the supplied sample the final file is `HOADON_2301213781_1C26TYY_17.zip`.

## r10 behavior

The **Chi tiết hóa đơn → Tra cứu / TVAN** tab now exposes Portal/Base URL and lookup code/Fkey. For `tvan_softdreams`, a supervised card performs the sequence above. The user only enters the visible EasyInvoice CAPTCHA. Opaque token, invoice HTML and provider cookies remain backend-private.

After successful CAPTCHA verification and file preparation the card returns:

- `fileGuid`
- `fileName`
- the complete provider download URL

The link is rendered as a user-clickable link opening a new tab.

## Automatic PDF path

The provider download can be a ZIP containing the PDF and attachments. The adapter therefore treats SoftDreams as **P3 / per-invoice CAPTCHA**. The automatic TVAN viewer/batch path downloads the final file through the backend and, when it is a ZIP, safely selects a PDF entry and validates `%PDF-` before returning it to the existing PDF viewer/archive pipeline.

## Security constraints

- `PortalLink` is accepted only when the hostname exactly matches `<sellerTaxCode>hd.easyinvoice.vn` or `<sellerTaxCode>hd.easyinvoice.com.vn`.
- Outbound requests are forced to HTTPS.
- Redirects may not leave the exact seller portal host.
- CAPTCHA/session cookies, opaque token and rendered invoice HTML never leave the local backend.
- The public plan contains only Portal/Fkey and, after preparation, `fileGuid`, `fileName`, and the final provider download link.
