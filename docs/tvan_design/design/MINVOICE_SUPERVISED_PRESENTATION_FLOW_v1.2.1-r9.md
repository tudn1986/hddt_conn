# HDDT v1.2.1 r9 — tvan_invoice / M-Invoice supervised PDF flow

## Production evidence

Provider identity observed in GDT payload:

- `ngcnhat = tvan_invoice`
- `msttcgp = 0106026495`
- seller tax code: `nbmst`
- PDF lookup secret: `cttkhac[].ttruong = "Số bảo mật"`

Confirmed browser/API contract:

```text
GET https://tracuuhoadon.minvoice.com.vn/api/Search/SearchInvoice
    ?masothue=<nbmst>
    &sobaomat=<Số bảo mật>
    &type=PDF
    &inchuyendoi=false
```

Production sample:

```text
masothue=0106432955
sobaomat=A349FB0BF1854FAE
```

The supplied production URL was independently verified to return `application/pdf`.

## Supervised UI

Location: **Chi tiết hóa đơn → Tổng quan**.

Card: **Bản thể hiện hóa đơn · M-Invoice / tvan_invoice (giám sát)**.

The card shows:

1. TVAN code.
2. TVAN tax code (`msttcgp`, expected `0106026495`).
3. Seller tax code (`masothue`).
4. Security code (`sobaomat` / `Số bảo mật`).
5. Exact SearchInvoice endpoint.
6. Complete PDF URL.
7. Backend resolution timestamp and step trace.

The first button only asks the local backend to validate/extract the fields and construct the URL. It does not contact M-Invoice. The final URL opens only after the user clicks it.

## Automatic preview / batch

The same adapter implements `downloadPdf()` using the exact GET URL above. Returned bytes must start with `%PDF-`; otherwise the request is rejected as an invalid provider response.

Capability:

```text
captchaMode = none
priority = P1
```

Therefore the provider participates in P1 batch download without user CAPTCHA.

## Security

- Outbound URL host is hard allow-listed to `tracuuhoadon.minvoice.com.vn`.
- Redirects are revalidated by the common TVAN HTTP layer.
- No arbitrary URL from invoice payload is fetched.
- The direct lookup URL contains the provider's security code by contract; the UI displays it because the user explicitly requested a supervised link and the code already exists in the invoice payload.
